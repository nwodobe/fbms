/**
 * Agrégation des indicateurs du tableau de bord.
 *
 * Pur et testé séparément de l'écran, pour une raison précise : un chiffre de
 * tableau de bord se lit en une seconde et se répète en réunion. S'il est faux,
 * il circule avant d'être corrigé.
 *
 * Deux règles y sont tenues :
 *
 *  1. **Aucun indicateur inventé.** Sans donnée, la valeur est `null` et
 *     l'écran affiche « — ». Un zéro par défaut se somme et se compare comme
 *     une vraie mesure.
 *
 *  2. **Chaque indicateur porte son compte de sources.** Une moyenne calculée
 *     sur deux lignes et une moyenne calculée sur deux cents ne se lisent pas
 *     de la même manière ; masquer la différence rend la première abusivement
 *     crédible.
 */

import { divide, round2 } from './money'

export interface Kpi {
  key: string
  label: string
  value: number | null
  kind: 'money' | 'weight' | 'number' | 'percent'
  /** Nombre de lignes ayant produit la valeur. Zéro ⇒ valeur absente. */
  sourceCount: number
  /** Ce que le chiffre veut dire, en une phrase, pour éviter la mauvaise lecture. */
  hint: string
}

export interface DashboardInput {
  purchases: ReadonlyArray<{ amount: number; net_weight_kg: number; purchased_at: string }>
  transfers: ReadonlyArray<{
    accepted_kg: number | null
    net_loaded_kg: number | null
    ecart_physique_pct: number | null
    status: string
  }>
  advances: ReadonlyArray<{ amount: number }>
  advanceCoverage: number
  stock: ReadonlyArray<{ quantity_kg: number; status: string; holder_type: string }>
  latestTcb: ReadonlyArray<{
    scope_id: string
    tcb_per_accepted_kg: number | null
    margin_total: number | null
    accepted_weight_kg: number | null
    computed_at: string
  }>
  openAlerts: ReadonlyArray<{ severity: string }>
  latePlans: number
  openIncidents: number
}

function total(values: readonly number[]): number {
  return round2(values.reduce((sum, value) => sum + value, 0))
}

/** Un indicateur sans source est absent, jamais nul. */
function kpi(
  key: string,
  label: string,
  kind: Kpi['kind'],
  value: number | null,
  sourceCount: number,
  hint: string,
): Kpi {
  return { key, label, kind, value: sourceCount > 0 ? value : null, sourceCount, hint }
}

export function buildKpis(input: DashboardInput): Kpi[] {
  const purchaseAmount = total(input.purchases.map((row) => Number(row.amount)))
  const purchaseWeight = total(input.purchases.map((row) => Number(row.net_weight_kg)))

  const accepted = input.transfers
    .map((row) => row.accepted_kg)
    .filter((value): value is number => value !== null)
  const loaded = input.transfers
    .map((row) => row.net_loaded_kg)
    .filter((value): value is number => value !== null)
  const variances = input.transfers
    .map((row) => row.ecart_physique_pct)
    .filter((value): value is number => value !== null)

  const advanced = total(input.advances.map((row) => Number(row.amount)))
  const exposure = Math.max(0, round2(advanced - input.advanceCoverage))

  const available = input.stock
    .filter((row) => row.status === 'disponible')
    .map((row) => Number(row.quantity_kg))
  const atAgents = input.stock
    .filter((row) => row.holder_type === 'field_agent')
    .map((row) => Number(row.quantity_kg))
  const inTransit = input.stock
    .filter((row) => row.status === 'en_transit')
    .map((row) => Number(row.quantity_kg))

  // Un seul instantané par périmètre : le plus récent. Empiler les recalculs
  // successifs compterait le même coût plusieurs fois.
  const latestByScope = new Map<string, DashboardInput['latestTcb'][number]>()
  for (const snapshot of input.latestTcb) {
    const previous = latestByScope.get(snapshot.scope_id)
    if (!previous || snapshot.computed_at > previous.computed_at) {
      latestByScope.set(snapshot.scope_id, snapshot)
    }
  }
  const snapshots = [...latestByScope.values()]
  const costs = snapshots
    .map((row) => row.tcb_per_accepted_kg)
    .filter((value): value is number => value !== null)
  const margins = snapshots
    .map((row) => row.margin_total)
    .filter((value): value is number => value !== null)

  return [
    kpi(
      'purchase_amount',
      'Valeur achetée',
      'money',
      purchaseAmount,
      input.purchases.length,
      'Somme des achats validés ou payés du périmètre.',
    ),
    kpi(
      'purchase_weight',
      'Poids acheté',
      'weight',
      purchaseWeight,
      input.purchases.length,
      'Poids net des achats terrain, avant transport.',
    ),
    kpi(
      'average_price',
      'Prix moyen d’achat',
      'money',
      purchaseWeight > 0 ? divide(purchaseAmount, purchaseWeight) : null,
      purchaseWeight > 0 ? input.purchases.length : 0,
      'Valeur achetée rapportée au poids acheté. Ce n’est pas le coût de revient.',
    ),
    kpi(
      'accepted_weight',
      'Poids accepté',
      'weight',
      total(accepted),
      accepted.length,
      'Poids reconnu par les sociétés après contrôle. Base du TCB par kilo.',
    ),
    kpi(
      'physical_loss',
      'Perte physique moyenne',
      'percent',
      variances.length > 0 ? round2(total(variances) / variances.length) : null,
      variances.length,
      'Écart moyen entre chargé et déchargé. N’impute aucune responsabilité.',
    ),
    kpi(
      'loaded_weight',
      'Poids chargé',
      'weight',
      total(loaded),
      loaded.length,
      'Poids au départ, avant réception.',
    ),
    kpi(
      'agent_exposure',
      'Exposition chez les pisteurs',
      'money',
      exposure,
      input.advances.length,
      'Avances décaissées moins couvertures et remboursements. Un actif à justifier, pas une charge.',
    ),
    kpi(
      'stock_available',
      'Stock disponible',
      'weight',
      total(available),
      available.length,
      'Lots disponibles, réservations déduites au niveau de l’écran des stocks.',
    ),
    kpi(
      'stock_at_agents',
      'Stock chez les pisteurs',
      'weight',
      total(atAgents),
      atAgents.length,
      'Matière détenue par les pisteurs, non encore rentrée en magasin.',
    ),
    kpi(
      'stock_in_transit',
      'Stock en transit',
      'weight',
      total(inTransit),
      inTransit.length,
      'Matière partie et non encore réceptionnée.',
    ),
    kpi(
      'tcb_per_kg',
      'TCB moyen par kg accepté',
      'money',
      costs.length > 0 ? round2(total(costs) / costs.length) : null,
      costs.length,
      'Moyenne des derniers instantanés calculés, un par périmètre.',
    ),
    kpi(
      'margin_total',
      'Marge totale',
      'money',
      margins.length > 0 ? total(margins) : null,
      margins.length,
      'Somme des marges des derniers instantanés. Absente tant qu’aucun chiffre d’affaires n’est saisi.',
    ),
    kpi(
      'late_plans',
      'Livraisons en retard',
      'number',
      input.latePlans,
      input.latePlans > 0 ? input.latePlans : 1,
      'Plannings dépassés et non réceptionnés.',
    ),
    kpi(
      'open_incidents',
      'Incidents ouverts',
      'number',
      input.openIncidents,
      input.openIncidents > 0 ? input.openIncidents : 1,
      'Incidents sans décision. Ils bloquent la clôture des transferts concernés.',
    ),
    kpi(
      'critical_alerts',
      'Alertes critiques ou bloquantes',
      'number',
      input.openAlerts.filter((alert) => ['critique', 'blocage'].includes(alert.severity)).length,
      1,
      'Alertes ouvertes exigeant une décision.',
    ),
  ]
}

/**
 * Série temporelle des achats, par jour.
 *
 * Les jours sans achat sont **omis**, pas mis à zéro : une courbe qui retombe à
 * zéro le dimanche laisse croire à un effondrement d'activité, alors que le
 * marché était simplement fermé.
 */
export function purchaseSeries(
  purchases: DashboardInput['purchases'],
): Array<{ date: string; amount: number; weight: number; count: number }> {
  const byDay = new Map<string, { amount: number; weight: number; count: number }>()

  for (const purchase of purchases) {
    const day = purchase.purchased_at.slice(0, 10)
    const bucket = byDay.get(day) ?? { amount: 0, weight: 0, count: 0 }
    bucket.amount += Number(purchase.amount)
    bucket.weight += Number(purchase.net_weight_kg)
    bucket.count += 1
    byDay.set(day, bucket)
  }

  return [...byDay.entries()]
    .map(([date, bucket]) => ({
      date,
      amount: round2(bucket.amount),
      weight: round2(bucket.weight),
      count: bucket.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Répartition du stock par état, pour un graphique en parts. */
export function stockBreakdown(
  stock: DashboardInput['stock'],
): Array<{ status: string; quantityKg: number }> {
  const byStatus = new Map<string, number>()
  for (const lot of stock) {
    byStatus.set(lot.status, (byStatus.get(lot.status) ?? 0) + Number(lot.quantity_kg))
  }
  return [...byStatus.entries()]
    .map(([status, quantityKg]) => ({ status, quantityKg: round2(quantityKg) }))
    .filter((entry) => entry.quantityKg > 0)
    .sort((a, b) => b.quantityKg - a.quantityKg)
}
