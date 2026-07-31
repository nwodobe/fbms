/**
 * Écriture des exports PDF et Excel.
 *
 * Couche mince au-dessus de jsPDF et d'ExcelJS : toute la logique — colonnes,
 * totaux, valeurs absentes, mentions obligatoires — vit dans
 * `src/domain/reports.ts` et y est testée sans navigateur. Ce fichier ne décide
 * de rien, il dessine.
 *
 * Les deux formats sont chargés dynamiquement : jsPDF et ExcelJS pèsent
 * ensemble plus lourd que le reste de l'application, et un pisteur sur un
 * téléphone Android d'entrée de gamme n'a aucune raison de les télécharger pour
 * saisir un achat.
 */

import { headerTextOffset, isValidImageDataUrl, SHEET_LOGO_ROWS } from '@/domain/brandmark'
import {
  fileName,
  formatCell,
  headerLines,
  type Report,
  type ReportValue,
} from '@/domain/reports'
import type { ExportLogo } from './brandmark'

export interface BrandingForExport {
  commercialName: string
  primaryColor: string
  secondaryColor: string
  documentFooter: string | null
  currency: string
  /**
   * Logo déjà chargé et mis à l'échelle, ou `null`.
   *
   * Les écritures ne vont jamais le chercher elles-mêmes : un document ne doit
   * pas dépendre d'un aller-retour réseau au moment où on l'écrit. L'appelant
   * le résout avant, et se passe de lui s'il n'arrive pas.
   */
  logo?: ExportLogo | null
}

/** `#1f6f43` → `[31, 111, 67]`, forme attendue par jsPDF. */
function toRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Export PDF à la marque du tenant.
 *
 * L'en-tête reprend la couleur primaire ; le texte posé dessus est blanc ou
 * noir selon le contraste calculé en amont — la marque ne peut donc pas rendre
 * un document illisible, même quand le client choisit deux couleurs proches.
 */
export async function exportPdf(report: Report, branding: BrandingForExport): Promise<Blob> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableModule.default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const primary = toRgb(branding.primaryColor)
  const width = doc.internal.pageSize.getWidth()

  doc.setFillColor(primary[0], primary[1], primary[2])
  doc.rect(0, 0, width, 26, 'F')

  // Une donnée base64 malformée fige jsPDF au lieu de lever : elle est écartée
  // avant, pas rattrapée après.
  const logo =
    branding.logo && isValidImageDataUrl(branding.logo.dataUrl) ? branding.logo : null
  if (logo) {
    // Centré verticalement dans la bande de 26 mm. `addImage` peut échouer sur
    // une image que la mesure avait pourtant acceptée ; le document sort quand
    // même, sans logo, plutôt que pas du tout.
    try {
      doc.addImage(
        logo.dataUrl,
        logo.format,
        12,
        (26 - logo.box.height) / 2,
        logo.box.width,
        logo.box.height,
      )
    } catch {
      /* logo non posé : le nom commercial suffit à identifier l'émetteur. */
    }
  }

  const textLeft = headerTextOffset(logo ? logo.box : null)

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.text(branding.commercialName, textLeft, 11)
  doc.setFontSize(10)
  doc.text(report.meta.title, textLeft, 18)

  doc.setTextColor(60, 60, 60)
  doc.setFontSize(8)
  const lines = headerLines(report.meta).slice(2)
  lines.forEach((line, index) => doc.text(line, 12, 33 + index * 4))

  autoTable(doc, {
    head: [report.columns.map((column) => column.label)],
    body: report.rows.map((row) =>
      report.columns.map((column) =>
        formatCell(row[column.key] as ReportValue, column.kind, branding.currency),
      ),
    ),
    // `foot` est omis plutôt que passé à `undefined` : sous
    // exactOptionalPropertyTypes, les deux ne sont pas équivalents.
    ...(report.totals
      ? {
          foot: [
            report.columns.map((column, index) => {
              if (index === 0) return 'Total'
              const value = report.totals?.[column.key]
              return value === undefined
                ? ''
                : formatCell(value as ReportValue, column.kind, branding.currency)
            }),
          ],
        }
      : {}),
    startY: 34 + lines.length * 4,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: primary, textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    theme: 'grid',
  })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setFontSize(7)
    doc.setTextColor(120, 120, 120)
    const footer = branding.documentFooter ?? ''
    doc.text(footer, 12, doc.internal.pageSize.getHeight() - 8)
    doc.text(
      `${report.rowCount} ligne(s) · page ${page}/${pageCount}`,
      width - 12,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' },
    )
  }

  return doc.output('blob')
}

/**
 * Export Excel.
 *
 * Les montants sortent en **nombres**, pas en texte : un tableur dont les
 * colonnes ne se somment pas oblige le destinataire à ressaisir, et c'est à la
 * ressaisie que les chiffres se déforment. Les valeurs absentes restent des
 * cellules vides — jamais des zéros.
 */
export async function exportExcelBuffer(
  report: Report,
  branding: BrandingForExport,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default

  const workbook = new ExcelJS.Workbook()
  workbook.creator = branding.commercialName
  workbook.created = new Date(report.meta.generatedAt)

  const sheet = workbook.addWorksheet(report.meta.title.slice(0, 30))
  const argb = `FF${branding.primaryColor.replace('#', '').toUpperCase()}`

  // Le logo est posé en superposition, au-dessus des premières lignes : dans un
  // tableur, une image insérée dans une cellule décalerait les colonnes et
  // casserait les formules du destinataire.
  if (branding.logo && isValidImageDataUrl(branding.logo.dataUrl)) {
    try {
      const imageId = workbook.addImage({
        base64: branding.logo.dataUrl,
        extension: branding.logo.format === 'JPEG' ? 'jpeg' : 'png',
      })
      const ratio = branding.logo.natural.height / branding.logo.natural.width
      const height = Math.round(140 * ratio)

      // Une bande vide est réservée EN TÊTE, et l'image posée dessus. L'image
      // ne rentre pas dans une cellule : elle y décalerait les colonnes et
      // casserait les formules du destinataire. Le décalage est donc vertical,
      // d'un nombre de lignes connu et constant.
      for (let index = 0; index < SHEET_LOGO_ROWS; index += 1) {
        sheet.addRow([]).height = Math.max(18, height * 0.75)
      }

      sheet.addImage(imageId, {
        tl: { col: 0, row: 0 },
        ext: { width: 140, height },
      })
    } catch {
      /* classeur produit sans logo plutôt que pas de classeur du tout. */
    }
  }

  for (const line of headerLines(report.meta)) {
    const row = sheet.addRow([line])
    row.font = { bold: line === report.meta.title || line.includes('DÉMONSTRATION') }
    if (line.includes('DÉMONSTRATION')) {
      row.getCell(1).font = { bold: true, color: { argb: 'FFB00020' } }
    }
  }
  sheet.addRow([])

  const headerRow = sheet.addRow(report.columns.map((column) => column.label))
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  })

  const numberFormats: Record<string, string> = {
    money: '#,##0',
    weight: '#,##0.000',
    number: '#,##0.##',
    percent: '0.00"  %"',
  }

  for (const row of report.rows) {
    const cells = report.columns.map((column) => {
      const value = row[column.key]
      // Cellule vide, jamais zéro : un tableur rempli de zéros inventés se
      // somme et se moyenne sans que personne ne voie le mensonge.
      if (value === null || value === undefined || value === '') return null
      return value
    })

    const added = sheet.addRow(cells)
    report.columns.forEach((column, index) => {
      const format = numberFormats[column.kind]
      if (format) added.getCell(index + 1).numFmt = format
    })
  }

  if (report.totals) {
    const totalsRow = sheet.addRow(
      report.columns.map((column, index) => {
        if (index === 0) return 'Total'
        const value = report.totals?.[column.key]
        return value === null || value === undefined ? null : value
      }),
    )
    totalsRow.font = { bold: true }
    report.columns.forEach((column, index) => {
      const format = numberFormats[column.kind]
      if (format) totalsRow.getCell(index + 1).numFmt = format
    })
  }

  report.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width ?? Math.max(14, column.label.length + 4)
  })

  if (branding.documentFooter) {
    sheet.addRow([])
    sheet.addRow([branding.documentFooter])
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

/**
 * Même classeur, emballé pour le téléchargement.
 *
 * Le tampon est exposé séparément parce que le `Blob` de jsdom n'offre pas
 * `arrayBuffer()` : sans cette séparation, le contenu du classeur ne serait
 * vérifiable que dans un vrai navigateur — donc, en pratique, pas vérifié.
 */
export async function exportExcel(report: Report, branding: BrandingForExport): Promise<Blob> {
  const buffer = await exportExcelBuffer(report, branding)
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function downloadPdf(report: Report, branding: BrandingForExport): Promise<void> {
  triggerDownload(await exportPdf(report, branding), fileName(report.meta, 'pdf'))
}

export async function downloadExcel(report: Report, branding: BrandingForExport): Promise<void> {
  triggerDownload(await exportExcel(report, branding), fileName(report.meta, 'xlsx'))
}
