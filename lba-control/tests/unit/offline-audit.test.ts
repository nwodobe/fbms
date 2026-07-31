/**
 * Phase 7 · audit de la file hors ligne.
 *
 * Les tests OFF-01 → OFF-08 vérifient des comportements. Celui-ci vérifie des
 * **propriétés du code lui-même** et tient une épreuve d'endurance.
 *
 * La raison est simple : les garanties de la file — rien n'est supprimé, rien
 * n'est plafonné — ne se cassent pas par un bug de logique, elles se cassent
 * par une bonne intention. Quelqu'un ajoutera un jour un « nettoyage des
 * anciennes opérations » pour libérer de la place, et la perte sera silencieuse
 * jusqu'à ce qu'un pisteur réclame le paiement d'un achat que l'application
 * n'a plus.
 */
import 'fake-indexeddb/auto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attachmentContent,
  flushAttachments,
  queueAttachment,
  verifyAttachmentIntegrity,
} from '@/lib/offline/attachments'
import { OfflineDatabase } from '@/lib/offline/db'
import { countByStatus, enqueue, fullJournal, pendingOperations } from '@/lib/offline/queue'
import { synchronize, verifyQueueIntegrity, type PushOutcome } from '@/lib/offline/sync'

const OFFLINE_DIR = join(process.cwd(), 'src/lib/offline')

function offlineSources(): Array<{ file: string; code: string }> {
  return readdirSync(OFFLINE_DIR)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .map((file) => ({ file, code: readFileSync(join(OFFLINE_DIR, file), 'utf8') }))
}

let db: OfflineDatabase
let counter = 0
const uuid = () => `audit-${String(++counter).padStart(6, '0')}`

const purchase = () => ({
  id: uuid(),
  tenantId: 'tenant-1',
  userId: 'user-1',
  deviceId: 'device-1',
  entityType: 'purchase' as const,
  payload: { net_weight_kg: 8200, price_per_kg: 430, amount: 3_526_000 },
})

beforeEach(async () => {
  counter = 0
  db = new OfflineDatabase(`audit-${Math.random().toString(36).slice(2)}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

// ---------------------------------------------------------------------------
// Propriétés du code
// ---------------------------------------------------------------------------

describe('AUDIT · le code ne peut pas perdre une opération', () => {
  it('aucun module hors ligne n’appelle une suppression sur la file', async () => {
    const offenders: string[] = []

    for (const { file, code } of offlineSources()) {
      // On cherche les appels de suppression Dexie portant sur les opérations
      // ou le journal. `db.delete()` sur la base entière reste autorisé : il
      // sert aux tests et à la déconnexion complète d'un appareil.
      const dangerous = [
        /operations\s*\.\s*delete\s*\(/,
        /operations\s*\.\s*clear\s*\(/,
        /operations\s*\.\s*bulkDelete\s*\(/,
        /journal\s*\.\s*delete\s*\(/,
        /journal\s*\.\s*clear\s*\(/,
        /journal\s*\.\s*bulkDelete\s*\(/,
      ]
      if (dangerous.some((pattern) => pattern.test(code))) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('aucune constante ne plafonne la file', async () => {
    const offenders: string[] = []

    for (const { file, code } of offlineSources()) {
      // Le cahier des charges interdit explicitement de limiter la file à
      // 300 opérations. On cherche toute borne de ce genre, quel qu'en soit
      // le nombre.
      const patterns = [
        /MAX_(QUEUE|OPERATIONS|PENDING)/i,
        /QUEUE_(LIMIT|SIZE|CAP)/i,
        /operations[^\n]*\.limit\s*\(/,
      ]
      if (patterns.some((pattern) => pattern.test(code))) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('le journal est indexé par type d’événement', async () => {
    // Sans cet index, `verifyQueueIntegrity` ne peut plus interroger les
    // entrées « queued », et la preuve qu'aucune opération n'a disparu devient
    // impossible à produire.
    const schema = db.journal.schema.indexes.map((index) => index.name)
    expect(schema).toContain('event')
  })

  it('la taille du lot d’envoi ne borne que l’envoi', async () => {
    for (let index = 0; index < 40; index += 1) await enqueue(purchase(), db)

    const report = await synchronize(async () => ({ kind: 'synced' }) as PushOutcome, {
      batchSize: 5,
      db,
    })

    expect(report.attempted).toBe(5)
    expect(report.synced).toBe(5)
    expect(report.dropped).toBe(0)
    // Les 35 autres restent en file, intactes et visibles.
    expect((await countByStatus(db)).pending).toBe(35)
  })
})

describe('AUDIT · le code ne peut pas perdre un justificatif', () => {
  it('aucun module hors ligne n’efface la file des justificatifs', async () => {
    const offenders: string[] = []

    for (const { file, code } of offlineSources()) {
      const dangerous = [
        /attachments\s*\.\s*(delete|clear|bulkDelete)\s*\(/,
        /attachmentContent\s*\.\s*(delete|clear|bulkDelete)\s*\(/,
      ]
      if (dangerous.some((pattern) => pattern.test(code))) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('aucune constante ne plafonne la file des justificatifs', async () => {
    const offenders: string[] = []

    for (const { file, code } of offlineSources()) {
      const patterns = [/MAX_(ATTACHMENTS|FILES|PROOFS)/i, /attachments[^\n]*\.limit\s*\(/]
      if (patterns.some((pattern) => pattern.test(code))) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })

  it('les octets ne vivent pas dans la ligne mise à jour à chaque tentative', async () => {
    // Défaut réellement rencontré : tant que le tampon était rangé dans la ligne
    // de suivi, chaque `Table.update` le détruisait. La ligne restait, le
    // fichier devenait vide, et rien ne le signalait. Ce test épingle la
    // séparation qui corrige cela.
    const row = await queueAttachment(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        deviceId: 'device-1',
        kind: 'preuve_achat',
        binding: { table: 'purchases', column: 'proof_path', rowId: 'purchase-1' },
        content: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x2a]).buffer,
        mimeType: 'image/jpeg',
      },
      db,
    )

    expect(Object.keys(row)).not.toContain('content')

    // Quinze passages, donc quinze mises à jour de statut.
    for (let round = 0; round < 15; round += 1) {
      await flushAttachments(
        async () => {
          throw new Error('Hors couverture')
        },
        async () => 1,
        { db, maxAttempts: 100 },
      )
    }

    const bytes = await attachmentContent(row.id, db)
    expect(new Uint8Array(bytes!)).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x2a]))
    expect((await verifyAttachmentIntegrity(db)).intact).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Endurance
// ---------------------------------------------------------------------------

describe('AUDIT · endurance de la file', () => {
  it('survit à 500 opérations, des échecs, des conflits et une réouverture', async () => {
    const total = 500
    const ids: string[] = []

    for (let index = 0; index < total; index += 1) {
      const operation = purchase()
      ids.push(operation.id)
      await enqueue(operation, db)
    }

    // Un serveur capricieux : un tiers échoue, un dixième signale un doublon,
    // le reste passe. C'est le comportement réel d'un réseau de brousse, pas
    // une panne franche.
    let call = 0
    const flaky = async (): Promise<PushOutcome> => {
      call += 1
      if (call % 3 === 0) return { kind: 'error', message: 'Réseau interrompu', retryable: true }
      if (call % 10 === 0) {
        return {
          kind: 'conflict',
          conflictKind: 'duplicate_probable',
          message: 'Achat très proche d’un achat déjà enregistré.',
        }
      }
      return { kind: 'synced' }
    }

    for (let round = 0; round < 4; round += 1) {
      await synchronize(flaky, { batchSize: 200, db })
    }

    // Réouverture de la base, comme après un redémarrage du téléphone.
    await db.close()
    await db.open()

    const stored = await db.operations.toArray()
    expect(stored).toHaveLength(total)
    expect(new Set(stored.map((row) => row.id)).size).toBe(total)

    const integrity = await verifyQueueIntegrity(db)
    expect(integrity.intact).toBe(true)
    expect(integrity.missing).toEqual([])
    expect(integrity.stored).toBe(total)
    // Épreuve d'endurance : le délai généreux est assumé, c'est le volume qui
    // fait la valeur du test.
  }, 60_000)

  it('conserve un journal complet de tout ce qui est arrivé', async () => {
    for (let index = 0; index < 30; index += 1) await enqueue(purchase(), db)

    let call = 0
    await synchronize(
      async (): Promise<PushOutcome> => {
        call += 1
        return call % 2 === 0
          ? { kind: 'error', message: 'Délai dépassé', retryable: true }
          : { kind: 'synced' }
      },
      { batchSize: 30, db },
    )

    const journal = await fullJournal(db)
    const events = new Set(journal.map((entry) => entry.event))

    expect(events.has('queued')).toBe(true)
    expect(events.has('attempt_started')).toBe(true)
    expect(events.has('synced')).toBe(true)
    expect(events.has('attempt_failed')).toBe(true)
    // Une entrée de journal par opération au minimum : le journal doit
    // permettre de reconstituer le sort de chacune.
    expect(journal.length).toBeGreaterThanOrEqual(30)
  })

  it('n’altère aucune charge utile pendant la synchronisation', async () => {
    const operation = purchase()
    await enqueue(operation, db)

    const fail = async (): Promise<PushOutcome> => ({
      kind: 'error',
      message: 'Réseau',
      retryable: true,
    })
    await synchronize(fail, { db })
    await synchronize(fail, { db })

    const [stored] = await pendingOperations(db, 10)
    // La saisie du pisteur est ce que l'application a de plus précieux : elle
    // ne doit ni être normalisée, ni arrondie, ni réécrite en route.
    expect(stored?.payload).toEqual(operation.payload)
  })

  it('laisse la file lisible même quand tout échoue', async () => {
    for (let index = 0; index < 25; index += 1) await enqueue(purchase(), db)

    for (let round = 0; round < 12; round += 1) {
      await synchronize(
        async (): Promise<PushOutcome> => ({
          kind: 'error',
          message: 'Hors couverture',
          retryable: true,
        }),
        { batchSize: 25, db },
      )
    }

    const stored = await db.operations.toArray()
    expect(stored).toHaveLength(25)
    // Après le nombre maximal de tentatives, les opérations passent en
    // « failed » — visibles et rejouables, jamais effacées.
    expect(stored.every((row) => row.status === 'pending' || row.status === 'failed')).toBe(true)
    expect((await verifyQueueIntegrity(db)).intact).toBe(true)
  })
})
