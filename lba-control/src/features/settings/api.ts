import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BrandingInput } from '@/domain/schemas'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type { TenantBrandingRow } from '@/types/database'

const KEY = ['tenant-branding'] as const

export function useTenantBranding(tenantId: string | null) {
  return useQuery({
    queryKey: [...KEY, tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<TenantBrandingRow | null> => {
      const { data, error } = await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', tenantId!)
        .maybeSingle()

      if (error) throw new Error(describeError(error))
      return data
    },
  })
}

export function useSaveBranding(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: BrandingInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      // Le serveur revalide le contraste par trigger et refuse la mise à jour
      // si les couleurs sont illisibles, même si le formulaire a été contourné.
      const { data, error } = await supabase
        .from('tenant_branding')
        .update({
          commercial_name: input.commercialName,
          legal_name: input.legalName || null,
          slogan: input.slogan || null,
          primary_color: input.primaryColor,
          secondary_color: input.secondaryColor,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null,
          tax_id: input.taxId || null,
          document_footer: input.documentFooter || null,
        })
        .eq('tenant_id', tenantId)
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as TenantBrandingRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
      void queryClient.invalidateQueries({ queryKey: ['tenant-branding'] })
    },
  })
}
