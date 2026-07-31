/**
 * Récupération du logo du client pour les documents exportés.
 *
 * Ce module ne décide de rien : les règles — formats, boîte, poids, messages —
 * vivent dans `src/domain/brandmark.ts` et y sont testées sans navigateur. Ici,
 * on va chercher les octets, on convertit si nécessaire, et **on n'échoue
 * jamais** : toute difficulté se traduit par un logo absent et une raison, pas
 * par une exception qui ferait perdre le document à l'utilisateur.
 */

import {
  fitLogo,
  isEmbeddable,
  isTooLarge,
  needsRasterisation,
  type LogoBox,
  type LogoFailure,
} from '@/domain/brandmark'
import { UPLOAD_POLICIES } from '@/domain/uploads'
import { signedUrl } from '@/lib/storage/upload'

export interface ExportLogo {
  /** Image encodée en base64, prête à être incorporée. */
  dataUrl: string
  format: 'PNG' | 'JPEG'
  /** Dimensions en millimètres, déjà mises à l'échelle pour l'en-tête. */
  box: LogoBox
  /** Dimensions en pixels, utiles au placement dans un tableur. */
  natural: { width: number; height: number }
}

export type LogoOutcome =
  | { logo: ExportLogo; failure: null }
  | { logo: null; failure: LogoFailure }

/** Mesure une image sans la dessiner. */
function measure(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Image illisible.'))
    image.src = source
  })
}

/**
 * Convertit une image en PNG par le canevas.
 *
 * Nécessaire pour le SVG et le WebP, que jsPDF n'incorpore pas. Le SVG est
 * dessiné depuis une URL d'objet locale : le canevas n'est donc pas contaminé
 * et les octets restent extractibles.
 */
async function rasterise(blob: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image illisible.'))
      image.src = objectUrl
    })

    // Un SVG sans dimensions intrinsèques mesure 0 : on lui en donne, sinon le
    // canevas produirait une image vide sans le signaler.
    const width = image.naturalWidth || 512
    const height = image.naturalHeight || 512

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canevas indisponible.')
    context.drawImage(image, 0, 0, width, height)

    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Lecture impossible.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Charge le logo du tenant, prêt à être posé dans un document.
 *
 * Renvoie toujours un résultat : soit le logo, soit la raison de son absence.
 * Aucun appelant ne doit avoir à entourer cette fonction d'un `try`.
 */
export async function loadExportLogo(logoPath: string | null): Promise<LogoOutcome> {
  if (!logoPath) return { logo: null, failure: 'absent' }

  let blob: Blob
  try {
    const url = await signedUrl(UPLOAD_POLICIES.logo.bucket, logoPath)
    const response = await fetch(url)
    if (!response.ok) return { logo: null, failure: 'reseau' }
    blob = await response.blob()
  } catch {
    return { logo: null, failure: 'reseau' }
  }

  if (isTooLarge(blob.size)) return { logo: null, failure: 'trop_grand' }

  const mimeType = blob.type || guessFromPath(logoPath)

  try {
    if (needsRasterisation(mimeType)) {
      const raster = await rasterise(blob)
      return {
        logo: {
          dataUrl: raster.dataUrl,
          format: 'PNG',
          box: fitLogo({ width: raster.width, height: raster.height }),
          natural: { width: raster.width, height: raster.height },
        },
        failure: null,
      }
    }

    if (!isEmbeddable(mimeType)) return { logo: null, failure: 'format_non_supporte' }

    const dataUrl = await toDataUrl(blob)
    const natural = await measure(dataUrl)

    return {
      logo: {
        dataUrl,
        format: mimeType === 'image/jpeg' ? 'JPEG' : 'PNG',
        box: fitLogo(natural),
        natural,
      },
      failure: null,
    }
  } catch {
    return { logo: null, failure: 'illisible' }
  }
}

/** Repli quand le stockage ne renvoie pas de type : l'extension du chemin. */
function guessFromPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[extension] ?? ''
  )
}
