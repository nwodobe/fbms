import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

export interface Funding {
  id: string
  tenant_id: string
  partner_company_id: string
  contract_id: string | null
  campaign_id: string
  amount: number
  received_at: string
  reference: string | null
  payment_method: string
  reference_price: number | null
  theoretical_volume_kg: number | null
  coverage_deadline: string | null
  status: string
}

export interface FundingInput {
  partnerCompanyId: string
  contractId: string | null
  campaignId: string
  amount: number
  receivedAt: string
  reference: string
  paymentMethod: string
  referencePrice: number | null
  coverageDeadline: string | null
}

const KEY = ['fundings'] as const

export function useFundings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Funding[]> => {
      const { data, error } = await supabase
        .from('fundings')
        .select('*')
        .order('received_at', { ascending: false })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as Funding[]
    },
  })
}

export function useCreateFunding(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: FundingInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('fundings')
        .insert({
          tenant_id: tenantId,
          partner_company_id: input.partnerCompanyId,
          contract_id: input.contractId,
          campaign_id: input.campaignId,
          amount: input.amount,
          received_at: input.receivedAt,
          reference: input.reference || null,
          payment_method: input.paymentMethod,
          // Le volume théorique est une colonne générée : il découle du prix de
          // référence et ne peut pas être saisi à la main.
          reference_price: input.referencePrice,
          coverage_deadline: input.coverageDeadline,
        })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as Funding
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
