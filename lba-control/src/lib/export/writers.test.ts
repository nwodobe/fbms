import { describe, expect, it } from 'vitest'
import { SHEET_LOGO_ROWS } from '@/domain/brandmark'
import { buildReport, type ReportColumn, type ReportMeta } from '@/domain/reports'
import { exportExcel, exportExcelBuffer, exportPdf, type BrandingForExport } from './writers'

const BRANDING: BrandingForExport = {
  commercialName: 'LBA Démonstration Bouaké',
  primaryColor: '#1f6f43',
  secondaryColor: '#b45309',
  documentFooter: 'Document de démonstration — données fictives',
  currency: 'FCFA',
}

const META: ReportMeta = {
  title: 'Achats par pisteur',
  scope: 'OLAM · campagne 2026',
  generatedAt: '2026-03-31T14:05:00.000Z',
  generatedBy: 'KOUASSI Innocent',
  tenantName: 'LBA Démonstration Bouaké',
  isDemoData: true,
}

const COLUMNS: ReportColumn[] = [
  { key: 'agent', label: 'Pisteur', kind: 'text' },
  { key: 'weight', label: 'Poids accepté', kind: 'weight' },
  { key: 'amount', label: 'Montant', kind: 'money' },
]

const REPORT = buildReport(META, COLUMNS, [
  { agent: 'KONE Ibrahim', weight: 8000, amount: 3_526_000 },
  { agent: 'TRAORE Awa', weight: null, amount: 1_720_000 },
])

describe('exportPdf', () => {
  it('produit un document non vide', async () => {
    const blob = await exportPdf(REPORT, BRANDING)
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.type).toContain('pdf')
  })

  it('fonctionne sans ligne de total', async () => {
    const empty = buildReport(META, COLUMNS, [])
    const blob = await exportPdf(empty, BRANDING)
    expect(blob.size).toBeGreaterThan(500)
  })
})

describe('exportExcel', () => {
  it('produit un classeur non vide', async () => {
    const blob = await exportExcel(REPORT, BRANDING)
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.type).toContain('spreadsheetml')
  })

  it('écrit les montants en nombres et laisse vides les valeurs absentes', async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportExcelBuffer(REPORT, BRANDING))

    const sheet = workbook.worksheets[0]!
    const header = sheet.getRow(headerRowIndex(sheet))
    expect(header.getCell(1).value).toBe('Pisteur')

    const firstData = sheet.getRow(headerRowIndex(sheet) + 1)
    // Nombre, pas texte : un tableur dont les colonnes ne se somment pas
    // oblige le destinataire à ressaisir, et la ressaisie déforme les chiffres.
    expect(typeof firstData.getCell(3).value).toBe('number')
    expect(firstData.getCell(3).value).toBe(3_526_000)

    const secondData = sheet.getRow(headerRowIndex(sheet) + 2)
    // Cellule vide, jamais zéro.
    expect(secondData.getCell(2).value).toBeNull()
  })

  it('inscrit la mention de démonstration en tête du classeur', async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportExcelBuffer(REPORT, BRANDING))

    const sheet = workbook.worksheets[0]!
    const lines: string[] = []
    sheet.eachRow((row) => lines.push(String(row.getCell(1).value ?? '')))

    expect(lines.some((line) => line.includes('DÉMONSTRATION'))).toBe(true)
  })

  it('n’ajoute aucune mention sur des données réelles', async () => {
    const ExcelJS = (await import('exceljs')).default
    const real = buildReport({ ...META, isDemoData: false }, COLUMNS, [
      { agent: 'KONE', weight: 100, amount: 500 },
    ])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportExcelBuffer(real, BRANDING))

    const lines: string[] = []
    workbook.worksheets[0]!.eachRow((row) => lines.push(String(row.getCell(1).value ?? '')))
    expect(lines.some((line) => line.includes('DÉMONSTRATION'))).toBe(false)
  })

  it('reporte le total des colonnes sommables', async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportExcelBuffer(REPORT, BRANDING))

    const sheet = workbook.worksheets[0]!
    const last = sheet.getRow(sheet.rowCount - 2)
    expect(last.getCell(1).value).toBe('Total')
    expect(last.getCell(3).value).toBe(5_246_000)
  })
})

// ---------------------------------------------------------------------------
// Logo du tenant
// ---------------------------------------------------------------------------

/** PNG 1 × 1 réel : ExcelJS et jsPDF refusent une image inventée. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const WITH_LOGO: BrandingForExport = {
  ...BRANDING,
  logo: {
    dataUrl: PNG_DATA_URL,
    format: 'PNG',
    box: { width: 20, height: 8 },
    natural: { width: 200, height: 80 },
  },
}

describe('logo du tenant dans les documents', () => {
  it('le PDF grossit lorsqu’un logo est incorporé', async () => {
    const sans = await exportPdf(REPORT, BRANDING)
    const avec = await exportPdf(REPORT, WITH_LOGO)
    expect(avec.size).toBeGreaterThan(sans.size)
  })

  it('le classeur porte l’image du client', async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportExcelBuffer(REPORT, WITH_LOGO))

    expect(workbook.model.media?.length ?? 0).toBeGreaterThan(0)
  })

  it('le logo décale les lignes d’une bande connue, jamais les colonnes', async () => {
    // Une image posée DANS une cellule décalerait les colonnes et casserait les
    // formules du destinataire. Elle occupe donc une bande réservée en tête, et
    // le décalage vertical est constant et connu.
    const ExcelJS = (await import('exceljs')).default

    const load = async (branding: BrandingForExport) => {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await exportExcelBuffer(REPORT, branding))
      return workbook.worksheets[0]!
    }

    const plain = await load(BRANDING)
    const branded = await load(WITH_LOGO)

    expect(headerRowIndex(branded)).toBe(headerRowIndex(plain) + SHEET_LOGO_ROWS)
    // Les colonnes, elles, ne bougent pas d'un pouce.
    expect(branded.getRow(headerRowIndex(branded)).getCell(1).value).toBe('Pisteur')
    expect(branded.getRow(headerRowIndex(branded) + 1).getCell(3).value).toBe(3_526_000)
  })

  it('un document sort quand même si le logo est inutilisable', async () => {
    // Refuser d'exporter parce qu'une image manque serait disproportionné : le
    // rapport est ce dont l'utilisateur a besoin, pas l'image. Et surtout : une
    // donnée base64 malformée FIGE jsPDF au lieu de lever, ce qui rendrait le
    // bouton d'export définitivement muet.
    const broken: BrandingForExport = {
      ...BRANDING,
      logo: {
        dataUrl: 'data:image/png;base64,ceci-n-est-pas-une-image',
        format: 'PNG',
        box: { width: 20, height: 8 },
        natural: { width: 200, height: 80 },
      },
    }

    const blob = await exportPdf(REPORT, broken)
    expect(blob.size).toBeGreaterThan(1000)
  })

  it('sans logo, le document reste identique à ce qu’il était', async () => {
    const explicit = await exportExcelBuffer(REPORT, { ...BRANDING, logo: null })
    const implicit = await exportExcelBuffer(REPORT, BRANDING)
    expect(explicit.byteLength).toBeGreaterThan(0)
    expect(Math.abs(explicit.byteLength - implicit.byteLength)).toBeLessThan(200)
  })
})

/** Indice de la ligne d'en-tête : le nombre de lignes de contexte varie. */
function headerRowIndex(sheet: { rowCount: number; getRow: (n: number) => { getCell: (c: number) => { value: unknown } } }): number {
  for (let index = 1; index <= sheet.rowCount; index += 1) {
    if (sheet.getRow(index).getCell(1).value === 'Pisteur') return index
  }
  throw new Error('En-tête introuvable dans le classeur exporté.')
}
