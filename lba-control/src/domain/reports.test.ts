import { describe, expect, it } from 'vitest'
import {
  buildReport,
  classifyExport,
  fileName,
  formatCell,
  headerLines,
  requiresAuditEntry,
  toMatrix,
  type ReportColumn,
  type ReportMeta,
} from './reports'

const META: ReportMeta = {
  title: 'Achats par pisteur',
  scope: 'OLAM · campagne 2026 · 01/03 au 31/03',
  generatedAt: '2026-03-31T14:05:00.000Z',
  generatedBy: 'KOUASSI Innocent',
  tenantName: 'LBA Démonstration Bouaké',
  footer: 'Document interne',
}

const COLUMNS: ReportColumn[] = [
  { key: 'agent', label: 'Pisteur', kind: 'text' },
  { key: 'weight', label: 'Poids accepté', kind: 'weight' },
  { key: 'amount', label: 'Montant', kind: 'money' },
  { key: 'variance', label: 'Écart', kind: 'percent' },
]

describe('formatCell', () => {
  it('affiche « — » pour toute valeur absente, jamais 0', () => {
    for (const kind of ['money', 'weight', 'number', 'percent', 'text', 'date'] as const) {
      expect(formatCell(null, kind)).toBe('—')
      expect(formatCell(undefined, kind)).toBe('—')
      expect(formatCell('', kind)).toBe('—')
    }
  })

  it('distingue une valeur nulle mesurée d’une valeur absente', () => {
    // Zéro mesuré s'affiche ; zéro inventé n'existe pas.
    expect(formatCell(0, 'money')).toBe('0 FCFA')
    expect(formatCell(0, 'weight')).toBe('0 kg')
    expect(formatCell(null, 'money')).toBe('—')
  })

  it('formate chaque type dans son unité', () => {
    expect(formatCell(3_526_000, 'money')).toContain('FCFA')
    expect(formatCell(8000, 'weight')).toContain('kg')
    expect(formatCell(0.5, 'percent')).toBe('0,5 %')
    expect(formatCell('2026-03-31T14:05:00Z', 'date')).toBe('2026-03-31')
  })

  it('respecte la devise du tenant', () => {
    expect(formatCell(1000, 'money', 'XOF')).toContain('XOF')
  })
})

describe('buildReport', () => {
  it('totalise les colonnes sommables et laisse les autres vides', () => {
    const report = buildReport(META, COLUMNS, [
      { agent: 'KONE', weight: 8000, amount: 3_526_000, variance: 0.4 },
      { agent: 'TRAORE', weight: 4000, amount: 1_720_000, variance: 0.9 },
    ])

    expect(report.totals?.weight).toBe(12_000)
    expect(report.totals?.amount).toBe(5_246_000)
    // Additionner des pourcentages ne veut rien dire.
    expect(report.totals?.variance).toBeUndefined()
  })

  it('ne totalise pas une colonne entièrement absente', () => {
    const report = buildReport(META, COLUMNS, [
      { agent: 'KONE', weight: null, amount: 3_526_000 },
      { agent: 'TRAORE', weight: null, amount: 1_720_000 },
    ])

    // Un total de 0 kg laisserait croire à une pesée faite et nulle.
    expect(report.totals?.weight).toBeNull()
    expect(report.totals?.amount).toBe(5_246_000)
  })

  it('ignore les valeurs absentes dans un total partiel', () => {
    const report = buildReport(META, COLUMNS, [
      { agent: 'KONE', weight: 8000, amount: null },
      { agent: 'TRAORE', weight: null, amount: 1_720_000 },
    ])

    expect(report.totals?.weight).toBe(8000)
    expect(report.totals?.amount).toBe(1_720_000)
  })

  it('ne produit aucun total sur un rapport vide', () => {
    const report = buildReport(META, COLUMNS, [])
    expect(report.totals).toBeNull()
    expect(report.rowCount).toBe(0)
  })

  it('ne produit aucun total quand aucune colonne n’est sommable', () => {
    const report = buildReport(
      META,
      [
        { key: 'agent', label: 'Pisteur', kind: 'text' },
        { key: 'date', label: 'Date', kind: 'date' },
      ],
      [{ agent: 'KONE', date: '2026-03-01' }],
    )
    expect(report.totals).toBeNull()
  })

  it('n’additionne pas les valeurs textuelles glissées dans une colonne chiffrée', () => {
    const report = buildReport(META, COLUMNS, [
      { agent: 'KONE', amount: 1000 },
      { agent: 'TRAORE', amount: 'non renseigné' },
    ])
    expect(report.totals?.amount).toBe(1000)
  })

  it('compte les lignes pour rendre une troncature visible', () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ agent: `A${index}`, amount: 1 }))
    expect(buildReport(META, COLUMNS, rows).rowCount).toBe(250)
  })
})

describe('headerLines', () => {
  it('porte le tenant, l’objet, le périmètre et l’horodatage', () => {
    const lines = headerLines(META)
    expect(lines[0]).toBe('LBA Démonstration Bouaké')
    expect(lines[1]).toBe('Achats par pisteur')
    expect(lines[2]).toContain('campagne 2026')
    expect(lines[3]).toContain('2026-03-31')
    expect(lines[3]).toContain('KOUASSI Innocent')
  })

  it('signale un export de démonstration', () => {
    const lines = headerLines({ ...META, isDemoData: true })
    // Un export de démonstration transmis à une banque sans mention serait une
    // fausse déclaration.
    expect(lines.at(-1)).toContain('DÉMONSTRATION')
    expect(lines.at(-1)).toContain('non opposable')
  })

  it('n’ajoute aucune mention sur des données réelles', () => {
    expect(headerLines(META).join(' ')).not.toContain('DÉMONSTRATION')
  })
})

describe('fileName', () => {
  it('produit un nom stable, sans accent ni caractère hostile', () => {
    expect(fileName(META, 'xlsx')).toBe(
      'lba-demonstration-bouake-achats-par-pisteur-2026-03-31.xlsx',
    )
  })

  it('supporte les titres à ponctuation', () => {
    const name = fileName({ ...META, title: 'TCB & marges / société' }, 'pdf')
    expect(name).toMatch(/^[a-z0-9.-]+$/)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})

describe('toMatrix', () => {
  it('rend un tableau texte avec en-tête et ligne de total', () => {
    const report = buildReport(META, COLUMNS, [
      { agent: 'KONE', weight: 8000, amount: 3_526_000, variance: 0.4 },
    ])
    const matrix = toMatrix(report)

    expect(matrix[0]).toEqual(['Pisteur', 'Poids accepté', 'Montant', 'Écart'])
    expect(matrix[1]?.[0]).toBe('KONE')
    expect(matrix.at(-1)?.[0]).toBe('Total')
    expect(matrix.at(-1)?.[3]).toBe('')
  })

  it('propage les valeurs absentes jusque dans le document', () => {
    const report = buildReport(META, COLUMNS, [{ agent: 'KONE', weight: null, amount: null }])
    expect(toMatrix(report)[1]).toEqual(['KONE', '—', '—', '—'])
  })
})

describe('classification des exports', () => {
  it('traite un export chiffré comme sensible', () => {
    expect(classifyExport(COLUMNS)).toBe('donnees_financieres')
    expect(requiresAuditEntry('donnees_financieres')).toBe(true)
  })

  it('traite un export nominatif de pisteurs comme sensible en priorité', () => {
    expect(classifyExport(COLUMNS, true)).toBe('donnees_pisteurs')
  })

  it('n’exige pas de trace pour un export sans montant ni nom', () => {
    const scope = classifyExport([{ key: 'code', label: 'Code', kind: 'text' }])
    expect(scope).toBe('aucune')
    expect(requiresAuditEntry(scope)).toBe(false)
  })
})
