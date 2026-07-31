import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type {
  AgentScoreComponentRow,
  AgentScoreRow,
  AlertRow,
  AlertRuleRow,
  AllocationKeyEnum,
  AllocationResultRow,
  AllocationTargetEnum,
  ExpenseAllocationRow,
  ExpenseCategoryRow,
  ExpenseDuplicateFlagRow,
  ExpenseRow,
  MarginResultRow,
  TcbSnapshotComponentRow,
  TcbSnapshotRow,
} from '@/types/database'

const EXPENSES = ['expenses'] as const
const CATEGORIES = ['expense-categories'] as const
const DUPLICATES = ['expense-duplicates'] as const
const ALLOCATIONS = ['expense-allocations'] as const
const TCB = ['tcb-snapshots'] as const
const TCB_COMPONENTS = ['tcb-components'] as const
const SCORES = ['agent-scores'] as const
const SCORE_COMPONENTS = ['agent-score-components'] as const
const ALERTS = ['alerts'] as const
const ALERT_RULES = ['alert-rules'] as const

// ---------------------------------------------------------------------------
// Dépenses
// ---------------------------------------------------------------------------

export function useExpenseCategories() {
  return useQuery({
    queryKey: CATEGORIES,
    queryFn: async (): Promise<ExpenseCategoryRow[]> => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('*')
        .order('family')
        .order('label')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as ExpenseCategoryRow[]
    },
  })
}

export function useExpenses() {
  return useQuery({
    queryKey: EXPENSES,
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('expense_date', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as ExpenseRow[]
    },
  })
}

export function useExpenseDuplicates() {
  return useQuery({
    queryKey: DUPLICATES,
    queryFn: async (): Promise<ExpenseDuplicateFlagRow[]> => {
      const { data, error } = await supabase
        .from('expense_duplicate_flags')
        .select('*')
        .order('similarity_score', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as ExpenseDuplicateFlagRow[]
    },
  })
}

export function useExpenseAllocations() {
  return useQuery({
    queryKey: ALLOCATIONS,
    queryFn: async (): Promise<ExpenseAllocationRow[]> => {
      const { data, error } = await supabase.from('expense_allocations').select('*')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as ExpenseAllocationRow[]
    },
  })
}

export interface ExpenseInput {
  /** Généré côté client : le justificatif se dépose avant que la ligne n'existe. */
  id: string
  proofPath: string | null
  categoryId: string
  partnerCompanyId: string | null
  campaignId: string
  fieldAgentId: string | null
  expenseDate: string
  amount: number
  beneficiary: string
  paymentMethod: string
  reference: string
  nature: 'direct' | 'indirect'
  allocationKey: AllocationKeyEnum | null
}

/**
 * Création d'une dépense.
 *
 * L'identifiant est généré côté client : c'est ce qui rend la saisie hors ligne
 * rejouable sans créer de doublon à la synchronisation.
 */
export function useCreateExpense(tenantId: string | null, currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ExpenseInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('expenses')
        .insert({
          id: input.id,
          tenant_id: tenantId,
          proof_path: input.proofPath,
          category_id: input.categoryId,
          partner_company_id: input.partnerCompanyId,
          campaign_id: input.campaignId,
          field_agent_id: input.fieldAgentId,
          expense_date: input.expenseDate,
          amount: input.amount,
          beneficiary: input.beneficiary,
          payment_method: input.paymentMethod,
          reference: input.reference || null,
          nature: input.nature,
          allocation_key: input.nature === 'indirect' ? input.allocationKey : null,
          status: 'soumise',
          submitted_by: currentUserId,
          submitted_at: new Date().toISOString(),
          created_by: currentUserId,
        })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as ExpenseRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPENSES })
      void queryClient.invalidateQueries({ queryKey: DUPLICATES })
    },
  })
}

/**
 * Validation ou rejet d'une dépense.
 *
 * Le serveur refuse qu'un valideur valide sa propre saisie, et rend le montant
 * immuable après validation : une dépense validée est un engagement.
 */
export function useDecideExpense(currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { id: string; decision: 'validee' | 'rejetee'; reason: string }) => {
      const payload =
        args.decision === 'validee'
          ? {
              status: 'validee',
              validated_by: currentUserId,
              validated_at: new Date().toISOString(),
            }
          : {
              status: 'rejetee',
              rejected_by: currentUserId,
              rejected_at: new Date().toISOString(),
              rejection_reason: args.reason,
            }

      const { error } = await supabase.from('expenses').update(payload).eq('id', args.id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPENSES })
      void queryClient.invalidateQueries({ queryKey: TCB })
    },
  })
}

export function useReviewDuplicate(currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { id: string; status: 'confirme' | 'ecarte' }) => {
      const { error } = await supabase
        .from('expense_duplicate_flags')
        .update({
          status: args.status,
          reviewed_by: currentUserId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', args.id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DUPLICATES }),
  })
}

/**
 * Répartition d'une charge indirecte.
 *
 * Passe par la fonction serveur : lire les bases puis écrire les quotes-parts
 * depuis le navigateur laisserait la somme des parts diverger du montant
 * réparti dès qu'une réception arrive entre les deux appels.
 */
export function useAllocateExpense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      expenseId: string
      key: AllocationKeyEnum
      targetType: AllocationTargetEnum
      targetIds: string[]
    }): Promise<AllocationResultRow> => {
      const { data, error } = await supabase.rpc('allocate_indirect_expense', {
        p_expense_id: args.expenseId,
        p_key: args.key,
        p_target_type: args.targetType,
        p_target_ids: args.targetIds,
      })
      if (error) throw new Error(describeError(error))
      return data as AllocationResultRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ALLOCATIONS })
      void queryClient.invalidateQueries({ queryKey: TCB })
    },
  })
}

// ---------------------------------------------------------------------------
// TCB et marges
// ---------------------------------------------------------------------------

export function useTcbSnapshots() {
  return useQuery({
    queryKey: TCB,
    queryFn: async (): Promise<TcbSnapshotRow[]> => {
      const { data, error } = await supabase
        .from('tcb_snapshots')
        .select('*')
        .order('computed_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as TcbSnapshotRow[]
    },
  })
}

export function useTcbComponents(snapshotId: string | null) {
  return useQuery({
    queryKey: [...TCB_COMPONENTS, snapshotId],
    enabled: Boolean(snapshotId),
    queryFn: async (): Promise<TcbSnapshotComponentRow[]> => {
      const { data, error } = await supabase
        .from('tcb_snapshot_components')
        .select('*')
        .eq('snapshot_id', snapshotId!)
      if (error) throw new Error(describeError(error))
      return (data ?? []) as TcbSnapshotComponentRow[]
    },
  })
}

export function useComputeTcb() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      scopeType: AllocationTargetEnum
      scopeId: string
      campaignId: string | null
      isForecast: boolean
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('compute_tcb', {
        p_scope_type: args.scopeType,
        p_scope_id: args.scopeId,
        p_campaign_id: args.campaignId,
        p_is_forecast: args.isForecast,
      })
      if (error) throw new Error(describeError(error))
      return data as string
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TCB }),
  })
}

export function useRecordMargin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      snapshotId: string
      netRevenue: number
      netSalePricePerKg: number
    }): Promise<MarginResultRow> => {
      const { data, error } = await supabase.rpc('record_margin', {
        p_snapshot_id: args.snapshotId,
        p_net_revenue: args.netRevenue,
        p_net_sale_price_kg: args.netSalePricePerKg,
      })
      if (error) throw new Error(describeError(error))
      return data as MarginResultRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TCB })
      void queryClient.invalidateQueries({ queryKey: TCB_COMPONENTS })
    },
  })
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function useAgentScores() {
  return useQuery({
    queryKey: SCORES,
    queryFn: async (): Promise<AgentScoreRow[]> => {
      const { data, error } = await supabase
        .from('agent_scores')
        .select('*')
        .order('computed_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as AgentScoreRow[]
    },
  })
}

export function useScoreComponents(scoreId: string | null) {
  return useQuery({
    queryKey: [...SCORE_COMPONENTS, scoreId],
    enabled: Boolean(scoreId),
    queryFn: async (): Promise<AgentScoreComponentRow[]> => {
      const { data, error } = await supabase
        .from('agent_score_components')
        .select('*')
        .eq('score_id', scoreId!)
      if (error) throw new Error(describeError(error))
      return (data ?? []) as AgentScoreComponentRow[]
    },
  })
}

export function useComputeScore() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { agentId: string; campaignId: string | null }): Promise<string> => {
      const { data, error } = await supabase.rpc('compute_agent_score', {
        p_agent_id: args.agentId,
        p_campaign_id: args.campaignId,
      })
      if (error) throw new Error(describeError(error))
      return data as string
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCORES }),
  })
}

/** Ajustement humain motivé. Modifie le score affiché, jamais le score brut. */
export function useAdjustScore() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { scoreId: string; delta: number; reason: string }): Promise<number> => {
      const { data, error } = await supabase.rpc('adjust_agent_score', {
        p_score_id: args.scoreId,
        p_delta: args.delta,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
      return data as number
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCORES })
      void queryClient.invalidateQueries({ queryKey: SCORE_COMPONENTS })
    },
  })
}

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------

export function useAlerts() {
  return useQuery({
    queryKey: ALERTS,
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .order('raised_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as AlertRow[]
    },
  })
}

export function useAlertRules() {
  return useQuery({
    queryKey: ALERT_RULES,
    queryFn: async (): Promise<AlertRuleRow[]> => {
      const { data, error } = await supabase.from('alert_rules').select('*').order('alert_type')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as AlertRuleRow[]
    },
  })
}

export function useSaveAlertRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      id: string
      threshold: Record<string, number>
      isActive: boolean
    }) => {
      const { error } = await supabase
        .from('alert_rules')
        .update({ threshold: args.threshold, is_active: args.isActive })
        .eq('id', args.id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERT_RULES }),
  })
}

export function useEvaluateAlerts(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')
      const { data, error } = await supabase.rpc('evaluate_alerts', { p_tenant: tenantId })
      if (error) throw new Error(describeError(error))
      return data as number
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERTS }),
  })
}

export function useSeedAlertRules(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')
      const { data, error } = await supabase.rpc('seed_alert_rules', { p_tenant: tenantId })
      if (error) throw new Error(describeError(error))
      return data as number
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERT_RULES }),
  })
}

export function useAcknowledgeAlert(currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { id: string; status: 'acquittee' | 'resolue'; note: string }) => {
      const { error } = await supabase
        .from('alerts')
        .update({
          status: args.status,
          acknowledged_by: currentUserId,
          acknowledged_at: new Date().toISOString(),
          resolved_at: args.status === 'resolue' ? new Date().toISOString() : null,
          resolution_note: args.note || null,
        })
        .eq('id', args.id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ALERTS }),
  })
}
