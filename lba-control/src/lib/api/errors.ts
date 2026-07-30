import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Traduction des erreurs PostgreSQL en messages utilisables.
 *
 * La base renvoie « duplicate key value violates unique constraint
 * partner_companies_tenant_id_code_key ». Affiché tel quel, cela n'aide
 * personne et donne l'impression que l'application est cassée alors que
 * l'utilisateur a simplement saisi un code déjà pris.
 *
 * Les messages métier levés par nos fonctions serveur (RAISE EXCEPTION) sont
 * déjà rédigés pour l'utilisateur : ils sont transmis tels quels.
 */
const CONSTRAINT_MESSAGES: Array<{ match: RegExp; message: string }> = [
  {
    match: /partner_companies_tenant_id_code_key/,
    message: 'Ce code de société est déjà utilisé dans votre entreprise.',
  },
  {
    match: /contracts_tenant_id_reference_key/,
    message: 'Cette référence de contrat existe déjà.',
  },
  {
    match: /campaigns_tenant_id_code_key/,
    message: 'Ce code de campagne existe déjà.',
  },
  {
    match: /negotiated_prices_no_overlap/,
    message:
      'Un prix du même type couvre déjà cette période. Clôturez la version en cours ou choisissez une autre date d’effet.',
  },
  {
    match: /row-level security/i,
    message:
      "Vous n'avez pas les droits pour cette opération, ou l'abonnement de votre entreprise est suspendu.",
  },
  {
    match: /contract_dates_ordered|campaign_dates_ordered/,
    message: 'La date de fin doit être postérieure ou égale à la date de début.',
  },
]

export function describeError(error: PostgrestError | Error | null | unknown): string {
  if (!error) return 'Erreur inconnue.'

  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)

  for (const { match, message } of CONSTRAINT_MESSAGES) {
    if (match.test(raw)) return message
  }

  // Message métier déjà rédigé pour l'utilisateur par une fonction serveur.
  if (/^[A-ZÀ-Ü]/.test(raw) && raw.length < 400 && !raw.includes('_')) {
    return raw
  }

  return `L'opération a échoué : ${raw}`
}
