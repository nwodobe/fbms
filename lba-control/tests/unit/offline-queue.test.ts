/**
 * OFF-01 → OFF-08 · file hors ligne.
 *
 * Ce sont les tests les plus importants du produit côté terrain. Un pisteur
 * saisit vingt achats dans une zone sans réseau ; si l'application en perd un
 * seul, ce sont des centaines de milliers de francs qui deviennent
 * inexplicables, et la confiance dans l'outil disparaît avec.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineDatabase, type QueuedOperation } from '@/lib/offline/db'
import {
  conflicts,
  countByStatus,
  enqueue,
  fullJournal,
  journalFor,
  markFailed,
  pendingOperations,
  resolveConflict,
} from '@/lib/offline/queue'
import { backoffDelayMs, synchronize, verifyQueueIntegrity, type PushOutcome } from '@/lib/offline/sync'

let db: OfflineDatabase
let counter = 0

const uuid = () => `op-${String(++counter).padStart(6, '0')}`

const purchase = (over: Partial<Parameters<typeof enqueue>[0]> = {}) => ({
  id: uuid(),
  tenantId: 'tenant-1',
  userId: 'user-1',
  deviceId: 'device-1',
  entityType: 'purchase' as const,
  payload: { net_weight_kg: 8200, price_per_kg: 430, amount: 3_526_000 },
  ...over,
})

beforeEach(async () => {
  counter = 0
  db = new OfflineDatabase(`test-${Math.random().toString(36).slice(2)}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

// ---------------------------------------------------------------------------
// OFF-01 · Une opération pending n'est jamais supprimée
// ---------------------------------------------------------------------------

describe('OFF-01 · aucune opération pending n’est supprimée', () => {
  it('l’opération survit à des échecs répétés', async () => {
    const op = await enqueue(purchase(), db)

    const alwaysFails = vi.fn(async (): Promise<PushOutcome> => ({
      kind: 'error',
      message: 'Réseau indisponible',
      retryable: true,
    }))

    for (let i = 0; i < 5; i++) {
      await synchronize(alwaysFails, { db })
    }

    const stored = await db.operations.get(op.id)
    expect(stored).toBeDefined()
    expect(stored!.status).toBe('failed')
    expect(stored!.attempts).toBe(5)
    expect(stored!.lastError).toBe('Réseau indisponible')
  })

  it('l’opération survit à la fermeture et réouverture de la base', async () => {
    const name = `persist-${Math.random().toString(36).slice(2)}`
    const first = new OfflineDatabase(name)
    await first.open()
    const op = await enqueue(purchase(), first)
    first.close()

    const second = new OfflineDatabase(name)
    await second.open()
    const stored = await second.operations.get(op.id)
    expect(stored?.status).toBe('pending')

    await second.delete()
  })

  it('le module n’expose aucune fonction de purge', async () => {
    const queueModule = await import('@/lib/offline/queue')
    const names = Object.keys(queueModule).map((name) => name.toLowerCase())
    // Ce qui n'existe pas ne peut pas être appelé par erreur.
    expect(names.some((name) => /purge|clear|drop|deleteall|prune/.test(name))).toBe(false)
  })

  it('une opération synchronisée est conservée comme preuve', async () => {
    const op = await enqueue(purchase(), db)
    await synchronize(async () => ({ kind: 'synced' }), { db })

    const stored = await db.operations.get(op.id)
    expect(stored).toBeDefined()
    expect(stored!.status).toBe('synced')
    expect(stored!.syncedAt).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// OFF-02 · La file n'est pas bornée
// ---------------------------------------------------------------------------

describe('OFF-02 · file non bornée', () => {
  it('accepte 1 500 opérations sans en perdre aucune', async () => {
    const ids: string[] = []
    for (let i = 0; i < 1500; i++) {
      const op = await enqueue(purchase(), db)
      ids.push(op.id)
    }

    expect(await db.operations.count()).toBe(1500)

    // Aucune limite à 300 : l'exigence est explicite dans le cahier des charges.
    const queue = await pendingOperations(db)
    expect(queue).toHaveLength(1500)

    const integrity = await verifyQueueIntegrity(db)
    expect(integrity.intact).toBe(true)
    expect(integrity.missing).toEqual([])
  }, 60_000)

  it('un lot d’envoi borne l’envoi, pas la file', async () => {
    for (let i = 0; i < 50; i++) await enqueue(purchase(), db)

    const report = await synchronize(async () => ({ kind: 'synced' }), { db, batchSize: 10 })

    expect(report.attempted).toBe(10)
    expect(await db.operations.count()).toBe(50)
    expect((await countByStatus(db)).pending).toBe(40)
  })

  it('conserve l’ordre de saisie du terrain', async () => {
    const first = await enqueue(purchase({ createdAtDevice: '2026-03-10T08:00:00.000Z' }), db)
    const third = await enqueue(purchase({ createdAtDevice: '2026-03-10T12:00:00.000Z' }), db)
    const second = await enqueue(purchase({ createdAtDevice: '2026-03-10T10:00:00.000Z' }), db)

    const queue = await pendingOperations(db)
    expect(queue.map((op) => op.id)).toEqual([first.id, second.id, third.id])
  })
})

// ---------------------------------------------------------------------------
// OFF-03 / OFF-04 · Idempotence et doublons
// ---------------------------------------------------------------------------

describe('OFF-03/04 · synchronisation idempotente', () => {
  it('trois rejeux ne produisent qu’une seule opération', async () => {
    const op = await enqueue(purchase(), db)

    const push = vi.fn(async (): Promise<PushOutcome> => ({ kind: 'synced' }))
    await synchronize(push, { db })
    await synchronize(push, { db })
    await synchronize(push, { db })

    // Après le premier succès, l'opération n'est plus dans la file d'envoi.
    expect(push).toHaveBeenCalledTimes(1)
    expect(await db.operations.count()).toBe(1)
    expect((await db.operations.get(op.id))!.status).toBe('synced')
  })

  it('ré-enfiler le même identifiant ne crée pas de doublon', async () => {
    const input = purchase()
    await enqueue(input, db)
    await enqueue(input, db)
    await enqueue(input, db)

    expect(await db.operations.count()).toBe(1)
    const entries = await journalFor(input.id, db)
    expect(entries.filter((e) => e.event === 'duplicate_skipped')).toHaveLength(2)
  })

  it('une ligne déjà présente au serveur compte comme un succès', async () => {
    await enqueue(purchase(), db)

    const report = await synchronize(async () => ({ kind: 'already_present' }), { db })

    expect(report.alreadyPresent).toBe(1)
    expect(report.failed).toBe(0)
    expect((await countByStatus(db)).synced).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// OFF-05 · Les conflits sont affichés, jamais écrasés
// ---------------------------------------------------------------------------

describe('OFF-05 · conflits visibles', () => {
  it('un doublon probable est signalé sans supprimer l’opération', async () => {
    const op = await enqueue(purchase(), db)

    await synchronize(
      async () => ({
        kind: 'conflict',
        conflictKind: 'duplicate_probable',
        message: 'Un achat très proche existe déjà pour ce vendeur et cette date.',
        serverValue: { id: 'achat-serveur' },
      }),
      { db },
    )

    const stored = await db.operations.get(op.id)
    expect(stored).toBeDefined()
    expect(stored!.conflict).not.toBeNull()
    expect(stored!.conflict!.kind).toBe('duplicate_probable')
    expect(stored!.conflict!.message).toMatch(/existe déjà/)

    expect(await conflicts(db)).toHaveLength(1)
  })

  it('l’utilisateur peut renvoyer l’opération après vérification', async () => {
    const op = await enqueue(purchase(), db)
    await synchronize(
      async () => ({ kind: 'conflict', conflictKind: 'duplicate_probable', message: 'Doublon possible' }),
      { db },
    )

    await resolveConflict(op.id, 'retry', db)

    const stored = await db.operations.get(op.id)
    expect(stored!.status).toBe('pending')
    expect(stored!.conflict).toBeNull()
  })

  it('garder la version serveur n’efface pas l’opération locale', async () => {
    const op = await enqueue(purchase(), db)
    await synchronize(
      async () => ({ kind: 'conflict', conflictKind: 'version_mismatch', message: 'Version divergente' }),
      { db },
    )

    await resolveConflict(op.id, 'keep_server', db)

    const stored = await db.operations.get(op.id)
    expect(stored).toBeDefined()
    expect(stored!.status).toBe('synced')
    // La trace du conflit reste : elle explique pourquoi la saisie terrain
    // n'apparaît pas telle quelle côté serveur.
    expect(stored!.conflict).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// OFF-06 · Compteur de tentatives et dernière erreur
// ---------------------------------------------------------------------------

describe('OFF-06 · tentatives et erreurs', () => {
  it('incrémente le compteur et conserve la dernière erreur', async () => {
    const op = await enqueue(purchase(), db)

    await markFailed(op.id, 'Timeout réseau', db)
    await markFailed(op.id, 'Serveur indisponible (503)', db)

    const stored = await db.operations.get(op.id)
    expect(stored!.attempts).toBe(2)
    expect(stored!.lastError).toBe('Serveur indisponible (503)')
    expect(stored!.lastAttemptAt).not.toBeNull()
  })

  it('cesse de retenter après le maximum, sans rien supprimer', async () => {
    const op = await enqueue(purchase(), db)
    const push = vi.fn(async (): Promise<PushOutcome> => ({ kind: 'error', message: 'KO', retryable: true }))

    for (let i = 0; i < 6; i++) {
      await synchronize(push, { db, maxAttempts: 3 })
    }

    expect(push).toHaveBeenCalledTimes(3)
    const stored = await db.operations.get(op.id)
    // L'opération attend une action humaine : elle n'est pas abandonnée.
    expect(stored).toBeDefined()
    expect(stored!.attempts).toBe(3)
  })

  it('espace les tentatives de façon croissante et plafonnée', async () => {
    expect(backoffDelayMs(0)).toBe(1_000)
    expect(backoffDelayMs(3)).toBe(8_000)
    expect(backoffDelayMs(100)).toBe(30 * 60_000)
  })

  it('une exception inattendue est capturée comme une erreur', async () => {
    const op = await enqueue(purchase(), db)
    await synchronize(async () => {
      throw new Error('Panne inattendue')
    }, { db })

    const stored = await db.operations.get(op.id)
    expect(stored!.status).toBe('failed')
    expect(stored!.lastError).toBe('Panne inattendue')
  })
})

// ---------------------------------------------------------------------------
// OFF-07 · Journal de synchronisation
// ---------------------------------------------------------------------------

describe('OFF-07 · journal prouvant qu’aucune opération n’a disparu', () => {
  it('journalise chaque étape de la vie d’une opération', async () => {
    const op = await enqueue(purchase(), db)
    await synchronize(async () => ({ kind: 'error', message: 'Réseau coupé', retryable: true }), { db })
    await synchronize(async () => ({ kind: 'synced' }), { db })

    const entries = await journalFor(op.id, db)
    const events = entries.map((entry) => entry.event)

    expect(events).toContain('queued')
    expect(events).toContain('attempt_started')
    expect(events).toContain('attempt_failed')
    expect(events).toContain('synced')
  })

  it('la vérification d’intégrité détecte une disparition', async () => {
    const op = await enqueue(purchase(), db)
    await enqueue(purchase(), db)

    expect((await verifyQueueIntegrity(db)).intact).toBe(true)

    // Simulation d'une perte : le journal doit permettre de la constater.
    await db.operations.delete(op.id)

    const integrity = await verifyQueueIntegrity(db)
    expect(integrity.intact).toBe(false)
    expect(integrity.missing).toEqual([op.id])
  })

  it('le journal complet est lisible dans l’ordre chronologique', async () => {
    await enqueue(purchase(), db)
    await enqueue(purchase(), db)

    const entries = await fullJournal(db)
    expect(entries.length).toBeGreaterThanOrEqual(2)
    const timestamps = entries.map((entry) => entry.at)
    expect([...timestamps].sort()).toEqual(timestamps)
  })
})

// ---------------------------------------------------------------------------
// OFF-08 · Appareil révoqué
// ---------------------------------------------------------------------------

describe('OFF-08 · appareil révoqué', () => {
  it('le refus du serveur laisse l’opération en file, visible', async () => {
    const op = await enqueue(purchase({ deviceId: 'device-revoque' }), db)

    await synchronize(
      async () => ({
        kind: 'conflict',
        conflictKind: 'rejected_by_server',
        message: 'Cet appareil a été révoqué. Contactez votre responsable.',
      }),
      { db },
    )

    const stored = await db.operations.get(op.id)
    expect(stored).toBeDefined()
    expect(stored!.conflict!.message).toMatch(/révoqué/)
    // La saisie du pisteur n'est pas perdue parce que son appareil a été révoqué.
    expect(stored!.payload).toMatchObject({ net_weight_kg: 8200 })
  })
})

// ---------------------------------------------------------------------------
// Rapport de synchronisation
// ---------------------------------------------------------------------------

describe('rapport de synchronisation', () => {
  it('rend compte de chaque issue, et ne perd jamais rien', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await enqueue(purchase(), db)).id)

    const outcomes: PushOutcome[] = [
      { kind: 'synced' },
      { kind: 'already_present' },
      { kind: 'error', message: 'KO', retryable: true },
      { kind: 'conflict', conflictKind: 'duplicate_probable', message: 'Doublon' },
    ]
    let index = 0

    const report = await synchronize(async () => outcomes[index++]!, { db })

    expect(report).toEqual({
      attempted: 4,
      synced: 1,
      alreadyPresent: 1,
      failed: 1,
      conflicts: 1,
      dropped: 0,
    })
    expect(await db.operations.count()).toBe(4)
  })

  it('respecte une interruption sans perdre la file', async () => {
    for (let i = 0; i < 5; i++) await enqueue(purchase(), db)

    const controller = new AbortController()
    let calls = 0
    const report = await synchronize(
      async (): Promise<PushOutcome> => {
        calls += 1
        if (calls === 2) controller.abort()
        return { kind: 'synced' }
      },
      { db, signal: controller.signal },
    )

    expect(report.attempted).toBeLessThan(5)
    expect(await db.operations.count()).toBe(5)
  })
})

// Vérifie que le type reste cohérent avec l'usage attendu.
const _typeCheck: QueuedOperation['status'][] = ['pending', 'syncing', 'synced', 'failed']
void _typeCheck
