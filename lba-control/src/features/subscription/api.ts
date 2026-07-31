import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type { SubscriptionRow } from '@/types/database'

const SUBSCRIPTION = ['subscription'] as const
const INVOICES = ['invoices'] as const
const PAYMENTS = ['subscription-payments'] as const
const EVENTS = ['subscription-events'] as const

export interface InvoiceRow {
  id: string
  tenant_id: string
  subscription_id: string
  number: string
  amount: number
  amount_paid: number
  issued_at: string
  due_date: string
  period_start: string
  period_end: string
  status: string
}

export interface SubscriptionPaymentRow {
  id: string
  tenant_id: string
  subscription_id: string
  invoice_id: string | null
  amount: number
  method: string
  reference: string
  payer: string | null
  declared_at: string
  status: 'declared' | 'confirmed' | 'rejected' | 'partial'
  confirmed_at: string | null
  verifier_note: string | null
  rejected_reason: string | null
}

export interface SubscriptionEventRow {
  id: string
  event_type: string
  old_status: string | null
  new_status: string | null
  reason: string | null
  occurred_at: string
}

export interface SubscriptionPhase {
  phase: string
  expected_status: string
  access_level: 'full' | 'read_only' | 'blocked'
  days_to_expiry?: number
  days_overdue: number
  data_retained: boolean
}

export function useSubscription() {
  return useQuery({
    queryKey: SUBSCRIPTION,
    queryFn: async (): Promise<SubscriptionRow | null> => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .order('period_end', { ascending: false })
        .limit(1)
      if (error) throw new Error(describeError(error))
      return (data?.[0] as SubscriptionRow | undefined) ?? null
    },
  })
}

export function useInvoices() {
  return useQuery({
    queryKey: INVOICES,
    queryFn: async (): Promise<InvoiceRow[]> => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('issued_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as InvoiceRow[]
    },
  })
}

export function useSubscriptionPayments() {
  return useQuery({
    queryKey: PAYMENTS,
    queryFn: async (): Promise<SubscriptionPaymentRow[]> => {
      const { data, error } = await supabase
        .from('subscription_payments')
        .select('*')
        .order('declared_at', { ascending: false })
      if (error) throw new Error(describeError(error))
      return (data ?? []) as SubscriptionPaymentRow[]
    },
  })
}

export function useSubscriptionEvents() {
  return useQuery({
    queryKey: EVENTS,
    queryFn: async (): Promise<SubscriptionEventRow[]> => {
      const { data, error } = await supabase
        .from('subscription_events')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(describeError(error))
      return (data ?? []) as SubscriptionEventRow[]
    },
  })
}

export function useSubscriptionPhase(subscriptionId: string | null) {
  return useQuery({
    queryKey: [...SUBSCRIPTION, 'phase', subscriptionId],
    enabled: Boolean(subscriptionId),
    queryFn: async (): Promise<SubscriptionPhase> => {
      const { data, error } = await supabase.rpc('subscription_phase', {
        p_subscription_id: subscriptionId!,
        p_today: null,
      })
      if (error) throw new Error(describeError(error))
      return data as SubscriptionPhase
    },
  })
}

/**
 * Déclaration de paiement par le client.
 *
 * N'active rien, et la fonction serveur le garantit : le statut et la période
 * restent identiques jusqu'à vérification humaine. L'écran le dit explicitement
 * plutôt que de laisser espérer une réactivation immédiate.
 */
export function useDeclarePayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      amount: number
      method: string
      reference: string
      invoiceId: string | null
      payer: string
    }) => {
      const { data, error } = await supabase.rpc('declare_subscription_payment', {
        p_amount: args.amount,
        p_method: args.method,
        p_reference: args.reference,
        p_invoice_id: args.invoiceId,
        p_payer: args.payer || null,
        p_proof_path: null,
      })
      if (error) throw new Error(describeError(error))
      return data as SubscriptionPaymentRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAYMENTS })
      void queryClient.invalidateQueries({ queryKey: EVENTS })
    },
  })
}

/** Réservé au super-administrateur : le serveur refuse tout autre appelant. */
export function useConfirmPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { paymentId: string; note: string }) => {
      const { data, error } = await supabase.rpc('confirm_subscription_payment', {
        p_payment_id: args.paymentId,
        p_verifier_note: args.note || null,
        p_idempotency_key: null,
      })
      if (error) throw new Error(describeError(error))
      return data as SubscriptionRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAYMENTS })
      void queryClient.invalidateQueries({ queryKey: SUBSCRIPTION })
      void queryClient.invalidateQueries({ queryKey: INVOICES })
    },
  })
}

// ---------------------------------------------------------------------------
// Clôture de campagne
// ---------------------------------------------------------------------------

export interface ClosureBlocker {
  code: string
  count: number
  amount?: number
  message: string
}

export interface ClosureCheck {
  campaign_id: string
  can_close: boolean
  blockers: ClosureBlocker[]
}

export function useClosureBlockers(campaignId: string | null) {
  return useQuery({
    queryKey: ['campaign-closure', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<ClosureCheck> => {
      const { data, error } = await supabase.rpc('campaign_closure_blockers', {
        p_campaign_id: campaignId!,
      })
      if (error) throw new Error(describeError(error))
      return data as ClosureCheck
    },
  })
}

export function useCloseCampaign() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { campaignId: string; reason: string; force: boolean }) => {
      const { error } = await supabase.rpc('close_campaign', {
        p_campaign_id: args.campaignId,
        p_reason: args.reason || null,
        p_force: args.force,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      void queryClient.invalidateQueries({ queryKey: ['campaign-closure'] })
    },
  })
}

export function useReopenCampaign() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { campaignId: string; reason: string }) => {
      const { error } = await supabase.rpc('reopen_campaign', {
        p_campaign_id: args.campaignId,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      void queryClient.invalidateQueries({ queryKey: ['campaign-closure'] })
    },
  })
}
