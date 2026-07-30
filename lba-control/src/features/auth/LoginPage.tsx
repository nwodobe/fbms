import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useBranding } from '@/lib/tenant/branding'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

/**
 * Écran E01 — connexion et identité client.
 *
 * Trois points non négociables (DMQ E01) :
 *  · la marque du tenant s'affiche ici, avant toute authentification ;
 *  · la liste des autres clients n'est JAMAIS exposée — le tenant se résout par
 *    l'URL ou par un code entreprise saisi, jamais par une liste déroulante ;
 *  · l'état hors ligne et l'état de l'abonnement sont visibles.
 */
const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Renseignez votre email ou votre numéro de téléphone.')
    .refine(
      (value) => value.includes('@') || /^[+0-9\s]{8,}$/.test(value),
      'Saisissez un email valide ou un numéro de téléphone.',
    ),
  password: z.string().min(1, 'Renseignez votre mot de passe.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const branding = useBranding()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  })

  async function onSubmit(values: LoginValues) {
    setServerError(null)

    if (!isSupabaseConfigured) {
      setServerError(
        "La connexion au serveur n'est pas configurée. Renseignez VITE_SUPABASE_URL et " +
          'VITE_SUPABASE_PUBLISHABLE_KEY dans .env.local.',
      )
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: values.identifier,
      password: values.password,
    })

    if (error) {
      // Message volontairement non discriminant : préciser « cet email n'existe
      // pas » permettrait d'énumérer les comptes du client.
      setServerError('Identifiants incorrects, ou compte suspendu. Vérifiez vos informations.')
      return
    }

    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          {branding.logoPath ? (
            <img src={branding.logoPath} alt={branding.commercialName} className="h-14 w-auto" />
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
            Vous êtes hors connexion. La connexion initiale nécessite un réseau ; vos saisies
            enregistrées restent conservées sur cet appareil.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Connexion</CardTitle>
            <CardDescription>Accédez à l’espace de votre entreprise.</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="identifier">Email ou téléphone</Label>
                <Input
                  id="identifier"
                  autoComplete="username"
                  inputMode="email"
                  aria-invalid={Boolean(errors.identifier)}
                  aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                  {...register('identifier')}
                />
                {errors.identifier && (
                  <p id="identifier-error" role="alert" className="text-sm text-destructive">
                    {errors.identifier.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
                {errors.password && (
                  <p id="password-error" role="alert" className="text-sm text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {serverError && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Connexion…' : 'Se connecter'}
              </Button>

              <Button type="button" variant="link" className="w-full">
                Mot de passe oublié
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {branding.documentFooter ?? 'LBA Control — accès réservé aux utilisateurs autorisés.'}
        </p>
      </div>
    </div>
  )
}
