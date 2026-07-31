/**
 * Phase 9 · notifications engendrées par les alertes.
 *
 * Ce que ces tests protègent :
 *
 *  · **l'audience** — une notification part exactement à qui a déjà le droit de
 *    lire l'alerte, jamais à un pisteur qui n'y est pas nommé ;
 *  · **l'absence de doublon** — l'évaluation tourne deux fois par jour sur des
 *    alertes qui restent ouvertes plusieurs jours ;
 *  · **la distinction lue / résolue** — ranger son écran n'est pas régler la
 *    situation, et le serveur ne doit pas laisser confondre les deux.
 */
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { asOwnerWithin, pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

/** Ouvre une alerte, sans passer par les conditions qui la déclenchent. */
async function openAlert(
  client: PoolClient,
  over: { agent?: string | null; title?: string; severity?: string } = {},
): Promise<string> {
  const { rows } = await client.query(
    `insert into alerts (tenant_id, alert_type, severity, title, message, field_agent_id, status)
     values ($1, 'avance_non_couverte', $2, $3, 'Message de test', $4, 'ouverte')
     returning id`,
    [
      ids.tenantA,
      over.severity ?? 'critique',
      over.title ?? 'Alerte de test',
      over.agent === undefined ? null : over.agent,
    ],
  )
  return rows[0].id as string
}

describe('audience d’une alerte', () => {
  it('une alerte sans pisteur ne va pas aux pisteurs', async () => {
    const roles = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        const alertId = await openAlert(c)
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])

        const { rows } = await c.query(
          `select distinct u.role::text as role
             from notifications n join users u on u.id = n.user_id
            where n.alert_id = $1`,
          [alertId],
        )
        return rows.map((row) => row.role as string)
      }),
    )

    expect(roles).not.toContain('pisteur')
    expect(roles).toContain('proprietaire')
  })

  it('une alerte nommant un pisteur ne va qu’à celui-là', async () => {
    const recipients = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        const alertId = await openAlert(c, { agent: ids.agentA1 })
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])

        const { rows } = await c.query(
          `select u.id, u.role::text as role
             from notifications n join users u on u.id = n.user_id
            where n.alert_id = $1`,
          [alertId],
        )
        return rows as Array<{ id: string; role: string }>
      }),
    )

    const pisteurs = recipients.filter((row) => row.role === 'pisteur')
    expect(pisteurs).toHaveLength(1)
    expect(pisteurs[0]!.id).toBe(ids.agentUserA1)
  })

  it('l’auditeur n’est pas notifié', async () => {
    // Un observateur qui lit quand il le décide : le prévenir de tout ne ferait
    // que du bruit sans lui donner de moyen d'agir.
    const roles = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        const alertId = await openAlert(c)
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])
        const { rows } = await c.query(
          `select distinct u.role::text as role
             from notifications n join users u on u.id = n.user_id
            where n.alert_id = $1`,
          [alertId],
        )
        return rows.map((row) => row.role as string)
      }),
    )

    expect(roles).not.toContain('auditeur')
  })

  it('aucune notification ne traverse la frontière d’un client', async () => {
    const foreign = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await openAlert(c)
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])

        const { rows } = await c.query(
          `select count(*)::int as n
             from notifications n join users u on u.id = n.user_id
            where n.tenant_id = $1 and u.tenant_id <> $1`,
          [ids.tenantA],
        )
        return rows[0].n as number
      }),
    )

    expect(foreign).toBe(0)
  })

  it('un client ne peut pas engendrer les notifications d’un autre', async () => {
    await expect(
      withUser(actors.ownerA, (c) =>
        c.query(`select app.notify_from_alerts($1)`, [ids.tenantB]),
      ),
    ).rejects.toThrow(/non autorisée/i)
  })
})

describe('absence de doublon', () => {
  it('rejouer l’envoi ne remplit pas la boîte', async () => {
    // L'évaluation tourne deux fois par jour sur des alertes qui restent
    // ouvertes plusieurs jours : le conflit est le cas normal, pas l'exception.
    const [first, second, total] = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        const alertId = await openAlert(c)

        const a = await c.query(`select app.notify_from_alerts($1) as n`, [ids.tenantA])
        const b = await c.query(`select app.notify_from_alerts($1) as n`, [ids.tenantA])
        const count = await c.query(
          `select count(*)::int as n from notifications where alert_id = $1`,
          [alertId],
        )

        return [a.rows[0].n as number, b.rows[0].n as number, count.rows[0].n as number]
      }),
    )

    expect(first).toBeGreaterThan(0)
    // Le second passage ne crée RIEN : compter les alertes parcourues ferait
    // croire à un envoi là où l'index unique a tout écarté.
    expect(second).toBe(0)
    expect(total).toBe(first)
  })

  it('une alerte fermée ne produit plus de notification', async () => {
    const created = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await openAlert(c, { title: 'Alerte résolue' })
        await c.query(`update alerts set status = 'resolue' where tenant_id = $1`, [ids.tenantA])
        const { rows } = await c.query(`select app.notify_from_alerts($1) as n`, [ids.tenantA])
        return rows[0].n as number
      }),
    )

    expect(created).toBe(0)
  })
})

describe('lue n’est pas résolue', () => {
  it('marquer comme lu ne touche pas au statut de l’alerte', async () => {
    // Confondre les deux ferait disparaître un problème d'un simple coup d'œil.
    const [read, status] = await withUser(actors.ownerA, async (c) => {
      const alertId = await asOwnerWithin(c, actors.ownerA, async () => {
        const id = await openAlert(c)
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])
        return id
      })

      const marked = await c.query(`select app.mark_notifications_read() as n`)
      const alert = await c.query(`select status::text as status from alerts where id = $1`, [
        alertId,
      ])

      return [marked.rows[0].n as number, alert.rows[0].status as string]
    })

    expect(read).toBeGreaterThan(0)
    expect(status).toBe('ouverte')
  })

  it('ne marque que ses propres notifications', async () => {
    const others = await withUser(actors.ownerA, async (c) => {
      await asOwnerWithin(c, actors.ownerA, async () => {
        await openAlert(c)
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])
      })

      await c.query(`select app.mark_notifications_read()`)

      const { rows } = await c.query(
        `select count(*)::int as n from notifications
          where tenant_id = $1 and user_id <> $2 and read_at is not null`,
        [ids.tenantA, ids.ownerA],
      )
      return rows[0].n as number
    })

    expect(others).toBe(0)
  })

  it('ne réécrit pas la date d’une notification déjà lue', async () => {
    // La date de première lecture est la seule information utile : elle dit
    // quand quelqu'un a su.
    const second = await withUser(actors.ownerA, async (c) => {
      await asOwnerWithin(c, actors.ownerA, async () => {
        await openAlert(c)
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])
      })

      await c.query(`select app.mark_notifications_read()`)
      const { rows } = await c.query(`select app.mark_notifications_read() as n`)
      return rows[0].n as number
    })

    expect(second).toBe(0)
  })

  it('un pisteur ne voit pas les notifications des autres', async () => {
    const visible = await withUser(actors.agentA1, async (c) => {
      await asOwnerWithin(c, actors.agentA1, async () => {
        await openAlert(c, { agent: ids.agentA2 })
        await c.query(`select app.notify_from_alerts($1)`, [ids.tenantA])
      })

      const { rows } = await c.query(`select count(*)::int as n from notifications`)
      return rows[0].n as number
    })

    expect(visible).toBe(0)
  })
})

describe('raccordement à la tâche planifiée', () => {
  it('évaluer les alertes prévient aussi les gens', async () => {
    // Évaluer sans prévenir laisserait le produit exactement où il était :
    // des alertes ouvertes que personne ne voit.
    const notified = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await openAlert(c, { title: 'Alerte planifiée' })
        await c.query(`select * from app.run_alert_evaluation()`)

        const { rows } = await c.query(
          `select count(*)::int as n from notifications where tenant_id = $1`,
          [ids.tenantA],
        )
        return rows[0].n as number
      }),
    )

    expect(notified).toBeGreaterThan(0)
  })
})
