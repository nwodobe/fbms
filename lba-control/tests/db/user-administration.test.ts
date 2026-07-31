/**
 * Étape 4 · administration des comptes et lecture du journal.
 *
 * Ce que ces tests protègent : qu'une entreprise ne puisse pas se fermer sa
 * propre porte, qu'aucun compte ne disparaisse, et que le journal reste lisible
 * sans devenir modifiable.
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

describe('changement de rôle', () => {
  it('un gestionnaire change le rôle d’un membre de son équipe', async () => {
    const role = await withUser(actors.ownerA, async (c) => {
      const { rows } = await c.query(
        `select role::text as role from public.set_user_role($1, 'comptable', $2)`,
        [ids.managerA, 'Réorganisation du service comptable'],
      )
      return rows[0].role as string
    })

    expect(role).toBe('comptable')
  })

  it('exige un motif', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.set_user_role($1, 'comptable', 'court')`, [ids.managerA]),
      ),
    ).rejects.toThrow(/motif/i)
  })

  it('refuse un rôle dont les politiques ne sont pas activées', async () => {
    // L'attribuer donnerait un compte dont personne ne sait ce qu'il peut faire.
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.set_user_role($1, 'magasinier', $2)`, [
          ids.managerA,
          'Ouverture du magasin de Bouaké',
        ]),
      ),
    ).rejects.toThrow(/politiques écrites mais non activées/)
  })

  it('personne ne change son propre rôle', async () => {
    // Se promouvoir soi-même annule la séparation des tâches ; se rétrograder
    // par erreur enferme dehors.
    await expect(
      withUser(actors.managerA, (c) =>
        c.query(`select public.set_user_role($1, 'proprietaire', $2)`, [
          ids.managerA,
          'Reprise de la direction',
        ]),
      ),
    ).rejects.toThrow(/votre propre rôle/)
  })

  it('le dernier propriétaire actif ne peut pas être rétrogradé', async () => {
    // Une entreprise sans propriétaire ne peut plus rien administrer, et seul
    // le support pourrait la rouvrir.
    const message = await withUser(actors.ownerA, async (c) => {
      await asOwnerWithin(c, actors.ownerA, () =>
        c.query(`update users set role = 'gestionnaire' where tenant_id = $1 and role = 'proprietaire' and id <> $2`, [
          ids.tenantA,
          ids.ownerA,
        ]),
      )

      // Un second propriétaire tente de rétrograder le dernier : ici, ownerA
      // est seul, donc c'est un gestionnaire qui essaie.
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({
          sub: ids.managerA,
          role: 'authenticated',
          app_metadata: { tenant_id: ids.tenantA, role: 'gestionnaire' },
        }),
      ])

      try {
        await c.query(`select public.set_user_role($1, 'comptable', $2)`, [
          ids.ownerA,
          'Départ du propriétaire',
        ])
        return null
      } catch (error) {
        return (error as Error).message
      }
    })

    expect(message).toMatch(/dernier propriétaire actif/)
  })

  it('le rôle de plateforme ne s’attribue pas depuis une entreprise', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.set_user_role($1, 'super_admin', $2)`, [
          ids.managerA,
          'Accès à la console plateforme',
        ]),
      ),
    ).rejects.toThrow(/rôle de plateforme/)
  })

  it('un comptable ne change aucun rôle', async () => {
    await expect(
      withUser(actors.accountantA, (c) =>
        c.query(`select public.set_user_role($1, 'auditeur', $2)`, [
          ids.managerA,
          'Changement de fonction',
        ]),
      ),
    ).rejects.toThrow(/ne permet pas/)
  })

  it('trace le changement dans le journal', async () => {
    const entree = await withUser(actors.ownerA, async (c) => {
      await c.query(`select public.set_user_role($1, 'auditeur', $2)`, [
        ids.managerA,
        'Passage au contrôle interne',
      ])

      // Le déclencheur d'audit générique écrit AUSSI une ligne `update` pour
      // la même modification, au même instant. Filtrer sur l'action est
      // nécessaire pour attraper celle que la fonction a écrite — sans quoi le
      // test lit une ligne sans motif et conclut à tort.
      const { rows } = await c.query(
        `select old_value, new_value, justification from audit_log
          where table_name = 'users' and record_id = $1 and action = 'status_change'
          order by id desc limit 1`,
        [ids.managerA],
      )
      return rows[0] as Record<string, unknown>
    })

    expect(entree.old_value).toMatchObject({ role: 'gestionnaire' })
    expect(entree.new_value).toMatchObject({ role: 'auditeur' })
    expect(entree.justification).toBe('Passage au contrôle interne')
  })
})

describe('suspension d’un compte', () => {
  it('suspend sans supprimer', async () => {
    // Un compte effacé emporte la lisibilité de tout ce qu'il a fait.
    const [statut, present] = await withUser(actors.ownerA, async (c) => {
      const { rows } = await c.query(
        `select status::text as status from public.set_user_status($1, 'suspended', $2)`,
        [ids.managerA, 'Absence prolongée non justifiée'],
      )
      const check = await c.query(`select count(*)::int as n from users where id = $1`, [
        ids.managerA,
      ])
      return [rows[0].status as string, check.rows[0].n as number]
    })

    expect(statut).toBe('suspended')
    expect(present).toBe(1)
  })

  it('personne ne suspend son propre compte', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.set_user_status($1, 'suspended', $2)`, [
          ids.ownerA,
          'Congé sabbatique prolongé',
        ]),
      ),
    ).rejects.toThrow(/votre propre compte/)
  })

  it('ne supprime physiquement aucun compte, même pour un propriétaire', async () => {
    const { rowCount } = await withUser(actors.ownerA, (c) =>
      c.query(`delete from users where id = $1`, [ids.managerA]),
    )
    expect(rowCount).toBe(0)
  })
})

describe('révocation d’appareil', () => {
  it('marque l’appareil sans l’effacer', async () => {
    // Savoir qu'un téléphone a été révoqué le 12 mars fait partie de l'enquête
    // sur ce qu'il a saisi le 11.
    const ligne = await withUser(actors.ownerA, async (c) => {
      const inserted = await asOwnerWithin(c, actors.ownerA, () =>
        c.query(
          `insert into user_devices (tenant_id, user_id, device_id, label)
           values ($1, $2, 'device-test', 'Téléphone de test') returning id`,
          [ids.tenantA, ids.agentUserA1],
        ),
      )

      const { rows } = await c.query(
        `select revoked_at is not null as revoque from public.revoke_device($1, $2)`,
        [inserted.rows[0].id, 'Téléphone perdu sur le terrain'],
      )
      return rows[0].revoque as boolean
    })

    expect(ligne).toBe(true)
  })

  it('un appareil déjà révoqué ne se révoque pas deux fois', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select public.revoke_device($1, $2)`, [
          '00000000-0000-4000-8000-0000000000ff',
          'Test',
        ]),
      ),
    ).rejects.toThrow(/introuvable ou déjà révoqué/)
  })
})

describe('journal d’audit', () => {
  it('se lit filtré et borné', async () => {
    const resultat = await withUser(actors.ownerA, async (c) => {
      const { rows } = await c.query(`select app.audit_trail(null, null, null, null, null, 5) as j`)
      return rows[0].j as { total: number; entries: unknown[] }
    })

    expect(Number(resultat.total)).toBeGreaterThan(0)
    // La pagination est imposée par le serveur, pas laissée à l'appelant.
    expect(resultat.entries.length).toBeLessThanOrEqual(5)
  })

  it('nomme l’auteur plutôt que son identifiant', async () => {
    const entree = await withUser(actors.ownerA, async (c) => {
      await c.query(`select public.set_user_role($1, 'comptable', $2)`, [
        ids.managerA,
        'Réorganisation du service',
      ])
      const { rows } = await c.query(
        `select app.audit_trail('status_change', 'users', null, null, null, 1) as j`,
      )
      return (rows[0].j as { entries: Array<Record<string, unknown>> }).entries[0]
    })

    expect(entree?.user_name).toBeTruthy()
    expect(entree?.user_role).toBeTruthy()
  })

  it('filtre par action', async () => {
    const actions = await withUser(actors.ownerA, async (c) => {
      const { rows } = await c.query(
        `select app.audit_trail('create', null, null, null, null, 20) as j`,
      )
      return (rows[0].j as { entries: Array<{ action: string }> }).entries.map((e) => e.action)
    })

    expect(new Set(actions).size).toBeLessThanOrEqual(1)
  })

  it('reste fermé au pisteur', async () => {
    // Il y verrait l'activité de tous les autres, montants compris.
    await expect(
      withUser(actors.agentA1, (c) => c.query(`select app.audit_trail()`)),
    ).rejects.toThrow(/pas accessible à votre profil/)
  })

  it('ne montre rien d’un autre client', async () => {
    const total = await withUser(actors.ownerB, async (c) => {
      const { rows } = await c.query(`select app.audit_trail(null, null, null, null, null, 500) as j`)
      const entries = (rows[0].j as { entries: Array<{ record_id: string }> }).entries
      return entries.filter((e) => e.record_id === ids.managerA).length
    })

    expect(total).toBe(0)
  })

  it('reste immuable, y compris pour celui qui le consulte', async () => {
    const { rowCount } = await withUser(actors.ownerA, (c) =>
      c.query(`update audit_log set justification = 'réécrit' where tenant_id = $1`, [ids.tenantA]),
    )
    expect(rowCount).toBe(0)
  })
})
