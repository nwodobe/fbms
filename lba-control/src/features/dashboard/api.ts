import { useQuery } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

/**
 * Données du tableau de bord.
 *
 * Chaque indicateur est calculé à partir de lignes réellement lues, jamais
 * d'une estimation : un KPI que l'on ne peut pas ramener à ses transactions
 * n'est pas un indicateur, c'est une opinion chiffrée. Les requêtes restent
 * volontairement simples et lisibles plutôt que regroupées en une vue, pour que
 * chaque chiffre affiché soit traçable jusqu'à sa source.
 */

export interface DashboardFilters {
  campaignId: string | null
  partnerCompanyId: string | null
}

export interface DashboardData {
  purchases: Array<{ amount: number; net_weight_kg: number; purchased_at: string; field_agent_id: string }>
  transfers: Array<{
    accepted_kg: number | null
    net_loaded_kg: number | null
    ecart_physique_pct: number | null
    status: string
    dispatched_at: string | null
  }>
  advances: Array<{ amount: number; status: string; issued_at: string }>
  advanceCoverage: number
  stock: Array<{ quantity_kg: number; status: string; holder_type: string }>
  openAlerts: Array<{ severity: string; alert_type: string }>
  latestTcb: Array<{
    scope_id: string
    tcb_per_accepted_kg: number | null
    margin_total: number | null
    margin_per_kg: number | null
    accepted_weight_kg: number | null
    computed_at: string
  }>
  latePlans: number
  openIncidents: number
}

function applyFilters<T>(query: T, filters: DashboardFilters, hasPartner = true): T {
  let result = query as unknown as {
    eq: (column: string, value: string) => unknown
  }
  if (filters.campaignId) result = result.eq('campaign_id', filters.campaignId) as typeof result
  if (filters.partnerCompanyId && hasPartner) {
    result = result.eq('partner_company_id', filters.partnerCompanyId) as typeof result
  }
  return result as unknown as T
}

export function useDashboard(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', filters.campaignId, filters.partnerCompanyId],
    queryFn: async (): Promise<DashboardData> => {
      const today = new Date().toISOString().slice(0, 10)

      const [
        purchases,
        transfers,
        advances,
        allocations,
        repayments,
        stock,
        alerts,
        tcb,
        plans,
        incidents,
      ] = await Promise.all([
        applyFilters(
          supabase
            .from('purchases')
            .select('amount, net_weight_kg, purchased_at, field_agent_id')
            .in('status', ['valide', 'paye']),
          filters,
        ),
        applyFilters(
          supabase
            .from('transfers')
            .select('accepted_kg, net_loaded_kg, ecart_physique_pct, status, dispatched_at')
            .neq('status', 'annule'),
          filters,
        ),
        applyFilters(
          supabase
            .from('advances')
            .select('amount, status, issued_at')
            .in('status', ['decaisse', 'partiellement_couvert']),
          filters,
        ),
        supabase.from('advance_allocations').select('amount'),
        supabase.from('advance_repayments').select('amount'),
        applyFilters(supabase.from('stock_lots').select('quantity_kg, status, holder_type'), filters),
        supabase.from('alerts').select('severity, alert_type').eq('status', 'ouverte'),
        supabase
          .from('tcb_snapshots')
          .select(
            'scope_id, tcb_per_accepted_kg, margin_total, margin_per_kg, accepted_weight_kg, computed_at',
          )
          .order('computed_at', { ascending: false })
          .limit(20),
        applyFilters(
          supabase
            .from('delivery_plans')
            .select('id, planned_date, status')
            .lt('planned_date', today)
            .not('status', 'in', '("receptionne","cloture","annule","reporte")'),
          filters,
        ),
        supabase.from('incidents').select('id').in('status', ['ouvert', 'en_enquete', 'reouvert']),
      ])

      for (const result of [
        purchases,
        transfers,
        advances,
        allocations,
        repayments,
        stock,
        alerts,
        tcb,
        plans,
        incidents,
      ]) {
        if (result.error) throw new Error(describeError(result.error))
      }

      const sum = (rows: Array<{ amount: number }> | null) =>
        (rows ?? []).reduce((total, row) => total + Number(row.amount), 0)

      return {
        purchases: (purchases.data ?? []) as DashboardData['purchases'],
        transfers: (transfers.data ?? []) as DashboardData['transfers'],
        advances: (advances.data ?? []) as DashboardData['advances'],
        advanceCoverage:
          sum(allocations.data as Array<{ amount: number }>) +
          sum(repayments.data as Array<{ amount: number }>),
        stock: (stock.data ?? []) as DashboardData['stock'],
        openAlerts: (alerts.data ?? []) as DashboardData['openAlerts'],
        latestTcb: (tcb.data ?? []) as DashboardData['latestTcb'],
        latePlans: (plans.data ?? []).length,
        openIncidents: (incidents.data ?? []).length,
      }
    },
  })
}
