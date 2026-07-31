import { describe, expect, it } from 'vitest'
import {
  applyClientDeclaration,
  capabilitiesFor,
  classifyPayment,
  DEFAULT_BLOCK_AFTER_DAYS,
  DEFAULT_GRACE_DAYS,
  dueReminders,
  extendPeriod,
  resolveLifecycle,
  type SubscriptionState,
} from './subscription'

const ACTIVE: SubscriptionState = {
  status: 'active',
  periodEnd: '2026-03-31',
  graceDays: DEFAULT_GRACE_DAYS,
  readonlyAfterDays: DEFAULT_BLOCK_AFTER_DAYS,
}

describe('resolveLifecycle', () => {
  it('laisse l’accès complet tant que la période court', () => {
    const result = resolveLifecycle(ACTIVE, '2026-03-01')
    expect(result.phase).toBe('actif')
    expect(result.accessLevel).toBe('full')
    expect(result.daysToExpiry).toBe(30)
    expect(result.daysOverdue).toBe(0)
  })

  it('annonce l’échéance dès J-7 sans rien restreindre', () => {
    const result = resolveLifecycle(ACTIVE, '2026-03-25')
    expect(result.phase).toBe('echeance_proche')
    expect(result.accessLevel).toBe('full')
    expect(result.daysToExpiry).toBe(6)
  })

  it('couvre le jour de l’échéance lui-même', () => {
    const result = resolveLifecycle(ACTIVE, '2026-03-31')
    expect(result.daysToExpiry).toBe(0)
    expect(result.accessLevel).toBe('full')
    expect(result.message).toContain('aujourd’hui')
  })

  it('maintient l’accès complet pendant les cinq jours de grâce', () => {
    for (const today of ['2026-04-01', '2026-04-03', '2026-04-05']) {
      const result = resolveLifecycle(ACTIVE, today)
      expect(result.phase).toBe('echu_en_grace')
      expect(result.expectedStatus).toBe('grace_period')
      // Une campagne d'achat ne s'arrête pas parce qu'un virement met trois
      // jours à arriver.
      expect(result.accessLevel).toBe('full')
    }
  })

  it('passe en lecture seule à J+6, pas avant', () => {
    expect(resolveLifecycle(ACTIVE, '2026-04-05').accessLevel).toBe('full')

    const result = resolveLifecycle(ACTIVE, '2026-04-06')
    expect(result.phase).toBe('lecture_seule')
    expect(result.expectedStatus).toBe('suspended_read_only')
    expect(result.accessLevel).toBe('read_only')
    expect(result.daysOverdue).toBe(6)
  })

  it('bloque l’accès opérationnel à J+31, en conservant les données', () => {
    expect(resolveLifecycle(ACTIVE, '2026-04-30').accessLevel).toBe('read_only')

    const result = resolveLifecycle(ACTIVE, '2026-05-01')
    expect(result.phase).toBe('bloque')
    expect(result.expectedStatus).toBe('suspended')
    expect(result.accessLevel).toBe('blocked')
    expect(result.dataRetained).toBe(true)
    expect(result.message).toContain('conservées')
  })

  it('n’efface jamais les données, quelle que soit la phase', () => {
    for (const today of ['2026-03-01', '2026-04-03', '2026-04-10', '2026-08-01']) {
      expect(resolveLifecycle(ACTIVE, today).dataRetained).toBe(true)
    }
  })

  it('annonce la prochaine bascule et sa date', () => {
    expect(resolveLifecycle(ACTIVE, '2026-03-20').nextTransition).toEqual({
      phase: 'echu_en_grace',
      on: '2026-04-01',
    })
    expect(resolveLifecycle(ACTIVE, '2026-04-02').nextTransition).toEqual({
      phase: 'lecture_seule',
      on: '2026-04-06',
    })
    expect(resolveLifecycle(ACTIVE, '2026-04-10').nextTransition).toEqual({
      phase: 'bloque',
      on: '2026-05-01',
    })
  })

  it('respecte une durée de grâce configurée différemment', () => {
    const strict: SubscriptionState = { ...ACTIVE, graceDays: 0 }
    expect(resolveLifecycle(strict, '2026-04-01').accessLevel).toBe('read_only')

    const generous: SubscriptionState = { ...ACTIVE, graceDays: 7 }
    expect(resolveLifecycle(generous, '2026-04-07').accessLevel).toBe('full')
  })

  it('laisse un abonnement résilié consultable et exportable', () => {
    const result = resolveLifecycle({ ...ACTIVE, status: 'cancelled' }, '2026-06-01')
    expect(result.phase).toBe('resilie')
    expect(result.accessLevel).toBe('read_only')
    expect(result.dataRetained).toBe(true)
  })

  it('distingue l’essai d’un abonnement payant en cours', () => {
    const result = resolveLifecycle({ ...ACTIVE, status: 'trial' }, '2026-03-20')
    expect(result.phase).toBe('essai')
    expect(result.expectedStatus).toBe('trial')
    expect(result.accessLevel).toBe('full')
  })
})

describe('dueReminders', () => {
  it('émet les rappels J-7, J-3 et J au bon moment', () => {
    expect(dueReminders(ACTIVE, '2026-03-20').map((r) => r.kind)).toEqual([])
    expect(dueReminders(ACTIVE, '2026-03-24').map((r) => r.kind)).toEqual(['reminder_j7'])
    expect(dueReminders(ACTIVE, '2026-03-28').map((r) => r.kind)).toEqual([
      'reminder_j7',
      'reminder_j3',
    ])
    expect(dueReminders(ACTIVE, '2026-03-31').map((r) => r.kind)).toEqual([
      'reminder_j7',
      'reminder_j3',
      'reminder_j0',
    ])
  })

  it('ne renvoie jamais un rappel déjà émis', () => {
    const sent = ['reminder_j7:2026-03-31', 'reminder_j3:2026-03-31']
    expect(dueReminders(ACTIVE, '2026-03-31', sent).map((r) => r.kind)).toEqual(['reminder_j0'])
    expect(
      dueReminders(ACTIVE, '2026-03-31', [...sent, 'reminder_j0:2026-03-31']),
    ).toEqual([])
  })

  it('rattrape un rappel manqué au lieu de le perdre', () => {
    // Serveur arrêté le 24 : le 26, le rappel J-7 doit sortir quand même.
    expect(dueReminders(ACTIVE, '2026-03-26').map((r) => r.kind)).toEqual(['reminder_j7'])
  })

  it('rattache la clé d’idempotence à l’échéance, pas au jour d’envoi', () => {
    const [reminder] = dueReminders(ACTIVE, '2026-03-25')
    expect(reminder?.idempotencyKey).toBe('reminder_j7:2026-03-31')

    // Après renouvellement, la nouvelle échéance produit une nouvelle clé.
    const renewed: SubscriptionState = { ...ACTIVE, periodEnd: '2026-04-30' }
    expect(dueReminders(renewed, '2026-04-25')[0]?.idempotencyKey).toBe('reminder_j7:2026-04-30')
  })

  it('ne relance pas un abonnement déjà échu ni un abonnement résilié', () => {
    expect(dueReminders(ACTIVE, '2026-04-02')).toEqual([])
    expect(dueReminders({ ...ACTIVE, status: 'cancelled' }, '2026-03-25')).toEqual([])
  })
})

describe('extendPeriod', () => {
  it('prolonge à partir de la date de fin quand l’abonnement court encore', () => {
    // Payer six jours avant l'échéance ne doit pas faire perdre ces six jours.
    expect(extendPeriod('2026-03-31', '2026-03-25', 1)).toBe('2026-04-30')
  })

  it('repart d’aujourd’hui quand la période est expirée', () => {
    expect(extendPeriod('2026-03-31', '2026-05-15', 1)).toBe('2026-06-15')
  })

  it('gère les mois plus courts sans déborder', () => {
    // 31 janvier + 1 mois ne peut pas donner le 3 mars.
    expect(extendPeriod('2026-01-31', '2026-01-20', 1)).toBe('2026-02-28')
    expect(extendPeriod('2026-08-31', '2026-08-01', 1)).toBe('2026-09-30')
  })

  it('accepte une période annuelle', () => {
    expect(extendPeriod('2026-03-31', '2026-03-01', 12)).toBe('2027-03-31')
  })

  it('refuse une durée nulle ou négative', () => {
    expect(() => extendPeriod('2026-03-31', '2026-03-01', 0)).toThrow(/strictement positive/)
    expect(() => extendPeriod('2026-03-31', '2026-03-01', -1)).toThrow(/strictement positive/)
  })
})

describe('classifyPayment', () => {
  it('renouvelle sur un paiement complet', () => {
    const result = classifyPayment(120_000, 0, 120_000)
    expect(result.outcome).toBe('complet')
    expect(result.renewsPeriod).toBe(true)
    expect(result.creditAmount).toBe(0)
  })

  it('conserve un paiement partiel en avoir sans renouveler', () => {
    const result = classifyPayment(120_000, 0, 50_000)
    expect(result.outcome).toBe('partiel')
    // Offrir un mois contre un acompte transformerait la facturation en
    // négociation.
    expect(result.renewsPeriod).toBe(false)
    expect(result.creditAmount).toBe(50_000)
    expect(result.remaining).toBe(70_000)
  })

  it('renouvelle quand le cumul des versements atteint la facture', () => {
    const result = classifyPayment(120_000, 50_000, 70_000)
    expect(result.outcome).toBe('complet')
    expect(result.renewsPeriod).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('conserve l’excédent en avoir et renouvelle', () => {
    const result = classifyPayment(120_000, 0, 150_000)
    expect(result.outcome).toBe('excedent')
    expect(result.renewsPeriod).toBe(true)
    expect(result.creditAmount).toBe(30_000)
  })

  it('refuse un montant nul ou négatif', () => {
    expect(() => classifyPayment(120_000, 0, 0)).toThrow(/strictement positif/)
    expect(() => classifyPayment(120_000, 0, -5)).toThrow(/strictement positif/)
  })
})

describe('applyClientDeclaration', () => {
  it('ne change ni le statut ni la période', () => {
    const overdue: SubscriptionState = { ...ACTIVE, status: 'suspended_read_only' }
    const result = applyClientDeclaration(overdue)

    expect(result.changed).toBe(false)
    expect(result.status).toBe('suspended_read_only')
    expect(result.periodEnd).toBe(overdue.periodEnd)
    expect(result.message).toContain('ne renouvelle jamais')
  })
})

describe('capabilitiesFor', () => {
  it('ouvre tout en accès complet', () => {
    expect(capabilitiesFor('full')).toEqual({
      canRead: true,
      canWrite: true,
      canExport: true,
      canDeclarePayment: true,
    })
  })

  it('ferme l’écriture mais garde lecture, export et déclaration', () => {
    for (const access of ['read_only', 'blocked'] as const) {
      const capabilities = capabilitiesFor(access)
      expect(capabilities.canWrite).toBe(false)
      expect(capabilities.canRead).toBe(true)
      // Retenir les données d'un client en retard serait une prise d'otage.
      expect(capabilities.canExport).toBe(true)
      // Sans cela, un client bloqué ne pourrait jamais se débloquer.
      expect(capabilities.canDeclarePayment).toBe(true)
    }
  })
})
