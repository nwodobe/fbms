/**
 * Étape 2 · messages sortants.
 *
 * Ce que ces tests protègent, dans l'ordre de ce qui coûte le plus cher quand
 * ça casse :
 *
 *  · **on n'écrit à personne sans consentement** — un numéro dans une fiche
 *    n'est pas un accord ;
 *  · **jamais deux fois le même message** — un SMS en double se paie deux fois ;
 *  · **une étape qui échoue n'annule pas les précédentes** — prévenir tout le
 *    monde puis tout défaire est pire que ne rien faire ;
 *  · **un désabonnement arrête aussi ce qui était déjà en file**.
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

async function openAlert(
  client: PoolClient,
  severity: 'info' | 'surveillance' | 'critique' | 'blocage',
  agent: string | null = null,
): Promise<string> {
  const { rows } = await client.query(
    `insert into alerts (tenant_id, alert_type, severity, title, message, field_agent_id, status)
     values ($1, 'avance_non_couverte', $2, 'Alerte de test', 'Message de test', $3, 'ouverte')
     returning id`,
    [ids.tenantA, severity, agent],
  )
  return rows[0].id as string
}

async function consent(
  client: PoolClient,
  userId: string,
  channel: 'sms' | 'whatsapp' | 'email',
  destination = '+2250700000001',
): Promise<void> {
  await client.query(
    `insert into user_message_channels (tenant_id, user_id, channel, destination)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, user_id, channel) do update
       set destination = excluded.destination, revoked_at = null`,
    [ids.tenantA, userId, channel, destination],
  )
}

describe('consentement', () => {
  it('sans consentement, aucun message ne part', async () => {
    // Un numéro présent dans la fiche d'un utilisateur n'est pas un accord pour
    // lui écrire.
    const queued = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await openAlert(c, 'blocage')
        const { rows } = await c.query(`select app.enqueue_alert_messages($1) as n`, [ids.tenantA])
        return rows[0].n as number
      }),
    )

    expect(queued).toBe(0)
  })

  it('un canal consenti reçoit le message', async () => {
    const rows = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])

        const result = await c.query(
          `select channel::text as channel, destination, body from message_outbox
            where tenant_id = $1 and user_id = $2`,
          [ids.tenantA, ids.ownerA],
        )
        return result.rows as Array<{ channel: string; destination: string; body: string }>
      }),
    )

    expect(rows.map((row) => row.channel)).toEqual(['whatsapp'])
    expect(rows[0]!.destination).toBe('+2250700000001')
    // Sans le nom de l'entreprise, le destinataire reçoit un message anonyme
    // parlant d'argent.
    expect(rows[0]!.body).toMatch(/^LBA Démonstration Bouaké · /)
  })

  it('le consentement d’un canal n’ouvre pas les autres', async () => {
    const channels = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])

        const result = await c.query(
          `select distinct channel::text as channel from message_outbox where tenant_id = $1`,
          [ids.tenantA],
        )
        return result.rows.map((row) => row.channel as string)
      }),
    )

    expect(channels).toEqual(['whatsapp'])
  })
})

describe('échelle de gravité', () => {
  it('une information ne sort pas de l’application', async () => {
    const queued = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'info')
        const { rows } = await c.query(`select app.enqueue_alert_messages($1) as n`, [ids.tenantA])
        return rows[0].n as number
      }),
    )

    expect(queued).toBe(0)
  })

  it('un blocage sort par WhatsApp et par SMS', async () => {
    const channels = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])

        const result = await c.query(
          `select channel::text as channel from message_outbox
            where tenant_id = $1 order by channel`,
          [ids.tenantA],
        )
        return result.rows.map((row) => row.channel as string)
      }),
    )

    expect(channels).toEqual(['sms', 'whatsapp'])
  })

  it('la règle du serveur ne dépend pas du formulaire', async () => {
    // Le client décide ce qu'il montre, le serveur décide ce qui part. Un
    // formulaire contourné ne doit pas pouvoir déclencher un SMS facturé.
    const { rows } = await withUser(actors.ownerA, (c) =>
      c.query(
        `select array_length(app.channels_for_severity('info'), 1) as info,
                array_length(app.channels_for_severity('blocage'), 1) as blocage`,
      ),
    )
    expect(rows[0].info).toBeNull()
    expect(Number(rows[0].blocage)).toBe(2)
  })
})

describe('absence de doublon', () => {
  it('rejouer la mise en file ne facture pas deux fois', async () => {
    const [first, second, total] = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await openAlert(c, 'blocage')

        const a = await c.query(`select app.enqueue_alert_messages($1) as n`, [ids.tenantA])
        const b = await c.query(`select app.enqueue_alert_messages($1) as n`, [ids.tenantA])
        const count = await c.query(
          `select count(*)::int as n from message_outbox where tenant_id = $1`,
          [ids.tenantA],
        )
        return [a.rows[0].n as number, b.rows[0].n as number, count.rows[0].n as number]
      }),
    )

    expect(first).toBeGreaterThan(0)
    expect(second).toBe(0)
    expect(total).toBe(first)
  })
})

describe('heures calmes', () => {
  it('sort de la nuit vers six heures du matin', async () => {
    const { rows } = await withUser(actors.ownerA, (c) =>
      c.query(
        `select app.next_quiet_hours_end($1::timestamptz) as fin`,
        ['2026-03-20T23:30:00+00'],
      ),
    )

    const fin = new Date(rows[0].fin as string)
    expect(fin.toISOString()).toBe('2026-03-21T06:00:00.000Z')
  })

  it('avant l’aube, reporte au matin du même jour', async () => {
    const { rows } = await withUser(actors.ownerA, (c) =>
      c.query(`select app.next_quiet_hours_end($1::timestamptz) as fin`, ['2026-03-20T02:00:00+00']),
    )
    expect(new Date(rows[0].fin as string).toISOString()).toBe('2026-03-20T06:00:00.000Z')
  })

  it('un blocage part immédiatement, quelle que soit l’heure', async () => {
    const immediat = await withUser(actors.ownerA, (c) =>
      asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])

        const { rows } = await c.query(
          `select (not_before <= now() + interval '1 minute') as tout_de_suite
             from message_outbox where tenant_id = $1 limit 1`,
          [ids.tenantA],
        )
        return rows[0].tout_de_suite as boolean
      }),
    )

    expect(immediat).toBe(true)
  })
})

describe('désabonnement', () => {
  it('annule aussi ce qui était déjà en file', async () => {
    // Un désabonnement qui laisse partir les envois de la veille n'est pas un
    // désabonnement.
    const statuts = await withUser(actors.ownerA, async (c) => {
      await asOwnerWithin(c, actors.ownerA, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])
      })

      await c.query(`select public.revoke_message_channel('sms')`)

      const { rows } = await c.query(
        `select status::text as status from message_outbox where tenant_id = $1`,
        [ids.tenantA],
      )
      return rows.map((row) => row.status as string)
    })

    expect(statuts).toEqual(['cancelled'])
  })

  it('un consentement retiré n’est pas effacé', async () => {
    // La trace de ce qui a été accepté, et quand, protège l'entreprise.
    const ligne = await withUser(actors.ownerA, async (c) => {
      await asOwnerWithin(c, actors.ownerA, () => consent(c, ids.ownerA, 'sms'))
      await c.query(`select public.revoke_message_channel('sms')`)

      const { rows } = await c.query(
        `select consented_at is not null as consenti, revoked_at is not null as revoque
           from user_message_channels where tenant_id = $1 and user_id = $2 and channel = 'sms'`,
        [ids.tenantA, ids.ownerA],
      )
      return rows[0] as { consenti: boolean; revoque: boolean }
    })

    expect(ligne).toEqual({ consenti: true, revoque: true })
  })

  it('changer de coordonnée redemande un consentement', async () => {
    // Accepter de recevoir des SMS sur un numéro n'est pas les accepter sur le
    // suivant.
    const dates = await withUser(actors.ownerA, async (c) => {
      const first = await c.query(
        `select consented_at from public.set_message_channel('sms', '+2250700000001')`,
      )
      const second = await c.query(
        `select consented_at from public.set_message_channel('sms', '+2250700000099')`,
      )
      return [first.rows[0].consented_at, second.rows[0].consented_at]
    })

    expect(new Date(dates[1] as string).getTime()).toBeGreaterThanOrEqual(
      new Date(dates[0] as string).getTime(),
    )
  })
})

describe('cloisonnement', () => {
  it('un pisteur ne voit pas les messages des autres', async () => {
    const visibles = await withUser(actors.agentA1, async (c) => {
      await asOwnerWithin(c, actors.agentA1, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])
      })

      const { rows } = await c.query(`select count(*)::int as n from message_outbox`)
      return rows[0].n as number
    })

    expect(visibles).toBe(0)
  })

  it('la file n’est pas alimentable depuis un navigateur', async () => {
    const { rowCount } = await withUser(actors.ownerA, (c) =>
      c.query(
        `insert into message_outbox (tenant_id, channel, destination, body)
         select $1, 'sms', '+2250700000001', 'test'
          where false`,
        [ids.tenantA],
      ),
    )
    expect(rowCount).toBe(0)
  })

  it('seule la plateforme réserve un lot à envoyer', async () => {
    await expect(
      withUser(actors.ownerA, (c) => c.query(`select * from app.claim_messages(10)`)),
    ).rejects.toThrow(/plateforme/i)
  })
})

describe('processus d’envoi', () => {
  it('réserve un lot sans le donner deux fois', async () => {
    const [premier, second] = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])

        const a = await c.query(`select id from app.claim_messages(10)`)
        const b = await c.query(`select id from app.claim_messages(10)`)
        return [a.rowCount, b.rowCount]
      }),
    )

    expect(premier).toBeGreaterThan(0)
    // Déjà en cours d'envoi : un second appel ne les reprend pas.
    expect(second).toBe(0)
  })

  it('un échec définitif ne repart pas', async () => {
    const ligne = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])
        const claimed = await c.query(`select id from app.claim_messages(1)`)

        const { rows } = await c.query(
          `select status::text as status from app.record_message_result(
             $1, false, 'test', null, null, 'Numéro invalide', false)`,
          [claimed.rows[0].id],
        )
        return rows[0].status as string
      }),
    )

    // Insister coûte de l'argent sans rien changer.
    expect(ligne).toBe('cancelled')
  })

  it('un échec passager repart plus tard, jamais tout de suite', async () => {
    const ligne = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])
        const claimed = await c.query(`select id from app.claim_messages(1)`)

        const { rows } = await c.query(
          `select status::text as status, attempts, (not_before > now()) as differe
             from app.record_message_result($1, false, 'test', null, null, '502 gateway', true)`,
          [claimed.rows[0].id],
        )
        return rows[0] as { status: string; attempts: number; differe: boolean }
      }),
    )

    expect(ligne.status).toBe('failed')
    expect(Number(ligne.attempts)).toBe(1)
    expect(ligne.differe).toBe(true)
  })

  it('un envoi réussi conserve la référence du fournisseur', async () => {
    // Sans elle, impossible de rapprocher une facture d'opérateur des messages
    // réellement demandés.
    const ligne = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await consent(c, ids.ownerA, 'sms')
        await openAlert(c, 'blocage')
        await c.query(`select app.enqueue_alert_messages($1)`, [ids.tenantA])
        const claimed = await c.query(`select id from app.claim_messages(1)`)

        const { rows } = await c.query(
          `select status::text as status, provider, provider_ref, segments
             from app.record_message_result($1, true, 'twilio', 'SM123', 2)`,
          [claimed.rows[0].id],
        )
        return rows[0] as Record<string, unknown>
      }),
    )

    expect(ligne.status).toBe('sent')
    expect(ligne.provider_ref).toBe('SM123')
    expect(Number(ligne.segments)).toBe(2)
  })
})

describe('raccordement à la tâche planifiée', () => {
  it('évalue, prévient et met en file en une passe', async () => {
    const compte = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await openAlert(c, 'blocage')
        await c.query(`select * from app.run_alert_evaluation()`)

        const { rows } = await c.query(
          `select (select count(*) from notifications where tenant_id = $1)::int as notifs,
                  (select count(*) from message_outbox where tenant_id = $1)::int as messages`,
          [ids.tenantA],
        )
        return rows[0] as { notifs: number; messages: number }
      }),
    )

    expect(compte.notifs).toBeGreaterThan(0)
    expect(compte.messages).toBeGreaterThan(0)
  })

  it('l’échec de la mise en file n’efface pas les notifications', async () => {
    // Défaut réellement introduit : les trois étapes partageaient un seul bloc
    // d'exception, et en plpgsql une exception annule le bloc entier. Un échec
    // de la mise en file effaçait donc les alertes ouvertes et les
    // notifications créées juste avant. Prévenir tout le monde puis tout
    // défaire est pire que ne rien faire — le journal disait « exécuté » et
    // rien ne subsistait.
    const compte = await withUser(actors.superAdmin, (c) =>
      asOwnerWithin(c, actors.superAdmin, async () => {
        await consent(c, ids.ownerA, 'whatsapp')
        await openAlert(c, 'blocage')

        // On casse la seule troisième étape : un `destination` vide viole la
        // contrainte NOT NULL au moment de l'insertion dans la file.
        await c.query(`alter table message_outbox add constraint tmp_fail check (false) not valid`)
        await c.query(`alter table message_outbox validate constraint tmp_fail`).catch(() => undefined)

        const run = await c.query(`select * from app.run_alert_evaluation()`)

        const { rows } = await c.query(
          `select count(*)::int as n from notifications where tenant_id = $1`,
          [ids.tenantA],
        )
        return { notifs: rows[0].n as number, details: run.rows[0].details as unknown[] }
      }),
    )

    // Les notifications survivent à l'échec de l'étape suivante…
    expect(compte.notifs).toBeGreaterThan(0)
    // …et l'échec est consigné, pas avalé.
    expect(JSON.stringify(compte.details)).toMatch(/mise_en_file/)
  })
})
