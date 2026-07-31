import { Component, Suspense, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Enveloppe des écrans chargés à la demande.
 *
 * Deux problèmes que le découpage du bundle crée, et que ce composant règle :
 *
 *  1. **L'attente ne doit pas emporter la navigation.** Placée autour de
 *     l'ensemble des routes, l'attente ferait disparaître le menu pendant le
 *     chargement — sur un réseau lent, l'utilisateur se retrouverait devant un
 *     écran nu, sans même le moyen d'aller ailleurs. Elle est donc posée autour
 *     du seul contenu.
 *
 *  2. **Un morceau qui ne se charge pas doit se voir.** Un pisteur qui perd le
 *     réseau avant d'avoir ouvert un écran obtiendrait sinon une page blanche
 *     définitive, sans rien à quoi se raccrocher. Ici, il lit ce qui s'est
 *     passé et peut réessayer une fois le réseau revenu.
 */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div className="mx-auto max-w-md space-y-3 py-12 text-center" role="alert">
        <p className="font-medium">Cet écran n’a pas pu être chargé.</p>
        <p className="text-sm text-muted-foreground">
          Il manque une partie de l’application, en général parce que la connexion a été interrompue
          avant qu’elle n’ait été téléchargée. Vos saisies déjà enregistrées sur l’appareil ne sont
          pas affectées.
        </p>
        <Button onClick={() => this.setState({ failed: false })}>Réessayer</Button>
      </div>
    )
  }
}

function ScreenFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground" role="status">
      Chargement de l’écran…
    </div>
  )
}

export function LazyScreen({ children }: { children: ReactNode }) {
  return (
    <ScreenErrorBoundary>
      <Suspense fallback={<ScreenFallback />}>{children}</Suspense>
    </ScreenErrorBoundary>
  )
}
