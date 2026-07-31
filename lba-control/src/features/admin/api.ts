import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeError } from '@/lib/api/errors'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/types/database'

const USERS = ['tenant-users'] as const
const DEVICES = ['user-devices'] as const
const ROLES = ['assignable-roles'] as const
const AUDIT = ['audit-trail'] as const
const INVITATIONS = ['tenant-invitations'] as const

export interface TenantUser {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: UserRole
  status: 'active' | 'suspended' | 'closed'
  last_login_at: string | null
}

export function useTenantUsers() {
  return useQuery({
    queryKey: USERS,
    queryFn: async (): Promise<TenantUser[]> => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, phone, role, status, last_login_at')
        .order('full_name')

      if (error) throw new Error(describeError(error))
      return (data ?? []) as TenantUser[]
    },
  })
}

export interface AssignableRole {
  role: UserRole
  is_assignable: boolean
  note: string | null
}

/**
 * Rôles réellement attribuables.
 *
 * Lu depuis la base plutôt qu'écrit en dur : trois rôles ont leurs politiques
 * rédigées mais non activées, et la liste des activés changera. Un formulaire
 * qui les proposerait quand même donnerait des comptes dont personne ne sait ce
 * qu'ils peuvent faire.
 */
export function useAssignableRoles() {
  return useQuery({
    queryKey: ROLES,
    queryFn: async (): Promise<AssignableRole[]> => {
      const { data, error } = await supabase.from('assignable_roles').select('*').order('role')
      if (error) throw new Error(describeError(error))
      return (data ?? []) as AssignableRole[]
    },
  })
}

export function useSetUserRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { userId: string; role: UserRole; reason: string }) => {
      const { error } = await supabase.rpc('set_user_role', {
        p_user_id: args.userId,
        p_role: args.role,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS })
      void queryClient.invalidateQueries({ queryKey: AUDIT })
    },
  })
}

export function useSetUserStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      userId: string
      status: 'active' | 'suspended' | 'closed'
      reason: string
    }) => {
      const { error } = await supabase.rpc('set_user_status', {
        p_user_id: args.userId,
        p_status: args.status,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS })
      void queryClient.invalidateQueries({ queryKey: AUDIT })
    },
  })
}

export interface UserDevice {
  id: string
  user_id: string
  device_id: string
  label: string | null
  platform: string | null
  last_seen_at: string
  revoked_at: string | null
}

export function useUserDevices() {
  return useQuery({
    queryKey: DEVICES,
    queryFn: async (): Promise<UserDevice[]> => {
      const { data, error } = await supabase
        .from('user_devices')
        .select('id, user_id, device_id, label, platform, last_seen_at, revoked_at')
        .order('last_seen_at', { ascending: false })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as UserDevice[]
    },
  })
}

export function useRevokeDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('revoke_device', {
        p_device_row_id: args.id,
        p_reason: args.reason,
      })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEVICES }),
  })
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Le jeton n'est délibérément pas lu ici.
 *
 * Il n'a d'intérêt qu'au moment où il est créé, et l'afficher dans une liste
 * consultable en permanence transformerait chaque invitation ancienne en clé
 * d'entrée toujours valable.
 */
export interface TenantInvitation {
  id: string
  email: string
  full_name: string
  role: UserRole
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expires_at: string
  invited_at: string
}

export function useTenantInvitations() {
  return useQuery({
    queryKey: INVITATIONS,
    queryFn: async (): Promise<TenantInvitation[]> => {
      const { data, error } = await supabase
        .from('tenant_invitations')
        .select('id, email, full_name, role, status, expires_at, invited_at')
        .order('invited_at', { ascending: false })

      if (error) throw new Error(describeError(error))
      return (data ?? []) as TenantInvitation[]
    },
  })
}

/**
 * Invite quelqu'un dans l'équipe.
 *
 * Le rôle passe par la même liste d'attribuables que le changement de rôle :
 * inviter quelqu'un comme magasinier donnerait un compte dont personne ne sait
 * ce qu'il peut faire, exactement comme l'attribution directe.
 */
export function useInviteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (args: {
      email: string
      fullName: string
      role: UserRole
    }): Promise<TenantInvitation> => {
      const { data, error } = await supabase.rpc('invite_user', {
        p_email: args.email,
        p_full_name: args.fullName,
        p_role: args.role,
      })

      if (error) throw new Error(describeError(error))
      return data as unknown as TenantInvitation
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INVITATIONS }),
  })
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId })
      if (error) throw new Error(describeError(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INVITATIONS }),
  })
}

// ---------------------------------------------------------------------------
// Journal d'audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: number
  occurred_at: string
  action: string
  table_name: string
  record_id: string | null
  user_id: string | null
  user_name: string | null
  user_role: string | null
  justification: string | null
  changed_fields: string[] | null
  device_id: string | null
}

export interface AuditFilters {
  action: string | null
  table: string | null
  userId: string | null
  page: number
}

export const AUDIT_PAGE_SIZE = 50

export function useAuditTrail(filters: AuditFilters) {
  return useQuery({
    queryKey: [...AUDIT, filters.action, filters.table, filters.userId, filters.page],
    queryFn: async (): Promise<{ total: number; entries: AuditEntry[] }> => {
      const { data, error } = await supabase.rpc('audit_trail', {
        p_action: filters.action,
        p_table: filters.table,
        p_user_id: filters.userId,
        p_limit: AUDIT_PAGE_SIZE,
        p_offset: filters.page * AUDIT_PAGE_SIZE,
      })

      if (error) throw new Error(describeError(error))
      return data as unknown as { total: number; entries: AuditEntry[] }
    },
  })
}
