import {
  offlineDb,
  type ConflictDetails,
  type OfflineDatabase,
  type OfflineEntity,
  type QueuedOperation,
  type SyncJournalEntry,
} from './db'

/**
 * Opérations sur la file locale.
 *
 * Aucune fonction de ce module ne supprime une opération `pending`. Il n'existe
 * volontairement aucune API de purge : ce qui n'existe pas ne peut pas être
 * appelé par erreur un vendredi soir sur le téléphone d'un pisteur.
 */

export interface EnqueueInput {
  id: string
  tenantId: string
  userId: string
  deviceId: string
  entityType: OfflineEntity
  operation?: 'insert' | 'update' | 'cancel'
  payload: Record<string, unknown>
  createdAtDevice?: string
}

async function journal(
  db: OfflineDatabase,
  entry: Omit<SyncJournalEntry, 'id' | 'at'> & { at?: string },
): Promise<void> {
  await db.journal.add({
    operationId: entry.operationId,
    event: entry.event,
    detail: entry.detail,
    at: entry.at ?? new Date().toISOString(),
  })
}

/**
 * Met une opération en file.
 *
 * Idempotent : ré-enfiler le même identifiant ne crée pas de doublon et
 * n'écrase pas une opération déjà synchronisée.
 */
export async function enqueue(
  input: EnqueueInput,
  db: OfflineDatabase = offlineDb(),
): Promise<QueuedOperation> {
  const existing = await db.operations.get(input.id)
  if (existing) {
    await journal(db, {
      operationId: input.id,
      event: 'duplicate_skipped',
      detail: 'Opération déjà présente dans la file locale.',
    })
    return existing
  }

  const operation: QueuedOperation = {
    id: input.id,
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId,
    entityType: input.entityType,
    operation: input.operation ?? 'insert',
    payload: input.payload,
    status: 'pending',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAtDevice: input.createdAtDevice ?? new Date().toISOString(),
    syncedAt: null,
    localVersion: 1,
    conflict: null,
  }

  await db.operations.add(operation)
  await journal(db, {
    operationId: operation.id,
    event: 'queued',
    detail: `${operation.entityType} en attente de synchronisation`,
  })

  return operation
}

/**
 * Opérations à envoyer, dans l'ordre de saisie sur le terrain.
 *
 * `limit` borne un LOT d'envoi, pas la file : la file elle-même n'a pas de
 * limite. Sans argument, tout est renvoyé.
 */
export async function pendingOperations(
  db: OfflineDatabase = offlineDb(),
  limit?: number,
): Promise<QueuedOperation[]> {
  const rows = await db.operations
    .where('status')
    .anyOf('pending', 'failed')
    .sortBy('createdAtDevice')

  return limit === undefined ? rows : rows.slice(0, limit)
}

export async function countByStatus(
  db: OfflineDatabase = offlineDb(),
): Promise<Record<QueuedOperation['status'], number>> {
  const all = await db.operations.toArray()
  const counts: Record<QueuedOperation['status'], number> = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
  }
  for (const row of all) counts[row.status] += 1
  return counts
}

export async function markSyncing(id: string, db: OfflineDatabase = offlineDb()): Promise<void> {
  const now = new Date().toISOString()
  await db.operations.update(id, { status: 'syncing', lastAttemptAt: now })
  await journal(db, { operationId: id, event: 'attempt_started', detail: null })
}

export async function markSynced(id: string, db: OfflineDatabase = offlineDb()): Promise<void> {
  const now = new Date().toISOString()
  // L'enregistrement reste en base après succès : il constitue la preuve que
  // la saisie du terrain est bien arrivée.
  await db.operations.update(id, { status: 'synced', syncedAt: now, lastError: null })
  await journal(db, { operationId: id, event: 'synced', detail: null })
}

export async function markFailed(
  id: string,
  error: string,
  db: OfflineDatabase = offlineDb(),
): Promise<void> {
  const operation = await db.operations.get(id)
  if (!operation) return

  await db.operations.update(id, {
    // On repasse en `failed`, jamais en supprimé : l'opération reste renvoyable.
    status: 'failed',
    attempts: operation.attempts + 1,
    lastError: error,
    lastAttemptAt: new Date().toISOString(),
  })
  await journal(db, { operationId: id, event: 'attempt_failed', detail: error })
}

/**
 * Enregistre un conflit.
 *
 * L'opération n'est ni supprimée ni écrasée : elle est marquée pour que
 * l'utilisateur décide. Un écrasement silencieux ferait disparaître soit la
 * saisie du terrain, soit la correction du bureau — sans que personne le sache.
 */
export async function markConflict(
  id: string,
  conflict: ConflictDetails,
  db: OfflineDatabase = offlineDb(),
): Promise<void> {
  await db.operations.update(id, { status: 'failed', conflict })
  await journal(db, {
    operationId: id,
    event: 'conflict_detected',
    detail: conflict.message,
  })
}

export async function conflicts(db: OfflineDatabase = offlineDb()): Promise<QueuedOperation[]> {
  return db.operations.filter((row) => row.conflict !== null).toArray()
}

/** Résolution explicite d'un conflit par l'utilisateur : renvoyer ou abandonner. */
export async function resolveConflict(
  id: string,
  decision: 'retry' | 'keep_server',
  db: OfflineDatabase = offlineDb(),
): Promise<void> {
  const operation = await db.operations.get(id)
  if (!operation) return

  if (decision === 'retry') {
    await db.operations.update(id, { status: 'pending', conflict: null, lastError: null })
  } else {
    // « Garder la version serveur » n'efface pas l'opération : elle est classée
    // comme synchronisée avec sa trace de conflit conservée.
    await db.operations.update(id, { status: 'synced', syncedAt: new Date().toISOString() })
  }

  await journal(db, {
    operationId: id,
    event: decision === 'retry' ? 'queued' : 'synced',
    detail: `Conflit résolu par l'utilisateur : ${decision}`,
  })
}

export async function journalFor(
  operationId: string,
  db: OfflineDatabase = offlineDb(),
): Promise<SyncJournalEntry[]> {
  return db.journal.where('operationId').equals(operationId).sortBy('at')
}

export async function fullJournal(db: OfflineDatabase = offlineDb()): Promise<SyncJournalEntry[]> {
  return db.journal.orderBy('at').toArray()
}
