#!/usr/bin/env node
/**
 * Jeu de démonstration.
 *
 * Volumes conformes à la commande §25 : 1 tenant, 2 sociétés partenaires
 * (OLAM et DORADO), 1 campagne, 2 contrats, 4 pisteurs, 3 financements,
 * 8 avances, 25 achats, plusieurs stocks, 4 plannings, 4 transferts avec les
 * quatre poids, 20 dépenses, incidents, scores et abonnement actif.
 *
 * Les caractéristiques qualitatives exigées par le dossier de conception §13
 * sont conservées : un prix expiré, des doublons probables, des achats hors
 * ligne non synchronisés, des transferts à écart vert / orange / rouge, un
 * planning annulé et un planning futur.
 *
 * TOUTES LES DONNÉES SONT FICTIVES. Les noms de sociétés sont utilisés à titre
 * illustratif et suffixés « (démo) ».
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin'
const PGHOST = process.env.LBA_PGHOST ?? '/var/tmp'
const PGPORT = process.env.LBA_PGPORT ?? '54329'
const PGDATABASE = process.env.LBA_PGDATABASE ?? 'lba_control'
const PGUSER = process.env.LBA_PGUSER ?? 'postgres'

/** Générateur pseudo-aléatoire déterministe : un seed reproductible est un seed débogable. */
let state = 20260730
const random = () => {
  state = (state * 1103515245 + 12345) % 2147483648
  return state / 2147483648
}
const pick = (list) => list[Math.floor(random() * list.length)]
const between = (min, max) => Math.round(min + random() * (max - min))

/** Empreinte FNV-1a du préfixe : un UUID lisible en base doit rester un UUID valide. */
const hex8 = (value) => {
  let hash = 0x811c9dc5
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const uuid = (prefix, n) => `${hex8(prefix)}-0000-4000-8000-${String(n).padStart(12, '0')}`

const TENANT = uuid('dem0', 1)
const OWNER = uuid('user', 1)
const MANAGER = uuid('user', 2)
const ACCOUNTANT = uuid('user', 3)
const CAMPAIGN = uuid('camp', 1)
const PRODUCT = uuid('prod', 1)
const ZONE = uuid('zone', 1)
const SITE = uuid('site', 1)
const DEST_SITE = uuid('site', 2)
const OLAM = uuid('part', 1)
const DORADO = uuid('part', 2)
const CONTRACT_OLAM = uuid('ctrt', 1)
const CONTRACT_DORADO = uuid('ctrt', 2)

const AGENTS = [
  { id: uuid('agnt', 1), user: uuid('user', 10), code: 'PIS-001', name: 'KOUAME Yao (démo)', ceiling: 8_000_000, profile: 'excellent' },
  { id: uuid('agnt', 2), user: uuid('user', 11), code: 'PIS-002', name: 'TRAORE Awa (démo)', ceiling: 5_000_000, profile: 'normal' },
  { id: uuid('agnt', 3), user: uuid('user', 12), code: 'PIS-003', name: 'DIABATE Sekou (démo)', ceiling: 4_000_000, profile: 'retard' },
  { id: uuid('agnt', 4), user: uuid('user', 13), code: 'PIS-004', name: 'N’GUESSAN Ama (démo)', ceiling: 2_000_000, profile: 'nouveau' },
]

const VILLAGES = ['Sakassou (démo)', 'Béoumi (démo)', 'Botro (démo)', 'Diabo (démo)', 'Brobo (démo)']

const EXPENSE_CATEGORIES = [
  ['achat_produit', 'Achat produit', 'Achat matière', true, true, false],
  ['commission_pisteur', 'Commission pisteur', 'Pisteurs', true, true, true],
  ['collecte', 'Collecte', 'Collecte / manutention', true, false, true],
  ['chargement', 'Chargement', 'Collecte / manutention', true, false, true],
  ['dechargement', 'Déchargement', 'Collecte / manutention', true, false, false],
  ['manutention', 'Manutention', 'Collecte / manutention', true, false, false],
  ['transport', 'Transport', 'Transport', true, false, false],
  ['carburant', 'Carburant', 'Transport', true, false, true],
  ['peage', 'Péage', 'Transport', true, false, false],
  ['pesee', 'Pesée', 'Collecte / manutention', true, false, false],
  ['sechage', 'Séchage', 'Qualité / traitement', true, false, false],
  ['tri', 'Tri', 'Qualité / traitement', true, false, false],
  ['reconditionnement', 'Reconditionnement', 'Qualité / traitement', true, false, false],
  ['sacherie', 'Sacherie', 'Sacherie', true, false, true],
  ['mobile_money', 'Mobile Money', 'Financier', true, false, false],
  ['frais_bancaires', 'Frais bancaires', 'Financier', true, false, false],
  ['interets', 'Intérêts', 'Financier', false, false, false],
  ['gardiennage', 'Gardiennage', 'Frais généraux imputables', false, false, false],
  ['stockage', 'Stockage', 'Frais généraux imputables', false, false, false],
  ['communication', 'Communication', 'Administratif', true, false, true],
  ['administration', 'Administration', 'Administratif', false, false, false],
  ['qualite', 'Qualité', 'Qualité / traitement', true, false, false],
  ['autres_frais', 'Autres frais autorisés', 'Administratif', true, false, false],
]

const ALERT_TYPES = [
  'financement_proche_echeance', 'avance_sans_achat', 'avance_non_couverte',
  'argent_chez_pisteur_trop_longtemps', 'aucune_livraison_depuis_x_jours',
  'livraison_prevue_48h', 'livraison_prevue_demain', 'livraison_en_retard',
  'stock_insuffisant', 'double_reservation', 'camion_sans_document',
  'transfert_transit_trop_long', 'reception_non_renseignee', 'ecart_superieur_tolerance',
  'tare_anormale', 'depense_sans_justificatif', 'depense_doublon_probable',
  'tcb_superieur_prix_net', 'marge_inferieure_seuil', 'abonnement_proche_echeance',
]

const q = (value) => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return `'${String(value).replace(/'/g, "''")}'`
}

const sql = []
const add = (statement) => sql.push(statement)

add('begin;')

// ---------------------------------------------------------------------------
// Tenant, marque, paramètres, abonnement actif
// ---------------------------------------------------------------------------
add(`insert into tenants (id, slug, commercial_name, legal_name)
     values (${q(TENANT)}, 'lba-demo-bouake', 'LBA Démonstration Bouaké',
             'LBA Démonstration Bouaké SARL (fictif)')
     on conflict (id) do nothing;`)

add(`insert into tenant_branding (tenant_id, commercial_name, slogan, primary_color, secondary_color,
                                  phone, email, address, document_footer)
     values (${q(TENANT)}, 'LBA Démonstration Bouaké', 'Contrôler chaque franc et chaque kilogramme',
             '#1f6f43', '#8a3d00', '+225 00 00 00 00', 'contact@demo.test',
             'Bouaké, Côte d''Ivoire (adresse fictive)',
             'Document de démonstration — données fictives')
     on conflict (tenant_id) do nothing;`)

add(`insert into tenant_settings (tenant_id) values (${q(TENANT)}) on conflict (tenant_id) do nothing;`)

add(`insert into subscriptions (tenant_id, plan_id, status, period_start, period_end, amount)
     select ${q(TENANT)}, id, 'active', current_date - 10, current_date + 20, 50000
     from subscription_plans where code = 'standard'
     on conflict do nothing;`)

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------
const users = [
  [OWNER, 'proprietaire', 'Propriétaire Démo'],
  [MANAGER, 'gestionnaire', 'Gestionnaire Démo'],
  [ACCOUNTANT, 'comptable', 'Comptable Démo'],
  ...AGENTS.map((a) => [a.user, 'pisteur', a.name]),
]
for (const [id, role, name] of users) {
  add(`insert into users (id, tenant_id, role, full_name, email)
       values (${q(id)}, ${q(TENANT)}, ${q(role)}, ${q(name)},
               ${q(`${role}.${id.slice(-4)}@demo.test`)})
       on conflict (id) do nothing;`)
}

// ---------------------------------------------------------------------------
// Référentiel
// ---------------------------------------------------------------------------
add(`insert into products (id, tenant_id, code, name) values (${q(PRODUCT)}, ${q(TENANT)}, 'RCN', 'Noix brutes de cajou') on conflict do nothing;`)
add(`insert into zones (id, tenant_id, code, name) values (${q(ZONE)}, ${q(TENANT)}, 'Z-BKE', 'Bouaké') on conflict do nothing;`)
add(`insert into sites (id, tenant_id, code, name, type) values
       (${q(SITE)}, ${q(TENANT)}, 'MAG-BKE', 'Magasin Bouaké (démo)', 'warehouse'),
       (${q(DEST_SITE)}, ${q(TENANT)}, 'SITE-ABJ', 'Site société Abidjan (démo)', 'partner_site')
     on conflict do nothing;`)

VILLAGES.forEach((village, index) => {
  add(`insert into localities (id, tenant_id, zone_id, name)
       values (${q(uuid('loca', index + 1))}, ${q(TENANT)}, ${q(ZONE)}, ${q(village)})
       on conflict do nothing;`)
})

add(`insert into partner_companies (id, tenant_id, code, name, weight_tolerance_pct) values
       (${q(OLAM)}, ${q(TENANT)}, 'OLAM', 'OLAM (démo)', 0.5),
       (${q(DORADO)}, ${q(TENANT)}, 'DORADO', 'DORADO (démo)', 0.8)
     on conflict do nothing;`)

add(`insert into campaigns (id, tenant_id, code, name, start_date, end_date)
     values (${q(CAMPAIGN)}, ${q(TENANT)}, 'C2026', 'Campagne 2026 (démo)',
             current_date - 90, current_date + 90)
     on conflict do nothing;`)

add(`insert into transporters (id, tenant_id, code, name) values
       (${q(uuid('trsp', 1))}, ${q(TENANT)}, 'TR-01', 'Transporteur Alpha (démo)'),
       (${q(uuid('trsp', 2))}, ${q(TENANT)}, 'TR-02', 'Transporteur Beta (démo)')
     on conflict do nothing;`)

add(`insert into vehicles (id, tenant_id, transporter_id, tractor_plate, trailer_plate, known_tare_kg, capacity_kg)
     values (${q(uuid('vehi', 1))}, ${q(TENANT)}, ${q(uuid('trsp', 1))}, 'AA-001-BC', 'RR-001-BC', 14500, 40000),
            (${q(uuid('vehi', 2))}, ${q(TENANT)}, ${q(uuid('trsp', 2))}, 'AA-002-BC', 'RR-002-BC', 14200, 35000)
     on conflict do nothing;`)

add(`insert into weighbridges (id, tenant_id, code, name, site_id, calibration_status, calibrated_at)
     values (${q(uuid('wbrg', 1))}, ${q(TENANT)}, 'PB-01', 'Pont-bascule Bouaké (démo)', ${q(SITE)},
             'valide', current_date - 40)
     on conflict do nothing;`)

for (let i = 1; i <= 10; i++) {
  add(`insert into suppliers (id, tenant_id, code, full_name, locality_id)
       values (${q(uuid('supl', i))}, ${q(TENANT)}, ${q(`F-${String(i).padStart(3, '0')}`)},
               ${q(`Producteur ${i} (démo)`)}, ${q(uuid('loca', ((i - 1) % VILLAGES.length) + 1))})
       on conflict do nothing;`)
}

// ---------------------------------------------------------------------------
// Contrats et prix · dont un prix EXPIRÉ (exigence DCP §13)
// ---------------------------------------------------------------------------
add(`insert into contracts (id, tenant_id, partner_company_id, campaign_id, product_id, reference,
                            target_volume_kg, start_date, end_date, delivery_site_id, kor_min,
                            humidity_max, weight_tolerance_pct, status, activated_at)
     values
       (${q(CONTRACT_OLAM)}, ${q(TENANT)}, ${q(OLAM)}, ${q(CAMPAIGN)}, ${q(PRODUCT)}, 'CT-OLAM-2026',
        500000, current_date - 90, current_date + 90, ${q(DEST_SITE)}, 47, 10, 0.5, 'actif', now()),
       (${q(CONTRACT_DORADO)}, ${q(TENANT)}, ${q(DORADO)}, ${q(CAMPAIGN)}, ${q(PRODUCT)}, 'CT-DORADO-2026',
        300000, current_date - 60, current_date + 90, ${q(DEST_SITE)}, 46, 11, 0.8, 'actif', now())
     on conflict do nothing;`)

// Prix expiré puis prix courant : la révision crée une version, elle n'écrase pas.
add(`insert into negotiated_prices (id, tenant_id, contract_id, price_type, price, valid_from, valid_to, version, justification)
     values
       (${q(uuid('pric', 1))}, ${q(TENANT)}, ${q(CONTRACT_OLAM)}, 'negocie', 430,
        current_date - 90, current_date - 31, 1, 'Prix d''ouverture de campagne (démo)'),
       (${q(uuid('pric', 2))}, ${q(TENANT)}, ${q(CONTRACT_OLAM)}, 'negocie', 450,
        current_date - 30, null, 2, 'Révision négociée (démo)'),
       (${q(uuid('pric', 3))}, ${q(TENANT)}, ${q(CONTRACT_OLAM)}, 'plafond_achat', 435,
        current_date - 30, null, 1, 'Plafond d''achat terrain (démo)'),
       (${q(uuid('pric', 4))}, ${q(TENANT)}, ${q(CONTRACT_DORADO)}, 'negocie', 440,
        current_date - 60, null, 1, 'Prix négocié DORADO (démo)'),
       (${q(uuid('pric', 5))}, ${q(TENANT)}, ${q(CONTRACT_DORADO)}, 'plafond_achat', 425,
        current_date - 60, null, 1, 'Plafond d''achat terrain (démo)')
     on conflict do nothing;`)

// ---------------------------------------------------------------------------
// Pisteurs
// ---------------------------------------------------------------------------
AGENTS.forEach((agent, index) => {
  add(`insert into field_agents (id, tenant_id, user_id, code, full_name, phone, zone_id,
                                 mobile_money_account, ceiling_amount, activation_date, status,
                                 commission_mode, commission_value)
       values (${q(agent.id)}, ${q(TENANT)}, ${q(agent.user)}, ${q(agent.code)}, ${q(agent.name)},
               ${q(`+225 07 00 00 0${index + 1}`)}, ${q(ZONE)}, ${q(`WAVE-00${index + 1}`)},
               ${agent.ceiling}, current_date - ${agent.profile === 'nouveau' ? 12 : 80}, 'actif',
               'par_kg', 5)
       on conflict do nothing;`)

  add(`insert into field_agent_partners (tenant_id, field_agent_id, partner_company_id, ceiling_amount)
       values (${q(TENANT)}, ${q(agent.id)}, ${q(OLAM)}, ${Math.round(agent.ceiling * 0.6)}),
              (${q(TENANT)}, ${q(agent.id)}, ${q(DORADO)}, ${Math.round(agent.ceiling * 0.4)})
       on conflict do nothing;`)
})

// ---------------------------------------------------------------------------
// 3 financements
// ---------------------------------------------------------------------------
const FUNDINGS = [
  { id: uuid('fund', 1), partner: OLAM, contract: CONTRACT_OLAM, amount: 20_000_000, price: 450, days: 45 },
  { id: uuid('fund', 2), partner: OLAM, contract: CONTRACT_OLAM, amount: 15_000_000, price: 450, days: 25 },
  { id: uuid('fund', 3), partner: DORADO, contract: CONTRACT_DORADO, amount: 12_000_000, price: 440, days: 15 },
]
FUNDINGS.forEach((f, i) => {
  add(`insert into fundings (id, tenant_id, partner_company_id, contract_id, campaign_id, amount,
                             received_at, reference, payment_method, reference_price,
                             coverage_deadline, status)
       values (${q(f.id)}, ${q(TENANT)}, ${q(f.partner)}, ${q(f.contract)}, ${q(CAMPAIGN)},
               ${f.amount}, current_date - ${f.days}, ${q(`FIN-${String(i + 1).padStart(3, '0')}`)},
               'bank_transfer', ${f.price}, current_date + ${60 - f.days}, 'affecte')
       on conflict do nothing;`)
})

// ---------------------------------------------------------------------------
// 8 avances · couvertes, partielles et en retard
// ---------------------------------------------------------------------------
const ADVANCES = []
for (let i = 0; i < 8; i++) {
  const agent = AGENTS[i % AGENTS.length]
  const funding = FUNDINGS[i % FUNDINGS.length]
  const amount = between(1_500_000, 5_000_000)
  const daysAgo = 5 + i * 4
  const id = uuid('advc', i + 1)
  ADVANCES.push({ id, agent, funding, amount, daysAgo })

  add(`insert into advances (id, tenant_id, field_agent_id, partner_company_id, funding_id, contract_id,
                             campaign_id, amount, issued_at, payment_method, reference, zone_id,
                             volume_target_kg, max_purchase_price, justification_deadline, status,
                             created_by, approved_by, approved_at, disbursed_at)
       values (${q(id)}, ${q(TENANT)}, ${q(agent.id)}, ${q(funding.partner)}, ${q(funding.id)},
               ${q(funding.contract)}, ${q(CAMPAIGN)}, ${amount},
               now() - interval '${daysAgo} days', 'wave',
               ${q(`AV-${String(i + 1).padStart(3, '0')}`)}, ${q(ZONE)},
               ${Math.round(amount / 435)}, 435, current_date + ${7 - Math.min(i, 7)},
               ${q(i < 3 ? 'partiellement_couvert' : 'decaisse')},
               ${q(MANAGER)}, ${q(OWNER)}, now() - interval '${daysAgo} days',
               now() - interval '${daysAgo} days')
       on conflict do nothing;`)
}

// ---------------------------------------------------------------------------
// 25 achats · dont doublons probables et écritures hors ligne
// ---------------------------------------------------------------------------
for (let i = 0; i < 25; i++) {
  const advance = ADVANCES[i % ADVANCES.length]
  const weight = between(800, 9000)
  const price = pick([425, 428, 430, 432, 435])
  const daysAgo = Math.max(1, advance.daysAgo - between(0, 3))
  // Trois dernières écritures laissées en attente de synchronisation : la file
  // hors ligne doit être visible dans le jeu de démonstration.
  const offline = i >= 22
  // Deux doublons volontaires : mêmes vendeur, date, poids et montant.
  const isDuplicate = i === 24
  const source = isDuplicate ? 12 : i
  const supplierIndex = (source % 10) + 1

  add(`insert into purchases (id, tenant_id, field_agent_id, partner_company_id, campaign_id,
                              contract_id, funding_id, advance_id, supplier_id, locality_id, village,
                              purchased_at, gross_weight_kg, tare_kg, net_weight_kg, price_per_kg,
                              amount, bag_count, kor, humidity, payment_method, status,
                              applied_price_id, applied_price_value, sync_status, device_id,
                              created_at_device, created_by)
       values (${q(uuid('purc', i + 1))}, ${q(TENANT)}, ${q(advance.agent.id)}, ${q(advance.funding.partner)},
               ${q(CAMPAIGN)}, ${q(advance.funding.contract)}, ${q(advance.funding.id)}, ${q(advance.id)},
               ${q(uuid('supl', supplierIndex))}, ${q(uuid('loca', ((source % VILLAGES.length) + 1)))},
               ${q(VILLAGES[source % VILLAGES.length])},
               now() - interval '${daysAgo} days', ${weight + 40}, 40, ${weight}, ${price},
               ${weight * price}, ${Math.ceil(weight / 80)}, ${between(45, 52)}, ${between(6, 11)},
               'cash', ${q(offline ? 'brouillon' : 'valide')},
               ${q(uuid('pric', advance.funding.partner === OLAM ? 2 : 4))},
               ${advance.funding.partner === OLAM ? 450 : 440},
               ${q(offline ? 'pending' : 'synced')}, ${q(`device-${(i % 4) + 1}`)},
               now() - interval '${daysAgo} days', ${q(MANAGER)})
       on conflict do nothing;`)
}

// Signalement du doublon probable — signalé, jamais bloqué d'office.
add(`insert into purchase_duplicate_flags (tenant_id, purchase_id, candidate_id, similarity_score, matched_criteria)
     values (${q(TENANT)}, ${q(uuid('purc', 25))}, ${q(uuid('purc', 13))}, 92.5,
             array['pisteur', 'vendeur', 'poids', 'montant', 'localite'])
     on conflict do nothing;`)

// ---------------------------------------------------------------------------
// Stocks · chez pisteur, en magasin, réservé et en transit
// ---------------------------------------------------------------------------
const LOTS = [
  { n: 1, holder: 'field_agent', agent: AGENTS[0], partner: OLAM, qty: 9500, status: 'disponible' },
  { n: 2, holder: 'field_agent', agent: AGENTS[1], partner: OLAM, qty: 6200, status: 'disponible' },
  { n: 3, holder: 'warehouse', agent: AGENTS[0], partner: OLAM, qty: 24000, status: 'disponible' },
  { n: 4, holder: 'warehouse', agent: AGENTS[1], partner: OLAM, qty: 18000, status: 'reserve' },
  { n: 5, holder: 'warehouse', agent: AGENTS[2], partner: DORADO, qty: 15000, status: 'disponible' },
  { n: 6, holder: 'in_transit', agent: AGENTS[0], partner: OLAM, qty: 32000, status: 'en_transit' },
  { n: 7, holder: 'warehouse', agent: AGENTS[3], partner: DORADO, qty: 4200, status: 'bloque' },
  { n: 8, holder: 'warehouse', agent: AGENTS[2], partner: DORADO, qty: 7800, status: 'en_litige' },
]
for (const lot of LOTS) {
  add(`insert into stock_lots (id, tenant_id, code, campaign_id, partner_company_id, contract_id,
                               field_agent_id, product_id, site_id, holder_type, holder_id,
                               quantity_kg, bag_count, kor, humidity, status, created_by)
       values (${q(uuid('slot', lot.n))}, ${q(TENANT)}, ${q(`LOT-${String(lot.n).padStart(4, '0')}`)},
               ${q(CAMPAIGN)}, ${q(lot.partner)},
               ${q(lot.partner === OLAM ? CONTRACT_OLAM : CONTRACT_DORADO)}, ${q(lot.agent.id)},
               ${q(PRODUCT)}, ${q(lot.holder === 'in_transit' ? null : SITE)}, ${q(lot.holder)},
               ${q(lot.holder === 'field_agent' ? lot.agent.id : SITE)},
               ${lot.qty}, ${Math.ceil(lot.qty / 80)}, ${between(45, 52)}, ${between(6, 11)},
               ${q(lot.status)}, ${q(MANAGER)})
       on conflict do nothing;`)

  add(`insert into stock_movements (tenant_id, stock_lot_id, type, quantity_kg, source_table, created_by)
       values (${q(TENANT)}, ${q(uuid('slot', lot.n))}, 'entree', ${lot.qty}, 'purchases', ${q(MANAGER)})
       on conflict do nothing;`)
}

// ---------------------------------------------------------------------------
// 4 plannings · dont un annulé et un futur
// ---------------------------------------------------------------------------
const PLANS = [
  { n: 1, partner: OLAM, contract: CONTRACT_OLAM, offset: -6, volume: 32000, status: 'receptionne', agent: AGENTS[0] },
  { n: 2, partner: OLAM, contract: CONTRACT_OLAM, offset: -2, volume: 28000, status: 'en_transit', agent: AGENTS[1] },
  { n: 3, partner: DORADO, contract: CONTRACT_DORADO, offset: 3, volume: 20000, status: 'planifie', agent: AGENTS[2] },
  { n: 4, partner: DORADO, contract: CONTRACT_DORADO, offset: -1, volume: 15000, status: 'annule', agent: AGENTS[3] },
]
for (const plan of PLANS) {
  add(`insert into delivery_plans (id, tenant_id, reference, partner_company_id, contract_id, campaign_id,
                                   planned_date, planned_volume_kg, origin_site_id, destination_site_id,
                                   field_agent_id, vehicle_id, transporter_id, priority, status,
                                   cancelled_at, cancelled_by, cancellation_reason, created_by)
       values (${q(uuid('plan', plan.n))}, ${q(TENANT)}, ${q(`PL-${String(plan.n).padStart(4, '0')}`)},
               ${q(plan.partner)}, ${q(plan.contract)}, ${q(CAMPAIGN)},
               current_date + ${plan.offset}, ${plan.volume}, ${q(SITE)}, ${q(DEST_SITE)},
               ${q(plan.agent.id)}, ${q(uuid('vehi', (plan.n % 2) + 1))},
               ${q(uuid('trsp', (plan.n % 2) + 1))}, 'normale', ${q(plan.status)},
               ${plan.status === 'annule' ? 'now()' : 'null'},
               ${plan.status === 'annule' ? q(OWNER) : 'null'},
               ${plan.status === 'annule' ? q('Camion indisponible, livraison reportée (démo)') : 'null'},
               ${q(MANAGER)})
       on conflict do nothing;`)
}

// ---------------------------------------------------------------------------
// 4 transferts · écarts vert, orange et rouge, avec les QUATRE poids
// ---------------------------------------------------------------------------
const TRANSFERS = [
  // Écart vert : 0,15 %, sous la tolérance de 0,5 %.
  { n: 1, plan: 1, partner: OLAM, contract: CONTRACT_OLAM, loaded: 32000, unloaded: 31952, accepted: 31900, paid: 31900, status: 'cloture', level: 'vert' },
  // Écart orange : 0,60 %, au-dessus de la tolérance OLAM.
  { n: 2, plan: 2, partner: OLAM, contract: CONTRACT_OLAM, loaded: 40000, unloaded: 39760, accepted: 39600, paid: 39500, status: 'receptionne', level: 'orange' },
  // Écart rouge : 1,85 %, incident ouvert et clôture bloquée.
  { n: 3, plan: 2, partner: OLAM, contract: CONTRACT_OLAM, loaded: 28000, unloaded: 27482, accepted: 27100, paid: 27100, status: 'decharge', level: 'rouge' },
  // En transit : la réception n'est pas encore renseignée, donc pas de poids.
  { n: 4, plan: 3, partner: DORADO, contract: CONTRACT_DORADO, loaded: 20000, unloaded: null, accepted: null, paid: null, status: 'en_transit', level: 'transit' },
]
for (const t of TRANSFERS) {
  add(`insert into transfers (id, tenant_id, transfer_number, partner_company_id, contract_id, campaign_id,
                              delivery_plan_id, origin_site_id, dispatched_at, transporter_id, vehicle_id,
                              driver_name, tractor_plate, trailer_plate, gross_weight_kg, tare_kg,
                              net_loaded_kg, bag_count_loaded, kor_departure, humidity_departure,
                              weighbridge_id, weight_source, loading_responsible,
                              arrived_at, unloaded_at, destination_site_id,
                              net_unloaded_kg, accepted_kg, paid_kg, bag_count_received,
                              kor_reception, humidity_reception, rejected_kg, rejection_reason,
                              receiver_name, applied_price_id, applied_price_value, status, created_by)
       values (${q(uuid('trns', t.n))}, ${q(TENANT)}, ${q(`TR-${String(t.n).padStart(4, '0')}`)},
               ${q(t.partner)}, ${q(t.contract)}, ${q(CAMPAIGN)}, ${q(uuid('plan', t.plan))},
               ${q(SITE)}, now() - interval '${8 - t.n} days',
               ${q(uuid('trsp', (t.n % 2) + 1))}, ${q(uuid('vehi', (t.n % 2) + 1))},
               ${q(`Chauffeur ${t.n} (démo)`)}, ${q(`AA-00${(t.n % 2) + 1}-BC`)}, ${q(`RR-00${(t.n % 2) + 1}-BC`)},
               ${t.loaded + 14500}, 14500, ${t.loaded}, ${Math.ceil(t.loaded / 80)},
               ${between(46, 50)}, ${between(7, 10)}, ${q(uuid('wbrg', 1))}, 'verified',
               'Magasinier Démo',
               ${t.unloaded === null ? 'null' : `now() - interval '${7 - t.n} days'`},
               ${t.unloaded === null ? 'null' : `now() - interval '${7 - t.n} days'`},
               ${t.unloaded === null ? 'null' : q(DEST_SITE)},
               ${q(t.unloaded)}, ${q(t.accepted)}, ${q(t.paid)},
               ${t.unloaded === null ? 'null' : Math.ceil(t.unloaded / 80)},
               ${t.unloaded === null ? 'null' : between(45, 49)},
               ${t.unloaded === null ? 'null' : between(7, 11)},
               ${t.unloaded === null || t.accepted === null ? 'null' : t.unloaded - t.accepted},
               ${t.unloaded === null || t.unloaded === t.accepted ? 'null' : q('Rejet qualité au contrôle de réception (démo)')},
               ${t.unloaded === null ? 'null' : q('Réceptionnaire société (démo)')},
               ${q(uuid('pric', t.partner === OLAM ? 2 : 4))}, ${t.partner === OLAM ? 450 : 440},
               ${q(t.status)}, ${q(MANAGER)})
       on conflict do nothing;`)
}

// ---------------------------------------------------------------------------
// Incidents · l'écart rouge ouvre un incident bloquant, sans imputation
// ---------------------------------------------------------------------------
add(`insert into incidents (id, tenant_id, reference, type, severity, campaign_id, partner_company_id,
                            field_agent_id, transfer_id, description, exposed_quantity_kg,
                            exposed_amount, suspected_responsible_type, status, blocks_closure, created_by)
     values
       (${q(uuid('incd', 1))}, ${q(TENANT)}, 'INC-0001', 'ecart_poids', 'critique', ${q(CAMPAIGN)},
        ${q(OLAM)}, ${q(AGENTS[1].id)}, ${q(uuid('trns', 3))},
        'Écart de 1,85 % entre poids chargé et poids déchargé, au-dessus de la tolérance de 0,5 %. '
        'Cause à établir : humidité, pont-bascule ou perte en transit. Aucune responsabilité imputée à ce stade.',
        518, 233100, 'inconnu', 'en_enquete', true, ${q(MANAGER)}),
       (${q(uuid('incd', 2))}, ${q(TENANT)}, 'INC-0002', 'rejet_qualite', 'moderee', ${q(CAMPAIGN)},
        ${q(OLAM)}, ${q(AGENTS[1].id)}, ${q(uuid('trns', 2))},
        'Rejet de 160 kg au contrôle qualité de réception (KOR inférieur au minimum contractuel).',
        160, 72000, 'inconnu', 'ouvert', false, ${q(MANAGER)})
     on conflict do nothing;`)

// ---------------------------------------------------------------------------
// Catégories de dépenses · les 23 imposées
// ---------------------------------------------------------------------------
EXPENSE_CATEGORIES.forEach(([code, label, family, isDirect, reserved, controllable], index) => {
  add(`insert into expense_categories (id, tenant_id, code, label, family, is_direct,
                                       is_system_reserved, is_controllable_by_agent,
                                       requires_receipt_above)
       values (${q(uuid('excg', index + 1))}, ${q(TENANT)}, ${q(code)}, ${q(label)}, ${q(family)},
               ${isDirect}, ${reserved}, ${controllable}, 50000)
       on conflict do nothing;`)
})

// ---------------------------------------------------------------------------
// 20 dépenses · dont un doublon probable et une sans justificatif
// ---------------------------------------------------------------------------
const USABLE_CATEGORIES = EXPENSE_CATEGORIES.map((c, i) => ({ code: c[0], index: i + 1, direct: c[3], reserved: c[4] }))
  .filter((c) => !c.reserved)

for (let i = 0; i < 20; i++) {
  const category = USABLE_CATEGORIES[i % USABLE_CATEGORIES.length]
  const isDuplicate = i === 19
  const source = isDuplicate ? 11 : i
  const amount = isDuplicate ? 145000 : between(25_000, 480_000)
  const noProof = i === 7
  const status = i < 14 ? 'validee' : i < 17 ? 'soumise' : i === 17 ? 'rejetee' : 'brouillon'

  add(`insert into expenses (id, tenant_id, category_id, partner_company_id, campaign_id, contract_id,
                             field_agent_id, transfer_id, expense_date, amount, beneficiary,
                             payment_method, reference, proof_path, nature, allocation_key, status,
                             validated_by, validated_at, rejected_by, rejected_at, rejection_reason,
                             created_by)
       values (${q(uuid('expn', i + 1))}, ${q(TENANT)}, ${q(uuid('excg', category.index))},
               ${q(i % 3 === 2 ? DORADO : OLAM)}, ${q(CAMPAIGN)},
               ${q(i % 3 === 2 ? CONTRACT_DORADO : CONTRACT_OLAM)},
               ${q(AGENTS[source % AGENTS.length].id)},
               ${i % 4 === 0 ? q(uuid('trns', (i % 4) + 1)) : 'null'},
               current_date - ${between(1, 40)}, ${isDuplicate ? 145000 : amount},
               ${q(`Bénéficiaire ${(source % 6) + 1} (démo)`)}, 'cash',
               ${q(`REF-DEP-${String(source + 1).padStart(3, '0')}`)},
               ${noProof ? 'null' : q(`proofs/${TENANT}/depense-${i + 1}.jpg`)},
               ${q(category.direct ? 'direct' : 'indirect')},
               ${category.direct ? 'null' : q('poids_accepte')},
               ${q(status)},
               ${status === 'validee' ? q(ACCOUNTANT) : 'null'},
               ${status === 'validee' ? 'now()' : 'null'},
               ${status === 'rejetee' ? q(OWNER) : 'null'},
               ${status === 'rejetee' ? 'now()' : 'null'},
               ${status === 'rejetee' ? q('Justificatif non conforme, dépense écartée du TCB (démo)') : 'null'},
               ${q(MANAGER)})
       on conflict do nothing;`)
}

add(`insert into expense_duplicate_flags (tenant_id, expense_id, candidate_id, similarity_score, matched_criteria)
     values (${q(TENANT)}, ${q(uuid('expn', 20))}, ${q(uuid('expn', 12))}, 88.0,
             array['montant', 'beneficiaire', 'reference'])
     on conflict do nothing;`)

// ---------------------------------------------------------------------------
// Scores · un excellent, un fiable, un sous surveillance, un non évalué
// ---------------------------------------------------------------------------
const SCORES = [
  { agent: AGENTS[0], raw: 88, adjusted: 88, category: 'excellent', maturity: 'confirme' },
  { agent: AGENTS[1], raw: 74, adjusted: 76, category: 'fiable', maturity: 'confirme' },
  { agent: AGENTS[2], raw: 58, adjusted: 62, category: 'sous_surveillance', maturity: 'provisoire' },
  { agent: AGENTS[3], raw: null, adjusted: null, category: 'non_evalue', maturity: 'en_observation' },
]
const COMPONENTS = [
  ['couverture_avances', 20], ['respect_delais', 15], ['ecarts_poids', 15],
  ['respect_prix', 10], ['qualite', 10], ['fiabilite_justificatifs', 10],
  ['gestion_sacs', 5], ['regularite', 5], ['maitrise_tcb', 10],
]

SCORES.forEach((score, index) => {
  const scoreId = uuid('scor', index + 1)
  add(`insert into agent_scores (id, tenant_id, field_agent_id, campaign_id, period_start, period_end,
                                 raw_score, adjusted_score, category, maturity, recommended_ceiling, created_by)
       values (${q(scoreId)}, ${q(TENANT)}, ${q(score.agent.id)}, ${q(CAMPAIGN)},
               current_date - 90, current_date, ${q(score.raw)}, ${q(score.adjusted)},
               ${q(score.category)}, ${q(score.maturity)},
               ${score.raw === null ? 'null' : Math.round(score.agent.ceiling * (score.raw >= 85 ? 1.2 : score.raw >= 70 ? 1 : 0.7))},
               ${q(OWNER)})
       on conflict do nothing;`)

  if (score.raw !== null) {
    COMPONENTS.forEach(([component, weight], ci) => {
      const value = Math.min(100, Math.max(0, score.raw + between(-12, 12)))
      add(`insert into agent_score_components (tenant_id, score_id, component, weight, value,
                                               weighted_value, source_data, explanation)
           values (${q(TENANT)}, ${q(scoreId)}, ${q(component)}, ${weight}, ${value},
                   ${Math.round((value * weight) / 100 * 100) / 100},
                   ${q(JSON.stringify({ echantillon: 'donnees_demo', composante: component, rang: ci + 1 }))}::jsonb,
                   ${q(`Calculé à partir des opérations de la campagne de démonstration (${component}).`)})
           on conflict do nothing;`)
    })
  }
})

// Un événement externe validé explique le retard du pisteur « sous surveillance ».
add(`insert into external_events (tenant_id, field_agent_id, event_type, description,
                                  occurred_from, occurred_to, validated_by, validated_at, created_by)
     values (${q(TENANT)}, ${q(AGENTS[2].id)}, 'camion_indisponible',
             'Camion immobilisé trois jours : le retard de livraison ne relève pas du pisteur (démo).',
             current_date - 12, current_date - 9, ${q(OWNER)}, now(), ${q(MANAGER)})
     on conflict do nothing;`)

// ---------------------------------------------------------------------------
// Règles d'alerte · les 20 types, seuils par défaut
// ---------------------------------------------------------------------------
ALERT_TYPES.forEach((type) => {
  add(`insert into alert_rules (tenant_id, alert_type, severity, threshold)
       values (${q(TENANT)}, ${q(type)}, 'surveillance', '{"jours": 3}'::jsonb)
       on conflict (tenant_id, alert_type) do nothing;`)
})

add('commit;')

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------
const script = sql.join('\n')
const res = spawnSync(
  join(PG_BIN, 'psql'),
  ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', PGDATABASE, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
  { input: script, encoding: 'utf8' },
)

if (res.status !== 0) {
  console.error(res.stdout ?? '')
  console.error(res.stderr ?? '')
  process.exit(1)
}

console.log(`Jeu de démonstration inséré (${sql.length} instructions).`)
console.log('  1 entreprise cliente · 2 sociétés partenaires · 1 campagne · 2 contrats')
console.log('  4 pisteurs · 3 financements · 8 avances · 25 achats · 8 lots de stock')
console.log('  4 plannings · 4 transferts (4 poids) · 20 dépenses · 2 incidents · 4 scores')
console.log('  Abonnement actif · 20 règles d’alerte')
console.log('\nToutes les données sont fictives et suffixées « (démo) ».')
