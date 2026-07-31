import type { ReactNode } from 'react'
import { useBranding } from '@/lib/tenant/branding'
import { useBrandingImage } from '@/lib/tenant/useBrandingImage'

/**
 * Cadre commun aux écrans qui précèdent l'entrée dans l'application :
 * connexion, mot de passe, invitation, diagnostic.
 *
 * Extrait de `LoginPage` quand ces écrans sont passés de un à quatre. Le
 * dupliquer aurait suffi à ce que la marque d'un client s'affiche sur trois
 * écrans et pas sur le quatrième — le genre d'incohérence que personne ne
 * remarque avant la démonstration.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const branding = useBranding()
  // Le bucket de marque est privé : un chemin de stockage n'est pas une adresse.
  // Avant la connexion, le tenant n'est de toute façon pas résolu.
  const logoUrl = useBrandingImage(branding.logoPath)
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          {logoUrl ? (
            <img src={logoUrl} alt={branding.commercialName} className="h-14 w-auto" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand text-xl font-bold">
              {branding.commercialName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold">{branding.commercialName}</h1>
            {branding.slogan && <p className="text-sm text-muted-foreground">{branding.slogan}</p>}
          </div>
        </div>

        {isOffline && (
          <div
            role="status"
            className="rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-sm"
          >
            Vous êtes hors connexion. Ces étapes exigent un réseau ; vos saisies enregistrées
            restent conservées sur cet appareil.
          </div>
        )}

        {children}

        <p className="text-center text-xs text-muted-foreground">
          {branding.documentFooter ?? 'LBA Control — accès réservé aux utilisateurs autorisés.'}
        </p>
      </div>
    </div>
  )
}
