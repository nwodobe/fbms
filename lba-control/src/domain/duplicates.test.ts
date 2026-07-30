import { describe, expect, it } from 'vitest'
import {
  compareForDuplicate,
  findDuplicates,
  gpsDistanceMeters,
  isGpsOnlyMatch,
  REVIEW_THRESHOLD,
  type PurchaseSignature,
} from './duplicates'

const purchase = (over: Partial<PurchaseSignature> & Pick<PurchaseSignature, 'id'>): PurchaseSignature => ({
  fieldAgentId: 'agent-1',
  supplierId: 'supplier-1',
  supplierName: 'Producteur Un',
  localityId: 'village-1',
  purchasedAt: '2026-03-10T09:00:00.000Z',
  netWeightKg: 8200,
  amount: 3_526_000,
  paymentReference: null,
  gpsLat: 7.69,
  gpsLng: -5.03,
  deviceId: 'device-1',
  ...over,
})

describe('distance GPS', () => {
  it('vaut zéro pour un même point', () => {
    expect(gpsDistanceMeters(7.69, -5.03, 7.69, -5.03)).toBe(0)
  })

  it('mesure une distance plausible', () => {
    // ~0,01° de latitude ≈ 1,1 km
    expect(gpsDistanceMeters(7.69, -5.03, 7.7, -5.03)).toBeGreaterThan(1000)
  })
})

describe('comparaison de deux achats', () => {
  it('détecte une double saisie évidente', () => {
    const match = compareForDuplicate(
      purchase({ id: 'p2', purchasedAt: '2026-03-10T09:05:00.000Z' }),
      purchase({ id: 'p1' }),
    )
    expect(match.needsReview).toBe(true)
    expect(match.matchedCriteria).toEqual(
      expect.arrayContaining(['pisteur', 'vendeur', 'date', 'poids', 'montant']),
    )
  })

  it('ne signale pas deux achats réellement différents', () => {
    const match = compareForDuplicate(
      purchase({
        id: 'p2',
        supplierId: 'supplier-9',
        supplierName: 'Producteur Neuf',
        netWeightKg: 1200,
        amount: 516_000,
        purchasedAt: '2026-03-14T15:00:00.000Z',
        localityId: 'village-4',
        gpsLat: 8.1,
        gpsLng: -4.2,
      }),
      purchase({ id: 'p1' }),
    )
    expect(match.needsReview).toBe(false)
  })

  it('donne un poids déterminant à la référence de paiement', () => {
    // Un même versement Wave ne peut pas financer deux achats distincts.
    const match = compareForDuplicate(
      purchase({
        id: 'p2',
        supplierId: 'supplier-2',
        supplierName: 'Autre producteur',
        netWeightKg: 3000,
        amount: 1_290_000,
        paymentReference: 'WV-12345',
        purchasedAt: '2026-03-10T14:00:00.000Z',
      }),
      purchase({ id: 'p1', paymentReference: 'WV-12345' }),
    )
    expect(match.matchedCriteria).toContain('reference_paiement')
    expect(match.score).toBeGreaterThanOrEqual(REVIEW_THRESHOLD)
  })

  it('rapproche les noms de vendeur malgré accents et casse', () => {
    const match = compareForDuplicate(
      purchase({ id: 'p2', supplierId: null, supplierName: '  KOUAMÉ  yao ' }),
      purchase({ id: 'p1', supplierId: null, supplierName: 'kouame Yao' }),
    )
    expect(match.matchedCriteria).toContain('vendeur')
  })

  it('pondère l’écart de temps dans la journée', () => {
    // Scénario volontairement non saturé (appareil, localité et GPS distincts),
    // sans quoi les deux scores plafonneraient à 100 et la comparaison ne
    // mesurerait plus rien.
    const partial = { deviceId: 'device-2', localityId: 'village-2', gpsLat: null, gpsLng: null }

    const proche = compareForDuplicate(
      purchase({ id: 'p2', purchasedAt: '2026-03-10T09:10:00.000Z', ...partial }),
      purchase({ id: 'p1' }),
    )
    const eloigne = compareForDuplicate(
      purchase({ id: 'p3', purchasedAt: '2026-03-10T18:00:00.000Z', ...partial }),
      purchase({ id: 'p1' }),
    )

    expect(proche.score).toBeGreaterThan(eloigne.score)
    expect(proche.matchedCriteria).toContain('heure_proche')
    expect(eloigne.matchedCriteria).not.toContain('heure_proche')
  })
})

describe('la géolocalisation n’est jamais une preuve à elle seule', () => {
  it('deux achats au même village ne suffisent pas à créer un doublon', () => {
    // Exigence explicite du cahier des charges : au même village, tous les
    // achats partagent les mêmes coordonnées.
    const match = compareForDuplicate(
      purchase({
        id: 'p2',
        fieldAgentId: 'agent-2',
        supplierId: 'supplier-7',
        supplierName: 'Producteur Sept',
        netWeightKg: 500,
        amount: 215_000,
        purchasedAt: '2026-04-02T11:00:00.000Z',
        deviceId: 'device-9',
      }),
      purchase({ id: 'p1' }),
    )

    expect(match.needsReview).toBe(false)
    expect(isGpsOnlyMatch(match)).toBe(true)
  })

  it('le GPS pèse marginalement dans le score total', () => {
    const avecGps = compareForDuplicate(
      purchase({ id: 'p2', purchasedAt: '2026-03-10T09:05:00.000Z' }),
      purchase({ id: 'p1' }),
    )
    const sansGps = compareForDuplicate(
      purchase({ id: 'p2', purchasedAt: '2026-03-10T09:05:00.000Z', gpsLat: null, gpsLng: null }),
      purchase({ id: 'p1' }),
    )
    expect(avecGps.score - sansGps.score).toBeLessThanOrEqual(5)
    // Le signalement tient sans le GPS : il n'en dépend pas.
    expect(sansGps.needsReview).toBe(true)
  })
})

describe('recherche de doublons dans un lot', () => {
  const existing = [
    purchase({ id: 'p1' }),
    purchase({ id: 'p2', supplierId: 'supplier-2', netWeightKg: 400, amount: 172_000, purchasedAt: '2026-03-01T08:00:00.000Z' }),
  ]

  it('trouve la correspondance la plus probable en premier', () => {
    const matches = findDuplicates(purchase({ id: 'p3', purchasedAt: '2026-03-10T09:02:00.000Z' }), existing)
    expect(matches[0]!.candidateId).toBe('p1')
  })

  it('ne se compare jamais à soi-même', () => {
    const matches = findDuplicates(purchase({ id: 'p1' }), existing)
    expect(matches.every((m) => m.candidateId !== 'p1')).toBe(true)
  })

  it('ne signale rien quand rien ne ressemble', () => {
    const matches = findDuplicates(
      purchase({
        id: 'p9',
        fieldAgentId: 'agent-3',
        supplierId: 'supplier-x',
        supplierName: 'Inconnu',
        netWeightKg: 77,
        amount: 33_110,
        purchasedAt: '2026-08-01T10:00:00.000Z',
        localityId: 'village-9',
        gpsLat: 9.9,
        gpsLng: -3.1,
        deviceId: 'device-x',
      }),
      existing,
    )
    expect(matches).toEqual([])
  })

  it('ne bloque rien : le résultat est une liste à vérifier', () => {
    const matches = findDuplicates(purchase({ id: 'p3', purchasedAt: '2026-03-10T09:02:00.000Z' }), existing)
    expect(matches[0]!.needsReview).toBe(true)
    // La fonction ne renvoie aucun verdict : elle propose une vérification.
    expect(matches[0]).not.toHaveProperty('rejected')
  })
})
