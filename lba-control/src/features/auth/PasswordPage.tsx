import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { assessPassword, MIN_PASSWORD_LENGTH } from '@/domain/activation'
import { useSession } from '@/lib/auth/session'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'

/**
 * Écran de mot de passe — création initiale et réinitialisation.
 *
 * Trois situations aboutissent ici, et il serait faux d'en faire trois écrans :
 * c'est le même geste, avec le même contrôle de force, et les distinguer
 * multiplierait les endroits où la règle des douze caractères peut diverger.
 *
 *  1. **Création** — une personne invitée arrive avec son jeton. Elle crée un
 *     compte avec l'adresse invitée, puis revient accepter l'invitation.
 *  2. **Réinitialisation demandée** — depuis « Mot de passe oublié ». On envoie
 *     un lien ; on ne dit jamais si l'adresse existe.
 *  3. **Réinitialisation en cours** — le lien reçu a ouvert une session de
 *     récupération. `detectSessionInUrl` l'a déjà consommée, il ne reste qu'à
 *     définir le nouveau mot de passe.
 */
export function PasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session } = useSession()

  const invitationToken = params.get('jeton') ?? params.get('token')
  const isInvited = Boolean(invitationToken)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const assessment = assessPassword(password, confirmation)
  const showIssues = password.length > 0 && !assessment.accepted

  function guardConfiguration(): boolean {
    if (isSupabaseConfigured) return true
    setServerError(
      "La connexion au serveur n'est pas configurée. Renseignez VITE_SUPABASE_URL et " +
        'VITE_SUPABASE_PUBLISHABLE_KEY dans .env.local.',
    )
    return false
  }

  /** Cas 3 : une session de récupération est ouverte, on pose le mot de passe. */
  async function onUpdate(event: React.FormEvent) {
    event.preventDefault()
    setServerError(null)
    if (!assessment.accepted || !guardConfiguration()) return

    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setServerError(
        'Le mot de passe n’a pas pu être enregistré. Le lien de réinitialisation a peut-être expiré : ' +
          'demandez-en un nouveau.',
      )
      return
    }

    navigate(invitationToken ? `/invitation/${encodeURIComponent(invitationToken)}` : '/', {
      replace: true,
    })
  }

  /** Cas 1 : création du compte d'une personne invitée. */
  async function onSignUp(event: React.FormEvent) {
    event.preventDefault()
    setServerError(null)
    if (!assessment.accepted || !guardConfiguration()) return

    setBusy(true)
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)

    if (error) {
      setServerError(
        'Ce compte n’a pas pu être créé. Si vous en avez déjà un avec cette adresse, connectez-vous ' +
          'plutôt, puis rouvrez votre lien d’invitation.',
      )
      return
    }

    // Projet exigeant la confirmation par courriel : pas de session immédiate.
    // Le dire ici évite un écran vide dont personne ne comprend la cause.
    if (!data.session) {
      setNotice(
        'Compte créé. Confirmez votre adresse depuis le courriel que vous venez de recevoir, puis ' +
          'rouvrez votre lien d’invitation.',
      )
      return
    }

    navigate(invitationToken ? `/invitation/${encodeURIComponent(invitationToken)}` : '/', {
      replace: true,
    })
  }

  /** Cas 2 : demande d'un lien de réinitialisation. */
  async function onRequestReset(event: React.FormEvent) {
    event.preventDefault()
    setServerError(null)
    if (!guardConfiguration()) return

    setBusy(true)
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/mot-de-passe`,
    })
    setBusy(false)

    // Réponse identique que l'adresse existe ou non : distinguer les deux
    // permettrait d'énumérer les comptes d'un client.
    setNotice(
      'Si un compte existe pour cette adresse, un lien de réinitialisation vient d’être envoyé. ' +
        'Il est valable une heure.',
    )
  }

  const mode = session ? 'update' : isInvited ? 'signup' : 'reset'

  const titles = {
    update: { title: 'Nouveau mot de passe', description: 'Choisissez le mot de passe de votre compte.' },
    signup: {
      title: 'Créer mon mot de passe',
      description: 'Utilisez l’adresse à laquelle l’invitation a été envoyée.',
    },
    reset: {
      title: 'Mot de passe oublié',
      description: 'Nous vous enverrons un lien pour en choisir un nouveau.',
    },
  }[mode]

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>{titles.title}</CardTitle>
          <CardDescription>{titles.description}</CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={
              mode === 'update' ? onUpdate : mode === 'signup' ? onSignUp : onRequestReset
            }
            className="space-y-4"
            noValidate
          >
            {mode !== 'update' && (
              <div className="space-y-2">
                <Label htmlFor="email">Adresse électronique</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            )}

            {mode !== 'reset' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-describedby="password-rule"
                  />
                  <p id="password-rule" className="text-sm text-muted-foreground">
                    {MIN_PASSWORD_LENGTH} caractères minimum. Une phrase se retient mieux qu’une
                    suite de symboles.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmation">Confirmation</Label>
                  <Input
                    id="confirmation"
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </div>

                {showIssues && (
                  <ul role="alert" className="space-y-1 text-sm text-destructive">
                    {assessment.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {serverError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </p>
            )}

            {notice && (
              <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
                {notice}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={busy || (mode !== 'reset' && !assessment.accepted)}
            >
              {busy
                ? 'Envoi…'
                : mode === 'update'
                  ? 'Enregistrer'
                  : mode === 'signup'
                    ? 'Créer mon compte'
                    : 'Recevoir le lien'}
            </Button>

            <Button
              type="button"
              variant="link"
              className="w-full"
              onClick={() => navigate('/connexion')}
            >
              Revenir à la connexion
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
