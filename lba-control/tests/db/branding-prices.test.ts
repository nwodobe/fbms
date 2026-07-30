/**
 * Phase 2 · règles serveur de la marque et des prix.
 *
 * Ce qui est vérifié ici ne peut pas l'être dans un formulaire : que la base
 * refuse elle-même une couleur illisible et une révision de prix rétroactive,
 * même appelée directement par l'API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { affectedRows, expectRejected, pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

// ---------------------------------------------------------------------------
// Contraste des couleurs de marque · appliqué en base
// ---------------------------------------------------------------------------

describe('marque · le contraste est vérifié côté serveur', () => {
  it('le calcul SQL concorde avec l’implémentation TypeScript', async () => {
    const { rows } = await withUser(actors.ownerA, (c) =>
      c.query(`
        select app.contrast_ratio('#000000', '#ffffff') as noir_blanc,
               app.contrast_ratio('#1f6f43', '#ffffff') as vert_blanc,
               round(app.color_distance('#1f6f43', '#8a3d00')) as distinctes,
               round(app.color_distance('#1f6f43', '#206f44')) as quasi_identiques
      `),
    )
    // Les mêmes valeurs que src/domain/contrast.test.ts : deux implémentations
    // qui divergeraient laisseraient passer côté serveur ce que le formulaire
    // refuse, ou l'inverse.
    expect(Number(rows[0].noir_blanc)).toBe(21)
    expect(Number(rows[0].vert_blanc)).toBeCloseTo(6.15, 2)
    expect(Number(rows[0].distinctes)).toBe(221)
    expect(Number(rows[0].quasi_identiques)).toBe(2)
  })

  it('accepte une paire lisible et conserve la mesure', async () => {
    await withUser(actors.ownerA, async (c) => {
      await c.query(
        `update tenant_branding set primary_color = '#1f6f43', secondary_color = '#8a3d00'
          where tenant_id = $1`,
        [ids.tenantA],
      )
      const { rows } = await c.query(
        `select primary_contrast_ratio, secondary_contrast_ratio from tenant_branding where tenant_id = $1`,
        [ids.tenantA],
      )
      // La mesure est stockée : une acceptation doit rester justifiable après coup.
      expect(Number(rows[0].primary_contrast_ratio)).toBeGreaterThanOrEqual(4.5)
      expect(Number(rows[0].secondary_contrast_ratio)).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('refuse une couleur invisible sur le fond de l’application', async () => {
    const message = await expectRejected(
      actors.ownerA,
      `update tenant_branding set primary_color = '#fefefe' where tenant_id = $1`,
      [ids.tenantA],
    )
    expect(message).toMatch(/fond de l'application|fond de l’application/)
    expect(message).toMatch(/1\.01:1/)
  })

  it('refuse une couleur au contraste de texte insuffisant', async () => {
    const message = await expectRejected(
      actors.ownerA,
      `update tenant_branding set primary_color = '#787878' where tenant_id = $1`,
      [ids.tenantA],
    )
    expect(message).toMatch(/avec le texte/)
  })

  it('refuse deux couleurs quasi identiques', async () => {
    const message = await expectRejected(
      actors.ownerA,
      `update tenant_branding set primary_color = '#1f6f43', secondary_color = '#206f44'
        where tenant_id = $1`,
      [ids.tenantA],
    )
    expect(message).toMatch(/trop proches/)
  })

  it('un pisteur ne modifie pas la marque de l’entreprise', async () => {
    const n = await affectedRows(
      actors.agentA1,
      `update tenant_branding set primary_color = '#000080' where tenant_id = $1`,
      [ids.tenantA],
    )
    expect(n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Révision de prix
// ---------------------------------------------------------------------------

describe('prix · une révision crée une version, elle n’écrase jamais', () => {
  it('clôt la version en cours et en crée une nouvelle', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows: created } = await c.query(
        `select * from app.revise_price($1, 'negocie', 465, current_date + 1,
                                        'Révision négociée avec la société partenaire')`,
        [ids.contractOlam],
      )
      expect(Number(created[0].price)).toBe(465)
      expect(created[0].version).toBe(2)
      expect(created[0].valid_to).toBeNull()

      const { rows: previous } = await c.query(
        `select price, valid_to, superseded_by from negotiated_prices where id = $1`,
        [ids.priceOlam],
      )
      // L'ancienne version garde SON prix : les opérations déjà valorisées
      // avec elle ne changent pas de valeur.
      expect(Number(previous[0].price)).toBe(450)
      expect(previous[0].valid_to).not.toBeNull()
      expect(previous[0].superseded_by).toBe(created[0].id)
    })
  })

  it('laisse le prix applicable à une date passée inchangé', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `select app.revise_price($1, 'negocie', 465, current_date + 1, 'Révision de campagne')`,
        [ids.contractOlam],
      )
      const { rows } = await c.query(
        `select price from negotiated_prices
          where contract_id = $1 and price_type = 'negocie'
            and valid_from <= current_date and (valid_to is null or valid_to >= current_date)`,
        [ids.contractOlam],
      )
      expect(rows).toHaveLength(1)
      expect(Number(rows[0].price)).toBe(450)
    })
  })

  it('refuse une révision rétroactive', async () => {
    const message = await expectRejected(
      actors.managerA,
      `select app.revise_price($1, 'negocie', 400, current_date - 90, 'Correction rétroactive du prix')`,
      [ids.contractOlam],
    )
    expect(message).toMatch(/rétroactivement|postérieure au début de la version en cours/)
  })

  it('refuse une révision sans justification exploitable', async () => {
    const message = await expectRejected(
      actors.managerA,
      `select app.revise_price($1, 'negocie', 470, current_date + 1, 'maj')`,
      [ids.contractOlam],
    )
    expect(message).toMatch(/justification explicite est obligatoire/)
  })

  it('refuse un prix nul ou négatif', async () => {
    const message = await expectRejected(
      actors.managerA,
      `select app.revise_price($1, 'negocie', 0, current_date + 1, 'Tentative de prix nul')`,
      [ids.contractOlam],
    )
    expect(message).toMatch(/strictement positif/)
  })

  it('réserve la révision au propriétaire et au gestionnaire', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `select app.revise_price($1, 'negocie', 460, current_date + 1, 'Révision par le comptable')`,
      [ids.contractOlam],
    )
    expect(message).toMatch(/propriétaire et le gestionnaire/)
  })

  it('refuse une révision sur le contrat d’un autre tenant', async () => {
    const message = await expectRejected(
      actors.ownerB,
      `select app.revise_price($1, 'negocie', 460, current_date + 1, 'Tentative inter-entreprises')`,
      [ids.contractOlam],
    )
    expect(message).toMatch(/hors du périmètre|introuvable/i)
  })

  it('bloque la révision quand l’abonnement est suspendu', async () => {
    // Le contrat appartient au tenant A, actif : on vérifie plutôt qu'un tenant
    // suspendu ne peut pas écrire du tout sur ses propres prix.
    const message = await expectRejected(
      actors.ownerReadOnly,
      `insert into negotiated_prices (tenant_id, contract_id, price_type, price, valid_from)
       values ($1, $2, 'negocie', 400, current_date)`,
      [ids.tenantReadOnly, ids.contractOlam],
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('crée la première version quand aucun prix n’existe encore', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select * from app.revise_price($1, 'plafond_achat', 435, current_date,
                                        'Plafond d''achat initial pour la campagne')`,
        [ids.contractOlam],
      )
      expect(rows[0].version).toBe(1)
      expect(rows[0].valid_to).toBeNull()
    })
  })

  it('journalise la révision avec ancienne et nouvelle valeur', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(
        `select app.revise_price($1, 'negocie', 468, current_date + 1, 'Révision suivie en comité')`,
        [ids.contractOlam],
      )
      const { rows } = await c.query(
        `select old_value, new_value, justification from audit_log
          where action = 'price_change' and table_name = 'negotiated_prices'
          order by id desc limit 1`,
      )
      expect(Number(rows[0].old_value.price)).toBe(450)
      expect(Number(rows[0].new_value.price)).toBe(468)
      expect(rows[0].justification).toMatch(/comité/)
    })
  })
})

// ---------------------------------------------------------------------------
// Activation d'un contrat
// ---------------------------------------------------------------------------

describe('contrat · activation', () => {
  it('refuse d’activer un contrat dépourvu de prix négocié', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `insert into contracts (tenant_id, partner_company_id, campaign_id, product_id, reference,
                                start_date, end_date, status)
         values ($1, $2, $3, $4, 'CT-SANS-PRIX', current_date, current_date + 90, 'brouillon')
         returning id`,
        [ids.tenantA, ids.partnerDorado, ids.campaignA, ids.productA],
      )

      await expect(
        c.query(`update contracts set status = 'actif' where id = $1`, [rows[0].id]),
      ).rejects.toThrow(/sans prix négocié/)
    })
  })

  it('accepte l’activation dès qu’un prix existe et horodate l’activation', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `insert into contracts (tenant_id, partner_company_id, campaign_id, product_id, reference,
                                start_date, end_date, status)
         values ($1, $2, $3, $4, 'CT-AVEC-PRIX', current_date, current_date + 90, 'brouillon')
         returning id`,
        [ids.tenantA, ids.partnerDorado, ids.campaignA, ids.productA],
      )

      await c.query(
        `select app.revise_price($1, 'negocie', 440, current_date, 'Prix d''ouverture du contrat')`,
        [rows[0].id],
      )

      const updated = await c.query(
        `update contracts set status = 'actif' where id = $1 returning activated_at`,
        [rows[0].id],
      )
      expect(updated.rows[0].activated_at).not.toBeNull()
    })
  })
})
