import { describe, expect, it } from 'vitest'
import {
  buildAdvanceDocument,
  buildPurchaseDocument,
  buildTransferDocument,
  documentFileName,
  documentFooterLines,
  documentNumber,
  type AdvanceDocumentInput,
  type PurchaseDocumentInput,
  type TransferDocumentInput,
} from './documents'

const ISSUED = '2026-03-20T10:00:00.000Z'

/**
 * Normalise les espaces avant comparaison.
 *
 * `Intl.NumberFormat('fr-FR')` sépare les milliers par une espace fine
 * insécable (U+202F), pas par une espace ordinaire. C'est la bonne typographie
 * pour un document imprimé — un montant ne doit pas se couper en fin de ligne —
 * mais elle rend toute comparaison littérale trompeuse.
 */
const espaces = (value: string): string => value.replace(/[\u202f\u00a0]/g, ' ')

const transfer = (over: Partial<TransferDocumentInput> = {}): TransferDocumentInput => ({
  id: '2b8f1e2a-0000-4000-8000-000000000001',
  transferNumber: 'TR-0001',
  partnerName: 'OLAM Côte d’Ivoire',
  originSite: 'Magasin Bouaké',
  destinationSite: 'Usine San-Pédro',
  driverName: 'DIABATE Karim',
  driverPhone: '+2250700000001',
  tractorPlate: '1234 AB 01',
  trailerPlate: '5678 CD 01',
  netLoadedKg: 32_000,
  bagCount: 400,
  weightSource: 'verified',
  weighingTicketPath: 'tenant/ticket.jpg',
  dispatchedAt: '2026-03-20T06:30:00.000Z',
  campaignName: 'Campagne 2026',
  ...over,
})

const advance = (over: Partial<AdvanceDocumentInput> = {}): AdvanceDocumentInput => ({
  id: '3c9f2e3b-0000-4000-8000-000000000002',
  reference: 'ADV-0004',
  agentName: 'KONE Ibrahim',
  agentCode: 'PIS-001',
  partnerName: 'OLAM',
  amount: 2_400_000,
  currency: 'FCFA',
  issuedAt: '2026-03-10T08:00:00.000Z',
  dueDate: '2026-03-24',
  paymentMethod: 'Espèces',
  purpose: 'Achats Béoumi',
  outstandingBefore: 0,
  ...over,
})

const purchase = (over: Partial<PurchaseDocumentInput> = {}): PurchaseDocumentInput => ({
  id: '4daf3f4c-0000-4000-8000-000000000003',
  supplierName: 'YAO Kouadio',
  village: 'Brobo',
  agentName: 'KONE Ibrahim',
  purchasedAt: '2026-03-10T08:12:00.000Z',
  netWeightKg: 8_200,
  pricePerKg: 430,
  amount: 3_526_000,
  currency: 'FCFA',
  bagCount: 102,
  paymentMethod: 'Espèces',
  ...over,
})

describe('numéro de pièce', () => {
  it('reste identique d’une réimpression à l’autre', () => {
    // Un compteur incrémental produirait deux bons pour une seule avance, donc
    // potentiellement deux retraits d'argent.
    const a = documentNumber('bon_avance', advance().id, ISSUED)
    const b = documentNumber('bon_avance', advance().id, ISSUED)
    expect(a).toBe(b)
  })

  it('distingue deux opérations différentes', () => {
    expect(documentNumber('bon_avance', 'aaaaaaaa-0000-4000-8000-000000000001', ISSUED)).not.toBe(
      documentNumber('bon_avance', 'bbbbbbbb-0000-4000-8000-000000000002', ISSUED),
    )
  })

  it('distingue deux natures de document pour la même opération', () => {
    expect(documentNumber('bon_transfert', 'abc', ISSUED)).not.toBe(
      documentNumber('recu_achat', 'abc', ISSUED),
    )
  })

  it('porte l’année d’édition', () => {
    expect(documentNumber('bon_transfert', 'abcdef', '2027-01-05')).toContain('-2027-')
  })
})

describe('bon de transfert', () => {
  it('ne dit rien de l’argent', () => {
    // Le chauffeur transporte de la matière : un bon qui porte le prix négocié
    // renseigne un concurrent au premier contrôle routier.
    const document = buildTransferDocument(transfer(), ISSUED)
    const texte = JSON.stringify(document).toLowerCase()

    expect(texte).not.toContain('prix')
    expect(texte).not.toContain('fcfa')
    expect(texte).not.toContain('marge')
  })

  it('met en avant le poids chargé', () => {
    const document = buildTransferDocument(transfer(), ISSUED)
    const ligne = document.blocks
      .flatMap((bloc) => bloc.lines)
      .find((ligne) => ligne.label === 'Poids net chargé')

    expect(ligne?.strong).toBe(true)
    expect(espaces(ligne?.value ?? '')).toBe('32 000 kg')
  })

  it('écrit sur le papier qu’un poids est estimé', () => {
    // Un document muet sur ses lacunes les fait passer pour des certitudes.
    const document = buildTransferDocument(
      transfer({ weightSource: 'estimated_bags', weighingTicketPath: null }),
      ISSUED,
    )

    expect(document.caveats.join(' ')).toMatch(/estimé au nombre de sacs/i)
    expect(document.caveats.join(' ')).toMatch(/aucun ticket de pesée/i)
  })

  it('ne porte aucune réserve quand tout est en règle', () => {
    expect(buildTransferDocument(transfer(), ISSUED).caveats).toEqual([])
  })

  it('prévoit trois signatures', () => {
    // Un bon sans signature ne prouve rien.
    expect(buildTransferDocument(transfer(), ISSUED).signatures).toEqual([
      'Le chargeur',
      'Le chauffeur',
      'Le réceptionnaire',
    ])
  })
})

describe('bon d’avance', () => {
  it('montre ce que le pisteur doit déjà', () => {
    // Un bon qui ne montre que le montant du jour laisse croire que c'est là
    // tout l'engagement.
    const document = buildAdvanceDocument(advance({ outstandingBefore: 1_500_000 }), ISSUED)
    expect(espaces(document.caveats.join(' '))).toMatch(/Reliquat non couvert.*1 500 000 FCFA/)
  })

  it('ne signale rien quand le pisteur est à jour', () => {
    expect(buildAdvanceDocument(advance({ outstandingBefore: 0 }), ISSUED).caveats).toEqual([])
  })

  it('signale l’absence d’échéance', () => {
    expect(
      buildAdvanceDocument(advance({ dueDate: null }), ISSUED).caveats.join(' '),
    ).toMatch(/Aucune échéance/)
  })

  it('met en avant le montant remis', () => {
    const ligne = buildAdvanceDocument(advance(), ISSUED)
      .blocks.flatMap((bloc) => bloc.lines)
      .find((ligne) => ligne.label === 'Montant remis')

    expect(ligne?.strong).toBe(true)
    expect(espaces(ligne?.value ?? '')).toBe('2 400 000 FCFA')
  })
})

describe('reçu d’achat', () => {
  it('permet de refaire le calcul sur le papier', () => {
    // Un vendeur qui peut refaire l'opération n'a pas besoin de faire confiance.
    const lignes = buildPurchaseDocument(purchase(), ISSUED)
      .blocks.flatMap((bloc) => bloc.lines)
      .map((ligne) => ligne.label)

    expect(lignes).toEqual(expect.arrayContaining(['Poids net', 'Prix au kilo', 'Montant payé']))
  })

  it('dénonce un montant qui ne correspond pas au produit', () => {
    // C'est exactement ce qu'une contestation viendra chercher.
    const document = buildPurchaseDocument(purchase({ amount: 3_000_000 }), ISSUED)
    expect(document.caveats.join(' ')).toMatch(/diffère du produit poids × prix/)
    expect(espaces(document.caveats.join(' '))).toContain('3 526 000')
  })

  it('accepte l’arrondi au centime sans crier', () => {
    const document = buildPurchaseDocument(
      // 1000,5 × 430,33 = 430 545,165, arrondi au centime.
      purchase({ netWeightKg: 1000.5, pricePerKg: 430.33, amount: 430_545.17 }),
      ISSUED,
    )
    expect(document.caveats).toEqual([])
  })

  it('signale un vendeur non identifié', () => {
    expect(
      buildPurchaseDocument(purchase({ supplierName: null }), ISSUED).caveats.join(' '),
    ).toMatch(/Vendeur non identifié/)
  })
})

describe('pied de page', () => {
  it('annonce la démonstration avant tout le reste', () => {
    // Un document de test qui circule comme un vrai est un incident : il doit
    // être reconnaissable au premier regard.
    const document = buildTransferDocument(transfer({ isDemoData: true }), ISSUED)
    const lignes = documentFooterLines(document, 'Pied de page du client')

    expect(lignes[0]).toContain('DÉMONSTRATION')
  })

  it('porte le numéro de pièce et la date', () => {
    const lignes = documentFooterLines(buildTransferDocument(transfer(), ISSUED), null)
    expect(lignes.join(' ')).toMatch(/Pièce BT-2026-\w+ · éditée le 2026-03-20/)
  })

  it('ajoute la mention du client quand il en a une', () => {
    const lignes = documentFooterLines(buildTransferDocument(transfer(), ISSUED), 'RCCM CI-BKE-123')
    expect(lignes).toContain('RCCM CI-BKE-123')
  })
})

describe('nom du fichier', () => {
  it('reprend le numéro de pièce, pour le classement', () => {
    const document = buildAdvanceDocument(advance(), ISSUED)
    expect(documentFileName(document)).toBe(`${document.number}-bon_avance.pdf`)
  })
})
