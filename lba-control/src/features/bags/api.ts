import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BagMovementType, HolderType } from '@/domain/bags'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

const MOVEMENTS = ['bag-movements'] as const
const STOCKS = ['bag-stocks'] as const

export interface BagMovementRow {
  id: string
  tenant_id: string
  partner_company_id: string | null
  type: BagMovementType
  quantity: number
  from_holder_type: HolderType | null
  from_holder_id: string | null
  to_holder_type: HolderType | null
  to_holder_id: string | null
  field_agent_id: string | null
  purchase_id: string | null
  occurred_at: string
  reason: string | null
  approved_by: string | null
}

export interface BagStockRow {
  id: string
  tenant_id: string
  partner_company_id: string | null
  holder_type: HolderType
  holder_id: string | null
  bag_count: number
  updated_at: string
}

export interface BagReconciliation {
  partner_company_id: string
  received: number
  distributed: number
  returned: number
  used_for_purchases: number
  declared_losses: number
  held_by_agents: number
  expected_in_warehouse: number
  /** `null` — jamais 0 — quand rien n'a été distribué. */
  loss_rate_pct: number | null
}

export function useBagMovements() {
  return useQuery({
    queryKey: MOVEMENTS,
    queryFn: async (): Promise<BagMovementRow[]> => {
      const { data, error } = await supabase
        .from('bag_movements')
        .select('*')
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as BagMovementRow[]
    },
  })
}

export function useBagStocks() {
  return useQuery({
    queryKey: STOCKS,
    queryFn: async (): Promise<BagStockRow[]> => {
      const { data, error } = await supabase.from('bag_stocks').select('*')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as BagStockRow[]
    },
  })
}

export function useBagReconciliation(tenantId: string | null, partnerId: string | null) {
  return useQuery({
    queryKey: ['bag-reconciliation', tenantId, partnerId],
    enabled: Boolean(tenantId && partnerId),
    queryFn: async (): Promise<BagReconciliation> => {
      const { data, error } = await supabase.rpc('bag_reconciliation', {
        p_tenant: tenantId!,
        p_partner: partnerId!,
      })
      if (error) throw new Error(describeError(error))
      return data as BagReconciliation
    },
  })
}

export interface BagMovementInput {
  partnerCompanyId: string
  type: BagMovementType
  quantity: number
  fromHolderType: HolderType | null
  fromHolderId: string | null
  toHolderType: HolderType | null
  toHolderId: string | null
  fieldAgentId: string | null
  reason: string
}

/**
 * Enregistrement d'un mouvement.
 *
 * Le solde n'est jamais envoyé : il est recalculé par trigger à partir du
 * mouvement. Laisser le client proposer un solde ouvrirait la porte à une
 * correction silencieuse.
 */
export function useCreateBagMovement(tenantId: string | null, currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BagMovementInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('bag_movements')
        .insert({
          tenant_id: tenantId,
          partner_company_id: input.partnerCompanyId,
          type: input.type,
          quantity: input.quantity,
          from_holder_type: input.fromHolderType,
          from_holder_id: input.fromHolderId,
          to_holder_type: input.toHolderType,
          to_holder_id: input.toHolderId,
          field_agent_id: input.fieldAgentId,
          reason: input.reason || null,
          created_by: currentUserId,
        })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as BagMovementRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MOVEMENTS })
      void queryClient.invalidateQueries({ queryKey: STOCKS })
      void queryClient.invalidateQueries({ queryKey: ['bag-reconciliation'] })
    },
  })
}

/** Réaffectation entre sociétés : deux mouvements, une seule transaction. */
export function useReassignBags() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      fromPartnerId: string
      toPartnerId: string
      holderType: HolderType
      holderId: string | null
      quantity: number
      reason: string
    }) => {
      const { data, error } = await supabase.rpc('reassign_bags', {
        p_from_partner: args.fromPartnerId,
        p_to_partner: args.toPartnerId,
        p_holder_type: args.holderType,
        p_holder_id: args.holderId,
        p_quantity: args.quantity,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
      return data as { out_movement_id: string; in_movement_id: string; quantity: number }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MOVEMENTS })
      void queryClient.invalidateQueries({ queryKey: STOCKS })
      void queryClient.invalidateQueries({ queryKey: ['bag-reconciliation'] })
    },
  })
}
