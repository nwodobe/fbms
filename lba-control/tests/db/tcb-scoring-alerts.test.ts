/**
 * Phase 5 · dépenses, allocations, TCB, marges, scoring et alertes, en base.
 *
 * Ce que ces tests protègent :
 *
 *   · qu'un coût ne soit jamais compté deux fois — ni l'achat via une dépense,
 *     ni l'avance via l'achat qu'elle finance ;
 *   · qu'une charge indirecte ne disparaisse pas silencieusement quand sa clé
 *     de répartition vaut zéro ;
 *   · qu'un TCB par kilo absent reste NULL et ne devienne jamais zéro ;
 *   · qu'aucun score ne modifie de lui-même le plafond d'un pisteur.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { expectRejected, pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

// ---------------------------------------------------------------------------
// Discipline de la dépense
// ---------------------------------------------------------------------------

describe('cycle de vie d’une dépense', () => {
  it('refuse la catégorie réservée au système (anti double comptage)', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into expenses
         (id, tenant_id, category_id, campaign_id, expense_date, amount,
          beneficiary, payment_method, status)
       values (gen_random_uuid(), $1, $2, $3, current_date, 100000, 'Test', 'cash', 'brouillon')`,
      [ids.tenantA, ids.categoryProduct, ids.campaignA],
    )
    expect(message).toMatch(/réservée au système/i)
  })

  it('interdit de modifier le montant d’une dépense validée', async () => {
    const message = await expectRejected(
      actors.managerA,
      `update expenses set amount = 999999 where id = $1`,
      [ids.expenseA1],
    )
    expect(message).toMatch(/ne peut plus changer de montant/i)
  })

  it('interdit qu’une dépense soit validée par celui qui l’a soumise', async () => {
    await withUser(actors.managerA, async (c) => {
      const id = '00000000-0000-4000-8000-000000000501'
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, campaign_id, expense_date, amount,
            beneficiary, payment_method, status, submitted_by)
         values ($1, $2, $3, $4, current_date, 75000, 'Garage Kouassi', 'cash', 'soumise', $5)`,
        [id, ids.tenantA, ids.categoryTransport, ids.campaignA, ids.managerA],
      )

      await expect(
        c.query(`update expenses set status = 'validee', validated_by = $2 where id = $1`, [
          id,
          ids.managerA,
        ]),
      ).rejects.toThrow(/validée par la personne qui l'a soumise/i)
    })
  })

  it('signale un doublon probable sans bloquer la saisie', async () => {
    await withUser(actors.managerA, async (c) => {
      const first = '00000000-0000-4000-8000-000000000510'
      const second = '00000000-0000-4000-8000-000000000511'

      for (const id of [first, second]) {
        await c.query(
          `insert into expenses
             (id, tenant_id, category_id, campaign_id, expense_date, amount,
              beneficiary, payment_method, reference, status)
           values ($1, $2, $3, $4, current_date, 180000, 'Transporteur Diallo', 'cash', 'FA-778', 'soumise')`,
          [id, ids.tenantA, ids.categoryTransport, ids.campaignA],
        )
      }

      const { rows } = await c.query(
        `select similarity_score, matched_criteria, status
         from expense_duplicate_flags where expense_id = $1`,
        [second],
      )

      // Signalé, jamais refusé : deux dépenses identiques peuvent être réelles.
      expect(rows).toHaveLength(1)
      expect(Number(rows[0].similarity_score)).toBeGreaterThanOrEqual(60)
      expect(rows[0].matched_criteria).toEqual(
        expect.arrayContaining(['categorie', 'beneficiaire', 'date', 'montant', 'reference']),
      )
      expect(rows[0].status).toBe('a_verifier')
    })
  })
})

// ---------------------------------------------------------------------------
// Répartition des charges indirectes
// ---------------------------------------------------------------------------

async function createIndirectExpense(
  c: import('pg').PoolClient,
  id: string,
  amount: number,
): Promise<void> {
  await c.query(
    `insert into expenses
       (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary,
        payment_method, nature, allocation_key, status, validated_by, validated_at)
     values ($1, $2, $3, $4, current_date, $5, 'Gardiennage magasin', 'cash',
             'indirect', 'poids_accepte', 'validee', $6, now())`,
    [id, ids.tenantA, ids.categoryTransport, ids.campaignA, amount, ids.ownerA],
  )
}

describe('répartition des charges indirectes', () => {
  it('refuse de répartir sur une clé dont la base est nulle', async () => {
    await withUser(actors.managerA, async (c) => {
      const id = '00000000-0000-4000-8000-000000000520'
      await createIndirectExpense(c, id, 400_000)

      // Aucun transfert réceptionné : le poids accepté vaut zéro. Répartir
      // produirait des quotes-parts nulles et effacerait la charge du TCB.
      await expect(
        c.query(`select app.allocate_indirect_expense($1, 'poids_accepte', 'partner', $2)`, [
          id,
          [ids.partnerOlam, ids.partnerDorado],
        ]),
      ).rejects.toThrow(/vaut zéro sur ce périmètre/i)
    })
  })

  it('répartit au prorata et rend exactement le montant réparti', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update transfers set accepted_kg = 8000, net_unloaded_kg = 8000, status = 'receptionne'
         where id = $1`,
        [ids.transferA1],
      )
      await c.query(
        `insert into transfers
           (id, tenant_id, transfer_number, partner_company_id, campaign_id,
            net_loaded_kg, net_unloaded_kg, accepted_kg, weight_source, status)
         values ($1, $2, 'TR-9002', $3, $4, 2000, 2000, 2000, 'verified', 'receptionne')`,
        ['00000000-0000-4000-8000-000000000530', ids.tenantA, ids.partnerDorado, ids.campaignA],
      )

      const id = '00000000-0000-4000-8000-000000000521'
      await createIndirectExpense(c, id, 400_000)

      const { rows } = await c.query(
        `select app.allocate_indirect_expense($1, 'poids_accepte', 'partner', $2) as result`,
        [id, [ids.partnerOlam, ids.partnerDorado]],
      )

      expect(Number(rows[0].result.total_base_value)).toBe(10_000)
      expect(Number(rows[0].result.allocated_total)).toBe(400_000)

      const lines = rows[0].result.lines as Array<{ target_id: string; allocated_amount: string }>
      const olam = lines.find((line) => line.target_id === ids.partnerOlam)
      expect(Number(olam?.allocated_amount)).toBe(320_000)
    })
  })

  it('ne calcule jamais une clé manuelle', async () => {
    await withUser(actors.managerA, async (c) => {
      const id = '00000000-0000-4000-8000-000000000522'
      await createIndirectExpense(c, id, 100_000)

      await expect(
        c.query(`select app.allocate_indirect_expense($1, 'manuel', 'partner', $2)`, [
          id,
          [ids.partnerOlam],
        ]),
      ).rejects.toThrow(/n'est pas calculable/i)
    })
  })

  it('refuse de répartir une dépense non validée', async () => {
    await withUser(actors.managerA, async (c) => {
      const id = '00000000-0000-4000-8000-000000000523'
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary,
            payment_method, nature, allocation_key, status)
         values ($1, $2, $3, $4, current_date, 50000, 'Gardiennage', 'cash',
                 'indirect', 'poids_accepte', 'brouillon')`,
        [id, ids.tenantA, ids.categoryTransport, ids.campaignA],
      )

      await expect(
        c.query(`select app.allocate_indirect_expense($1, 'poids_accepte', 'partner', $2)`, [
          id,
          [ids.partnerOlam],
        ]),
      ).rejects.toThrow(/dépense validée se répartit/i)
    })
  })

  it('remplace intégralement une répartition précédente au lieu de l’empiler', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set accepted_kg = 8000, status = 'receptionne' where id = $1`, [
        ids.transferA1,
      ])

      const id = '00000000-0000-4000-8000-000000000524'
      await createIndirectExpense(c, id, 300_000)

      await c.query(`select app.allocate_indirect_expense($1, 'poids_accepte', 'partner', $2)`, [
        id,
        [ids.partnerOlam],
      ])
      await c.query(`select app.allocate_indirect_expense($1, 'poids_accepte', 'partner', $2)`, [
        id,
        [ids.partnerOlam],
      ])

      const { rows } = await c.query(
        `select count(*)::int as n, sum(allocated_amount)::numeric as total
         from expense_allocations where expense_id = $1`,
        [id],
      )
      expect(rows[0].n).toBe(1)
      expect(Number(rows[0].total)).toBe(300_000)
    })
  })
})

// ---------------------------------------------------------------------------
// TCB
// ---------------------------------------------------------------------------

describe('calcul du TCB', () => {
  it('additionne achat et dépenses validées sans compter la matière deux fois', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set accepted_kg = 8000, status = 'receptionne' where id = $1`, [
        ids.transferA1,
      ])

      const { rows } = await c.query(
        `select app.compute_tcb('partner', $1, $2) as id`,
        [ids.partnerOlam, ids.campaignA],
      )
      const snapshot = await c.query(`select * from tcb_snapshots where id = $1`, [rows[0].id])
      const s = snapshot.rows[0]

      const purchases = await c.query(
        `select coalesce(sum(amount), 0) as total from purchases
         where partner_company_id = $1 and campaign_id = $2 and status in ('valide', 'paye')`,
        [ids.partnerOlam, ids.campaignA],
      )

      expect(Number(s.purchase_value)).toBe(Number(purchases.rows[0].total))
      expect(Number(s.direct_expenses)).toBe(250_000)
      expect(Number(s.tcb_total)).toBe(
        Number(s.purchase_value) +
          Number(s.direct_expenses) +
          Number(s.indirect_allocated) +
          Number(s.valued_losses),
      )
    })
  })

  it('ne compte jamais une avance décaissée comme un coût', async () => {
    await withUser(actors.managerA, async (c) => {
      const before = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])
      const beforeTotal = await c.query(`select tcb_total from tcb_snapshots where id = $1`, [
        before.rows[0].id,
      ])

      await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
            payment_method, status, disbursed_at, created_by, approved_by)
         values ($1, $2, $3, $4, 1500000, 'cash', 'decaisse', now(), $5, $6)`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
      )

      const after = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])
      const afterTotal = await c.query(`select tcb_total from tcb_snapshots where id = $1`, [
        after.rows[0].id,
      ])

      // Une remise de fonds n'est pas un coût : le coût naît de l'achat.
      expect(Number(afterTotal.rows[0].tcb_total)).toBe(Number(beforeTotal.rows[0].tcb_total))
    })
  })

  it('laisse le TCB par kilo NULL quand aucun kilo n’est accepté', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set accepted_kg = null where tenant_id = $1`, [ids.tenantA])

      const { rows } = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])
      const snapshot = await c.query(`select * from tcb_snapshots where id = $1`, [rows[0].id])

      expect(snapshot.rows[0].tcb_per_accepted_kg).toBeNull()
      expect(Number(snapshot.rows[0].tcb_total)).toBeGreaterThan(0)
      expect(snapshot.rows[0].inputs.note).toContain('non calculable')
    })
  })

  it('écarte une dépense rejetée et retient une dépense validée non payée', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, partner_company_id, campaign_id, expense_date,
            amount, beneficiary, payment_method, status, rejected_by, rejected_at, rejection_reason)
         values (gen_random_uuid(), $1, $2, $3, $4, current_date, 500000, 'Fournisseur X',
                 'cash', 'rejetee', $5, now(), 'Facture non conforme au marché')`,
        [ids.tenantA, ids.categoryTransport, ids.partnerOlam, ids.campaignA, ids.ownerA],
      )

      const { rows } = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])
      const snapshot = await c.query(`select direct_expenses from tcb_snapshots where id = $1`, [
        rows[0].id,
      ])

      // La dépense validée de 250 000 est là ; la rejetée de 500 000 ne l'est pas.
      expect(Number(snapshot.rows[0].direct_expenses)).toBe(250_000)
    })
  })

  it('produit une décomposition qui reconstitue le total', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set accepted_kg = 8000, status = 'receptionne' where id = $1`, [
        ids.transferA1,
      ])

      const { rows } = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])

      const check = await c.query(
        `select ts.tcb_total,
                (select coalesce(sum(amount), 0) from tcb_snapshot_components
                  where snapshot_id = ts.id) as components_total
         from tcb_snapshots ts where ts.id = $1`,
        [rows[0].id],
      )

      expect(Number(check.rows[0].components_total)).toBe(Number(check.rows[0].tcb_total))
    })
  })
})

// ---------------------------------------------------------------------------
// Marges
// ---------------------------------------------------------------------------

describe('marges', () => {
  it('écrit les deux marges et conserve leur écart de réconciliation', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set accepted_kg = 8000, status = 'receptionne' where id = $1`, [
        ids.transferA1,
      ])
      const snap = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])
      const before = await c.query(
        `select tcb_total, tcb_per_accepted_kg from tcb_snapshots where id = $1`,
        [snap.rows[0].id],
      )

      const tcbTotal = Number(before.rows[0].tcb_total)
      const perKg = Number(before.rows[0].tcb_per_accepted_kg)
      // Chiffre d'affaires amputé d'une retenue forfaitaire de 150 000 hors
      // prix au kilo : les deux marges divergent, et c'est une information.
      const netRevenue = tcbTotal + 70_000 - 150_000
      const netPrice = perKg + 8.75

      const { rows } = await c.query(`select app.record_margin($1, $2, $3) as m`, [
        snap.rows[0].id,
        netRevenue,
        netPrice,
      ])

      expect(Number(rows[0].m.margin_total)).toBeCloseTo(-80_000, 0)
      expect(Number(rows[0].m.implied_margin)).toBeCloseTo(70_000, 0)
      expect(Number(rows[0].m.margin_reconciliation_gap)).toBeCloseTo(-150_000, 0)
      expect(rows[0].m.is_deficit).toBe(true)
    })
  })

  it('laisse la marge au kilo absente quand le TCB par kilo l’est aussi', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set accepted_kg = null where tenant_id = $1`, [ids.tenantA])
      const snap = await c.query(`select app.compute_tcb('partner', $1, $2) as id`, [
        ids.partnerOlam,
        ids.campaignA,
      ])

      const { rows } = await c.query(`select app.record_margin($1, 4000000, 500) as m`, [
        snap.rows[0].id,
      ])

      expect(rows[0].m.margin_per_kg).toBeNull()
      expect(rows[0].m.margin_reconciliation_gap).toBeNull()
      expect(Number(rows[0].m.margin_total)).not.toBeNaN()
    })
  })
})

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('scoring des pisteurs', () => {
  it('n’écrit aucune composante sans observation, au lieu de noter zéro', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.compute_agent_score($1, $2) as id`, [
        ids.agentA1,
        ids.campaignA,
      ])

      const components = await c.query(
        `select component, value, weight from agent_score_components where score_id = $1`,
        [rows[0].id],
      )

      // Aucune ligne « gestion_sacs » : le pisteur n'a reçu aucune dotation.
      expect(components.rows.map((row) => row.component)).not.toContain('gestion_sacs')
      expect(components.rows.length).toBeGreaterThan(0)
      expect(components.rows.every((row) => Number(row.value) >= 0)).toBe(true)
    })
  })

  it('renormalise les poids pour que le score reste sur 100', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.compute_agent_score($1, $2) as id`, [
        ids.agentA1,
        ids.campaignA,
      ])

      const score = await c.query(`select raw_score from agent_scores where id = $1`, [rows[0].id])
      const sum = await c.query(
        `select round(sum(weighted_value), 2) as total from agent_score_components where score_id = $1`,
        [rows[0].id],
      )

      expect(Number(score.rows[0].raw_score)).toBeLessThanOrEqual(100)
      expect(Number(score.rows[0].raw_score)).toBeCloseTo(Number(sum.rows[0].total), 1)
    })
  })

  it('ne prononce aucune catégorie sans maturité suffisante', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.compute_agent_score($1, $2) as id`, [
        ids.agentA1,
        ids.campaignA,
      ])
      const score = await c.query(
        `select maturity, category, recommended_ceiling from agent_scores where id = $1`,
        [rows[0].id],
      )

      // Le jeu de démonstration compte deux achats : c'est une pointe, pas un
      // historique. Aucune catégorie ne peut être prononcée sur cette base.
      expect(score.rows[0].maturity).toBe('non_evalue')
      expect(score.rows[0].category).toBe('non_evalue')
      expect(score.rows[0].recommended_ceiling).toBeNull()
    })
  })

  it('ne modifie jamais le plafond réel du pisteur', async () => {
    await withUser(actors.managerA, async (c) => {
      const before = await c.query(`select ceiling_amount from field_agents where id = $1`, [
        ids.agentA1,
      ])
      await c.query(`select app.compute_agent_score($1, $2)`, [ids.agentA1, ids.campaignA])
      const after = await c.query(`select ceiling_amount from field_agents where id = $1`, [
        ids.agentA1,
      ])

      expect(Number(after.rows[0].ceiling_amount)).toBe(Number(before.rows[0].ceiling_amount))
    })
  })

  it('exige un motif d’au moins dix caractères pour ajuster un score', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.compute_agent_score($1, $2) as id`, [
        ids.agentA1,
        ids.campaignA,
      ])

      await expect(
        c.query(`select app.adjust_agent_score($1, 5, 'ok')`, [rows[0].id]),
      ).rejects.toThrow(/motif d'au moins 10 caractères/i)
    })
  })

  it('applique un ajustement motivé au score affiché sans toucher au score brut', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.compute_agent_score($1, $2) as id`, [
        ids.agentA1,
        ids.campaignA,
      ])
      const before = await c.query(
        `select raw_score, event_adjusted_score, adjusted_score from agent_scores where id = $1`,
        [rows[0].id],
      )

      await c.query(
        `select app.adjust_agent_score($1, -10, 'Retards imputables au retard de financement du siège')`,
        [rows[0].id],
      )

      const after = await c.query(
        `select raw_score, event_adjusted_score, adjusted_score from agent_scores where id = $1`,
        [rows[0].id],
      )

      expect(Number(after.rows[0].raw_score)).toBe(Number(before.rows[0].raw_score))
      expect(Number(after.rows[0].event_adjusted_score)).toBe(
        Number(before.rows[0].event_adjusted_score),
      )
      expect(Number(after.rows[0].adjusted_score)).toBeCloseTo(
        Math.max(0, Number(before.rows[0].event_adjusted_score) - 10),
        1,
      )

      const trace = await c.query(
        `select delta, reason, adjusted_by from agent_score_adjustments where score_id = $1`,
        [rows[0].id],
      )
      expect(trace.rows).toHaveLength(1)
      expect(trace.rows[0].adjusted_by).toBe(ids.managerA)
    })
  })
})

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------

describe('alertes', () => {
  it('installe les vingt règles avec leurs seuils par défaut', async () => {
    await withUser(actors.ownerA, async (c) => {
      const inserted = await c.query(`select app.seed_alert_rules($1) as n`, [ids.tenantA])
      expect(inserted.rows[0].n).toBe(20)

      const { rows } = await c.query(
        `select count(*)::int as n from alert_rules where tenant_id = $1 and is_active`,
        [ids.tenantA],
      )
      expect(rows[0].n).toBe(20)
    })
  })

  it('ouvre une alerte mesurée, avec sa valeur et son seuil', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
            payment_method, status, disbursed_at, issued_at, created_by, approved_by)
         values ($1, $2, $3, $4, 900000, 'cash', 'decaisse',
                 now() - interval '20 days', now() - interval '20 days', $5, $6)`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
      )

      await c.query(`select app.evaluate_alerts($1)`, [ids.tenantA])

      const { rows } = await c.query(
        `select alert_type, measured_value, threshold_value, message, severity
         from alerts where tenant_id = $1 and alert_type = 'avance_non_couverte'`,
        [ids.tenantA],
      )

      expect(rows).toHaveLength(1)
      expect(Number(rows[0].measured_value)).toBe(20)
      expect(Number(rows[0].threshold_value)).toBe(15)
      expect(rows[0].severity).toBe('critique')
    })
  })

  it('ne réouvre pas la même alerte à chaque évaluation', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
            payment_method, status, disbursed_at, issued_at, created_by, approved_by)
         values ($1, $2, $3, $4, 900000, 'cash', 'decaisse',
                 now() - interval '20 days', now() - interval '20 days', $5, $6)`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
      )

      await c.query(`select app.evaluate_alerts($1)`, [ids.tenantA])
      const second = await c.query(`select app.evaluate_alerts($1) as n`, [ids.tenantA])

      // Rejouer l'évaluation n'ouvre rien de neuf : cent alertes identiques ne
      // seraient plus lues par personne.
      expect(second.rows[0].n).toBe(0)

      const { rows } = await c.query(
        `select count(*)::int as n from alerts where tenant_id = $1 and status = 'ouverte'`,
        [ids.tenantA],
      )
      expect(rows[0].n).toBeGreaterThan(0)
      const duplicates = await c.query(
        `select dedupe_key, count(*)::int as n from alerts
         where tenant_id = $1 and status = 'ouverte' group by dedupe_key having count(*) > 1`,
        [ids.tenantA],
      )
      expect(duplicates.rows).toEqual([])
    })
  })

  it('respecte un seuil relevé par l’entreprise', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(
        `update alert_rules set threshold = '{"days": 60, "amount": 0}'
         where tenant_id = $1 and alert_type = 'avance_non_couverte'`,
        [ids.tenantA],
      )
      await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
            payment_method, status, disbursed_at, issued_at, created_by, approved_by)
         values ($1, $2, $3, $4, 900000, 'cash', 'decaisse',
                 now() - interval '20 days', now() - interval '20 days', $5, $6)`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
      )

      await c.query(`select app.evaluate_alerts($1)`, [ids.tenantA])

      const { rows } = await c.query(
        `select count(*)::int as n from alerts
         where tenant_id = $1 and alert_type = 'avance_non_couverte'`,
        [ids.tenantA],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it('reste silencieux quand la règle est désactivée', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(`update alert_rules set is_active = false where tenant_id = $1`, [ids.tenantA])
      const { rows } = await c.query(`select app.evaluate_alerts($1) as n`, [ids.tenantA])
      expect(rows[0].n).toBe(0)
    })
  })

  it('n’expose jamais les alertes d’une autre entreprise', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(
        `insert into alerts (tenant_id, alert_type, severity, title, message)
         values ($1, 'stock_insuffisant', 'critique', 'Test', 'Message')`,
        [ids.tenantA],
      )
    })

    await withUser(actors.ownerB, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from alerts`)
      expect(rows[0].n).toBe(0)
    })
  })

  it('formule les alertes d’exposition comme des constats, sans accusation', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
            payment_method, status, disbursed_at, issued_at, created_by, approved_by)
         values ($1, $2, $3, $4, 1500000, 'cash', 'decaisse',
                 now() - interval '13 days', now() - interval '13 days', $5, $6)`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
      )

      await c.query(`select app.evaluate_alerts($1)`, [ids.tenantA])

      const { rows } = await c.query(
        `select message from alerts
         where tenant_id = $1 and alert_type = 'argent_chez_pisteur_trop_longtemps'`,
        [ids.tenantA],
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].message).toMatch(/détient une exposition/i)
      expect(rows[0].message).not.toMatch(/détourn|vol|retient/i)
    })
  })
})
