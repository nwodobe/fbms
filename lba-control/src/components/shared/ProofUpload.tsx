import { Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AttachmentBinding } from '@/domain/attachments'
import { UPLOAD_POLICIES, type UploadKind } from '@/domain/uploads'
import { useSession } from '@/lib/auth/session'
import { attachmentsFor } from '@/lib/offline/attachments'
import { deviceId } from '@/lib/offline/useOfflineQueue'
import { attachProof } from '@/lib/storage/attach'
import { signedUrl } from '@/lib/storage/upload'

interface ProofUploadProps {
  kind: UploadKind
  /** Emplacement métier visé : table, colonne et ligne. */
  binding: AttachmentBinding
  /** Chemin déjà enregistré, s'il existe. */
  value: string | null
  onChange: (path: string | null) => void
  label?: string
  /** Annonce que le fichier attend sur l'appareil, sans chemin à enregistrer. */
  onQueued?: (reason: string) => void
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.round(bytes / 1024)} ko`
}

/**
 * Dépôt d'un justificatif.
 *
 * Quatre choix visibles à l'usage :
 *
 *  · **Le contrôle est fait avant l'envoi.** Un pisteur en 2G ne doit pas
 *    attendre quarante secondes pour apprendre que son fichier était trop gros.
 *
 *  · **Hors réseau, le fichier est conservé sur l'appareil** et repart tout
 *    seul ensuite. Il n'est pas annoncé comme joint pour autant : tant que les
 *    octets ne sont pas arrivés, l'opération n'a pas de justificatif, et le dire
 *    autrement ferait passer un contrôle sur une preuve inexistante.
 *
 *  · **La compression est annoncée.** « 4,2 Mo économisés » explique pourquoi
 *    l'envoi a été rapide, et rassure sur le fait que la photo a bien été
 *    transmise.
 *
 *  · **Le lien de consultation est régénéré à chaque ouverture**, valable
 *    quelques minutes. Aucune URL permanente n'est stockée ni affichée : un
 *    lien qui traîne dans un historique est un lien qui fuit.
 */
export function ProofUpload({
  kind,
  binding,
  value,
  onChange,
  label,
  onQueued,
}: ProofUploadProps) {
  const policy = UPLOAD_POLICIES[kind]
  const { tenantId, user } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null)

  // Un fichier déjà en attente pour cet emplacement doit rester visible : sans
  // cela, l'utilisateur croirait n'avoir rien joint et re-photographierait.
  useEffect(() => {
    let cancelled = false
    void attachmentsFor(binding)
      .then((row) => {
        if (cancelled || !row || row.status === 'sent') return
        setWaiting('Conservé sur cet appareil, en attente d’envoi.')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.table, binding.column, binding.rowId])

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setSaved(null)
    setWaiting(null)

    if (!tenantId || !user) {
      setError('Entreprise non résolue : reconnectez-vous.')
      return
    }

    setBusy(true)
    try {
      const result = await attachProof({
        file,
        kind,
        binding,
        tenantId,
        userId: user.id,
        deviceId: deviceId(),
        isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      })

      setSaved(result.savedBytes)

      if (result.queued) {
        setWaiting(
          `${result.reason}. Le fichier est conservé sur cet appareil et sera rattaché au retour du réseau.`,
        )
        onQueued?.(result.reason)
      } else {
        onChange(result.path)
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Téléversement impossible.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function open() {
    if (!value) return
    setError(null)
    try {
      const url = await signedUrl(policy.bucket, value)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Lien indisponible.')
    }
  }

  const inputId = `proof-${binding.table}-${binding.column}-${binding.rowId}`

  return (
    <div className="space-y-2" data-testid={`proof-${binding.column}`}>
      <p className="text-sm font-medium">{label ?? policy.label}</p>

      {value === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            data-testid={`proof-input-${binding.column}`}
            type="file"
            className="sr-only"
            accept={policy.mimeTypes.join(',')}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip size={16} />
            {busy ? 'Envoi…' : 'Joindre un fichier'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {policy.mimeTypes.map((type) => type.split('/')[1]?.toUpperCase()).join(', ')} ·{' '}
            {formatSize(policy.maxBytes)} maximum
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void open()}>
            <Paperclip size={16} />
            Consulter le justificatif
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X size={14} />
            Retirer
          </Button>
          <span className="font-mono text-xs text-muted-foreground">{value.split('/').pop()}</span>
        </div>
      )}

      {waiting && (
        <p role="status" className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
          {waiting}
        </p>
      )}

      {saved !== null && saved > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Image réduite avant l’envoi : {formatSize(saved)} économisés sur votre forfait.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
