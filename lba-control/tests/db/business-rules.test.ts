/**
 * Règles métier appliquées en base (RG-01 → RG-16 du TEST_PLAN.md).
 *
 * Ces règles protègent de l'argent. Elles sont donc vérifiées au niveau où
 * personne ne peut les contourner — pas dans un formulaire.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { affectedRows, expectRejected, pool, switchActor, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

// ---------------------------------------------------------------------------
// RG-01 · Aucun mélange de financement entre sociétés (CA-02)
// ---------------------------------------------------------------------------

describe('RG-01 · les financements ne se mélangent pas entre sociétés', () => {
  it('une avance DORADO ne peut pas puiser dans un financement OLAM', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, funding_id, campaign_id,
          amount, payment_method, created_by)
       values ($1, $2, $3, $4, $5, 1000000, 'wave', $6)`,
      [ids.tenantA, ids.agentA1, ids.partnerDorado, ids.fundingOlam, ids.campaignA, ids.managerA],
    )
    expect(message).toMatch(/financement d'une autre société|financement d’une autre société/i)
  })

  it('une avance OLAM sur un financement OLAM est acceptée', async () => {
    const n = await affectedRows(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, funding_id, campaign_id,
          amount, payment_method, created_by)
       values ($1, $2, $3, $4, $5, 1000000, 'wave', $6)`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.fundingOlam, ids.campaignA, ids.managerA],
    )
    expect(n).toBe(1)
  })

  it('un achat DORADO rattaché à une avance OLAM est refusé', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into purchases
         (id, tenant_id, field_agent_id, partner_company_id, campaign_id, advance_id,
          purchased_at, net_weight_kg, price_per_kg, amount, payment_method)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, now(), 100, 430, 43000, 'cash')`,
      [ids.tenantA, ids.agentA1, ids.partnerDorado, ids.campaignA, ids.advanceA1],
    )
    expect(message).toMatch(/financement d'une autre société|financement d’une autre société/i)
  })
})

// ---------------------------------------------------------------------------
// RG-02 → RG-04 · Stock : double réservation, dépassement, valeur négative
// ---------------------------------------------------------------------------

describe('RG-02/03/04 · intégrité du stock', () => {
  it('la réservation d’un lot disponible réussit', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(`select app.reserve_stock($1, $2, 8000, $3) as id`, [
        ids.lotA1, ids.planA1, ids.partnerOlam,
      ])
      expect(rows[0].id).toBeTruthy()
    })
  })

  it('une seconde réservation au-delà du solde disponible est refusée (CA-04)', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`select app.reserve_stock($1, $2, 8000, $3)`, [ids.lotA1, ids.planA1, ids.partnerOlam])

      await expect(
        c.query(`select app.reserve_stock($1, $2, 5000, $3)`, [ids.lotA1, ids.planA1, ids.partnerOlam]),
      ).rejects.toThrow(/dépasse le stock disponible non réservé/i)
    })
  })

  it('une quantité réservée pour OLAM ne peut pas être promise à DORADO', async () => {
    await withUser(actors.managerA, async (c) => {
      await expect(
        c.query(`select app.reserve_stock($1, $2, 1000, $3)`, [ids.lotA1, ids.planA1, ids.partnerDorado]),
      ).rejects.toThrow(/autre société|réaffectation approuvée/i)
    })
  })

  it('même en insertion directe, la capacité du lot est respectée', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into stock_reservations
         (tenant_id, stock_lot_id, partner_company_id, quantity_kg, status)
       values ($1, $2, $3, 99999, 'active')`,
      [ids.tenantA, ids.lotA1, ids.partnerOlam],
    )
    expect(message).toMatch(/dépasse le stock disponible non réservé/i)
  })

  it('un stock négatif est impossible', async () => {
    const message = await expectRejected(
      actors.managerA,
      `update stock_lots set quantity_kg = -1 where id = $1`,
      [ids.lotA1],
    )
    expect(message).toMatch(/quantity_kg_check|violates check/i)
  })
})

// ---------------------------------------------------------------------------
// RG-05 · Réaffectation inter-sociétés : motif et approbateur obligatoires
// ---------------------------------------------------------------------------

describe('RG-05 · réaffectation inter-sociétés contrôlée (CA-11)', () => {
  it('une réaffectation sans motif est refusée', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into stock_reassignments
         (tenant_id, stock_lot_id, from_partner_company_id, to_partner_company_id,
          quantity_kg, reason, approved_by, created_by)
       values ($1, $2, $3, $4, 100, 'court', $5, $6)`,
      [ids.tenantA, ids.lotA1, ids.partnerOlam, ids.partnerDorado, ids.ownerA, ids.managerA],
    )
    expect(message).toMatch(/reason_check|violates check/i)
  })

  it('le demandeur ne peut pas être son propre approbateur', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into stock_reassignments
         (tenant_id, stock_lot_id, from_partner_company_id, to_partner_company_id,
          quantity_kg, reason, approved_by, created_by)
       values ($1, $2, $3, $4, 100, 'Erreur d''affectation constatée au contrôle', $5, $5)`,
      [ids.tenantA, ids.lotA1, ids.partnerOlam, ids.partnerDorado, ids.managerA],
    )
    expect(message).toMatch(/approver_is_not_requester/i)
  })

  it('une réaffectation motivée et approuvée par un tiers est acceptée', async () => {
    const n = await affectedRows(
      actors.managerA,
      `insert into stock_reassignments
         (tenant_id, stock_lot_id, from_partner_company_id, to_partner_company_id,
          quantity_kg, reason, approved_by, created_by)
       values ($1, $2, $3, $4, 100, 'Erreur d''affectation constatée au contrôle qualité', $5, $6)`,
      [ids.tenantA, ids.lotA1, ids.partnerOlam, ids.partnerDorado, ids.ownerA, ids.managerA],
    )
    expect(n).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// RG-06 / RG-07 · Les prix ne sont jamais écrasés
// ---------------------------------------------------------------------------

describe('RG-06/07 · historisation des prix', () => {
  it('deux prix actifs du même type ne peuvent pas se chevaucher', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into negotiated_prices (tenant_id, contract_id, price_type, price, valid_from)
       values ($1, $2, 'negocie', 460, current_date - 10)`,
      [ids.tenantA, ids.contractOlam],
    )
    expect(message).toMatch(/negotiated_prices_no_overlap|conflicting key|exclusion/i)
  })

  it('un prix déjà utilisé ne peut plus être modifié', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update purchases set applied_price_id = $1 where id = $2`, [
        ids.priceOlam, ids.purchaseA1,
      ])
      await expect(
        c.query(`update negotiated_prices set price = 999 where id = $1`, [ids.priceOlam]),
      ).rejects.toThrow(/nouvelle version avec date d'effet|nouvelle version avec date d’effet/i)
    })
  })

  it('une nouvelle version sur une période distincte est acceptée', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update negotiated_prices set valid_to = current_date where id = $1`, [ids.priceOlam])
      const res = await c.query(
        `insert into negotiated_prices (tenant_id, contract_id, price_type, price, valid_from, version)
         values ($1, $2, 'negocie', 465, current_date + 1, 2)`,
        [ids.tenantA, ids.contractOlam],
      )
      expect(res.rowCount).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// RG-08 · Achat propre du LBA (arbitrage D9)
// ---------------------------------------------------------------------------

describe('RG-08 · achat sans société partenaire', () => {
  it('un achat sans société et non déclaré « compte propre » est refusé', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into purchases
         (id, tenant_id, field_agent_id, campaign_id, purchased_at,
          net_weight_kg, price_per_kg, amount, payment_method)
       values (gen_random_uuid(), $1, $2, $3, now(), 100, 430, 43000, 'cash')`,
      [ids.tenantA, ids.agentA1, ids.campaignA],
    )
    expect(message).toMatch(/partner_or_own_account/i)
  })

  it('un achat explicitement « compte propre » est accepté', async () => {
    const n = await affectedRows(
      actors.managerA,
      `insert into purchases
         (id, tenant_id, field_agent_id, campaign_id, purchased_at,
          net_weight_kg, price_per_kg, amount, payment_method, is_own_account)
       values (gen_random_uuid(), $1, $2, $3, now(), 100, 430, 43000, 'cash', true)`,
      [ids.tenantA, ids.agentA1, ids.campaignA],
    )
    expect(n).toBe(1)
  })

  it('un montant incohérent avec poids × prix est refusé', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into purchases
         (id, tenant_id, field_agent_id, partner_company_id, campaign_id, purchased_at,
          net_weight_kg, price_per_kg, amount, payment_method)
       values (gen_random_uuid(), $1, $2, $3, $4, now(), 100, 430, 999999, 'cash')`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA],
    )
    expect(message).toMatch(/amount_matches_weight_and_price/i)
  })
})

// ---------------------------------------------------------------------------
// RG-09 · Les quatre poids restent distincts (CA-05)
// ---------------------------------------------------------------------------

describe('RG-09 · quatre poids distincts et écarts calculés', () => {
  it('aucune colonne générique « poids livré » n’existe', async () => {
    const { rows } = await withUser(actors.ownerA, (c) =>
      c.query(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'transfers'
          and column_name ~ 'delivered|livre'
      `),
    )
    expect(rows).toEqual([])
  })

  it('les quatre poids coexistent et les cinq écarts sont calculés', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update transfers
            set net_unloaded_kg = 7940, accepted_kg = 7900, paid_kg = 7850,
                gross_weight_reception_kg = null, tare_reception_kg = null
          where id = $1`,
        [ids.transferA1],
      )
      const { rows } = await c.query(
        `select net_loaded_kg, net_unloaded_kg, accepted_kg, paid_kg,
                ecart_physique_kg, ecart_physique_pct, ecart_acceptation_kg,
                ecart_paiement_kg, ecart_total_acceptation_kg, ecart_financier_total_kg
           from transfers where id = $1`,
        [ids.transferA1],
      )
      const t = rows[0]
      expect(Number(t.net_loaded_kg)).toBe(8000)
      expect(Number(t.ecart_physique_kg)).toBe(60)
      expect(Number(t.ecart_physique_pct)).toBeCloseTo(0.75, 4)
      expect(Number(t.ecart_acceptation_kg)).toBe(40) // déchargé − accepté (CMD §14)
      expect(Number(t.ecart_paiement_kg)).toBe(50) // accepté − payé (CMD §14)
      expect(Number(t.ecart_total_acceptation_kg)).toBe(100) // chargé − accepté (CDC §12.3)
      expect(Number(t.ecart_financier_total_kg)).toBe(150) // chargé − payé (CDC §12.3)
    })
  })

  it('le poids accepté ne peut pas dépasser le poids déchargé', async () => {
    const message = await expectRejected(
      actors.managerA,
      `update transfers set net_unloaded_kg = 7000, accepted_kg = 7500,
              gross_weight_reception_kg = null, tare_reception_kg = null where id = $1`,
      [ids.transferA1],
    )
    expect(message).toMatch(/accepted_within_unloaded/i)
  })

  it('le poids payé ne peut pas dépasser le poids accepté', async () => {
    const message = await expectRejected(
      actors.managerA,
      `update transfers set net_unloaded_kg = 7940, accepted_kg = 7900, paid_kg = 7950,
              gross_weight_reception_kg = null, tare_reception_kg = null where id = $1`,
      [ids.transferA1],
    )
    expect(message).toMatch(/paid_within_accepted/i)
  })

  it('un écart est calculé même sans réception : il reste nul et non trompeur', async () => {
    const { rows } = await withUser(actors.ownerA, (c) =>
      c.query(`select ecart_physique_kg from transfers where id = $1`, [ids.transferA1]),
    )
    expect(rows[0].ecart_physique_kg).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// RG-10 · Un incident bloque la clôture d'un transfert (CA-06)
// ---------------------------------------------------------------------------

describe('RG-10 · incident bloquant', () => {
  it('un transfert ne se clôture pas tant qu’un incident est ouvert', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update transfers set net_unloaded_kg = 7940, accepted_kg = 7900, paid_kg = 7850,
                gross_weight_reception_kg = null, tare_reception_kg = null where id = $1`,
        [ids.transferA1],
      )
      await c.query(
        `insert into incidents
           (tenant_id, reference, type, severity, transfer_id, description, blocks_closure)
         values ($1, 'INC-0001', 'ecart_poids', 'critique', $2,
                 'Écart de 0,75 % supérieur à la tolérance contractuelle', true)`,
        [ids.tenantA, ids.transferA1],
      )
      await expect(
        c.query(`update transfers set status = 'cloture' where id = $1`, [ids.transferA1]),
      ).rejects.toThrow(/incident non résolu/i)
    })
  })

  it('une réception incomplète bloque aussi la clôture', async () => {
    const message = await expectRejected(
      actors.managerA,
      `update transfers set status = 'cloture' where id = $1`,
      [ids.transferA1],
    )
    expect(message).toMatch(/poids déchargé et le poids accepté/i)
  })

  it('une décision d’incident exige une cause qualifiée et un valideur', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into incidents
         (tenant_id, reference, type, transfer_id, description, status)
       values ($1, 'INC-0002', 'ecart_poids', $2, 'Écart constaté', 'decide')`,
      [ids.tenantA, ids.transferA1],
    )
    expect(message).toMatch(/decision_is_qualified/i)
  })
})

// ---------------------------------------------------------------------------
// RG-11 · Pas de double comptage du prix d'achat dans le TCB
// ---------------------------------------------------------------------------

describe('RG-11 · catégories de dépense réservées au système', () => {
  it('une dépense de catégorie « achat produit » saisie à la main est refusée', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `insert into expenses
         (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary, payment_method)
       values (gen_random_uuid(), $1, $2, $3, current_date, 500000, 'Producteur', 'cash')`,
      [ids.tenantA, ids.categoryProduct, ids.campaignA],
    )
    expect(message).toMatch(/réservée au système|compterait deux fois/i)
  })

  it('une dépense de transport ordinaire est acceptée', async () => {
    const n = await affectedRows(
      actors.accountantA,
      `insert into expenses
         (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary, payment_method)
       values (gen_random_uuid(), $1, $2, $3, current_date, 120000, 'Transporteur fictif', 'cash')`,
      [ids.tenantA, ids.categoryTransport, ids.campaignA],
    )
    expect(n).toBe(1)
  })

  it('une dépense indirecte sans clé de répartition est refusée', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `insert into expenses
         (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary,
          payment_method, nature)
       values (gen_random_uuid(), $1, $2, $3, current_date, 50000, 'Bailleur', 'cash', 'indirect')`,
      [ids.tenantA, ids.categoryTransport, ids.campaignA],
    )
    expect(message).toMatch(/indirect_has_key/i)
  })
})

// ---------------------------------------------------------------------------
// RG-12 · Séparation des tâches sur les avances
// ---------------------------------------------------------------------------

describe('RG-12 · séparation des tâches', () => {
  it('le créateur d’une avance ne peut pas l’approuver lui-même', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
          payment_method, created_by, approved_by)
       values ($1, $2, $3, $4, 500000, 'wave', $5, $5)`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.managerA],
    )
    expect(message).toMatch(/creator_is_not_approver/i)
  })

  it('une dérogation de plafond sans motif ni approbateur est refusée', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, campaign_id, amount,
          payment_method, status, requires_override, created_by)
       values ($1, $2, $3, $4, 9000000, 'wave', 'decaisse', true, $5)`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.managerA],
    )
    expect(message).toMatch(/override_is_justified/i)
  })

  it('une dérogation motivée et approuvée passe', async () => {
    const n = await affectedRows(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
          status, requires_override, override_reason, override_approved_by, created_by, approved_by)
       values ($1, $2, $3, $4, 9000000, 'wave', 'decaisse', true,
               'Dépassement autorisé par la direction pour la campagne en cours', $5, $6, $5)`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.ownerA, ids.managerA],
    )
    expect(n).toBe(1)
  })

  it('une dépense ne peut pas être validée par son bénéficiaire', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `insert into expenses
         (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary,
          beneficiary_user_id, payment_method, status, validated_by)
       values (gen_random_uuid(), $1, $2, $3, current_date, 75000, 'Comptable A', $4, 'cash',
               'validee', $4)`,
      [ids.tenantA, ids.categoryTransport, ids.campaignA, ids.accountantA],
    )
    expect(message).toMatch(/beneficiary_is_not_validator/i)
  })
})

// ---------------------------------------------------------------------------
// RG-13 → RG-15 · Abonnements
// ---------------------------------------------------------------------------

describe('RG-13/14/15 · confirmation de paiement d’abonnement', () => {
  it('un client ne peut pas confirmer son propre paiement', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `update subscription_payments set status = 'confirmed', confirmed_by = $2, confirmed_at = now()
        where id = $1`,
      [ids.paymentA, ids.accountantA],
    )
    expect(message).toMatch(/super-administrateur/i)
  })

  it('un client ne peut pas déclarer un paiement déjà « confirmé »', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `insert into subscription_payments
         (tenant_id, subscription_id, amount, method, reference, status, confirmed_by, confirmed_at)
       values ($1, $2, 50000, 'wave', 'WV-FAUX-001', 'confirmed', $3, now())`,
      [ids.tenantA, ids.subscriptionA, ids.accountantA],
    )
    expect(message).toMatch(/statut « déclaré »|super-administrateur/i)
  })

  it('un client peut déclarer un paiement, sans effet sur son abonnement', async () => {
    await withUser(actors.accountantA, async (c) => {
      await c.query(
        `insert into subscription_payments
           (tenant_id, subscription_id, amount, method, reference, payer)
         values ($1, $2, 50000, 'wave', 'WV-DEMO-0002', 'LBA Démonstration')`,
        [ids.tenantA, ids.subscriptionA],
      )
      const { rows } = await c.query(`select status from subscriptions where id = $1`, [
        ids.subscriptionA,
      ])
      expect(rows[0].status).toBe('active')
    })
  })

  it('la confirmation par le super-administrateur prolonge la période', async () => {
    await withUser(actors.superAdmin, async (c) => {
      const before = await c.query(
        `select period_end from subscriptions where id = $1`, [ids.subscriptionA],
      )
      await c.query(`select app.confirm_subscription_payment($1, 'Wave vérifié sur le relevé')`, [
        ids.paymentA,
      ])
      const after = await c.query(
        `select period_end, status from subscriptions where id = $1`, [ids.subscriptionA],
      )
      expect(new Date(after.rows[0].period_end).getTime()).toBeGreaterThan(
        new Date(before.rows[0].period_end).getTime(),
      )
      expect(after.rows[0].status).toBe('active')
    })
  })

  it('rejouer la même confirmation ne prolonge pas deux fois (idempotence)', async () => {
    await withUser(actors.superAdmin, async (c) => {
      await c.query(`select app.confirm_subscription_payment($1, 'Première confirmation')`, [ids.paymentA])
      const first = await c.query(`select period_end from subscriptions where id = $1`, [ids.subscriptionA])

      await c.query(`select app.confirm_subscription_payment($1, 'Rejeu du même paiement')`, [ids.paymentA])
      const second = await c.query(`select period_end from subscriptions where id = $1`, [ids.subscriptionA])

      expect(second.rows[0].period_end).toEqual(first.rows[0].period_end)
    })
  })

  it('la prolongation part de la date de fin existante : les jours payés ne sont pas perdus', async () => {
    await withUser(actors.superAdmin, async (c) => {
      const before = await c.query(
        `select period_end from subscriptions where id = $1`, [ids.subscriptionA],
      )
      await c.query(`select app.confirm_subscription_payment($1, 'Renouvellement vérifié')`, [ids.paymentA])
      const after = await c.query(
        `select period_end from subscriptions where id = $1`, [ids.subscriptionA],
      )

      const gapDays = Math.round(
        (new Date(after.rows[0].period_end).getTime() - new Date(before.rows[0].period_end).getTime()) /
          86_400_000,
      )
      // Un mois ajouté à la fin existante, jamais recalculé depuis aujourd'hui.
      expect(gapDays).toBeGreaterThanOrEqual(28)
      expect(gapDays).toBeLessThanOrEqual(31)
    })
  })

  it('un paiement partiel devient un avoir et ne renouvelle pas la période', async () => {
    await withUser(actors.accountantA, async (c) => {
      // Le client déclare un règlement incomplet…
      const { rows: partial } = await c.query(
        `insert into subscription_payments
           (tenant_id, subscription_id, invoice_id, amount, method, reference)
         values ($1, $2, $3, 20000, 'orange_money', 'OM-PARTIEL-001')
         returning id`,
        [ids.tenantA, ids.subscriptionA, ids.invoiceA],
      )

      // …et c'est l'administrateur plateforme qui le vérifie.
      await switchActor(c, actors.superAdmin)
      const before = await c.query(`select period_end from subscriptions where id = $1`, [ids.subscriptionA])

      await c.query(`select app.confirm_subscription_payment($1, 'Paiement partiel constaté')`, [
        partial[0].id,
      ])

      const after = await c.query(`select period_end from subscriptions where id = $1`, [ids.subscriptionA])
      expect(after.rows[0].period_end).toEqual(before.rows[0].period_end)

      const credits = await c.query(
        `select count(*)::int as n from subscription_credits where origin = 'paiement_partiel'`,
      )
      expect(credits.rows[0].n).toBe(1)
    })
  })

  it('deux paiements ne peuvent pas partager la même référence', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `insert into subscription_payments (tenant_id, subscription_id, amount, method, reference)
       values ($1, $2, 50000, 'wave', 'WV-DEMO-0001')`,
      [ids.tenantA, ids.subscriptionA],
    )
    expect(message).toMatch(/duplicate key|unique/i)
  })
})

// ---------------------------------------------------------------------------
// RG-16 · Audit des changements sensibles
// ---------------------------------------------------------------------------

describe('RG-16 · le journal capture les changements sensibles', () => {
  it('un changement de poids produit une entrée « weight_change » avec ancienne et nouvelle valeur', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update transfers set net_unloaded_kg = 7900,
                gross_weight_reception_kg = null, tare_reception_kg = null where id = $1`,
        [ids.transferA1],
      )
      const { rows } = await c.query(
        `select old_value, new_value, changed_fields
           from audit_log
          where action = 'weight_change' and record_id = $1
          order by id desc limit 1`,
        [ids.transferA1],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].changed_fields).toContain('net_unloaded_kg')
      expect(rows[0].old_value.net_unloaded_kg).toBeNull()
      expect(Number(rows[0].new_value.net_unloaded_kg)).toBe(7900)
    })
  })

  it('un changement de prix produit une entrée « price_change »', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update purchases set price_per_kg = 440, amount = 8200 * 440 where id = $1`, [
        ids.purchaseA1,
      ])
      const { rows } = await c.query(
        `select count(*)::int as n from audit_log where action = 'price_change' and record_id = $1`,
        [ids.purchaseA1],
      )
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })

  it('un changement de société produit une entrée « partner_change »', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update stock_lots set partner_company_id = $2 where id = $1`, [
        ids.lotA1, ids.partnerDorado,
      ])
      const { rows } = await c.query(
        `select count(*)::int as n from audit_log where action = 'partner_change' and record_id = $1`,
        [ids.lotA1],
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it('un changement de statut est journalisé avec son motif', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update purchases set status = 'annule', cancelled_at = now(), cancelled_by = $2,
                cancellation_reason = 'Vendeur non identifié après contrôle'
          where id = $1`,
        [ids.purchaseA2, ids.managerA],
      )
      const { rows } = await c.query(
        `select justification from audit_log
          where action = 'status_change' and record_id = $1 order by id desc limit 1`,
        [ids.purchaseA2],
      )
      expect(rows[0].justification).toMatch(/Vendeur non identifié/)
    })
  })

  it('l’auteur et l’horodatage serveur sont enregistrés', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `insert into suppliers (tenant_id, code, full_name) values ($1, 'F-TEST', 'Fournisseur test')`,
        [ids.tenantA],
      )
      const { rows } = await c.query(
        `select user_id, occurred_at from audit_log
          where table_name = 'suppliers' order by id desc limit 1`,
      )
      expect(rows[0].user_id).toBe(ids.managerA)
      expect(rows[0].occurred_at).toBeInstanceOf(Date)
    })
  })
})
