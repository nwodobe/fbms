/**
 * Types de la base.
 *
 * Ce fichier sera régénéré depuis le schéma réel
 * (`supabase gen types typescript`) dès qu'un projet Supabase sera raccordé.
 * En attendant, il déclare les tables et énumérations déjà utilisées par le
 * socle, afin que le client soit typé et non pas `any` — un client non typé
 * masquerait précisément les erreurs de nommage que TypeScript strict doit
 * attraper.
 *
 * ⚠ Les lignes sont déclarées avec `type` et NON avec `interface`. Une interface
 * n'a pas de signature d'index implicite : elle échoue la contrainte
 * `Record<string, unknown>` de postgrest-js, qui retombe alors silencieusement
 * sur `never` et fait échouer toutes les écritures à la compilation, avec un
 * message qui ne désigne pas la cause. Les convertir en interfaces casserait le
 * projet de façon difficile à diagnostiquer.
 */

export type UserRole =
  | 'super_admin'
  | 'proprietaire'
  | 'gestionnaire'
  | 'comptable'
  | 'responsable_terrain'
  | 'pisteur'
  | 'auditeur'
  | 'magasinier'
  | 'logistique'
  | 'partenaire_externe'

export type TenantStatus = 'active' | 'suspended' | 'archived'

export type SubscriptionStatus =
  | 'trial'
  | 'pending_payment'
  | 'active'
  | 'grace_period'
  | 'overdue'
  | 'suspended_read_only'
  | 'suspended'
  | 'cancelled'
  | 'expired'

export type TenantRow = {
  id: string
  slug: string
  commercial_name: string
  legal_name: string
  status: TenantStatus
  currency: string
  language: string
  timezone: string
}

export type TenantBrandingRow = {
  tenant_id: string
  commercial_name: string | null
  legal_name: string | null
  slogan: string | null
  logo_path: string | null
  logo_mobile_path: string | null
  login_image_path: string | null
  primary_color: string
  secondary_color: string
  phone: string | null
  email: string | null
  address: string | null
  tax_id: string | null
  document_footer: string | null
  currency: string
  language: string
}

export type UserRow = {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string
  email: string | null
  phone: string | null
  status: 'active' | 'suspended' | 'closed'
  last_login_at: string | null
}

export type SubscriptionRow = {
  id: string
  tenant_id: string
  plan_id: string
  status: SubscriptionStatus
  period_start: string
  period_end: string
  grace_days: number
  amount: number
  currency: string
}

// ---------------------------------------------------------------------------
// Phase 2 · référentiel commercial
// ---------------------------------------------------------------------------

export type PartnerStatus = 'active' | 'suspended' | 'closed'
export type ContractStatus = 'brouillon' | 'actif' | 'suspendu' | 'cloture' | 'annule'
export type CampaignStatus = 'ouverte' | 'cloturee' | 'reouverte'
export type PriceTypeEnum =
  | 'negocie'
  | 'plafond_achat'
  | 'producteur'
  | 'net_reconnu'
  | 'valorisation_ecart'
export type CoverageBasis = 'purchase_validated' | 'reception_accepted' | 'payment_received'
export type ValuationPriceBasis = 'negocie' | 'net_reconnu' | 'producteur' | 'valorisation_ecart'

export type PartnerCompanyRow = {
  id: string
  tenant_id: string
  code: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  status: PartnerStatus
  weight_tolerance_pct: number | null
  acceptance_tolerance_pct: number | null
  external_access_enabled: boolean
  created_at: string
}

export type CampaignRow = {
  id: string
  tenant_id: string
  code: string
  name: string
  start_date: string
  end_date: string
  status: CampaignStatus
}

export type ProductRow = {
  id: string
  tenant_id: string
  code: string
  name: string
  unit: string
  is_active: boolean
}

export type ContractRow = {
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
  coverage_basis: CoverageBasis
  valuation_price_basis: ValuationPriceBasis
  status: ContractStatus
  activated_at: string | null
}

export type NegotiatedPriceRow = {
  id: string
  tenant_id: string
  contract_id: string
  price_type: PriceTypeEnum
  price: number
  currency: string
  valid_from: string
  valid_to: string | null
  version: number
  is_provisional: boolean
  justification: string | null
  superseded_by: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Phase 3 · terrain, financements, avances, achats
// ---------------------------------------------------------------------------

export type AgentStatus = 'actif' | 'suspendu' | 'cloture'
export type AdvanceStatus =
  | 'brouillon' | 'soumis' | 'approuve' | 'decaisse'
  | 'partiellement_couvert' | 'cloture' | 'annule'
export type PurchaseStatus = 'brouillon' | 'valide' | 'paye' | 'annule'
export type SyncStatusEnum = 'pending' | 'syncing' | 'synced' | 'failed'

export type FieldAgentRow = {
  id: string
  tenant_id: string
  user_id: string | null
  code: string
  full_name: string
  phone: string | null
  zone_id: string | null
  mobile_money_account: string | null
  ceiling_amount: number
  activation_date: string | null
  status: AgentStatus
  commission_mode: 'par_kg' | 'pourcentage' | 'forfait' | 'aucune'
  commission_value: number
}

export type FundingRow = {
  id: string
  tenant_id: string
  partner_company_id: string
  contract_id: string | null
  campaign_id: string
  amount: number
  received_at: string
  reference: string | null
  payment_method: string
  reference_price: number | null
  /** Colonne générée : montant ÷ prix de référence. Non modifiable. */
  theoretical_volume_kg: number | null
  coverage_deadline: string | null
  status: string
}

export type AdvanceRow = {
  id: string
  tenant_id: string
  field_agent_id: string
  partner_company_id: string
  funding_id: string | null
  campaign_id: string
  amount: number
  issued_at: string
  payment_method: string
  reference: string | null
  volume_target_kg: number | null
  max_purchase_price: number | null
  justification_deadline: string | null
  status: AdvanceStatus
  requires_override: boolean
  override_reason: string | null
  override_approved_by: string | null
  override_approved_at: string | null
  created_by: string | null
}

export type PurchaseRow = {
  id: string
  tenant_id: string
  field_agent_id: string
  partner_company_id: string | null
  campaign_id: string
  contract_id: string | null
  advance_id: string | null
  supplier_id: string | null
  supplier_name: string | null
  village: string | null
  purchased_at: string
  net_weight_kg: number
  price_per_kg: number
  amount: number
  bag_count: number | null
  payment_method: string
  payment_reference: string | null
  status: PurchaseStatus
  sync_status: SyncStatusEnum
  device_id: string | null
  created_at_device: string | null
  is_own_account: boolean
  gps_lat: number | null
  gps_lng: number | null
}

export type PurchaseDuplicateFlagRow = {
  id: string
  tenant_id: string
  purchase_id: string
  candidate_id: string
  similarity_score: number
  matched_criteria: string[]
  status: 'a_verifier' | 'confirme' | 'ecarte'
}

export type ExpenseRow = {
  id: string
  tenant_id: string
  category_id: string
  partner_company_id: string | null
  campaign_id: string
  contract_id: string | null
  field_agent_id: string | null
  transfer_id: string | null
  stock_lot_id: string | null
  expense_date: string
  amount: number
  beneficiary: string
  beneficiary_user_id: string | null
  payment_method: string
  reference: string | null
  proof_path: string | null
  nature: 'direct' | 'indirect'
  allocation_key: AllocationKeyEnum | null
  status: string
  submitted_by: string | null
  submitted_at: string | null
  validated_by: string | null
  validated_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  is_system_generated: boolean
  created_by: string | null
  sync_status: SyncStatusEnum
}

export type AllocationKeyEnum =
  | 'poids_accepte'
  | 'valeur_achat'
  | 'nb_livraisons'
  | 'nb_sacs'
  | 'jours_stockage'
  | 'manuel'

export type AllocationTargetEnum =
  | 'partner'
  | 'campaign'
  | 'contract'
  | 'field_agent'
  | 'lot'
  | 'transfer'

export type ExpenseCategoryRow = {
  id: string
  tenant_id: string
  code: string
  label: string
  family: string
  is_direct: boolean
  default_allocation_key: AllocationKeyEnum
  requires_receipt_above: number | null
  cap_amount: number | null
  is_system_reserved: boolean
  is_controllable_by_agent: boolean
  is_active: boolean
}

export type ExpenseDuplicateFlagRow = {
  id: string
  tenant_id: string
  expense_id: string
  candidate_id: string
  similarity_score: number
  matched_criteria: string[]
  status: 'a_verifier' | 'confirme' | 'ecarte'
  reviewed_by: string | null
  reviewed_at: string | null
}

export type ExpenseAllocationRow = {
  id: string
  tenant_id: string
  expense_id: string
  target_type: AllocationTargetEnum
  target_id: string
  allocation_key: AllocationKeyEnum
  base_value: number
  total_base_value: number
  share_ratio: number
  allocated_amount: number
  is_manual: boolean
  approved_by: string | null
  reason: string | null
  computed_at: string
}

export type TcbSnapshotRow = {
  id: string
  tenant_id: string
  scope_type: AllocationTargetEnum
  scope_id: string
  campaign_id: string | null
  is_forecast: boolean
  computed_at: string
  accepted_weight_kg: number | null
  loaded_weight_kg: number | null
  unloaded_weight_kg: number | null
  paid_weight_kg: number | null
  purchase_value: number
  direct_expenses: number
  indirect_allocated: number
  valued_losses: number
  tcb_total: number
  /** `null` — jamais 0 — quand aucun kilo n'est accepté (H-04). */
  tcb_per_accepted_kg: number | null
  net_sale_price: number | null
  net_revenue: number | null
  margin_total: number | null
  margin_per_kg: number | null
  /** Écart assumé entre les deux définitions de marge (INC-06). */
  margin_reconciliation_gap: number | null
  is_deficit: boolean | null
  inputs: Record<string, unknown>
}

export type TcbSnapshotComponentRow = {
  id: string
  tenant_id: string
  snapshot_id: string
  component: string
  amount: number
  amount_per_kg: number | null
  source_count: number | null
}

export type ScoreComponentCodeEnum =
  | 'couverture_avances'
  | 'respect_delais'
  | 'ecarts_poids'
  | 'respect_prix'
  | 'qualite'
  | 'fiabilite_justificatifs'
  | 'gestion_sacs'
  | 'regularite'
  | 'maitrise_tcb'

export type AgentScoreRow = {
  id: string
  tenant_id: string
  field_agent_id: string
  campaign_id: string | null
  period_start: string | null
  period_end: string | null
  computed_at: string
  raw_score: number | null
  /** Score après neutralisation des seuls événements externes validés. */
  event_adjusted_score: number | null
  /** Score affiché : ajusté aux événements puis aux corrections humaines motivées. */
  adjusted_score: number | null
  category: string
  maturity: 'non_evalue' | 'en_observation' | 'provisoire' | 'confirme'
  /** RECOMMANDATION. Le plafond réel du pisteur n'est jamais modifié par le score. */
  recommended_ceiling: number | null
  excluded_events: Array<{ id: string; type: string }>
}

export type AgentScoreComponentRow = {
  id: string
  tenant_id: string
  score_id: string
  component: ScoreComponentCodeEnum
  weight: number
  value: number
  weighted_value: number
  source_data: Record<string, unknown>
  explanation: string | null
}

export type AgentScoreAdjustmentRow = {
  id: string
  tenant_id: string
  score_id: string
  delta: number
  reason: string
  adjusted_by: string
  adjusted_at: string
}

export type ExternalEventRow = {
  id: string
  tenant_id: string
  field_agent_id: string | null
  transfer_id: string | null
  event_type: string
  description: string
  occurred_from: string
  occurred_to: string | null
  validated_by: string | null
  validated_at: string | null
  proof_path: string | null
}

export type AlertRuleRow = {
  id: string
  tenant_id: string
  alert_type: string
  severity: 'info' | 'surveillance' | 'critique' | 'blocage'
  threshold: Record<string, number>
  is_active: boolean
}

export type AlertRow = {
  id: string
  tenant_id: string
  alert_type: string
  severity: 'info' | 'surveillance' | 'critique' | 'blocage'
  title: string
  message: string
  campaign_id: string | null
  partner_company_id: string | null
  field_agent_id: string | null
  related_table: string | null
  related_id: string | null
  measured_value: number | null
  threshold_value: number | null
  status: 'ouverte' | 'acquittee' | 'resolue' | 'ignoree'
  raised_at: string
  acknowledged_by: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  resolution_note: string | null
  dedupe_key: string | null
}

export type MarginResultRow = {
  margin_total: number | null
  margin_per_kg: number | null
  implied_margin: number | null
  margin_reconciliation_gap: number | null
  is_deficit: boolean | null
}

export type AllocationResultRow = {
  expense_id: string
  allocation_key: AllocationKeyEnum
  total_base_value: number
  allocated_total: number
  lines: Array<{
    target_id: string
    base_value: number
    share_ratio: number
    allocated_amount: number
  }>
}

export type AgentExposureResult = {
  advanced: number
  covered: number
  exposure: number
  oldest_outstanding_age_days: number
}

export type AdvanceCapacityResult = {
  issues: Array<{ reason: string; severity: string; message: string; measured?: number; threshold?: number }>
  can_proceed: boolean
  requires_override: boolean
  has_hard_block: boolean
  exposure: AgentExposureResult
}

// ---------------------------------------------------------------------------
// Phase 4 · stocks, planning, transferts, incidents
// ---------------------------------------------------------------------------

export type StockStatusEnum =
  | 'disponible' | 'reserve' | 'charge' | 'en_transit' | 'receptionne'
  | 'rejete' | 'bloque' | 'en_litige' | 'cloture'
export type HolderTypeEnum = 'field_agent' | 'warehouse' | 'in_transit' | 'partner_site'
export type WeightSourceEnum = 'verified' | 'estimated_bags' | 'declared'
export type DeliveryPlanStatus =
  | 'brouillon' | 'planifie' | 'confirme' | 'en_preparation' | 'chargement'
  | 'en_transit' | 'arrive' | 'decharge' | 'receptionne' | 'cloture' | 'reporte' | 'annule'

export type StockLotDbRow = {
  id: string
  tenant_id: string
  code: string
  campaign_id: string
  partner_company_id: string | null
  contract_id: string | null
  field_agent_id: string | null
  product_id: string
  site_id: string | null
  holder_type: HolderTypeEnum
  holder_id: string | null
  quantity_kg: number
  bag_count: number | null
  kor: number | null
  humidity: number | null
  status: StockStatusEnum
  is_own_account: boolean
}

export type StockReservationDbRow = {
  id: string
  tenant_id: string
  stock_lot_id: string
  delivery_plan_id: string | null
  partner_company_id: string
  quantity_kg: number
  status: 'active' | 'liberee' | 'consommee' | 'annulee'
  released_at: string | null
  release_reason: string | null
}

export type DeliveryPlanDbRow = {
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
  transporter_id: string | null
  priority: string
  status: DeliveryPlanStatus
  confirmed_at: string | null
  postponed_at: string | null
  postpone_reason: string | null
}

/** Les cinq écarts sont des colonnes GÉNÉRÉES : elles ne sont jamais écrites. */
export type TransferDbRow = {
  id: string
  tenant_id: string
  transfer_number: string
  partner_company_id: string
  contract_id: string | null
  campaign_id: string
  delivery_plan_id: string | null
  origin_site_id: string | null
  destination_site_id: string | null
  dispatched_at: string | null
  driver_name: string | null
  tractor_plate: string | null
  trailer_plate: string | null
  gross_weight_kg: number | null
  tare_kg: number | null
  net_loaded_kg: number | null
  bag_count_loaded: number | null
  kor_departure: number | null
  humidity_departure: number | null
  weighing_ticket_path: string | null
  weight_source: WeightSourceEnum
  arrived_at: string | null
  unloaded_at: string | null
  gross_weight_reception_kg: number | null
  tare_reception_kg: number | null
  net_unloaded_kg: number | null
  accepted_kg: number | null
  paid_kg: number | null
  kor_reception: number | null
  humidity_reception: number | null
  rejected_kg: number | null
  rejection_reason: string | null
  receiver_name: string | null
  applied_price_id: string | null
  applied_price_value: number | null
  status: string
  readonly ecart_physique_kg: number | null
  readonly ecart_physique_pct: number | null
  readonly ecart_acceptation_kg: number | null
  readonly ecart_paiement_kg: number | null
  readonly ecart_total_acceptation_kg: number | null
  readonly ecart_financier_total_kg: number | null
  readonly tare_variation_kg: number | null
}

export type TransferLotDbRow = {
  tenant_id: string
  transfer_id: string
  stock_lot_id: string
  quantity_kg: number
  bag_count: number | null
}

export type IncidentDbRow = {
  id: string
  tenant_id: string
  reference: string
  type: string
  severity: string
  campaign_id: string | null
  partner_company_id: string | null
  field_agent_id: string | null
  transfer_id: string | null
  description: string
  exposed_quantity_kg: number | null
  exposed_amount: number | null
  suspected_responsible_type: string | null
  suspected_responsible_id: string | null
  status: string
  decision: string | null
  decision_cause: string | null
  validated_by: string | null
  validated_at: string | null
  blocks_closure: boolean
  opened_at: string
}

export type ReceptionOutcome = {
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
 * Forme attendue par supabase-js pour une table.
 *
 * La clé `Relationships` est obligatoire : sans elle, postgrest-js n'arrive pas
 * à résoudre le type de la table et retombe silencieusement sur `never`, ce qui
 * fait échouer toutes les écritures à la compilation avec un message peu
 * évocateur.
 */
type Writable<T> = {
  Row: T
  Insert: Partial<T>
  Update: Partial<T>
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      tenants: Writable<TenantRow>
      tenant_branding: Writable<TenantBrandingRow>
      users: Writable<UserRow>
      subscriptions: Writable<SubscriptionRow>
      partner_companies: Writable<PartnerCompanyRow>
      campaigns: Writable<CampaignRow>
      products: Writable<ProductRow>
      contracts: Writable<ContractRow>
      negotiated_prices: Writable<NegotiatedPriceRow>
      field_agents: Writable<FieldAgentRow>
      fundings: Writable<FundingRow>
      advances: Writable<AdvanceRow>
      purchases: Writable<PurchaseRow>
      purchase_duplicate_flags: Writable<PurchaseDuplicateFlagRow>
      expenses: Writable<ExpenseRow>
      expense_categories: Writable<ExpenseCategoryRow>
      expense_duplicate_flags: Writable<ExpenseDuplicateFlagRow>
      expense_allocations: Writable<ExpenseAllocationRow>
      tcb_snapshots: Writable<TcbSnapshotRow>
      tcb_snapshot_components: Writable<TcbSnapshotComponentRow>
      agent_scores: Writable<AgentScoreRow>
      agent_score_components: Writable<AgentScoreComponentRow>
      agent_score_adjustments: Writable<AgentScoreAdjustmentRow>
      external_events: Writable<ExternalEventRow>
      alert_rules: Writable<AlertRuleRow>
      alerts: Writable<AlertRow>
      stock_lots: Writable<StockLotDbRow>
      stock_reservations: Writable<StockReservationDbRow>
      delivery_plans: Writable<DeliveryPlanDbRow>
      transfers: Writable<TransferDbRow>
      transfer_lots: Writable<TransferLotDbRow>
      incidents: Writable<IncidentDbRow>
    }
    Views: Record<string, never>
    Functions: {
      /**
       * Relais public de `app.revise_price`. Clôt la version en cours et crée
       * la suivante dans une seule transaction serveur.
       */
      revise_price: {
        Args: {
          p_contract_id: string
          p_price_type: PriceTypeEnum
          p_price: number
          p_valid_from: string
          p_justification: string
          p_is_provisional?: boolean
          p_proof_path?: string | null
        }
        Returns: NegotiatedPriceRow
      }
      /** Exposition d'un pisteur, chaque état restant séparé. */
      agent_exposure: {
        Args: { p_agent_id: string; p_partner_id?: string | null }
        Returns: AgentExposureResult
      }
      /** Contrôle de capacité avant décaissement d'une avance. */
      check_advance_capacity: {
        Args: { p_agent_id: string; p_partner_id: string; p_amount: number }
        Returns: AdvanceCapacityResult
      }
      /** Réservation transactionnelle : empêche la double promesse de stock. */
      reserve_stock: {
        Args: { p_lot_id: string; p_plan_id: string | null; p_quantity: number; p_partner: string }
        Returns: string
      }
      /** Tolérance applicable, avec l'origine du seuil retenu. */
      resolve_weight_tolerance: {
        Args: { p_transfer_id: string }
        Returns: { value: number; source: string }
      }
      /** Réception : poids, écarts, incident et mouvement de stock en une transaction. */
      record_transfer_reception: {
        Args: {
          p_transfer_id: string
          p_net_unloaded_kg: number
          p_accepted_kg: number
          p_paid_kg?: number | null
          p_gross_reception_kg?: number | null
          p_tare_reception_kg?: number | null
          p_kor_reception?: number | null
          p_humidity_reception?: number | null
          p_rejected_kg?: number | null
          p_rejection_reason?: string | null
          p_receiver_name?: string | null
          p_reception_ticket_path?: string | null
        }
        Returns: ReceptionOutcome
      }
      /** Couverture FIFO des avances par une réception acceptée (arbitrage D1). */
      cover_advances_from_reception: {
        Args: { p_transfer_id: string }
        Returns: number
      }
      /**
       * Répartition d'une charge indirecte. Refuse plutôt que d'imputer zéro
       * quand la clé ne porte aucune valeur sur le périmètre.
       */
      allocate_indirect_expense: {
        Args: {
          p_expense_id: string
          p_key: AllocationKeyEnum
          p_target_type: AllocationTargetEnum
          p_target_ids: string[]
        }
        Returns: AllocationResultRow
      }
      /** Instantané de TCB et sa décomposition, calculés côté serveur. */
      compute_tcb: {
        Args: {
          p_scope_type: AllocationTargetEnum
          p_scope_id: string
          p_campaign_id?: string | null
          p_is_forecast?: boolean
        }
        Returns: string
      }
      /** Marges d'un instantané, écart de réconciliation compris (INC-06). */
      record_margin: {
        Args: { p_snapshot_id: string; p_net_revenue: number; p_net_sale_price_kg: number }
        Returns: MarginResultRow
      }
      /** Score d'un pisteur : composantes mesurées seulement, poids renormalisés. */
      compute_agent_score: {
        Args: {
          p_agent_id: string
          p_campaign_id?: string | null
          p_period_start?: string | null
          p_period_end?: string | null
        }
        Returns: string
      }
      /** Ajustement humain motivé du score affiché. Le score brut reste intact. */
      adjust_agent_score: {
        Args: { p_score_id: string; p_delta: number; p_reason: string }
        Returns: number
      }
      /** Installe les vingt règles d'alerte avec leurs seuils par défaut. */
      seed_alert_rules: {
        Args: { p_tenant: string }
        Returns: number
      }
      /** Évalue les vingt règles et ouvre les alertes non encore ouvertes. */
      evaluate_alerts: {
        Args: { p_tenant: string }
        Returns: number
      }
    }
    Enums: {
      user_role: UserRole
      tenant_status: TenantStatus
      subscription_status: SubscriptionStatus
      partner_status: PartnerStatus
      contract_status: ContractStatus
      campaign_status: CampaignStatus
      price_type: PriceTypeEnum
    }
  }
}
