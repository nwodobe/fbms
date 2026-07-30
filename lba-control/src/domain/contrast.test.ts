import { describe, expect, it } from 'vitest'
import { checkBrandColors, contrastRatio, evaluateBrandColor, hexToRgb, isValidHexColor } from './contrast'

describe('validation des couleurs', () => {
  it('accepte les formats #abc et #aabbcc', () => {
    expect(isValidHexColor('#fff')).toBe(true)
    expect(isValidHexColor('#1F6F43')).toBe(true)
    expect(isValidHexColor('rouge')).toBe(false)
    expect(isValidHexColor('#12345')).toBe(false)
  })

  it('développe la notation courte', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#1f6f43')).toEqual([31, 111, 67])
  })

  it('refuse une valeur qui n’est pas une couleur', () => {
    expect(() => hexToRgb('bleu marine')).toThrow(/invalide/i)
  })
})

describe('rapport de contraste', () => {
  it('vaut 21 entre noir et blanc', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })

  it('vaut 1 entre deux couleurs identiques', () => {
    expect(contrastRatio('#1f6f43', '#1f6f43')).toBe(1)
  })

  it('est symétrique', () => {
    expect(contrastRatio('#1f6f43', '#ffffff')).toBe(contrastRatio('#ffffff', '#1f6f43'))
  })
})

describe('couleur de texte recommandée', () => {
  it('propose du blanc sur un fond sombre', () => {
    expect(evaluateBrandColor('#1f6f43').recommendedForeground).toBe('#ffffff')
  })

  it('propose du noir sur un fond clair', () => {
    expect(evaluateBrandColor('#fde047').recommendedForeground).toBe('#111111')
  })
})

describe('validation de la paire de couleurs du tenant', () => {
  it('accepte une paire lisible', () => {
    const result = checkBrandColors('#1f6f43', '#8a3d00')
    expect(result.accepted).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('accepte deux couleurs sombres mais de teintes distinctes', () => {
    // Vert forêt et brun : contraste de luminance faible entre eux, mais
    // parfaitement distinguables. Les refuser serait un faux positif.
    const result = checkBrandColors('#1f6f43', '#8a3d00')
    expect(result.accepted).toBe(true)
  })

  it('refuse une couleur qui disparaît sur le fond de l’application', () => {
    // #fefefe reste lisible avec du texte noir, mais s'efface sur fond blanc :
    // les deux problèmes sont distincts et le second doit être détecté.
    const result = checkBrandColors('#fefefe', '#1f6f43')
    expect(result.accepted).toBe(false)
    expect(result.issues.join(' ')).toMatch(/fond de l’application/)
    // Le refus doit être chiffré : sans la mesure, l'utilisateur tâtonne.
    expect(result.issues.join(' ')).toMatch(/contraste de \d+[.,]\d+:1/)
  })

  it('refuse une couleur au contraste de texte insuffisant, avec sa mesure', () => {
    // Gris moyen : ni le texte blanc ni le texte noir n'atteignent 4,5:1.
    const result = checkBrandColors('#787878', '#1f6f43')
    expect(result.accepted).toBe(false)
    expect(result.issues.join(' ')).toMatch(/contraste de \d+[.,]\d+:1 avec le texte/)
  })

  it('refuse deux couleurs quasi identiques', () => {
    const result = checkBrandColors('#1f6f43', '#206f44')
    expect(result.accepted).toBe(false)
    expect(result.issues.join(' ')).toMatch(/trop proches/)
  })

  it('refuse un code couleur invalide sans planter', () => {
    const result = checkBrandColors('vert', '#1f6f43')
    expect(result.accepted).toBe(false)
    expect(result.issues.join(' ')).toMatch(/hexadécimal/)
  })
})
