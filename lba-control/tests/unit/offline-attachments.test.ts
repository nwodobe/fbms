/**
 * OFF-09 → OFF-14 · file des justificatifs.
 *
 * Un ticket de pesée photographié dans un village sans réseau est une preuve
 * que personne ne pourra reconstituer plus tard. La file locale existe pour
 * qu'il arrive, et ces tests vérifient les deux propriétés qui comptent :
 *
 *  · **rien ne disparaît**, même après un refus définitif ;
 *  · **rien n'est annoncé comme joint avant de l'être** — l'ordre octets puis
 *    chemin est ce qui empêche un `proof_path` de pointer sur rien.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentBinding } from '@/domain/attachments'
import {
  attachmentContent,
  attachmentCounts,
  attachmentsFor,
  flushAttachments,
  pendingAttachments,
  queueAttachment,
  verifyAttachmentIntegrity,
} from '@/lib/offline/attachments'
import { OfflineDatabase, type PendingAttachment } from '@/lib/offline/db'

let db: OfflineDatabase

const purchaseBinding: AttachmentBinding = {
  table: 'purchases',
  column: 'proof_path',
  rowId: 'purchase-1',
}

/** Signature JPEG : les octets sont ceux d'un vrai fichier, pas du remplissage. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const ticket = (over: Partial<Parameters<typeof queueAttachment>[0]> = {}) => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  deviceId: 'device-1',
  kind: 'preuve_achat' as const,
  binding: purchaseBinding,
  content: JPEG_BYTES.slice().buffer,
  mimeType: 'image/jpeg',
  ...over,
})

const uploadOk = () =>
  vi.fn(async (row: PendingAttachment, content: ArrayBuffer) => {
    // Les octets réellement remis à l'envoi sont ceux qui ont été photographiés.
    expect(new Uint8Array(content).byteLength).toBeGreaterThan(0)
    return `tenant-1/preuve/${row.id}.jpg`
  })
const bindOk = () => vi.fn(async (_row: PendingAttachment, _path: string) => 1)

beforeEach(async () => {
  db = new OfflineDatabase(`test-${Math.random().toString(36).slice(2)}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

// ---------------------------------------------------------------------------
// OFF-09 · Rien ne disparaît
// ---------------------------------------------------------------------------

describe('OFF-09 · aucun justificatif n’est jeté', () => {
  it('le fichier survit à des échecs répétés', async () => {
    await queueAttachment(ticket(), db)

    const failing = vi.fn(async () => {
      throw new Error('Réseau indisponible')
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const report = await flushAttachments(failing, bindOk(), { db })
      expect(report.dropped).toBe(0)
    }

    const rows = await db.attachments.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.attempts).toBe(5)

    // Les octets eux-mêmes sont intacts, pas seulement la ligne de suivi : une
    // file qui conserve des enregistrements vides ne conserve rien. C'est
    // exactement ce qui arrivait quand les octets vivaient dans la ligne mise à
    // jour à chaque tentative.
    const content = await attachmentContent(rows[0]!.id, db)
    expect(new Uint8Array(content!)).toEqual(JPEG_BYTES)
  })

  it('un rattachement définitivement refusé garde quand même les octets', async () => {
    await queueAttachment(ticket(), db)
    // Contournement de la liste blanche après coup : c'est exactement ce que la
    // seconde vérification, à l'envoi, doit intercepter.
    await db.attachments.toCollection().modify((row) => {
      row.binding = { ...row.binding, column: 'amount' }
    })

    const upload = uploadOk()
    const report = await flushAttachments(upload, bindOk(), { db })

    expect(report.failed).toBe(1)
    expect(report.dropped).toBe(0)
    expect(upload).not.toHaveBeenCalled()

    const rows = await db.attachments.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.lastError).toMatch(/non autorisée/)
  })

  it('refuse dès la mise en file un rattachement hors liste blanche', async () => {
    await expect(
      queueAttachment(ticket({ binding: { ...purchaseBinding, column: 'amount' } }), db),
    ).rejects.toThrow(/non autorisée/)

    expect(await db.attachments.count()).toBe(0)
    const journal = await db.journal.where('event').equals('attachment_rejected').toArray()
    expect(journal).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// OFF-10 · Octets d'abord, chemin ensuite
// ---------------------------------------------------------------------------

describe('OFF-10 · le chemin n’est écrit qu’après les octets', () => {
  it('n’écrit aucun chemin si le téléversement échoue', async () => {
    await queueAttachment(ticket(), db)

    const bind = bindOk()
    await flushAttachments(
      async () => {
        throw new Error('Failed to fetch')
      },
      bind,
      { db },
    )

    expect(bind).not.toHaveBeenCalled()
  })

  it('écrit le chemin dans la colonne visée une fois les octets rangés', async () => {
    await queueAttachment(ticket(), db)

    const upload = uploadOk()
    const bind = bindOk()
    const report = await flushAttachments(upload, bind, { db })

    expect(report.bound).toBe(1)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(bind).toHaveBeenCalledTimes(1)
    expect(bind.mock.calls[0]![1]).toMatch(/purchases\.proof_path/)

    const row = await attachmentsFor(purchaseBinding, db)
    expect(row?.status).toBe('sent')
    expect(row?.storedPath).not.toBeNull()
  })

  it('ne re-téléverse pas des octets déjà rangés quand seul le rattachement a échoué', async () => {
    await queueAttachment(ticket(), db)

    const upload = uploadOk()
    // Première passe : les octets partent, la ligne métier n'existe pas encore.
    await flushAttachments(upload, async () => 0, { db })
    expect(upload).toHaveBeenCalledTimes(1)

    // Seconde passe : l'achat est arrivé entre-temps.
    const bind = bindOk()
    const report = await flushAttachments(upload, bind, { db })

    expect(upload).toHaveBeenCalledTimes(1) // pas de second envoi sur le forfait du pisteur
    expect(report.bound).toBe(1)
    expect(bind).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// OFF-11 · L'ordre d'arrivée n'est pas une erreur
// ---------------------------------------------------------------------------

describe('OFF-11 · photo arrivée avant son opération', () => {
  it('retente au lieu d’abandonner quand aucune ligne n’est touchée', async () => {
    await queueAttachment(ticket(), db)

    const report = await flushAttachments(uploadOk(), async () => 0, { db })

    expect(report.failed).toBe(1)
    const row = await attachmentsFor(purchaseBinding, db)
    expect(row?.status).toBe('failed')
    expect(row?.lastError).toMatch(/pas encore synchronisée/)

    // `failed` reste renvoyable : la file la reprend au tour suivant.
    expect(await pendingAttachments(db)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// OFF-12 · Un emplacement, un fichier
// ---------------------------------------------------------------------------

describe('OFF-12 · re-photographier remplace au lieu d’accumuler', () => {
  it('garde un seul fichier par emplacement et journalise le remplacement', async () => {
    await queueAttachment(ticket(), db)
    const second = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02, 0x03])
    await queueAttachment(ticket({ content: second.slice().buffer }), db)

    expect(await db.attachments.count()).toBe(1)
    // C'est bien la nouvelle photo qui reste, pas l'ancienne.
    const kept = await db.attachments.toArray()
    expect(new Uint8Array((await attachmentContent(kept[0]!.id, db))!)).toEqual(second)
    const replaced = await db.journal.where('event').equals('attachment_replaced').toArray()
    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.detail).toMatch(/remplacé/)
  })

  it('sépare le ticket de départ de celui de réception', async () => {
    const transfer = { table: 'transfers' as const, rowId: 'transfer-1' }
    await queueAttachment(
      ticket({
        kind: 'ticket_pesee',
        binding: { ...transfer, column: 'weighing_ticket_path' },
      }),
      db,
    )
    await queueAttachment(
      ticket({
        kind: 'ticket_pesee',
        binding: { ...transfer, column: 'reception_ticket_path' },
      }),
      db,
    )

    expect(await db.attachments.count()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// OFF-13 · Comptes et intégrité
// ---------------------------------------------------------------------------

describe('OFF-13 · état de la file', () => {
  it('compte les justificatifs par statut', async () => {
    await queueAttachment(ticket(), db)
    await queueAttachment(ticket({ binding: { ...purchaseBinding, rowId: 'purchase-2' } }), db)

    expect(await attachmentCounts(db)).toEqual({ pending: 2, sending: 0, sent: 0, failed: 0 })

    await flushAttachments(uploadOk(), bindOk(), { db })
    expect(await attachmentCounts(db)).toEqual({ pending: 0, sending: 0, sent: 2, failed: 0 })
  })

  it('constate qu’aucun fichier mis en file n’a disparu', async () => {
    await queueAttachment(ticket(), db)
    await queueAttachment(ticket({ binding: { ...purchaseBinding, rowId: 'purchase-2' } }), db)

    const integrity = await verifyAttachmentIntegrity(db)
    expect(integrity).toMatchObject({ queued: 2, stored: 2, intact: true })
    expect(integrity.missing).toEqual([])
  })

  it('signale une ligne de suivi dont les octets ont disparu', async () => {
    await queueAttachment(ticket(), db)
    await db.attachmentContent.clear()

    const integrity = await verifyAttachmentIntegrity(db)
    expect(integrity.intact).toBe(false)
    expect(integrity.emptied).toHaveLength(1)
  })

  it('refuse d’envoyer un justificatif vidé plutôt que d’envoyer du vide', async () => {
    await queueAttachment(ticket(), db)
    await db.attachmentContent.clear()

    const upload = uploadOk()
    const bind = bindOk()
    const report = await flushAttachments(upload, bind, { db })

    expect(upload).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
    expect(report.failed).toBe(1)

    const row = await attachmentsFor(purchaseBinding, db)
    expect(row?.lastError).toMatch(/re-photographiez/)
    // Réessai arrêté : insister enverrait indéfiniment un fichier inexistant.
    expect(await pendingAttachments(db)).toHaveLength(1)
    const nextRound = await flushAttachments(upload, bind, { db })
    expect(nextRound.attempted).toBe(0)
  })

  it('signale la disparition d’un fichier au lieu de la taire', async () => {
    await queueAttachment(ticket(), db)
    // Aucune API de l'application ne fait cela : on simule une base corrompue.
    await db.attachments.clear()

    const integrity = await verifyAttachmentIntegrity(db)
    expect(integrity.intact).toBe(false)
    expect(integrity.missing).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// OFF-14 · La file n'est pas bornée
// ---------------------------------------------------------------------------

describe('OFF-14 · aucune limite de file', () => {
  it('conserve plus de 300 justificatifs', async () => {
    for (let index = 0; index < 320; index += 1) {
      await queueAttachment(
        ticket({ binding: { ...purchaseBinding, rowId: `purchase-${index}` } }),
        db,
      )
    }

    expect(await db.attachments.count()).toBe(320)
    expect(await pendingAttachments(db)).toHaveLength(320)
    // `batchSize` borne un LOT d'envoi, jamais la file elle-même.
    expect(await pendingAttachments(db, 25)).toHaveLength(25)
  })
})
