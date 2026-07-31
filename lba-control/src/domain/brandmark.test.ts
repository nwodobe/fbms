import { describe, expect, it } from 'vitest'
import {
  describeLogoFailure,
  fitLogo,
  headerTextOffset,
  isEmbeddable,
  isTooLarge,
  LOGO_BOX_MM,
  MAX_EMBEDDED_LOGO_BYTES,
  isValidImageDataUrl,
  needsRasterisation,
} from './brandmark'

describe('formats incorporables', () => {
  it('PNG et JPEG entrent directement dans un PDF', () => {
    expect(isEmbeddable('image/png')).toBe(true)
    expect(isEmbeddable('image/jpeg')).toBe(true)
  })

  it('SVG et WebP demandent une conversion préalable', () => {
    expect(needsRasterisation('image/svg+xml')).toBe(true)
    expect(needsRasterisation('image/webp')).toBe(true)
    expect(isEmbeddable('image/svg+xml')).toBe(false)
  })

  it('un format inconnu n’est ni incorporable ni convertible', () => {
    expect(isEmbeddable('application/pdf')).toBe(false)
    expect(needsRasterisation('application/pdf')).toBe(false)
  })
})

describe('mise à l’échelle du logo', () => {
  it('contient une image très large dans la boîte sans la déformer', () => {
    const fitted = fitLogo({ width: 4000, height: 300 })
    expect(fitted.width).toBeLessThanOrEqual(LOGO_BOX_MM.width)
    expect(fitted.height).toBeLessThanOrEqual(LOGO_BOX_MM.height)
    // Proportions conservées : 4000/300 ≈ 13,33.
    expect(fitted.width / fitted.height).toBeCloseTo(4000 / 300, 1)
  })

  it('contient une image très haute par sa hauteur', () => {
    const fitted = fitLogo({ width: 300, height: 4000 })
    expect(fitted.height).toBeLessThanOrEqual(LOGO_BOX_MM.height)
    expect(fitted.width).toBeLessThan(LOGO_BOX_MM.width)
  })

  it('n’agrandit jamais une petite image', () => {
    // Un logo étiré est flou, et un logo flou fait plus de tort qu'un logo absent.
    expect(fitLogo({ width: 20, height: 10 })).toEqual({ width: 20, height: 10 })
  })

  it('renvoie une boîte vide pour des dimensions absurdes', () => {
    expect(fitLogo({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 })
    expect(fitLogo({ width: -5, height: 10 })).toEqual({ width: 0, height: 0 })
  })
})

describe('place du texte dans l’en-tête', () => {
  it('sans logo, le texte part de la marge', () => {
    expect(headerTextOffset(null)).toBe(12)
  })

  it('avec logo, le texte se décale au-delà de l’image', () => {
    expect(headerTextOffset({ width: 30, height: 12 })).toBe(48)
  })

  it('un logo de largeur nulle ne décale rien', () => {
    expect(headerTextOffset({ width: 0, height: 0 })).toBe(12)
  })
})

describe('message d’échec', () => {
  it('ne signale rien quand aucun logo n’a été déposé', () => {
    // L'absence de logo n'est pas un incident : la plupart des clients n'en
    // déposent pas, et les alerter à chaque export serait du bruit.
    expect(describeLogoFailure('absent')).toBeNull()
  })

  it('explique et oriente quand un logo déposé n’a pas pu être posé', () => {
    expect(describeLogoFailure('format_non_supporte')).toMatch(/PNG/)
    expect(describeLogoFailure('illisible')).toMatch(/produit sans logo/)
    expect(describeLogoFailure('reseau')).toMatch(/connexion/)
    expect(describeLogoFailure('trop_grand')).toMatch(/dépasse/)
  })
})

describe('validité d’une image encodée', () => {
  // Ce contrôle n'est pas de la prudence de principe : passé une donnée base64
  // malformée, jsPDF n'échoue pas, il **attend indéfiniment**. Sans ce filtre,
  // un logo corrompu figerait le bouton d'export au lieu de produire un
  // document sans logo. Le défaut a été constaté par un test qui a expiré.
  it('accepte un PNG et un JPEG correctement encodés', () => {
    expect(isValidImageDataUrl('data:image/png;base64,iVBORw0KGgoAAAA=')).toBe(true)
    expect(isValidImageDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRgAB')).toBe(true)
  })

  it('refuse une charge utile qui n’est pas du base64', () => {
    expect(isValidImageDataUrl('data:image/png;base64,ceci-n-est-pas-une-image')).toBe(false)
  })

  it('refuse une longueur incompatible avec du base64', () => {
    expect(isValidImageDataUrl('data:image/png;base64,iVBORw0KGgoAAA')).toBe(false)
  })

  it('refuse un en-tête qui ne correspond pas au format annoncé', () => {
    // Annoncé PNG, encodé JPEG : le document produirait une image illisible.
    expect(isValidImageDataUrl('data:image/png;base64,/9j/4AAQSkZJRgAB')).toBe(false)
  })

  it('refuse une adresse qui n’est pas une donnée encodée', () => {
    expect(isValidImageDataUrl('https://exemple.test/logo.png')).toBe(false)
    expect(isValidImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false)
    expect(isValidImageDataUrl('')).toBe(false)
  })
})

describe('poids incorporable', () => {
  it('accepte un logo raisonnable', () => {
    expect(isTooLarge(120 * 1024)).toBe(false)
  })

  it('refuse un logo qui alourdirait chaque page', () => {
    expect(isTooLarge(MAX_EMBEDDED_LOGO_BYTES + 1)).toBe(true)
  })
})
