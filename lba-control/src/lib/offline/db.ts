import Dexie, { type Table } from 'dexie'

/**
 * File d'attente locale (IndexedDB).
 *
 * Contrat non négociable, repris mot pour mot du cahier des charges :
 *
 *  · une opération `pending` n'est **JAMAIS** supprimée, quel qu'en soit le
 *    motif — ni purge, ni quota, ni nettoyage ;
 *  · la file est **non bornée** : aucune limite à 300 opérations ni ailleurs ;
 *  · la synchronisation est **idempotente** : l'UUID généré sur l'appareil est
 *    la clé, un rejeu ne crée rien ;
 *  · les conflits sont **affichés**, jamais résolus par écrasement silencieux ;
 *  · un journal local prouve qu'aucune opération n'a disparu.
 *
 * Le stockage local est un cache et une file de résilience. Il n'est jamais la
 * source de vérité (CDC §19).
 */

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export type OfflineEntity = 'purchase' | 'expense' | 'stock_movement'

export interface QueuedOperation {
  /** UUID généré sur l'appareil. Clé primaire ici ET côté serveur. */
  id: string
  tenantId: string
  userId: string
  deviceId: string
  entityType: OfflineEntity
  operation: 'insert' | 'update' | 'cancel'
  payload: Record<string, unknown>
  status: SyncStatus
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
  createdAtDevice: string
  syncedAt: string | null
  localVersion: number
  /** Conflit détecté au serveur : présenté à l'utilisateur, jamais écrasé. */
  conflict: ConflictDetails | null
}

export interface ConflictDetails {
  detectedAt: string
  kind: 'duplicate_probable' | 'version_mismatch' | 'rejected_by_server'
  message: string
  serverValue?: unknown
}

/** Journal : trace immuable de tout ce qui est arrivé à la file. */
export interface SyncJournalEntry {
  id?: number
  operationId: string
  at: string
  event:
    | 'queued'
    | 'attempt_started'
    | 'attempt_failed'
    | 'synced'
    | 'conflict_detected'
    | 'duplicate_skipped'
  detail: string | null
}

export class OfflineDatabase extends Dexie {
  operations!: Table<QueuedOperation, string>
  journal!: Table<SyncJournalEntry, number>

  constructor(name = 'lba-control-offline') {
    super(name)
    this.version(1).stores({
      // Index sur status et createdAtDevice : la file se lit toujours dans
      // l'ordre de saisie, jamais dans l'ordre d'insertion en base.
      operations: 'id, status, entityType, createdAtDevice, [status+createdAtDevice]',
      // `event` est indexé : la vérification d'intégrité interroge le journal
      // par type d'événement pour prouver qu'aucune saisie n'a disparu.
      journal: '++id, operationId, at, event',
    })
  }
}

let instance: OfflineDatabase | null = null

export function offlineDb(): OfflineDatabase {
  instance ??= new OfflineDatabase()
  return instance
}

/** Réservé aux tests : permet de repartir d'une base propre. */
export function __setOfflineDb(db: OfflineDatabase | null): void {
  instance = db
}
