/**
 * Phase 6 · abonnements, clôture de campagne et conservation, appliqués en base.
 *
 * Ce que ces tests protègent :
 *
 *   · qu'une déclaration de paiement par le client ne réactive jamais rien ;
 *   · qu'un paiement partiel devienne un avoir sans renouveler la période ;
 *   · qu'un même paiement ne prolonge jamais deux fois la période ;
 *   · que le blocage soit graduel et **ne supprime aucune donnée** ;
 *   · qu'une campagne clôturée refuse les écritures, et qu'une réouverture
 *     laisse une trace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { asOwnerWithin, pool, switchActor, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

/** Ramène l'abonnement du tenant A à un état connu avant chaque scénario. */
async function setPeriod(
  c: import('pg').PoolClient,
  actor: Parameters<typeof switchActor>[1],
  periodEnd: string,
  status = 'active',
): Promise<void> {
  // Les tables de facturation ne sont pas écrivables par un client : préparer
  // l'état exige les droits du propriétaire de la base.
  await asOwnerWithin(c, actor, async (owner) => {
    const { rowCount } = await owner.query(
      `update subscriptions
          set period_end = $2::date, period_start = $2::date - 30, status = $3::subscription_status,
              grace_started_at = null, read_only_at = null, blocked_at = null,
              -- La contrainte subscription_suspension_is_justified refuse une
              -- suspension sans motif : c'est elle qui fait son travail ici.
              suspension_reason = case when $3 in ('suspended', 'suspended_read_only')
                                       then 'État préparé pour un test du cycle.' end
        where id = $1`,
      [ids.subscriptionA, periodEnd, status],
    )
    // Une préparation silencieusement filtrée par RLS rendrait tous les tests
    // suivants faussement verts.
    if (rowCount !== 1) throw new Error(`Préparation de l'abonnement sans effet (${rowCount} ligne).`)
  })
}

// ---------------------------------------------------------------------------
// Déclaration et confirmation de paiement
// ---------------------------------------------------------------------------

describe('déclaration de paiement par le client', () => {
  it('n’active rien : le statut et la période restent identiques (RG-15)', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-01-31', 'suspended_read_only')

      const before = await c.query(
        `select status, period_end from subscriptions where id = $1`,
        [ids.subscriptionA],
      )

      await c.query(
        `select app.declare_subscription_payment(120000, 'wave', 'WV-DECL-001', null, 'Client démo')`,
      )

      const after = await c.query(
        `select status, period_end from subscriptions where id = $1`,
        [ids.subscriptionA],
      )

      expect(after.rows[0].status).toBe(before.rows[0].status)
      expect(after.rows[0].period_end).toEqual(before.rows[0].period_end)

      const payment = await c.query(
        `select status from subscription_payments where reference = 'WV-DECL-001'`,
      )
      expect(payment.rows[0].status).toBe('declared')
    })
  })

  it('laisse dans la trace la preuve que rien n’a changé', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-01-31', 'suspended_read_only')
      await c.query(
        `select app.declare_subscription_payment(120000, 'wave', 'WV-DECL-002', null, 'Client démo')`,
      )

      const { rows } = await c.query(
        `select old_status, new_status, event_type from subscription_events
          where subscription_id = $1 and event_type = 'payment_declared'
          order by occurred_at desc limit 1`,
        [ids.subscriptionA],
      )

      // Ancien et nouveau statut identiques : la déclaration n'a rien produit.
      expect(rows[0].old_status).toBe(rows[0].new_status)
    })
  })

  it('exige une référence vérifiable', async () => {
    await withUser(actors.ownerA, async (c) => {
      await expect(
        c.query(`select app.declare_subscription_payment(120000, 'wave', 'x')`),
      ).rejects.toThrow(/exige une référence/i)
    })
  })

  it('refuse qu’un client fasse passer son paiement à « confirmé »', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-01-31', 'suspended_read_only')
      const declared = await c.query(
        `select (app.declare_subscription_payment(120000, 'wave', 'WV-DECL-003')).id as id`,
      )

      await expect(
        c.query(`update subscription_payments set status = 'confirmed' where id = $1`, [
          declared.rows[0].id,
        ]),
      ).rejects.toThrow(/super-administrateur/i)
    })
  })

  it('refuse la référence en double : un même règlement ne compte qu’une fois', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-01-31')
      await c.query(`select app.declare_subscription_payment(120000, 'wave', 'WV-UNIQUE')`)

      await expect(
        c.query(`select app.declare_subscription_payment(120000, 'wave', 'WV-UNIQUE')`),
      ).rejects.toThrow()
    })
  })
})

describe('confirmation de paiement par le super-administrateur', () => {
  /**
   * Déclaration et confirmation dans la MÊME transaction.
   *
   * Les séparer testerait deux états sans lien : la déclaration serait annulée
   * avant que l'administrateur ne la voie, et le test passerait pour de
   * mauvaises raisons.
   */
  it('prolonge à partir de la date de fin existante quand l’abonnement court (RG-13)', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-12-31')
      const declared = await c.query(
        `select (app.declare_subscription_payment(120000, 'wave', 'WV-CONF-001')).id as id`,
      )

      await switchActor(c, actors.superAdmin)
      await c.query(`select app.confirm_subscription_payment($1, 'Virement vérifié')`, [
        declared.rows[0].id,
      ])

      const { rows } = await c.query(
        `select status, period_end from subscriptions where id = $1`,
        [ids.subscriptionA],
      )
      expect(rows[0].status).toBe('active')
      // Payer en avance ne fait jamais perdre les jours déjà réglés.
      expect(rows[0].period_end.toISOString().slice(0, 10)).toBe('2027-01-31')
    })
  })

  it('repart du jour du paiement quand la période est déjà expirée', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-01-31', 'suspended')
      const declared = await c.query(
        `select (app.declare_subscription_payment(120000, 'wave', 'WV-CONF-002')).id as id`,
      )

      await switchActor(c, actors.superAdmin)
      await c.query(`select app.confirm_subscription_payment($1)`, [declared.rows[0].id])

      const { rows } = await c.query(
        `select status, period_start, period_end, blocked_at from subscriptions where id = $1`,
        [ids.subscriptionA],
      )
      // Facturer rétroactivement une période sans accès serait indéfendable.
      expect(rows[0].status).toBe('active')
      expect(rows[0].period_start.toISOString().slice(0, 10)).toBe(
        new Date().toISOString().slice(0, 10),
      )
      expect(rows[0].blocked_at).toBeNull()
    })
  })

  it('ne prolonge jamais deux fois le même paiement (RG-13, idempotence)', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-12-31')
      const declared = await c.query(
        `select (app.declare_subscription_payment(120000, 'wave', 'WV-IDEM-001')).id as id`,
      )

      await switchActor(c, actors.superAdmin)
      await c.query(`select app.confirm_subscription_payment($1)`, [declared.rows[0].id])
      const first = await c.query(`select period_end from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])

      await c.query(`select app.confirm_subscription_payment($1)`, [declared.rows[0].id])
      const second = await c.query(`select period_end from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])

      expect(second.rows[0].period_end).toEqual(first.rows[0].period_end)
    })
  })

  it('conserve un paiement partiel en avoir sans renouveler (RG-14)', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-12-31')

      const invoice = await asOwnerWithin(c, actors.ownerA, (owner) =>
        owner.query(
          `insert into invoices
             (tenant_id, subscription_id, number, amount, due_date, period_start, period_end)
           values ($1, $2, 'F-2026-900', 120000, current_date + 10, current_date, current_date + 30)
           returning id`,
          [ids.tenantA, ids.subscriptionA],
        ),
      )

      const declared = await c.query(
        `select (app.declare_subscription_payment(50000, 'wave', 'WV-PART-001', $1)).id as id`,
        [invoice.rows[0].id],
      )

      await switchActor(c, actors.superAdmin)
      const before = await c.query(`select period_end from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])
      await c.query(`select app.confirm_subscription_payment($1)`, [declared.rows[0].id])
      const after = await c.query(`select period_end from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])

      // Offrir un mois contre un acompte transformerait la facturation en
      // négociation.
      expect(after.rows[0].period_end).toEqual(before.rows[0].period_end)

      const payment = await c.query(`select status from subscription_payments where id = $1`, [
        declared.rows[0].id,
      ])
      expect(payment.rows[0].status).toBe('partial')

      const credit = await c.query(
        `select amount, origin from subscription_credits where payment_id = $1`,
        [declared.rows[0].id],
      )
      expect(Number(credit.rows[0].amount)).toBe(50_000)
      expect(credit.rows[0].origin).toBe('paiement_partiel')

      const updated = await c.query(`select status, amount_paid from invoices where id = $1`, [
        invoice.rows[0].id,
      ])
      expect(updated.rows[0].status).toBe('partially_paid')
    })
  })

  it('reste inaccessible à un propriétaire de tenant', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-12-31')
      const declared = await c.query(
        `select (app.declare_subscription_payment(120000, 'wave', 'WV-AUTH-001')).id as id`,
      )

      await expect(
        c.query(`select app.confirm_subscription_payment($1)`, [declared.rows[0].id]),
      ).rejects.toThrow(/super-administrateur/i)
    })
  })
})

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

describe('cycle de vie de l’abonnement', () => {
  it('reproduit exactement les phases du module de domaine', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-03-31')

      const cases: Array<[string, string, string]> = [
        ['2026-03-01', 'actif', 'full'],
        ['2026-03-31', 'actif', 'full'],
        ['2026-04-01', 'echu_en_grace', 'full'],
        ['2026-04-05', 'echu_en_grace', 'full'],
        ['2026-04-06', 'lecture_seule', 'read_only'],
        ['2026-04-30', 'lecture_seule', 'read_only'],
        ['2026-05-01', 'bloque', 'blocked'],
      ]

      for (const [today, phase, access] of cases) {
        const { rows } = await c.query(`select app.subscription_phase($1, $2::date) as p`, [
          ids.subscriptionA,
          today,
        ])
        expect(rows[0].p.phase, `phase au ${today}`).toBe(phase)
        expect(rows[0].p.access_level, `accès au ${today}`).toBe(access)
        expect(rows[0].p.data_retained).toBe(true)
      }
    })
  })

  it('émet les rappels une seule fois par échéance', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-03-31')

      const first = await c.query(
        `select app.advance_subscription_lifecycle($1, '2026-03-31'::date) as r`,
        [ids.subscriptionA],
      )
      expect(first.rows[0].r.reminders_sent).toEqual([
        'reminder_j7',
        'reminder_j3',
        'reminder_j0',
      ])

      const second = await c.query(
        `select app.advance_subscription_lifecycle($1, '2026-03-31'::date) as r`,
        [ids.subscriptionA],
      )
      // Rejouer ne doit jamais produire un second courriel.
      expect(second.rows[0].r.reminders_sent).toEqual([])
    })
  })

  it('recommence une série de rappels après renouvellement', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-03-31')
      await c.query(`select app.advance_subscription_lifecycle($1, '2026-03-31'::date)`, [
        ids.subscriptionA,
      ])

      await setPeriod(c, actors.ownerA, '2026-04-30')
      const { rows } = await c.query(
        `select app.advance_subscription_lifecycle($1, '2026-04-24'::date) as r`,
        [ids.subscriptionA],
      )
      expect(rows[0].r.reminders_sent).toEqual(['reminder_j7'])
    })
  })

  it('bascule en lecture seule puis en blocage sans supprimer une seule ligne', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-03-31')

      const before = await c.query(
        `select (select count(*) from purchases where tenant_id = $1) as p,
                (select count(*) from advances  where tenant_id = $1) as a,
                (select count(*) from expenses  where tenant_id = $1) as e`,
        [ids.tenantA],
      )

      await c.query(`select app.advance_subscription_lifecycle($1, '2026-04-10'::date)`, [
        ids.subscriptionA,
      ])
      let status = await c.query(`select status from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])
      expect(status.rows[0].status).toBe('suspended_read_only')

      await c.query(`select app.advance_subscription_lifecycle($1, '2026-05-15'::date)`, [
        ids.subscriptionA,
      ])
      status = await c.query(`select status, blocked_at from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])
      expect(status.rows[0].status).toBe('suspended')
      expect(status.rows[0].blocked_at).not.toBeNull()

      const after = await c.query(
        `select (select count(*) from purchases where tenant_id = $1) as p,
                (select count(*) from advances  where tenant_id = $1) as a,
                (select count(*) from expenses  where tenant_id = $1) as e`,
        [ids.tenantA],
      )
      expect(after.rows[0]).toEqual(before.rows[0])
    })
  })

  it('n’émet aucun événement quand la bascule n’apporte rien', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-03-31')
      await c.query(`select app.advance_subscription_lifecycle($1, '2026-04-10'::date)`, [
        ids.subscriptionA,
      ])

      const { rows } = await c.query(
        `select app.advance_subscription_lifecycle($1, '2026-04-11'::date) as r`,
        [ids.subscriptionA],
      )
      expect(rows[0].r.status_changed).toBe(false)
    })
  })

  it('ne ramène pas de force un abonnement en attente de paiement à « actif »', async () => {
    await withUser(actors.ownerA, async (c) => {
      await setPeriod(c, actors.ownerA, '2026-12-31', 'pending_payment')
      const { rows } = await c.query(
        `select app.advance_subscription_lifecycle($1, '2026-06-01'::date) as r`,
        [ids.subscriptionA],
      )
      expect(rows[0].r.new_status).toBe('pending_payment')
      expect(rows[0].r.status_changed).toBe(false)
    })
  })

  it('bloque l’écriture métier mais laisse la lecture ouverte en lecture seule', async () => {
    await withUser(actors.ownerReadOnly, async (c) => {
      const readable = await c.query(`select count(*)::int as n from partner_companies`)
      expect(readable.rows[0].n).toBeGreaterThanOrEqual(0)

      const { rows } = await c.query(`select app.tenant_can_write() as ok`)
      expect(rows[0].ok).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Clôture et réouverture de campagne
// ---------------------------------------------------------------------------

describe('clôture de campagne', () => {
  it('énumère les obstacles au lieu de refuser sans explication', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.campaign_closure_blockers($1) as r`, [
        ids.campaignA,
      ])

      expect(rows[0].r.can_close).toBe(false)
      const codes = (rows[0].r.blockers as Array<{ code: string }>).map((b) => b.code)
      // Le jeu de démonstration porte une avance décaissée non couverte et un
      // transfert en transit.
      expect(codes).toEqual(
        expect.arrayContaining(['avances_non_couvertes', 'transferts_en_cours']),
      )
      for (const blocker of rows[0].r.blockers as Array<{ message: string }>) {
        expect(blocker.message.length).toBeGreaterThan(10)
      }
    })
  })

  it('refuse la clôture tant qu’un obstacle subsiste', async () => {
    await withUser(actors.managerA, async (c) => {
      await expect(c.query(`select app.close_campaign($1)`, [ids.campaignA])).rejects.toThrow(
        /Clôture impossible/i,
      )
    })
  })

  it('refuse une clôture forcée dont le motif n’explique rien', async () => {
    await withUser(actors.managerA, async (c) => {
      await expect(
        c.query(`select app.close_campaign($1, 'trop court', true)`, [ids.campaignA]),
      ).rejects.toThrow(/20 caractères/i)
    })
  })

  it('accepte une clôture forcée motivée', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `select app.close_campaign($1, $2, true)`,
        [
          ids.campaignA,
          'Clôture forcée : avance AV-001 traitée hors système, transfert TR-0001 annulé par la société.',
        ],
      )

      const { rows } = await c.query(`select status from campaigns where id = $1`, [ids.campaignA])
      expect(rows[0].status).toBe('cloturee')
    })
  })

  it('inscrit les obstacles contournés dans le journal d’audit', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `select app.close_campaign($1, $2, true)`,
        [ids.campaignA, 'Clôture forcée pour arrêté de campagne, obstacles traités hors système.'],
      )

      const { rows } = await c.query(
        `select new_value, justification from audit_log
          where table_name = 'campaigns' and record_id = $1 and new_value ? 'forced'
          order by occurred_at desc limit 1`,
        [ids.campaignA],
      )

      expect(rows[0].new_value.forced).toBe(true)
      // Une clôture forcée dont on ne peut pas reconstituer l'état serait pire
      // qu'une campagne restée ouverte.
      expect(Array.isArray(rows[0].new_value.blockers)).toBe(true)
      expect(rows[0].new_value.blockers.length).toBeGreaterThan(0)
    })
  })

  it('refuse toute écriture sur une campagne clôturée', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `select app.close_campaign($1, $2, true)`,
        [ids.campaignA, 'Clôture forcée pour test d’écriture après arrêté de campagne.'],
      )

      await expect(
        c.query(
          `insert into expenses
             (id, tenant_id, category_id, campaign_id, expense_date, amount,
              beneficiary, payment_method, status)
           values (gen_random_uuid(), $1, $2, $3, current_date, 50000, 'Test', 'cash', 'brouillon')`,
          [ids.tenantA, ids.categoryTransport, ids.campaignA],
        ),
      ).rejects.toThrow(/campagne est clôturée/i)
    })
  })

  it('reste idempotente : reclôturer ne produit ni erreur ni second événement', async () => {
    await withUser(actors.managerA, async (c) => {
      const reason = 'Clôture forcée, obstacles connus et traités hors système.'
      await c.query(`select app.close_campaign($1, $2, true)`, [ids.campaignA, reason])
      await c.query(`select app.close_campaign($1, $2, true)`, [ids.campaignA, reason])

      const { rows } = await c.query(
        `select count(*)::int as n from audit_log
          where table_name = 'campaigns' and record_id = $1
            and new_value ? 'forced'`,
        [ids.campaignA],
      )
      expect(rows[0].n).toBe(1)
    })
  })
})

describe('réouverture de campagne', () => {
  it('rend la campagne écrivable et laisse une trace motivée', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(
        `select app.close_campaign($1, $2, true)`,
        [ids.campaignA, 'Clôture forcée pour arrêté, réouverture prévue après vérification.'],
      )

      await c.query(`select app.reopen_campaign($1, $2)`, [
        ids.campaignA,
        'Facture fournisseur reçue après clôture, à intégrer au TCB de la campagne.',
      ])

      const campaign = await c.query(
        `select status, reopen_reason, reopened_by from campaigns where id = $1`,
        [ids.campaignA],
      )
      expect(campaign.rows[0].status).toBe('reouverte')
      expect(campaign.rows[0].reopened_by).toBe(ids.ownerA)

      // Une campagne rouverte redevient écrivable : c'est le but.
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, campaign_id, expense_date, amount,
            beneficiary, payment_method, status)
         values (gen_random_uuid(), $1, $2, $3, current_date, 50000, 'Test', 'cash', 'brouillon')`,
        [ids.tenantA, ids.categoryTransport, ids.campaignA],
      )
    })
  })

  it('exige un motif d’au moins dix caractères', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(
        `select app.close_campaign($1, $2, true)`,
        [ids.campaignA, 'Clôture forcée pour test du motif de réouverture insuffisant.'],
      )

      await expect(
        c.query(`select app.reopen_campaign($1, 'erreur')`, [ids.campaignA]),
      ).rejects.toThrow(/10 caractères/i)
    })
  })

  it('reste réservée au propriétaire', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `select app.close_campaign($1, $2, true)`,
        [ids.campaignA, 'Clôture forcée pour vérifier le cloisonnement de la réouverture.'],
      )

      await expect(
        c.query(`select app.reopen_campaign($1, $2)`, [
          ids.campaignA,
          'Tentative de réouverture par un gestionnaire.',
        ]),
      ).rejects.toThrow(/Seul le propriétaire/i)
    })
  })
})

// ---------------------------------------------------------------------------
// Conservation
// ---------------------------------------------------------------------------

describe('conservation des données', () => {
  it('décrit ce qui dépasse la durée sans rien supprimer', async () => {
    await withUser(actors.ownerA, async (c) => {
      const before = await c.query(`select count(*)::int as n from campaigns where tenant_id = $1`, [
        ids.tenantA,
      ])

      const { rows } = await c.query(`select app.archival_candidates($1, 90) as r`, [ids.tenantA])

      expect(rows[0].r.deletion_performed).toBe(false)
      expect(rows[0].r.retention_days).toBe(90)
      expect(rows[0].r.note).toContain('Aucune suppression automatique')

      const after = await c.query(`select count(*)::int as n from campaigns where tenant_id = $1`, [
        ids.tenantA,
      ])
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  it('n’expose rien d’un autre tenant', async () => {
    await withUser(actors.ownerB, async (c) => {
      await expect(c.query(`select app.archival_candidates($1, 90)`, [ids.tenantA])).rejects.toThrow(
        /non autorisée/i,
      )
    })
  })
})
