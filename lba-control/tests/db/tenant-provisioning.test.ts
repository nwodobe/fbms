/**
 * Étape 5 · ouverture d'un client depuis la console.
 *
 * Ce que ces tests protègent : qu'une entreprise naisse complète ou pas du
 * tout, qu'aucun identifiant ne soit réutilisé, et qu'une invitation ne
 * contourne pas ce qu'un changement de rôle interdit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { asOwnerWithin, pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

const nouveau = (slug: string) => ({
  slug,
  nom: 'LBA Séguéla',
  legal: 'LBA Séguéla SARL',
  email: 'proprietaire@lba-seguela.ci',
  contact: 'TRAORE Bakary',
})

describe('ouverture d’une entreprise', () => {
  it('crée le tenant, sa marque, son abonnement et l’invitation en une fois', async () => {
    const etat = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(
        `select public.create_tenant($1, $2, $3, $4, $5) as r`,
        Object.values(nouveau('lba-seguela')),
      )
      const created = rows[0].r as Record<string, string>

      const check = await asOwnerWithin(c, actors.superAdmin, async () => {
        const result = await c.query(
          `select
             (select count(*) from tenants where id = $1)::int              as tenant,
             (select count(*) from tenant_branding where tenant_id = $1)::int as marque,
             (select count(*) from subscriptions where tenant_id = $1)::int   as abonnement,
             (select count(*) from tenant_invitations where tenant_id = $1)::int as invitation`,
          [created.tenant_id],
        )
        return result.rows[0] as Record<string, number>
      })

      return { created, check }
    })

    // Une entreprise sans abonnement se retrouverait bloquée à la première
    // vérification ; sans propriétaire, elle ne pourrait rien administrer.
    expect(etat.check).toEqual({ tenant: 1, marque: 1, abonnement: 1, invitation: 1 })
    expect(etat.created.invitation_token).toHaveLength(48)
  })

  it('installe le référentiel des dépenses et les règles d’alerte', async () => {
    const etat = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(
        `select public.create_tenant($1, $2, $3, $4, $5) as r`,
        Object.values(nouveau('lba-korhogo')),
      )
      const created = rows[0].r as Record<string, string | number>

      const check = await asOwnerWithin(c, actors.superAdmin, async () => {
        const result = await c.query(
          `select
             (select count(*) from expense_categories where tenant_id = $1)::int as categories,
             (select count(*) from expense_categories
               where tenant_id = $1 and is_system_reserved)::int                 as reservees,
             (select count(*) from expense_categories
               where tenant_id = $1 and not is_direct)::int                      as indirectes,
             (select count(*) from alert_rules where tenant_id = $1)::int        as regles`,
          [created.tenant_id],
        )
        return result.rows[0] as Record<string, number>
      })

      return { created, check }
    })

    // Sans catégories, aucune dépense n'est saisissable : expenses.category_id
    // est NOT NULL et le référentiel est rangé par tenant.
    expect(etat.check.categories).toBe(23)

    // achat_produit et commission_pisteur : présentes au référentiel, refusées
    // en saisie manuelle. Les compter aussi en dépense doublerait le TCB.
    expect(etat.check.reservees).toBe(2)

    // Intérêts, gardiennage, stockage, administration : elles se répartissent
    // par clé, elles ne se rattachent pas directement à un périmètre.
    expect(etat.check.indirectes).toBe(4)

    // Sans règles, app.raise_alert renvoie null pour chaque type : les vingt
    // alertes ne se déclencheraient jamais, et rien ne le signalerait.
    expect(etat.check.regles).toBe(20)

    expect(etat.created.expense_categories).toBe(23)
    expect(etat.created.alert_rules).toBe(20)
  })

  it('ne laisse pas un client installer des référentiels chez un autre', async () => {
    // Les deux fonctions sont `security definer` et relayées dans `public` :
    // sans garde, un identifiant de tenant passé à la main suffisait à écrire
    // chez un tiers.
    await expect(
      withUser(actors.ownerA, (c) => c.query(`select public.seed_alert_rules($1)`, [ids.tenantB])),
    ).rejects.toThrow(/Réservé à l/)

    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.seed_expense_categories($1)`, [ids.tenantB]),
      ),
    ).rejects.toThrow(/Réservé à l/)
  })

  it('rejouer le référentiel ne duplique rien', async () => {
    // La fonction sert aussi à réparer un client ouvert avant la migration
    // 3100 : elle doit pouvoir être relancée sans risque.
    const rejoue = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(
        `select public.create_tenant($1, $2, $3, $4, $5) as r`,
        Object.values(nouveau('lba-man')),
      )
      const tenantId = (rows[0].r as Record<string, string>).tenant_id

      const categories = await c.query(`select public.seed_expense_categories($1) as n`, [tenantId])
      const regles = await c.query(`select public.seed_alert_rules($1) as n`, [tenantId])

      return { categories: categories.rows[0].n as number, regles: regles.rows[0].n as number }
    })

    expect(rejoue).toEqual({ categories: 0, regles: 0 })
  })

  it('refuse un identifiant déjà pris plutôt que de rattacher', async () => {
    // Réutiliser un slug relierait le nouveau client aux données de l'ancien.
    await expect(
      withUser(actors.superAdmin, (c) =>
        c.query(
          `select public.create_tenant($1, $2, $3, $4, $5)`,
          Object.values(nouveau('lba-demo-bouake')),
        ),
      ),
    ).rejects.toThrow(/déjà utilisé/)
  })

  it('refuse un identifiant mal formé', async () => {
    await expect(
      withUser(actors.superAdmin, (c) =>
        c.query(`select public.create_tenant($1, $2, $3, $4, $5)`, Object.values(nouveau('LBA Séguéla!'))),
      ),
    ).rejects.toThrow(/Identifiant d.entreprise invalide/i)
  })

  it('refuse une adresse de propriétaire invalide', async () => {
    await expect(
      withUser(actors.superAdmin, (c) =>
        c.query(`select public.create_tenant($1, $2, $3, $4, $5)`, [
          'lba-katiola',
          'LBA Katiola',
          'LBA Katiola SARL',
          'pas-une-adresse',
          'KOFFI Jean',
        ]),
      ),
    ).rejects.toThrow(/invalide/)
  })

  it('reste fermée à un propriétaire de tenant', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.create_tenant($1, $2, $3, $4, $5)`, Object.values(nouveau('lba-mankono'))),
      ),
    ).rejects.toThrow(/plateforme/i)
  })

  it('ne laisse rien derrière quand la création échoue en cours de route', async () => {
    // Tout ou rien : une entreprise à moitié née est plus coûteuse à réparer
    // qu'à recommencer. Le cas intéressant n'est pas celui d'un refus immédiat
    // — il n'a rien écrit — mais celui d'un échec survenant *après* que le
    // tenant, sa marque et son abonnement ont déjà été insérés. Le nom du
    // propriétaire manquant provoque exactement cela, à la dernière écriture.
    //
    // Le point de reprise est indispensable : une requête refusée avorte toute
    // la transaction, et sans lui les vérifications qui suivent ne s'exécutent
    // pas du tout.
    const { echec, restant } = await withUser(actors.superAdmin, async (c) => {
      await c.query('savepoint avant_creation')

      let rejete = false
      try {
        await c.query(`select public.create_tenant($1, $2, $3, $4, null)`, [
          'lba-dabakala',
          'LBA Dabakala',
          'LBA Dabakala SARL',
          'proprietaire@lba-dabakala.ci',
        ])
      } catch {
        rejete = true
      }
      await c.query('rollback to savepoint avant_creation')

      const { rows } = await asOwnerWithin(c, actors.superAdmin, () =>
        c.query(`select
           (select count(*) from tenants where slug = 'lba-dabakala')::int            as tenant,
           (select count(*) from tenant_branding
             where commercial_name = 'LBA Dabakala')::int                             as marque,
           (select count(*) from tenant_invitations
             where email = 'proprietaire@lba-dabakala.ci')::int                       as invitation`),
      )
      return { echec: rejete, restant: rows[0] as Record<string, number> }
    })

    expect(echec).toBe(true)
    expect(restant).toEqual({ tenant: 0, marque: 0, invitation: 0 })
  })

  it('trace l’ouverture dans le journal du nouveau client', async () => {
    const entree = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(
        `select public.create_tenant($1, $2, $3, $4, $5) as r`,
        Object.values(nouveau('lba-tiebissou')),
      )
      const created = rows[0].r as Record<string, string>

      return asOwnerWithin(c, actors.superAdmin, async () => {
        const result = await c.query(
          `select justification from audit_log
            where tenant_id = $1 and table_name = 'tenants' order by id desc limit 1`,
          [created.tenant_id],
        )
        return result.rows[0]?.justification as string
      })
    })

    expect(entree).toMatch(/propriétaire invité/)
  })
})

describe('invitation d’un membre', () => {
  it('un gestionnaire invite quelqu’un dans son équipe', async () => {
    const invitation = await withUser(actors.ownerA, async (c) => {
      const { rows } = await c.query(
        `select email, role::text as role, status::text as status
           from public.invite_user($1, $2, 'comptable')`,
        ['nouveau@demo.test', 'YAO Comptable'],
      )
      return rows[0] as Record<string, string>
    })

    expect(invitation).toMatchObject({
      email: 'nouveau@demo.test',
      role: 'comptable',
      status: 'pending',
    })
  })

  it('ne contourne pas ce qu’un changement de rôle interdit', async () => {
    // Inviter quelqu'un comme magasinier donnerait un compte dont personne ne
    // sait ce qu'il peut faire, exactement comme l'attribution directe.
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.invite_user($1, $2, 'magasinier')`, [
          'magasin@demo.test',
          'BAMBA Magasinier',
        ]),
      ),
    ).rejects.toThrow(/pas encore attribuable/)
  })

  it('refuse d’inviter le rôle de plateforme', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.invite_user($1, $2, 'super_admin')`, [
          'admin@demo.test',
          'Faux administrateur',
        ]),
      ),
    ).rejects.toThrow(/rôle de plateforme/)
  })

  it('refuse une adresse déjà rattachée à un compte', async () => {
    const email = await withUser(actors.ownerA, async (c) => {
      const { rows } = await c.query(`select email from users where id = $1`, [ids.managerA])
      return rows[0].email as string
    })

    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.invite_user($1, $2, 'comptable')`, [email, 'Doublon']),
      ),
    ).rejects.toThrow(/déjà rattachée/)
  })

  it('réinviter renouvelle le délai au lieu d’échouer', async () => {
    // C'est le geste normal quand un courriel s'est perdu.
    const { premier, second } = await withUser(actors.ownerA, async (c) => {
      const invite = async () => {
        const { rows } = await c.query(
          `select token, expires_at from public.invite_user($1, $2, 'comptable')`,
          ['perdu@demo.test', 'KOUAME Perdu'],
        )
        return rows[0] as { token: string; expires_at: string }
      }
      return { premier: await invite(), second: await invite() }
    })

    // Nouveau jeton : l'ancien lien cesse de valoir.
    expect(second.token).not.toBe(premier.token)
  })

  it('un comptable n’invite personne', async () => {
    await expect(
      withUser(actors.accountantA, (c) =>
        c.query(`select public.invite_user($1, $2, 'pisteur')`, ['x@demo.test', 'X']),
      ),
    ).rejects.toThrow(/ne permet pas/)
  })
})

describe('révocation d’une invitation', () => {
  it('marque sans effacer', async () => {
    // Savoir qu'une personne a été invitée puis écartée fait partie de
    // l'histoire de l'entreprise.
    const [statut, present] = await withUser(actors.ownerA, async (c) => {
      const created = await c.query(`select id from public.invite_user($1, $2, 'pisteur')`, [
        'temporaire@demo.test',
        'Invité temporaire',
      ])

      const { rows } = await c.query(
        `select status::text as status from public.revoke_invitation($1)`,
        [created.rows[0].id],
      )
      const check = await c.query(`select count(*)::int as n from tenant_invitations where id = $1`, [
        created.rows[0].id,
      ])
      return [rows[0].status as string, check.rows[0].n as number]
    })

    expect(statut).toBe('revoked')
    expect(present).toBe(1)
  })

  it('ne révoque pas deux fois', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.revoke_invitation($1)`, ['00000000-0000-4000-8000-0000000000fe']),
      ),
    ).rejects.toThrow(/introuvable, déjà acceptée ou déjà révoquée/)
  })

  it('un client ne voit pas les invitations d’un autre', async () => {
    const visibles = await withUser(actors.ownerB, async (c) => {
      await asOwnerWithin(c, actors.ownerB, () =>
        c.query(
          `insert into tenant_invitations (tenant_id, email, full_name, role)
           values ($1, 'espion@demo.test', 'Espion', 'pisteur')`,
          [ids.tenantA],
        ),
      )

      const { rows } = await c.query(`select count(*)::int as n from tenant_invitations`)
      return rows[0].n as number
    })

    expect(visibles).toBe(0)
  })
})
