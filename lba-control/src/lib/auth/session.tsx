import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readAppMetadata, supabase, type AppRole } from '@/lib/supabase'

export interface SessionState {
  session: Session | null
  user: User | null
  tenantId: string | null
  role: AppRole | null
  isLoading: boolean
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setSession(data.session)
          setIsLoading(false)
        }
      })
      .catch(() => {
        // Une erreur de récupération de session ne doit pas laisser
        // l'application sur un écran de chargement infini : on retombe sur
        // « non connecté », qui est l'état sûr.
        if (active) setIsLoading(false)
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<SessionState>(() => {
    const metadata = readAppMetadata(session?.user?.app_metadata)
    return {
      session,
      user: session?.user ?? null,
      tenantId: metadata.tenant_id ?? null,
      role: metadata.role ?? null,
      isLoading,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }
  }, [session, isLoading])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession doit être utilisé à l’intérieur de <SessionProvider>.')
  }
  return context
}

/**
 * Vérification de rôle côté interface.
 *
 * Rappel : ceci sert uniquement à masquer ce qui n'est pas utile à
 * l'utilisateur. La protection réelle est la politique RLS correspondante en
 * base — masquer un bouton n'a jamais empêché personne d'appeler l'API.
 */
export function useHasRole(...roles: AppRole[]): boolean {
  const { role } = useSession()
  return role !== null && roles.includes(role)
}
