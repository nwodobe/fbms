/**
 * Téléversement des justificatifs vers Supabase Storage.
 *
 * Toutes les règles — types acceptés, tailles, chemins, dimensions cibles —
 * vivent dans `src/domain/uploads.ts` et y sont testées sans navigateur. Ce
 * fichier ne décide de rien : il lit les octets, compresse, envoie, et signe.
 *
 * Les buckets sont **privés**. Aucun objet n'a d'URL publique : la lecture
 * passe par un lien signé de courte durée, régénéré à chaque affichage. Un lien
 * permanent posté dans une conversation resterait valable indéfiniment.
 */

import {
  checkUpload,
  SIGNED_URL_TTL_SECONDS,
  storagePath,
  targetDimensions,
  UPLOAD_POLICIES,
  type UploadKind,
} from '@/domain/uploads'
import { supabase } from '@/lib/supabase'

export interface UploadResult {
  path: string
  bucket: string
  mimeType: string
  bytes: number
  /** Octets économisés par la compression, pour l'annoncer au pisteur. */
  savedBytes: number
}

/** Les premiers octets suffisent à identifier un format. */
async function readHead(file: File, length = 16): Promise<Uint8Array> {
  const slice = await file.slice(0, length).arrayBuffer()
  return new Uint8Array(slice)
}

/**
 * Compresse une image avant l'envoi.
 *
 * Une photo de ticket prise en 12 mégapixels pèse 5 Mo pour une information
 * lisible à 1600 pixels de large. La différence est payée par le pisteur, en
 * forfait et en attente. En cas d'échec — format exotique, canvas indisponible —
 * on renvoie le fichier d'origine plutôt que d'échouer : mieux vaut un envoi
 * lourd qu'un justificatif perdu.
 */
async function compressImage(file: File, kind: UploadKind): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file

  try {
    const bitmap = await createImageBitmap(file)
    const target = targetDimensions(bitmap.width, bitmap.height, kind)

    if (!target.shouldResize) {
      bitmap.close()
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height

    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }

    context.drawImage(bitmap, 0, 0, target.width, target.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    )

    // La compression n'est utile que si elle allège réellement.
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/**
 * Contrôle, compresse et téléverse un justificatif.
 *
 * Renvoie le chemin à stocker dans la ligne métier. Le chemin, pas l'URL :
 * une URL signée expire, et la ranger en base produirait des liens morts.
 */
export async function uploadProof(args: {
  file: File
  kind: UploadKind
  tenantId: string
  entityId: string
}): Promise<UploadResult> {
  const policy = UPLOAD_POLICIES[args.kind]

  const check = checkUpload(
    {
      name: args.file.name,
      declaredType: args.file.type,
      size: args.file.size,
      head: await readHead(args.file),
    },
    args.kind,
  )

  if (!check.accepted || check.detectedMimeType === null) {
    throw new Error(check.message)
  }

  const compressed = await compressImage(args.file, args.kind)
  // La compression produit du JPEG ; le type réel change donc avec elle.
  const mimeType = compressed === args.file ? check.detectedMimeType : 'image/jpeg'

  const path = storagePath({
    tenantId: args.tenantId,
    kind: args.kind,
    entityId: args.entityId,
    mimeType,
  })

  const { error } = await supabase.storage.from(policy.bucket).upload(path, compressed, {
    contentType: mimeType,
    // Un même justificatif re-téléversé remplace le précédent plutôt que
    // d'accumuler des variantes dont personne ne saura laquelle fait foi.
    upsert: true,
  })

  if (error) {
    throw new Error(`Le téléversement a échoué : ${error.message}`)
  }

  return {
    path,
    bucket: policy.bucket,
    mimeType,
    bytes: compressed.size,
    savedBytes: Math.max(0, args.file.size - compressed.size),
  }
}

/**
 * Lien de consultation, valable quelques minutes.
 *
 * Régénéré à chaque affichage plutôt que stocké : un lien qui traîne dans un
 * historique de navigation ou une conversation est un lien qui fuit.
 */
export async function signedUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error || !data) {
    throw new Error(`Lien de consultation indisponible : ${error?.message ?? 'erreur inconnue'}`)
  }

  return data.signedUrl
}
