import { useState } from 'react'
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
import { formatWeight } from '@/domain/money'
import { availableQuantity, computeStockPosition, type StockLot, type StockReservation } from '@/domain/stock'
import { useSession } from '@/lib/auth/session'
import { usePartnerCompanies } from '@/features/partners/api'
import { useReserveStock, useStockLots, useStockReservations } from './api'

/**
 * Écran D03 — stocks et réservations.
 *
 * L'écran distingue explicitement la quantité d'un lot et sa quantité
 * *disponible*. Afficher la quantité brute comme « disponible » est exactement
 * ce qui produit les doubles réservations, découvertes le jour du chargement.
 */
export function StockPage() {
  const { role } = useSession()
  const { data: lots, isLoading } = useStockLots()
  const { data: reservations } = useStockReservations()
  const { data: partners } = usePartnerCompanies()
  const reserve = useReserveStock()

  const [target, setTarget] = useState<string | null>(null)
  const [quantity, setQuantity] = useState('')

  const canManage = role === 'proprietaire' || role === 'gestionnaire' || role === 'responsable_terrain'
  const partnerName = (id: string | null) =>
    id ? (partners?.find((p) => p.id === id)?.name ?? '—') : 'Compte propre'

  const domainLots: StockLot[] = (lots ?? []).map((lot) => ({
    id: lot.id,
    code: lot.code,
    partnerCompanyId: lot.partner_company_id,
    fieldAgentId: lot.field_agent_id,
    quantityKg: Number(lot.quantity_kg),
    status: lot.status,
    holderType: lot.holder_type,
    isOwnAccount: lot.is_own_account,
  }))

  const domainReservations: StockReservation[] = (reservations ?? []).map((r) => ({
    id: r.id,
    stockLotId: r.stock_lot_id,
    partnerCompanyId: r.partner_company_id,
    quantityKg: Number(r.quantity_kg),
    status: r.status,
  }))

  const position = computeStockPosition(domainLots, domainReservations)
  const selected = domainLots.find((lot) => lot.id === target) ?? null
  const selectedAvailable = selected ? availableQuantity(selected, domainReservations) : 0

  async function submitReservation(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return

    await reserve.mutateAsync({
      lotId: selected.id,
      planId: null,
      quantityKg: Number(quantity),
      partnerCompanyId: selected.partnerCompanyId ?? '',
    })
    setTarget(null)
    setQuantity('')
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Stocks et réservations</h1>
        <p className="text-muted-foreground">
          Chaque état reste séparé : ce qui est chez un pisteur n’est pas ce qui est promis à une
          société.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Chez les pisteurs', position.chezPisteur],
          ['En magasin', position.enMagasin],
          ['Disponible', position.disponible],
          ['Réservé', position.reserve],
          ['En transit', position.enTransit],
          ['Réceptionné', position.receptionne],
          ['Rejeté', position.rejete],
          ['En litige', position.enLitige],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-2">
              <CardDescription>{String(label)}</CardDescription>
              <CardTitle className="text-xl">{formatWeight(Number(value))}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lots</CardTitle>
          <CardDescription>
            La colonne « disponible » retire ce qui est déjà réservé. Une quantité réservée pour une
            société n’est plus promettable à une autre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : domainLots.length === 0 ? (
            <p className="text-muted-foreground">Aucun lot de stock enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Détenteur</TableHead>
                  <TableHead>Quantité</TableHead>
                  <TableHead>Disponible</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {domainLots.map((lot) => {
                  const available = availableQuantity(lot, domainReservations)
                  return (
                    <TableRow key={lot.id}>
                      <TableCell className="font-mono text-xs">{lot.code}</TableCell>
                      <TableCell>{partnerName(lot.partnerCompanyId)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {lot.holderType === 'field_agent'
                          ? 'Pisteur'
                          : lot.holderType === 'warehouse'
                            ? 'Magasin'
                            : lot.holderType === 'in_transit'
                              ? 'En transit'
                              : 'Site société'}
                      </TableCell>
                      <TableCell>{formatWeight(lot.quantityKg)}</TableCell>
                      <TableCell className={available === 0 ? 'text-muted-foreground' : 'font-medium'}>
                        {formatWeight(available)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            lot.status === 'disponible'
                              ? 'ok'
                              : lot.status === 'en_litige' || lot.status === 'bloque'
                                ? 'critical'
                                : 'neutral'
                          }
                        >
                          {lot.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && available > 0 && (
                          <Button variant="link" size="sm" onClick={() => setTarget(lot.id)}>
                            Réserver
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réserver du stock</DialogTitle>
            <DialogDescription>
              La réservation est transactionnelle : deux confirmations simultanées ne peuvent pas
              promettre la même matière.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <form onSubmit={submitReservation} className="space-y-4">
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                Lot <strong>{selected.code}</strong> — disponible :{' '}
                <strong data-testid="available-quantity">{formatWeight(selectedAvailable)}</strong>
              </p>

              <Field id="quantity" label="Quantité à réserver (kg)" required>
                <Input
                  id="quantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  max={selectedAvailable}
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>

              {Number(quantity) > selectedAvailable && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  La quantité demandée dépasse le stock disponible non réservé (
                  {formatWeight(selectedAvailable)}).
                </p>
              )}

              {reserve.error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {reserve.error.message}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={reserve.isPending || Number(quantity) > selectedAvailable || !quantity}
                >
                  {reserve.isPending ? 'Réservation…' : 'Réserver'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
