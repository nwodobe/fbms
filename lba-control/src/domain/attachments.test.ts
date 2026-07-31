import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_BINDINGS,
  bindingKey,
  checkBinding,
  countAttachments,
  describeAttachmentState,
  isAttachmentRetryable,
  keyColumnFor,
  type AttachmentBinding,
} from './attachments'

const purchaseProof: AttachmentBinding = {
  table: 'purchases',
  column: 'proof_path',
  rowId: '2b8f1e2a-0000-4000-8000-000000000001',
}

describe('liste blanche des rattachements', () => {
  it('accepte une preuve d’achat sur purchases.proof_path', () => {
    expect(checkBinding('preuve_achat', purchaseProof)).toEqual({ allowed: true, reason: null })
  })

  it('refuse une colonne absente de la liste blanche', () => {
    const verdict = checkBinding('preuve_achat', { ...purchaseProof, column: 'amount' })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/non autorisée/)
  })

  it('refuse une colonne autorisée mais d’une autre catégorie de fichier', () => {
    // 8 Mo et PDF acceptés pour un ticket de pesée, 1 Mo et images seulement
    // pour un logo : croiser les deux contournerait la politique la plus stricte.
    const verdict = checkBinding('ticket_pesee', {
      table: 'tenant_branding',
      column: 'logo_path',
      rowId: 'tenant-1',
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/ne se range pas/)
  })

  it('refuse un rattachement sans ligne visée', () => {
    expect(checkBinding('preuve_achat', { ...purchaseProof, rowId: '   ' }).allowed).toBe(false)
  })

  it('distingue le ticket de départ de celui de réception', () => {
    const transfer = { table: 'transfers' as const, rowId: 'transfer-1' }
    expect(checkBinding('ticket_pesee', { ...transfer, column: 'weighing_ticket_path' }).allowed).toBe(true)
    expect(checkBinding('ticket_pesee', { ...transfer, column: 'reception_ticket_path' }).allowed).toBe(true)
  })

  it('n’autorise que des colonnes de type chemin', () => {
    // Invariant de catalogue : si une colonne d'un autre type entrait dans la
    // liste, la file deviendrait un moyen d'écrire des montants ou des statuts.
    for (const binding of Object.values(ATTACHMENT_BINDINGS)) {
      for (const column of binding.columns) {
        expect(column).toMatch(/_(path)$/)
      }
    }
  })

  it('identifie la ligne par tenant_id pour la marque, par id ailleurs', () => {
    expect(keyColumnFor('tenant_branding')).toBe('tenant_id')
    expect(keyColumnFor('purchases')).toBe('id')
    expect(keyColumnFor('transfers')).toBe('id')
  })
})

describe('identité d’un emplacement', () => {
  it('sépare deux colonnes d’une même ligne', () => {
    const a = bindingKey({ table: 'transfers', column: 'weighing_ticket_path', rowId: 'T1' })
    const b = bindingKey({ table: 'transfers', column: 'reception_ticket_path', rowId: 'T1' })
    expect(a).not.toBe(b)
  })

  it('rend la même clé pour le même emplacement', () => {
    expect(bindingKey(purchaseProof)).toBe(bindingKey({ ...purchaseProof }))
  })
})

describe('état affiché au porteur de l’appareil', () => {
  it('compte par statut', () => {
    expect(
      countAttachments([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'failed' },
        { status: 'sent' },
      ]),
    ).toEqual({ pending: 2, sending: 0, sent: 1, failed: 1 })
  })

  it('ne prétend pas qu’un justificatif est joint tant qu’il n’est pas parti', () => {
    const message = describeAttachmentState({ pending: 1, sending: 0, sent: 4, failed: 1 })
    expect(message).toMatch(/2 justificatif/)
    expect(message).toMatch(/pas encore rattachés/)
  })

  it('ne dit « tout est envoyé » que si plus rien n’attend', () => {
    expect(describeAttachmentState({ pending: 0, sending: 0, sent: 9, failed: 0 })).toMatch(
      /Tous les justificatifs sont envoyés/,
    )
  })
})

describe('nouvelle tentative', () => {
  it('réessaie quand la ligne métier n’est pas encore arrivée', () => {
    expect(isAttachmentRetryable('Aucune ligne mise à jour : opération pas encore synchronisée.')).toBe(true)
  })

  it('réessaie sur une panne de transport', () => {
    expect(isAttachmentRetryable('Failed to fetch')).toBe(true)
  })

  it('n’insiste pas sur un rattachement interdit', () => {
    expect(isAttachmentRetryable('Colonne « amount » non autorisée sur purchases.')).toBe(false)
  })
})
