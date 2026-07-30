/**
 * Tests de sécurité (SEC-01 → SEC-16 du TEST_PLAN.md).
 *
 * Ils s'exécutent contre un vrai PostgreSQL, avec les migrations réelles et le
 * mécanisme d'authentification de Supabase. Ce ne sont pas des tests de
 * l'interface : ils vérifient ce que la base autorise, ce qui est le seul
 * niveau où l'isolation d'un client vis-à-vis d'un autre a une valeur.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import {
  affectedRows,
  asOwner,
  asOwnerWithin,
  countVisible,
  expectRejected,
  pool,
  switchActor,
  withUser,
} from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

// ---------------------------------------------------------------------------
// SEC-01 / SEC-02 · Couverture des politiques
// ---------------------------------------------------------------------------

describe('SEC-01/02 · couverture RLS', () => {
  it('toutes les tables du schéma public ont RLS activée', async () => {
    const { rows } = await asOwner((c) =>
      c.query(`
        select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        order by 1
      `),
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('chaque table possède les quatre politiques SELECT, INSERT, UPDATE et DELETE', async () => {
    const { rows } = await asOwner((c) =>
      c.query(`
        select c.relname, array_agg(distinct p.polcmd::text order by p.polcmd::text) as cmds
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'public' and c.relkind = 'r'
        group by c.relname
        having count(distinct p.polcmd) < 4
        order by 1
      `),
    )
    expect(rows).toEqual([])
  })

  it('le rôle anonyme n’a aucun accès aux tables métier', async () => {
    const { rows } = await asOwner((c) =>
      c.query(`
        select table_name from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'
      `),
    )
    expect(rows).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SEC-03 / SEC-04 · Isolation entre entreprises clientes
// ---------------------------------------------------------------------------

describe('SEC-03/04 · isolation multi-tenant', () => {
  const tables = [
    'purchases', 'advances', 'fundings', 'contracts', 'partner_companies',
    'stock_lots', 'transfers', 'expenses', 'field_agents', 'campaigns',
  ]

  it.each(tables)('le tenant B ne voit aucune ligne du tenant A dans %s', async (table) => {
    const visible = await countVisible(actors.ownerB, table, `tenant_id = '${ids.tenantA}'`)
    expect(visible).toBe(0)
  })

  it('un accès par identifiant direct ne contourne pas l’isolation', async () => {
    const visible = await countVisible(actors.ownerB, 'purchases', `id = '${ids.purchaseA1}'`)
    expect(visible).toBe(0)
  })

  it('le tenant A voit bien ses propres données', async () => {
    expect(await countVisible(actors.ownerA, 'purchases')).toBe(2)
    expect(await countVisible(actors.ownerA, 'partner_companies')).toBe(2)
  })

  it('un utilisateur ne peut pas écrire dans un autre tenant', async () => {
    const message = await expectRejected(
      actors.ownerB,
      `insert into partner_companies (tenant_id, code, name) values ($1, 'PIRATE', 'Société pirate')`,
      [ids.tenantA],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('une mise à jour croisée ne modifie aucune ligne', async () => {
    const n = await affectedRows(
      actors.ownerB,
      `update partner_companies set name = 'Détourné' where id = $1`,
      [ids.partnerOlam],
    )
    expect(n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SEC-05 / SEC-06 · Cloisonnement du pisteur
// ---------------------------------------------------------------------------

describe('SEC-05/06 · cloisonnement du pisteur', () => {
  it('un pisteur ne voit que ses propres achats', async () => {
    const rows = await withUser(actors.agentA1, async (c) =>
      (await c.query('select id, field_agent_id from purchases')).rows,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].field_agent_id).toBe(ids.agentA1)
  })

  it('un pisteur ne voit pas les achats d’un collègue, même par identifiant', async () => {
    expect(await countVisible(actors.agentA1, 'purchases', `id = '${ids.purchaseA2}'`)).toBe(0)
  })

  it('un pisteur ne voit que ses propres avances', async () => {
    expect(await countVisible(actors.agentA1, 'advances')).toBe(1)
    expect(await countVisible(actors.agentA2, 'advances')).toBe(0)
  })

  it('un pisteur ne voit ni le TCB ni les marges du LBA', async () => {
    expect(await countVisible(actors.agentA1, 'tcb_snapshots')).toBe(0)
    expect(await countVisible(actors.agentA1, 'tcb_snapshot_components')).toBe(0)
  })

  it('un pisteur ne voit ni les financements ni les contrats ni les prix négociés', async () => {
    expect(await countVisible(actors.agentA1, 'fundings')).toBe(0)
    expect(await countVisible(actors.agentA1, 'contracts')).toBe(0)
    expect(await countVisible(actors.agentA1, 'negotiated_prices')).toBe(0)
  })

  it('un pisteur ne voit pas la liste du personnel, seulement sa fiche', async () => {
    const rows = await withUser(actors.agentA1, async (c) => (await c.query('select id from users')).rows)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(ids.agentUserA1)
  })

  it('un pisteur ne voit que son propre score', async () => {
    expect(await countVisible(actors.agentA1, 'agent_scores')).toBe(1)
    expect(await countVisible(actors.agentA2, 'agent_scores')).toBe(0)
  })

  it('un pisteur ne peut pas enregistrer un achat au nom d’un autre pisteur', async () => {
    const message = await expectRejected(
      actors.agentA1,
      `insert into purchases
         (id, tenant_id, field_agent_id, partner_company_id, campaign_id, purchased_at,
          net_weight_kg, price_per_kg, amount, payment_method)
       values (gen_random_uuid(), $1, $2, $3, $4, now(), 100, 430, 43000, 'cash')`,
      [ids.tenantA, ids.agentA2, ids.partnerOlam, ids.campaignA],
    )
    expect(message).toMatch(/ses propres opérations|row-level security/i)
  })

  it('un pisteur peut enregistrer son propre achat', async () => {
    const n = await affectedRows(
      actors.agentA1,
      `insert into purchases
         (id, tenant_id, field_agent_id, partner_company_id, campaign_id, purchased_at,
          net_weight_kg, price_per_kg, amount, payment_method, device_id, created_at_device)
       values (gen_random_uuid(), $1, $2, $3, $4, now(), 100, 430, 43000, 'cash', 'device-test', now())`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA],
    )
    expect(n).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// SEC-07 · Auditeur en lecture seule
// ---------------------------------------------------------------------------

describe('SEC-07 · auditeur strictement en lecture', () => {
  it('l’auditeur lit les données métier', async () => {
    expect(await countVisible(actors.auditorA, 'purchases')).toBe(2)
    expect(await countVisible(actors.auditorA, 'tcb_snapshots')).toBe(1)
  })

  const writes: Array<[string, string, unknown[]]> = [
    ['purchases', `insert into purchases
        (id, tenant_id, field_agent_id, partner_company_id, campaign_id, purchased_at,
         net_weight_kg, price_per_kg, amount, payment_method)
      values (gen_random_uuid(), $1, $2, $3, $4, now(), 10, 430, 4300, 'cash')`,
      [ids.tenantA, ids.agentA1, ids.partnerOlam, ids.campaignA]],
    ['expenses', `insert into expenses
        (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary, payment_method)
      values (gen_random_uuid(), $1, $2, $3, current_date, 1000, 'X', 'cash')`,
      [ids.tenantA, ids.categoryTransport, ids.campaignA]],
    ['partner_companies', `insert into partner_companies (tenant_id, code, name)
      values ($1, 'NEW', 'Nouvelle société')`, [ids.tenantA]],
  ]

  it.each(writes)('l’auditeur ne peut pas écrire dans %s', async (_table, sql, params) => {
    const message = await expectRejected(actors.auditorA, sql, params)
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('une mise à jour par l’auditeur ne touche aucune ligne', async () => {
    const n = await affectedRows(
      actors.auditorA,
      `update purchases set net_weight_kg = 1 where id = $1`,
      [ids.purchaseA1],
    )
    expect(n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SEC-08 · Aucune suppression physique des transactions métier
// ---------------------------------------------------------------------------

describe('SEC-08 · suppression physique impossible', () => {
  const transactional = [
    ['purchases', ids.purchaseA1],
    ['advances', ids.advanceA1],
    ['expenses', ids.expenseA1],
    ['transfers', ids.transferA1],
    ['stock_lots', ids.lotA1],
    ['fundings', ids.fundingOlam],
  ] as const

  it.each(transactional)('aucune ligne de %s ne peut être supprimée', async (table, id) => {
    for (const actor of [actors.ownerA, actors.managerA, actors.accountantA]) {
      const n = await affectedRows(actor, `delete from ${table} where id = $1`, [id])
      expect(n).toBe(0)
    }
  })

  it('l’annulation reste possible, avec date, motif et auteur', async () => {
    const n = await affectedRows(
      actors.managerA,
      `update purchases
          set status = 'annule', cancelled_at = now(), cancelled_by = $2,
              cancellation_reason = 'Double saisie constatée au contrôle'
        where id = $1`,
      [ids.purchaseA1, ids.managerA],
    )
    expect(n).toBe(1)
  })

  it('une annulation sans motif est refusée', async () => {
    const message = await expectRejected(
      actors.managerA,
      `update purchases set status = 'annule', cancelled_at = now() where id = $1`,
      [ids.purchaseA1],
    )
    expect(message).toMatch(/purchase_cancel_is_justified/i)
  })
})

// ---------------------------------------------------------------------------
// SEC-09 · Immuabilité du journal d'audit
// ---------------------------------------------------------------------------

describe('SEC-09 · journal d’audit non modifiable', () => {
  it('les opérations alimentent bien le journal', async () => {
    const n = await countVisible(actors.ownerA, 'audit_log')
    expect(n).toBeGreaterThan(0)
  })

  it('personne ne peut modifier une entrée d’audit', async () => {
    for (const actor of [actors.ownerA, actors.managerA, actors.auditorA]) {
      const n = await affectedRows(actor, `update audit_log set justification = 'réécrit'`)
      expect(n).toBe(0)
    }
  })

  it('personne ne peut supprimer une entrée d’audit', async () => {
    for (const actor of [actors.ownerA, actors.managerA, actors.auditorA]) {
      const n = await affectedRows(actor, `delete from audit_log`)
      expect(n).toBe(0)
    }
  })

  it('personne ne peut insérer une fausse entrée d’audit', async () => {
    const message = await expectRejected(
      actors.ownerA,
      `insert into audit_log (tenant_id, action, table_name) values ($1, 'login', 'faux')`,
      [ids.tenantA],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('un pisteur ne consulte pas le journal d’audit', async () => {
    expect(await countVisible(actors.agentA1, 'audit_log')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SEC-10 / SEC-11 · Verrou d'écriture lié à l'abonnement
// ---------------------------------------------------------------------------

describe('SEC-10/11 · suspension d’abonnement', () => {
  it('en lecture seule, la consultation reste possible', async () => {
    const rows = await withUser(actors.ownerReadOnly, async (c) =>
      (await c.query('select id from tenants')).rows,
    )
    expect(rows).toHaveLength(1)
  })

  it('en lecture seule, toute écriture est refusée', async () => {
    const message = await expectRejected(
      actors.ownerReadOnly,
      `insert into partner_companies (tenant_id, code, name) values ($1, 'X', 'Société X')`,
      [ids.tenantReadOnly],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('en suspension complète, toute écriture est refusée', async () => {
    const message = await expectRejected(
      actors.ownerSuspended,
      `insert into partner_companies (tenant_id, code, name) values ($1, 'X', 'Société X')`,
      [ids.tenantSuspended],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('un tenant actif écrit normalement', async () => {
    const n = await affectedRows(
      actors.managerA,
      `insert into partner_companies (tenant_id, code, name) values ($1, 'NEW', 'Société nouvelle')`,
      [ids.tenantA],
    )
    expect(n).toBe(1)
  })

  it('la suspension d’un client n’affecte pas les autres', async () => {
    expect(await countVisible(actors.ownerA, 'purchases')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// SEC-12 → SEC-14 · Mode d'assistance super-administrateur
// ---------------------------------------------------------------------------

describe('SEC-12/13/14 · assistance super-administrateur auditée', () => {
  it('sans session d’assistance, le super-admin ne voit aucune donnée métier', async () => {
    expect(await countVisible(actors.superAdmin, 'purchases')).toBe(0)
    expect(await countVisible(actors.superAdmin, 'fundings')).toBe(0)
    expect(await countVisible(actors.superAdmin, 'tcb_snapshots')).toBe(0)
  })

  it('avec une session active et motivée, la lecture est autorisée', async () => {
    await withUser(actors.superAdmin, async (c) => {
      await c.query(`select app.open_support_session($1, $2, 60)`, [
        ids.tenantA,
        'Assistance à la réconciliation demandée par le client, ticket #4821',
      ])
      const { rows } = await c.query('select id from purchases')
      expect(rows.length).toBeGreaterThan(0)
    })
  })

  it('une session sans motif explicite est refusée', async () => {
    const message = await expectRejected(
      actors.superAdmin,
      `select app.open_support_session($1, 'test', 60)`,
      [ids.tenantA],
    )
    expect(message).toMatch(/motif d'assistance explicite|motif d’assistance explicite/i)
  })

  it('une session ne peut pas être insérée directement, même par un super-admin', async () => {
    const message = await expectRejected(
      actors.superAdmin,
      `insert into platform_support_sessions (tenant_id, admin_user_id, reason, expires_at)
       values ($1, $2, 'Contournement de la fonction officielle', now() + interval '1 hour')`,
      [ids.tenantA, ids.superAdmin],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('une session expirée ne donne plus accès', async () => {
    await withUser(actors.superAdmin, async (c) => {
      await asOwnerWithin(c, actors.superAdmin, (owner) =>
        owner.query(
          `insert into platform_support_sessions (tenant_id, admin_user_id, reason, granted_at, expires_at)
           values ($1, $2, 'Session d''assistance déjà terminée hier', now() - interval '2 hours',
                   now() - interval '1 hour')`,
          [ids.tenantA, ids.superAdmin],
        ),
      )
      const { rows } = await c.query('select id from purchases')
      expect(rows).toHaveLength(0)
    })
  })

  it('l’ouverture d’une session est journalisée et visible par le client', async () => {
    await withUser(actors.superAdmin, async (c) => {
      await c.query(`select app.open_support_session($1, $2, 30)`, [
        ids.tenantA,
        'Vérification d’un écart de pesée signalé par le client',
      ])

      // C'est le propriétaire du LBA qui doit pouvoir lire cette trace : un
      // journal d'intervention que seul l'intervenant peut consulter ne
      // protège personne.
      await switchActor(c, actors.ownerA)
      const { rows } = await c.query(
        `select count(*)::int as n from audit_log
          where table_name = 'platform_support_sessions' and tenant_id = $1`,
        [ids.tenantA],
      )
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })

  it('le propriétaire du LBA voit qui est intervenu chez lui', async () => {
    await asOwner((c) =>
      c.query(
        `insert into platform_support_sessions (tenant_id, admin_user_id, reason, expires_at)
         values ($1, $2, 'Intervention de support planifiée', now() + interval '1 hour')`,
        [ids.tenantA, ids.superAdmin],
      ),
    )
    expect(await countVisible(actors.ownerA, 'platform_support_sessions')).toBeGreaterThan(0)
    expect(await countVisible(actors.ownerB, 'platform_support_sessions')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SEC-15 · Séparation des tâches sur les poids
// ---------------------------------------------------------------------------

describe('SEC-15 · le comptable ne modifie pas les poids physiques', () => {
  it('le comptable ne peut pas modifier un transfert', async () => {
    const n = await affectedRows(
      actors.accountantA,
      `update transfers set net_loaded_kg = 9999 where id = $1`,
      [ids.transferA1],
    )
    expect(n).toBe(0)
  })

  it('le gestionnaire, lui, le peut', async () => {
    const n = await affectedRows(
      actors.managerA,
      `update transfers set net_unloaded_kg = 7940, gross_weight_reception_kg = null,
              tare_reception_kg = null where id = $1`,
      [ids.transferA1],
    )
    expect(n).toBe(1)
  })

  it('le comptable garde accès aux dépenses et aux financements', async () => {
    const n = await affectedRows(
      actors.accountantA,
      `insert into fundings
         (tenant_id, partner_company_id, campaign_id, amount, received_at, payment_method, reference)
       values ($1, $2, $3, 1000000, current_date, 'wave', 'FIN-TEST')`,
      [ids.tenantA, ids.partnerOlam, ids.campaignA],
    )
    expect(n).toBe(1)
  })
})

afterAll(async () => {
  await pool.end()
})
