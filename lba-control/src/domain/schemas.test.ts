import { describe, expect, it } from 'vitest'
import {
  brandingSchema,
  campaignSchema,
  contractSchema,
  emptyToNull,
  negotiatedPriceSchema,
  partnerCompanySchema,
} from './schemas'

const validBranding = {
  commercialName: 'LBA Démonstration Bouaké',
  legalName: 'LBA Démonstration SARL',
  slogan: 'Contrôler chaque franc',
  primaryColor: '#1f6f43',
  secondaryColor: '#8a3d00',
  phone: '+225 00 00 00 00',
  email: 'contact@demo.test',
  address: 'Bouaké',
  taxId: 'CI-000',
  documentFooter: 'Document de démonstration',
}

describe('marque du tenant', () => {
  it('accepte une configuration lisible', () => {
    expect(brandingSchema.safeParse(validBranding).success).toBe(true)
  })

  it('refuse une couleur au format invalide', () => {
    const result = brandingSchema.safeParse({ ...validBranding, primaryColor: 'vert' })
    expect(result.success).toBe(false)
  })

  it('refuse une paire de couleurs illisible, avec le motif', () => {
    const result = brandingSchema.safeParse({ ...validBranding, primaryColor: '#fefefe' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(' ')
      expect(messages).toMatch(/fond de l’application/)
    }
  })

  it('rattache l’erreur au bon champ', () => {
    const result = brandingSchema.safeParse({ ...validBranding, secondaryColor: '#fdfdfd' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('secondaryColor'))).toBe(true)
    }
  })

  it('exige un nom commercial', () => {
    expect(brandingSchema.safeParse({ ...validBranding, commercialName: ' ' }).success).toBe(false)
  })

  it('refuse un email mal formé', () => {
    expect(brandingSchema.safeParse({ ...validBranding, email: 'pas-un-email' }).success).toBe(false)
  })
})

describe('société partenaire', () => {
  const valid = { code: 'OLAM', name: 'OLAM (démo)' }

  it('accepte une société minimale', () => {
    expect(partnerCompanySchema.safeParse(valid).success).toBe(true)
  })

  it('impose un code en majuscules', () => {
    expect(partnerCompanySchema.safeParse({ ...valid, code: 'olam' }).success).toBe(false)
    expect(partnerCompanySchema.safeParse({ ...valid, code: 'OLAM-CI' }).success).toBe(true)
  })

  it('refuse une tolérance négative', () => {
    expect(partnerCompanySchema.safeParse({ ...valid, weightTolerancePct: -1 }).success).toBe(false)
  })

  it('refuse une tolérance supérieure à 100 %', () => {
    expect(partnerCompanySchema.safeParse({ ...valid, weightTolerancePct: 150 }).success).toBe(false)
  })
})

describe('campagne', () => {
  it('refuse une date de fin antérieure au début', () => {
    const result = campaignSchema.safeParse({
      code: 'C2026',
      name: 'Campagne 2026',
      startDate: '2026-06-01',
      endDate: '2026-01-01',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain('endDate')
    }
  })

  it('accepte une campagne d’un seul jour', () => {
    expect(
      campaignSchema.safeParse({
        code: 'C2026',
        name: 'Campagne test',
        startDate: '2026-01-01',
        endDate: '2026-01-01',
      }).success,
    ).toBe(true)
  })
})

describe('contrat', () => {
  const valid = {
    partnerCompanyId: '00000000-0000-4000-8000-000000000001',
    campaignId: '00000000-0000-4000-8000-000000000002',
    productId: '00000000-0000-4000-8000-000000000003',
    reference: 'CT-OLAM-2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    coverageBasis: 'reception_accepted' as const,
    valuationPriceBasis: 'net_reconnu' as const,
  }

  it('accepte un contrat valide', () => {
    expect(contractSchema.safeParse(valid).success).toBe(true)
  })

  it('exige une société partenaire', () => {
    expect(contractSchema.safeParse({ ...valid, partnerCompanyId: 'pas-un-uuid' }).success).toBe(false)
  })

  it('refuse une humidité maximale supérieure à 100 %', () => {
    expect(contractSchema.safeParse({ ...valid, humidityMax: 120 }).success).toBe(false)
  })

  it('refuse un volume cible négatif', () => {
    expect(contractSchema.safeParse({ ...valid, targetVolumeKg: -5 }).success).toBe(false)
  })

  it('accepte les trois bases de couverture prévues', () => {
    for (const basis of ['purchase_validated', 'reception_accepted', 'payment_received'] as const) {
      expect(contractSchema.safeParse({ ...valid, coverageBasis: basis }).success).toBe(true)
    }
  })
})

describe('prix négocié', () => {
  const valid = {
    contractId: '00000000-0000-4000-8000-000000000001',
    priceType: 'negocie' as const,
    price: 450,
    validFrom: '2026-01-01',
    isProvisional: false,
    justification: 'Révision négociée avec la société partenaire',
  }

  it('accepte un prix motivé', () => {
    expect(negotiatedPriceSchema.safeParse(valid).success).toBe(true)
  })

  it('exige une justification substantielle', () => {
    // Un changement de prix sans motif exploitable est indéfendable en audit.
    expect(negotiatedPriceSchema.safeParse({ ...valid, justification: 'maj' }).success).toBe(false)
  })

  it('refuse un prix nul ou négatif', () => {
    expect(negotiatedPriceSchema.safeParse({ ...valid, price: 0 }).success).toBe(false)
    expect(negotiatedPriceSchema.safeParse({ ...valid, price: -10 }).success).toBe(false)
  })

  it('refuse une fin de validité antérieure au début', () => {
    expect(
      negotiatedPriceSchema.safeParse({ ...valid, validTo: '2025-12-01' }).success,
    ).toBe(false)
  })
})

describe('emptyToNull', () => {
  it('convertit les chaînes vides en null', () => {
    expect(emptyToNull({ a: '', b: 'texte', c: 3, d: null })).toEqual({
      a: null,
      b: 'texte',
      c: 3,
      d: null,
    })
  })

  it('ne convertit pas le zéro', () => {
    // 0 est une valeur, pas une absence de valeur.
    expect(emptyToNull({ tolerance: 0 })).toEqual({ tolerance: 0 })
  })
})
