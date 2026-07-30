import { LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth/session'
import { useBranding } from '@/lib/tenant/branding'
import type { AppRole } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  /** Rôles auxquels l'entrée est proposée. Le contrôle réel reste RLS. */
  roles: AppRole[]
  /** Phase à laquelle l'écran devient réellement disponible. */
  phase: number
}

const ALL_STAFF: AppRole[] = [
  'proprietaire',
  'gestionnaire',
  'comptable',
  'responsable_terrain',
  'auditeur',
]

/** Menu du MVP, repris de la cartographie des écrans (DMQ §2.1). */
const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Pilotage',
    items: [
      { to: '/', label: 'Tableau de bord', roles: [...ALL_STAFF, 'pisteur'], phase: 6 },
      { to: '/alertes', label: 'Alertes', roles: [...ALL_STAFF, 'pisteur'], phase: 5 },
    ],
  },
  {
    title: 'Partenaires',
    items: [
      { to: '/societes', label: 'Sociétés', roles: ALL_STAFF, phase: 2 },
      { to: '/contrats', label: 'Contrats et prix', roles: ALL_STAFF, phase: 2 },
      { to: '/financements', label: 'Financements', roles: ['proprietaire', 'gestionnaire', 'comptable', 'auditeur'], phase: 3 },
    ],
  },
  {
    title: 'Terrain',
    items: [
      { to: '/pisteurs', label: 'Pisteurs', roles: ALL_STAFF, phase: 3 },
      { to: '/avances', label: 'Avances', roles: [...ALL_STAFF, 'pisteur'], phase: 3 },
      { to: '/achats', label: 'Achats', roles: [...ALL_STAFF, 'pisteur'], phase: 3 },
      { to: '/sacs', label: 'Sacs', roles: [...ALL_STAFF, 'pisteur'], phase: 4 },
    ],
  },
  {
    title: 'Stocks et livraisons',
    items: [
      { to: '/stocks', label: 'Stocks', roles: [...ALL_STAFF, 'pisteur'], phase: 4 },
      { to: '/planning', label: 'Planning', roles: ALL_STAFF, phase: 4 },
      { to: '/transferts', label: 'Transferts', roles: ALL_STAFF, phase: 4 },
      { to: '/incidents', label: 'Incidents', roles: ALL_STAFF, phase: 4 },
    ],
  },
  {
    title: 'Rentabilité',
    items: [
      { to: '/depenses', label: 'Dépenses', roles: ['proprietaire', 'gestionnaire', 'comptable', 'auditeur'], phase: 5 },
      { to: '/tcb', label: 'TCB et marges', roles: ['proprietaire', 'comptable', 'auditeur'], phase: 5 },
      { to: '/scoring', label: 'Scoring', roles: ALL_STAFF, phase: 5 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/utilisateurs', label: 'Utilisateurs', roles: ['proprietaire', 'gestionnaire'], phase: 2 },
      { to: '/marque', label: 'Marque', roles: ['proprietaire', 'gestionnaire'], phase: 2 },
      { to: '/abonnement', label: 'Abonnement', roles: ['proprietaire', 'comptable'], phase: 6 },
      { to: '/audit', label: "Journal d'audit", roles: ['proprietaire', 'gestionnaire', 'comptable', 'auditeur'], phase: 1 },
    ],
  },
]

export function AppShell() {
  const { role, user, signOut } = useSession()
  const branding = useBranding()
  const [isMenuOpen, setMenuOpen] = useState(false)

  // Le menu ne montre que ce qui concerne le rôle. Un pisteur qui verrait
  // « TCB et marges » grisé apprendrait déjà quelque chose qu'il n'a pas à
  // savoir.
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => role !== null && item.roles.includes(role)),
  })).filter((section) => section.items.length > 0)

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <header className="flex items-center justify-between border-b bg-brand px-4 py-3 lg:hidden">
        <span className="font-semibold">{branding.commercialName}</span>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={isMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={isMenuOpen}
        >
          {isMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      <nav
        className={cn(
          'w-full shrink-0 border-r bg-card lg:block lg:w-64',
          isMenuOpen ? 'block' : 'hidden',
        )}
        aria-label="Navigation principale"
      >
        <div className="hidden items-center gap-3 border-b px-4 py-4 lg:flex">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold">
            {branding.commercialName.slice(0, 2).toUpperCase()}
          </div>
          <span className="truncate font-semibold">{branding.commercialName}</span>
        </div>

        <div className="space-y-4 p-3">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </p>
              <ul>
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'block rounded-md px-3 py-2 text-sm transition-colors',
                          isActive ? 'bg-brand font-medium' : 'hover:bg-muted',
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t p-3">
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            {user?.email ?? 'Utilisateur'} · {role ?? 'rôle inconnu'}
          </p>
          <Button variant="ghost" className="w-full justify-start" onClick={() => void signOut()}>
            <LogOut size={16} />
            Se déconnecter
          </Button>
        </div>
      </nav>

      <main className="flex-1 overflow-x-hidden p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
