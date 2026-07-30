import type { OfflineDatabase, QueuedOperation } from './db'
import { offlineDb } from './db'
import { markConflict, markFailed, markSynced, markSyncing, pendingOperations } from './queue'

/**
 * Moteur de synchronisation.
 *
 * Il ne connaît pas Supabase : il reçoit une fonction d'envoi. C'est ce qui
 * permet de le tester intégralement — y compris les échecs, les rejeux et les
 * conflits — sans réseau ni base.
 */

export type PushOutcome =
  | { kind: 'synced' }
  /** Le serveur avait déjà la ligne : l'idempotence a joué, ce n'est pas une erreur. */
  | { kind: 'already_present' }
  | { kind: 'conflict'; conflictKind: 'duplicate_probable' | 'version_mismatch' | 'rejected_by_server'; message: string; serverValue?: unknown }
  | { kind: 'error'; message: string; retryable: boolean }

export type PushFunction = (operation: QueuedOperation) => Promise<PushOutcome>

export interface SyncReport {
  attempted: number
  synced: number
  alreadyPresent: number
  failed: number
  conflicts: number
  /** Aucune opération n'est jamais perdue : ce compteur doit rester à zéro. */
  dropped: 0
}

export interface SyncOptions {
  /** Taille d'un lot d'envoi. Ne borne PAS la file, seulement chaque passage. */
  batchSize?: number
  /** Au-delà, l'opération reste en file mais n'est plus retentée automatiquement. */
  maxAttempts?: number
  db?: OfflineDatabase
  signal?: AbortSignal
}

export const DEFAULT_MAX_ATTEMPTS = 8

/** Report exponentiel plafonné, pour ne pas marteler un réseau déjà faible. */
export function backoffDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 2 ** Math.max(0, attempts) * 1_000)
}

/**
 * Une opération ayant épuisé ses tentatives reste dans la file et reste
 * visible : elle attend une action humaine, elle n'est pas abandonnée.
 */
export function isRetryable(operation: QueuedOperation, maxAttempts: number): boolean {
  return operation.attempts < maxAttempts
}

export async function synchronize(
  push: PushFunction,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const db = options.db ?? offlineDb()
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  const queue = await pendingOperations(db, options.batchSize)
  const report: SyncReport = {
    attempted: 0,
    synced: 0,
    alreadyPresent: 0,
    failed: 0,
    conflicts: 0,
    dropped: 0,
  }

  for (const operation of queue) {
    if (options.signal?.aborted) break
    if (!isRetryable(operation, maxAttempts)) continue

    report.attempted += 1
    await markSyncing(operation.id, db)

    let outcome: PushOutcome
    try {
      outcome = await push(operation)
    } catch (error) {
      outcome = {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      }
    }

    switch (outcome.kind) {
      case 'synced':
        await markSynced(operation.id, db)
        report.synced += 1
        break

      case 'already_present':
        // Rejeu d'une opération déjà reçue : succès, pas doublon.
        await markSynced(operation.id, db)
        report.alreadyPresent += 1
        break

      case 'conflict':
        await markConflict(
          operation.id,
          {
            detectedAt: new Date().toISOString(),
            kind: outcome.conflictKind,
            message: outcome.message,
            ...(outcome.serverValue !== undefined ? { serverValue: outcome.serverValue } : {}),
          },
          db,
        )
        report.conflicts += 1
        break

      case 'error':
        await markFailed(operation.id, outcome.message, db)
        report.failed += 1
        break
    }
  }

  return report
}

/**
 * Vérification d'intégrité de la file.
 *
 * Compare le nombre d'opérations enfilées d'après le journal au nombre
 * réellement présent. Tout écart signifie qu'une saisie terrain a disparu —
 * ce qui ne doit jamais arriver, et doit être constatable si cela arrive.
 */
export async function verifyQueueIntegrity(
  db: OfflineDatabase = offlineDb(),
): Promise<{ queued: number; stored: number; missing: string[]; intact: boolean }> {
  const journalEntries = await db.journal.where('event').equals('queued').toArray()
  const queuedIds = [...new Set(journalEntries.map((entry) => entry.operationId))]
  const stored = await db.operations.toArray()
  const storedIds = new Set(stored.map((row) => row.id))
  const missing = queuedIds.filter((id) => !storedIds.has(id))

  return {
    queued: queuedIds.length,
    stored: stored.length,
    missing,
    intact: missing.length === 0,
  }
}
