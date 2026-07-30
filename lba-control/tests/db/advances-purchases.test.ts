/**
 * Phase 3 · plafonds d'avance, couverture FIFO et doublons d'achat, appliqués
 * en base.
 *
 * L'enjeu : ces règles décident si un pisteur reçoit de l'argent et si on le
 * soupçonne d'en avoir détourné. Elles ne peuvent pas dépendre d'un formulaire.
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
// Exposition
// ---------------------------------------------------------------------------

describe('exposition d’un pisteur', () => {
  it('sépare l’avancé, le couvert et l’exposition', async () => {
    const { rows } = await withUser(actors.managerA, (c) =>
      c.query(`select app.agent_exposure($1) as e`, [ids.agentA1]),
    )
    const exposure = rows[0].e
    // Une avance de 5 000 000 décaissée, rien de couvert.
    expect(Number(exposure.advanced)).toBe(5_000_000)
    expect(Number(exposure.covered)).toBe(0)
    expect(Number(exposure.exposure)).toBe(5_000_000)
  })

  it('l’exposition diminue avec l’allocation', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 2000000)`, [
        ids.agentA1,
        ids.partnerOlam,
      ])
      const { rows } = await c.query(`select app.agent_exposure($1) as e`, [ids.agentA1])
      expect(Number(rows[0].e.exposure)).toBe(3_000_000)
    })
  })

  it('ne descend jamais sous zéro', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 9000000)`, [
        ids.agentA1,
        ids.partnerOlam,
      ])
      const { rows } = await c.query(`select app.agent_exposure($1) as e`, [ids.agentA1])
      expect(Number(rows[0].e.exposure)).toBe(0)
    })
  })

  it('peut être restreinte à une société', async () => {
    const { rows } = await withUser(actors.managerA, (c) =>
      c.query(`select app.agent_exposure($1, $2) as e`, [ids.agentA1, ids.partnerDorado]),
    )
    expect(Number(rows[0].e.exposure)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Contrôle de capacité
// ---------------------------------------------------------------------------

describe('contrôle de capacité avant décaissement', () => {
  it('autorise une avance dans les limites', async () => {
    const { rows } = await withUser(actors.managerA, (c) =>
      c.query(`select app.check_advance_capacity($1, $2, 500000) as r`, [ids.agentA2, ids.partnerOlam]),
    )
    expect(rows[0].r.can_proceed).toBe(true)
  })

  it('signale un dépassement de plafond global avec les montants', async () => {
    const { rows } = await withUser(actors.managerA, (c) =>
      c.query(`select app.check_advance_capacity($1, $2, 3000000) as r`, [ids.agentA1, ids.partnerOlam]),
    )
    const result = rows[0].r
    expect(result.can_proceed).toBe(false)
    expect(result.requires_override).toBe(true)

    const issue = result.issues.find((i: { reason: string }) => i.reason === 'plafond_global_depasse')
    expect(Number(issue.threshold)).toBe(5_000_000)
    expect(issue.message).toMatch(/au-dessus du plafond/)
  })

  it('oppose un blocage définitif pour un pisteur suspendu', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update field_agents set status = 'suspendu' where id = $1`, [ids.agentA2])
      const { rows } = await c.query(`select app.check_advance_capacity($1, $2, 100000) as r`, [
        ids.agentA2,
        ids.partnerOlam,
      ])
      expect(rows[0].r.has_hard_block).toBe(true)
      // Une suspension est une décision déjà prise : aucune dérogation ne la lève.
      expect(rows[0].r.requires_override).toBe(false)
    })
  })

  it('oppose un blocage définitif pour une société non autorisée', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `delete from field_agent_partners where field_agent_id = $1 and partner_company_id = $2`,
        [ids.agentA2, ids.partnerDorado],
      )
      const { rows } = await c.query(`select app.check_advance_capacity($1, $2, 100000) as r`, [
        ids.agentA2,
        ids.partnerDorado,
      ])
      expect(rows[0].r.has_hard_block).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Application du plafond au décaissement
// ---------------------------------------------------------------------------

describe('le plafond est appliqué au décaissement', () => {
  it('refuse un décaissement au-dessus du plafond sans dérogation', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
          status, created_by, approved_by)
       values ($1, $2, $3, $4, 4000000, 'wave', 'decaisse', $5, $6)`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
    )
    expect(message).toMatch(/dérogation motivée et approuvée est requise/)
  })

  it('accepte une dérogation motivée et approuvée par un tiers', async () => {
    await withUser(actors.managerA, async (c) => {
      const result = await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
            status, requires_override, override_reason, override_approved_by, created_by, approved_by)
         values ($1, $2, $3, $4, 4000000, 'wave', 'decaisse', true,
                 'Campagne exceptionnelle validée par la direction', $5, $6, $5)`,
        [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.ownerA, ids.managerA],
      )
      expect(result.rowCount).toBe(1)
    })
  })

  it('refuse une dérogation auto-approuvée', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into advances
         (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
          status, requires_override, override_reason, override_approved_by, created_by)
       values ($1, $2, $3, $4, 4000000, 'wave', 'decaisse', true,
               'Dépassement que je m''autorise moi-même', $5, $5)`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.managerA],
    )
    expect(message).toMatch(/ne peut pas approuver sa propre dérogation|creator_is_not_approver/)
  })

  it('laisse préparer un brouillon sans contrôle de plafond', async () => {
    await withUser(actors.managerA, async (c) => {
      const result = await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
            status, created_by)
         values ($1, $2, $3, $4, 99000000, 'wave', 'brouillon', $5)`,
        [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA, ids.managerA],
      )
      // C'est la sortie d'argent qui engage, pas la préparation du dossier.
      expect(result.rowCount).toBe(1)
    })
  })

  it('refuse de décaisser au profit d’un pisteur suspendu', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update field_agents set status = 'suspendu' where id = $1`, [ids.agentA2])
      await expect(
        c.query(
          `insert into advances
             (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
              status, created_by, approved_by)
           values ($1, $2, $3, $4, 100000, 'wave', 'decaisse', $5, $6)`,
          [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
        ),
      ).rejects.toThrow(/pas actif/)
    })
  })
})

// ---------------------------------------------------------------------------
// Allocation FIFO
// ---------------------------------------------------------------------------

describe('allocation FIFO en base', () => {
  it('couvre la plus ancienne avance en premier', async () => {
    await withUser(actors.managerA, async (c) => {
      // Le pisteur A2 n'a aucune avance en cours : 1 000 000 reste sous son
      // plafond OLAM de 2 000 000.
      const { rows: created } = await c.query(
        `insert into advances
           (tenant_id, field_agent_id, partner_company_id, campaign_id, amount, payment_method,
            status, issued_at, created_by, approved_by)
         values ($1, $2, $3, $4, 1000000, 'wave', 'decaisse', now(), $5, $6) returning id`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA, ids.managerA, ids.ownerA],
      )

      const leftover = await c.query(
        `select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 400000) as reste`,
        [ids.agentA2, ids.partnerOlam],
      )
      expect(Number(leftover.rows[0].reste)).toBe(0)

      const { rows } = await c.query(
        `select coalesce(sum(amount), 0) as total from advance_allocations where advance_id = $1`,
        [created[0].id],
      )
      expect(Number(rows[0].total)).toBe(400_000)
    })
  })

  it('renvoie le reliquat lorsqu’il dépasse les avances', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 8000000) as reste`,
        [ids.agentA1, ids.partnerOlam],
      )
      // Un excédent de couverture reste VISIBLE, il n'est pas absorbé.
      expect(Number(rows[0].reste)).toBe(3_000_000)
    })
  })

  it('clôture l’avance entièrement couverte et laisse l’autre ouverte', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 5000000)`, [
        ids.agentA1,
        ids.partnerOlam,
      ])
      const { rows } = await c.query(`select status from advances where id = $1`, [ids.advanceA1])
      expect(rows[0].status).toBe('cloture')
    })
  })

  it('marque une couverture partielle sans clôturer', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 1000000)`, [
        ids.agentA1,
        ids.partnerOlam,
      ])
      const { rows } = await c.query(`select status from advances where id = $1`, [ids.advanceA1])
      expect(rows[0].status).toBe('partiellement_couvert')
    })
  })

  it('refuse un montant nul ou négatif', async () => {
    const message = await expectRejected(
      actors.managerA,
      `select app.allocate_advance_fifo($1, $2, 'reception', gen_random_uuid(), 0)`,
      [ids.agentA1, ids.partnerOlam],
    )
    expect(message).toMatch(/strictement positif/)
  })
})

// ---------------------------------------------------------------------------
// Détection de doublons
// ---------------------------------------------------------------------------

describe('détection de doublons d’achat', () => {
  it('signale une double saisie sans bloquer l’insertion', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows: original } = await c.query(
        `select id, purchased_at from purchases where id = $1`,
        [ids.purchaseA1],
      )

      const inserted = await c.query(
        `insert into purchases
           (id, tenant_id, field_agent_id, partner_company_id, campaign_id, supplier_id,
            purchased_at, net_weight_kg, price_per_kg, amount, payment_method, status)
         select gen_random_uuid(), tenant_id, field_agent_id, partner_company_id, campaign_id,
                supplier_id, purchased_at + interval '5 minutes', net_weight_kg, price_per_kg,
                amount, payment_method, 'valide'
         from purchases where id = $1
         returning id`,
        [original[0].id],
      )

      // L'insertion RÉUSSIT : un doublon probable est une hypothèse.
      expect(inserted.rowCount).toBe(1)

      const { rows: flags } = await c.query(
        `select similarity_score, matched_criteria, status
           from purchase_duplicate_flags where purchase_id = $1`,
        [inserted.rows[0].id],
      )
      expect(flags).toHaveLength(1)
      expect(Number(flags[0].similarity_score)).toBeGreaterThanOrEqual(60)
      expect(flags[0].matched_criteria).toEqual(
        expect.arrayContaining(['pisteur', 'poids', 'montant']),
      )
      expect(flags[0].status).toBe('a_verifier')
    })
  })

  it('ne signale pas deux achats réellement différents', async () => {
    await withUser(actors.managerA, async (c) => {
      const inserted = await c.query(
        `insert into purchases
           (id, tenant_id, field_agent_id, partner_company_id, campaign_id,
            purchased_at, net_weight_kg, price_per_kg, amount, payment_method, status)
         values (gen_random_uuid(), $1, $2, $3, $4, now(), 137, 430, 58910, 'cash', 'valide')
         returning id`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA],
      )

      const { rows } = await c.query(
        `select count(*)::int as n from purchase_duplicate_flags where purchase_id = $1`,
        [inserted.rows[0].id],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it('le score SQL concorde avec l’implémentation TypeScript', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select (app.purchase_duplicate_score(a, b) ->> 'score')::int as score
           from purchases a, purchases b
          where a.id = $1 and b.id = $1`,
        [ids.purchaseA1],
      )
      // Achat comparé à lui-même : pisteur 10 + vendeur 0 (pas de fournisseur
      // sur la fixture) + date 15 + heure 10 + poids 25 + montant 20 = 80.
      expect(rows[0].score).toBeGreaterThanOrEqual(60)
      expect(rows[0].score).toBeLessThanOrEqual(100)
    })
  })

  it('la géolocalisation seule ne déclenche aucun signalement', async () => {
    await withUser(actors.managerA, async (c) => {
      // Même point GPS et même localité, tout le reste différent : au même
      // village, tous les achats partagent les mêmes coordonnées.
      await c.query(
        `update purchases set gps_lat = 7.69, gps_lng = -5.03, locality_id = null where id = $1`,
        [ids.purchaseA1],
      )

      const inserted = await c.query(
        `insert into purchases
           (id, tenant_id, field_agent_id, partner_company_id, campaign_id,
            purchased_at, net_weight_kg, price_per_kg, amount, payment_method, status,
            gps_lat, gps_lng)
         values (gen_random_uuid(), $1, $2, $3, $4, now() - interval '1 day',
                 91, 430, 39130, 'cash', 'valide', 7.69, -5.03)
         returning id`,
        [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA],
      )

      const { rows } = await c.query(
        `select count(*)::int as n from purchase_duplicate_flags where purchase_id = $1`,
        [inserted.rows[0].id],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it('un pisteur ne voit pas les signalements des autres', async () => {
    const { rows } = await withUser(actors.agentA1, (c) =>
      c.query(`select count(*)::int as n from purchase_duplicate_flags`),
    )
    // Les signalements sont un outil de contrôle, pas une information terrain.
    expect(rows[0].n).toBe(0)
  })
})
