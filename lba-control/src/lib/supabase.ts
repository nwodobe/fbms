import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Client Supabase du navigateur.
 *
 * Seule la clé PUBLIABLE est utilisée. La clé `service_role` contourne Row
 * Level Security : la placer ici exposerait toutes les données de tous les
 * clients à quiconque ouvre les outils de développement. Les opérations
 * privilégiées passent par des fonctions PostgreSQL SECURITY DEFINER et des
 * Edge Functions.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(url && publishableKey)

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    "[LBA Control] VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY manquante. " +
      'Copiez .env.example en .env.local et renseignez vos valeurs.',
  )
}

// Type inféré volontairement : annoter `SupabaseClient<Database>` fige les
// paramètres génériques avec leurs valeurs par défaut et fait retomber la
// résolution des tables sur `never` à l'écriture.
export const supabase = createClient<Database>(
  url ?? 'http://localhost:54321',
  publishableKey ?? 'public-anon-key-absente',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'lba-control-auth',
    },
    global: {
      headers: { 'x-application-name': 'lba-control' },
    },
  },
)

/** Rôles applicatifs, alignés sur l'énumération `user_role` en base. */
export type AppRole =
  | 'super_admin'
  | 'proprietaire'
  | 'gestionnaire'
  | 'comptable'
  | 'responsable_terrain'
  | 'pisteur'
  | 'auditeur'
  | 'magasinier'
  | 'logistique'
  | 'partenaire_externe'

export interface AppMetadata {
  tenant_id?: string
  role?: AppRole
  device_id?: string
}

/**
 * Lit le tenant et le rôle depuis `app_metadata`, jamais `user_metadata` :
 * `user_metadata` est modifiable par l'utilisateur lui-même, ce qui lui
 * permettrait de changer de tenant ou de se déclarer propriétaire.
 * Ces valeurs restent de toute façon revérifiées en base par RLS — le client ne
 * les utilise que pour afficher la bonne interface.
 */
export function readAppMetadata(metadata: unknown): AppMetadata {
  if (typeof metadata !== 'object' || metadata === null) return {}
  const source = metadata as Record<string, unknown>
  return {
    ...(typeof source.tenant_id === 'string' ? { tenant_id: source.tenant_id } : {}),
    ...(typeof source.role === 'string' ? { role: source.role as AppRole } : {}),
    ...(typeof source.device_id === 'string' ? { device_id: source.device_id } : {}),
  }
}
