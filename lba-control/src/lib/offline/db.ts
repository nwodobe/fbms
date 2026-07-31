import Dexie, { type Table } from 'dexie'
import type { AttachmentBinding, AttachmentStatus } from '@/domain/attachments'
import type { UploadKind } from '@/domain/uploads'

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

/**
 * Justificatif photographié hors réseau.
 *
 * Les octets attendent ici, sur l'appareil, jusqu'à pouvoir partir. Deux
 * conséquences assumées :
 *
 *  · le fichier n'est pas perdu parce que le pisteur était sous couverture 2G
 *    au moment de la pesée ;
 *
 *  · tant qu'il n'est pas parti, la ligne métier **n'a pas** de justificatif :
 *    `binding` n'est écrit qu'après le stockage réel des octets. Renseigner le
 *    chemin d'avance donnerait des preuves fantômes, et un contrôleur
 *    ouvrirait un lien mort.
 */
export interface PendingAttachment {
  /** `table.colonne#ligne` : l'emplacement visé est l'identité de l'entrée. */
  id: string
  tenantId: string
  userId: string
  deviceId: string
  kind: UploadKind
  binding: AttachmentBinding
  mimeType: string
  /** Taille des octets rangés à côté, dans `attachmentContent`. */
  bytes: number
  status: AttachmentStatus
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
  createdAtDevice: string
  sentAt: string | null
  /** Chemin dans le bucket, connu seulement une fois les octets stockés. */
  storedPath: string | null
}

/**
 * Les octets d'un justificatif, rangés à part et écrits une seule fois.
 *
 * Ce magasin séparé n'est pas une élégance : c'est une correction. Tant que les
 * octets vivaient dans la ligne de suivi, chaque changement de statut passait
 * par `Table.update`, et le tampon n'y survivait pas — la ligne restait, le
 * fichier devenait vide. Une file qui conserve des enregistrements sans contenu
 * ne conserve rien, et le constat n'aurait été fait qu'au moment du contrôle.
 *
 * Ici, la ligne de suivi change autant qu'elle veut ; les octets, jamais.
 *
 * Le tampon est brut plutôt qu'un `Blob` pour la même raison : la survie d'un
 * `Blob` au clonage structuré dépend de l'implémentation d'IndexedDB. Le `Blob`
 * est reconstruit au moment de l'envoi, à partir du type conservé sur la ligne.
 */
export interface AttachmentContent {
  /** Même identifiant que la ligne de suivi. */
  id: string
  content: ArrayBuffer
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
    | 'attachment_queued'
    | 'attachment_replaced'
    | 'attachment_uploaded'
    | 'attachment_bound'
    | 'attachment_failed'
    | 'attachment_rejected'
  detail: string | null
}

export class OfflineDatabase extends Dexie {
  operations!: Table<QueuedOperation, string>
  journal!: Table<SyncJournalEntry, number>
  attachments!: Table<PendingAttachment, string>
  attachmentContent!: Table<AttachmentContent, string>

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
    // La version 2 ajoute la file des justificatifs. Les deux magasins
    // existants sont redéclarés à l'identique : Dexie migre les bases déjà
    // installées sur les appareils sans rien effacer.
    this.version(2).stores({
      operations: 'id, status, entityType, createdAtDevice, [status+createdAtDevice]',
      journal: '++id, operationId, at, event',
      attachments: 'id, status, createdAtDevice, [status+createdAtDevice]',
      attachmentContent: 'id',
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
