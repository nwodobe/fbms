/**
 * Ouverture d'un client et invitations.
 *
 * Jusqu'ici, ouvrir une entreprise était une manipulation faite à la main dans
 * la base. C'est ce qui séparait encore le produit d'un service vendable : on ne
 * peut pas vendre un abonnement si sa mise en service demande un développeur.
 *
 * Trois règles sont ici, pures et testées sans base ni réseau, parce qu'elles
 * décident de choses qu'on ne rattrape pas :
 *
 *  · **l'identifiant d'entreprise ne se change pas.** Il apparaît dans les
 *    adresses, les exports et les liens envoyés aux clients. Le proposer bien
 *    formé du premier coup vaut mieux que le corriger après coup ;
 *
 *  · **une invitation périme.** Un lien oublié dans une boîte mail est une porte
 *    ouverte tant que personne ne la ferme. L'état affiché doit donc dépendre de
 *    l'heure qu'il est, pas seulement de la colonne `status` ;
 *
 *  · **le jeton ne se remontre pas.** Il n'est lisible qu'au moment où il est
 *    créé ; l'écran doit le dire, sinon on referme la fenêtre et il faut
 *    réinviter.
 */

/** Longueur maximale d'un identifiant, alignée sur la contrainte serveur. */
export const SLUG_MAX_LENGTH = 50
export const SLUG_MIN_LENGTH = 3

/** Durée de validité d'une invitation, alignée sur la valeur par défaut en base. */
export const INVITATION_DAYS = 14

/**
 * Propose un identifiant à partir du nom commercial.
 *
 * Les accents disparaissent plutôt que d'être percentés dans une URL, et tout
 * ce qui n'est pas lettre ou chiffre devient un tiret. « LBA Séguéla » donne
 * « lba-seguela », qui se dicte au téléphone.
 */
export function slugFromName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // Tronquer peut laisser un tiret final : « lba-…-cooperative » coupé au
  // mauvais endroit donnerait un identifiant que le serveur refuse.
  return base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '')
}

/**
 * Dit pourquoi un identifiant est refusé, ou `null` s'il convient.
 *
 * La règle est celle du serveur, redite ici pour être expliquée avant l'envoi.
 * Ce n'est pas le contrôle : c'est la politesse qui l'accompagne.
 */
export function slugIssue(slug: string): string | null {
  const value = slug.trim()

  if (value.length === 0) return 'L’identifiant est obligatoire.'
  if (value.length < SLUG_MIN_LENGTH) return `Au moins ${SLUG_MIN_LENGTH} caractères.`
  if (value.length > SLUG_MAX_LENGTH) return `Au plus ${SLUG_MAX_LENGTH} caractères.`

  // L'ordre compte. « LBA Séguéla! » est à la fois en majuscules et hors
  // alphabet ; répondre « minuscules uniquement » laisserait croire qu'il suffit
  // de baisser la casse, et le champ resterait refusé au coup d'après. On
  // signale donc d'abord ce que la casse ne réglera pas.
  if (/[^a-zA-Z0-9-]/.test(value)) return 'Lettres non accentuées, chiffres et tirets uniquement.'
  if (value !== value.toLowerCase()) return 'Minuscules uniquement.'
  if (value.startsWith('-') || value.endsWith('-')) return 'Ne peut pas commencer ni finir par un tiret.'

  return null
}

/** Même contrôle d'adresse que le serveur, pour le dire avant l'envoi. */
export function emailIssue(email: string): string | null {
  const value = email.trim()
  if (value.length === 0) return 'L’adresse est obligatoire.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'Adresse électronique invalide.'
  return null
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface Invitation {
  id: string
  email: string
  full_name: string
  role: string
  status: InvitationStatus
  expires_at: string
  invited_at: string
}

/**
 * État réel d'une invitation à un instant donné.
 *
 * Une invitation reste `pending` en base après sa date de péremption : rien ne
 * repasse sur la table pour la fermer. Afficher « en attente » pour un lien qui
 * ne fonctionne plus ferait attendre en vain quelqu'un qu'il faut réinviter.
 */
export function invitationState(invitation: Invitation, now: Date): InvitationStatus {
  if (invitation.status !== 'pending') return invitation.status
  return new Date(invitation.expires_at).getTime() <= now.getTime() ? 'expired' : 'pending'
}

export const INVITATION_LABELS: Record<InvitationStatus, string> = {
  pending: 'en attente',
  accepted: 'acceptée',
  expired: 'périmée',
  revoked: 'révoquée',
}

/** Jours restants avant péremption, jamais négatif. */
export function daysLeft(invitation: Invitation, now: Date): number {
  const ms = new Date(invitation.expires_at).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/**
 * Phrase affichée à côté d'une invitation.
 *
 * Elle dit ce qu'il reste à faire, pas seulement où en est la ligne : « périmée,
 * à renvoyer » évite de laisser croire que quelqu'un va finir par cliquer.
 */
export function describeInvitation(invitation: Invitation, now: Date): string {
  const state = invitationState(invitation, now)

  switch (state) {
    case 'pending': {
      const jours = daysLeft(invitation, now)
      return jours <= 1 ? 'expire aujourd’hui' : `expire dans ${jours} jours`
    }
    case 'expired':
      return 'périmée, à renvoyer'
    case 'accepted':
      return 'compte créé'
    case 'revoked':
      return 'révoquée'
  }
}

/** Une invitation renvoyable : périmée, ou en attente depuis assez longtemps. */
export function isResendable(invitation: Invitation, now: Date): boolean {
  const state = invitationState(invitation, now)
  return state === 'pending' || state === 'expired'
}

/**
 * Ordre d'affichage : ce qui demande une action d'abord.
 *
 * Les périmées passent en tête — ce sont elles qu'il faut renvoyer — puis les
 * invitations en attente, puis l'histoire.
 */
const STATE_RANK: Record<InvitationStatus, number> = {
  expired: 0,
  pending: 1,
  accepted: 2,
  revoked: 3,
}

export function sortInvitations<T extends Invitation>(list: readonly T[], now: Date): T[] {
  return [...list].sort((a, b) => {
    const rank = STATE_RANK[invitationState(a, now)] - STATE_RANK[invitationState(b, now)]
    if (rank !== 0) return rank
    return new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime()
  })
}

/**
 * Lien d'acceptation.
 *
 * Construit à partir de l'origine réelle du navigateur : un lien codé en dur
 * pointerait vers le mauvais domaine dès la première mise en production.
 */
export function invitationLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invitation/${token}`
}
