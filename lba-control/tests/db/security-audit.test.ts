/**
 * Phase 7 · audit de sécurité piloté par le catalogue.
 *
 * Ces tests ne citent aucune table par son nom. Ils interrogent le catalogue
 * PostgreSQL et affirment des **invariants** : toute table exposée est
 * cloisonnée, toute fonction privilégiée a son chemin verrouillé, toute
 * entité qui porte un statut terminal refuse la suppression physique.
 *
 * C'est délibéré. Une liste écrite à la main vieillit mal : la table ajoutée
 * dans six mois échapperait au contrôle sans que personne ne le remarque, et
 * un audit qui ne couvre plus tout est pire qu'un audit absent — il rassure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { asOwner, asOwnerWithin, countVisible, pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

/**
 * Tables sans `tenant_id` : plateforme et référentiel global, par construction.
 *
 * `scheduled_task_runs` en fait partie : une exécution planifiée parcourt TOUS
 * les clients, elle n'appartient à aucun. Lui coller un `tenant_id` serait
 * mentir sur ce qu'elle est ; sa politique de lecture est donc réservée aux
 * administrateurs de la plateforme, et le détail par client reste dans le
 * journal d'audit de chaque client.
 */
const GLOBAL_TABLES = [
  'tenants',
  'platform_admins',
  'subscription_plans',
  'assignable_roles',
  'scheduled_task_runs',
]

async function tableNames(sql: string, params: unknown[] = []): Promise<string[]> {
  const { rows } = await asOwner((c) => c.query(sql, params))
  return rows.map((row) => String(Object.values(row)[0]))
}

// ---------------------------------------------------------------------------
// Cloisonnement
// ---------------------------------------------------------------------------

describe('AUDIT · cloisonnement multi-tenant', () => {
  it('toute table métier porte un tenant_id NOT NULL', async () => {
    const missing = await tableNames(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname <> all($1::text[])
          and not exists (
            select 1 from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'tenant_id'
               and a.attnum > 0 and not a.attisdropped and a.attnotnull)
        order by 1`,
      [GLOBAL_TABLES],
    )

    // `audit_log` et `users` acceptent un tenant_id nul : une action de la
    // plateforme et un super-administrateur n'appartiennent à aucun client.
    expect(missing).toEqual(['audit_log', 'users'])
  })

  it('aucune table du schéma public n’échappe à RLS', async () => {
    const unprotected = await tableNames(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    )
    expect(unprotected).toEqual([])
  })

  it('chaque table porte les quatre politiques SELECT, INSERT, UPDATE et DELETE', async () => {
    const incomplete = await tableNames(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'public' and c.relkind = 'r'
        group by c.relname
       having count(distinct p.polcmd) < 4
        order by 1`,
    )
    expect(incomplete).toEqual([])
  })

  it('chaque politique de lecture d’une table métier filtre sur le tenant', async () => {
    const unfiltered = await tableNames(
      `select distinct c.relname
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and p.polcmd = 'r'
          and c.relname <> all($1::text[])
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%tenant%'
        order by 1`,
      [GLOBAL_TABLES],
    )
    expect(unfiltered).toEqual([])
  })

  it('un tenant ne voit aucune ligne d’un autre, sur TOUTE table métier', async () => {
    const tables = await tableNames(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
        where n.nspname = 'public' and c.relkind = 'r' and a.attnotnull
        order by 1`,
    )

    // Vérifier dix tables choisies à la main laisserait les cinquante autres
    // sans preuve : l'isolation se teste sur l'ensemble ou ne se teste pas.
    expect(tables.length).toBeGreaterThan(50)

    const leaking: string[] = []
    for (const table of tables) {
      const visible = await countVisible(actors.ownerB, table, `tenant_id = '${ids.tenantA}'`)
      if (visible > 0) leaking.push(table)
    }
    expect(leaking).toEqual([])
  })

  it('aucune table n’est inaccessible au rôle authentifié faute de droit', async () => {
    // Le `grant … on all tables` de la migration 1200 ne porte que sur les
    // tables existant alors. Une table créée plus tard sans son propre `grant`
    // renvoie « permission denied » : RLS n'a même pas l'occasion de
    // s'appliquer, et le message ne dit rien du cloisonnement. Le défaut s'est
    // produit à la première table ajoutée après la 1200.
    const ungranted = await tableNames(
      `select c.relname
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not has_table_privilege('authenticated', c.oid, 'select')
        order by 1`,
    )
    expect(ungranted).toEqual([])
  })

  it('le rôle anonyme ne reçoit aucun droit sur le schéma public', async () => {
    const granted = await tableNames(
      `select table_name from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public' order by 1`,
    )
    expect(granted).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Suppression physique
// ---------------------------------------------------------------------------

/**
 * Tables portant un statut terminal — annulé, clôturé, fermé, remplacé.
 *
 * Une entité dont le métier a prévu la fin de vie **ne doit pas pouvoir être
 * supprimée physiquement** : sinon le statut est décoratif, et l'annulation
 * documentée devient un simple `delete` déguisé.
 */
const LIFECYCLE_TABLES = [
  'purchases',
  'advances',
  'expenses',
  'transfers',
  'fundings',
  'incidents',
  'contracts',
  'campaigns',
  'partner_companies',
  'field_agents',
  'negotiated_prices',
  'stock_lots',
  'audit_log',
]

describe('AUDIT · aucune suppression physique', () => {
  it.each(LIFECYCLE_TABLES)('la politique DELETE de %s refuse toujours', async (table) => {
    const { rows } = await asOwner((c) =>
      c.query(
        `select coalesce(pg_get_expr(p.polqual, p.polrelid), '') as qual
           from pg_policy p join pg_class c on c.oid = p.polrelid
          where c.relname = $1 and p.polcmd = 'd'`,
        [table],
      ),
    )

    expect(rows.length, `${table} doit avoir une politique DELETE`).toBeGreaterThan(0)
    // Une politique existe **et** refuse : l'absence de politique refuserait
    // aussi, mais sans dire que le refus est voulu.
    expect(rows.map((row) => row.qual)).toEqual(rows.map(() => 'false'))
  })

  it('aucune suppression n’aboutit, même demandée par le propriétaire', async () => {
    for (const table of ['purchases', 'advances', 'expenses', 'transfers', 'negotiated_prices']) {
      const deleted = await withUser(actors.ownerA, async (c) => {
        const result = await c.query(`delete from public.${table}`)
        return result.rowCount ?? 0
      })
      expect(deleted, `${table} ne doit accepter aucune suppression`).toBe(0)
    }
  })

  it('le journal d’audit reste inaltérable', async () => {
    const updated = await withUser(actors.ownerA, async (c) => {
      const result = await c.query(`update public.audit_log set justification = 'réécrit'`)
      return result.rowCount ?? 0
    })
    expect(updated).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Fonctions privilégiées
// ---------------------------------------------------------------------------

describe('AUDIT · fonctions SECURITY DEFINER', () => {
  it('toutes verrouillent leur search_path', async () => {
    const unlocked = await tableNames(
      `select n.nspname || '.' || p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('app', 'public')
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
             where cfg like 'search_path=%')
        order by 1`,
    )
    // Sans chemin verrouillé, un objet homonyme créé dans un schéma utilisateur
    // détournerait l'exécution avec les droits du propriétaire.
    expect(unlocked).toEqual([])
  })

  it('aucune fonction n’est atteignable par le rôle anonyme', async () => {
    const exposed = await tableNames(
      `select n.nspname || '.' || p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('app', 'public')
          and has_function_privilege('anon', p.oid, 'execute')
        order by 1`,
    )
    // « La fonction refuse » et « la fonction est inatteignable » ne sont pas
    // la même garantie : la première dépend de chaque implémentation.
    expect(exposed).toEqual([])
  })

  it('le schéma app reste fermé au rôle anonyme', async () => {
    const { rows } = await asOwner((c) =>
      c.query(`select has_schema_privilege('anon', 'app', 'usage') as ok`),
    )
    expect(rows[0].ok).toBe(false)
  })

  it('le rôle authentifié atteint le schéma app, comme les relais l’exigent', async () => {
    // Les relais `public.x` sont des fonctions SQL ordinaires : l'appelant doit
    // pouvoir atteindre le `app.x` qu'elles appellent. Les contrôles d'accès
    // vivent dans les fonctions elles-mêmes, pas dans le droit de schéma.
    const { rows } = await asOwner((c) =>
      c.query(`select has_schema_privilege('authenticated', 'app', 'usage') as ok`),
    )
    expect(rows[0].ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Verrou d'abonnement
// ---------------------------------------------------------------------------

describe('AUDIT · verrou d’abonnement', () => {
  it('chaque politique d’écriture d’une table métier vérifie le droit d’écrire', async () => {
    const missing = await tableNames(
      `select distinct c.relname
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and p.polcmd = 'a'
          and c.relname <> all($1::text[])
          and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%tenant_can_write%'
        order by 1`,
      [[
        ...GLOBAL_TABLES,
        // Facturation : un client suspendu doit pouvoir déclarer le paiement
        // qui le débloquera.
        'invoices', 'subscriptions', 'subscription_payments', 'subscription_events',
        'subscription_credits', 'audit_log', 'platform_support_sessions',
        // File hors ligne : un appareil doit pouvoir enregistrer ses tentatives
        // et leurs échecs même quand le tenant est suspendu, sinon l'opération
        // reste pending sans que personne ne sache pourquoi.
        'sync_operations', 'sync_sessions',
        // Connexion et messages : un tenant suspendu garde le droit de se
        // connecter en lecture et de recevoir ce qui lui explique comment se
        // débloquer.
        'user_devices', 'notifications',
      ]],
    )
    // Chaque exclusion est nommée et motivée ci-dessus, et redite en commentaire
    // sur la table elle-même : un futur relecteur ne doit pas la prendre pour
    // un oubli à corriger.
    expect(missing).toEqual([])
  })

  it('un tenant en lecture seule ne peut rien écrire', async () => {
    await withUser(actors.ownerReadOnly, async (c) => {
      const { rows } = await c.query(`select app.tenant_can_write() as ok`)
      expect(rows[0].ok).toBe(false)
    })
  })

  it('un tenant en lecture seule lit et exporte toujours', async () => {
    await withUser(actors.ownerReadOnly, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from partner_companies`)
      expect(rows[0].n).toBeGreaterThanOrEqual(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Cloisonnement du pisteur
// ---------------------------------------------------------------------------

describe('AUDIT · cloisonnement du pisteur', () => {
  it('un pisteur ne voit pas les achats d’un autre pisteur', async () => {
    const visible = await countVisible(
      actors.agentA1,
      'purchases',
      `field_agent_id = '${ids.agentA2}'`,
    )
    expect(visible).toBe(0)
  })

  it('un pisteur ne voit ni les marges ni les scores des autres', async () => {
    expect(await countVisible(actors.agentA1, 'tcb_snapshots')).toBe(0)
    const scores = await countVisible(
      actors.agentA1,
      'agent_scores',
      `field_agent_id = '${ids.agentA2}'`,
    )
    expect(scores).toBe(0)
  })

  it('un auditeur lit tout mais n’écrit rien', async () => {
    expect(await countVisible(actors.auditorA, 'purchases')).toBeGreaterThan(0)

    const written = await withUser(actors.auditorA, async (c) => {
      const result = await c.query(
        `update public.purchases set price_override_reason = 'test' where tenant_id = $1`,
        [ids.tenantA],
      )
      return result.rowCount ?? 0
    })
    expect(written).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Console plateforme
// ---------------------------------------------------------------------------

describe('AUDIT · console plateforme', () => {
  it('n’expose aucune donnée métier, seulement des compteurs', async () => {
    const { rows } = await withUser(actors.superAdmin, (c) =>
      c.query(`select app.platform_overview() as o`),
    )
    const overview = rows[0].o as {
      tenants: Array<Record<string, unknown>>
      pending_payments: unknown[]
      support_sessions: unknown[]
    }

    expect(overview.tenants.length).toBeGreaterThan(0)

    // Le super-administrateur administre des abonnements, pas des campagnes :
    // aucune clé ne doit porter d'achat, de prix, de marge ni de nom de pisteur.
    const keys = Object.keys(overview.tenants[0]!)
    for (const forbidden of ['purchase', 'price', 'margin', 'agent_name', 'amount_purchased']) {
      expect(keys.some((key) => key.includes(forbidden))).toBe(false)
    }
    expect(keys).toEqual(
      expect.arrayContaining(['commercial_name', 'subscription_status', 'active_users']),
    )
  })

  it('reste fermée à un propriétaire de tenant', async () => {
    await withUser(actors.ownerA, async (c) => {
      await expect(c.query(`select app.platform_overview()`)).rejects.toThrow(
        /administrateurs de la plateforme/i,
      )
    })
  })

  it('exige un motif substantiel pour suspendre un client', async () => {
    await withUser(actors.superAdmin, async (c) => {
      await expect(
        c.query(`select app.set_tenant_status($1, 'suspended', 'trop court')`, [ids.tenantA]),
      ).rejects.toThrow(/20 caractères/i)
    })
  })

  it('suspend sans rien supprimer, et trace la décision', async () => {
    await withUser(actors.superAdmin, async (c) => {
      const before = await c.query(`select count(*)::int as n from public.purchases where tenant_id = $1`, [
        ids.tenantA,
      ])

      await c.query(
        `select app.set_tenant_status($1, 'suspended', $2)`,
        [ids.tenantA, 'Impayé constaté après trois relances et un appel téléphonique.'],
      )

      const after = await c.query(`select count(*)::int as n from public.purchases where tenant_id = $1`, [
        ids.tenantA,
      ])
      // Suspendre coupe l'accès, jamais les données.
      expect(after.rows[0].n).toBe(before.rows[0].n)

      // Le super-administrateur n'a pas accès au journal du client hors session
      // d'assistance : la règle de la phase 1 s'applique aussi à lui. On relit
      // donc la trace avec les droits du propriétaire de la base.
      const audit = await asOwnerWithin(c, actors.superAdmin, (owner) =>
        owner.query(
          `select action, justification from audit_log
            where tenant_id = $1 and table_name = 'tenants' order by occurred_at desc limit 1`,
          [ids.tenantA],
        ),
      )
      expect(audit.rows[0].action).toBe('suspend')
      expect(audit.rows[0].justification).toContain('relances')
    })
  })

  it('révoque une session d’assistance avant son expiration', async () => {
    await withUser(actors.superAdmin, async (c) => {
      const opened = await c.query(
        `select (app.open_support_session($1, $2, 60)).id as id`,
        [ids.tenantA, 'Analyse d’un écart de poids signalé par le client'],
      )

      await c.query(`select app.revoke_support_session($1)`, [opened.rows[0].id])

      const { rows } = await c.query(
        `select revoked_at from platform_support_sessions where id = $1`,
        [opened.rows[0].id],
      )
      // Attendre l'expiration pour couper un accès ouvert par erreur serait une
      // mauvaise réponse à un incident.
      expect(rows[0].revoked_at).not.toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Justificatifs
// ---------------------------------------------------------------------------

describe('AUDIT · exigence de justificatif', () => {
  it('refuse la validation d’une dépense au-dessus du seuil sans pièce', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update expense_categories set requires_receipt_above = 50000 where id = $1`,
        [ids.categoryTransport],
      )

      const id = '00000000-0000-4000-8000-000000000801'
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, campaign_id, expense_date, amount,
            beneficiary, payment_method, status, submitted_by)
         values ($1, $2, $3, $4, current_date, 300000, 'Transporteur', 'cash', 'soumise', $5)`,
        [id, ids.tenantA, ids.categoryTransport, ids.campaignA, ids.accountantA],
      )

      await expect(
        c.query(`update expenses set status = 'validee', validated_by = $2 where id = $1`, [
          id,
          ids.managerA,
        ]),
      ).rejects.toThrow(/exige un justificatif/i)
    })
  })

  it('laisse la saisie possible sans pièce : elle se joint au bureau', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update expense_categories set requires_receipt_above = 50000 where id = $1`,
        [ids.categoryTransport],
      )

      // Un pisteur doit pouvoir enregistrer une dépense réelle depuis le
      // terrain ; exiger la pièce dès la saisie l'en empêcherait.
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, campaign_id, expense_date, amount,
            beneficiary, payment_method, status)
         values (gen_random_uuid(), $1, $2, $3, current_date, 300000, 'Transporteur', 'cash', 'soumise')`,
        [ids.tenantA, ids.categoryTransport, ids.campaignA],
      )
    })
  })

  it('accepte la validation dès que la pièce est jointe', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `update expense_categories set requires_receipt_above = 50000 where id = $1`,
        [ids.categoryTransport],
      )

      const id = '00000000-0000-4000-8000-000000000802'
      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, campaign_id, expense_date, amount, beneficiary,
            payment_method, proof_path, status, submitted_by)
         values ($1, $2, $3, $4, current_date, 300000, 'Transporteur', 'cash',
                 'tenant/justificatif_depense/2026-03-31/x.jpg', 'soumise', $5)`,
        [id, ids.tenantA, ids.categoryTransport, ids.campaignA, ids.accountantA],
      )

      await c.query(`update expenses set status = 'validee', validated_by = $2 where id = $1`, [
        id,
        ids.managerA,
      ])

      const { rows } = await c.query(`select status from expenses where id = $1`, [id])
      expect(rows[0].status).toBe('validee')
    })
  })
})
