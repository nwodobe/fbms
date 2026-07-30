import { useQuery } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

export interface FieldAgent {
  id: string
  tenant_id: string
  user_id: string | null
  code: string
  full_name: string
  phone: string | null
  zone_id: string | null
  mobile_money_account: string | null
  ceiling_amount: number
  activation_date: string | null
  status: 'actif' | 'suspendu' | 'cloture'
  commission_mode: 'par_kg' | 'pourcentage' | 'forfait' | 'aucune'
  commission_value: number
}

export interface AgentExposure {
  advanced: number
  covered: number
  exposure: number
  oldest_outstanding_age_days: number
}

const AGENTS = ['field-agents'] as const

export function useFieldAgents() {
  return useQuery({
    queryKey: AGENTS,
    queryFn: async (): Promise<FieldAgent[]> => {
      const { data, error } = await supabase.from('field_agents').select('*').order('full_name')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as FieldAgent[]
    },
  })
}

export function useFieldAgent(id: string | undefined) {
  return useQuery({
    queryKey: [...AGENTS, id],
    enabled: Boolean(id),
    queryFn: async (): Promise<FieldAgent | null> => {
      const { data, error } = await supabase.from('field_agents').select('*').eq('id', id!).maybeSingle()
      if (error) throw new Error(describeError(error))
      return data as FieldAgent | null
    },
  })
}

/**
 * Exposition du pisteur, calculée par le serveur.
 *
 * Le calcul reste côté base : c'est lui qui décide si un décaissement est
 * autorisé, il ne peut pas dépendre de ce que le navigateur croit savoir.
 */
export function useAgentExposure(agentId: string | undefined) {
  return useQuery({
    queryKey: ['agent-exposure', agentId],
    enabled: Boolean(agentId),
    queryFn: async (): Promise<AgentExposure | null> => {
      const { data, error } = await supabase.rpc('agent_exposure', { p_agent_id: agentId! })
      if (error) throw new Error(describeError(error))
      return data as AgentExposure
    },
  })
}

export interface AdvanceCapacityIssue {
  reason: string
  severity: string
  message: string
  measured?: number
  threshold?: number
}

export interface AdvanceCapacity {
  issues: AdvanceCapacityIssue[]
  can_proceed: boolean
  requires_override: boolean
  has_hard_block: boolean
  exposure: AgentExposure
}

/** Contrôle de capacité serveur, appelé avant de proposer un décaissement. */
export function useAdvanceCapacity(agentId: string | null, partnerId: string | null, amount: number) {
  return useQuery({
    queryKey: ['advance-capacity', agentId, partnerId, amount],
    enabled: Boolean(agentId && partnerId && amount > 0),
    queryFn: async (): Promise<AdvanceCapacity> => {
      const { data, error } = await supabase.rpc('check_advance_capacity', {
        p_agent_id: agentId!,
        p_partner_id: partnerId!,
        p_amount: amount,
      })
      if (error) throw new Error(describeError(error))
      return data as AdvanceCapacity
    },
  })
}
