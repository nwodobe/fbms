import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type { PartnerCompanyInput } from '@/domain/schemas'

export interface PartnerCompany {
  id: string
  tenant_id: string
  code: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  status: 'active' | 'suspended' | 'closed'
  weight_tolerance_pct: number | null
  acceptance_tolerance_pct: number | null
  external_access_enabled: boolean
  created_at: string
}

const KEY = ['partner-companies'] as const

export function usePartnerCompanies() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PartnerCompany[]> => {
      const { data, error } = await supabase
        .from('partner_companies')
        .select('*')
        .order('name', { ascending: true })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as PartnerCompany[]
    },
  })
}

export function usePartnerCompany(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, id],
    enabled: Boolean(id),
    queryFn: async (): Promise<PartnerCompany | null> => {
      const { data, error } = await supabase
        .from('partner_companies')
        .select('*')
        .eq('id', id!)
        .maybeSingle()

      if (error) throw new Error(describeError(error))
      return data as PartnerCompany | null
    },
  })
}

function toRow(input: PartnerCompanyInput) {
  return {
    code: input.code,
    name: input.name,
    contact_name: input.contactName || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    weight_tolerance_pct: input.weightTolerancePct ?? null,
    acceptance_tolerance_pct: input.acceptanceTolerancePct ?? null,
  }
}

export function useCreatePartnerCompany(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: PartnerCompanyInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('partner_companies')
        .insert({ ...toRow(input), tenant_id: tenantId })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as PartnerCompany
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdatePartnerCompany() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: PartnerCompanyInput }) => {
      const { data, error } = await supabase
        .from('partner_companies')
        .update(toRow(input))
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as PartnerCompany
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Suspension d'une société.
 *
 * Jamais une suppression : la désactivation n'efface aucune donnée (DMQ E03).
 * Une société suspendue n'accepte plus de nouvelles affectations, mais tout son
 * historique reste lisible et exportable.
 */
export function useSetPartnerStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PartnerCompany['status'] }) => {
      const { error } = await supabase.from('partner_companies').update({ status }).eq('id', id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
