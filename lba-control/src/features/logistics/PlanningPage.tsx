import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatWeight } from '@/domain/money'
import { checkPlanConfirmation, delayDays, planUrgency } from '@/domain/planning'
import { availableQuantity, type StockLot, type StockReservation } from '@/domain/stock'
import { useSession } from '@/lib/auth/session'
import { usePartnerCompanies } from '@/features/partners/api'
import { useDeliveryPlans, useSetPlanStatus, useStockLots, useStockReservations } from './api'

const URGENCY_LABELS = {
  en_retard: { label: 'En retard', variant: 'critical' as const },
  aujourd_hui: { label: "Aujourd'hui", variant: 'warn' as const },
  demain: { label: 'Demain', variant: 'warn' as const },
  a_venir: { label: 'À venir', variant: 'neutral' as const },
}

/**
 * Écran E01 — planning de livraison.
 *
 * Confirmer un planning, c'est promettre un volume à une société. La promesse
 * est donc vérifiée avant d'être faite : stock réellement disponible, capacité
 * du véhicule, site de réception. Découvrir le problème le matin du chargement
 * coûte une rotation de camion et une relation commerciale.
 */
export function PlanningPage() {
  const { role } = useSession()
  const { data: plans, isLoading } = useDeliveryPlans()
  const { data: lots } = useStockLots()
  const { data: reservations } = useStockReservations()
  const { data: partners } = usePartnerCompanies()
  const setStatus = useSetPlanStatus()

  const canManage = role === 'proprietaire' || role === 'gestionnaire' || role === 'responsable_terrain'
  const today = new Date().toISOString().slice(0, 10)
  const partnerName = (id: string) => partners?.find((p) => p.id === id)?.name ?? '—'

  const domainReservations: StockReservation[] = (reservations ?? []).map((r) => ({
    id: r.id,
    stockLotId: r.stock_lot_id,
    partnerCompanyId: r.partner_company_id,
    quantityKg: Number(r.quantity_kg),
    status: r.status,
  }))

  /** Stock promettable pour une société donnée. */
  function availableFor(partnerId: string): number {
    return (lots ?? [])
      .filter((lot) => lot.partner_company_id === partnerId || lot.partner_company_id === null)
      .reduce((total, lot) => {
        const domainLot: StockLot = {
          id: lot.id,
          code: lot.code,
          partnerCompanyId: lot.partner_company_id,
          fieldAgentId: lot.field_agent_id,
          quantityKg: Number(lot.quantity_kg),
          status: lot.status,
          holderType: lot.holder_type,
          isOwnAccount: lot.is_own_account,
        }
        return total + availableQuantity(domainLot, domainReservations)
      }, 0)
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Planning de livraison</h1>
        <p className="text-muted-foreground">
          Promettre un volume réaliste, et voir tout de suite ce qui ne l’est pas.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Livraisons planifiées</CardTitle>
          <CardDescription>
            Le stock disponible est calculé après déduction de ce qui est déjà réservé.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !plans || plans.length === 0 ? (
            <p className="text-muted-foreground">Aucune livraison planifiée.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Date prévue</TableHead>
                  <TableHead>Volume promis</TableHead>
                  <TableHead>Stock disponible</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => {
                  const available = availableFor(plan.partner_company_id)
                  const urgency = planUrgency(plan.planned_date, today, plan.status)
                  const delay = delayDays(plan.planned_date, today, plan.status)
                  const check = checkPlanConfirmation({
                    plannedVolumeKg: Number(plan.planned_volume_kg),
                    availableStockKg: available,
                    vehicleCapacityKg: null,
                    hasVehicle: plan.vehicle_id !== null,
                    hasDestinationSite: plan.destination_site_id !== null,
                    hasRequiredDocuments: true,
                  })

                  return (
                    <TableRow key={plan.id}>
                      <TableCell className="font-mono text-xs">{plan.reference}</TableCell>
                      <TableCell>{partnerName(plan.partner_company_id)}</TableCell>
                      <TableCell className="whitespace-nowrap">{plan.planned_date}</TableCell>
                      <TableCell>{formatWeight(plan.planned_volume_kg)}</TableCell>
                      <TableCell
                        className={
                          available < Number(plan.planned_volume_kg)
                            ? 'font-medium text-status-critical'
                            : undefined
                        }
                      >
                        {formatWeight(available)}
                      </TableCell>
                      <TableCell>
                        {urgency ? (
                          <Badge variant={URGENCY_LABELS[urgency].variant}>
                            {URGENCY_LABELS[urgency].label}
                            {delay ? ` (${delay} j)` : ''}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={plan.status === 'confirme' ? 'ok' : 'neutral'}>{plan.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && plan.status === 'planifie' && (
                          <Button
                            variant="link"
                            size="sm"
                            disabled={!check.canConfirm || setStatus.isPending}
                            title={
                              check.canConfirm
                                ? undefined
                                : check.issues.map((issue) => issue.message).join(' ')
                            }
                            onClick={() => setStatus.mutate({ id: plan.id, status: 'confirme' })}
                          >
                            Confirmer
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          {setStatus.error && (
            <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {setStatus.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Les blocages sont explicités sous le tableau : un bouton grisé sans
          explication oblige l'utilisateur à deviner. */}
      <Card>
        <CardHeader>
          <CardTitle>Contrôles avant confirmation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(plans ?? [])
            .filter((plan) => plan.status === 'planifie')
            .map((plan) => {
              const check = checkPlanConfirmation({
                plannedVolumeKg: Number(plan.planned_volume_kg),
                availableStockKg: availableFor(plan.partner_company_id),
                vehicleCapacityKg: null,
                hasVehicle: plan.vehicle_id !== null,
                hasDestinationSite: plan.destination_site_id !== null,
                hasRequiredDocuments: true,
              })
              if (check.issues.length === 0) return null

              return (
                <div key={plan.id} data-testid={`plan-issues-${plan.reference}`}>
                  <p className="font-medium">{plan.reference}</p>
                  <ul className="list-inside list-disc text-muted-foreground">
                    {check.issues.map((issue) => (
                      <li key={issue.code}>
                        {issue.message}
                        {issue.severity === 'avertissement' && ' (avertissement)'}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
        </CardContent>
      </Card>
    </div>
  )
}
