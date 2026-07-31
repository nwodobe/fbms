/**
 * Règles de téléversement des justificatifs.
 *
 * Pures et testées séparément du navigateur, parce que ce sont des règles de
 * sécurité et de coût, pas des détails d'interface :
 *
 *  · **Le type est contrôlé par son contenu, pas par son nom.** Renommer
 *    `charge.exe` en `ticket.jpg` ne doit tromper personne. On lit les premiers
 *    octets — la signature du format — et on ignore l'extension.
 *
 *  · **La taille est bornée avant l'envoi.** Un pisteur en 2G qui paie son
 *    forfait au mégaoctet ne doit pas découvrir après quarante secondes que son
 *    fichier était trop gros.
 *
 *  · **Le chemin porte le tenant.** Un objet rangé sous `<tenant>/…` reste
 *    cloisonnable par politique de bucket ; un nom de fichier plat ne l'est pas.
 */

export type UploadKind = 'ticket_pesee' | 'justificatif_depense' | 'preuve_achat' | 'logo'

export interface UploadPolicy {
  bucket: string
  /** Types réellement acceptés, vérifiés par signature. */
  mimeTypes: readonly string[]
  maxBytes: number
  /** Largeur maximale après compression. Zéro = pas de compression. */
  maxWidth: number
  label: string
}

const MB = 1024 * 1024

export const UPLOAD_POLICIES: Record<UploadKind, UploadPolicy> = {
  ticket_pesee: {
    bucket: 'preuves',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    maxBytes: 8 * MB,
    maxWidth: 1600,
    label: 'Ticket de pesée',
  },
  justificatif_depense: {
    bucket: 'preuves',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    maxBytes: 8 * MB,
    maxWidth: 1600,
    label: 'Justificatif de dépense',
  },
  preuve_achat: {
    bucket: 'preuves',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    // Plus petit : ce sont les fichiers qu'un pisteur envoie depuis le terrain,
    // souvent en 2G et sur son propre forfait.
    maxBytes: 4 * MB,
    maxWidth: 1280,
    label: 'Preuve d’achat',
  },
  logo: {
    bucket: 'marque',
    mimeTypes: ['image/png', 'image/webp', 'image/svg+xml'],
    maxBytes: 1 * MB,
    maxWidth: 512,
    label: 'Logo',
  },
}

/**
 * Signatures de format, lues dans les premiers octets.
 *
 * L'extension et le `type` déclaré par le navigateur viennent tous deux du
 * client : ils se falsifient. Les octets, non.
 */
const SIGNATURES: Array<{ mime: string; test: (bytes: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mime: 'application/pdf',
    test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
]

/** Type réel d'un fichier, ou `null` si sa signature n'est pas reconnue. */
export function detectMimeType(bytes: Uint8Array): string | null {
  return SIGNATURES.find((signature) => signature.test(bytes))?.mime ?? null
}

export type UploadRejection =
  | 'type_non_autorise'
  | 'type_incoherent'
  | 'fichier_trop_gros'
  | 'fichier_vide'

export interface UploadCheck {
  accepted: boolean
  rejection: UploadRejection | null
  detectedMimeType: string | null
  message: string
}

export interface FileDescriptor {
  name: string
  /** Type annoncé par le navigateur. Indicatif : il vient du client. */
  declaredType: string
  size: number
  /** Premiers octets, pour la vérification de signature. */
  head: Uint8Array
}

export function checkUpload(file: FileDescriptor, kind: UploadKind): UploadCheck {
  const policy = UPLOAD_POLICIES[kind]

  if (file.size === 0) {
    return {
      accepted: false,
      rejection: 'fichier_vide',
      detectedMimeType: null,
      message: 'Le fichier est vide.',
    }
  }

  if (file.size > policy.maxBytes) {
    const limitMb = Math.round(policy.maxBytes / MB)
    return {
      accepted: false,
      rejection: 'fichier_trop_gros',
      detectedMimeType: null,
      message: `Fichier trop volumineux : ${(file.size / MB).toFixed(1)} Mo pour ${limitMb} Mo autorisés. Photographiez le document de plus près plutôt qu’en entier.`,
    }
  }

  // SVG n'a pas de signature binaire : il est traité à part et réservé aux
  // logos, téléversés par un administrateur, pas depuis le terrain.
  const isSvg = policy.mimeTypes.includes('image/svg+xml') && file.declaredType === 'image/svg+xml'
  const detected = isSvg ? 'image/svg+xml' : detectMimeType(file.head)

  if (detected === null) {
    return {
      accepted: false,
      rejection: 'type_non_autorise',
      detectedMimeType: null,
      message:
        'Format non reconnu. Les formats acceptés sont : ' +
        policy.mimeTypes.map(shortName).join(', ') + '.',
    }
  }

  if (!policy.mimeTypes.includes(detected)) {
    return {
      accepted: false,
      rejection: 'type_non_autorise',
      detectedMimeType: detected,
      message: `Format ${shortName(detected)} non accepté pour « ${policy.label} ». Formats acceptés : ${policy.mimeTypes.map(shortName).join(', ')}.`,
    }
  }

  if (file.declaredType !== '' && file.declaredType !== detected && !isSvg) {
    // Le fichier n'est pas ce qu'il prétend être. Ce n'est pas
    // nécessairement malveillant — un renommage manuel suffit — mais on ne
    // range pas dans un bucket un objet dont on ignore la nature.
    return {
      accepted: false,
      rejection: 'type_incoherent',
      detectedMimeType: detected,
      message: `Ce fichier est annoncé comme ${shortName(file.declaredType)} mais son contenu est ${shortName(detected)}. Vérifiez le fichier choisi.`,
    }
  }

  return {
    accepted: true,
    rejection: null,
    detectedMimeType: detected,
    message: `${shortName(detected)}, ${(file.size / 1024).toFixed(0)} ko.`,
  }
}

function shortName(mime: string): string {
  return (
    {
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/webp': 'WebP',
      'image/svg+xml': 'SVG',
      'application/pdf': 'PDF',
    }[mime] ?? mime
  )
}

/**
 * Chemin de rangement d'un objet.
 *
 * Le tenant est le premier segment : c'est lui qui rend le cloisonnement
 * applicable par politique de bucket. Le nom d'origine est écarté — il peut
 * contenir le nom d'un vendeur, une date, un montant, et se retrouverait dans
 * une URL partagée.
 */
export function storagePath(args: {
  tenantId: string
  kind: UploadKind
  entityId: string
  mimeType: string
  now?: Date
}): string {
  const extension =
    {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
    }[args.mimeType] ?? 'bin'

  const stamp = (args.now ?? new Date()).toISOString().slice(0, 10)
  return `${args.tenantId}/${args.kind}/${stamp}/${args.entityId}.${extension}`
}

/** Durée de validité d'un lien signé. Court : un lien qui traîne est un lien qui fuit. */
export const SIGNED_URL_TTL_SECONDS = 300

/**
 * Dimensions cibles après compression, en conservant les proportions.
 *
 * Une photo de ticket prise en 12 mégapixels pèse 5 Mo pour une information
 * lisible à 1600 pixels de large. La différence est payée par le pisteur, en
 * forfait et en attente.
 */
export function targetDimensions(
  width: number,
  height: number,
  kind: UploadKind,
): { width: number; height: number; shouldResize: boolean } {
  const maxWidth = UPLOAD_POLICIES[kind].maxWidth

  if (maxWidth === 0 || width <= maxWidth) {
    return { width, height, shouldResize: false }
  }

  const ratio = maxWidth / width
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(height * ratio)),
    shouldResize: true,
  }
}
