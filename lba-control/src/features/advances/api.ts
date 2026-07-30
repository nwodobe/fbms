import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

export interface Advance {
  id: string
  tenant_id: string
  field_agent_id: string
  partner_company_id: string
  funding_id: string | null
  campaign_id: string
  amount: number
  issued_at: string
  payment_method: string
  reference: string | null
  volume_target_kg: number | null
  max_purchase_price: number | null
  justification_deadline: string | null
  status: string
  requires_override: boolean
  override_reason: string | null
}

export interface AdvanceInput {
  fieldAgentId: string
  partnerCompanyId: string
  fundingId: string | null
  campaignId: string
  amount: number
  paymentMethod: string
  reference: string
  volumeTargetKg: number | null
  maxPurchasePrice: number | null
  justificationDeadline: string | null
  /** Dérogation : uniquement si le contrôle de capacité l'exige. */
  requiresOverride: boolean
  overrideReason: string | null
  overrideApprovedBy: string | null
}

const KEY = ['advances'] as const

export function useAdvances(agentId?: string) {
  return useQuery({
    queryKey: [...KEY, agentId ?? 'all'],
    queryFn: async (): Promise<Advance[]> => {
      let query = supabase.from('advances').select('*').order('issued_at', { ascending: false })
      if (agentId) query = query.eq('field_agent_id', agentId)

      const { data, error } = await query
      if (error) throw new Error(describeError(error))
      return (data ?? []) as Advance[]
    },
  })
}

/**
 * Création d'une avance.
 *
 * Le serveur revérifie plafond, statut du pisteur, autorisation de société et
 * ancienneté du reliquat. Le contrôle affiché dans le formulaire n'est qu'une
 * courtoisie : c'est la base qui décide.
 */
export function useCreateAdvance(tenantId: string | null, currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AdvanceInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('advances')
        .insert({
          tenant_id: tenantId,
          field_agent_id: input.fieldAgentId,
          partner_company_id: input.partnerCompanyId,
          funding_id: input.fundingId,
          campaign_id: input.campaignId,
          amount: input.amount,
          payment_method: input.paymentMethod,
          reference: input.reference || null,
          volume_target_kg: input.volumeTargetKg,
          max_purchase_price: input.maxPurchasePrice,
          justification_deadline: input.justificationDeadline,
          status: 'decaisse',
          requires_override: input.requiresOverride,
          override_reason: input.overrideReason,
          override_approved_by: input.overrideApprovedBy,
          override_approved_at: input.overrideApprovedBy ? new Date().toISOString() : null,
          created_by: currentUserId,
        })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as Advance
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
      void queryClient.invalidateQueries({ queryKey: ['agent-exposure'] })
      void queryClient.invalidateQueries({ queryKey: ['advance-capacity'] })
    },
  })
}
