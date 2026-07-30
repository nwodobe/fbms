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
