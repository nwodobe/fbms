import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from '@/lib/auth/session'
import { AuthLayout } from './AuthLayout'
import { useAcceptInvitation, useInvitationPreview } from './api'

/**
 * Écran d'acceptation d'invitation.
 *
 * Le point délicat est l'ORDRE des étapes. Accepter exige d'être authentifié —
 * c'est ce qui lie le compte créé à la personne invitée, et non au premier venu
 * qui lit le lien dans une boîte mail transférée. Une personne invitée arrive
 * donc ici sans compte, et il faut l'envoyer d'abord en créer un, sans lui faire
 * perdre son jeton en route.
 *
 * D'où le jeton conservé dans l'URL et repassé à l'écran de mot de passe : le
 * parcours revient ici de lui-même, et la personne n'a rien à recopier.
 */
export function InvitationPage() {
  const { jeton } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session, isLoading } = useSession()

  // Le jeton vient du lien ; la saisie manuelle sert quand le lien a été
  // tronqué par un client de messagerie, ce qui arrive plus souvent qu'on ne
  // le croit.
  const [manualToken, setManualToken] = useState('')
  const token = jeton ?? params.get('jeton') ?? params.get('token') ?? manualToken.trim()
  const hasToken = token.length > 0

  const preview = useInvitationPreview(hasToken ? token : null)
  const accept = useAcceptInvitation()

  const invitation = preview.data

  async function onAccept() {
    await accept.mutateAsync(token)
    navigate('/', { replace: true })
  }

  if (isLoading) {
    return (
      <AuthLayout>
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground" role="status">
            Chargement…
          </CardContent>
        </Card>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
          <CardDescription>
            Rejoignez l’entreprise qui vous a invité, avec le rôle qu’elle vous a attribué.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!hasToken && (
            <div className="space-y-2">
              <Label htmlFor="jeton">Code d’invitation</Label>
              <Input
                id="jeton"
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="Collez ici le code reçu"
                autoComplete="off"
              />
              <p className="text-sm text-muted-foreground">
                C’est la dernière partie du lien reçu, après <code>/invitation/</code>.
              </p>
            </div>
          )}

          {preview.isLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              Vérification du code…
            </p>
          )}

          {preview.isError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Ce code n’a pas pu être vérifié. Vérifiez votre connexion, puis réessayez.
            </p>
          )}

          {invitation && !invitation.found && (
            // Un message identique pour « inexistant » et « déjà utilisé » :
            // les distinguer permettrait de tester des codes au hasard et de
            // savoir lesquels ont existé.
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Ce code ne correspond à aucune invitation en cours. Demandez-en une nouvelle à
              l’entreprise qui vous a invité.
            </p>
          )}

          {invitation?.found && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Entreprise&nbsp;: </span>
                  <strong>{invitation.commercial_name}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Rôle proposé&nbsp;: </span>
                  <strong>{invitation.role}</strong>
                </p>
                {invitation.full_name && (
                  <p>
                    <span className="text-muted-foreground">Au nom de&nbsp;: </span>
                    {invitation.full_name}
                  </p>
                )}
              </div>

              {invitation.expired && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Cette invitation a expiré. Demandez-en une nouvelle : les invitations sont
                  volontairement limitées dans le temps.
                </p>
              )}

              {!invitation.expired && invitation.status !== 'pending' && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Cette invitation n’est plus en attente. Elle a déjà été utilisée ou révoquée.
                </p>
              )}

              {!invitation.expired && invitation.status === 'pending' && !session && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Créez d’abord votre mot de passe. C’est ce qui rattache l’invitation à vous, et
                    non à quiconque lirait ce lien.
                  </p>
                  <Button
                    className="w-full"
                    onClick={() =>
                      navigate(`/mot-de-passe?jeton=${encodeURIComponent(token)}`, { replace: true })
                    }
                  >
                    Créer mon mot de passe
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full"
                    onClick={() => navigate(`/connexion?jeton=${encodeURIComponent(token)}`)}
                  >
                    J’ai déjà un mot de passe
                  </Button>
                </div>
              )}

              {!invitation.expired && invitation.status === 'pending' && session && (
                <div className="space-y-3">
                  {invitation.email_matches === false && (
                    <p
                      role="alert"
                      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      Cette invitation a été émise pour une autre adresse électronique que celle de
                      votre compte. Connectez-vous avec l’adresse invitée.
                    </p>
                  )}

                  {accept.isError && (
                    <p
                      role="alert"
                      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {accept.error instanceof Error ? accept.error.message : 'Acceptation refusée.'}
                    </p>
                  )}

                  <Button
                    className="w-full"
                    disabled={accept.isPending || invitation.email_matches === false}
                    onClick={() => void onAccept()}
                  >
                    {accept.isPending ? 'Acceptation…' : 'Rejoindre cette entreprise'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
