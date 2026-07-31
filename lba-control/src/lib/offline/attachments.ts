/**
 * File locale des justificatifs.
 *
 * Même contrat que la file des opérations, pour la même raison : une photo de
 * ticket prise à midi dans un village sans réseau doit arriver au bureau, quel
 * que soit le moment où le réseau revient.
 *
 * Deux différences avec la file des opérations, toutes deux délibérées :
 *
 *  · **L'emplacement visé est la clé.** Re-photographier le même ticket
 *    remplace le fichier en attente pour cet emplacement au lieu d'en
 *    accumuler deux dont personne ne saura lequel fait foi. Le remplacement est
 *    journalisé — rien ne disparaît en silence.
 *
 *  · **L'envoi se fait en deux temps, dans cet ordre.** D'abord les octets dans
 *    le bucket, ensuite le chemin dans la ligne métier. L'ordre inverse
 *    produirait des `proof_path` renseignés pointant sur rien : une dépense
 *    passerait le contrôle du seuil de justificatif sans pièce jointe.
 */

import {
  bindingKey,
  checkBinding,
  countAttachments,
  isAttachmentRetryable,
  type AttachmentBinding,
  type AttachmentCounts,
} from '@/domain/attachments'
import type { UploadKind } from '@/domain/uploads'
import { offlineDb, type OfflineDatabase, type PendingAttachment, type SyncJournalEntry } from './db'

async function journal(
  db: OfflineDatabase,
  entry: Omit<SyncJournalEntry, 'id' | 'at'>,
): Promise<void> {
  await db.journal.add({ ...entry, at: new Date().toISOString() })
}

export interface QueueAttachmentInput {
  tenantId: string
  userId: string
  deviceId: string
  kind: UploadKind
  binding: AttachmentBinding
  content: ArrayBuffer
  mimeType: string
}

/** Reconstruit le fichier à envoyer à partir des octets conservés. */
export function attachmentBlob(row: PendingAttachment, content: ArrayBuffer): Blob {
  return new Blob([content], { type: row.mimeType })
}

/** Octets d'un justificatif en attente, ou `undefined` s'ils ont disparu. */
export async function attachmentContent(
  id: string,
  db: OfflineDatabase = offlineDb(),
): Promise<ArrayBuffer | undefined> {
  return (await db.attachmentContent.get(id))?.content
}

/**
 * Met un justificatif en attente d'envoi.
 *
 * Le rattachement est validé ici **et** de nouveau à l'envoi : entre les deux,
 * l'entrée séjourne dans une base locale que l'application ne contrôle pas.
 */
export async function queueAttachment(
  input: QueueAttachmentInput,
  db: OfflineDatabase = offlineDb(),
): Promise<PendingAttachment> {
  const verdict = checkBinding(input.kind, input.binding)
  if (!verdict.allowed) {
    await journal(db, {
      operationId: bindingKey(input.binding),
      event: 'attachment_rejected',
      detail: verdict.reason,
    })
    throw new Error(verdict.reason ?? 'Rattachement refusé.')
  }

  const id = bindingKey(input.binding)
  const existing = await db.attachments.get(id)

  const row: PendingAttachment = {
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId,
    kind: input.kind,
    binding: input.binding,
    mimeType: input.mimeType,
    bytes: input.content.byteLength,
    status: 'pending',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAtDevice: existing?.createdAtDevice ?? new Date().toISOString(),
    sentAt: null,
    storedPath: null,
  }

  // Les octets d'abord : une ligne de suivi sans contenu ferait croire à un
  // justificatif en attente qui n'existe pas.
  await db.attachmentContent.put({ id, content: input.content })
  await db.attachments.put(row)
  await journal(db, {
    operationId: id,
    event: existing ? 'attachment_replaced' : 'attachment_queued',
    detail: existing
      ? `Fichier remplacé pour le même emplacement (${input.content.byteLength} octets).`
      : `${input.kind} en attente d'envoi (${input.content.byteLength} octets).`,
  })

  return row
}

/** Justificatifs restant à envoyer, dans l'ordre où ils ont été pris. */
export async function pendingAttachments(
  db: OfflineDatabase = offlineDb(),
  limit?: number,
): Promise<PendingAttachment[]> {
  const rows = await db.attachments
    .where('status')
    .anyOf('pending', 'failed')
    .sortBy('createdAtDevice')

  return limit === undefined ? rows : rows.slice(0, limit)
}

export async function attachmentCounts(
  db: OfflineDatabase = offlineDb(),
): Promise<AttachmentCounts> {
  return countAttachments(await db.attachments.toArray())
}

export async function attachmentsFor(
  binding: AttachmentBinding,
  db: OfflineDatabase = offlineDb(),
): Promise<PendingAttachment | undefined> {
  return db.attachments.get(bindingKey(binding))
}

// ---------------------------------------------------------------------------
// Moteur d'envoi
// ---------------------------------------------------------------------------

export type AttachmentOutcome =
  | { kind: 'bound'; path: string }
  | { kind: 'error'; message: string; retryable: boolean }

/** Range les octets dans le bucket et renvoie leur chemin. */
export type UploadBytes = (row: PendingAttachment, content: ArrayBuffer) => Promise<string>

/** Écrit le chemin dans la ligne métier. Renvoie le nombre de lignes touchées. */
export type BindPath = (row: PendingAttachment, path: string) => Promise<number>

export interface FlushReport {
  attempted: number
  bound: number
  failed: number
  /** Aucun justificatif n'est jamais jeté : ce compteur doit rester à zéro. */
  dropped: 0
}

export interface FlushOptions {
  batchSize?: number
  maxAttempts?: number
  db?: OfflineDatabase
  signal?: AbortSignal
}

export const DEFAULT_ATTACHMENT_MAX_ATTEMPTS = 8

/**
 * Envoie les justificatifs en attente.
 *
 * Ne connaît ni Supabase ni Storage : il reçoit les deux écritures en
 * paramètre. C'est ce qui permet de tester l'ordre — octets d'abord, chemin
 * ensuite — et l'échec de chacune séparément, sans réseau.
 */
export async function flushAttachments(
  upload: UploadBytes,
  bind: BindPath,
  options: FlushOptions = {},
): Promise<FlushReport> {
  const db = options.db ?? offlineDb()
  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTACHMENT_MAX_ATTEMPTS
  const queue = await pendingAttachments(db, options.batchSize)

  const report: FlushReport = { attempted: 0, bound: 0, failed: 0, dropped: 0 }

  for (const row of queue) {
    if (options.signal?.aborted) break
    if (row.attempts >= maxAttempts) continue

    report.attempted += 1
    await db.attachments.update(row.id, {
      status: 'sending',
      lastAttemptAt: new Date().toISOString(),
    })

    const outcome = await sendOne(row, upload, bind, db)

    if (outcome.kind === 'bound') {
      await db.attachments.update(row.id, {
        status: 'sent',
        sentAt: new Date().toISOString(),
        storedPath: outcome.path,
        lastError: null,
      })
      await journal(db, {
        operationId: row.id,
        event: 'attachment_bound',
        detail: `Justificatif rattaché à ${row.binding.table}.${row.binding.column}.`,
      })
      report.bound += 1
    } else {
      // Même définitivement refusé, le fichier reste en base : il est la preuve
      // que quelqu'un a bien photographié le ticket, et un humain doit pouvoir
      // le récupérer. Ce qui s'arrête, c'est le réessai — pas la conservation.
      await db.attachments.update(row.id, {
        status: 'failed',
        attempts: outcome.retryable ? row.attempts + 1 : maxAttempts,
        lastError: outcome.message,
      })
      await journal(db, {
        operationId: row.id,
        event: 'attachment_failed',
        detail: outcome.message,
      })
      report.failed += 1
    }
  }

  return report
}

async function sendOne(
  row: PendingAttachment,
  upload: UploadBytes,
  bind: BindPath,
  db: OfflineDatabase,
): Promise<AttachmentOutcome> {
  // Deuxième contrôle de la liste blanche : l'entrée a séjourné sur l'appareil.
  const verdict = checkBinding(row.kind, row.binding)
  if (!verdict.allowed) {
    return { kind: 'error', message: verdict.reason ?? 'Rattachement refusé.', retryable: false }
  }

  let path: string
  try {
    if (row.storedPath !== null) {
      // Un envoi déjà réussi n'est pas rejoué : seul le rattachement manquait.
      path = row.storedPath
    } else {
      const content = await attachmentContent(row.id, db)
      if (content === undefined || content.byteLength === 0) {
        // Les octets ont disparu de l'appareil. On ne bricole pas un envoi vide
        // qui ferait passer un contrôle : on le dit, définitivement.
        return {
          kind: 'error',
          message:
            'Les octets du justificatif ont disparu de cet appareil : re-photographiez le document.',
          retryable: false,
        }
      }
      path = await upload(row, content)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', message, retryable: isAttachmentRetryable(message) }
  }

  if (row.storedPath !== path) {
    // Mémorisé avant le rattachement : si celui-ci échoue, la prochaine
    // tentative ne re-téléverse pas les mêmes octets sur un forfait terrain.
    await db.attachments.update(row.id, { storedPath: path })
    await journal(db, {
      operationId: row.id,
      event: 'attachment_uploaded',
      detail: `Octets stockés (${row.bytes}). Reste le rattachement.`,
    })
  }

  try {
    const affected = await bind(row, path)
    if (affected === 0) {
      // Cas fréquent et normal : la photo est renvoyée avant l'achat auquel
      // elle se rapporte. Ce n'est pas une erreur, c'est un ordre d'arrivée.
      return {
        kind: 'error',
        message: 'Aucune ligne mise à jour : l’opération n’est pas encore synchronisée.',
        retryable: true,
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', message, retryable: isAttachmentRetryable(message) }
  }

  return { kind: 'bound', path }
}

/**
 * Vérification d'intégrité de la file des justificatifs.
 *
 * Même principe que pour les opérations : le journal dit combien de fichiers
 * ont été mis en attente, la file dit combien y sont encore. Tout écart
 * signifie qu'une preuve a disparu de l'appareil.
 */
export async function verifyAttachmentIntegrity(
  db: OfflineDatabase = offlineDb(),
): Promise<{
  queued: number
  stored: number
  missing: string[]
  /** Lignes de suivi dont les octets ont disparu : le cas le plus insidieux. */
  emptied: string[]
  intact: boolean
}> {
  const entries = await db.journal.where('event').equals('attachment_queued').toArray()
  const queuedIds = [...new Set(entries.map((entry) => entry.operationId))]
  const stored = await db.attachments.toArray()
  const storedIds = new Set(stored.map((row) => row.id))
  const missing = queuedIds.filter((id) => !storedIds.has(id))

  // Une ligne présente dont le contenu est vide est pire qu'une ligne absente :
  // l'interface annoncerait un justificatif en attente qui n'existe plus.
  const emptied: string[] = []
  for (const row of stored) {
    if (row.status === 'sent') continue
    const content = await db.attachmentContent.get(row.id)
    if (!content || content.content.byteLength === 0) emptied.push(row.id)
  }

  return {
    queued: queuedIds.length,
    stored: stored.length,
    missing,
    emptied,
    intact: missing.length === 0 && emptied.length === 0,
  }
}
