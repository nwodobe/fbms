import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { enqueue } from '@/lib/offline/queue'
import { supabase } from '@/lib/supabase'

export interface Purchase {
  id: string
  tenant_id: string
  field_agent_id: string
  partner_company_id: string | null
  campaign_id: string
  supplier_id: string | null
  supplier_name: string | null
  village: string | null
  purchased_at: string
  net_weight_kg: number
  price_per_kg: number
  amount: number
  bag_count: number | null
  payment_method: string
  status: string
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed'
  device_id: string | null
  is_own_account: boolean
}

export interface PurchaseDuplicateFlag {
  id: string
  purchase_id: string
  candidate_id: string
  similarity_score: number
  matched_criteria: string[]
  status: 'a_verifier' | 'confirme' | 'ecarte'
}

export interface PurchaseInput {
  /** UUID généré sur l'appareil : clé de l'idempotence. */
  id: string
  fieldAgentId: string
  partnerCompanyId: string | null
  campaignId: string
  contractId: string | null
  advanceId: string | null
  supplierId: string | null
  supplierName: string | null
  village: string | null
  purchasedAt: string
  netWeightKg: number
  pricePerKg: number
  bagCount: number | null
  paymentMethod: string
  paymentReference: string | null
  isOwnAccount: boolean
  gpsLat: number | null
  gpsLng: number | null
}

const KEY = ['purchases'] as const

export function usePurchases(agentId?: string) {
  return useQuery({
    queryKey: [...KEY, agentId ?? 'all'],
    queryFn: async (): Promise<Purchase[]> => {
      let query = supabase.from('purchases').select('*').order('purchased_at', { ascending: false })
      if (agentId) query = query.eq('field_agent_id', agentId)

      const { data, error } = await query
      if (error) throw new Error(describeError(error))
      return (data ?? []) as Purchase[]
    },
  })
}

export function useDuplicateFlags() {
  return useQuery({
    queryKey: ['purchase-duplicate-flags'],
    queryFn: async (): Promise<PurchaseDuplicateFlag[]> => {
      const { data, error } = await supabase
        .from('purchase_duplicate_flags')
        .select('*')
        .eq('status', 'a_verifier')

      if (error) throw new Error(describeError(error))
      return (data ?? []) as PurchaseDuplicateFlag[]
    },
  })
}

function toRow(input: PurchaseInput, tenantId: string, deviceId: string) {
  return {
    id: input.id,
    tenant_id: tenantId,
    field_agent_id: input.fieldAgentId,
    partner_company_id: input.partnerCompanyId,
    campaign_id: input.campaignId,
    contract_id: input.contractId,
    advance_id: input.advanceId,
    supplier_id: input.supplierId,
    supplier_name: input.supplierName,
    village: input.village,
    purchased_at: input.purchasedAt,
    net_weight_kg: input.netWeightKg,
    price_per_kg: input.pricePerKg,
    // Le montant est recalculé, jamais saisi : une contrainte serveur vérifie
    // qu'il correspond au produit poids × prix.
    amount: Math.round(input.netWeightKg * input.pricePerKg * 100) / 100,
    bag_count: input.bagCount,
    payment_method: input.paymentMethod,
    payment_reference: input.paymentReference,
    is_own_account: input.isOwnAccount,
    gps_lat: input.gpsLat,
    gps_lng: input.gpsLng,
    device_id: deviceId,
    created_at_device: new Date().toISOString(),
    status: 'valide' as const,
    sync_status: 'synced' as const,
  }
}

export interface RecordPurchaseContext {
  tenantId: string | null
  userId: string | null
  deviceId: string
  isOnline: boolean
}

/**
 * Enregistre un achat terrain.
 *
 * En ligne, l'écriture part directement. Hors ligne — ou si l'envoi échoue —
 * elle est mise en file locale et **rien n'est perdu** : l'identifiant ayant été
 * généré sur l'appareil, la synchronisation ultérieure est idempotente.
 *
 * C'est délibérément la même fonction dans les deux cas : un chemin « hors
 * ligne » séparé finirait par diverger du chemin principal, et c'est toujours
 * celui du terrain qui en pâtirait.
 */
export function useRecordPurchase(context: RecordPurchaseContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: PurchaseInput): Promise<{ queued: boolean; reason?: string }> => {
      if (!context.tenantId || !context.userId) {
        throw new Error('Session incomplète : reconnectez-vous.')
      }

      const row = toRow(input, context.tenantId, context.deviceId)

      const queueIt = async (reason: string) => {
        await enqueue({
          id: input.id,
          tenantId: context.tenantId!,
          userId: context.userId!,
          deviceId: context.deviceId,
          entityType: 'purchase',
          payload: { ...row, sync_status: 'pending' },
        })
        return { queued: true, reason }
      }

      if (!context.isOnline) {
        return queueIt('Appareil hors connexion')
      }

      const { error } = await supabase.from('purchases').insert(row)

      if (error) {
        // Un refus métier (droits, plafond, contrainte) ne doit pas être mis en
        // file : il se reproduirait à l'identique. Seules les pannes de
        // transport sont réessayables.
        const isTransport = /fetch|network|timeout|failed to fetch/i.test(error.message)
        if (!isTransport) throw new Error(describeError(error))
        return queueIt(`Envoi impossible : ${error.message}`)
      }

      return { queued: false }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
      void queryClient.invalidateQueries({ queryKey: ['offline-queue'] })
    },
  })
}
