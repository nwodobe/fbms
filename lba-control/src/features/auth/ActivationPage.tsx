import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { describeDiagnosis, diagnoseActivation, readTokenClaims } from '@/domain/activation'
import { useSession } from '@/lib/auth/session'
import { AuthLayout } from './AuthLayout'
import { useOwnAccount } from './api'

/**
 * Écran de diagnostic : pourquoi ce compte connecté ne voit rien.
 *
 * Il existe parce que l'échec le plus probable d'une première installation est
 * aussi le plus muet. Le déclencheur « Customize Access Token » s'active en
 * deux clics dans le tableau de bord Supabase, et tant qu'il ne l'est pas,
 * AUCUN jeton ne porte d'entreprise : chaque écran est vide, chaque liste est
 * vide, et rien n'indique que la cause est unique et située ailleurs.
 *
 * Le diagnostic n'est pas une devinette. La règle est dans
 * `src/domain/activation.ts` et testée à part : si la base dit « ce compte
 * appartient à l'entreprise X et il est actif » pendant que le jeton ne porte
 * aucune entreprise, c'est que rien ne recopie l'une dans l'autre.
 */
export function ActivationPage() {
  const navigate = useNavigate()
  const { session, user, tenantId, role, signOut } = useSession()
  const account = useOwnAccount(user?.id ?? null)

  if (!session) {
    navigate('/connexion', { replace: true })
    return null
  }

  if (account.isLoading) {
    return (
      <AuthLayout>
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground" role="status">
            Vérification de votre compte…
          </CardContent>
        </Card>
      </AuthLayout>
    )
  }

  const diagnosis = diagnoseActivation({
    claims: { tenantId, role },
    // Une erreur de lecture n'est pas une absence de ligne : la traiter comme
    // telle afficherait « compte non rattaché » à quelqu'un dont le compte va
    // parfaitement bien, sur une simple coupure réseau.
    account: account.isError ? null : (account.data ?? null),
  })

  const message = describeDiagnosis(diagnosis)

  // Ce que porte le jeton RÉELLEMENT signé, et non ce que la bibliothèque
  // cliente en rapporte. C'est la seule observation qui tranche entre « le
  // déclencheur n'est pas activé » et « la session date d'avant le rattachement ».
  const jeton = readTokenClaims(session.access_token)

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>{message.title}</CardTitle>
          <CardDescription>{message.body}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {message.action && message.audience === 'exploitant' && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-sm"
            >
              <p className="font-medium">À faire par l’exploitant du projet&nbsp;:</p>
              <p className="font-mono text-xs leading-relaxed">{message.action}</p>
            </div>
          )}

          {diagnosis.kind === 'unattached' && (
            <Button className="w-full" onClick={() => navigate('/invitation')}>
              Saisir un code d’invitation
            </Button>
          )}

          {diagnosis.kind === 'platform_admin' && (
            <Button className="w-full" onClick={() => navigate('/plateforme')}>
              Ouvrir la console plateforme
            </Button>
          )}

          {account.isError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              L’état de votre compte n’a pas pu être lu. Vérifiez votre connexion, puis rechargez.
            </p>
          )}

          <details className="rounded-md border px-3 py-2 text-sm" data-testid="detail-jeton">
            <summary className="cursor-pointer text-muted-foreground">
              Ce que porte votre jeton d’accès
            </summary>
            <dl className="mt-2 space-y-1 font-mono text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">entreprise</dt>
                <dd>{jeton?.claims.tenantId ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">rôle</dt>
                <dd>{jeton?.claims.role ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">selon la base</dt>
                <dd>
                  {account.data
                    ? `${account.data.role ?? '—'} · ${account.data.status}`
                    : 'aucune ligne'}
                </dd>
              </div>
            </dl>
            {jeton && !jeton.carriesMetadata && (
              <p className="mt-2 text-muted-foreground">
                Un jeton vide de ces deux valeurs signifie que rien ne les y écrit : soit le
                déclencheur n’est pas activé, soit votre compte n’est rattaché à rien.
              </p>
            )}
          </details>

          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => {
              void signOut().then(() => navigate('/connexion', { replace: true }))
            }}
          >
            Se déconnecter
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
