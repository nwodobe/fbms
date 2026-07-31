import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { StockStatus, HolderType } from '@/domain/stock'
import type { PlanStatus } from '@/domain/planning'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type { DeliveryPlanDbRow } from '@/types/database'

// ---------------------------------------------------------------------------
// Stocks et réservations
// ---------------------------------------------------------------------------

export interface StockLotRow {
  id: string
  tenant_id: string
  code: string
  campaign_id: string
  partner_company_id: string | null
  field_agent_id: string | null
  site_id: string | null
  holder_type: HolderType
  quantity_kg: number
  bag_count: number | null
  kor: number | null
  humidity: number | null
  status: StockStatus
  is_own_account: boolean
}

export interface StockReservationRow {
  id: string
  tenant_id: string
  stock_lot_id: string
  delivery_plan_id: string | null
  partner_company_id: string
  quantity_kg: number
  status: 'active' | 'liberee' | 'consommee' | 'annulee'
}

export interface TransferRow {
  id: string
  tenant_id: string
  transfer_number: string
  partner_company_id: string
  contract_id: string | null
  campaign_id: string
  delivery_plan_id: string | null
  dispatched_at: string | null
  driver_name: string | null
  tractor_plate: string | null
  net_loaded_kg: number | null
  net_unloaded_kg: number | null
  accepted_kg: number | null
  paid_kg: number | null
  weight_source: 'verified' | 'estimated_bags' | 'declared'
  weighing_ticket_path: string | null
  ecart_physique_kg: number | null
  ecart_physique_pct: number | null
  ecart_acceptation_kg: number | null
  ecart_paiement_kg: number | null
  ecart_total_acceptation_kg: number | null
  ecart_financier_total_kg: number | null
  tare_variation_kg: number | null
  status: string
}

export interface DeliveryPlanRow {
  id: string
  tenant_id: string
  reference: string
  partner_company_id: string
  contract_id: string | null
  campaign_id: string
  planned_date: string
  planned_volume_kg: number
  origin_site_id: string | null
  destination_site_id: string | null
  field_agent_id: string | null
  vehicle_id: string | null
  priority: string
  status: PlanStatus
}

export interface IncidentRow {
  id: string
  tenant_id: string
  reference: string
  type: string
  severity: string
  transfer_id: string | null
  field_agent_id: string | null
  description: string
  exposed_quantity_kg: number | null
  exposed_amount: number | null
  suspected_responsible_type: string | null
  status: string
  decision: string | null
  decision_cause: string | null
  blocks_closure: boolean
  opened_at: string
}

const STOCK = ['stock-lots'] as const
const RESERVATIONS = ['stock-reservations'] as const
const PLANS = ['delivery-plans'] as const
const TRANSFERS = ['transfers'] as const
const INCIDENTS = ['incidents'] as const

export function useStockLots() {
  return useQuery({
    queryKey: STOCK,
    queryFn: async (): Promise<StockLotRow[]> => {
      const { data, error } = await supabase.from('stock_lots').select('*').order('code')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as StockLotRow[]
    },
  })
}

export function useStockReservations() {
  return useQuery({
    queryKey: RESERVATIONS,
    queryFn: async (): Promise<StockReservationRow[]> => {
      const { data, error } = await supabase.from('stock_reservations').select('*')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as StockReservationRow[]
    },
  })
}

/**
 * Réservation de stock.
 *
 * Passe obligatoirement par `app.reserve_stock` : lire la disponibilité puis
 * écrire la réservation depuis le client laisserait deux confirmations
 * simultanées promettre deux fois la même matière.
 */
export function useReserveStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      lotId: string
      planId: string | null
      quantityKg: number
      partnerCompanyId: string
    }) => {
      const { data, error } = await supabase.rpc('reserve_stock', {
        p_lot_id: args.lotId,
        p_plan_id: args.planId,
        p_quantity: args.quantityKg,
        p_partner: args.partnerCompanyId,
      })
      if (error) throw new Error(describeError(error))
      return data as string
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RESERVATIONS })
      void queryClient.invalidateQueries({ queryKey: STOCK })
    },
  })
}

export function useReleaseReservation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { reservationId: string; reason: string }) => {
      const { error } = await supabase
        .from('stock_reservations')
        .update({ status: 'liberee', released_at: new Date().toISOString(), release_reason: args.reason })
        .eq('id', args.reservationId)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RESERVATIONS })
      void queryClient.invalidateQueries({ queryKey: STOCK })
    },
  })
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export function useDeliveryPlans() {
  return useQuery({
    queryKey: PLANS,
    queryFn: async (): Promise<DeliveryPlanRow[]> => {
      const { data, error } = await supabase
        .from('delivery_plans')
        .select('*')
        .order('planned_date', { ascending: true })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as DeliveryPlanRow[]
    },
  })
}

export function useSetPlanStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { id: string; status: PlanStatus; reason?: string }) => {
      const payload: Partial<DeliveryPlanDbRow> = { status: args.status }
      if (args.status === 'reporte') {
        payload.postponed_at = new Date().toISOString()
        // Le motif de report est obligatoire côté base : un report sans
        // explication efface la trace d'une promesse non tenue.
        payload.postpone_reason = args.reason ?? null
      }
      if (args.status === 'confirme') payload.confirmed_at = new Date().toISOString()

      const { error } = await supabase.from('delivery_plans').update(payload).eq('id', args.id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PLANS }),
  })
}

// ---------------------------------------------------------------------------
// Transferts et réception
// ---------------------------------------------------------------------------

export function useTransfers() {
  return useQuery({
    queryKey: TRANSFERS,
    queryFn: async (): Promise<TransferRow[]> => {
      const { data, error } = await supabase
        .from('transfers')
        .select('*')
        .order('dispatched_at', { ascending: false, nullsFirst: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as TransferRow[]
    },
  })
}

export interface ReceptionResult {
  transfer_id: string
  ecart_physique_kg: number | null
  ecart_physique_pct: number | null
  ecart_acceptation_kg: number | null
  ecart_paiement_kg: number | null
  ecart_total_acceptation_kg: number | null
  ecart_financier_total_kg: number | null
  tolerance: { value: number; source: string }
  exceeds_tolerance: boolean
  incident_id: string | null
}

/**
 * Enregistrement d'une réception.
 *
 * Saisir les poids, calculer les écarts, ouvrir l'incident et déplacer le stock
 * forment une seule transaction serveur : les séparer laisserait la base dans un
 * état où le camion est arrivé mais la matière encore en transit.
 */
export function useRecordReception() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      transferId: string
      netUnloadedKg: number
      acceptedKg: number
      paidKg: number | null
      grossReceptionKg: number | null
      tareReceptionKg: number | null
      korReception: number | null
      humidityReception: number | null
      rejectionReason: string | null
      receiverName: string | null
    }): Promise<ReceptionResult> => {
      const { data, error } = await supabase.rpc('record_transfer_reception', {
        p_transfer_id: args.transferId,
        p_net_unloaded_kg: args.netUnloadedKg,
        p_accepted_kg: args.acceptedKg,
        p_paid_kg: args.paidKg,
        p_gross_reception_kg: args.grossReceptionKg,
        p_tare_reception_kg: args.tareReceptionKg,
        p_kor_reception: args.korReception,
        p_humidity_reception: args.humidityReception,
        p_rejected_kg: null,
        p_rejection_reason: args.rejectionReason,
        p_receiver_name: args.receiverName,
        p_reception_ticket_path: null,
      })

      if (error) throw new Error(describeError(error))
      return data as ReceptionResult
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRANSFERS })
      void queryClient.invalidateQueries({ queryKey: INCIDENTS })
      void queryClient.invalidateQueries({ queryKey: STOCK })
    },
  })
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export function useIncidents() {
  return useQuery({
    queryKey: INCIDENTS,
    queryFn: async (): Promise<IncidentRow[]> => {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .order('opened_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as IncidentRow[]
    },
  })
}

export function useDecideIncident(currentUserId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { id: string; decision: string; cause: string }) => {
      const { error } = await supabase
        .from('incidents')
        .update({
          status: 'decide',
          decision: args.decision,
          decision_cause: args.cause,
          validated_by: currentUserId,
          validated_at: new Date().toISOString(),
          // La décision lève le blocage : c'est un humain qui l'a prise.
          blocks_closure: false,
        })
        .eq('id', args.id)

      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INCIDENTS })
      void queryClient.invalidateQueries({ queryKey: TRANSFERS })
    },
  })
}
