/**
 * Règles de rattachement d'un justificatif à une ligne métier.
 *
 * Un téléversement ne se termine pas quand les octets sont rangés dans le
 * bucket : il se termine quand la ligne métier sait où les trouver. Entre les
 * deux il y a une écriture — `update … set proof_path = …` — et cette écriture
 * a besoin de règles, pour deux raisons distinctes :
 *
 *  · **Sécurité.** Le rattachement peut être différé (photo prise hors réseau,
 *    envoyée plus tard). Il transite donc par une file locale, sur un appareil
 *    que son porteur contrôle entièrement. Sans liste blanche, une entrée de
 *    file modifiée à la main deviendrait un « écris ce que je veux dans la
 *    colonne que je veux ». La liste ci-dessous borne ce que la file peut
 *    écrire : quatre tables, huit colonnes, toutes de type chemin de fichier.
 *
 *  · **Honnêteté.** Le chemin n'est écrit dans la ligne **qu'une fois les
 *    octets réellement stockés**. L'inverse — écrire le chemin tout de suite,
 *    téléverser ensuite — serait plus simple et produirait des justificatifs
 *    fantômes : `proof_path` renseigné, aucun fichier au bout. Une dépense
 *    passerait le contrôle de `requires_receipt_above` sans pièce jointe. Un
 *    contrôleur ouvrirait un lien mort. C'est précisément ce que le
 *    justificatif est censé empêcher.
 *
 * Ces règles sont pures et testées sans navigateur ni base : ce sont des règles
 * de sécurité, pas des détails d'interface.
 */

import type { UploadKind } from './uploads'

export type AttachmentTable =
  | 'purchases'
  | 'expenses'
  | 'transfers'
  | 'advances'
  | 'tenant_branding'

export interface AttachmentBinding {
  table: AttachmentTable
  /** Colonne de chemin à renseigner. */
  column: string
  /** Identifiant de la ligne visée. */
  rowId: string
}

interface TableBinding {
  /** Colonne d'identification de la ligne. `tenant_branding` est la seule exception à `id`. */
  keyColumn: string
  columns: readonly string[]
}

/**
 * Tout ce que la file de justificatifs a le droit d'écrire.
 *
 * Toute colonne absente d'ici est inaccessible depuis la file, quelle que soit
 * la valeur inscrite dans IndexedDB.
 */
export const ATTACHMENT_BINDINGS: Record<AttachmentTable, TableBinding> = {
  purchases: { keyColumn: 'id', columns: ['proof_path'] },
  expenses: { keyColumn: 'id', columns: ['proof_path'] },
  transfers: {
    keyColumn: 'id',
    // Deux tickets bien distincts : celui du pont-bascule au départ et celui de
    // la réception. Les confondre effacerait la moitié de la preuve d'un écart.
    columns: ['weighing_ticket_path', 'reception_ticket_path'],
  },
  advances: { keyColumn: 'id', columns: ['proof_path'] },
  tenant_branding: {
    keyColumn: 'tenant_id',
    columns: ['logo_path', 'logo_mobile_path', 'login_image_path'],
  },
}

/**
 * Quels types de fichier peuvent atterrir dans quelle colonne.
 *
 * Les politiques de téléversement diffèrent par type : 8 Mo et PDF accepté pour
 * un ticket de pesée, 1 Mo et images seulement pour un logo. Sans cette table,
 * un logo pourrait être déposé sous la politique la plus permissive, et le
 * bucket public/privé choisi serait celui de la mauvaise catégorie.
 */
const KIND_COLUMNS: Record<UploadKind, readonly string[]> = {
  ticket_pesee: ['transfers.weighing_ticket_path', 'transfers.reception_ticket_path'],
  justificatif_depense: ['expenses.proof_path', 'advances.proof_path'],
  preuve_achat: ['purchases.proof_path'],
  logo: [
    'tenant_branding.logo_path',
    'tenant_branding.logo_mobile_path',
    'tenant_branding.login_image_path',
  ],
}

export interface BindingCheck {
  allowed: boolean
  reason: string | null
}

/** Colonne d'identification de la ligne visée. */
export function keyColumnFor(table: AttachmentTable): string {
  return ATTACHMENT_BINDINGS[table].keyColumn
}

/**
 * Le rattachement demandé est-il permis ?
 *
 * Vérifié à la mise en file **et** de nouveau à l'envoi : entre les deux,
 * l'entrée a séjourné dans une base locale que l'application ne contrôle pas.
 */
export function checkBinding(kind: UploadKind, binding: AttachmentBinding): BindingCheck {
  const table = ATTACHMENT_BINDINGS[binding.table]

  if (!table) {
    return { allowed: false, reason: `Table « ${binding.table} » hors de la liste autorisée.` }
  }

  if (!table.columns.includes(binding.column)) {
    return {
      allowed: false,
      reason: `Colonne « ${binding.column} » non autorisée sur ${binding.table}.`,
    }
  }

  if (!KIND_COLUMNS[kind].includes(`${binding.table}.${binding.column}`)) {
    return {
      allowed: false,
      reason: `Un justificatif de type « ${kind} » ne se range pas dans ${binding.table}.${binding.column}.`,
    }
  }

  if (binding.rowId.trim() === '') {
    return { allowed: false, reason: 'Ligne visée non identifiée.' }
  }

  return { allowed: true, reason: null }
}

/**
 * Identité d'un emplacement de justificatif.
 *
 * Sert de clé à la file locale : re-photographier un ticket remplace le
 * fichier en attente pour le même emplacement, au lieu d'en accumuler deux dont
 * personne ne saura lequel fait foi.
 */
export function bindingKey(binding: AttachmentBinding): string {
  return `${binding.table}.${binding.column}#${binding.rowId}`
}

export type AttachmentStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface AttachmentCounts {
  pending: number
  sending: number
  sent: number
  failed: number
}

export function countAttachments(
  rows: ReadonlyArray<{ status: AttachmentStatus }>,
): AttachmentCounts {
  const counts: AttachmentCounts = { pending: 0, sending: 0, sent: 0, failed: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}

/**
 * Phrase affichée au porteur de l'appareil.
 *
 * Elle dit ce qui est vrai à cet instant, y compris quand ce n'est pas
 * rassurant : tant que les octets ne sont pas partis, la ligne métier n'a pas
 * de justificatif, et l'annoncer comme joint serait un mensonge exploitable en
 * contrôle.
 */
export function describeAttachmentState(counts: AttachmentCounts): string {
  const waiting = counts.pending + counts.sending + counts.failed

  if (waiting === 0) {
    return 'Tous les justificatifs sont envoyés.'
  }

  return (
    `${waiting} justificatif(s) conservé(s) sur cet appareil. ` +
    'Ils ne sont pas encore rattachés aux opérations : le rattachement se fera au retour du réseau.'
  )
}

/**
 * Un échec de rattachement mérite-t-il une nouvelle tentative ?
 *
 * Le cas fréquent est celui de la ligne pas encore arrivée : la photo et
 * l'achat ont été saisis hors réseau, la photo est renvoyée avant l'achat, et
 * la mise à jour ne trouve aucune ligne. Ce n'est pas une erreur, c'est un
 * ordre d'arrivée — il faut réessayer, pas abandonner.
 */
export function isAttachmentRetryable(reason: string): boolean {
  return !/non autoris|hors de la liste|ne se range pas|non identifi/i.test(reason)
}
