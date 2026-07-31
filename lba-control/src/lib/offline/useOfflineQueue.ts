import { useCallback, useEffect, useState } from 'react'
import { keyColumnFor, type AttachmentCounts } from '@/domain/attachments'
import { storeBytes } from '@/lib/storage/upload'
import { supabase } from '@/lib/supabase'
import { entityIdFor } from '@/lib/storage/attach'
import {
  attachmentBlob,
  attachmentCounts,
  flushAttachments,
  type BindPath,
  type UploadBytes,
} from './attachments'
import { conflicts, countByStatus, pendingOperations } from './queue'
import { synchronize, type PushFunction, type SyncReport } from './sync'
import type { QueuedOperation } from './db'

/**
 * État de la file locale, exposé à l'interface.
 *
 * Il est délibérément visible en permanence sur les écrans terrain : un pisteur
 * doit savoir, sans avoir à demander, si ses saisies sont parties. Une icône
 * « tout va bien » qui ment est pire que pas d'icône du tout.
 */
export interface OfflineQueueState {
  pending: number
  syncing: number
  synced: number
  failed: number
  conflicts: QueuedOperation[]
  /** Justificatifs photographiés hors réseau, encore sur l'appareil. */
  attachments: AttachmentCounts
  isOnline: boolean
  isSyncing: boolean
  lastReport: SyncReport | null
  refresh: () => Promise<void>
  sync: () => Promise<void>
}

/** Range les octets d'un justificatif en attente dans son bucket. */
export const uploadAttachmentBytes: UploadBytes = (row, content) =>
  storeBytes({
    blob: attachmentBlob(row, content),
    mimeType: row.mimeType,
    kind: row.kind,
    tenantId: row.tenantId,
    entityId: entityIdFor(row.binding),
  })

/**
 * Écrit le chemin dans la ligne métier et renvoie le nombre de lignes touchées.
 *
 * Zéro ligne n'est pas traité comme un succès : cela signifie que l'opération à
 * laquelle le justificatif se rapporte n'est pas encore arrivée au serveur. Le
 * fichier reste alors en attente et repartira au tour suivant.
 */
export const bindAttachmentPath: BindPath = async (row, path) => {
  const { data, error } = await supabase
    .from(row.binding.table)
    .update({ [row.binding.column]: path } as never)
    .eq(keyColumnFor(row.binding.table), row.binding.rowId)
    .select('*')

  if (error) throw new Error(error.message)
  return (data ?? []).length
}

/** Envoi réel vers Supabase, avec traduction des refus en issues typées. */
export const pushToSupabase: PushFunction = async (operation) => {
  if (operation.entityType !== 'purchase' && operation.entityType !== 'expense') {
    return { kind: 'error', message: `Type non pris en charge : ${operation.entityType}`, retryable: false }
  }

  const table = operation.entityType === 'purchase' ? 'purchases' : 'expenses'
  const payload = { ...operation.payload, sync_status: 'synced' }

  const { error } = await supabase.from(table).insert(payload as never)

  if (!error) return { kind: 'synced' }

  // 23505 = violation d'unicité : la ligne est déjà arrivée lors d'un envoi
  // précédent. C'est exactement ce que l'idempotence doit produire.
  if (error.code === '23505') return { kind: 'already_present' }

  if (/row-level security|insufficient_privilege|révoqué/i.test(error.message)) {
    return {
      kind: 'conflict',
      conflictKind: 'rejected_by_server',
      message: `Refusé par le serveur : ${error.message}`,
    }
  }

  return { kind: 'error', message: error.message, retryable: true }
}

export function useOfflineQueue(autoSync = true): OfflineQueueState {
  const [counts, setCounts] = useState({ pending: 0, syncing: 0, synced: 0, failed: 0 })
  const [conflicted, setConflicted] = useState<QueuedOperation[]>([])
  const [attachments, setAttachments] = useState<AttachmentCounts>({
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
  })
  const [isOnline, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [isSyncing, setSyncing] = useState(false)
  const [lastReport, setLastReport] = useState<SyncReport | null>(null)

  const refresh = useCallback(async () => {
    setCounts(await countByStatus())
    setConflicted(await conflicts())
    setAttachments(await attachmentCounts())
  }, [])

  const sync = useCallback(async () => {
    if (!navigator.onLine) return
    setSyncing(true)
    try {
      const report = await synchronize(pushToSupabase)
      setLastReport(report)
      // Les justificatifs partent APRÈS les opérations : un ticket ne peut pas
      // se rattacher à un achat que le serveur n'a pas encore reçu.
      await flushAttachments(uploadAttachmentBytes, bindAttachmentPath)
    } finally {
      setSyncing(false)
      await refresh()
    }
  }, [refresh])

  useEffect(() => {
    void refresh()

    const goOnline = () => {
      setOnline(true)
      // Le retour du réseau déclenche l'envoi : le pisteur n'a rien à faire.
      if (autoSync) void sync()
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [autoSync, refresh, sync])

  return {
    ...counts,
    conflicts: conflicted,
    attachments,
    isOnline,
    isSyncing,
    lastReport,
    refresh,
    sync,
  }
}

/** Identifiant d'appareil, stable et persisté localement. */
export function deviceId(): string {
  const key = 'lba-control-device-id'
  if (typeof localStorage === 'undefined') return 'device-inconnu'

  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

export async function pendingCount(): Promise<number> {
  return (await pendingOperations()).length
}
