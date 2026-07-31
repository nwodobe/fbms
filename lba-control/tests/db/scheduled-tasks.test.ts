/**
 * Phase 9 · tâches récurrentes exécutées par le serveur.
 *
 * Ce que ces tests protègent : que les deux traitements qui font vivre le
 * produit dans le temps — la bascule d'abonnement et l'évaluation des alertes —
 * tournent réellement sur l'ensemble des clients, qu'un client en erreur
 * n'empêche pas les autres, et qu'un échec laisse une trace consultable.
 *
 * Le point le plus important est le deuxième. Une boucle qui s'arrête au
 * premier client fautif donne l'illusion de fonctionner : le journal dit
 * « exécuté », et quarante clients n'ont rien reçu.
 *
 * Tout s'exécute dans une transaction annulée. `asOwner` seul committerait :
 * les exécutions planifiées écrivent dans plusieurs tables, et les laisser
 * derrière soi ferait dépendre chaque test de l'ordre des précédents.
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

/**
 * Exécute un bloc avec les droits du propriétaire de la base — ceux qu'a
 * l'ordonnanceur — puis rend la main à l'acteur indiqué, sans rien committer.
 */
function asScheduler<T>(
  actor = actors.superAdmin,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withUser(actor, (client) => asOwnerWithin(client, actor, () => fn(client)))
}

describe('cycle d’abonnement planifié', () => {
  it('parcourt tous les abonnements actifs et consigne l’exécution', async () => {
    const run = await asScheduler(actors.superAdmin, async (c) => {
      const { rows } = await c.query(`select * from app.run_subscription_lifecycle()`)
      return rows[0]
    })

    expect(run.task).toBe('subscription_lifecycle')
    expect(run.status).toBe('succeeded')
    expect(run.finished_at).not.toBeNull()
    // Au moins les clients du jeu de test.
    expect(Number(run.tenants_seen)).toBeGreaterThanOrEqual(2)
  })

  it('fait réellement basculer un abonnement échu', async () => {
    const status = await asScheduler(actors.superAdmin, async (c) => {
      const prepared = await c.query(
        // `period_start` suit `period_end` : une contrainte impose l'ordre des
        // deux, et l'oublier ferait échouer la préparation, pas la règle testée.
        `update subscriptions
            set status = 'active',
                period_start = current_date - 70,
                period_end = current_date - 40,
                grace_started_at = null, read_only_at = null, blocked_at = null
          where tenant_id = $1`,
        [ids.tenantA],
      )
      // Une préparation silencieusement filtrée ferait passer ce test sur un
      // état jamais posé — le défaut le plus dangereux rencontré en phase 6.
      expect(prepared.rowCount).toBe(1)

      await c.query(`select app.run_subscription_lifecycle()`)

      const { rows } = await c.query(`select status from subscriptions where tenant_id = $1`, [
        ids.tenantA,
      ])
      return rows[0].status
    })

    // 40 jours d'échéance dépassée : bien au-delà de la période de grâce.
    expect(status).not.toBe('active')
  })

  it('un client en erreur n’interrompt pas les autres', async () => {
    const run = await asScheduler(actors.superAdmin, async (c) => {
      // Deux clients échus en même temps : l'exécution doit les voir tous les
      // deux, quoi qu'il advienne du premier.
      await c.query(
        `update subscriptions set period_start = current_date - 120, period_end = current_date - 90`,
      )

      const { rows } = await c.query(`select * from app.run_subscription_lifecycle()`)
      return rows[0]
    })

    expect(run.status).toBe('succeeded')
    expect(Number(run.tenants_seen)).toBeGreaterThanOrEqual(2)
    // Chaque client parcouru l'a été jusqu'au bout : soit un changement, soit
    // une erreur nommée. Aucun ne disparaît en silence.
    expect(Number(run.changes) + countErrors(run.details)).toBeGreaterThanOrEqual(2)
  })
})

function countErrors(details: Array<Record<string, unknown>>): number {
  return details.filter((entry) => 'error' in entry).length
}

describe('évaluation planifiée des alertes', () => {
  it('parcourt les clients actifs sans exiger de tenant courant', async () => {
    // L'ordonnanceur n'a pas de session : la fonction se place elle-même sur
    // chaque client, en passant par les mêmes règles qu'un appel ordinaire.
    const run = await asScheduler(actors.superAdmin, async (c) => {
      const { rows } = await c.query(`select * from app.run_alert_evaluation()`)
      return rows[0]
    })

    expect(run.task).toBe('alert_evaluation')
    expect(run.status).toBe('succeeded')
    expect(Number(run.tenants_seen)).toBeGreaterThanOrEqual(1)
  })

  it('rend le contexte emprunté après son passage', async () => {
    // Laisser le contexte du dernier client parcouru ferait passer la suite de
    // la session pour lui — dans une base multi-tenant, c'est une fuite.
    const claims = await asScheduler(actors.superAdmin, async (c) => {
      await c.query(`select app.run_alert_evaluation()`)
      const { rows } = await c.query(
        `select coalesce(current_setting('request.jwt.claims', true), '') as claims`,
      )
      return rows[0].claims
    })

    expect(claims).toBe('')
  })

  it('n’ouvre pas deux fois la même alerte', async () => {
    const [first, second] = await asScheduler(actors.superAdmin, async (c) => {
      const count = async () => {
        const { rows } = await c.query(
          `select count(*)::int as n from alerts where tenant_id = $1 and status = 'ouverte'`,
          [ids.tenantA],
        )
        return rows[0].n as number
      }

      await c.query(`select app.run_alert_evaluation()`)
      const a = await count()
      await c.query(`select app.run_alert_evaluation()`)
      const b = await count()
      return [a, b]
    })

    expect(second).toBe(first)
  })
})

describe('journal des exécutions', () => {
  it('n’est lisible que par la plateforme', async () => {
    // Le journal parle de tous les clients à la fois : son contenu révélerait
    // le nombre et l'activité des autres.
    const visible = await withUser(actors.ownerA, async (c) => {
      await asOwnerWithin(c, actors.ownerA, () => c.query(`select app.run_alert_evaluation()`))
      const { rows } = await c.query(`select count(*)::int as n from scheduled_task_runs`)
      return rows[0].n as number
    })

    expect(visible).toBe(0)
  })

  it('n’est pas modifiable, même par la plateforme, depuis un navigateur', async () => {
    const affected = await withUser(actors.superAdmin, async (c) => {
      await asOwnerWithin(c, actors.superAdmin, () =>
        c.query(`select app.run_alert_evaluation()`),
      )
      const result = await c.query(`update scheduled_task_runs set status = 'failed'`)
      return result.rowCount
    })

    // RLS filtre au lieu de lever : c'est le nombre de lignes touchées qui fait
    // foi, jamais l'absence d'erreur.
    expect(affected).toBe(0)
  })

  it('se consulte par la console plateforme, résumé plutôt qu’en vrac', async () => {
    const history = await withUser(actors.superAdmin, async (c) => {
      await asOwnerWithin(c, actors.superAdmin, () =>
        c.query(`select app.run_subscription_lifecycle()`),
      )
      const { rows } = await c.query(`select app.scheduled_task_history(5) as history`)
      return rows[0].history as Array<Record<string, unknown>>
    })

    expect(Array.isArray(history)).toBe(true)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0]).toHaveProperty('task')
    expect(history[0]).toHaveProperty('tenants_seen')
    // Le détail complet peut être volumineux : le nombre d'anomalies suffit à
    // savoir s'il faut aller le lire.
    expect(history[0]).toHaveProperty('error_count')
  })

  it('reste fermé à un propriétaire de tenant', async () => {
    await expect(
      withUser(actors.ownerA, (c) => c.query(`select app.scheduled_task_history()`)),
    ).rejects.toThrow(/plateforme/i)
  })
})
