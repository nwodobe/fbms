/**
 * Marque prête à imprimer, logo compris.
 *
 * Le logo est résolu une fois et gardé en mémoire quelques minutes : un
 * magasinier qui imprime douze bons à la suite ne doit pas déclencher douze
 * allers-retours réseau. Son absence n'empêche jamais l'impression — c'est la
 * même règle que pour les exports du tableau de bord.
 */

import { useQuery } from '@tanstack/react-query'
import { useBranding } from '@/lib/tenant/branding'
import { loadExportLogo } from './brandmark'
import type { DocumentBranding } from './documents'

export function useDocumentBranding(): DocumentBranding {
  const branding = useBranding()

  const { data: logo } = useQuery({
    queryKey: ['document-logo', branding.logoPath],
    enabled: Boolean(branding.logoPath),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => (await loadExportLogo(branding.logoPath)).logo,
  })

  return {
    commercialName: branding.commercialName,
    primaryColor: branding.primaryColor,
    documentFooter: branding.documentFooter,
    phone: branding.phone,
    address: branding.address,
    logo: logo ?? null,
  }
}
