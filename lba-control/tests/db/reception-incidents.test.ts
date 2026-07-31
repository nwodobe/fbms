/**
 * Phase 4 · réception, écarts et incidents, appliqués en base.
 *
 * Ce que ces tests protègent : qu'un écart soit constaté avec sa mesure et sa
 * tolérance d'origine, qu'il bloque la clôture, et qu'il n'accuse personne.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { expectRejected, pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

// ---------------------------------------------------------------------------
// Tolérance en cascade
// ---------------------------------------------------------------------------

describe('résolution de la tolérance', () => {
  it('privilégie le contrat et conserve l’origine du seuil', async () => {
    const { rows } = await withUser(actors.managerA, (c) =>
      c.query(`select app.resolve_weight_tolerance($1) as t`, [ids.transferA1]),
    )
    expect(Number(rows[0].t.value)).toBe(0.5)
    expect(rows[0].t.source).toBe('contrat')
  })

  it('retombe sur la société quand le contrat ne fixe rien', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update contracts set weight_tolerance_pct = null where id = $1`, [ids.contractOlam])
      await c.query(`update partner_companies set weight_tolerance_pct = 0.9 where id = $1`, [
        ids.partnerOlam,
      ])

      const { rows } = await c.query(`select app.resolve_weight_tolerance($1) as t`, [ids.transferA1])
      expect(Number(rows[0].t.value)).toBe(0.9)
      expect(rows[0].t.source).toBe('societe')
    })
  })

  it('retombe sur l’entreprise en dernier recours', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update contracts set weight_tolerance_pct = null where id = $1`, [ids.contractOlam])
      await c.query(`update partner_companies set weight_tolerance_pct = null where id = $1`, [
        ids.partnerOlam,
      ])

      const { rows } = await c.query(`select app.resolve_weight_tolerance($1) as t`, [ids.transferA1])
      expect(rows[0].t.source).toBe('entreprise')
    })
  })
})

// ---------------------------------------------------------------------------
// Réception et calcul des écarts
// ---------------------------------------------------------------------------

describe('enregistrement d’une réception', () => {
  it('calcule les cinq écarts et conserve les quatre poids', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select app.record_transfer_reception($1, 7940, 7900, 7850) as r`,
        [ids.transferA1],
      )
      const result = rows[0].r

      expect(Number(result.ecart_physique_kg)).toBe(60)
      expect(Number(result.ecart_physique_pct)).toBeCloseTo(0.75, 4)
      expect(Number(result.ecart_acceptation_kg)).toBe(40)
      expect(Number(result.ecart_paiement_kg)).toBe(50)
      expect(Number(result.ecart_total_acceptation_kg)).toBe(100)
      expect(Number(result.ecart_financier_total_kg)).toBe(150)

      const { rows: transfer } = await c.query(
        `select net_loaded_kg, net_unloaded_kg, accepted_kg, paid_kg, status
           from transfers where id = $1`,
        [ids.transferA1],
      )
      // Les quatre poids restent quatre valeurs distinctes après réception.
      expect(Number(transfer[0].net_loaded_kg)).toBe(8000)
      expect(Number(transfer[0].net_unloaded_kg)).toBe(7940)
      expect(Number(transfer[0].accepted_kg)).toBe(7900)
      expect(Number(transfer[0].paid_kg)).toBe(7850)
      expect(transfer[0].status).toBe('receptionne')
    })
  })

  it('exige le poids déchargé et le poids accepté', async () => {
    const message = await expectRejected(
      actors.managerA,
      `select app.record_transfer_reception($1, null, null)`,
      [ids.transferA1],
    )
    expect(message).toMatch(/obligatoires à la réception/)
  })

  it('refuse la saisie de poids par le comptable', async () => {
    const message = await expectRejected(
      actors.accountantA,
      `select app.record_transfer_reception($1, 7940, 7900)`,
      [ids.transferA1],
    )
    expect(message).toMatch(/ne permet pas de saisir des poids/)
  })

  it('refuse une réception sur le transfert d’un autre tenant', async () => {
    const message = await expectRejected(
      actors.ownerB,
      `select app.record_transfer_reception($1, 7940, 7900)`,
      [ids.transferA1],
    )
    expect(message).toMatch(/hors du périmètre|introuvable/i)
  })
})

// ---------------------------------------------------------------------------
// Incident automatique
// ---------------------------------------------------------------------------

describe('incident au-delà de la tolérance', () => {
  it('ouvre un incident avec la mesure ET la source du seuil', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select app.record_transfer_reception($1, 7940, 7900, 7850) as r`,
        [ids.transferA1],
      )
      expect(rows[0].r.exceeds_tolerance).toBe(true)
      expect(rows[0].r.incident_id).not.toBeNull()

      const { rows: incident } = await c.query(
        `select type, severity, description, suspected_responsible_type, blocks_closure, status
           from incidents where id = $1`,
        [rows[0].r.incident_id],
      )

      expect(incident[0].type).toBe('ecart_poids')
      expect(incident[0].description).toMatch(/0\.75 %/)
      expect(incident[0].description).toMatch(/tolérance de 0\.5 %/)
      expect(incident[0].description).toMatch(/source : contrat/)
      expect(incident[0].blocks_closure).toBe(true)
      expect(incident[0].status).toBe('ouvert')
    })
  })

  it('N’IMPUTE la responsabilité à personne', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select app.record_transfer_reception($1, 7940, 7900) as r`,
        [ids.transferA1],
      )
      const { rows: incident } = await c.query(
        `select suspected_responsible_type, suspected_responsible_id, description
           from incidents where id = $1`,
        [rows[0].r.incident_id],
      )

      // Le responsable présumé reste « inconnu » et aucun pisteur n'est désigné.
      expect(incident[0].suspected_responsible_type).toBe('inconnu')
      expect(incident[0].suspected_responsible_id).toBeNull()
      // La description énumère des causes techniques à examiner d'abord.
      expect(incident[0].description).toMatch(/humidité/i)
      expect(incident[0].description).toMatch(/étalonnage/i)
      expect(incident[0].description.toLowerCase()).not.toContain('vol')
    })
  })

  it('n’ouvre aucun incident sous la tolérance', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `select app.record_transfer_reception($1, 7990, 7990) as r`,
        [ids.transferA1],
      )
      expect(rows[0].r.exceeds_tolerance).toBe(false)
      expect(rows[0].r.incident_id).toBeNull()
    })
  })

  it('n’ouvre pas d’incident formel sur un poids de départ estimé', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set weight_source = 'estimated_bags' where id = $1`, [
        ids.transferA1,
      ])
      const { rows } = await c.query(
        `select app.record_transfer_reception($1, 7940, 7900) as r`,
        [ids.transferA1],
      )
      // L'écart est signalé, mais accuser sur la foi d'un poids que personne
      // n'a pesé serait indéfendable.
      expect(rows[0].r.exceeds_tolerance).toBe(true)
      expect(rows[0].r.incident_id).toBeNull()
    })
  })

  it('l’incident bloque la clôture du transfert', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`select app.record_transfer_reception($1, 7940, 7900, 7850)`, [ids.transferA1])
      await expect(
        c.query(`update transfers set status = 'cloture' where id = $1`, [ids.transferA1]),
      ).rejects.toThrow(/incident non résolu/)
    })
  })
})

// ---------------------------------------------------------------------------
// Couverture des avances par la réception acceptée
// ---------------------------------------------------------------------------

describe('la réception acceptée couvre les avances (arbitrage D1)', () => {
  it('alloue la valeur acceptée en FIFO et renvoie le reliquat', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set applied_price_value = 450 where id = $1`, [ids.transferA1])
      await c.query(`select app.record_transfer_reception($1, 7940, 7900, 7850)`, [ids.transferA1])

      const { rows } = await c.query(`select app.cover_advances_from_reception($1) as reste`, [
        ids.transferA1,
      ])

      // 7 900 kg × 450 = 3 555 000, imputés sur l'avance de 5 000 000.
      const { rows: allocations } = await c.query(
        `select coalesce(sum(amount), 0) as total from advance_allocations where advance_id = $1`,
        [ids.advanceA1],
      )
      expect(Number(allocations[0].total)).toBe(3_555_000)
      expect(Number(rows[0].reste)).toBe(0)
    })
  })

  it('valorise au prix appliqué au transfert, pas au prix du jour', async () => {
    await withUser(actors.managerA, async (c) => {
      await c.query(`update transfers set applied_price_value = 430 where id = $1`, [ids.transferA1])
      await c.query(`select app.record_transfer_reception($1, 7940, 7900)`, [ids.transferA1])
      await c.query(`select app.cover_advances_from_reception($1)`, [ids.transferA1])

      const { rows } = await c.query(
        `select coalesce(sum(amount), 0) as total from advance_allocations where advance_id = $1`,
        [ids.advanceA1],
      )
      // 7 900 × 430 = 3 397 000 — le prix historisé, pas un prix révisé depuis.
      expect(Number(rows[0].total)).toBe(3_397_000)
    })
  })

  it('ne couvre rien sans poids accepté', async () => {
    const { rows } = await withUser(actors.managerA, (c) =>
      c.query(`select app.cover_advances_from_reception($1) as reste`, [ids.transferA1]),
    )
    expect(Number(rows[0].reste)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Chargement et stock
// ---------------------------------------------------------------------------

describe('chargement du camion', () => {
  it('refuse le départ sans poids chargé', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `insert into transfers (tenant_id, transfer_number, partner_company_id, contract_id,
                                campaign_id, origin_site_id, status)
         values ($1, 'TR-9001', $2, $3, $4, $5, 'brouillon') returning id`,
        [ids.tenantA, ids.partnerOlam, ids.contractOlam, ids.campaignA, ids.siteA],
      )

      await expect(
        c.query(`update transfers set status = 'en_transit' where id = $1`, [rows[0].id]),
      ).rejects.toThrow(/poids net chargé doit être renseigné/)
    })
  })

  it('exige le ticket de pesée pour un poids déclaré « vérifié »', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `insert into transfers (tenant_id, transfer_number, partner_company_id, contract_id,
                                campaign_id, origin_site_id, net_loaded_kg, weight_source, status)
         values ($1, 'TR-9002', $2, $3, $4, $5, 8000, 'verified', 'charge') returning id`,
        [ids.tenantA, ids.partnerOlam, ids.contractOlam, ids.campaignA, ids.siteA],
      )

      await expect(
        c.query(`update transfers set status = 'en_transit' where id = $1`, [rows[0].id]),
      ).rejects.toThrow(/ticket de pesée/)
    })
  })

  it('accepte un départ avec un poids explicitement estimé', async () => {
    await withUser(actors.managerA, async (c) => {
      const { rows } = await c.query(
        `insert into transfers (tenant_id, transfer_number, partner_company_id, contract_id,
                                campaign_id, origin_site_id, net_loaded_kg, weight_source, status)
         values ($1, 'TR-9003', $2, $3, $4, $5, 8000, 'estimated_bags', 'charge') returning id`,
        [ids.tenantA, ids.partnerOlam, ids.contractOlam, ids.campaignA, ids.siteA],
      )
      const updated = await c.query(
        `update transfers set status = 'en_transit' where id = $1 returning status`,
        [rows[0].id],
      )
      expect(updated.rows[0].status).toBe('en_transit')
    })
  })

  it('refuse de charger un lot affecté à une autre société', async () => {
    await withUser(actors.managerA, async (c) => {
      // Un lot DORADO chargé sur un transfert destiné à OLAM : c'est
      // exactement le mélange de financements que le produit doit empêcher.
      const { rows } = await c.query(
        `insert into stock_lots (tenant_id, code, campaign_id, partner_company_id, product_id,
                                 site_id, holder_type, quantity_kg, status)
         values ($1, 'LOT-DORADO', $2, $3, $4, $5, 'warehouse', 5000, 'disponible')
         returning id`,
        [ids.tenantA, ids.campaignA, ids.partnerDorado, ids.productA, ids.siteA],
      )

      await expect(
        c.query(
          `insert into transfer_lots (tenant_id, transfer_id, stock_lot_id, quantity_kg)
           values ($1, $2, $3, 1000)`,
          [ids.tenantA, ids.transferA1, rows[0].id],
        ),
      ).rejects.toThrow(/autre société.*réaffectation approuvée/)
    })
  })

  it('refuse de charger plus que la quantité du lot', async () => {
    const message = await expectRejected(
      actors.managerA,
      `insert into transfer_lots (tenant_id, transfer_id, stock_lot_id, quantity_kg)
       values ($1, $2, $3, 99999)`,
      [ids.tenantA, ids.transferA1, ids.lotA1],
    )
    expect(message).toMatch(/dépasse la quantité du lot/)
  })
})
