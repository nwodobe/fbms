/**
 * Jeu de données des tests de sécurité.
 *
 * Deux entreprises clientes distinctes (A et B) plus deux entreprises dont
 * l'abonnement est en lecture seule et suspendu : l'isolation ne se teste pas
 * avec un seul tenant, et le verrou d'abonnement ne se teste pas sans un tenant
 * réellement suspendu.
 *
 * Toutes les données sont fictives.
 */
import { asOwner, type Actor } from './helpers'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const ids = {
  tenantA: uuid(1),
  tenantB: uuid(2),
  tenantReadOnly: uuid(3),
  tenantSuspended: uuid(4),

  superAdmin: uuid(10),
  ownerA: uuid(11),
  managerA: uuid(12),
  accountantA: uuid(13),
  auditorA: uuid(14),
  agentUserA1: uuid(15),
  agentUserA2: uuid(16),
  ownerB: uuid(17),
  ownerReadOnly: uuid(18),
  ownerSuspended: uuid(19),
  fieldSupervisorA: uuid(20),

  planStandard: uuid(30),

  partnerOlam: uuid(40),
  partnerDorado: uuid(41),
  partnerB: uuid(42),

  campaignA: uuid(50),
  campaignB: uuid(51),
  productA: uuid(52),
  productB: uuid(53),
  siteA: uuid(54),
  zoneA: uuid(55),

  contractOlam: uuid(60),
  contractDorado: uuid(61),
  contractB: uuid(62),
  priceOlam: uuid(63),

  agentA1: uuid(70),
  agentA2: uuid(71),

  fundingOlam: uuid(80),
  fundingDorado: uuid(81),
  advanceA1: uuid(82),

  purchaseA1: uuid(90),
  purchaseA2: uuid(91),

  lotA1: uuid(100),
  planA1: uuid(101),
  transferA1: uuid(102),

  expenseA1: uuid(110),
  categoryTransport: uuid(111),
  categoryProduct: uuid(112),
  tcbA1: uuid(113),
  scoreA1: uuid(114),

  subscriptionA: uuid(120),
  subscriptionB: uuid(121),
  subscriptionReadOnly: uuid(122),
  subscriptionSuspended: uuid(123),
  invoiceA: uuid(124),
  paymentA: uuid(125),
}

export const actors = {
  superAdmin: { userId: ids.superAdmin, tenantId: null, role: 'super_admin' } satisfies Actor,
  ownerA: { userId: ids.ownerA, tenantId: ids.tenantA, role: 'proprietaire' } satisfies Actor,
  managerA: { userId: ids.managerA, tenantId: ids.tenantA, role: 'gestionnaire' } satisfies Actor,
  accountantA: { userId: ids.accountantA, tenantId: ids.tenantA, role: 'comptable' } satisfies Actor,
  auditorA: { userId: ids.auditorA, tenantId: ids.tenantA, role: 'auditeur' } satisfies Actor,
  agentA1: { userId: ids.agentUserA1, tenantId: ids.tenantA, role: 'pisteur' } satisfies Actor,
  agentA2: { userId: ids.agentUserA2, tenantId: ids.tenantA, role: 'pisteur' } satisfies Actor,
  ownerB: { userId: ids.ownerB, tenantId: ids.tenantB, role: 'proprietaire' } satisfies Actor,
  ownerReadOnly: { userId: ids.ownerReadOnly, tenantId: ids.tenantReadOnly, role: 'proprietaire' } satisfies Actor,
  ownerSuspended: { userId: ids.ownerSuspended, tenantId: ids.tenantSuspended, role: 'proprietaire' } satisfies Actor,
}

export async function seedFixtures(): Promise<void> {
  await asOwner(async (c) => {
    await c.query('begin')

    // Ordre inverse des dépendances : on repart d'une base propre à chaque exécution.
    await c.query(`
      truncate table
        audit_log, sync_sessions, sync_operations, notifications, alerts, alert_rules,
        external_events, agent_score_adjustments, agent_score_components, agent_scores,
        tcb_snapshot_components, tcb_snapshots, expense_allocations, expense_duplicate_flags,
        expenses, expense_categories, incident_evidences, incidents, transfer_lots, transfers,
        delivery_plans, bag_movements, bag_stocks, stock_reassignments, stock_reservations,
        stock_movements, stock_lots, purchase_duplicate_flags, purchases, advance_repayments,
        advance_allocations, advances, field_agent_partners, field_agent_localities, field_agents,
        fundings, negotiated_prices, contracts, campaigns, partner_companies, weighbridges,
        vehicles, transporters, suppliers, sites, localities, zones, products,
        subscription_credits, subscription_events, subscription_payments, invoices, subscriptions,
        user_devices, users, tenant_settings, tenant_branding, platform_support_sessions,
        tenants, platform_admins
      restart identity cascade
    `)

    // ---- Plateforme -------------------------------------------------------
    await c.query(
      `insert into platform_admins (user_id, full_name, email) values ($1, 'Super Admin Démo', 'admin@demo.test')`,
      [ids.superAdmin],
    )

    const plan = await c.query(`select id from subscription_plans where code = 'standard'`)
    const planId = plan.rows[0].id

    // ---- Tenants ----------------------------------------------------------
    const tenants: Array<[string, string, string]> = [
      [ids.tenantA, 'lba-demo-bouake', 'LBA Démonstration Bouaké'],
      [ids.tenantB, 'lba-demo-korhogo', 'LBA Démonstration Korhogo'],
      [ids.tenantReadOnly, 'lba-lecture-seule', 'LBA Lecture Seule'],
      [ids.tenantSuspended, 'lba-suspendu', 'LBA Suspendu'],
    ]
    for (const [id, slug, name] of tenants) {
      await c.query(
        `insert into tenants (id, slug, commercial_name, legal_name) values ($1, $2, $3, $3)`,
        [id, slug, name],
      )
      await c.query(`insert into tenant_branding (tenant_id) values ($1)`, [id])
      await c.query(`insert into tenant_settings (tenant_id) values ($1)`, [id])
    }

    // ---- Abonnements ------------------------------------------------------
    const subs: Array<[string, string, string]> = [
      [ids.subscriptionA, ids.tenantA, 'active'],
      [ids.subscriptionB, ids.tenantB, 'active'],
      [ids.subscriptionReadOnly, ids.tenantReadOnly, 'suspended_read_only'],
      [ids.subscriptionSuspended, ids.tenantSuspended, 'suspended'],
    ]
    for (const [id, tenant, status] of subs) {
      await c.query(
        `insert into subscriptions
           (id, tenant_id, plan_id, status, period_start, period_end, amount, suspension_reason)
         values ($1, $2, $3, $4, current_date - 20, current_date + 10, 50000, $5)`,
        [id, tenant, planId, status, status.startsWith('suspended') ? 'Impayé constaté' : null],
      )
    }

    await c.query(
      `insert into invoices (id, tenant_id, subscription_id, number, amount, due_date, period_start, period_end)
       values ($1, $2, $3, 'F-2026-0001', 50000, current_date + 10, current_date - 20, current_date + 10)`,
      [ids.invoiceA, ids.tenantA, ids.subscriptionA],
    )
    await c.query(
      `insert into subscription_payments
         (id, tenant_id, subscription_id, invoice_id, amount, method, reference, payer, status)
       values ($1, $2, $3, $4, 50000, 'wave', 'WV-DEMO-0001', 'LBA Démonstration', 'declared')`,
      [ids.paymentA, ids.tenantA, ids.subscriptionA, ids.invoiceA],
    )

    // ---- Utilisateurs -----------------------------------------------------
    const users: Array<[string, string | null, string, string]> = [
      [ids.superAdmin, null, 'super_admin', 'Super Admin Démo'],
      [ids.ownerA, ids.tenantA, 'proprietaire', 'Propriétaire A'],
      [ids.managerA, ids.tenantA, 'gestionnaire', 'Gestionnaire A'],
      [ids.accountantA, ids.tenantA, 'comptable', 'Comptable A'],
      [ids.auditorA, ids.tenantA, 'auditeur', 'Auditeur A'],
      [ids.fieldSupervisorA, ids.tenantA, 'responsable_terrain', 'Responsable terrain A'],
      [ids.agentUserA1, ids.tenantA, 'pisteur', 'Pisteur A1'],
      [ids.agentUserA2, ids.tenantA, 'pisteur', 'Pisteur A2'],
      [ids.ownerB, ids.tenantB, 'proprietaire', 'Propriétaire B'],
      [ids.ownerReadOnly, ids.tenantReadOnly, 'proprietaire', 'Propriétaire lecture seule'],
      [ids.ownerSuspended, ids.tenantSuspended, 'proprietaire', 'Propriétaire suspendu'],
    ]
    for (const [id, tenant, role, name] of users) {
      await c.query(
        `insert into users (id, tenant_id, role, full_name, email) values ($1, $2, $3, $4, $5)`,
        [id, tenant, role, name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@demo.test`],
      )
    }

    // ---- Référentiel tenant A --------------------------------------------
    await c.query(`insert into products (id, tenant_id, code, name) values ($1, $2, 'RCN', 'Noix brutes de cajou')`,
      [ids.productA, ids.tenantA])
    await c.query(`insert into products (id, tenant_id, code, name) values ($1, $2, 'RCN', 'Noix brutes de cajou')`,
      [ids.productB, ids.tenantB])
    await c.query(`insert into zones (id, tenant_id, code, name) values ($1, $2, 'Z-BKE', 'Bouaké')`,
      [ids.zoneA, ids.tenantA])
    await c.query(
      `insert into sites (id, tenant_id, code, name, type) values ($1, $2, 'MAG-BKE', 'Magasin Bouaké', 'warehouse')`,
      [ids.siteA, ids.tenantA])

    await c.query(
      `insert into partner_companies (id, tenant_id, code, name) values
         ($1, $3, 'OLAM', 'OLAM (fictif)'), ($2, $3, 'DORADO', 'DORADO (fictif)')`,
      [ids.partnerOlam, ids.partnerDorado, ids.tenantA])
    await c.query(
      `insert into partner_companies (id, tenant_id, code, name) values ($1, $2, 'PART-B', 'Partenaire B (fictif)')`,
      [ids.partnerB, ids.tenantB])

    await c.query(
      `insert into campaigns (id, tenant_id, code, name, start_date, end_date) values
         ($1, $2, 'C2026', 'Campagne 2026', current_date - 60, current_date + 120)`,
      [ids.campaignA, ids.tenantA])
    await c.query(
      `insert into campaigns (id, tenant_id, code, name, start_date, end_date) values
         ($1, $2, 'C2026', 'Campagne 2026', current_date - 60, current_date + 120)`,
      [ids.campaignB, ids.tenantB])

    await c.query(
      `insert into contracts
         (id, tenant_id, partner_company_id, campaign_id, product_id, reference,
          target_volume_kg, start_date, end_date, weight_tolerance_pct, status)
       values
         ($1, $3, $4, $6, $7, 'CT-OLAM-01', 500000, current_date - 60, current_date + 120, 0.5, 'actif'),
         ($2, $3, $5, $6, $7, 'CT-DORADO-01', 300000, current_date - 60, current_date + 120, 0.5, 'actif')`,
      [ids.contractOlam, ids.contractDorado, ids.tenantA, ids.partnerOlam, ids.partnerDorado,
       ids.campaignA, ids.productA])
    await c.query(
      `insert into contracts
         (id, tenant_id, partner_company_id, campaign_id, product_id, reference,
          start_date, end_date, status)
       values ($1, $2, $3, $4, $5, 'CT-B-01', current_date - 60, current_date + 120, 'actif')`,
      [ids.contractB, ids.tenantB, ids.partnerB, ids.campaignB, ids.productB])

    await c.query(
      `insert into negotiated_prices (id, tenant_id, contract_id, price_type, price, valid_from)
       values ($1, $2, $3, 'negocie', 450, current_date - 60)`,
      [ids.priceOlam, ids.tenantA, ids.contractOlam])

    // ---- Pisteurs ---------------------------------------------------------
    await c.query(
      `insert into field_agents (id, tenant_id, user_id, code, full_name, zone_id, ceiling_amount, status)
       values ($1, $3, $4, 'PIS-001', 'Pisteur A1', $6, 5000000, 'actif'),
              ($2, $3, $5, 'PIS-002', 'Pisteur A2', $6, 3000000, 'actif')`,
      [ids.agentA1, ids.agentA2, ids.tenantA, ids.agentUserA1, ids.agentUserA2, ids.zoneA])

    // Autorisations par société : sans elles, le contrôle de capacité oppose un
    // blocage « société non autorisée » à toute avance.
    await c.query(
      `insert into field_agent_partners (tenant_id, field_agent_id, partner_company_id, ceiling_amount)
       -- Le plafond OLAM du pisteur A1 vaut exactement son avance en cours :
       -- la fixture est ainsi à la limite, ce qui rend les tests de dépassement
       -- significatifs sans être bloquée dès l'amorçage.
       values ($1, $2, $4, 5000000), ($1, $2, $5, 3000000),
              ($1, $3, $4, 2000000), ($1, $3, $5, 2000000)`,
      [ids.tenantA, ids.agentA1, ids.agentA2, ids.partnerOlam, ids.partnerDorado],
    )

    // ---- Financements et avances -----------------------------------------
    await c.query(
      `insert into fundings
         (id, tenant_id, partner_company_id, contract_id, campaign_id, amount, received_at,
          payment_method, reference_price, reference)
       values
         ($1, $3, $4, $6, $8, 20000000, current_date - 30, 'bank_transfer', 450, 'FIN-OLAM-01'),
         ($2, $3, $5, $7, $8, 15000000, current_date - 25, 'bank_transfer', 440, 'FIN-DORADO-01')`,
      [ids.fundingOlam, ids.fundingDorado, ids.tenantA, ids.partnerOlam, ids.partnerDorado,
       ids.contractOlam, ids.contractDorado, ids.campaignA])

    await c.query(
      `insert into advances
         (id, tenant_id, field_agent_id, partner_company_id, funding_id, contract_id, campaign_id,
          amount, payment_method, status, created_by, approved_by)
       values ($1, $2, $3, $4, $5, $6, $7, 5000000, 'wave', 'decaisse', $8, $9)`,
      [ids.advanceA1, ids.tenantA, ids.agentA1, ids.partnerOlam, ids.fundingOlam,
       ids.contractOlam, ids.campaignA, ids.managerA, ids.ownerA])

    // ---- Achats -----------------------------------------------------------
    await c.query(
      `insert into purchases
         (id, tenant_id, field_agent_id, partner_company_id, campaign_id, contract_id, advance_id,
          purchased_at, net_weight_kg, price_per_kg, amount, payment_method, status, sync_status)
       values
         ($1, $3, $4, $6, $7, $8, $9,   now() - interval '2 days', 8200, 430, 3526000, 'cash', 'valide', 'synced'),
         ($2, $3, $5, $6, $7, $8, null, now() - interval '1 day',  4000, 430, 1720000, 'cash', 'valide', 'synced')`,
      [ids.purchaseA1, ids.purchaseA2, ids.tenantA, ids.agentA1, ids.agentA2,
       ids.partnerOlam, ids.campaignA, ids.contractOlam, ids.advanceA1])

    // ---- Stock, planning, transfert --------------------------------------
    await c.query(
      `insert into stock_lots
         (id, tenant_id, code, campaign_id, partner_company_id, contract_id, field_agent_id,
          product_id, site_id, holder_type, quantity_kg, status)
       values ($1, $2, 'LOT-0001', $3, $4, $5, $6, $7, $8, 'warehouse', 12000, 'disponible')`,
      [ids.lotA1, ids.tenantA, ids.campaignA, ids.partnerOlam, ids.contractOlam,
       ids.agentA1, ids.productA, ids.siteA])

    await c.query(
      `insert into delivery_plans
         (id, tenant_id, reference, partner_company_id, contract_id, campaign_id,
          planned_date, planned_volume_kg, origin_site_id, field_agent_id, status)
       values ($1, $2, 'PL-0001', $3, $4, $5, current_date + 2, 8000, $6, $7, 'planifie')`,
      [ids.planA1, ids.tenantA, ids.partnerOlam, ids.contractOlam, ids.campaignA, ids.siteA, ids.agentA1])

    await c.query(
      `insert into transfers
         (id, tenant_id, transfer_number, partner_company_id, contract_id, campaign_id,
          delivery_plan_id, origin_site_id, dispatched_at, net_loaded_kg, bag_count_loaded,
          weight_source, status)
       values ($1, $2, 'TR-0001', $3, $4, $5, $6, $7, now() - interval '1 day', 8000, 100,
               'verified', 'en_transit')`,
      [ids.transferA1, ids.tenantA, ids.partnerOlam, ids.contractOlam, ids.campaignA,
       ids.planA1, ids.siteA])

    // ---- Dépenses ---------------------------------------------------------
    await c.query(
      `insert into expense_categories (id, tenant_id, code, label, family, is_direct, is_system_reserved)
       values ($1, $3, 'transport', 'Transport', 'Transport', true, false),
              ($2, $3, 'achat_produit', 'Achat produit', 'Achat matière', true, true)`,
      [ids.categoryTransport, ids.categoryProduct, ids.tenantA])

    await c.query(
      `insert into expenses
         (id, tenant_id, category_id, partner_company_id, campaign_id, field_agent_id,
          expense_date, amount, beneficiary, payment_method, status)
       values ($1, $2, $3, $4, $5, $6, current_date - 1, 250000, 'Transporteur fictif', 'cash', 'validee')`,
      [ids.expenseA1, ids.tenantA, ids.categoryTransport, ids.partnerOlam, ids.campaignA, ids.agentA1])

    // ---- TCB et score -----------------------------------------------------
    await c.query(
      `insert into tcb_snapshots
         (id, tenant_id, scope_type, scope_id, campaign_id, accepted_weight_kg,
          purchase_value, direct_expenses, tcb_total, tcb_per_accepted_kg)
       values ($1, $2, 'partner', $3, $4, 8000, 3526000, 250000, 3776000, 472)`,
      [ids.tcbA1, ids.tenantA, ids.partnerOlam, ids.campaignA])

    await c.query(
      `insert into agent_scores
         (id, tenant_id, field_agent_id, campaign_id, raw_score, adjusted_score, category, maturity)
       values ($1, $2, $3, $4, 78, 80, 'fiable', 'confirme')`,
      [ids.scoreA1, ids.tenantA, ids.agentA1, ids.campaignA])

    await c.query('commit')
  })
}
