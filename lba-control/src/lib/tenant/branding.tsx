import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { evaluateBrandColor } from '@/domain/contrast'
import { supabase } from '@/lib/supabase'
import type { TenantBrandingRow } from '@/types/database'

export interface Branding {
  commercialName: string
  slogan: string | null
  logoPath: string | null
  logoMobilePath: string | null
  primaryColor: string
  secondaryColor: string
  documentFooter: string | null
  currency: string
}

/** Thème neutre, utilisé avant la résolution du tenant et en repli. */
export const DEFAULT_BRANDING: Branding = {
  commercialName: 'LBA Control',
  slogan: null,
  logoPath: null,
  logoMobilePath: null,
  primaryColor: '#1f6f43',
  secondaryColor: '#b45309',
  documentFooter: null,
  currency: 'FCFA',
}

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING)

function toBranding(row: TenantBrandingRow | null): Branding {
  if (!row) return DEFAULT_BRANDING
  return {
    commercialName: row.commercial_name ?? DEFAULT_BRANDING.commercialName,
    slogan: row.slogan,
    logoPath: row.logo_path,
    logoMobilePath: row.logo_mobile_path,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    documentFooter: row.document_footer,
    currency: row.currency,
  }
}

/**
 * Applique la marque du tenant par variables CSS.
 *
 * Deux couleurs, à des emplacements fixes. La couleur du texte posé dessus est
 * calculée, pas choisie : c'est ce qui garantit qu'aucun client ne peut rendre
 * sa propre application illisible.
 */
function applyTheme(branding: Branding): void {
  const root = document.documentElement
  const primary = evaluateBrandColor(branding.primaryColor)
  const secondary = evaluateBrandColor(branding.secondaryColor)

  root.style.setProperty('--brand-primary', branding.primaryColor)
  root.style.setProperty('--brand-primary-foreground', primary.recommendedForeground)
  root.style.setProperty('--brand-secondary', branding.secondaryColor)
  root.style.setProperty('--brand-secondary-foreground', secondary.recommendedForeground)
}

export function BrandingProvider({
  tenantId,
  children,
}: {
  tenantId: string | null
  children: ReactNode
}) {
  const { data } = useQuery({
    queryKey: ['tenant-branding', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<TenantBrandingRow | null> => {
      const { data, error } = await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', tenantId!)
        .maybeSingle()

      if (error) throw new Error(error.message)
      return data
    },
  })

  const branding = useMemo(() => toBranding(data ?? null), [data])

  useEffect(() => {
    applyTheme(branding)
  }, [branding])

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
}

export function useBranding(): Branding {
  return useContext(BrandingContext)
}
