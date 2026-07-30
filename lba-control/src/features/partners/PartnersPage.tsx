import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { partnerCompanySchema, type PartnerCompanyInput } from '@/domain/schemas'
import { useSession } from '@/lib/auth/session'
import { useCreatePartnerCompany, usePartnerCompanies, type PartnerCompany } from './api'

const STATUS_LABELS: Record<PartnerCompany['status'], { label: string; variant: 'ok' | 'warn' | 'neutral' }> = {
  active: { label: 'Active', variant: 'ok' },
  suspended: { label: 'Suspendue', variant: 'warn' },
  closed: { label: 'Clôturée', variant: 'neutral' },
}

/**
 * Écran B01 — sociétés partenaires.
 *
 * Un même LBA travaille simultanément avec plusieurs sociétés. Aucune ne voit
 * les données d'une autre, et la désactivation n'efface jamais rien.
 */
export function PartnersPage() {
  const { tenantId, role } = useSession()
  const { data: partners, isLoading, error } = usePartnerCompanies()
  const create = useCreatePartnerCompany(tenantId)
  const [isOpen, setOpen] = useState(false)

  const canManage = role === 'proprietaire' || role === 'gestionnaire'

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PartnerCompanyInput>({
    resolver: zodResolver(partnerCompanySchema),
    defaultValues: { code: '', name: '', contactName: '', phone: '', email: '', address: '' },
  })

  async function onSubmit(values: PartnerCompanyInput) {
    await create.mutateAsync(values)
    reset()
    setOpen(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sociétés partenaires</h1>
          <p className="text-muted-foreground">
            OLAM, DORADO et toute autre société, sans mélange de données ni de financements.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Ajouter une société
          </Button>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Liste</CardTitle>
          <CardDescription>
            Les tolérances définies ici servent de valeur par défaut : un contrat peut les surcharger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !partners || partners.length === 0 ? (
            <p className="text-muted-foreground">
              Aucune société partenaire enregistrée. Créez-en une pour pouvoir saisir des contrats et
              des financements.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Tolérance poids</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((partner) => {
                  // Repli explicite : un statut inconnu (valeur ajoutée côté
                  // serveur, ligne fraîchement créée) ne doit pas faire tomber
                  // toute la liste.
                  const status = STATUS_LABELS[partner.status] ?? {
                    label: partner.status ?? 'Inconnu',
                    variant: 'neutral' as const,
                  }
                  return (
                    <TableRow key={partner.id}>
                      <TableCell className="font-mono text-xs">{partner.code}</TableCell>
                      <TableCell className="font-medium">{partner.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {partner.contact_name ?? '—'}
                        {partner.phone ? ` · ${partner.phone}` : ''}
                      </TableCell>
                      <TableCell>
                        {partner.weight_tolerance_pct === null
                          ? 'Défaut entreprise'
                          : `${partner.weight_tolerance_pct} %`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="link" size="sm" asChild>
                          <Link to={`/societes/${partner.id}`}>Ouvrir</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle société partenaire</DialogTitle>
            <DialogDescription>
              Le code identifie la société dans les exports et les documents. Il ne pourra plus être
              réutilisé par une autre.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field id="code" label="Code" required hint="Majuscules, chiffres et tirets" error={errors.code?.message}>
              <Input id="code" {...register('code')} aria-invalid={Boolean(errors.code)} />
            </Field>

            <Field id="name" label="Nom" required error={errors.name?.message}>
              <Input id="name" {...register('name')} aria-invalid={Boolean(errors.name)} />
            </Field>

            <Field id="contactName" label="Personne de contact" error={errors.contactName?.message}>
              <Input id="contactName" {...register('contactName')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="phone" label="Téléphone" error={errors.phone?.message}>
                <Input id="phone" {...register('phone')} />
              </Field>
              <Field id="email" label="Email" error={errors.email?.message}>
                <Input id="email" type="email" {...register('email')} aria-invalid={Boolean(errors.email)} />
              </Field>
            </div>

            {create.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {create.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Création…' : 'Créer la société'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
