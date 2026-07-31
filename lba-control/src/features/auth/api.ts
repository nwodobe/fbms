import { useMutation, useQuery } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type { AccountRow } from '@/domain/activation'
import type { InvitationPreviewResult } from '@/types/database'

/**
 * Ce qui se passe avant d'avoir une entreprise.
 *
 * Toutes les requêtes de ce fichier partagent une particularité : elles
 * s'exécutent avec un jeton qui ne porte AUCUN tenant. C'est l'état d'un
 * propriétaire invité qui vient de créer son mot de passe. Les politiques RLS
 * concernées l'autorisent explicitement (`id = app.current_user_id()` pour sa
 * propre ligne), et les fonctions appelées sont `security definer` avec leurs
 * propres contrôles.
 */

export type InvitationPreview = InvitationPreviewResult

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: ['invitation', token],
    enabled: Boolean(token),
    // Une invitation ne change pas pendant qu'on la regarde, et un nouvel essai
    // automatique sur un jeton faux n'apporte rien.
    retry: false,
    queryFn: async (): Promise<InvitationPreview> => {
      // `enabled` garantit un jeton non nul, mais le type ne le sait pas.
      const { data, error } = await supabase.rpc('invitation_preview', { p_token: token ?? '' })
      if (error) throw new Error(describeError(error))
      return (data ?? { found: false }) as InvitationPreview
    },
  })
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { error } = await supabase.rpc('accept_invitation', { p_token: token })
      if (error) throw new Error(describeError(error))

      /*
       * Le jeton en cours a été émis AVANT que la ligne `users` n'existe : il ne
       * porte donc ni entreprise ni rôle. Sans ce rafraîchissement, l'écran
       * suivant serait vide et l'utilisateur conclurait que l'acceptation a
       * échoué — alors qu'elle a réussi.
       */
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        throw new Error(
          'Invitation acceptée, mais la session n’a pas pu être rafraîchie. ' +
            'Déconnectez-vous puis reconnectez-vous.',
        )
      }
    },
  })
}

/**
 * La ligne `public.users` du compte connecté, ou `null`.
 *
 * Sert au diagnostic : c'est en la comparant aux valeurs du jeton qu'on
 * distingue un compte non rattaché d'un hook non activé. `maybeSingle` parce
 * que l'absence de ligne est un résultat attendu, pas une erreur.
 *
 * L'identifiant est passé en argument plutôt que redemandé au serveur : la
 * session le porte déjà, et un aller-retour de plus sur un écran de diagnostic
 * ajoute un point de panne à un moment où quelque chose est justement en panne.
 */
export function useOwnAccount(userId: string | null) {
  return useQuery({
    queryKey: ['compte-propre', userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: async (): Promise<AccountRow | null> => {
      const { data, error } = await supabase
        .from('users')
        .select('tenant_id, role, status')
        .eq('id', userId ?? '')
        .maybeSingle()

      if (error) throw new Error(describeError(error))
      if (!data) return null

      return {
        tenantId: data.tenant_id,
        role: data.role,
        status: data.status,
      }
    },
  })
}
