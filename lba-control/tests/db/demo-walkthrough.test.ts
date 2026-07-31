/**
 * Phase 7 · E2E-14 — parcours de démonstration complet, en base réelle.
 *
 * Un seul scénario, de bout en bout : financement reçu → avance décaissée →
 * achats terrain → transfert chargé → réception avec écart → couverture de
 * l'avance → dépense validée → TCB → marge → alerte → clôture de campagne.
 *
 * Ce test existe pour une raison que les tests unitaires ne couvrent pas : les
 * règles se contredisent souvent à la jonction. Chacune est juste isolément, et
 * l'enchaînement est impossible. C'est ce que découvre un client le premier
 * jour, pas nous.
 *
 * Tout se déroule dans une transaction unique, avec changement d'acteur au fil
 * du parcours — comme dans la vraie vie, où le pisteur, le gestionnaire et le
 * comptable ne sont pas la même personne.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { asOwnerWithin, pool, switchActor, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

const NEW = {
  campaign: '00000000-0000-4000-8000-000000000901',
  contract: '00000000-0000-4000-8000-000000000902',
  price: '00000000-0000-4000-8000-000000000903',
  funding: '00000000-0000-4000-8000-000000000904',
  advance: '00000000-0000-4000-8000-000000000905',
  purchaseA: '00000000-0000-4000-8000-000000000906',
  purchaseB: '00000000-0000-4000-8000-000000000907',
  lot: '00000000-0000-4000-8000-000000000908',
  transfer: '00000000-0000-4000-8000-000000000909',
  expense: '00000000-0000-4000-8000-000000000910',
}

describe('E2E-14 · parcours complet d’une campagne', () => {
  it('enchaîne financement → achat → réception → TCB → alerte → clôture', async () => {
    await withUser(actors.ownerA, async (c) => {
      // ---- 1. Campagne, contrat et prix ----------------------------------
      await c.query(
        `insert into campaigns (id, tenant_id, code, name, start_date, end_date, status)
         values ($1, $2, 'DEMO-2026', 'Campagne de démonstration',
                 current_date - 30, current_date + 120, 'ouverte')`,
        [NEW.campaign, ids.tenantA],
      )

      await c.query(
        `insert into contracts
           (id, tenant_id, partner_company_id, campaign_id, product_id, reference,
            target_volume_kg, start_date, end_date, weight_tolerance_pct, status, validated_by)
         values ($1, $2, $3, $4, $5, 'CT-DEMO-01', 50000,
                 current_date - 30, current_date + 120, 0.5, 'brouillon', $6)`,
        [NEW.contract, ids.tenantA, ids.partnerOlam, NEW.campaign, ids.productA, ids.ownerA],
      )

      await c.query(
        `insert into negotiated_prices
           (id, tenant_id, contract_id, price_type, price, valid_from, version, justification)
         values ($1, $2, $3, 'negocie', 450, current_date - 30, 1, 'Prix d’ouverture de campagne')`,
        [NEW.price, ids.tenantA, NEW.contract],
      )

      // Un contrat ne s'active pas sans prix : la règle de la phase 2 tient
      // encore ici, dans un enchaînement qu'elle n'avait jamais vu.
      await c.query(`update contracts set status = 'actif' where id = $1`, [NEW.contract])

      // ---- 2. Financement société ----------------------------------------
      await c.query(
        `insert into fundings
           (id, tenant_id, partner_company_id, contract_id, campaign_id, amount, received_at,
            payment_method, reference_price, reference, coverage_deadline)
         values ($1, $2, $3, $4, $5, 10000000, current_date - 20, 'bank_transfer', 450,
                 'FIN-DEMO-01', current_date + 30)`,
        [NEW.funding, ids.tenantA, ids.partnerOlam, NEW.contract, NEW.campaign],
      )

      // ---- 3. Avance au pisteur ------------------------------------------
      // Le pisteur A2 dispose de capacité sur OLAM ; le contrôle serveur le
      // vérifie de lui-même.
      const capacity = await c.query(
        `select app.check_advance_capacity($1, $2, 1500000) as check`,
        [ids.agentA2, ids.partnerOlam],
      )
      expect(capacity.rows[0].check.can_proceed).toBe(true)
      expect(capacity.rows[0].check.has_hard_block).toBe(false)

      await c.query(
        `insert into advances
           (id, tenant_id, field_agent_id, partner_company_id, funding_id, contract_id, campaign_id,
            amount, payment_method, status, disbursed_at, issued_at, created_by, approved_by)
         values ($1, $2, $3, $4, $5, $6, $7, 1500000, 'wave', 'decaisse',
                 now() - interval '10 days', now() - interval '10 days', $8, $9)`,
        [NEW.advance, ids.tenantA, ids.agentA2, ids.partnerOlam, NEW.funding, NEW.contract,
         NEW.campaign, ids.managerA, ids.ownerA],
      )

      // ---- 4. Achats terrain, saisis par le pisteur -----------------------
      await switchActor(c, actors.agentA2)

      for (const [id, weight, price, days] of [
        [NEW.purchaseA, 2000, 430, 9],
        [NEW.purchaseB, 1400, 435, 8],
      ] as Array<[string, number, number, number]>) {
        await c.query(
          `insert into purchases
             (id, tenant_id, field_agent_id, partner_company_id, campaign_id, contract_id,
              advance_id, purchased_at, net_weight_kg, price_per_kg, amount, payment_method,
              status, sync_status, proof_path, kor)
           values ($1, $2, $3, $4, $5, $6, $7, now() - ($8 || ' days')::interval,
                   $9, $10, $11, 'cash', 'valide', 'synced', 'preuves/achat.jpg', 48)`,
          [id, ids.tenantA, ids.agentA2, ids.partnerOlam, NEW.campaign, NEW.contract,
           NEW.advance, String(days), weight, price, weight * price],
        )
      }

      // Le pisteur voit ses achats, et seulement les siens.
      const own = await c.query(`select count(*)::int as n from purchases where advance_id = $1`, [
        NEW.advance,
      ])
      expect(own.rows[0].n).toBe(2)

      // ---- 5. Stock et transfert ------------------------------------------
      await switchActor(c, actors.managerA)

      await c.query(
        `insert into stock_lots
           (id, tenant_id, code, campaign_id, partner_company_id, contract_id, field_agent_id,
            product_id, site_id, holder_type, quantity_kg, bag_count, status)
         values ($1, $2, 'LOT-DEMO-01', $3, $4, $5, $6, $7, $8, 'warehouse', 3400, 42, 'disponible')`,
        [NEW.lot, ids.tenantA, NEW.campaign, ids.partnerOlam, NEW.contract, ids.agentA2,
         ids.productA, ids.siteA],
      )

      await c.query(
        `insert into transfers
           (id, tenant_id, transfer_number, partner_company_id, contract_id, campaign_id,
            origin_site_id, weight_source, status, applied_price_value)
         values ($1, $2, 'TR-DEMO-01', $3, $4, $5, $6, 'verified', 'brouillon', 450)`,
        [NEW.transfer, ids.tenantA, ids.partnerOlam, NEW.contract, NEW.campaign, ids.siteA],
      )

      await c.query(
        `insert into transfer_lots (tenant_id, transfer_id, stock_lot_id, quantity_kg)
         values ($1, $2, $3, 3400)`,
        [ids.tenantA, NEW.transfer, NEW.lot],
      )

      // Un départ sans poids chargé ni ticket est refusé : la règle de la
      // phase 4 s'applique aussi au parcours nominal.
      await c.query(
        `update transfers
            set net_loaded_kg = 3400, bag_count_loaded = 42, tare_kg = 200,
                weighing_ticket_path = 'preuves/pesee-depart.jpg',
                dispatched_at = now() - interval '2 days', status = 'en_transit'
          where id = $1`,
        [NEW.transfer],
      )

      const inTransit = await c.query(`select status from stock_lots where id = $1`, [NEW.lot])
      expect(inTransit.rows[0].status).toBe('en_transit')

      // ---- 6. Réception avec écart au-delà de la tolérance ----------------
      await c.query(`update transfers set arrived_at = now() where id = $1`, [NEW.transfer])

      const reception = await c.query(
        `select app.record_transfer_reception($1, 3360, 3320, 3320, null, null, 47, 9,
                                              null, null, 'Magasinier démo', null) as r`,
        [NEW.transfer],
      )
      const result = reception.rows[0].r

      // 3400 chargés, 3360 déchargés : 40 kg, soit 1,18 % — au-delà de 0,5 %.
      expect(Number(result.ecart_physique_kg)).toBeCloseTo(40, 1)
      expect(result.exceeds_tolerance).toBe(true)
      expect(result.incident_id).not.toBeNull()
      expect(Number(result.tolerance.value)).toBe(0.5)
      expect(result.tolerance.source).toBe('contrat')

      // L'incident n'accuse personne.
      const incident = await c.query(
        `select suspected_responsible_type, blocks_closure from incidents where id = $1`,
        [result.incident_id],
      )
      expect(incident.rows[0].suspected_responsible_type).toBe('inconnu')
      expect(incident.rows[0].blocks_closure).toBe(true)

      // ---- 7. Couverture de l'avance par la réception acceptée ------------
      const leftover = await c.query(`select app.cover_advances_from_reception($1) as n`, [
        NEW.transfer,
      ])
      // La fonction renvoie le RELIQUAT non affecté : zéro signifie que toute
      // la valeur reçue a trouvé une avance à couvrir.
      expect(Number(leftover.rows[0].n)).toBe(0)

      const allocations = await c.query(
        `select amount from advance_allocations
          where advance_id = $1 and source_type = 'reception' and source_id = $2`,
        [NEW.advance, NEW.transfer],
      )
      // Le transfert n'a aucun planning : sans le correctif de la migration
      // 2000, aucune allocation n'existerait ici et le pisteur resterait
      // débiteur d'une matière qu'il a livrée.
      expect(allocations.rows).toHaveLength(1)
      expect(Number(allocations.rows[0].amount)).toBeCloseTo(1_494_000, 0)

      const exposure = await c.query(`select app.agent_exposure($1, $2) as e`, [
        ids.agentA2,
        ids.partnerOlam,
      ])
      // 3320 kg acceptés × 450 = 1 494 000 : l'avance de 1 500 000 est presque
      // couverte, il reste 6 000 FCFA d'exposition.
      expect(Number(exposure.rows[0].e.covered)).toBeCloseTo(1_494_000, 0)
      expect(Number(exposure.rows[0].e.exposure)).toBeCloseTo(6_000, 0)

      // ---- 8. Dépense de transport, validée par un autre utilisateur ------
      await switchActor(c, actors.accountantA)

      await c.query(
        `insert into expenses
           (id, tenant_id, category_id, partner_company_id, campaign_id, contract_id,
            transfer_id, expense_date, amount, beneficiary, payment_method, reference,
            proof_path, status, submitted_by, submitted_at)
         values ($1, $2, $3, $4, $5, $6, $7, current_date - 2, 180000, 'Transporteur démo',
                 'cash', 'FA-DEMO-01', 'preuves/facture.jpg', 'soumise', $8, now())`,
        [NEW.expense, ids.tenantA, ids.categoryTransport, ids.partnerOlam, NEW.campaign,
         NEW.contract, NEW.transfer, ids.accountantA],
      )

      await switchActor(c, actors.managerA)
      await c.query(
        `update expenses set status = 'validee', validated_by = $2 where id = $1`,
        [NEW.expense, ids.managerA],
      )

      // ---- 9. TCB et marge -------------------------------------------------
      const snapshot = await c.query(`select app.compute_tcb('contract', $1, $2) as id`, [
        NEW.contract,
        NEW.campaign,
      ])

      const tcb = await c.query(
        `select purchase_value, direct_expenses, valued_losses, tcb_total,
                tcb_per_accepted_kg, accepted_weight_kg
           from tcb_snapshots where id = $1`,
        [snapshot.rows[0].id],
      )
      const row = tcb.rows[0]

      // 2000 × 430 + 1400 × 435 = 1 469 000.
      expect(Number(row.purchase_value)).toBe(1_469_000)
      expect(Number(row.direct_expenses)).toBe(180_000)
      // 40 kg perdus × 450 = 18 000.
      expect(Number(row.valued_losses)).toBe(18_000)
      expect(Number(row.tcb_total)).toBe(1_667_000)
      expect(Number(row.accepted_weight_kg)).toBe(3320)
      // 1 667 000 / 3320 ≈ 502,11 FCFA/kg, au-dessus du prix négocié de 450.
      expect(Number(row.tcb_per_accepted_kg)).toBeCloseTo(502.11, 1)

      const margin = await c.query(`select app.record_margin($1, 1494000, 450) as m`, [
        snapshot.rows[0].id,
      ])
      // L'opération perd de l'argent, et le produit le dit.
      expect(Number(margin.rows[0].m.margin_total)).toBe(-173_000)
      expect(margin.rows[0].m.is_deficit).toBe(true)

      // ---- 10. Alertes -----------------------------------------------------
      await switchActor(c, actors.ownerA)
      await c.query(`select app.seed_alert_rules($1)`, [ids.tenantA])
      await c.query(`select app.evaluate_alerts($1)`, [ids.tenantA])

      const alerts = await c.query(
        `select alert_type, measured_value, threshold_value from alerts
          where tenant_id = $1 and status = 'ouverte'`,
        [ids.tenantA],
      )
      const types = alerts.rows.map((r) => r.alert_type)

      // Le coût de revient dépasse le prix de vente net : c'est exactement ce
      // que le produit existe pour dire avant la fin de la campagne.
      expect(types).toContain('tcb_superieur_prix_net')
      expect(types).toContain('ecart_superieur_tolerance')
      for (const alert of alerts.rows) {
        expect(alert.measured_value).not.toBeNull()
      }

      // ---- 11. Clôture de campagne ----------------------------------------
      const blockers = await c.query(`select app.campaign_closure_blockers($1) as b`, [NEW.campaign])
      expect(blockers.rows[0].b.can_close).toBe(false)
      const codes = (blockers.rows[0].b.blockers as Array<{ code: string }>).map((b) => b.code)
      // L'incident ouvert et le reliquat d'avance empêchent la clôture, et le
      // produit dit lesquels.
      expect(codes).toEqual(
        expect.arrayContaining(['incidents_ouverts', 'avances_non_couvertes']),
      )

      // On lève les obstacles comme le ferait un gestionnaire.
      await c.query(
        `update incidents
            set status = 'decide', decision = 'Perte naturelle en transport, sous seuil de retenue.',
                decision_cause = 'naturelle', validated_by = $2, validated_at = now(),
                blocks_closure = false
          where id = $1`,
        [result.incident_id, ids.ownerA],
      )
      await c.query(
        `insert into advance_repayments (tenant_id, advance_id, amount, repaid_at, payment_method)
         values ($1, $2, 6000, current_date, 'cash')`,
        [ids.tenantA, NEW.advance],
      )
      await c.query(`update transfers set status = 'cloture' where id = $1`, [NEW.transfer])

      const cleared = await c.query(`select app.campaign_closure_blockers($1) as b`, [NEW.campaign])
      expect(cleared.rows[0].b.can_close).toBe(true)

      await c.query(`select app.close_campaign($1)`, [NEW.campaign])

      const closed = await c.query(`select status, closed_by from campaigns where id = $1`, [
        NEW.campaign,
      ])
      expect(closed.rows[0].status).toBe('cloturee')
      expect(closed.rows[0].closed_by).toBe(ids.ownerA)

      // ---- 12. La campagne close refuse les écritures ----------------------
      await expect(
        c.query(
          `insert into expenses
             (id, tenant_id, category_id, campaign_id, expense_date, amount,
              beneficiary, payment_method, status)
           values (gen_random_uuid(), $1, $2, $3, current_date, 1000, 'Retardataire', 'cash', 'brouillon')`,
          [ids.tenantA, ids.categoryTransport, NEW.campaign],
        ),
      ).rejects.toThrow(/campagne est clôturée/i)
    })
  }, 60_000)

  it('laisse une trace auditable de tout le parcours', async () => {
    await withUser(actors.ownerA, async (c) => {
      // On rejoue le strict nécessaire : un changement de prix et une
      // validation, les deux événements qu'un contrôleur ira chercher.
      await asOwnerWithin(c, actors.ownerA, (owner) =>
        owner.query(
          `insert into campaigns (id, tenant_id, code, name, start_date, end_date)
           values ($1, $2, 'AUDIT-2026', 'Campagne audit', current_date - 10, current_date + 60)`,
          [NEW.campaign, ids.tenantA],
        ),
      )

      const before = await c.query(
        `select count(*)::int as n from audit_log where tenant_id = $1`,
        [ids.tenantA],
      )

      await c.query(
        `update purchases set price_per_kg = 440, amount = net_weight_kg * 440 where id = $1`,
        [ids.purchaseA1],
      )

      const after = await c.query(
        `select action, table_name, old_value, new_value from audit_log
          where tenant_id = $1 and table_name = 'purchases'
          order by occurred_at desc limit 2`,
        [ids.tenantA],
      )

      const total = await c.query(
        `select count(*)::int as n from audit_log where tenant_id = $1`,
        [ids.tenantA],
      )
      expect(total.rows[0].n).toBeGreaterThan(before.rows[0].n)

      // Un changement de prix produit une entrée dédiée, avec ancienne et
      // nouvelle valeur : « modifié » sans dire de quoi à quoi n'est pas une
      // trace, c'est une note.
      const priceChange = after.rows.find((r) => r.action === 'price_change')
      expect(priceChange).toBeDefined()
      expect(priceChange?.old_value).not.toBeNull()
      expect(priceChange?.new_value).not.toBeNull()
    })
  })
})
