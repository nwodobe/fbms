/**
 * Le logo du client dans les documents qui sortent de chez lui.
 *
 * Un bon de transfert, un rapport PDF et un export Excel circulent hors de
 * l'entreprise : ils portent son nom, ses couleurs et son logo. Trois règles
 * encadrent ce dernier, et elles sont ici parce que ce sont des règles, pas des
 * détails de dessin.
 *
 *  · **Le document sort toujours.** Logo absent, illisible, format non
 *    supporté, réseau coupé : le document est produit quand même, avec le nom
 *    commercial. Refuser d'exporter parce qu'une image manque serait
 *    disproportionné — et c'est au moment où le réseau est mauvais qu'on a le
 *    plus besoin de son rapport.
 *
 *  · **Le logo ne déforme pas l'en-tête.** Il est contenu dans une boîte fixe,
 *    proportions conservées. Une image de 4 000 × 300 pixels ne doit pas
 *    repousser le nom de l'entreprise hors de la page.
 *
 *  · **Tous les formats ne s'incorporent pas directement.** jsPDF accepte le
 *    PNG et le JPEG ; le SVG et le WebP doivent être rastérisés d'abord. Le
 *    savoir ici évite d'écrire un PDF contenant une image que personne ne
 *    pourra ouvrir.
 */

/** Formats que jsPDF incorpore tels quels. */
export const EMBEDDABLE_FORMATS = ['image/png', 'image/jpeg'] as const

/** Formats acceptés au dépôt mais qu'il faut convertir avant incorporation. */
export const RASTERISABLE_FORMATS = ['image/svg+xml', 'image/webp'] as const

/** Boîte réservée au logo dans l'en-tête PDF, en millimètres. */
export const LOGO_BOX_MM = { width: 34, height: 16 } as const

export function needsRasterisation(mimeType: string): boolean {
  return (RASTERISABLE_FORMATS as readonly string[]).includes(mimeType)
}

export function isEmbeddable(mimeType: string): boolean {
  return (EMBEDDABLE_FORMATS as readonly string[]).includes(mimeType)
}

export interface LogoBox {
  width: number
  height: number
}

/**
 * Dimensions du logo une fois posé dans sa boîte, proportions conservées.
 *
 * Le logo n'est jamais agrandi : une image de 40 pixels de large étirée sur
 * 34 mm serait floue, et un logo flou fait plus de tort à un document qu'un
 * logo absent.
 */
export function fitLogo(
  natural: { width: number; height: number },
  box: LogoBox = LOGO_BOX_MM,
): LogoBox {
  if (natural.width <= 0 || natural.height <= 0) return { width: 0, height: 0 }

  const scale = Math.min(box.width / natural.width, box.height / natural.height, 1)
  return {
    width: Number((natural.width * scale).toFixed(2)),
    height: Number((natural.height * scale).toFixed(2)),
  }
}

/**
 * Abscisse à laquelle le texte de l'en-tête commence.
 *
 * Sans logo, le nom part de la marge. Avec logo, il se décale — sinon les deux
 * se chevauchent, et c'est précisément le genre de défaut qu'un client découvre
 * après avoir envoyé le document à son acheteur.
 */
export function headerTextOffset(logo: LogoBox | null, margin = 12, gap = 6): number {
  return logo === null || logo.width === 0 ? margin : margin + logo.width + gap
}

export type LogoFailure =
  | 'absent'
  | 'format_non_supporte'
  | 'illisible'
  | 'trop_grand'
  | 'reseau'

/**
 * Ce qu'on dit à l'utilisateur quand le logo n'a pas pu être posé.
 *
 * On le dit : un document parti sans logo alors que le client en a déposé un
 * est une surprise désagréable à découvrir chez son acheteur. Mais on le dit
 * **après** avoir produit le document, pas à la place.
 */
export function describeLogoFailure(failure: LogoFailure): string | null {
  switch (failure) {
    case 'absent':
      // Aucun logo déposé : rien à signaler, ce n'est pas un incident.
      return null
    case 'format_non_supporte':
      return 'Le document a été produit sans logo : ce format d’image ne peut pas être incorporé. Déposez un PNG dans l’écran Marque.'
    case 'illisible':
      return 'Le document a été produit sans logo : le fichier déposé n’a pas pu être lu.'
    case 'trop_grand':
      return 'Le document a été produit sans logo : l’image dépasse la taille incorporable dans un document.'
    case 'reseau':
      return 'Le document a été produit sans logo : l’image n’a pas pu être récupérée. Réessayez avec une meilleure connexion.'
  }
}

/**
 * Poids au-delà duquel on renonce à incorporer l'image.
 *
 * Un logo de 900 ko incorporé dans chaque page d'un rapport de cent pages
 * produit un fichier que personne ne peut envoyer par courriel.
 */
export const MAX_EMBEDDED_LOGO_BYTES = 512 * 1024

export function isTooLarge(bytes: number): boolean {
  return bytes > MAX_EMBEDDED_LOGO_BYTES
}

/**
 * Une image encodée est-elle présentable à un écrivain de document ?
 *
 * Ce contrôle n'est pas de la prudence de principe. Passé une donnée base64
 * malformée, jsPDF **ne lève pas** : il attend, indéfiniment. Un logo corrompu
 * ne produirait donc pas un document sans logo, il figerait l'export — et un
 * bouton qui ne répond plus est bien pire qu'un document imparfait.
 */
export function isValidImageDataUrl(dataUrl: string): boolean {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) return false

  // Un base64 valide a une longueur multiple de 4 ; l'en-tête PNG ou JPEG doit
  // ensuite se retrouver dans les premiers octets.
  const payload = match[2] ?? ''
  if (payload.length < 8 || payload.length % 4 !== 0) return false

  return match[1] === 'png' ? payload.startsWith('iVBOR') : payload.startsWith('/9j/')
}

/** Nombre de lignes réservées au logo en tête d'un classeur. */
export const SHEET_LOGO_ROWS = 1
