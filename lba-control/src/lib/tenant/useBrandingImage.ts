/**
 * Affichage d'une image de marque rangée dans un bucket privé.
 *
 * Un chemin de stockage n'est **pas** une adresse : le poser dans `src` produit
 * une image cassée. Le bucket `marque` étant privé, chaque affichage passe par
 * un lien signé de courte durée, régénéré à la demande.
 *
 * Le lien est mis en cache quelques minutes — moins longtemps qu'il n'est
 * valable — pour ne pas signer une URL à chaque rendu ; il n'est jamais rangé
 * en base ni dans le stockage local, où il traînerait après expiration de la
 * session.
 */

import { useQuery } from '@tanstack/react-query'
import { UPLOAD_POLICIES } from '@/domain/uploads'
import { signedUrl } from '@/lib/storage/upload'

/** Le lien vaut 5 minutes ; on le renouvelle bien avant. */
const CACHE_MS = 3 * 60 * 1000

export function useBrandingImage(path: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ['branding-image', path],
    enabled: Boolean(path),
    staleTime: CACHE_MS,
    gcTime: CACHE_MS,
    // Une image de marque absente n'est pas un incident : on n'insiste pas.
    retry: false,
    queryFn: async (): Promise<string | null> => {
      try {
        return await signedUrl(UPLOAD_POLICIES.logo.bucket, path!)
      } catch {
        return null
      }
    },
  })

  return data ?? null
}
