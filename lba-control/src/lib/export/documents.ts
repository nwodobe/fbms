/**
 * Écriture des documents opérationnels en PDF.
 *
 * Couche mince au-dessus de jsPDF : le contenu, les réserves, la numérotation
 * et les signatures vivent dans `src/domain/documents.ts` et y sont testés sans
 * navigateur. Ici on dessine, et on ne décide de rien.
 *
 * Format A5 en portrait, pas A4 : ces papiers se plient dans une poche de
 * chauffeur et se rangent dans un classeur de magasin. Un A4 pour dix lignes
 * gaspille du papier là où il coûte cher.
 */

import { headerTextOffset, isValidImageDataUrl } from '@/domain/brandmark'
import {
  documentFileName,
  documentFooterLines,
  type OperationalDocument,
} from '@/domain/documents'
import type { ExportLogo } from './brandmark'

export interface DocumentBranding {
  commercialName: string
  primaryColor: string
  documentFooter: string | null
  phone: string | null
  address: string | null
  logo?: ExportLogo | null
}

function toRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

/**
 * Dessine un document opérationnel.
 *
 * L'ordre de la page suit celui de la lecture : qui émet, quelle pièce, quoi,
 * les réserves, puis les signatures. Les réserves sont AVANT les signatures —
 * on ne signe pas un papier dont les limites sont écrites après.
 */
export async function renderDocument(
  document: OperationalDocument,
  branding: DocumentBranding,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const primary = toRgb(branding.primaryColor)
  const margin = 10

  // ---- Bandeau d'émission -------------------------------------------------
  doc.setFillColor(primary[0], primary[1], primary[2])
  doc.rect(0, 0, width, 22, 'F')

  const logo = branding.logo && isValidImageDataUrl(branding.logo.dataUrl) ? branding.logo : null
  if (logo) {
    try {
      const scale = Math.min(14 / logo.box.height, 1)
      doc.addImage(
        logo.dataUrl,
        logo.format,
        margin,
        (22 - logo.box.height * scale) / 2,
        logo.box.width * scale,
        logo.box.height * scale,
      )
    } catch {
      /* le nom commercial suffit à identifier l'émetteur. */
    }
  }

  const left = headerTextOffset(
    logo ? { width: logo.box.width * Math.min(14 / logo.box.height, 1), height: 14 } : null,
    margin,
    4,
  )

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.text(branding.commercialName, left, 9)
  doc.setFontSize(8)
  doc.text(
    [branding.phone, branding.address].filter(Boolean).join(' · ') || ' ',
    left,
    14.5,
  )

  // ---- Titre et numéro ----------------------------------------------------
  let y = 30
  doc.setTextColor(20, 20, 20)
  doc.setFontSize(13)
  doc.text(document.title, margin, y)

  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  // Le numéro est dans le coin haut droit : c'est là qu'un magasinier le
  // cherche quand il classe une pile de bons.
  doc.text(document.number, width - margin, y, { align: 'right' })
  y += 7

  if (document.bearer) {
    doc.setFontSize(9)
    doc.setTextColor(20, 20, 20)
    doc.text(`Remis à : ${document.bearer}`, margin, y)
    y += 6
  }

  // ---- Blocs --------------------------------------------------------------
  for (const block of document.blocks) {
    doc.setDrawColor(220, 220, 220)
    doc.line(margin, y, width - margin, y)
    y += 5

    doc.setFontSize(8)
    doc.setTextColor(primary[0], primary[1], primary[2])
    doc.text(block.title.toUpperCase(), margin, y)
    y += 5

    for (const line of block.lines) {
      doc.setFontSize(9)
      doc.setTextColor(110, 110, 110)
      doc.text(line.label, margin, y)

      doc.setTextColor(20, 20, 20)
      if (line.strong) doc.setFontSize(11)
      doc.text(line.value, width - margin, y, { align: 'right' })
      y += line.strong ? 7 : 5.5
    }
    y += 2
  }

  // ---- Réserves -----------------------------------------------------------
  // Avant les signatures, délibérément : on ne signe pas un papier dont les
  // limites sont écrites après.
  if (document.caveats.length > 0) {
    y += 2
    doc.setFillColor(253, 246, 236)
    const boxHeight = 5 + document.caveats.length * 4.5
    doc.rect(margin, y, width - 2 * margin, boxHeight, 'F')
    y += 4.5

    doc.setFontSize(8)
    doc.setTextColor(140, 70, 0)
    for (const caveat of document.caveats) {
      const wrapped = doc.splitTextToSize(`· ${caveat}`, width - 2 * margin - 4) as string[]
      for (const part of wrapped) {
        doc.text(part, margin + 2, y)
        y += 4
      }
    }
    y += 3
  }

  // ---- Signatures ---------------------------------------------------------
  const signatureY = Math.max(y + 6, height - 32)
  const slot = (width - 2 * margin) / document.signatures.length

  doc.setFontSize(8)
  doc.setTextColor(110, 110, 110)
  document.signatures.forEach((label, index) => {
    const x = margin + index * slot
    doc.setDrawColor(150, 150, 150)
    doc.line(x, signatureY + 12, x + slot - 6, signatureY + 12)
    doc.text(label, x, signatureY)
  })

  // ---- Pied ---------------------------------------------------------------
  const footer = documentFooterLines(document, branding.documentFooter)
  doc.setFontSize(7)
  footer.forEach((line, index) => {
    // La mention de démonstration est en rouge : un document de test qui
    // circule comme un vrai doit se repérer d'un coup d'œil.
    if (line.includes('DÉMONSTRATION')) doc.setTextColor(176, 0, 32)
    else doc.setTextColor(140, 140, 140)
    doc.text(line, margin, height - 10 + index * 3.5)
  })

  return doc.output('blob')
}

export async function downloadDocument(
  document: OperationalDocument,
  branding: DocumentBranding,
): Promise<void> {
  const blob = await renderDocument(document, branding)
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = documentFileName(document)
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
