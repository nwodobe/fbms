import { expect, test } from '@playwright/test'
import { BRANDING_FIXTURE, signIn, stubSupabase } from './support/session'

const TENANT = '00000000-0000-4000-8000-000000000001'

const PARTNERS = [
  {
    id: 'p-olam',
    tenant_id: TENANT,
    code: 'OLAM',
    name: 'OLAM (démo)',
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    status: 'active',
    weight_tolerance_pct: 0.5,
    acceptance_tolerance_pct: null,
    external_access_enabled: false,
    created_at: '2026-01-01',
  },
]

const CATEGORIES = [
  {
    id: 'cat-achat',
    tenant_id: TENANT,
    code: 'achat_produit',
    label: 'Achat produit',
    family: 'Achat matière',
    is_direct: true,
    default_allocation_key: 'poids_accepte',
    requires_receipt_above: null,
    cap_amount: null,
    // Réservée au système : elle ne doit jamais apparaître en saisie.
    is_system_reserved: true,
    is_controllable_by_agent: false,
    is_active: true,
  },
  {
    id: 'cat-transport',
    tenant_id: TENANT,
    code: 'transport',
    label: 'Transport',
    family: 'Transport',
    is_direct: true,
    default_allocation_key: 'poids_accepte',
    requires_receipt_above: 50000,
    cap_amount: null,
    is_system_reserved: false,
    is_controllable_by_agent: false,
    is_active: true,
  },
  {
    id: 'cat-gardiennage',
    tenant_id: TENANT,
    code: 'gardiennage',
    label: 'Gardiennage',
    family: 'Frais généraux imputables',
    is_direct: false,
    default_allocation_key: 'poids_accepte',
    requires_receipt_above: null,
    cap_amount: null,
    is_system_reserved: false,
    is_controllable_by_agent: false,
    is_active: true,
  },
]

const EXPENSES = [
  {
    id: 'exp-1',
    tenant_id: TENANT,
    category_id: 'cat-transport',
    partner_company_id: 'p-olam',
    campaign_id: 'c-2026',
    contract_id: null,
    field_agent_id: null,
    transfer_id: null,
    stock_lot_id: null,
    expense_date: '2026-03-02',
    amount: 250000,
    beneficiary: 'Transporteur Diallo (démo)',
    beneficiary_user_id: null,
    payment_method: 'cash',
    reference: 'FA-101',
    proof_path: null,
    nature: 'direct',
    allocation_key: null,
    status: 'validee',
    submitted_by: null,
    submitted_at: null,
    validated_by: null,
    validated_at: '2026-03-03',
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    cancelled_at: null,
    cancellation_reason: null,
    is_system_generated: false,
    created_by: null,
    sync_status: 'synced',
  },
  {
    id: 'exp-2',
    tenant_id: TENANT,
    category_id: 'cat-transport',
    partner_company_id: 'p-olam',
    campaign_id: 'c-2026',
    contract_id: null,
    field_agent_id: null,
    transfer_id: null,
    stock_lot_id: null,
    expense_date: '2026-03-04',
    amount: 400000,
    beneficiary: 'Garage Kouassi (démo)',
    beneficiary_user_id: null,
    payment_method: 'cash',
    reference: null,
    proof_path: null,
    nature: 'direct',
    allocation_key: null,
    status: 'rejetee',
    submitted_by: null,
    submitted_at: null,
    validated_by: null,
    validated_at: null,
    rejected_by: null,
    rejected_at: '2026-03-05',
    rejection_reason: 'Facture non conforme au marché',
    cancelled_at: null,
    cancellation_reason: null,
    is_system_generated: false,
    created_by: null,
    sync_status: 'synced',
  },
  {
    id: 'exp-3',
    tenant_id: TENANT,
    category_id: 'cat-gardiennage',
    partner_company_id: null,
    campaign_id: 'c-2026',
    contract_id: null,
    field_agent_id: null,
    transfer_id: null,
    stock_lot_id: null,
    expense_date: '2026-03-06',
    amount: 600000,
    beneficiary: 'Gardiennage magasin (démo)',
    beneficiary_user_id: null,
    payment_method: 'cash',
    reference: null,
    proof_path: null,
    nature: 'indirect',
    allocation_key: 'poids_accepte',
    status: 'validee',
    submitted_by: null,
    submitted_at: null,
    validated_by: null,
    validated_at: '2026-03-07',
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    cancelled_at: null,
    cancellation_reason: null,
    is_system_generated: false,
    created_by: null,
    sync_status: 'synced',
  },
]

const DUPLICATE_FLAGS = [
  {
    id: 'flag-1',
    tenant_id: TENANT,
    expense_id: 'exp-1',
    candidate_id: 'exp-2',
    similarity_score: 85,
    matched_criteria: ['categorie', 'beneficiaire', 'montant'],
    status: 'a_verifier',
    reviewed_by: null,
    reviewed_at: null,
  },
]

const SNAPSHOTS = [
  {
    id: 'tcb-1',
    tenant_id: TENANT,
    scope_type: 'partner',
    scope_id: 'p-olam',
    campaign_id: 'c-2026',
    is_forecast: false,
    computed_at: '2026-03-10T09:00:00.000Z',
    accepted_weight_kg: 8000,
    loaded_weight_kg: 8200,
    unloaded_weight_kg: 8100,
    paid_weight_kg: 8000,
    purchase_value: 3526000,
    direct_expenses: 250000,
    indirect_allocated: 100000,
    valued_losses: 54000,
    tcb_total: 3930000,
    tcb_per_accepted_kg: 491.25,
    net_sale_price: 500,
    net_revenue: 3850000,
    margin_total: -80000,
    margin_per_kg: 8.75,
    margin_reconciliation_gap: -150000,
    is_deficit: true,
    inputs: { purchase_count: 2 },
  },
  {
    id: 'tcb-2',
    tenant_id: TENANT,
    scope_type: 'partner',
    scope_id: 'p-olam',
    campaign_id: 'c-2026',
    is_forecast: false,
    computed_at: '2026-03-01T09:00:00.000Z',
    // Aucun kilo accepté : le coût au kilo doit rester absent, jamais zéro.
    accepted_weight_kg: null,
    loaded_weight_kg: null,
    unloaded_weight_kg: null,
    paid_weight_kg: null,
    purchase_value: 900000,
    direct_expenses: 0,
    indirect_allocated: 0,
    valued_losses: 0,
    tcb_total: 900000,
    tcb_per_accepted_kg: null,
    net_sale_price: null,
    net_revenue: null,
    margin_total: null,
    margin_per_kg: null,
    margin_reconciliation_gap: null,
    is_deficit: null,
    inputs: { note: 'Aucun kilo accepté : le TCB par kilo reste non calculable.' },
  },
]

const COMPONENTS = [
  {
    id: 'comp-1',
    tenant_id: TENANT,
    snapshot_id: 'tcb-1',
    component: 'valeur_achat',
    amount: 3526000,
    amount_per_kg: 440.75,
    source_count: 2,
  },
  {
    id: 'comp-2',
    tenant_id: TENANT,
    snapshot_id: 'tcb-1',
    component: 'depenses:Transport',
    amount: 250000,
    amount_per_kg: 31.25,
    source_count: 1,
  },
  {
    id: 'comp-3',
    tenant_id: TENANT,
    snapshot_id: 'tcb-1',
    component: 'charges_indirectes',
    amount: 100000,
    amount_per_kg: 12.5,
    source_count: 1,
  },
  {
    id: 'comp-4',
    tenant_id: TENANT,
    snapshot_id: 'tcb-1',
    component: 'pertes_valorisees',
    amount: 54000,
    amount_per_kg: 6.75,
    source_count: 1,
  },
]

const AGENTS = [
  {
    id: 'a-1',
    tenant_id: TENANT,
    code: 'PIS-001',
    full_name: 'KONE Ibrahim (démo)',
    phone: null,
    zone_id: null,
    ceiling_amount: 5000000,
    status: 'actif',
    commission_mode: 'par_kg',
    commission_value: 5,
    user_id: null,
    activation_date: '2026-01-05',
  },
  {
    id: 'a-2',
    tenant_id: TENANT,
    code: 'PIS-002',
    full_name: 'TRAORE Awa (démo)',
    phone: null,
    zone_id: null,
    ceiling_amount: 3000000,
    status: 'actif',
    commission_mode: 'par_kg',
    commission_value: 5,
    user_id: null,
    activation_date: '2026-02-20',
  },
]

const SCORES = [
  {
    id: 'score-1',
    tenant_id: TENANT,
    field_agent_id: 'a-1',
    campaign_id: 'c-2026',
    period_start: '2026-01-01',
    period_end: '2026-03-10',
    computed_at: '2026-03-10T09:00:00.000Z',
    raw_score: 74,
    event_adjusted_score: 80,
    adjusted_score: 80,
    category: 'fiable',
    maturity: 'confirme',
    recommended_ceiling: 5000000,
    excluded_events: [{ id: 'ev-1', type: 'panne_pont_bascule' }],
  },
  {
    id: 'score-2',
    tenant_id: TENANT,
    field_agent_id: 'a-2',
    campaign_id: 'c-2026',
    period_start: '2026-02-20',
    period_end: '2026-03-10',
    computed_at: '2026-03-10T09:00:00.000Z',
    raw_score: 38,
    event_adjusted_score: 38,
    adjusted_score: 38,
    // Historique trop court : aucune catégorie ne doit être prononcée.
    category: 'non_evalue',
    maturity: 'non_evalue',
    recommended_ceiling: null,
    excluded_events: [],
  },
]

const SCORE_COMPONENTS = [
  {
    id: 'sc-1',
    tenant_id: TENANT,
    score_id: 'score-1',
    component: 'couverture_avances',
    weight: 20,
    value: 70,
    weighted_value: 15.56,
    source_data: { avances: 12, couvert: 8400000 },
    explanation: '12 observation(s) sur la période.',
  },
  {
    id: 'sc-2',
    tenant_id: TENANT,
    score_id: 'score-1',
    component: 'respect_delais',
    weight: 15,
    value: 60,
    weighted_value: 10,
    source_data: { plannings: 9, honores: 6 },
    explanation: '9 observation(s) sur la période.',
  },
]

const ALERT_RULES = [
  {
    id: 'rule-1',
    tenant_id: TENANT,
    alert_type: 'avance_non_couverte',
    severity: 'critique',
    threshold: { days: 15, amount: 0 },
    is_active: true,
  },
  {
    id: 'rule-2',
    tenant_id: TENANT,
    alert_type: 'livraison_prevue_demain',
    severity: 'info',
    threshold: { days: 1 },
    is_active: true,
  },
]

const ALERTS = [
  {
    id: 'alert-1',
    tenant_id: TENANT,
    alert_type: 'avance_non_couverte',
    severity: 'critique',
    title: 'avance_non_couverte',
    message: 'Avance AV-001 (KONE Ibrahim) : reliquat non couvert depuis 20 jour(s).',
    campaign_id: null,
    partner_company_id: null,
    field_agent_id: 'a-1',
    related_table: 'advances',
    related_id: 'adv-1',
    measured_value: 20,
    threshold_value: 15,
    status: 'ouverte',
    raised_at: '2026-03-10T09:00:00.000Z',
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_at: null,
    resolution_note: null,
    dedupe_key: 'avance_non_couverte:adv-1',
  },
  {
    id: 'alert-2',
    tenant_id: TENANT,
    alert_type: 'livraison_prevue_demain',
    severity: 'info',
    title: 'livraison_prevue_demain',
    message: 'Livraison PL-0004 prévue demain.',
    campaign_id: null,
    partner_company_id: null,
    field_agent_id: null,
    related_table: 'delivery_plans',
    related_id: 'plan-4',
    measured_value: 1,
    threshold_value: 1,
    status: 'ouverte',
    raised_at: '2026-03-10T08:00:00.000Z',
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_at: null,
    resolution_note: null,
    dedupe_key: 'livraison_prevue_demain:plan-4',
  },
]

const FIXTURES = {
  tenant_branding: [BRANDING_FIXTURE],
  partner_companies: PARTNERS,
  campaigns: [
    { id: 'c-2026', code: '2026', name: 'Campagne 2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'ouverte' },
  ],
  field_agents: AGENTS,
  expense_categories: CATEGORIES,
  expenses: EXPENSES,
  expense_duplicate_flags: DUPLICATE_FLAGS,
  expense_allocations: [
    {
      id: 'alloc-1',
      tenant_id: TENANT,
      expense_id: 'exp-3',
      target_type: 'partner',
      target_id: 'p-olam',
      allocation_key: 'poids_accepte',
      base_value: 8000,
      total_base_value: 10000,
      share_ratio: 0.8,
      allocated_amount: 480000,
      is_manual: false,
      approved_by: null,
      reason: null,
      computed_at: '2026-03-08T09:00:00.000Z',
    },
  ],
  tcb_snapshots: SNAPSHOTS,
  tcb_snapshot_components: COMPONENTS,
  agent_scores: SCORES,
  agent_score_components: SCORE_COMPONENTS,
  alert_rules: ALERT_RULES,
  alerts: ALERTS,
}

// ---------------------------------------------------------------------------
// E2E-09 · dépenses
// ---------------------------------------------------------------------------

test.describe('E2E-09 · dépenses', () => {
  test('la catégorie réservée au système n’est pas proposée en saisie', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/depenses')

    await page.getByRole('button', { name: 'Nouvelle dépense' }).click()

    const category = page.getByLabel('Catégorie')
    await expect(category).toBeVisible()
    // « Achat produit » existe au référentiel mais ne doit jamais être saisi :
    // la valeur d'achat vient des achats, la ressaisir la doublerait au TCB.
    await expect(category.locator('option', { hasText: 'Achat produit' })).toHaveCount(0)
    await expect(category.locator('option', { hasText: 'Transport' })).toHaveCount(1)
  })

  test('l’écran distingue ce qui entre au TCB de ce qui n’y entre pas', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/depenses')

    const rows = page.getByRole('row')
    await expect(rows.filter({ hasText: 'Transporteur Diallo' })).toContainText('compté')
    await expect(rows.filter({ hasText: 'Garage Kouassi' })).toContainText('non compté')
    // La charge indirecte n'entre au TCB que par sa quote-part.
    await expect(rows.filter({ hasText: 'Gardiennage magasin' })).toContainText('par quote-part')
  })

  test('un doublon probable est signalé sans être bloqué', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/depenses')

    await expect(page.getByText('Doublons probables à vérifier')).toBeVisible()
    await expect(page.getByText('85/100')).toBeVisible()
    await expect(page.getByRole('button', { name: 'C’est un doublon' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dépenses distinctes' })).toBeVisible()
  })

  test('la clé manuelle n’est pas proposée à la répartition automatique', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/depenses')

    await page
      .getByRole('row', { name: /Gardiennage magasin/ })
      .getByRole('button', { name: 'Répartir' })
      .click()

    const key = page.getByLabel('Clé de répartition')
    await expect(key.locator('option', { hasText: 'Poids accepté' })).toHaveCount(1)
    await expect(key.locator('option', { hasText: 'Répartition manuelle' })).toHaveCount(0)
  })

  test('un refus de répartition explique pourquoi, au lieu d’imputer zéro', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)

    await page.route('**/rest/v1/rpc/allocate_indirect_expense', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          message:
            'La clé « poids_accepte » vaut zéro sur ce périmètre : la charge ne peut pas être imputée sans disparaître du TCB.',
        }),
      }),
    )

    await page.goto('/depenses')
    await page
      .getByRole('row', { name: /Gardiennage magasin/ })
      .getByRole('button', { name: 'Répartir' })
      .click()
    await page.getByRole('button', { name: 'Répartir', exact: true }).last().click()

    await expect(page.getByRole('alert')).toContainText('vaut zéro sur ce périmètre')
  })
})

// ---------------------------------------------------------------------------
// E2E-10 · TCB et marges
// ---------------------------------------------------------------------------

test.describe('E2E-10 · TCB et marges', () => {
  test('le TCB par kilo reste vide quand aucun kilo n’est accepté', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/tcb')

    const rows = page.getByRole('row')
    // La ligne sans poids accepté affiche « — », jamais « 0 FCFA/kg ».
    const emptyRow = rows.filter({ hasText: '900 000 FCFA' })
    await expect(emptyRow).toContainText('—')
    await expect(emptyRow).not.toContainText('0 FCFA/kg')
  })

  test('la décomposition reconstitue le total affiché', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/tcb')

    await page
      .getByRole('row', { name: /491,25 FCFA\/kg/ })
      .getByRole('button', { name: 'Décomposer' })
      .click()

    await expect(page.getByText('Décomposition du TCB')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Valeur d’achat' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Dépenses · Transport' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Charges indirectes imputées' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Pertes valorisées' })).toBeVisible()

    // 3 526 000 + 250 000 + 100 000 + 54 000 = 3 930 000.
    await expect(page.getByRole('row', { name: /^Total/ })).toContainText('3 930 000 FCFA')
  })

  test('les deux marges sont affichées avec leur écart de réconciliation', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/tcb')

    await page
      .getByRole('row', { name: /491,25 FCFA\/kg/ })
      .getByRole('button', { name: 'Décomposer' })
      .click()

    await expect(page.getByRole('term').filter({ hasText: 'Marge totale' })).toBeVisible()
    await expect(page.getByRole('term').filter({ hasText: 'Marge par kg' })).toBeVisible()
    await expect(page.getByRole('term').filter({ hasText: 'Écart de réconciliation' })).toBeVisible()
    await expect(page.getByText('-150 000 FCFA')).toBeVisible()
    await expect(page.getByText(/ne porte pas exactement sur le poids accepté/)).toBeVisible()
  })

  test('le prix de vente net se recalcule pendant la saisie', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/tcb')

    await page
      .getByRole('row', { name: /491,25 FCFA\/kg/ })
      .getByRole('button', { name: 'Décomposer' })
      .click()

    await page.getByLabel('Prix négocié (FCFA/kg)').fill('500')
    await page.getByLabel('Primes (FCFA/kg)').fill('25')
    await page.getByLabel('Pénalités (FCFA/kg)').fill('12')
    await page.getByLabel('Retenues (FCFA/kg)').fill('8')

    // 500 + 25 − 12 − 8 = 505.
    await expect(page.getByText('Prix de vente net calculé :')).toContainText('505 FCFA/kg')
  })
})

// ---------------------------------------------------------------------------
// E2E-11 · scoring et alertes
// ---------------------------------------------------------------------------

test.describe('E2E-11 · scoring', () => {
  test('aucune catégorie n’est prononcée sans maturité suffisante', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/scoring')

    const row = page.getByRole('row', { name: /TRAORE Awa/ })
    await expect(row).toContainText('Non évalué')
    // 38/100 ne doit pas être qualifié de « critique » sur trois semaines.
    await expect(row).not.toContainText('Critique')
    // Aucun plafond n'est proposé tant que l'historique ne le porte pas.
    await expect(row).toContainText('—')
  })

  test('le plafond est présenté comme une proposition, jamais appliqué', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/scoring')

    await expect(page.getByRole('row', { name: /KONE Ibrahim/ })).toContainText('(proposé)')
    await expect(page.getByText('Un score ne sanctionne personne')).toBeVisible()
  })

  test('score brut, score ajusté et score affiché restent distincts', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/scoring')

    const row = page.getByRole('row', { name: /KONE Ibrahim/ })
    await expect(row).toContainText('74/100')
    await expect(row).toContainText('80/100')
  })

  test('les composantes non mesurées sont affichées comme telles, pas notées zéro', async ({
    page,
  }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/scoring')

    await page
      .getByRole('row', { name: /KONE Ibrahim/ })
      .getByRole('button', { name: 'Détailler' })
      .click()

    await expect(page.getByText('Composantes non mesurées sur la période')).toBeVisible()
    await expect(page.getByText(/Gestion des sacs — poids nominal 5/)).toBeVisible()
    await expect(page.getByText(/Non notée zéro/)).toHaveCount(7)
  })

  test('un ajustement sans motif suffisant n’est pas soumettable', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/scoring')

    await page
      .getByRole('row', { name: /KONE Ibrahim/ })
      .getByRole('button', { name: 'Détailler' })
      .click()

    await page.getByLabel('Correction (points)').fill('5')
    // Neuf caractères : un motif trop court laisse un score affiché invérifiable.
    await page.getByLabel('Motif').fill('trop bref')

    await expect(page.getByRole('button', { name: 'Enregistrer l’ajustement' })).toBeDisabled()

    await page.getByLabel('Motif').fill('Retards imputables au retard de financement du siège')
    await expect(page.getByRole('button', { name: 'Enregistrer l’ajustement' })).toBeEnabled()
  })
})

test.describe('E2E-11 · alertes', () => {
  test('chaque alerte affiche sa mesure et son seuil', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/alertes')

    const row = page.getByRole('row', { name: /reliquat non couvert/ })
    await expect(row).toContainText('20')
    await expect(row).toContainText('15')
    await expect(row).toContainText('Avance non couverte')
  })

  test('le critique est présenté avant l’information', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/alertes')

    const messages = page.getByRole('row').filter({ hasText: /Avance non couverte|Livraison prévue/ })
    await expect(messages.first()).toContainText('critique')
    await expect(messages.last()).toContainText('info')
  })

  test('le filtre par gravité restreint la liste', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/alertes')

    await page.getByLabel('Filtrer par gravité').selectOption('critique')

    await expect(page.getByText('reliquat non couvert')).toBeVisible()
    await expect(page.getByText('Livraison PL-0004 prévue demain.')).toHaveCount(0)
  })

  test('les seuils sont modifiables par l’entreprise', async ({ page }) => {
    await signIn(page)
    await stubSupabase(page, FIXTURES)
    await page.goto('/alertes')

    const field = page.getByLabel('Avance non couverte — Âge du reliquat (jours)')
    await expect(field).toHaveValue('15')
    await field.fill('30')
    await expect(field).toHaveValue('30')
    await expect(page.getByRole('button', { name: 'Enregistrer' }).first()).toBeEnabled()
  })

  test('un pisteur ne voit ni le TCB ni le paramétrage des seuils', async ({ page }) => {
    await signIn(page, { role: 'pisteur', userId: '00000000-0000-4000-8000-000000000015' })
    await stubSupabase(page, FIXTURES)
    await page.goto('/alertes')

    await expect(page.getByText('Centre d’alertes')).toBeVisible()
    await expect(page.getByText('Seuils', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'TCB et marges' })).toHaveCount(0)
  })
})
