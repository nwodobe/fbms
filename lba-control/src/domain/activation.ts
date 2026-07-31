/**
 * Activation d'un compte : mot de passe et diagnostic.
 *
 * Deux règles vivent ici parce qu'elles doivent être vérifiables sans
 * navigateur ni base de données :
 *
 *  · la force d'un mot de passe, miroir exact de la politique réglée dans
 *    Supabase Auth. Le serveur reste l'autorité — le formulaire ne fait
 *    qu'expliquer un refus avant qu'il n'arrive, ce qui évite à quelqu'un de
 *    saisir trois fois un mot de passe qui ne passera jamais ;
 *
 *  · le diagnostic d'un compte connecté mais sans entreprise. Il y a quatre
 *    causes possibles et elles appellent quatre actions différentes. Afficher
 *    « accès refusé » pour les quatre laisserait l'utilisateur — et celui qui
 *    l'assiste — sans le moindre point de départ.
 */

// -----------------------------------------------------------------------------
// Mot de passe
// -----------------------------------------------------------------------------

/**
 * Douze caractères, comme la politique du serveur.
 *
 * Le nombre est en dur des deux côtés à dessein : un seuil configurable côté
 * client serait un seuil contournable, et le faire varier entre les deux
 * produirait un formulaire qui accepte ce que le serveur refuse.
 */
export const MIN_PASSWORD_LENGTH = 12

export interface PasswordAssessment {
  accepted: boolean
  issues: string[]
}

export function assessPassword(password: string, confirmation?: string): PasswordAssessment {
  const issues: string[] = []
  const value = password ?? ''

  if (value.length < MIN_PASSWORD_LENGTH) {
    issues.push(
      `Le mot de passe doit compter au moins ${MIN_PASSWORD_LENGTH} caractères (${value.length} pour l’instant).`,
    )
  }

  // Une exigence de composition, et une seule. Multiplier les classes de
  // caractères obligatoires pousse à écrire le mot de passe sur un papier collé
  // sous le clavier — ce qui coûte plus que ce que la règle rapporte.
  if (value.length >= MIN_PASSWORD_LENGTH && !/[^a-zA-Z]/.test(value)) {
    issues.push('Ajoutez au moins un chiffre, un espace ou un signe de ponctuation.')
  }

  if (confirmation !== undefined && value !== confirmation) {
    issues.push('Les deux saisies ne correspondent pas.')
  }

  return { accepted: issues.length === 0, issues }
}

// -----------------------------------------------------------------------------
// Diagnostic d'activation
// -----------------------------------------------------------------------------

/** Ce que le jeton en cours porte réellement. */
export interface TokenClaims {
  tenantId: string | null
  role: string | null
}

/** La ligne `public.users` du compte, si elle existe. Lue par RLS : `id = auth.uid()`. */
export interface AccountRow {
  tenantId: string | null
  role: string | null
  status: string
}

export type ActivationDiagnosis =
  /** Le jeton porte une entreprise : rien à signaler. */
  | { kind: 'active' }
  /** Administrateur de plateforme : pas d'entreprise, et c'est normal. */
  | { kind: 'platform_admin' }
  /** Aucune ligne `users` : le compte existe mais n'a jamais accepté d'invitation. */
  | { kind: 'unattached' }
  /** Ligne présente mais suspendue : l'accès a été retiré, la donnée est conservée. */
  | { kind: 'suspended' }
  /**
   * Ligne active AVEC entreprise, jeton SANS entreprise. Aucune autre cause
   * n'explique cet écart : le hook n'émet rien.
   */
  | { kind: 'hook_missing'; tenantId: string }

export interface DiagnosisInput {
  claims: TokenClaims
  /** `null` quand la table ne renvoie aucune ligne pour ce compte. */
  account: AccountRow | null
}

/**
 * Explique pourquoi un compte connecté ne voit rien.
 *
 * L'ordre des cas n'est pas indifférent. Le rôle de plateforme passe en
 * premier : il n'a légitimement aucune entreprise, et le confondre avec un
 * compte cassé enverrait un super-administrateur chercher un défaut inexistant.
 *
 * Le cas `hook_missing` est une déduction, pas une supposition : si la base dit
 * « ce compte appartient à l'entreprise X et il est actif » pendant que le jeton
 * ne porte aucune entreprise, c'est que rien ne recopie l'une dans l'autre.
 */
export function diagnoseActivation({ claims, account }: DiagnosisInput): ActivationDiagnosis {
  if (claims.role === 'super_admin') return { kind: 'platform_admin' }
  if (claims.tenantId) return { kind: 'active' }

  if (!account) return { kind: 'unattached' }
  if (account.status !== 'active') return { kind: 'suspended' }
  if (account.tenantId) return { kind: 'hook_missing', tenantId: account.tenantId }

  // Ligne active sans entreprise : c'est la forme d'un compte de plateforme dont
  // le jeton n'a pas encore été réémis. Le traiter comme non rattaché envoie
  // vers l'écran d'invitation, qui est la bonne action dans le doute.
  return { kind: 'unattached' }
}

/**
 * Ce que l'écran affiche pour chaque diagnostic.
 *
 * Séparé du composant : un message qui doit rester juste mérite d'être testé
 * sans monter de navigateur. Chacun dit ce qui se passe, puis quoi faire —
 * jamais l'un sans l'autre.
 */
export interface DiagnosisMessage {
  title: string
  body: string
  action: string | null
  /** Destinataire réel de l'action : l'utilisateur, ou l'exploitant du projet. */
  audience: 'utilisateur' | 'exploitant'
}

export function describeDiagnosis(diagnosis: ActivationDiagnosis): DiagnosisMessage {
  switch (diagnosis.kind) {
    case 'active':
      return {
        title: 'Compte actif',
        body: 'Votre compte est rattaché à votre entreprise.',
        action: null,
        audience: 'utilisateur',
      }

    case 'platform_admin':
      return {
        title: 'Administration de la plateforme',
        body:
          'Votre compte administre des abonnements, pas des campagnes. Il n’appartient à aucune ' +
          'entreprise cliente : pour consulter les données d’un client, ouvrez une session ' +
          'd’assistance motivée depuis la console.',
        action: 'Ouvrir la console plateforme',
        audience: 'utilisateur',
      }

    case 'unattached':
      return {
        title: 'Compte pas encore rattaché',
        body:
          'Votre compte existe, mais il n’est rattaché à aucune entreprise. Si vous avez reçu une ' +
          'invitation, ouvrez le lien qu’elle contient — ou saisissez son code ci-dessous.',
        action: 'Saisir un code d’invitation',
        audience: 'utilisateur',
      }

    case 'suspended':
      return {
        title: 'Compte suspendu',
        body:
          'Votre accès a été suspendu par un administrateur de votre entreprise. Vos données sont ' +
          'conservées : la réactivation rétablit l’accès tel quel.',
        action: null,
        audience: 'utilisateur',
      }

    case 'hook_missing':
      return {
        title: 'Configuration du serveur incomplète',
        body:
          'Votre compte est bien rattaché à une entreprise, mais le jeton d’accès ne la porte pas. ' +
          'Le déclencheur « Customize Access Token » n’est pas activé sur le projet Supabase : tant ' +
          'qu’il ne l’est pas, aucun utilisateur ne verra ses données. Ce n’est pas un problème de ' +
          'votre compte.',
        action:
          'Tableau de bord Supabase → Authentication → Hooks → Customize Access Token → ' +
          'app.custom_access_token, puis reconnectez-vous.',
        audience: 'exploitant',
      }
  }
}

// -----------------------------------------------------------------------------
// Ce que le jeton signé porte réellement
// -----------------------------------------------------------------------------
/*
 * Lire les revendications DANS le jeton, et non dans l'objet utilisateur rendu
 * par la bibliothèque cliente.
 *
 * La distinction décide de tout ici. `session.user.app_metadata` vient de la
 * réponse JSON du service d'authentification ; le jeton, lui, est ce que
 * PostgREST recevra et ce sur quoi RLS statuera. Quand le déclencheur
 * « Customize Access Token » n'est pas activé, c'est le jeton qui reste muet —
 * regarder ailleurs donnerait une réponse rassurante et fausse.
 *
 * Aucune signature n'est vérifiée : ce n'est pas le rôle du navigateur, et le
 * serveur le fait à chaque requête. On ne fait que lire.
 */
export interface TokenPayload {
  claims: TokenClaims
  /** Le jeton porte-t-il une section `app_metadata` non vide ? */
  carriesMetadata: boolean
}

export function readTokenClaims(accessToken: string | null | undefined): TokenPayload | null {
  const part = accessToken?.split('.')[1]
  if (!part) return null

  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      app_metadata?: { tenant_id?: unknown; role?: unknown }
    }
    const metadata = payload.app_metadata ?? {}

    return {
      claims: {
        tenantId: typeof metadata.tenant_id === 'string' ? metadata.tenant_id : null,
        role: typeof metadata.role === 'string' ? metadata.role : null,
      },
      // Un jeton émis sans le déclencheur ne porte ni l'un ni l'autre.
      carriesMetadata: Boolean(metadata.tenant_id ?? metadata.role),
    }
  } catch {
    // Un jeton illisible n'est pas un jeton sans revendications : le dire
    // autrement ferait accuser le déclencheur à tort.
    return null
  }
}
