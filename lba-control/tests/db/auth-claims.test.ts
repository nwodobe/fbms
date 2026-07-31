/**
 * Étape 7 · le jeton d'accès et l'acceptation d'une invitation.
 *
 * Ce que ces tests protègent : que `app_metadata` soit une projection de
 * `public.users` et jamais une valeur recopiée à la main, qu'un compte suspendu
 * cesse d'emporter son tenant, et qu'une invitation ne serve qu'à la personne à
 * qui elle a été adressée.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { asOwner, pool, withUser } from './helpers'
import type { PoolClient } from 'pg'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

/** Reproduit ce que Supabase Auth passe au hook. */
const evenement = (userId: string) => ({
  user_id: userId,
  claims: { sub: userId, role: 'authenticated', app_metadata: {} },
  authentication_method: 'password',
})

/** Ce que le hook doit rendre : l'événement, claims remplacées. */
interface JetonEmis {
  claims: { app_metadata: Record<string, unknown> }
}

const metadata = (ligne: { e: unknown }): Record<string, unknown> =>
  (ligne.e as JetonEmis).claims.app_metadata

async function claims(userId: string): Promise<Record<string, unknown>> {
  return asOwner(async (c) => {
    const { rows } = await c.query<{ e: unknown }>(
      `select app.custom_access_token($1::jsonb) as e`,
      [JSON.stringify(evenement(userId))],
    )
    return metadata(rows[0]!)
  })
}

/**
 * Se faire passer pour un compte fraîchement inscrit : authentifié, porteur
 * d'une adresse, mais rattaché à aucune entreprise. C'est l'état exact d'un
 * propriétaire invité qui vient de créer son mot de passe.
 */
async function devenirNouvelArrivant(c: PoolClient, userId: string, email: string): Promise<void> {
  await c.query('reset role')
  await c.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: userId, role: 'authenticated', email, app_metadata: {} }),
  ])
  await c.query('set local role authenticated')
}

const NOUVEAU_ID = '00000000-0000-4000-8000-0000000000f1'

const entreprise = (slug: string) => ({
  slug,
  nom: 'LBA Man',
  legal: 'LBA Man SARL',
  email: 'proprietaire@lba-man.ci',
  contact: 'DIOMANDE Salif',
})

describe('le jeton comme projection de public.users', () => {
  it('porte le tenant et le rôle d’un compte actif', async () => {
    // La table est la seule source. Aucune valeur n'est recopiée à la main,
    // donc aucune ne peut être recopiée de travers.
    expect(await claims(ids.ownerA)).toEqual({
      tenant_id: ids.tenantA,
      role: 'proprietaire',
    })

    expect(await claims(ids.accountantA)).toEqual({
      tenant_id: ids.tenantA,
      role: 'comptable',
    })
  })

  it('suit un changement de rôle sans recopie', async () => {
    // C'est le défaut que le hook corrige : `set_user_role` changeait la table
    // et le journal, mais le jeton continuait de porter l'ancien rôle. Une
    // rétrogradation ne prenait effet nulle part.
    const apres = await asOwner(async (c) => {
      await c.query('begin')
      await c.query(`update users set role = 'comptable' where id = $1`, [ids.managerA])
      const { rows } = await c.query<{ e: unknown }>(
        `select app.custom_access_token($1::jsonb) as e`,
        [JSON.stringify(evenement(ids.managerA))],
      )
      await c.query('rollback')
      return metadata(rows[0]!)
    })

    expect(apres).toEqual({ tenant_id: ids.tenantA, role: 'comptable' })
  })

  it('retire le tenant d’un compte suspendu', async () => {
    // La suspension devient effective au rafraîchissement du jeton, et non à la
    // seule prochaine ouverture de session.
    const apres = await asOwner(async (c) => {
      await c.query('begin')
      await c.query(`update users set status = 'suspended' where id = $1`, [ids.accountantA])
      const { rows } = await c.query<{ e: unknown }>(
        `select app.custom_access_token($1::jsonb) as e`,
        [JSON.stringify(evenement(ids.accountantA))],
      )
      await c.query('rollback')
      return metadata(rows[0]!)
    })

    expect(apres).toEqual({})
  })

  it('n’attribue aucun tenant à l’administrateur de plateforme', async () => {
    // Sans tenant dans son jeton, il doit passer par une session d'assistance
    // motivée pour voir les données d'un client.
    expect(await claims(ids.superAdmin)).toEqual({
      tenant_id: null,
      role: 'super_admin',
    })
  })

  it('n’invente rien pour un compte inconnu', async () => {
    // État normal juste après l'inscription, avant l'acceptation. Un jeton sans
    // tenant ne donne accès à rien : c'est le bon échec.
    expect(await claims(NOUVEAU_ID)).toEqual({})
  })
})

describe('acceptation d’une invitation', () => {
  it('transforme l’invitation en compte rattaché', async () => {
    const etat = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(
        `select public.create_tenant($1, $2, $3, $4, $5) as r`,
        Object.values(entreprise('lba-man')),
      )
      const cree = rows[0]!.r as Record<string, string>

      await devenirNouvelArrivant(c, NOUVEAU_ID, 'proprietaire@lba-man.ci')

      const accepte = await c.query(`select * from public.accept_invitation($1)`, [
        cree.invitation_token,
      ])

      return { cree, utilisateur: accepte.rows[0]! as Record<string, string> }
    })

    expect(etat.utilisateur.id).toBe(NOUVEAU_ID)
    expect(etat.utilisateur.tenant_id).toBe(etat.cree.tenant_id)
    expect(etat.utilisateur.role).toBe('proprietaire')
    expect(etat.utilisateur.status).toBe('active')
  })

  it('refuse une adresse différente de celle invitée', async () => {
    // Le jeton seul suffirait à quiconque le lit dans une boîte mail
    // transférée. L'adresse authentifiée lie le compte à la personne invitée.
    await expect(
      withUser(actors.superAdmin, async (c) => {
        const { rows } = await c.query(
          `select public.create_tenant($1, $2, $3, $4, $5) as r`,
          Object.values(entreprise('lba-man-2')),
        )
        const cree = rows[0]!.r as Record<string, string>

        await devenirNouvelArrivant(c, NOUVEAU_ID, 'quelquun.dautre@exemple.ci')
        return c.query(`select public.accept_invitation($1)`, [cree.invitation_token])
      }),
    ).rejects.toThrow(/autre adresse/)
  })

  it('refuse un jeton inconnu, révoqué ou déjà utilisé', async () => {
    await expect(
      withUser(actors.superAdmin, async (c) => {
        await devenirNouvelArrivant(c, NOUVEAU_ID, 'proprietaire@lba-man.ci')
        return c.query(`select public.accept_invitation($1)`, ['jeton-inexistant'])
      }),
    ).rejects.toThrow(/introuvable, déjà utilisée ou révoquée/)
  })

  it('refuse une invitation expirée et la marque comme telle', async () => {
    // Laissée « pending », une invitation périmée bloquerait toute réinvitation
    // de la même adresse.
    await expect(
      withUser(actors.superAdmin, async (c) => {
        const { rows } = await c.query(
          `select public.create_tenant($1, $2, $3, $4, $5) as r`,
          Object.values(entreprise('lba-man-3')),
        )
        const cree = rows[0]!.r as Record<string, string>

        await c.query('reset role')
        await c.query(`update tenant_invitations set expires_at = now() - interval '1 day' where id = $1`,
          [cree.invitation_id])

        await devenirNouvelArrivant(c, NOUVEAU_ID, 'proprietaire@lba-man.ci')
        return c.query(`select public.accept_invitation($1)`, [cree.invitation_token])
      }),
    ).rejects.toThrow(/a expiré/)
  })

  it('refuse de rattacher une identité déjà employée ailleurs', async () => {
    // Une même identité servant deux entreprises rendrait le cloisonnement
    // dépendant de l'ordre des connexions.
    await expect(
      withUser(actors.superAdmin, async (c) => {
        const { rows } = await c.query(
          `select public.create_tenant($1, $2, $3, $4, $5) as r`,
          Object.values(entreprise('lba-man-4')),
        )
        const cree = rows[0]!.r as Record<string, string>

        await devenirNouvelArrivant(c, ids.ownerA, 'proprietaire@lba-man.ci')
        return c.query(`select public.accept_invitation($1)`, [cree.invitation_token])
      }),
    ).rejects.toThrow(/déjà rattaché/)
  })

  it('annonce l’entreprise sans divulguer l’adresse invitée', async () => {
    // Un jeton deviné ne doit pas livrer une adresse électronique valide.
    const apercu = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(
        `select public.create_tenant($1, $2, $3, $4, $5) as r`,
        Object.values(entreprise('lba-man-5')),
      )
      const cree = rows[0]!.r as Record<string, string>

      await devenirNouvelArrivant(c, NOUVEAU_ID, 'proprietaire@lba-man.ci')
      const { rows: vue } = await c.query(`select public.invitation_preview($1) as v`, [
        cree.invitation_token,
      ])
      return vue[0]!.v as Record<string, unknown>
    })

    expect(apercu.found).toBe(true)
    expect(apercu.commercial_name).toBe('LBA Man')
    expect(apercu.role).toBe('proprietaire')
    expect(apercu.email_matches).toBe(true)
    expect(apercu.expired).toBe(false)
    expect(Object.keys(apercu)).not.toContain('email')
  })

  it('ne dit rien d’un jeton qui ne correspond à rien', async () => {
    const apercu = await withUser(actors.superAdmin, async (c) => {
      const { rows } = await c.query(`select public.invitation_preview($1) as v`, ['inexistant'])
      return rows[0]!.v as Record<string, unknown>
    })

    expect(apercu).toEqual({ found: false })
  })
})
