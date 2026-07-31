import { describe, expect, it } from 'vitest'
import { checkPlanConfirmation, checkPostponement, delayDays, planUrgency } from './planning'

const base = {
  plannedVolumeKg: 20000,
  availableStockKg: 30000,
  vehicleCapacityKg: 35000,
  hasVehicle: true,
  hasDestinationSite: true,
  hasRequiredDocuments: true,
}

describe('confirmation d’un planning', () => {
  it('accepte un planning réaliste', () => {
    const result = checkPlanConfirmation(base)
    expect(result.canConfirm).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('bloque une promesse supérieure au stock disponible, en donnant les deux chiffres', () => {
    const result = checkPlanConfirmation({ ...base, availableStockKg: 12000 })
    expect(result.canConfirm).toBe(false)

    const issue = result.issues.find((i) => i.code === 'stock_insuffisant')!
    expect(issue.message).toMatch(/12\s?000 kg/)
    expect(issue.message).toMatch(/20\s?000 kg/)
  })

  it('bloque un volume supérieur à la capacité du camion', () => {
    const result = checkPlanConfirmation({ ...base, vehicleCapacityKg: 15000 })
    expect(result.canConfirm).toBe(false)
    expect(result.issues.find((i) => i.code === 'capacite_depassee')!.message).toMatch(/rotations/)
  })

  it('avertit sans bloquer quand aucun véhicule n’est affecté', () => {
    // Un planning peut légitimement être confirmé avant que le transporteur ne
    // soit désigné : bloquer ici empêcherait de planifier une campagne.
    const result = checkPlanConfirmation({ ...base, hasVehicle: false, vehicleCapacityKg: null })
    expect(result.canConfirm).toBe(true)
    expect(result.issues[0]!.severity).toBe('avertissement')
  })

  it('bloque sans site de réception', () => {
    expect(checkPlanConfirmation({ ...base, hasDestinationSite: false }).canConfirm).toBe(false)
  })

  it('avertit sans bloquer pour des documents incomplets', () => {
    const result = checkPlanConfirmation({ ...base, hasRequiredDocuments: false })
    expect(result.canConfirm).toBe(true)
    expect(result.issues.some((i) => i.code === 'documents_manquants')).toBe(true)
  })

  it('accepte exactement le stock disponible', () => {
    expect(checkPlanConfirmation({ ...base, availableStockKg: 20000 }).canConfirm).toBe(true)
  })

  it('cumule plusieurs blocages', () => {
    const result = checkPlanConfirmation({
      ...base,
      availableStockKg: 100,
      hasDestinationSite: false,
    })
    expect(result.issues.filter((i) => i.severity === 'blocage')).toHaveLength(2)
  })
})

describe('retard', () => {
  it('compte les jours de retard', () => {
    expect(delayDays('2026-03-10', '2026-03-15', 'confirme')).toBe(5)
  })

  it('vaut zéro pour une livraison à venir', () => {
    expect(delayDays('2026-03-20', '2026-03-15', 'confirme')).toBe(0)
  })

  it('n’a pas de sens pour une livraison réceptionnée ou annulée', () => {
    expect(delayDays('2026-03-10', '2026-03-15', 'receptionne')).toBeNull()
    expect(delayDays('2026-03-10', '2026-03-15', 'annule')).toBeNull()
    expect(delayDays('2026-03-10', '2026-03-15', 'reporte')).toBeNull()
  })
})

describe('urgence d’un planning', () => {
  it('classe une livraison en retard', () => {
    expect(planUrgency('2026-03-10', '2026-03-12', 'confirme')).toBe('en_retard')
  })

  it('classe une livraison du jour', () => {
    expect(planUrgency('2026-03-12', '2026-03-12', 'confirme')).toBe('aujourd_hui')
  })

  it('classe une livraison de demain', () => {
    expect(planUrgency('2026-03-13', '2026-03-12', 'confirme')).toBe('demain')
  })

  it('traverse correctement une fin de mois', () => {
    expect(planUrgency('2026-04-01', '2026-03-31', 'confirme')).toBe('demain')
  })

  it('classe une livraison plus lointaine', () => {
    expect(planUrgency('2026-03-20', '2026-03-12', 'confirme')).toBe('a_venir')
  })

  it('ne classe pas une livraison déjà réceptionnée', () => {
    expect(planUrgency('2026-03-10', '2026-03-12', 'receptionne')).toBeNull()
  })
})

describe('report', () => {
  it('exige un motif', () => {
    const result = checkPostponement('  ')
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/promesse non tenue/)
  })

  it('accepte un motif renseigné', () => {
    expect(checkPostponement('Camion immobilisé').valid).toBe(true)
  })
})
