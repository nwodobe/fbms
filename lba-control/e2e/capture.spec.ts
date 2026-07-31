/**
 * Captures d'écran de démonstration.
 *
 * Ce fichier n'est PAS un test : il ne vérifie rien. Il fait tourner
 * l'application réelle, dans un vrai navigateur, sur un jeu de données fictif,
 * et enregistre ce que l'on voit. Il sert à montrer l'état d'avancement à
 * quelqu'un qui ne va pas installer le projet.
 *
 * Les données sont inventées et le disent : aucun chiffre ici ne provient d'une
 * campagne réelle.
 */
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { BRANDING_FIXTURE, signIn, stubStorage, stubSupabase } from './support/session'

/**
 * Le service worker est neutralisé pendant les captures.
 *
 * Ce n'est pas un contournement de complaisance : une fois installé, il relaie
 * lui-même les appels réseau, et l'interception de Playwright ne les voit plus.
 * Les écrans visités après son activation se retrouvaient alors sans données —
 * « Chargement… » indéfini et marque par défaut — alors que l'application est
 * parfaitement fonctionnelle. En production le cache n'entre pas en jeu ici :
 * les appels `/rest/v1/` sont déclarés `NetworkOnly`, jamais servis d'un cache.
 */
test.use({ serviceWorkers: 'block' })

const OUT = process.env.CAPTURE_DIR ?? '/tmp/lba-captures'
const TENANT = '00000000-0000-4000-8000-000000000001'
const USER = '00000000-0000-4000-8000-000000000011'

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

// ---------------------------------------------------------------------------
// Jeu de démonstration
// ---------------------------------------------------------------------------

const PARTNERS = [
  { id: 'p-olam', tenant_id: TENANT, code: 'OLAM', name: 'OLAM Côte d’Ivoire (démo)', contact_name: 'KOUAME Yao', phone: '+225 07 00 00 01', email: null, address: 'Abidjan', status: 'active', weight_tolerance_pct: 0.5, acceptance_tolerance_pct: 1, external_access_enabled: false, created_at: '2026-01-01' },
  { id: 'p-dorado', tenant_id: TENANT, code: 'DORADO', name: 'DORADO Trading (démo)', contact_name: 'DIALLO Aminata', phone: '+225 07 00 00 02', email: null, address: 'San-Pédro', status: 'active', weight_tolerance_pct: 0.8, acceptance_tolerance_pct: null, external_access_enabled: false, created_at: '2026-01-01' },
]

const CAMPAIGNS = [
  { id: 'c-2026', tenant_id: TENANT, code: '2026', name: 'Campagne 2026', product_id: 'prod-rcn', start_date: '2026-01-15', end_date: '2026-08-31', status: 'active' },
]

const AGENTS = [
  { id: 'a-1', tenant_id: TENANT, code: 'PIS-001', full_name: 'KONE Ibrahim (démo)', phone: '+225 05 00 00 11', zone_id: null, ceiling_amount: 8_000_000, status: 'actif', commission_mode: 'par_kg', commission_value: 5, user_id: USER, activation_date: '2026-01-20' },
  { id: 'a-2', tenant_id: TENANT, code: 'PIS-002', full_name: 'TRAORE Awa (démo)', phone: '+225 05 00 00 12', zone_id: null, ceiling_amount: 5_000_000, status: 'actif', commission_mode: 'par_kg', commission_value: 5, user_id: null, activation_date: '2026-02-02' },
  { id: 'a-3', tenant_id: TENANT, code: 'PIS-003', full_name: 'BAMBA Seydou (démo)', phone: '+225 05 00 00 13', zone_id: null, ceiling_amount: 4_000_000, status: 'actif', commission_mode: 'forfait', commission_value: 120_000, user_id: null, activation_date: '2026-02-10' },
]

const purchase = (
  id: string,
  agent: string,
  weight: number,
  price: number,
  date: string,
  supplier: string,
  village: string,
) => ({
  id, tenant_id: TENANT, field_agent_id: agent, partner_company_id: 'p-olam', campaign_id: 'c-2026',
  supplier_id: null, supplier_name: supplier, village, purchased_at: date,
  net_weight_kg: weight, price_per_kg: price, amount: weight * price, bag_count: Math.round(weight / 80),
  payment_method: 'cash', proof_path: null, status: 'valide', sync_status: 'synced',
  device_id: 'demo', is_own_account: false,
})

const PURCHASES = [
  purchase('pu-1', 'a-1', 8_200, 430, '2026-03-10T08:12:00.000Z', 'YAO Kouadio', 'Brobo'),
  purchase('pu-2', 'a-1', 6_450, 428, '2026-03-11T09:40:00.000Z', 'KOFFI Adjoua', 'Languibonou'),
  purchase('pu-3', 'a-2', 4_980, 435, '2026-03-12T07:55:00.000Z', 'N’GUESSAN Paul', 'Béoumi'),
  purchase('pu-4', 'a-2', 7_310, 432, '2026-03-13T10:05:00.000Z', 'SILUE Moussa', 'Botro'),
  purchase('pu-5', 'a-3', 5_120, 425, '2026-03-14T11:20:00.000Z', 'OUATTARA Salif', 'Sakassou'),
]

const TRANSFERS = [
  {
    id: 'tr-1', tenant_id: TENANT, transfer_number: 'TR-0001', partner_company_id: 'p-olam',
    contract_id: 'ct-1', campaign_id: 'c-2026', delivery_plan_id: 'plan-1',
    dispatched_at: '2026-03-15T06:30:00.000Z', driver_name: 'DIABATE Karim', tractor_plate: '1234 AB 01',
    net_loaded_kg: 32_000, net_unloaded_kg: 31_840, accepted_kg: 31_500, paid_kg: 31_500,
    weight_source: 'verified', weighing_ticket_path: `${TENANT}/ticket_pesee/2026-03-15/tr-1.jpg`,
    reception_ticket_path: `${TENANT}/ticket_pesee/2026-03-16/tr-1.jpg`,
    ecart_physique_kg: -160, ecart_physique_pct: -0.5, ecart_acceptation_kg: -340,
    ecart_paiement_kg: 0, ecart_total_acceptation_kg: -500, ecart_financier_total_kg: -500,
    tare_variation_kg: 40, status: 'receptionne',
  },
  {
    id: 'tr-2', tenant_id: TENANT, transfer_number: 'TR-0002', partner_company_id: 'p-dorado',
    contract_id: null, campaign_id: 'c-2026', delivery_plan_id: null,
    dispatched_at: '2026-03-18T05:50:00.000Z', driver_name: 'COULIBALY Adama', tractor_plate: '5678 CD 01',
    net_loaded_kg: 24_500, net_unloaded_kg: null, accepted_kg: null, paid_kg: null,
    weight_source: 'estimated_bags', weighing_ticket_path: null, reception_ticket_path: null,
    ecart_physique_kg: null, ecart_physique_pct: null, ecart_acceptation_kg: null,
    ecart_paiement_kg: null, ecart_total_acceptation_kg: null, ecart_financier_total_kg: null,
    tare_variation_kg: null, status: 'en_transit',
  },
]

const STOCK = [
  { id: 'lot-1', tenant_id: TENANT, code: 'LOT-0001', campaign_id: 'c-2026', partner_company_id: 'p-olam', field_agent_id: 'a-1', site_id: 's-1', holder_type: 'magasin', quantity_kg: 42_000, bag_count: 525, kor: 48.2, humidity: 8.4, status: 'en_magasin', is_own_account: false },
  { id: 'lot-2', tenant_id: TENANT, code: 'LOT-0002', campaign_id: 'c-2026', partner_company_id: 'p-dorado', field_agent_id: 'a-2', site_id: 's-1', holder_type: 'magasin', quantity_kg: 24_500, bag_count: 306, kor: 47.1, humidity: 9.1, status: 'en_transit', is_own_account: false },
  { id: 'lot-3', tenant_id: TENANT, code: 'LOT-0003', campaign_id: 'c-2026', partner_company_id: null, field_agent_id: 'a-3', site_id: null, holder_type: 'pisteur', quantity_kg: 5_120, bag_count: 64, kor: 46.8, humidity: 9.6, status: 'en_magasin', is_own_account: true },
]

const RESERVATIONS = [
  { id: 'res-1', tenant_id: TENANT, stock_lot_id: 'lot-1', delivery_plan_id: 'plan-1', partner_company_id: 'p-olam', quantity_kg: 15_000, status: 'active' },
]

const CATEGORIES = [
  { id: 'cat-transport', tenant_id: TENANT, code: 'transport', label: 'Transport', family: 'logistique', is_direct: true, default_allocation_key: 'poids_accepte', requires_receipt_above: 100_000, cap_amount: null, is_system_reserved: false, is_controllable_by_agent: true, is_active: true },
  { id: 'cat-manut', tenant_id: TENANT, code: 'manutention', label: 'Manutention', family: 'logistique', is_direct: true, default_allocation_key: 'poids_accepte', requires_receipt_above: 50_000, cap_amount: null, is_system_reserved: false, is_controllable_by_agent: true, is_active: true },
  { id: 'cat-admin', tenant_id: TENANT, code: 'admin', label: 'Frais administratifs', family: 'structure', is_direct: false, default_allocation_key: 'poids_accepte', requires_receipt_above: 200_000, cap_amount: null, is_system_reserved: false, is_controllable_by_agent: false, is_active: true },
]

const expense = (id: string, cat: string, amount: number, date: string, who: string, status: string, nature: 'direct' | 'indirect', proof: string | null) => ({
  id, tenant_id: TENANT, category_id: cat, partner_company_id: 'p-olam', campaign_id: 'c-2026',
  contract_id: null, field_agent_id: 'a-1', transfer_id: null, stock_lot_id: null,
  expense_date: date, amount, beneficiary: who, beneficiary_user_id: null,
  payment_method: 'cash', reference: `REF-${id.toUpperCase()}`, proof_path: proof,
  nature, allocation_key: nature === 'indirect' ? 'poids_accepte' : null, status,
  submitted_by: USER, submitted_at: `${date}T09:00:00.000Z`, validated_by: null, validated_at: null,
  rejected_by: null, rejected_at: null, rejection_reason: null,
  cancelled_at: null, cancellation_reason: null, is_system_generated: false, created_by: USER,
})

const EXPENSES = [
  expense('ex-1', 'cat-transport', 340_000, '2026-03-15', 'Transport SARL (démo)', 'validee', 'direct', `${TENANT}/justificatif_depense/2026-03-15/ex-1.jpg`),
  expense('ex-2', 'cat-manut', 85_000, '2026-03-16', 'Équipe manutention Bouaké', 'soumise', 'direct', null),
  expense('ex-3', 'cat-admin', 450_000, '2026-03-01', 'Frais de structure mars', 'validee', 'indirect', `${TENANT}/justificatif_depense/2026-03-01/ex-3.jpg`),
]

const TCB = [
  {
    id: 'tcb-1', tenant_id: TENANT, scope_type: 'contrat', scope_id: 'ct-1', campaign_id: 'c-2026',
    is_forecast: false, computed_at: '2026-03-20T12:00:00.000Z',
    accepted_weight_kg: 31_500, loaded_weight_kg: 32_000, unloaded_weight_kg: 31_840, paid_weight_kg: 31_500,
    purchase_value: 13_545_000, direct_expenses: 425_000, indirect_allocated: 210_000, valued_losses: 68_800,
    tcb_total: 14_248_800, tcb_per_accepted_kg: 452.34,
    net_sale_price: 495, net_revenue: 15_592_500, margin_total: 1_343_700, margin_per_kg: 42.66,
    margin_reconciliation_gap: 0, is_deficit: false, inputs: {},
  },
]

const SCORES = [
  { id: 'sc-1', tenant_id: TENANT, field_agent_id: 'a-1', campaign_id: 'c-2026', period_start: '2026-01-15', period_end: '2026-03-20', computed_at: '2026-03-20T12:00:00.000Z', raw_score: 82.4, event_adjusted_score: 84.1, adjusted_score: 84.1, category: 'fiable', maturity: 'confirme', recommended_ceiling: 9_000_000, excluded_events: [] },
  { id: 'sc-2', tenant_id: TENANT, field_agent_id: 'a-2', campaign_id: 'c-2026', period_start: '2026-02-02', period_end: '2026-03-20', computed_at: '2026-03-20T12:00:00.000Z', raw_score: 61.8, event_adjusted_score: 61.8, adjusted_score: 61.8, category: 'a_surveiller', maturity: 'provisoire', recommended_ceiling: 4_500_000, excluded_events: [] },
  { id: 'sc-3', tenant_id: TENANT, field_agent_id: 'a-3', campaign_id: 'c-2026', period_start: '2026-02-10', period_end: '2026-03-20', computed_at: '2026-03-20T12:00:00.000Z', raw_score: null, event_adjusted_score: null, adjusted_score: null, category: 'non_evalue', maturity: 'en_observation', recommended_ceiling: null, excluded_events: [] },
]

const SCORE_COMPONENTS = [
  { id: 'sco-1', tenant_id: TENANT, score_id: 'sc-1', component: 'couverture_avances', weight: 20, value: 92, weighted_value: 18.4, source_data: {}, explanation: '92 % des avances couvertes dans les délais.' },
  { id: 'sco-2', tenant_id: TENANT, score_id: 'sc-1', component: 'ecart_poids', weight: 15, value: 88, weighted_value: 13.2, source_data: {}, explanation: 'Écart moyen de 0,42 % sur 6 transferts.' },
  { id: 'sco-3', tenant_id: TENANT, score_id: 'sc-1', component: 'respect_delais', weight: 15, value: 80, weighted_value: 12, source_data: {}, explanation: '4 plannings honorés sur 5.' },
  { id: 'sco-4', tenant_id: TENANT, score_id: 'sc-1', component: 'qualite_produit', weight: 10, value: 78, weighted_value: 7.8, source_data: {}, explanation: 'KOR moyen 48,2 pour un objectif de 48.' },
]

const ALERTS = [
  { id: 'al-1', tenant_id: TENANT, alert_type: 'avance_non_couverte', severity: 'critique', title: 'Avance non couverte depuis 9 jours', message: 'L’avance ADV-0004 de 2 400 000 FCFA n’est couverte par aucune livraison depuis 9 jours.', campaign_id: 'c-2026', partner_company_id: 'p-olam', field_agent_id: 'a-2', related_table: 'advances', related_id: null, measured_value: 9, threshold_value: 7, status: 'ouverte', raised_at: '2026-03-19T04:30:00.000Z', acknowledged_by: null, acknowledged_at: null, resolved_at: null, resolution_note: null, dedupe_key: null },
  { id: 'al-2', tenant_id: TENANT, alert_type: 'camion_sans_document', severity: 'blocage', title: 'Transfert parti sans ticket de pesée', message: 'TR-0002 est parti depuis 14 h sans ticket de pesée. Le poids ne peut pas être déclaré vérifié.', campaign_id: 'c-2026', partner_company_id: 'p-dorado', field_agent_id: null, related_table: 'transfers', related_id: 'tr-2', measured_value: 14, threshold_value: 12, status: 'ouverte', raised_at: '2026-03-18T19:50:00.000Z', acknowledged_by: null, acknowledged_at: null, resolved_at: null, resolution_note: null, dedupe_key: null },
  { id: 'al-3', tenant_id: TENANT, alert_type: 'livraison_prevue_demain', severity: 'info', title: 'Livraison prévue demain', message: 'Le planning PL-0007 prévoit 18 000 kg pour OLAM demain.', campaign_id: 'c-2026', partner_company_id: 'p-olam', field_agent_id: null, related_table: 'delivery_plans', related_id: null, measured_value: null, threshold_value: null, status: 'ouverte', raised_at: '2026-03-20T04:30:00.000Z', acknowledged_by: null, acknowledged_at: null, resolved_at: null, resolution_note: null, dedupe_key: null },
  { id: 'al-4', tenant_id: TENANT, alert_type: 'ecart_superieur_tolerance', severity: 'surveillance', title: 'Écart proche de la tolérance', message: 'TR-0001 : écart physique de 0,50 % pour une tolérance contractuelle de 0,50 %.', campaign_id: 'c-2026', partner_company_id: 'p-olam', field_agent_id: 'a-1', related_table: 'transfers', related_id: 'tr-1', measured_value: 0.5, threshold_value: 0.5, status: 'ouverte', raised_at: '2026-03-16T15:00:00.000Z', acknowledged_by: null, acknowledged_at: null, resolved_at: null, resolution_note: null, dedupe_key: null },
]

const notification = (id: string, alert: (typeof ALERTS)[number], read: string | null) => ({
  id, tenant_id: TENANT, user_id: USER, channel: 'in_app',
  title: alert.title, body: alert.message, alert_id: alert.id,
  read_at: read, created_at: alert.raised_at,
  alerts: { severity: alert.severity, status: alert.status },
})

const NOTIFICATIONS = [
  notification('no-1', ALERTS[0]!, null),
  notification('no-2', ALERTS[1]!, null),
  notification('no-3', ALERTS[2]!, '2026-03-20T08:00:00.000Z'),
  notification('no-4', ALERTS[3]!, '2026-03-17T08:00:00.000Z'),
]

const BAG_STOCKS = [
  { id: 'bs-1', tenant_id: TENANT, campaign_id: 'c-2026', partner_company_id: 'p-olam', holder_type: 'pisteur', field_agent_id: 'a-1', site_id: null, quantity: 640, updated_at: '2026-03-18T10:00:00.000Z' },
  { id: 'bs-2', tenant_id: TENANT, campaign_id: 'c-2026', partner_company_id: 'p-olam', holder_type: 'magasin', field_agent_id: null, site_id: 's-1', quantity: 2_150, updated_at: '2026-03-18T10:00:00.000Z' },
]

const SUBSCRIPTION = [
  { id: 'sub-1', tenant_id: TENANT, plan_id: 'plan-standard', status: 'active', period_start: '2026-03-01', period_end: '2026-09-01', grace_days: 5, block_after_days: 30, grace_started_at: null, read_only_at: null, blocked_at: null, suspension_reason: null, amount: 50_000, currency: 'XOF', auto_renew: true, created_at: '2026-01-01T00:00:00.000Z' },
]

const FIXTURES = {
  tenant_branding: [BRANDING_FIXTURE],
  partner_companies: PARTNERS,
  campaigns: CAMPAIGNS,
  field_agents: AGENTS,
  purchases: PURCHASES,
  purchase_duplicate_flags: [],
  transfers: TRANSFERS,
  stock_lots: STOCK,
  stock_reservations: RESERVATIONS,
  delivery_plans: [],
  incidents: [],
  expense_categories: CATEGORIES,
  expenses: EXPENSES,
  expense_duplicate_flags: [],
  expense_allocations: [],
  tcb_snapshots: TCB,
  tcb_snapshot_components: [],
  agent_scores: SCORES,
  agent_score_components: SCORE_COMPONENTS,
  alerts: ALERTS,
  alert_rules: [],
  notifications: NOTIFICATIONS,
  bag_stocks: BAG_STOCKS,
  bag_movements: [],
  subscriptions: SUBSCRIPTION,
  invoices: [],
  subscription_payments: [],
  subscription_events: [],
  advances: [
    { id: 'adv-1', tenant_id: TENANT, campaign_id: 'c-2026', partner_company_id: 'p-olam', field_agent_id: 'a-1', funding_id: 'fu-1', amount: 6_000_000, status: 'partiellement_couvert', issued_at: '2026-03-05T08:00:00.000Z', due_date: '2026-03-19', payment_method: 'mobile_money', reference: 'ADV-0003', purpose: 'Achats Brobo', proof_path: null },
    { id: 'adv-2', tenant_id: TENANT, campaign_id: 'c-2026', partner_company_id: 'p-olam', field_agent_id: 'a-2', funding_id: 'fu-1', amount: 2_400_000, status: 'decaisse', issued_at: '2026-03-10T08:00:00.000Z', due_date: '2026-03-24', payment_method: 'cash', reference: 'ADV-0004', purpose: 'Achats Béoumi', proof_path: null },
  ],
  advance_allocations: [{ id: 'aa-1', amount: 3_500_000 }],
  advance_repayments: [{ id: 'ar-1', amount: 500_000 }],
  fundings: [
    { id: 'fu-1', tenant_id: TENANT, partner_company_id: 'p-olam', campaign_id: 'c-2026', contract_id: 'ct-1', amount: 25_000_000, received_at: '2026-03-01', reference: 'FIN-0001', payment_method: 'virement', status: 'recu', proof_path: null },
  ],
  contracts: [
    { id: 'ct-1', tenant_id: TENANT, partner_company_id: 'p-olam', campaign_id: 'c-2026', reference: 'CT-OLAM-2026', signed_at: '2026-01-20', start_date: '2026-01-20', end_date: '2026-08-31', volume_committed_kg: 500_000, status: 'actif', weight_tolerance_pct: 0.5, acceptance_tolerance_pct: 1, kor_reference: 48, humidity_max: 10 },
  ],
  negotiated_prices: [
    { id: 'np-1', tenant_id: TENANT, contract_id: 'ct-1', partner_company_id: 'p-olam', campaign_id: 'c-2026', price_per_kg: 495, kor_reference: 48, valid_from: '2026-03-01', valid_to: null, version: 2, is_provisional: false, status: 'actif', justification: 'Révision mensuelle KOR 48', created_at: '2026-03-01' },
  ],
  products: [{ id: 'prod-rcn', tenant_id: TENANT, code: 'RCN', label: 'Noix de cajou brute', is_active: true }],
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

async function shoot(page: Page, name: string): Promise<void> {
  // Chaque navigation recharge la page et relance toutes les requêtes. Capturer
  // avant leur retour donnerait des écrans « Chargement… » et la marque par
  // défaut au lieu de celle du client — ce qui montrerait un produit qui ne
  // ressemble pas à ce qu'il est.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await expect(page.getByText('Chargement…')).toHaveCount(0, { timeout: 4_000 }).catch(() => undefined)
  // Les graphiques Recharts s'animent à l'affichage.
  await page.waitForTimeout(1_200)
  await page.screenshot({
    path: `${OUT}/${name}.jpg`,
    type: 'jpeg',
    quality: 70,
    fullPage: true,
  })
}

const SCREENS: Array<{ path: string; name: string; wait?: string }> = [
  { path: '/', name: '01-tableau-de-bord', wait: 'Tableau de bord' },
  { path: '/notifications', name: '02-notifications', wait: 'Notifications' },
  { path: '/alertes', name: '03-alertes' },
  { path: '/achats', name: '04-achats', wait: 'Achats terrain' },
  { path: '/transferts', name: '05-transferts', wait: 'Transferts et pesées' },
  { path: '/stocks', name: '06-stocks' },
  { path: '/depenses', name: '07-depenses' },
  { path: '/tcb', name: '08-tcb-marges' },
  { path: '/scoring', name: '09-scoring' },
  { path: '/avances', name: '10-avances' },
  { path: '/societes', name: '11-societes' },
  { path: '/contrats', name: '12-contrats-prix' },
  { path: '/sacs', name: '13-sacherie' },
  { path: '/abonnement', name: '14-abonnement' },
  { path: '/marque', name: '15-marque' },
  // Montré aussi : deux écrans du MVP restent annoncés et non livrés.
  { path: '/utilisateurs', name: '17-utilisateurs-a-venir' },
]

test.describe('captures', () => {
  // Découpé en lots : quinze écrans dans un seul test dépassent le délai
  // maximal, et un dépassement fait perdre TOUTES les captures du lot.
  for (const [index, batch] of [SCREENS.slice(0, 5), SCREENS.slice(5, 10), SCREENS.slice(10)].entries()) {
    test(`écrans de bureau ${index + 1}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'bureau', 'Captures bureau.')
      test.setTimeout(180_000)

      await signIn(page)
      await stubSupabase(page, FIXTURES)
      await stubStorage(page)

      for (const screen of batch) {
        await page.goto(screen.path)
        if (screen.wait) {
          await expect(page.getByRole('heading', { name: screen.wait }).first()).toBeVisible()
        }
        await shoot(page, screen.name)
      }
    })
  }

  test('réception d’un transfert', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'bureau', 'Captures bureau.')

    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await stubStorage(page)

    await page.goto('/transferts')
    await page.getByRole('row', { name: /TR-0002/ }).getByRole('button', { name: 'Réceptionner' }).click()
    await page.getByLabel('Poids déchargé (kg)').fill('24380')
    await page.getByLabel('Poids accepté (kg)').fill('24100')
    await shoot(page, '16-reception-ecarts')
  })

  test('connexion', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'bureau', 'Captures bureau.')

    await stubSupabase(page, FIXTURES)
    await page.goto('/connexion')
    await shoot(page, '00-connexion')
  })

  // Densité ramenée à 1 : un Pixel 5 rend à 2,75×, ce qui triple le poids des
  // images pour une lisibilité identique à l'écran.
  test.describe(() => {
    test.use({ deviceScaleFactor: 1 })
    test('écrans mobile du pisteur', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-android', 'Captures mobile.')
    test.setTimeout(120_000)

    await signIn(page, { role: 'pisteur' })
    await stubSupabase(page, FIXTURES)
    await stubStorage(page)

    await page.goto('/achats')
    await expect(page.getByRole('heading', { name: 'Achats terrain' })).toBeVisible()
    await shoot(page, '20-mobile-achats')

    await page.getByRole('button', { name: 'Nouvel achat' }).click()
    await shoot(page, '21-mobile-saisie-achat')
    await page.keyboard.press('Escape')

    await page.goto('/notifications')
    await shoot(page, '22-mobile-notifications')

      await page.goto('/')
      await shoot(page, '23-mobile-tableau-de-bord')
    })
  })
})
