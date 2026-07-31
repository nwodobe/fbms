import { describe, expect, it } from 'vitest'
import {
  checkUpload,
  detectMimeType,
  SIGNED_URL_TTL_SECONDS,
  storagePath,
  targetDimensions,
  UPLOAD_POLICIES,
  type FileDescriptor,
} from './uploads'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])

function file(over: Partial<FileDescriptor> = {}): FileDescriptor {
  return {
    name: 'ticket.jpg',
    declaredType: 'image/jpeg',
    size: 250_000,
    head: JPEG,
    ...over,
  }
}

describe('detectMimeType', () => {
  it('reconnaît les formats attendus par leur signature', () => {
    expect(detectMimeType(JPEG)).toBe('image/jpeg')
    expect(detectMimeType(PNG)).toBe('image/png')
    expect(detectMimeType(WEBP)).toBe('image/webp')
    expect(detectMimeType(PDF)).toBe('application/pdf')
  })

  it('ne reconnaît pas un exécutable', () => {
    expect(detectMimeType(EXE)).toBeNull()
  })

  it('ne reconnaît rien dans un fichier vide', () => {
    expect(detectMimeType(new Uint8Array([]))).toBeNull()
  })
})

describe('checkUpload', () => {
  it('accepte une photo de ticket ordinaire', () => {
    const result = checkUpload(file(), 'ticket_pesee')
    expect(result.accepted).toBe(true)
    expect(result.detectedMimeType).toBe('image/jpeg')
  })

  it('refuse un exécutable renommé en image', () => {
    // Renommer charge.exe en ticket.jpg ne doit tromper personne : on lit les
    // octets, pas l'extension.
    const result = checkUpload(
      file({ name: 'ticket.jpg', declaredType: 'image/jpeg', head: EXE }),
      'ticket_pesee',
    )
    expect(result.accepted).toBe(false)
    expect(result.rejection).toBe('type_non_autorise')
    expect(result.message).toContain('non reconnu')
  })

  it('refuse un fichier dont le contenu contredit le type annoncé', () => {
    const result = checkUpload(
      file({ declaredType: 'image/png', head: JPEG }),
      'ticket_pesee',
    )
    expect(result.accepted).toBe(false)
    expect(result.rejection).toBe('type_incoherent')
    expect(result.message).toContain('JPEG')
  })

  it('refuse un format valide mais non autorisé pour cet usage', () => {
    // Un PDF est un justificatif acceptable, pas une preuve d'achat terrain.
    const result = checkUpload(
      file({ name: 'facture.pdf', declaredType: 'application/pdf', head: PDF }),
      'preuve_achat',
    )
    expect(result.accepted).toBe(false)
    expect(result.rejection).toBe('type_non_autorise')
    // Le message nomme l'usage refusé, pas seulement le format.
    expect(result.message).toContain('Preuve d’achat')
  })

  it('accepte ce même PDF comme justificatif de dépense', () => {
    const result = checkUpload(
      file({ name: 'facture.pdf', declaredType: 'application/pdf', head: PDF }),
      'justificatif_depense',
    )
    expect(result.accepted).toBe(true)
  })

  it('refuse un fichier trop volumineux, en disant quoi faire', () => {
    const result = checkUpload(file({ size: 12 * 1024 * 1024 }), 'ticket_pesee')
    expect(result.accepted).toBe(false)
    expect(result.rejection).toBe('fichier_trop_gros')
    expect(result.message).toContain('8 Mo')
    expect(result.message).toContain('de plus près')
  })

  it('applique une limite plus basse aux preuves envoyées du terrain', () => {
    // 6 Mo passe pour un ticket de pesée saisi au bureau, pas pour une preuve
    // d'achat envoyée en 2G sur le forfait du pisteur.
    const size = 6 * 1024 * 1024
    expect(checkUpload(file({ size }), 'ticket_pesee').accepted).toBe(true)
    expect(checkUpload(file({ size }), 'preuve_achat').accepted).toBe(false)
  })

  it('refuse un fichier vide', () => {
    const result = checkUpload(file({ size: 0 }), 'ticket_pesee')
    expect(result.rejection).toBe('fichier_vide')
  })

  it('accepte un SVG pour un logo, et pour lui seul', () => {
    const svg = file({ name: 'logo.svg', declaredType: 'image/svg+xml', head: new Uint8Array([0x3c]) })
    expect(checkUpload(svg, 'logo').accepted).toBe(true)
    expect(checkUpload(svg, 'ticket_pesee').accepted).toBe(false)
  })

  it('n’accepte pas un JPEG comme logo, pour éviter les fonds sales', () => {
    expect(checkUpload(file(), 'logo').accepted).toBe(false)
  })
})

describe('storagePath', () => {
  it('range sous le tenant, pour que le cloisonnement soit applicable', () => {
    const path = storagePath({
      tenantId: 'tenant-1',
      kind: 'ticket_pesee',
      entityId: 'transfer-9',
      mimeType: 'image/jpeg',
      now: new Date('2026-03-31T10:00:00Z'),
    })

    expect(path).toBe('tenant-1/ticket_pesee/2026-03-31/transfer-9.jpg')
    expect(path.startsWith('tenant-1/')).toBe(true)
  })

  it('écarte le nom d’origine du fichier', () => {
    const path = storagePath({
      tenantId: 't',
      kind: 'preuve_achat',
      entityId: 'p-1',
      mimeType: 'image/png',
      now: new Date('2026-03-31T10:00:00Z'),
    })

    // Un nom d'origine peut contenir un vendeur, une date, un montant — et se
    // retrouverait dans une URL partagée.
    expect(path).not.toContain('ticket')
    expect(path.endsWith('p-1.png')).toBe(true)
  })

  it('retombe sur une extension neutre pour un type inconnu', () => {
    const path = storagePath({
      tenantId: 't',
      kind: 'preuve_achat',
      entityId: 'p-1',
      mimeType: 'application/x-inconnu',
      now: new Date('2026-03-31T10:00:00Z'),
    })
    expect(path.endsWith('.bin')).toBe(true)
  })
})

describe('targetDimensions', () => {
  it('réduit une photo de téléphone en conservant les proportions', () => {
    const result = targetDimensions(4032, 3024, 'ticket_pesee')
    expect(result.shouldResize).toBe(true)
    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
  })

  it('ne touche pas une image déjà petite', () => {
    const result = targetDimensions(800, 600, 'ticket_pesee')
    expect(result.shouldResize).toBe(false)
    expect(result).toEqual({ width: 800, height: 600, shouldResize: false })
  })

  it('réduit davantage les preuves envoyées du terrain', () => {
    expect(targetDimensions(4032, 3024, 'preuve_achat').width).toBe(1280)
    expect(targetDimensions(4032, 3024, 'ticket_pesee').width).toBe(1600)
  })

  it('ne produit jamais une hauteur nulle', () => {
    expect(targetDimensions(4000, 1, 'preuve_achat').height).toBe(1)
  })
})

describe('politiques', () => {
  it('range tout dans des buckets privés nommés', () => {
    for (const policy of Object.values(UPLOAD_POLICIES)) {
      expect(policy.bucket).toMatch(/^(preuves|marque)$/)
      expect(policy.mimeTypes.length).toBeGreaterThan(0)
      expect(policy.maxBytes).toBeGreaterThan(0)
    }
  })

  it('garde les liens signés courts', () => {
    // Un lien qui traîne est un lien qui fuit.
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(600)
  })
})
