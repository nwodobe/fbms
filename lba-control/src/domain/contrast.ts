/**
 * Contrôle de lisibilité des couleurs de marque.
 *
 * La commande limite la personnalisation à deux couleurs (§5), et le cahier des
 * charges exige un test de contraste (§23.1). Sans ce garde-fou, un client
 * choisirait un jaune pâle sur blanc et son application deviendrait illisible —
 * puis ce serait imputé au produit.
 *
 * Fonctions pures : ni React, ni réseau, ni horloge. Testables telles quelles.
 */

/** Surface de l'application sur laquelle la couleur de marque est posée. */
export const SURFACE_COLOR = '#ffffff'

export interface ContrastVerdict {
  ratio: number
  /** WCAG AA pour du texte normal. */
  passesAA: boolean
  /** WCAG AA pour du texte large (≥ 18,66 px gras ou ≥ 24 px). */
  passesAALarge: boolean
  /** Couleur de texte à poser sur ce fond. */
  recommendedForeground: '#ffffff' | '#111111'
  /**
   * Contraste avec la surface de l'application.
   * Une couleur de marque presque blanche reste parfaitement lisible avec du
   * texte noir — mais elle disparaît sur le fond de l'application. Les deux
   * questions sont distinctes et doivent être vérifiées séparément.
   */
  contrastWithSurface: number
  /** Seuil WCAG 1.4.11 pour les éléments d'interface non textuels. */
  standsOutOnSurface: boolean
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isValidHexColor(value: string): boolean {
  return HEX.test(value.trim())
}

/** #abc et #aabbcc acceptés. Lève si la valeur n'est pas une couleur. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.trim()
  if (!HEX.test(value)) {
    throw new Error(`Couleur hexadécimale invalide : ${hex}`)
  }

  let body = value.slice(1)
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('')
  }

  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ]
}

/** Luminance relative WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** Rapport de contraste entre deux couleurs, de 1 (identiques) à 21 (noir/blanc). */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1]
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

/**
 * Évalue une couleur de marque contre le texte qui sera posé dessus.
 * Le texte retenu est celui qui offre le meilleur contraste — inutile d'imposer
 * du blanc sur un fond clair par principe.
 */
export function evaluateBrandColor(background: string): ContrastVerdict {
  const againstWhite = contrastRatio(background, '#ffffff')
  const againstBlack = contrastRatio(background, '#111111')
  const useWhite = againstWhite >= againstBlack
  const ratio = useWhite ? againstWhite : againstBlack
  const contrastWithSurface = contrastRatio(background, SURFACE_COLOR)

  return {
    ratio,
    passesAA: ratio >= 4.5,
    passesAALarge: ratio >= 3,
    recommendedForeground: useWhite ? '#ffffff' : '#111111',
    contrastWithSurface,
    standsOutOnSurface: contrastWithSurface >= 3,
  }
}

/**
 * Distance colorimétrique entre deux couleurs, pondérée pour approcher la
 * perception humaine (formule « redmean »).
 *
 * Le rapport de contraste ne convient pas ici : deux couleurs sombres de teintes
 * très différentes — un vert forêt et un brun — ont un contraste de luminance
 * faible tout en restant parfaitement distinguables. Refuser cette paire serait
 * un faux positif, et un client bloqué sans raison compréhensible.
 */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)

  const rMean = (r1 + r2) / 2
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2

  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db,
  )
}

/** En deçà, deux couleurs se confondent à l'écran. */
const MIN_COLOR_DISTANCE = 40

export interface BrandColorsCheck {
  primary: ContrastVerdict
  secondary: ContrastVerdict
  /** Les deux couleurs sont-elles utilisables telles quelles ? */
  accepted: boolean
  /** Messages destinés à l'utilisateur, avec la mesure — pas un refus opaque. */
  issues: string[]
}

/**
 * Valide la paire de couleurs d'un tenant.
 *
 * Une couleur refusée l'est TOUJOURS avec son rapport de contraste mesuré :
 * dire « cette couleur ne convient pas » sans chiffre laisse l'utilisateur
 * tâtonner.
 */
export function checkBrandColors(primary: string, secondary: string): BrandColorsCheck {
  const issues: string[] = []

  if (!isValidHexColor(primary)) issues.push(`La couleur principale « ${primary} » n'est pas un code hexadécimal valide.`)
  if (!isValidHexColor(secondary)) issues.push(`La couleur secondaire « ${secondary} » n'est pas un code hexadécimal valide.`)

  if (issues.length > 0) {
    const neutral: ContrastVerdict = {
      ratio: 0,
      passesAA: false,
      passesAALarge: false,
      recommendedForeground: '#111111',
      contrastWithSurface: 0,
      standsOutOnSurface: false,
    }
    return { primary: neutral, secondary: neutral, accepted: false, issues }
  }

  const primaryVerdict = evaluateBrandColor(primary)
  const secondaryVerdict = evaluateBrandColor(secondary)

  const labels = [
    ['principale', primary, primaryVerdict],
    ['secondaire', secondary, secondaryVerdict],
  ] as const

  for (const [label, value, verdict] of labels) {
    if (!verdict.passesAA) {
      issues.push(
        `Couleur ${label} « ${value} » : contraste de ${verdict.ratio.toFixed(2)}:1 avec le texte, ` +
          `inférieur au minimum WCAG AA de 4,5:1. Choisissez une teinte plus foncée ou plus claire.`,
      )
    }
    if (!verdict.standsOutOnSurface) {
      issues.push(
        `Couleur ${label} « ${value} » : contraste de ${verdict.contrastWithSurface.toFixed(2)}:1 ` +
          `avec le fond de l’application, inférieur au minimum de 3:1. Boutons et repères visuels ` +
          `seraient invisibles.`,
      )
    }
  }

  const distance = colorDistance(primary, secondary)
  if (distance < MIN_COLOR_DISTANCE) {
    issues.push(
      `Les deux couleurs sont trop proches l’une de l’autre (distance de ${distance.toFixed(0)}, ` +
        `minimum ${MIN_COLOR_DISTANCE}) : les états et les accents deviendraient indiscernables.`,
    )
  }

  return {
    primary: primaryVerdict,
    secondary: secondaryVerdict,
    accepted: issues.length === 0,
    issues,
  }
}
