import { Paperclip, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { UPLOAD_POLICIES, type UploadKind } from '@/domain/uploads'
import { signedUrl, uploadProof } from '@/lib/storage/upload'

interface ProofUploadProps {
  kind: UploadKind
  tenantId: string | null
  entityId: string
  /** Chemin déjà enregistré, s'il existe. */
  value: string | null
  onChange: (path: string | null) => void
  label?: string
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.round(bytes / 1024)} ko`
}

/**
 * Dépôt d'un justificatif.
 *
 * Trois choix visibles à l'usage :
 *
 *  · **Le contrôle est fait avant l'envoi.** Un pisteur en 2G ne doit pas
 *    attendre quarante secondes pour apprendre que son fichier était trop gros.
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
  tenantId,
  entityId,
  value,
  onChange,
  label,
}: ProofUploadProps) {
  const policy = UPLOAD_POLICIES[kind]
  const inputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setSaved(null)

    if (!tenantId) {
      setError('Entreprise non résolue : reconnectez-vous.')
      return
    }

    setBusy(true)
    try {
      const result = await uploadProof({ file, kind, tenantId, entityId })
      onChange(result.path)
      setSaved(result.savedBytes)
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

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label ?? policy.label}</p>

      {value === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={`proof-${kind}-${entityId}`}
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
