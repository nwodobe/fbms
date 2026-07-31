/**
 * Phase 8 · sacherie, appliquée en base.
 *
 * Ce que ces tests protègent : que le solde de sacs ne puisse pas être saisi,
 * qu'un mouvement mal formé soit refusé avant de fausser deux stocks à la fois,
 * qu'une perte soit expliquée et qu'un déplacement de sacs entre deux sociétés
 * soit approuvé — c'est un transfert de valeur entre tiers, pas une correction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

/** Réception initiale : sans stock en magasin, rien n'est distribuable. */
async function receive(
  c: import('pg').PoolClient,
  quantity: number,
  partner = ids.partnerOlam,
): Promise<void> {
  await c.query(
    `insert into bag_movements
       (tenant_id, partner_company_id, type, quantity, to_holder_type, created_by)
     values ($1, $2, 'reception_societe', $3, 'warehouse', $4)`,
    [ids.tenantA, partner, quantity, ids.managerA],
  )
}

async function balance(
  c: import('pg').PoolClient,
  holderType: string,
  holderId: string | null,
  partner = ids.partnerOlam,
): Promise<number> {
  const { rows } = await c.query(
    `select coalesce(bag_count, 0) as n from bag_stocks
      where tenant_id = $1 and partner_company_id = $2 and holder_type = $3
        and coalesce(holder_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [ids.tenantA, partner, holderType, holderId],
  )
  return Number(rows[0]?.n ?? 0)
}

describe('soldes de sacherie', () => {
  it('se déduisent des mouvements, jamais d’une saisie', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 1000)
      expect(await balance(c, 'warehouse', null)).toBe(1000)

      await c.query(
        `insert into bag_movements
           (tenant_id, partner_company_id, type, quantity, from_holder_type,
            to_holder_type, to_holder_id, field_agent_id, created_by)
         values ($1, $2, 'dotation_pisteur', 300, 'warehouse', 'field_agent', $3, $3, $4)`,
        [ids.tenantA, ids.partnerOlam, ids.agentA1, ids.managerA],
      )

      expect(await balance(c, 'warehouse', null)).toBe(700)
      expect(await balance(c, 'field_agent', ids.agentA1)).toBe(300)
    })
  })

  it('ne mélange pas les sacs de deux sociétés chez le même détenteur', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 500, ids.partnerOlam)
      await receive(c, 300, ids.partnerDorado)

      expect(await balance(c, 'warehouse', null, ids.partnerOlam)).toBe(500)
      expect(await balance(c, 'warehouse', null, ids.partnerDorado)).toBe(300)
    })
  })

  it('refuse une dotation au-delà du solde, en chiffrant l’écart', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 100)

      await expect(
        c.query(
          `insert into bag_movements
             (tenant_id, partner_company_id, type, quantity, from_holder_type,
              to_holder_type, to_holder_id, created_by)
           values ($1, $2, 'dotation_pisteur', 400, 'warehouse', 'field_agent', $3, $4)`,
          [ids.tenantA, ids.partnerOlam, ids.agentA1, ids.managerA],
        ),
      ).rejects.toThrow(/100 sac\(s\) disponible\(s\) pour 400/)
    })
  })

  it('refuse un mouvement sans société : on ne saurait plus à qui restituer', async () => {
    await withUser(actors.managerA, async (c) => {
      await expect(
        c.query(
          `insert into bag_movements
             (tenant_id, type, quantity, to_holder_type, created_by)
           values ($1, 'reception_societe', 100, 'warehouse', $2)`,
          [ids.tenantA, ids.managerA],
        ),
      ).rejects.toThrow(/appartiennent à une société/i)
    })
  })

  it('refuse une dotation sans destination', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 500)

      await expect(
        c.query(
          `insert into bag_movements
             (tenant_id, partner_company_id, type, quantity, from_holder_type, created_by)
           values ($1, $2, 'dotation_pisteur', 100, 'warehouse', $3)`,
          [ids.tenantA, ids.partnerOlam, ids.managerA],
        ),
      ).rejects.toThrow(/exige une destination/i)
    })
  })

  it('refuse une quantité négative plutôt que d’en déduire un sens', async () => {
    await withUser(actors.managerA, async (c) => {
      await expect(
        c.query(
          `insert into bag_movements
             (tenant_id, partner_company_id, type, quantity, to_holder_type, created_by)
           values ($1, $2, 'reception_societe', -100, 'warehouse', $3)`,
          [ids.tenantA, ids.partnerOlam, ids.managerA],
        ),
      ).rejects.toThrow(/strictement positive/i)
    })
  })

  it('refuse une perte non expliquée', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 200)

      // Une perte sans explication est indéfendable en fin de campagne.
      await expect(
        c.query(
          `insert into bag_movements
             (tenant_id, partner_company_id, type, quantity, from_holder_type, created_by)
           values ($1, $2, 'perte', 10, 'warehouse', $3)`,
          [ids.tenantA, ids.partnerOlam, ids.managerA],
        ),
      ).rejects.toThrow()
    })
  })

  it('accepte une perte expliquée et la déduit du solde', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 200)

      await c.query(
        `insert into bag_movements
           (tenant_id, partner_company_id, type, quantity, from_holder_type, reason, created_by)
         values ($1, $2, 'perte', 10, 'warehouse', 'Sacs déchirés au chargement sous la pluie', $3)`,
        [ids.tenantA, ids.partnerOlam, ids.managerA],
      )
      expect(await balance(c, 'warehouse', null)).toBe(190)
    })
  })

  it('reconstruit les soldes à partir des seuls mouvements', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 800)
      await c.query(
        `insert into bag_movements
           (tenant_id, partner_company_id, type, quantity, from_holder_type,
            to_holder_type, to_holder_id, created_by)
         values ($1, $2, 'dotation_pisteur', 250, 'warehouse', 'field_agent', $3, $4)`,
        [ids.tenantA, ids.partnerOlam, ids.agentA1, ids.managerA],
      )

      // On abîme volontairement le cache, comme le ferait une correction
      // manuelle en base ou une migration ratée.
      await c.query(`update bag_stocks set bag_count = 9999 where tenant_id = $1`, [ids.tenantA])

      const rebuilt = await c.query(`select app.rebuild_bag_stocks($1) as n`, [ids.tenantA])
      expect(Number(rebuilt.rows[0].n)).toBe(2)

      // La source de vérité reste les mouvements.
      expect(await balance(c, 'warehouse', null)).toBe(550)
      expect(await balance(c, 'field_agent', ids.agentA1)).toBe(250)
    })
  })
})

describe('rapprochement de sacherie', () => {
  it('rapproche entrées, sorties et pertes, et chiffre le taux', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 1000)
      await c.query(
        `insert into bag_movements
           (tenant_id, partner_company_id, type, quantity, from_holder_type,
            to_holder_type, to_holder_id, field_agent_id, created_by)
         values ($1, $2, 'dotation_pisteur', 500, 'warehouse', 'field_agent', $3, $3, $4)`,
        [ids.tenantA, ids.partnerOlam, ids.agentA1, ids.managerA],
      )
      await c.query(
        `insert into bag_movements
           (tenant_id, partner_company_id, type, quantity, from_holder_type, from_holder_id,
            field_agent_id, reason, created_by)
         values ($1, $2, 'perte', 20, 'field_agent', $3, $3, 'Sacs emportés par la crue', $4)`,
        [ids.tenantA, ids.partnerOlam, ids.agentA1, ids.managerA],
      )

      const { rows } = await c.query(`select app.bag_reconciliation($1, $2) as r`, [
        ids.tenantA,
        ids.partnerOlam,
      ])
      const r = rows[0].r

      expect(Number(r.received)).toBe(1000)
      expect(Number(r.distributed)).toBe(500)
      expect(Number(r.declared_losses)).toBe(20)
      expect(Number(r.held_by_agents)).toBe(480)
      expect(Number(r.expected_in_warehouse)).toBe(500)
      expect(Number(r.loss_rate_pct)).toBe(4)
    })
  })

  it('laisse le taux de perte absent quand rien n’a été distribué', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 400)

      const { rows } = await c.query(`select app.bag_reconciliation($1, $2) as r`, [
        ids.tenantA,
        ids.partnerOlam,
      ])
      // 0 % sur une dotation inexistante se lirait comme un excellent résultat.
      expect(rows[0].r.loss_rate_pct).toBeNull()
      expect(Number(rows[0].r.received)).toBe(400)
    })
  })
})

describe('réaffectation entre sociétés', () => {
  it('écrit les deux mouvements en une transaction et laisse une trace', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 600, ids.partnerOlam)

      const { rows } = await c.query(
        `select app.reassign_bags($1, $2, 'warehouse', null, 150,
                                  'Rupture de sacherie côté DORADO, accord des deux sociétés') as r`,
        [ids.partnerOlam, ids.partnerDorado],
      )
      expect(rows[0].r.out_movement_id).not.toBeNull()
      expect(rows[0].r.in_movement_id).not.toBeNull()

      expect(await balance(c, 'warehouse', null, ids.partnerOlam)).toBe(450)
      expect(await balance(c, 'warehouse', null, ids.partnerDorado)).toBe(150)

      // Le trigger d'audit générique écrit aussi une entrée « create » par
      // mouvement : on cherche celle qui documente le changement de société.
      const audit = await c.query(
        `select new_value, justification from audit_log
          where tenant_id = $1 and table_name = 'bag_movements' and action = 'partner_change'
          order by occurred_at desc limit 1`,
        [ids.tenantA],
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0].justification).toContain('DORADO')
      expect(audit.rows[0].new_value.from_partner).toBe(ids.partnerOlam)
      expect(audit.rows[0].new_value.to_partner).toBe(ids.partnerDorado)
    })
  })

  it('refuse une réaffectation non motivée', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 600, ids.partnerOlam)

      await expect(
        c.query(`select app.reassign_bags($1, $2, 'warehouse', null, 100, 'x')`, [
          ids.partnerOlam,
          ids.partnerDorado,
        ]),
      ).rejects.toThrow(/motif écrit/i)
    })
  })

  it('refuse une réaffectation vers la même société', async () => {
    await withUser(actors.managerA, async (c) => {
      await expect(
        c.query(`select app.reassign_bags($1, $1, 'warehouse', null, 100, 'Motif suffisant ici')`, [
          ids.partnerOlam,
        ]),
      ).rejects.toThrow(/doivent différer/i)
    })
  })

  it('reste réservée au propriétaire et au gestionnaire', async () => {
    await withUser(actors.accountantA, async (c) => {
      await expect(
        c.query(
          `select app.reassign_bags($1, $2, 'warehouse', null, 50, 'Tentative par un comptable')`,
          [ids.partnerOlam, ids.partnerDorado],
        ),
      ).rejects.toThrow(/propriétaire et le gestionnaire/i)
    })
  })

  it('refuse une réaffectation au-delà du solde disponible', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 50, ids.partnerOlam)

      await expect(
        c.query(
          `select app.reassign_bags($1, $2, 'warehouse', null, 500, 'Motif suffisant pour le test')`,
          [ids.partnerOlam, ids.partnerDorado],
        ),
      ).rejects.toThrow(/Solde insuffisant/i)
    })
  })
})

describe('cloisonnement de la sacherie', () => {
  it('n’expose aucun mouvement d’une autre entreprise', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 100)
    })

    await withUser(actors.ownerB, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from bag_movements`)
      expect(rows[0].n).toBe(0)
    })
  })

  it('interdit la suppression d’un mouvement de sacs', async () => {
    await withUser(actors.managerA, async (c) => {
      await receive(c, 100)
      const result = await c.query(`delete from bag_movements where tenant_id = $1`, [ids.tenantA])
      // Un mouvement supprimé ferait diverger le solde de son historique.
      expect(result.rowCount).toBe(0)
    })
  })
})
