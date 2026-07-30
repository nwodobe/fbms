/**
 * Types de la base.
 *
 * Ce fichier sera régénéré depuis le schéma réel
 * (`supabase gen types typescript`) dès qu'un projet Supabase sera raccordé.
 * En attendant, il déclare les tables et énumérations déjà utilisées par le
 * socle, afin que le client soit typé et non pas `any` — un client non typé
 * masquerait précisément les erreurs de nommage que TypeScript strict doit
 * attraper.
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

export interface TenantRow {
  id: string
  slug: string
  commercial_name: string
  legal_name: string
  status: TenantStatus
  currency: string
  language: string
  timezone: string
}

export interface TenantBrandingRow {
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

export interface UserRow {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string
  email: string | null
  phone: string | null
  status: 'active' | 'suspended' | 'closed'
  last_login_at: string | null
}

export interface SubscriptionRow {
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

export interface Database {
  public: {
    Tables: {
      tenants: { Row: TenantRow; Insert: Partial<TenantRow>; Update: Partial<TenantRow> }
      tenant_branding: {
        Row: TenantBrandingRow
        Insert: Partial<TenantBrandingRow>
        Update: Partial<TenantBrandingRow>
      }
      users: { Row: UserRow; Insert: Partial<UserRow>; Update: Partial<UserRow> }
      subscriptions: {
        Row: SubscriptionRow
        Insert: Partial<SubscriptionRow>
        Update: Partial<SubscriptionRow>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      user_role: UserRole
      tenant_status: TenantStatus
      subscription_status: SubscriptionStatus
    }
  }
}
