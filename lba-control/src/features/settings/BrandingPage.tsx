import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { checkBrandColors } from '@/domain/contrast'
import { brandingSchema, type BrandingInput } from '@/domain/schemas'
import { useSession } from '@/lib/auth/session'
import { DEFAULT_BRANDING } from '@/lib/tenant/branding'
import { useSaveBranding, useTenantBranding } from './api'

/**
 * Écran H01 — marque de l'entreprise.
 *
 * Personnalisation encadrée : nom, logos, deux couleurs, coordonnées. Ni la
 * structure des écrans, ni la typographie, ni les règles métier ne sont
 * modifiables — c'est ce qui permet de maintenir un produit standard plutôt
 * qu'une application différente par client (CDC §26.2).
 *
 * Le contraste est mesuré en direct pendant la saisie, puis revérifié par la
 * base au moment de l'enregistrement.
 */
export function BrandingPage() {
  const { tenantId } = useSession()
  const { data, isLoading } = useTenantBranding(tenantId)
  const save = useSaveBranding(tenantId)
  const [saved, setSaved] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<BrandingInput>({
    resolver: zodResolver(brandingSchema),
    defaultValues: {
      commercialName: '',
      legalName: '',
      slogan: '',
      primaryColor: DEFAULT_BRANDING.primaryColor,
      secondaryColor: DEFAULT_BRANDING.secondaryColor,
      phone: '',
      email: '',
      address: '',
      taxId: '',
      documentFooter: '',
    },
  })

  useEffect(() => {
    if (!data) return
    reset({
      commercialName: data.commercial_name ?? '',
      legalName: data.legal_name ?? '',
      slogan: data.slogan ?? '',
      primaryColor: data.primary_color,
      secondaryColor: data.secondary_color,
      phone: data.phone ?? '',
      email: data.email ?? '',
      address: data.address ?? '',
      taxId: data.tax_id ?? '',
      documentFooter: data.document_footer ?? '',
    })
  }, [data, reset])

  const primaryColor = watch('primaryColor')
  const secondaryColor = watch('secondaryColor')

  // Mesure en direct : l'utilisateur voit le rapport de contraste pendant qu'il
  // choisit, plutôt que de découvrir un refus au moment d'enregistrer.
  const verdict = useMemo(() => {
    try {
      return checkBrandColors(primaryColor, secondaryColor)
    } catch {
      return null
    }
  }, [primaryColor, secondaryColor])

  async function onSubmit(values: BrandingInput) {
    setSaved(false)
    await save.mutateAsync(values)
    setSaved(true)
  }

  function restoreDefaultTheme() {
    setValue('primaryColor', DEFAULT_BRANDING.primaryColor, { shouldDirty: true, shouldValidate: true })
    setValue('secondaryColor', DEFAULT_BRANDING.secondaryColor, { shouldDirty: true, shouldValidate: true })
  }

  if (isLoading) {
    return (
      <p role="status" className="text-muted-foreground">
        Chargement de la marque…
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Marque de l’entreprise</h1>
        <p className="text-muted-foreground">
          Nom, logos et deux couleurs. Ces éléments s’appliquent à la connexion, au menu, au tableau de
          bord, aux rapports PDF, aux bons de transfert, aux bons d’avance, aux exports et aux reçus.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="commercialName" label="Nom commercial" required error={errors.commercialName?.message}>
              <Input id="commercialName" {...register('commercialName')} aria-invalid={Boolean(errors.commercialName)} />
            </Field>

            <Field id="legalName" label="Raison sociale" error={errors.legalName?.message}>
              <Input id="legalName" {...register('legalName')} />
            </Field>

            <Field id="slogan" label="Slogan" className="sm:col-span-2" error={errors.slogan?.message}>
              <Input id="slogan" {...register('slogan')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Couleurs</CardTitle>
            <CardDescription>
              Deux couleurs, à des emplacements fixes. La lisibilité est vérifiée automatiquement : une
              couleur illisible est refusée avec sa mesure, côté formulaire et côté serveur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="primaryColor"
                label="Couleur principale"
                required
                hint="Code hexadécimal, par exemple #1f6f43"
                error={errors.primaryColor?.message}
              >
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Sélecteur de couleur principale"
                    value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#1f6f43'}
                    onChange={(event) =>
                      setValue('primaryColor', event.target.value, { shouldDirty: true, shouldValidate: true })
                    }
                    className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background"
                  />
                  <Input id="primaryColor" {...register('primaryColor')} aria-invalid={Boolean(errors.primaryColor)} />
                </div>
              </Field>

              <Field
                id="secondaryColor"
                label="Couleur secondaire"
                required
                hint="Code hexadécimal, par exemple #8a3d00"
                error={errors.secondaryColor?.message}
              >
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Sélecteur de couleur secondaire"
                    value={/^#[0-9a-fA-F]{6}$/.test(secondaryColor) ? secondaryColor : '#8a3d00'}
                    onChange={(event) =>
                      setValue('secondaryColor', event.target.value, { shouldDirty: true, shouldValidate: true })
                    }
                    className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background"
                  />
                  <Input id="secondaryColor" {...register('secondaryColor')} aria-invalid={Boolean(errors.secondaryColor)} />
                </div>
              </Field>
            </div>

            {verdict && (
              <div
                data-testid="contrast-report"
                className={`rounded-md border px-3 py-2 text-sm ${
                  verdict.accepted
                    ? 'border-status-ok/40 bg-status-ok/10'
                    : 'border-status-critical/40 bg-status-critical/10'
                }`}
              >
                <p className="font-medium">
                  {verdict.accepted
                    ? 'Couleurs lisibles'
                    : 'Ces couleurs ne peuvent pas être enregistrées'}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Principale : {verdict.primary.ratio.toFixed(2)}:1 avec le texte,{' '}
                  {verdict.primary.contrastWithSurface.toFixed(2)}:1 avec le fond · Secondaire :{' '}
                  {verdict.secondary.ratio.toFixed(2)}:1 avec le texte,{' '}
                  {verdict.secondary.contrastWithSurface.toFixed(2)}:1 avec le fond
                </p>
                {!verdict.accepted && (
                  <ul className="mt-2 list-inside list-disc space-y-1">
                    {verdict.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Prévisualisation : contrôle de lisibilité avant validation (DMQ E18). */}
            <div className="rounded-md border p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Prévisualisation
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="rounded-md px-4 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: verdict ? primaryColor : undefined,
                    color: verdict?.primary.recommendedForeground,
                  }}
                >
                  {watch('commercialName') || 'Nom de l’entreprise'}
                </span>
                <span
                  className="rounded-md px-4 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: verdict ? secondaryColor : undefined,
                    color: verdict?.secondary.recommendedForeground,
                  }}
                >
                  Action secondaire
                </span>
              </div>
            </div>

            <Button type="button" variant="outline" onClick={restoreDefaultTheme}>
              Revenir au thème standard
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coordonnées et mentions</CardTitle>
            <CardDescription>Reprises en pied des documents PDF, bons et reçus.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="phone" label="Téléphone" error={errors.phone?.message}>
              <Input id="phone" {...register('phone')} />
            </Field>
            <Field id="email" label="Email" error={errors.email?.message}>
              <Input id="email" type="email" {...register('email')} aria-invalid={Boolean(errors.email)} />
            </Field>
            <Field id="taxId" label="Identifiant fiscal" error={errors.taxId?.message}>
              <Input id="taxId" {...register('taxId')} />
            </Field>
            <Field id="address" label="Adresse" error={errors.address?.message}>
              <Input id="address" {...register('address')} />
            </Field>
            <Field
              id="documentFooter"
              label="Pied de page des documents"
              className="sm:col-span-2"
              error={errors.documentFooter?.message}
            >
              <Textarea id="documentFooter" {...register('documentFooter')} />
            </Field>
          </CardContent>
        </Card>

        {save.error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {save.error.message}
          </p>
        )}
        {saved && !isDirty && (
          <p role="status" className="rounded-md bg-status-ok/10 px-3 py-2 text-sm">
            Marque enregistrée. Elle s’applique immédiatement aux écrans et aux documents.
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting || save.isPending}>
            {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => reset()} disabled={!isDirty}>
            Annuler les modifications
          </Button>
        </div>
      </form>
    </div>
  )
}
