/**
 * Documents opérationnels : bon de transfert, bon d'avance, reçu d'achat.
 *
 * Ce sont les papiers qui sortent de l'entreprise. Un chauffeur présente un bon
 * de transfert au portail d'une usine ; un pisteur signe un bon d'avance contre
 * de l'argent liquide ; un vendeur repart avec un reçu. Ils ne sont pas des
 * exports : un export se refait, un bon signé fait foi.
 *
 * Trois règles en découlent, et elles vivent ici parce qu'elles décident du
 * contenu, pas de la mise en page.
 *
 *  · **Un document porte un numéro, et le même document porte toujours le
 *    même.** Réimprimer un bon perdu ne doit pas créer un second document
 *    valable : c'est la porte ouverte à deux retraits pour une seule avance.
 *
 *  · **Un document ne montre que ce que son porteur doit voir.** Le chauffeur a
 *    besoin du poids et de la destination ; il n'a rien à savoir du prix
 *    négocié ni de la marge. Un bon trop bavard renseigne un concurrent au
 *    premier contrôle routier.
 *
 *  · **Ce qui manque est dit.** Un bon de transfert sans ticket de pesée porte
 *    la mention « poids estimé ». Un document muet sur ses lacunes les fait
 *    passer pour des certitudes.
 */

export type DocumentKind = 'bon_transfert' | 'bon_avance' | 'recu_achat' | 'releve_pisteur'

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  bon_transfert: 'Bon de transfert',
  bon_avance: 'Bon d’avance',
  recu_achat: 'Reçu d’achat',
  releve_pisteur: 'Relevé de pisteur',
}

/** Préfixe du numéro de pièce, par nature de document. */
const NUMBER_PREFIX: Record<DocumentKind, string> = {
  bon_transfert: 'BT',
  bon_avance: 'BA',
  recu_achat: 'RA',
  releve_pisteur: 'RP',
}

/**
 * Numéro de pièce, dérivé de l'opération et non d'un compteur.
 *
 * Un compteur incrémental produirait un numéro différent à chaque réimpression
 * — deux bons pour une seule avance, donc potentiellement deux retraits. Ici le
 * numéro est une fonction de l'identifiant de l'opération : le même bon
 * réimprimé porte le même numéro, et deux opérations différentes ne peuvent pas
 * partager le leur.
 */
export function documentNumber(kind: DocumentKind, entityId: string, issuedOn: string): string {
  const year = issuedOn.slice(0, 4)
  const compact = entityId.replace(/-/g, '').toUpperCase()
  return `${NUMBER_PREFIX[kind]}-${year}-${compact.slice(0, 6)}`
}

export interface DocumentLine {
  label: string
  value: string
  /** Mis en avant : montant à payer, poids à charger. */
  strong?: boolean
}

export interface DocumentBlock {
  title: string
  lines: DocumentLine[]
}

export interface OperationalDocument {
  kind: DocumentKind
  number: string
  title: string
  issuedAt: string
  /** Nom de la personne à qui le document est remis. */
  bearer: string | null
  blocks: DocumentBlock[]
  /** Réserves : ce qui n'est pas certain doit être écrit sur le papier. */
  caveats: string[]
  /** Cases de signature. Un bon sans signature ne prouve rien. */
  signatures: string[]
  isDemoData: boolean
}

// ---------------------------------------------------------------------------
// Bon de transfert
// ---------------------------------------------------------------------------

export interface TransferDocumentInput {
  id: string
  transferNumber: string
  partnerName: string
  originSite: string | null
  destinationSite: string | null
  driverName: string | null
  driverPhone: string | null
  tractorPlate: string | null
  trailerPlate: string | null
  netLoadedKg: number | null
  bagCount: number | null
  weightSource: 'verified' | 'estimated_bags' | 'declared'
  weighingTicketPath: string | null
  dispatchedAt: string | null
  campaignName: string | null
  isDemoData?: boolean
}

const WEIGHT_SOURCE_LABEL: Record<TransferDocumentInput['weightSource'], string> = {
  verified: 'Pesé au pont-bascule',
  estimated_bags: 'Estimé au nombre de sacs',
  declared: 'Déclaré',
}

/**
 * Bon de transfert, remis au chauffeur.
 *
 * Volontairement muet sur l'argent. Le chauffeur transporte de la matière : le
 * prix négocié avec l'acheteur ne le concerne pas, et un bon qui le porte
 * renseigne un concurrent au premier contrôle routier.
 */
export function buildTransferDocument(
  input: TransferDocumentInput,
  issuedAt: string,
): OperationalDocument {
  const caveats: string[] = []

  if (input.weightSource !== 'verified') {
    caveats.push(
      `Poids ${WEIGHT_SOURCE_LABEL[input.weightSource].toLowerCase()} : il ne fait pas foi à la réception.`,
    )
  }
  if (!input.weighingTicketPath) {
    caveats.push('Aucun ticket de pesée joint au départ.')
  }
  if (input.netLoadedKg === null) {
    caveats.push('Poids chargé non renseigné au moment de l’édition.')
  }

  return {
    kind: 'bon_transfert',
    number: documentNumber('bon_transfert', input.id, issuedAt),
    title: `Bon de transfert ${input.transferNumber}`,
    issuedAt,
    bearer: input.driverName,
    blocks: [
      {
        title: 'Chargement',
        lines: [
          { label: 'Destinataire', value: input.partnerName },
          { label: 'Origine', value: input.originSite ?? '—' },
          { label: 'Destination', value: input.destinationSite ?? '—' },
          { label: 'Campagne', value: input.campaignName ?? '—' },
          {
            label: 'Départ',
            value: input.dispatchedAt ? input.dispatchedAt.slice(0, 16).replace('T', ' ') : '—',
          },
        ],
      },
      {
        title: 'Marchandise',
        lines: [
          {
            label: 'Poids net chargé',
            value: input.netLoadedKg === null ? '—' : `${formatKg(input.netLoadedKg)} kg`,
            strong: true,
          },
          { label: 'Nombre de sacs', value: input.bagCount === null ? '—' : String(input.bagCount) },
          { label: 'Origine du poids', value: WEIGHT_SOURCE_LABEL[input.weightSource] },
        ],
      },
      {
        title: 'Transport',
        lines: [
          { label: 'Chauffeur', value: input.driverName ?? '—' },
          { label: 'Téléphone', value: input.driverPhone ?? '—' },
          { label: 'Tracteur', value: input.tractorPlate ?? '—' },
          { label: 'Remorque', value: input.trailerPlate ?? '—' },
        ],
      },
    ],
    caveats,
    signatures: ['Le chargeur', 'Le chauffeur', 'Le réceptionnaire'],
    isDemoData: input.isDemoData ?? false,
  }
}

// ---------------------------------------------------------------------------
// Bon d'avance
// ---------------------------------------------------------------------------

export interface AdvanceDocumentInput {
  id: string
  reference: string
  agentName: string
  agentCode: string | null
  partnerName: string | null
  amount: number
  currency: string
  issuedAt: string
  dueDate: string | null
  paymentMethod: string
  purpose: string | null
  /** Reliquat non couvert au moment de l'édition. */
  outstandingBefore: number | null
  isDemoData?: boolean
}

/**
 * Bon d'avance, signé contre remise d'argent.
 *
 * L'exposition antérieure du pisteur y figure : celui qui signe doit savoir ce
 * qu'il doit déjà. Un bon qui ne montre que le montant du jour laisse croire
 * que c'est là tout l'engagement.
 */
export function buildAdvanceDocument(
  input: AdvanceDocumentInput,
  issuedAt: string,
): OperationalDocument {
  const caveats: string[] = []

  if (input.outstandingBefore !== null && input.outstandingBefore > 0) {
    caveats.push(
      `Reliquat non couvert avant cette avance : ${formatMoney(input.outstandingBefore)} ${input.currency}.`,
    )
  }
  if (!input.dueDate) {
    caveats.push('Aucune échéance de couverture fixée.')
  }

  return {
    kind: 'bon_avance',
    number: documentNumber('bon_avance', input.id, issuedAt),
    title: `Bon d’avance ${input.reference}`,
    issuedAt,
    bearer: input.agentName,
    blocks: [
      {
        title: 'Bénéficiaire',
        lines: [
          { label: 'Pisteur', value: input.agentName },
          { label: 'Code', value: input.agentCode ?? '—' },
          { label: 'Société', value: input.partnerName ?? 'Compte propre' },
        ],
      },
      {
        title: 'Avance',
        lines: [
          {
            label: 'Montant remis',
            value: `${formatMoney(input.amount)} ${input.currency}`,
            strong: true,
          },
          { label: 'Mode de paiement', value: input.paymentMethod },
          { label: 'Date de remise', value: input.issuedAt.slice(0, 10) },
          { label: 'À couvrir avant le', value: input.dueDate ?? '—' },
          { label: 'Objet', value: input.purpose ?? '—' },
        ],
      },
    ],
    caveats,
    signatures: ['Le remettant', 'Le pisteur bénéficiaire'],
    isDemoData: input.isDemoData ?? false,
  }
}

// ---------------------------------------------------------------------------
// Reçu d'achat
// ---------------------------------------------------------------------------

export interface PurchaseDocumentInput {
  id: string
  supplierName: string | null
  village: string | null
  agentName: string
  purchasedAt: string
  netWeightKg: number
  pricePerKg: number
  amount: number
  currency: string
  bagCount: number | null
  paymentMethod: string
  isDemoData?: boolean
}

/**
 * Reçu remis au vendeur.
 *
 * Le calcul est écrit en toutes lettres — poids × prix = montant — parce que
 * c'est là que naissent les contestations, et qu'un vendeur qui peut refaire
 * l'opération sur le papier n'a pas besoin de faire confiance.
 */
export function buildPurchaseDocument(
  input: PurchaseDocumentInput,
  issuedAt: string,
): OperationalDocument {
  const caveats: string[] = []
  const expected = Math.round(input.netWeightKg * input.pricePerKg * 100) / 100

  if (Math.abs(expected - input.amount) > 0.01) {
    // Ne jamais taire un écart de calcul sur un papier qui vaut preuve de
    // paiement : c'est exactement ce qu'une contestation viendra chercher.
    caveats.push(
      `Le montant payé diffère du produit poids × prix (${formatMoney(expected)} ${input.currency} attendu).`,
    )
  }
  if (!input.supplierName) {
    caveats.push('Vendeur non identifié dans le système.')
  }

  return {
    kind: 'recu_achat',
    number: documentNumber('recu_achat', input.id, issuedAt),
    title: 'Reçu d’achat',
    issuedAt,
    bearer: input.supplierName,
    blocks: [
      {
        title: 'Vendeur',
        lines: [
          { label: 'Nom', value: input.supplierName ?? '—' },
          { label: 'Village', value: input.village ?? '—' },
          { label: 'Acheté par', value: input.agentName },
          { label: 'Date et heure', value: input.purchasedAt.slice(0, 16).replace('T', ' ') },
        ],
      },
      {
        title: 'Détail',
        lines: [
          { label: 'Poids net', value: `${formatKg(input.netWeightKg)} kg` },
          { label: 'Prix au kilo', value: `${formatMoney(input.pricePerKg)} ${input.currency}` },
          { label: 'Nombre de sacs', value: input.bagCount === null ? '—' : String(input.bagCount) },
          {
            label: 'Montant payé',
            value: `${formatMoney(input.amount)} ${input.currency}`,
            strong: true,
          },
          { label: 'Mode de paiement', value: input.paymentMethod },
        ],
      },
    ],
    caveats,
    signatures: ['Le vendeur', 'Le pisteur'],
    isDemoData: input.isDemoData ?? false,
  }
}

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

export function formatKg(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value)
}

/** Nom du fichier produit. Le numéro de pièce s'y retrouve, pour le classement. */
export function documentFileName(document: OperationalDocument): string {
  return `${document.number}-${document.kind}.pdf`
}

/**
 * Mentions de pied, dans l'ordre où elles doivent être lues.
 *
 * La mention de démonstration passe avant tout : un document de test qui
 * circule comme un vrai est un incident, et il doit être reconnaissable au
 * premier regard.
 */
export function documentFooterLines(
  document: OperationalDocument,
  tenantFooter: string | null,
): string[] {
  const lines: string[] = []
  if (document.isDemoData) lines.push('DOCUMENT DE DÉMONSTRATION — DONNÉES FICTIVES')
  lines.push(`Pièce ${document.number} · éditée le ${document.issuedAt.slice(0, 10)}`)
  if (tenantFooter) lines.push(tenantFooter)
  return lines
}
