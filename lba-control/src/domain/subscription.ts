/**
 * Cycle de vie d'un abonnement.
 *
 * C'est le seul module du produit qui peut couper l'accès d'un client payant.
 * Quatre règles y sont donc codées plutôt que documentées :
 *
 *  1. **Une déclaration de paiement ne change jamais rien.** Elle est
 *     enregistrée, elle est visible, elle attend une confirmation humaine.
 *     Une capture d'écran ne réactive pas un abonnement — ni ici, ni en base.
 *
 *  2. **Le blocage est graduel et réversible.** Échéance, puis grâce, puis
 *     lecture seule, puis blocage opérationnel. À aucun moment les données ne
 *     sont supprimées : un client qui paie avec deux mois de retard retrouve
 *     son historique intact.
 *
 *  3. **La prolongation part de la date de fin existante**, pas d'aujourd'hui,
 *     tant que l'abonnement court encore. Payer en avance ne doit jamais faire
 *     perdre les jours déjà réglés.
 *
 *  4. **Un paiement partiel devient un avoir.** Il est conservé, il est visible,
 *     il ne renouvelle pas la période : offrir un mois contre un acompte
 *     transformerait la règle de facturation en négociation.
 */

import { round2 } from './money'

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

/** Ce que l'utilisateur peut réellement faire, indépendamment du libellé du statut. */
export type AccessLevel = 'full' | 'read_only' | 'blocked'

export type LifecyclePhase =
  | 'essai'
  | 'actif'
  | 'echeance_proche'
  | 'echu_en_grace'
  | 'lecture_seule'
  | 'bloque'
  | 'resilie'

export interface SubscriptionState {
  status: SubscriptionStatus
  /** Dernier jour couvert par la période payée, incluse. */
  periodEnd: string
  trialEnd?: string | null
  /** Jours de tolérance après l'échéance avant la lecture seule (défaut 5, D11). */
  graceDays?: number
  /** Jours après l'échéance avant le blocage opérationnel (défaut 30). */
  readonlyAfterDays?: number
}

export const DEFAULT_GRACE_DAYS = 5
export const DEFAULT_BLOCK_AFTER_DAYS = 30

export type ReminderKind = 'reminder_j7' | 'reminder_j3' | 'reminder_j0'

/** Jours avant échéance déclenchant chaque rappel. */
export const REMINDER_OFFSETS: Record<ReminderKind, number> = {
  reminder_j7: 7,
  reminder_j3: 3,
  reminder_j0: 0,
}

const DAY_MS = 86_400_000

function toDayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** Jours entre deux dates calendaires. Positif si `to` est après `from`. */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from)
}

export interface LifecycleResult {
  phase: LifecyclePhase
  /** Positif avant l'échéance, négatif après. Zéro le jour même. */
  daysToExpiry: number
  /** Jours écoulés depuis l'échéance. Zéro tant qu'elle n'est pas passée. */
  daysOverdue: number
  /** Statut que le serveur devrait porter, calculé à partir des dates seules. */
  expectedStatus: SubscriptionStatus
  accessLevel: AccessLevel
  /** Toujours vrai : aucune phase du cycle ne supprime de données. */
  dataRetained: true
  /** Prochaine bascule et sa date, pour que le client ne soit jamais surpris. */
  nextTransition: { phase: LifecyclePhase; on: string } | null
  message: string
}

/**
 * Résout la phase réelle d'un abonnement à une date donnée.
 *
 * `today` est un paramètre : un cycle de facturation qui lit l'horloge système
 * n'est pas testable, et une règle de blocage non testée finit par couper
 * l'accès d'un client à jour.
 */
export function resolveLifecycle(state: SubscriptionState, today: string): LifecycleResult {
  const graceDays = state.graceDays ?? DEFAULT_GRACE_DAYS
  const blockAfter = state.readonlyAfterDays ?? DEFAULT_BLOCK_AFTER_DAYS

  const daysToExpiry = daysBetween(today, state.periodEnd)
  const daysOverdue = Math.max(0, -daysToExpiry)
  const endDay = toDayNumber(state.periodEnd)

  if (state.status === 'cancelled' || state.status === 'expired') {
    return {
      phase: 'resilie',
      daysToExpiry,
      daysOverdue,
      expectedStatus: state.status,
      // Résilié n'est pas supprimé : la lecture et l'export restent ouverts.
      accessLevel: 'read_only',
      dataRetained: true,
      nextTransition: null,
      message: 'Abonnement résilié. Les données restent consultables et exportables.',
    }
  }

  if (daysToExpiry >= 0) {
    const isTrial = state.status === 'trial'
    const phase: LifecyclePhase =
      isTrial ? 'essai' : daysToExpiry <= REMINDER_OFFSETS.reminder_j7 ? 'echeance_proche' : 'actif'

    return {
      phase,
      daysToExpiry,
      daysOverdue: 0,
      expectedStatus: isTrial ? 'trial' : 'active',
      accessLevel: 'full',
      dataRetained: true,
      nextTransition: { phase: 'echu_en_grace', on: fromDayNumber(endDay + 1) },
      message:
        daysToExpiry === 0
          ? 'L’abonnement expire aujourd’hui.'
          : `L’abonnement expire dans ${daysToExpiry} jour(s).`,
    }
  }

  if (daysOverdue <= graceDays) {
    return {
      phase: 'echu_en_grace',
      daysToExpiry,
      daysOverdue,
      expectedStatus: 'grace_period',
      // Pendant la grâce, tout reste ouvert : une campagne d'achat ne s'arrête
      // pas parce qu'un virement met trois jours à arriver.
      accessLevel: 'full',
      dataRetained: true,
      nextTransition: { phase: 'lecture_seule', on: fromDayNumber(endDay + graceDays + 1) },
      message: `Échéance dépassée de ${daysOverdue} jour(s). Période de grâce de ${graceDays} jours en cours : l’accès reste complet.`,
    }
  }

  if (daysOverdue <= blockAfter) {
    return {
      phase: 'lecture_seule',
      daysToExpiry,
      daysOverdue,
      expectedStatus: 'suspended_read_only',
      accessLevel: 'read_only',
      dataRetained: true,
      nextTransition: { phase: 'bloque', on: fromDayNumber(endDay + blockAfter + 1) },
      message: `Échéance dépassée de ${daysOverdue} jour(s). Saisie suspendue ; la consultation et les exports restent ouverts.`,
    }
  }

  return {
    phase: 'bloque',
    daysToExpiry,
    daysOverdue,
    expectedStatus: 'suspended',
    accessLevel: 'blocked',
    dataRetained: true,
    nextTransition: null,
    message: `Échéance dépassée de ${daysOverdue} jour(s). Accès opérationnel bloqué. Les données sont conservées et restituées dès la régularisation.`,
  }
}

// ---------------------------------------------------------------------------
// Rappels
// ---------------------------------------------------------------------------

export interface DueReminder {
  kind: ReminderKind
  /** Clé d'idempotence : un rappel envoyé n'est jamais renvoyé. */
  idempotencyKey: string
  daysToExpiry: number
  message: string
}

/**
 * Rappels dus à une date donnée.
 *
 * Les rappels déjà émis sont passés en paramètre plutôt que devinés : rejouer
 * la fonction ne doit jamais produire un second courriel pour la même échéance.
 * Un rappel manqué (serveur arrêté le jour J-3) est rattrapé, car la condition
 * porte sur « il reste au plus N jours », pas sur « il reste exactement N jours ».
 */
export function dueReminders(
  state: SubscriptionState,
  today: string,
  alreadySentKeys: readonly string[] = [],
): DueReminder[] {
  if (state.status === 'cancelled' || state.status === 'expired') return []

  const sent = new Set(alreadySentKeys)
  const daysToExpiry = daysBetween(today, state.periodEnd)
  if (daysToExpiry < 0) return []

  const out: DueReminder[] = []

  for (const kind of ['reminder_j7', 'reminder_j3', 'reminder_j0'] as ReminderKind[]) {
    if (daysToExpiry > REMINDER_OFFSETS[kind]) continue

    const key = `${kind}:${state.periodEnd}`
    if (sent.has(key)) continue

    out.push({
      kind,
      idempotencyKey: key,
      daysToExpiry,
      message:
        kind === 'reminder_j0'
          ? 'Votre abonnement expire aujourd’hui.'
          : `Votre abonnement expire dans ${daysToExpiry} jour(s).`,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Prolongation et paiements
// ---------------------------------------------------------------------------

/**
 * Nouvelle date de fin après un paiement confirmé.
 *
 * Part de la date de fin existante tant que l'abonnement court : payer trois
 * jours avant l'échéance ne doit pas faire perdre ces trois jours. Une fois la
 * période expirée, la nouvelle période démarre au jour du paiement — facturer
 * rétroactivement une période pendant laquelle le client n'avait pas accès
 * serait indéfendable.
 */
export function extendPeriod(currentEnd: string, today: string, months: number): string {
  if (months <= 0) throw new Error('La durée de prolongation doit être strictement positive.')

  const base = daysBetween(today, currentEnd) >= 0 ? currentEnd : today
  const [y, m, d] = base.slice(0, 10).split('-').map(Number) as [number, number, number]

  const target = new Date(Date.UTC(y, m - 1 + months, d))
  // Le 31 janvier + 1 mois ne donne pas le 3 mars : on retombe sur le dernier
  // jour du mois visé.
  if (target.getUTCDate() !== d) target.setUTCDate(0)

  return target.toISOString().slice(0, 10)
}

export type PaymentOutcome = 'complet' | 'partiel' | 'excedent'

export interface PaymentClassification {
  outcome: PaymentOutcome
  totalPaid: number
  remaining: number
  /** Vrai uniquement si la période doit être prolongée. */
  renewsPeriod: boolean
  /** Montant conservé en avoir quand la période n'est pas renouvelée. */
  creditAmount: number
  message: string
}

/**
 * Classe un paiement par rapport à la facture qu'il règle.
 *
 * Ne prolonge rien par elle-même : elle indique ce que le serveur devra faire.
 * La décision reste une confirmation humaine.
 */
export function classifyPayment(
  invoiceAmount: number,
  alreadyPaid: number,
  paymentAmount: number,
): PaymentClassification {
  if (paymentAmount <= 0) {
    throw new Error('Un paiement doit porter un montant strictement positif.')
  }

  const totalPaid = round2(alreadyPaid + paymentAmount)
  const remaining = round2(Math.max(0, invoiceAmount - totalPaid))

  if (totalPaid < invoiceAmount) {
    return {
      outcome: 'partiel',
      totalPaid,
      remaining,
      renewsPeriod: false,
      creditAmount: round2(paymentAmount),
      message: `Paiement partiel : ${remaining} restant dû. Le montant reçu est conservé en avoir, la période n’est pas renouvelée.`,
    }
  }

  if (totalPaid > invoiceAmount) {
    return {
      outcome: 'excedent',
      totalPaid,
      remaining: 0,
      renewsPeriod: true,
      creditAmount: round2(totalPaid - invoiceAmount),
      message: `Facture réglée. L’excédent de ${round2(totalPaid - invoiceAmount)} est conservé en avoir.`,
    }
  }

  return {
    outcome: 'complet',
    totalPaid,
    remaining: 0,
    renewsPeriod: true,
    creditAmount: 0,
    message: 'Facture réglée intégralement.',
  }
}

/**
 * Ce qu'une déclaration de paiement par le client produit : **rien**, sinon une
 * trace en attente de vérification.
 *
 * La fonction existe pour que la règle soit testable et non seulement écrite
 * dans un commentaire.
 */
export function applyClientDeclaration(state: SubscriptionState): {
  status: SubscriptionStatus
  periodEnd: string
  changed: false
  message: string
} {
  return {
    status: state.status,
    periodEnd: state.periodEnd,
    changed: false,
    message:
      'Déclaration enregistrée. Elle sera vérifiée avant toute réactivation : une déclaration ne renouvelle jamais un abonnement à elle seule.',
  }
}

// ---------------------------------------------------------------------------
// Capacités dérivées
// ---------------------------------------------------------------------------

export interface Capabilities {
  canRead: boolean
  canWrite: boolean
  canExport: boolean
  canDeclarePayment: boolean
}

/**
 * Traduit un niveau d'accès en capacités concrètes.
 *
 * L'export reste ouvert en lecture seule **et** en blocage : retenir les
 * données d'un client en retard de paiement serait une prise d'otage, pas une
 * politique commerciale. La déclaration de paiement reste possible dans tous
 * les cas — sans quoi un client bloqué ne pourrait jamais se débloquer.
 */
export function capabilitiesFor(access: AccessLevel): Capabilities {
  return {
    canRead: true,
    canWrite: access === 'full',
    canExport: true,
    canDeclarePayment: true,
  }
}
