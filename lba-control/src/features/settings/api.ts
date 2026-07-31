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

/** Colonnes d'image de la marque, nommées ici pour rester alignées sur la liste blanche. */
export type BrandingImageColumn = 'logo_path' | 'logo_mobile_path' | 'login_image_path'

/**
 * Enregistre une image de marque dès son dépôt.
 *
 * Séparé du formulaire : les octets sont déjà partis dans le bucket au moment
 * où le chemin est connu. Attendre le bouton « Enregistrer » laisserait un
 * fichier orphelin dans le bucket si l'utilisateur ferme l'écran entre-temps.
 */
export function useSaveBrandingImage(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { column: BrandingImageColumn; path: string | null }) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      // Clé calculée : le cast nomme le type attendu, la colonne étant issue
      // d'une union fermée et non d'une chaîne quelconque.
      const patch = { [args.column]: args.path } as Partial<TenantBrandingRow>

      const { error } = await supabase
        .from('tenant_branding')
        .update(patch)
        .eq('tenant_id', tenantId)

      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
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
