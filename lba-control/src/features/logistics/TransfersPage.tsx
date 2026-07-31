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
import { Textarea } from '@/components/ui/textarea'
import { ProofUpload } from '@/components/shared/ProofUpload'
import { formatWeight } from '@/domain/money'
import { checkWeightConsistency, computeVariances } from '@/domain/weights'
import { useSession } from '@/lib/auth/session'
import { usePartnerCompanies } from '@/features/partners/api'
import {
  useRecordReception,
  useSaveWeighingTicket,
  useTransfers,
  type ReceptionResult,
  type TransferRow,
} from './api'

const WEIGHT_SOURCE_LABELS: Record<TransferRow['weight_source'], string> = {
  verified: 'Pesé et vérifié',
  estimated_bags: 'Estimé aux sacs',
  declared: 'Déclaré',
}

/**
 * Écrans E02 et E03 — transferts, pesées et réception.
 *
 * Les quatre poids sont présentés côte à côte, jamais fusionnés. C'est ce qui
 * permet de distinguer une perte en route d'un refus qualité et d'un écart de
 * paiement — trois situations qui appellent trois réactions différentes.
 */
export function TransfersPage() {
  const { role } = useSession()
  const { data: transfers, isLoading } = useTransfers()
  const { data: partners } = usePartnerCompanies()
  const [receiving, setReceiving] = useState<TransferRow | null>(null)
  const [ticketing, setTicketing] = useState<TransferRow | null>(null)

  const canWriteWeights =
    role === 'proprietaire' || role === 'gestionnaire' || role === 'responsable_terrain'
  const partnerName = (id: string) => partners?.find((p) => p.id === id)?.name ?? '—'

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Transferts et pesées</h1>
        <p className="text-muted-foreground">
          Quatre poids distincts : chargé, déchargé, accepté, payé. Aucun n’en remplace un autre.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Transferts</CardTitle>
          <CardDescription>
            Les écarts sont calculés par la base à partir des poids : ils ne peuvent pas être saisis
            à la main ni diverger de leurs sources.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p role="status" className="text-muted-foreground">
              Chargement…
            </p>
          ) : !transfers || transfers.length === 0 ? (
            <p className="text-muted-foreground">Aucun transfert enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numéro</TableHead>
                  <TableHead>Société</TableHead>
                  <TableHead>Chargé</TableHead>
                  <TableHead>Déchargé</TableHead>
                  <TableHead>Accepté</TableHead>
                  <TableHead>Payé</TableHead>
                  <TableHead>Écart</TableHead>
                  <TableHead>Ticket départ</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => {
                  const pct = transfer.ecart_physique_pct
                  return (
                    <TableRow key={transfer.id}>
                      <TableCell className="font-mono text-xs">{transfer.transfer_number}</TableCell>
                      <TableCell>{partnerName(transfer.partner_company_id)}</TableCell>
                      <TableCell>{formatWeight(transfer.net_loaded_kg)}</TableCell>
                      <TableCell>{formatWeight(transfer.net_unloaded_kg)}</TableCell>
                      <TableCell>{formatWeight(transfer.accepted_kg)}</TableCell>
                      <TableCell>{formatWeight(transfer.paid_kg)}</TableCell>
                      <TableCell>
                        {pct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              Math.abs(Number(pct)) > 0.5 ? 'font-medium text-status-critical' : undefined
                            }
                          >
                            {Number(pct).toFixed(2)} %
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {transfer.weighing_ticket_path ? (
                          <Badge variant="ok">joint</Badge>
                        ) : canWriteWeights ? (
                          <Button variant="link" size="sm" onClick={() => setTicketing(transfer)}>
                            Joindre
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transfer.status === 'cloture' ? 'ok' : 'neutral'}>
                          {transfer.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canWriteWeights && transfer.net_unloaded_kg === null && (
                          <Button variant="link" size="sm" onClick={() => setReceiving(transfer)}>
                            Réceptionner
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

      {receiving && <ReceptionDialog transfer={receiving} onClose={() => setReceiving(null)} />}
      {ticketing && (
        <WeighingTicketDialog transfer={ticketing} onClose={() => setTicketing(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ticket de pesée du départ
// ---------------------------------------------------------------------------

/**
 * Le ticket du pont-bascule au départ.
 *
 * Il se joint après le départ du camion, et c'est délibéré : la règle serveur
 * refuse un poids déclaré « vérifié » sans ticket, mais elle ne doit pas
 * empêcher d'enregistrer un chargement dont le ticket est resté chez le peseur.
 * Le transfert existe alors avec un poids estimé, et l'alerte « parti sans
 * ticket » rappelle qu'il manque quelque chose.
 */
function WeighingTicketDialog({
  transfer,
  onClose,
}: {
  transfer: TransferRow
  onClose: () => void
}) {
  const save = useSaveWeighingTicket()
  const [queued, setQueued] = useState<string | null>(null)
  // Le transfert reçu en argument est un instantané de la liste : il ne se met
  // pas à jour tout seul après l'enregistrement du chemin.
  const [path, setPath] = useState<string | null>(transfer.weighing_ticket_path)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ticket de pesée — {transfer.transfer_number}</DialogTitle>
          <DialogDescription>
            Poids chargé : <strong>{formatWeight(transfer.net_loaded_kg)}</strong> (
            {WEIGHT_SOURCE_LABELS[transfer.weight_source]}). Sans ticket, un poids ne peut pas être
            déclaré vérifié.
          </DialogDescription>
        </DialogHeader>

        <ProofUpload
          kind="ticket_pesee"
          label="Ticket du pont-bascule (départ)"
          binding={{ table: 'transfers', column: 'weighing_ticket_path', rowId: transfer.id }}
          value={path}
          onChange={(next) => {
            setPath(next)
            save.mutate({ transferId: transfer.id, path: next })
          }}
          onQueued={setQueued}
        />

        {queued && (
          <p role="status" className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
            Le transfert reste sans ticket tant que le fichier n’est pas parti : le poids ne peut pas
            encore être déclaré vérifié.
          </p>
        )}

        {save.error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {save.error.message}
          </p>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Réception
// ---------------------------------------------------------------------------

function ReceptionDialog({ transfer, onClose }: { transfer: TransferRow; onClose: () => void }) {
  const record = useRecordReception()
  const [result, setResult] = useState<ReceptionResult | null>(null)
  const [ticketPath, setTicketPath] = useState<string | null>(
    transfer.reception_ticket_path ?? null,
  )
  const [ticketQueued, setTicketQueued] = useState<string | null>(null)
  const [form, setForm] = useState({
    netUnloadedKg: '',
    acceptedKg: '',
    paidKg: '',
    grossReceptionKg: '',
    tareReceptionKg: '',
    korReception: '',
    humidityReception: '',
    rejectionReason: '',
    receiverName: '',
  })

  const weights = {
    netLoadedKg: transfer.net_loaded_kg === null ? null : Number(transfer.net_loaded_kg),
    netUnloadedKg: form.netUnloadedKg ? Number(form.netUnloadedKg) : null,
    acceptedKg: form.acceptedKg ? Number(form.acceptedKg) : null,
    paidKg: form.paidKg ? Number(form.paidKg) : null,
  }

  const variances = computeVariances(weights)
  const consistency = checkWeightConsistency(weights)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const outcome = await record.mutateAsync({
      transferId: transfer.id,
      netUnloadedKg: Number(form.netUnloadedKg),
      acceptedKg: Number(form.acceptedKg),
      paidKg: form.paidKg ? Number(form.paidKg) : null,
      grossReceptionKg: form.grossReceptionKg ? Number(form.grossReceptionKg) : null,
      tareReceptionKg: form.tareReceptionKg ? Number(form.tareReceptionKg) : null,
      korReception: form.korReception ? Number(form.korReception) : null,
      humidityReception: form.humidityReception ? Number(form.humidityReception) : null,
      rejectionReason: form.rejectionReason || null,
      receiverName: form.receiverName || null,
      receptionTicketPath: ticketPath,
    })
    setResult(outcome)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Réception — {transfer.transfer_number}</DialogTitle>
          <DialogDescription>
            Poids chargé au départ : <strong>{formatWeight(transfer.net_loaded_kg)}</strong> (
            {WEIGHT_SOURCE_LABELS[transfer.weight_source]})
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div
              data-testid="variance-report"
              className={`space-y-2 rounded-md border px-3 py-3 text-sm ${
                result.exceeds_tolerance
                  ? 'border-status-critical/40 bg-status-critical/10'
                  : 'border-status-ok/40 bg-status-ok/10'
              }`}
            >
              <p className="font-medium">
                {result.exceeds_tolerance
                  ? 'Écart supérieur à la tolérance'
                  : 'Écart dans la tolérance'}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Écart physique</dt>
                <dd>
                  {formatWeight(result.ecart_physique_kg)} (
                  {result.ecart_physique_pct === null
                    ? '—'
                    : `${Number(result.ecart_physique_pct).toFixed(2)} %`}
                  )
                </dd>
                <dt className="text-muted-foreground">Écart d’acceptation</dt>
                <dd>{formatWeight(result.ecart_acceptation_kg)}</dd>
                <dt className="text-muted-foreground">Écart de paiement</dt>
                <dd>{formatWeight(result.ecart_paiement_kg)}</dd>
                <dt className="text-muted-foreground">Écart total d’acceptation</dt>
                <dd>{formatWeight(result.ecart_total_acceptation_kg)}</dd>
                <dt className="text-muted-foreground">Écart financier total</dt>
                <dd>{formatWeight(result.ecart_financier_total_kg)}</dd>
                <dt className="text-muted-foreground">Tolérance appliquée</dt>
                <dd>
                  {result.tolerance.value} % (source : {result.tolerance.source})
                </dd>
              </dl>
            </div>

            {result.incident_id && (
              <p className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                Un incident a été ouvert et la clôture du transfert est bloquée. Aucune responsabilité
                n’est imputée : humidité, étalonnage du pont-bascule, variation de tare, perte en
                transport et erreur de saisie doivent être examinés avant toute conclusion.
              </p>
            )}

            <DialogFooter>
              <Button onClick={onClose}>Fermer</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="grossReceptionKg" label="Poids brut réception (kg)">
                <Input
                  id="grossReceptionKg"
                  type="number"
                  step="0.001"
                  value={form.grossReceptionKg}
                  onChange={(e) => setForm({ ...form, grossReceptionKg: e.target.value })}
                />
              </Field>
              <Field id="tareReceptionKg" label="Tare réception (kg)">
                <Input
                  id="tareReceptionKg"
                  type="number"
                  step="0.001"
                  value={form.tareReceptionKg}
                  onChange={(e) => setForm({ ...form, tareReceptionKg: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="netUnloadedKg" label="Poids déchargé (kg)" required>
                <Input
                  id="netUnloadedKg"
                  type="number"
                  step="0.001"
                  required
                  value={form.netUnloadedKg}
                  onChange={(e) => setForm({ ...form, netUnloadedKg: e.target.value })}
                />
              </Field>
              <Field id="acceptedKg" label="Poids accepté (kg)" required>
                <Input
                  id="acceptedKg"
                  type="number"
                  step="0.001"
                  required
                  value={form.acceptedKg}
                  onChange={(e) => setForm({ ...form, acceptedKg: e.target.value })}
                />
              </Field>
              <Field id="paidKg" label="Poids payé (kg)">
                <Input
                  id="paidKg"
                  type="number"
                  step="0.001"
                  value={form.paidKg}
                  onChange={(e) => setForm({ ...form, paidKg: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="korReception" label="KOR réception">
                <Input
                  id="korReception"
                  type="number"
                  step="0.01"
                  value={form.korReception}
                  onChange={(e) => setForm({ ...form, korReception: e.target.value })}
                />
              </Field>
              <Field id="humidityReception" label="Humidité réception (%)">
                <Input
                  id="humidityReception"
                  type="number"
                  step="0.01"
                  value={form.humidityReception}
                  onChange={(e) => setForm({ ...form, humidityReception: e.target.value })}
                />
              </Field>
            </div>

            <Field id="receiverName" label="Réceptionnaire">
              <Input
                id="receiverName"
                value={form.receiverName}
                onChange={(e) => setForm({ ...form, receiverName: e.target.value })}
              />
            </Field>

            <ProofUpload
              kind="ticket_pesee"
              label="Ticket de pesée (réception)"
              binding={{
                table: 'transfers',
                column: 'reception_ticket_path',
                rowId: transfer.id,
              }}
              value={ticketPath}
              onChange={setTicketPath}
              onQueued={setTicketQueued}
            />

            {ticketQueued && (
              <p role="status" className="rounded-md bg-status-warn/10 px-3 py-2 text-sm">
                La réception peut être enregistrée sans attendre : le ticket la rejoindra au retour du
                réseau. Elle sera enregistrée sans ticket d’ici là.
              </p>
            )}

            {weights.acceptedKg !== null &&
              weights.netUnloadedKg !== null &&
              weights.acceptedKg < weights.netUnloadedKg && (
                <Field id="rejectionReason" label="Motif du rejet" required>
                  <Textarea
                    id="rejectionReason"
                    required
                    value={form.rejectionReason}
                    onChange={(e) => setForm({ ...form, rejectionReason: e.target.value })}
                  />
                </Field>
              )}

            {/* Aperçu des écarts pendant la saisie : le réceptionnaire voit ce
                qu'il déclare avant de valider. */}
            {variances.ecartPhysiqueKg !== null && (
              <div data-testid="variance-preview" className="rounded-md bg-muted px-3 py-2 text-sm">
                Écart physique : <strong>{formatWeight(variances.ecartPhysiqueKg)}</strong>
                {variances.ecartPhysiquePct !== null && ` (${variances.ecartPhysiquePct.toFixed(2)} %)`}
                {variances.ecartAcceptationKg !== null && (
                  <> · Écart d’acceptation : {formatWeight(variances.ecartAcceptationKg)}</>
                )}
              </div>
            )}

            {!consistency.valid && (
              <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <ul className="list-inside list-disc">
                  {consistency.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {record.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {record.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" disabled={record.isPending || !consistency.valid}>
                {record.isPending ? 'Enregistrement…' : 'Enregistrer la réception'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
