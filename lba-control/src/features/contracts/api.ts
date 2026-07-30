import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CampaignInput, ContractInput } from '@/domain/schemas'
import type { PriceType } from '@/domain/prices'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'

export interface Campaign {
  id: string
  code: string
  name: string
  start_date: string
  end_date: string
  status: 'ouverte' | 'cloturee' | 'reouverte'
}

export interface Product {
  id: string
  code: string
  name: string
}

export interface Contract {
  id: string
  tenant_id: string
  partner_company_id: string
  campaign_id: string
  product_id: string
  reference: string
  target_volume_kg: number | null
  start_date: string
  end_date: string
  delivery_place: string | null
  kor_min: number | null
  humidity_max: number | null
  impurities_max: number | null
  weight_tolerance_pct: number | null
  acceptance_tolerance_pct: number | null
  payment_terms: string | null
  payment_delay_days: number | null
  coverage_basis: 'purchase_validated' | 'reception_accepted' | 'payment_received'
  valuation_price_basis: 'negocie' | 'net_reconnu' | 'producteur' | 'valorisation_ecart'
  status: 'brouillon' | 'actif' | 'suspendu' | 'cloture' | 'annule'
  activated_at: string | null
}

export interface NegotiatedPriceRow {
  id: string
  contract_id: string
  price_type: PriceType
  price: number
  valid_from: string
  valid_to: string | null
  version: number
  is_provisional: boolean
  justification: string | null
  superseded_by: string | null
  created_at: string
}

const CONTRACTS = ['contracts'] as const
const CAMPAIGNS = ['campaigns'] as const
const PRODUCTS = ['products'] as const
const PRICES = ['negotiated-prices'] as const

// ---------------------------------------------------------------------------
// Référentiel
// ---------------------------------------------------------------------------

export function useCampaigns() {
  return useQuery({
    queryKey: CAMPAIGNS,
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('start_date', { ascending: false })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as Campaign[]
    },
  })
}

export function useProducts() {
  return useQuery({
    queryKey: PRODUCTS,
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase.from('products').select('*').order('name')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as Product[]
    },
  })
}

export function useCreateCampaign(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CampaignInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('campaigns')
        .insert({
          tenant_id: tenantId,
          code: input.code,
          name: input.name,
          start_date: input.startDate,
          end_date: input.endDate,
        })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as Campaign
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CAMPAIGNS }),
  })
}

// ---------------------------------------------------------------------------
// Contrats
// ---------------------------------------------------------------------------

export function useContracts() {
  return useQuery({
    queryKey: CONTRACTS,
    queryFn: async (): Promise<Contract[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .order('start_date', { ascending: false })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as Contract[]
    },
  })
}

export function useCreateContract(tenantId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ContractInput) => {
      if (!tenantId) throw new Error('Entreprise non résolue : reconnectez-vous.')

      const { data, error } = await supabase
        .from('contracts')
        .insert({
          tenant_id: tenantId,
          partner_company_id: input.partnerCompanyId,
          campaign_id: input.campaignId,
          product_id: input.productId,
          reference: input.reference,
          target_volume_kg: input.targetVolumeKg ?? null,
          start_date: input.startDate,
          end_date: input.endDate,
          delivery_place: input.deliveryPlace || null,
          kor_min: input.korMin ?? null,
          humidity_max: input.humidityMax ?? null,
          impurities_max: input.impuritiesMax ?? null,
          weight_tolerance_pct: input.weightTolerancePct ?? null,
          acceptance_tolerance_pct: input.acceptanceTolerancePct ?? null,
          payment_terms: input.paymentTerms || null,
          payment_delay_days: input.paymentDelayDays ?? null,
          coverage_basis: input.coverageBasis,
          valuation_price_basis: input.valuationPriceBasis,
          status: 'brouillon',
        })
        .select()
        .single()

      if (error) throw new Error(describeError(error))
      return data as Contract
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONTRACTS }),
  })
}

/**
 * Changement de statut d'un contrat.
 *
 * L'activation est refusée en base si aucun prix négocié n'existe : un contrat
 * actif sans prix ne permettrait de valoriser aucune opération. La clôture
 * empêche les nouvelles opérations sans rien effacer.
 */
export function useSetContractStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Contract['status'] }) => {
      const { error } = await supabase.from('contracts').update({ status }).eq('id', id)
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONTRACTS })
    },
  })
}

// ---------------------------------------------------------------------------
// Prix négociés
// ---------------------------------------------------------------------------

export function useNegotiatedPrices(contractId: string | undefined) {
  return useQuery({
    queryKey: [...PRICES, contractId],
    enabled: Boolean(contractId),
    queryFn: async (): Promise<NegotiatedPriceRow[]> => {
      const { data, error } = await supabase
        .from('negotiated_prices')
        .select('*')
        .eq('contract_id', contractId!)
        .order('valid_from', { ascending: false })
        .order('version', { ascending: false })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as NegotiatedPriceRow[]
    },
  })
}

export interface RevisePriceArgs {
  contractId: string
  priceType: PriceType
  price: number
  validFrom: string
  justification: string
  isProvisional?: boolean
}

/**
 * Révision d'un prix.
 *
 * Passe obligatoirement par `app.revise_price` : clore l'ancienne version et
 * créer la nouvelle sont deux écritures, et si la seconde échouait le contrat
 * se retrouverait sans prix applicable. Le serveur les fait dans une seule
 * transaction — le client n'a pas à orchestrer ça.
 */
export function useRevisePrice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: RevisePriceArgs) => {
      const { data, error } = await supabase.rpc('revise_price', {
        p_contract_id: args.contractId,
        p_price_type: args.priceType,
        p_price: args.price,
        p_valid_from: args.validFrom,
        p_justification: args.justification,
        p_is_provisional: args.isProvisional ?? false,
      })

      if (error) throw new Error(describeError(error))
      return data as NegotiatedPriceRow
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...PRICES, variables.contractId] })
      void queryClient.invalidateQueries({ queryKey: CONTRACTS })
    },
  })
}
