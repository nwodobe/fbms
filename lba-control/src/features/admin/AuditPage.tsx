import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AUDIT_PAGE_SIZE, useAuditTrail, useTenantUsers, type AuditFilters } from './api'

const ACTION_LABELS: Record<string, string> = {
  login: 'Connexion',
  create: 'Création',
  update: 'Modification',
  cancel: 'Annulation',
  validate: 'Validation',
  partner_change: 'Changement de société',
  weight_change: 'Changement de poids',
  price_change: 'Changement de prix',
  amount_change: 'Changement de montant',
  status_change: 'Changement de statut',
  payment_confirm: 'Confirmation de paiement',
  suspend: 'Suspension',
  reactivate: 'Réactivation',
  sensitive_export: 'Export sensible',
}

/** Actions qui méritent d'être remarquées dans une liste longue. */
const NOTABLE = new Set([
  'cancel',
  'suspend',
  'price_change',
  'weight_change',
  'amount_change',
  'sensitive_export',
])

const SELECT_CLASS = 'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

/**
 * Écran A02 — journal d'audit.
 *
 * Annoncé depuis la phase 1, construit ici. Le journal existait, alimenté par
 * cinquante-cinq déclencheurs ; il n'était lisible qu'avec un outil technique.
 *
 * Deux partis pris :
 *
 *  · **on cherche, on ne parcourt pas.** Le journal compte des centaines
 *    d'entrées dès la première campagne. Les filtres sont donc en tête et la
 *    pagination est imposée par le serveur, pas suggérée ici.
 *
 *  · **le motif est une colonne, pas un détail.** C'est la seule chose qui
 *    distingue une annulation légitime d'un effacement déguisé, et c'est
 *    précisément ce qu'un contrôleur vient lire.
 */
export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({
    action: null,
    table: null,
    userId: null,
    page: 0,
  })

  const { data, isLoading, error } = useAuditTrail(filters)
  const { data: users } = useTenantUsers()

  const total = Number(data?.total ?? 0)
  const entries = data?.entries ?? []
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE))

  function update(patch: Partial<AuditFilters>) {
    // Tout changement de filtre ramène à la première page : rester en page 7
    // d'un résultat qui n'en compte plus que 2 donne un écran vide et faux.
    setFilters({ ...filters, ...patch, page: 0 })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Journal d’audit</h1>
        <p className="text-muted-foreground">
          Qui a fait quoi, quand, et pourquoi. Le journal est immuable : personne ne peut le
          modifier, y compris depuis cet écran.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
          <CardDescription>
            Le journal compte des centaines d’entrées dès la première campagne. On y cherche quelque
            chose de précis plutôt que de le parcourir.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field id="filter-action" label="Action">
            <select
              id="filter-action"
              className={SELECT_CLASS}
              value={filters.action ?? ''}
              onChange={(event) => update({ action: event.target.value || null })}
            >
              <option value="">Toutes les actions</option>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field id="filter-table" label="Objet">
            <select
              id="filter-table"
              className={SELECT_CLASS}
              value={filters.table ?? ''}
              onChange={(event) => update({ table: event.target.value || null })}
            >
              <option value="">Tous les objets</option>
              {['purchases', 'advances', 'transfers', 'expenses', 'negotiated_prices', 'users'].map(
                (table) => (
                  <option key={table} value={table}>
                    {table}
                  </option>
                ),
              )}
            </select>
          </Field>

          <Field id="filter-user" label="Auteur">
            <select
              id="filter-user"
              className={SELECT_CLASS}
              value={filters.userId ?? ''}
              onChange={(event) => update({ userId: event.target.value || null })}
            >
              <option value="">Tout le monde</option>
              {(users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Entrées</CardTitle>
            <CardDescription data-testid="audit-total">
              {total === 0
                ? 'Aucune entrée sur ce filtre.'
                : `${total} entrée(s) · page ${filters.page + 1} sur ${pages}`}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page === 0}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              Précédente
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page + 1 >= pages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              Suivante
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground">Aucune entrée ne correspond à ce filtre.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Auteur</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Objet</TableHead>
                  <TableHead>Motif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {entry.occurred_at.slice(0, 19).replace('T', ' ')}
                    </TableCell>
                    <TableCell>
                      {entry.user_name ?? <span className="text-muted-foreground">système</span>}
                      {entry.user_role && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          · {entry.user_role.replace(/_/g, ' ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={NOTABLE.has(entry.action) ? 'warn' : 'neutral'}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.table_name}
                      {entry.changed_fields && entry.changed_fields.length > 0 && (
                        <span className="block">{entry.changed_fields.join(', ')}</span>
                      )}
                    </TableCell>
                    {/* Le motif distingue une annulation légitime d'un
                        effacement déguisé : c'est ce qu'un contrôleur vient lire. */}
                    <TableCell className="max-w-xs text-sm">
                      {entry.justification ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
