/**
 * Construction des rapports exportables.
 *
 * Séparé délibérément de jsPDF et d'ExcelJS : la structure d'un rapport — ses
 * colonnes, ses totaux, ses valeurs absentes — est une question métier, pas une
 * question de bibliothèque. La garder pure la rend testable sans navigateur, et
 * empêche qu'un total faux passe inaperçu parce qu'il n'apparaît que dans un
 * PDF généré.
 *
 * Deux règles tenues ici :
 *
 *  1. **Une valeur absente s'exporte « — », jamais 0.** Un tableur rempli de
 *     zéros inventés est plus dangereux qu'un tableur avec des trous : il se
 *     somme, se moyenne, et personne ne voit le mensonge.
 *
 *  2. **Tout export porte son périmètre et son horodatage.** Un chiffre sorti
 *     de son contexte finit par circuler seul ; sans la date et le filtre qui
 *     l'ont produit, il devient incontestable pour de mauvaises raisons.
 */

import { formatMoney, formatWeight, round2 } from './money'

export type CellKind = 'text' | 'money' | 'weight' | 'number' | 'percent' | 'date'

export interface ReportColumn {
  key: string
  label: string
  kind: CellKind
  /** Largeur indicative, en caractères, pour le tableur. */
  width?: number
}

export type ReportValue = string | number | null | undefined

export interface ReportRow {
  [key: string]: ReportValue
}

export interface ReportMeta {
  /** Ce que le document montre, en une phrase. */
  title: string
  /** Périmètre : société, campagne, période. Jamais implicite. */
  scope: string
  generatedAt: string
  generatedBy: string
  tenantName: string
  footer?: string | null
  /** Mention obligatoire tant que le jeu de données est celui de démonstration. */
  isDemoData?: boolean
}

export interface Report {
  meta: ReportMeta
  columns: ReportColumn[]
  rows: ReportRow[]
  /** Ligne de totaux, seulement sur les colonnes réellement sommables. */
  totals: ReportRow | null
  /** Nombre de lignes, répété pour que le lecteur voie tout de suite une troncature. */
  rowCount: number
}

const PERCENT_FORMATTER = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/** Rendu d'une cellule pour un support texte (PDF, CSV). */
export function formatCell(value: ReportValue, kind: CellKind, currency = 'FCFA'): string {
  if (value === null || value === undefined || value === '') return '—'

  switch (kind) {
    case 'money':
      return typeof value === 'number' ? formatMoney(value, currency) : String(value)
    case 'weight':
      return typeof value === 'number' ? formatWeight(value) : String(value)
    case 'percent':
      return typeof value === 'number' ? `${PERCENT_FORMATTER.format(value)} %` : String(value)
    case 'number':
      return typeof value === 'number' ? NUMBER_FORMATTER.format(value) : String(value)
    case 'date':
      return String(value).slice(0, 10)
    default:
      return String(value)
  }
}

/** Colonnes dont la somme a un sens. Additionner des pourcentages n'en a pas. */
const SUMMABLE: CellKind[] = ['money', 'weight', 'number']

/**
 * Construit un rapport et sa ligne de totaux.
 *
 * Une colonne dont toutes les valeurs sont absentes n'a pas de total : afficher
 * 0 laisserait croire à une mesure faite et nulle, plutôt qu'à une mesure
 * absente.
 */
export function buildReport(
  meta: ReportMeta,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
): Report {
  const summable = columns.filter((column) => SUMMABLE.includes(column.kind))

  let totals: ReportRow | null = null

  if (summable.length > 0 && rows.length > 0) {
    totals = {}
    let hasAnyTotal = false

    for (const column of summable) {
      const values = rows
        .map((row) => row[column.key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

      if (values.length === 0) {
        totals[column.key] = null
        continue
      }

      totals[column.key] = round2(values.reduce((sum, value) => sum + value, 0))
      hasAnyTotal = true
    }

    if (!hasAnyTotal) totals = null
  }

  return {
    meta,
    columns: [...columns],
    rows: [...rows],
    totals,
    rowCount: rows.length,
  }
}

/**
 * Lignes d'en-tête d'un document exporté.
 *
 * La mention de démonstration n'est pas décorative : un export de démonstration
 * transmis à une banque ou à une société partenaire sans être identifié comme
 * tel serait une fausse déclaration.
 */
export function headerLines(meta: ReportMeta): string[] {
  const lines = [meta.tenantName, meta.title, meta.scope]
  lines.push(`Généré le ${meta.generatedAt.slice(0, 10)} à ${meta.generatedAt.slice(11, 16)} par ${meta.generatedBy}`)
  if (meta.isDemoData) {
    lines.push('DONNÉES DE DÉMONSTRATION — document non opposable')
  }
  return lines
}

/** Nom de fichier stable, sans caractère qui casse un système de fichiers. */
export function fileName(meta: ReportMeta, extension: 'pdf' | 'xlsx'): string {
  const slug = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)

  const date = meta.generatedAt.slice(0, 10)
  return `${slug(meta.tenantName)}-${slug(meta.title)}-${date}.${extension}`
}

/**
 * Matrice texte du rapport, en-têtes comprise.
 * Utilisée telle quelle par le PDF, et vérifiée par les tests sans passer par
 * une bibliothèque de rendu.
 */
export function toMatrix(report: Report, currency = 'FCFA'): string[][] {
  const head = report.columns.map((column) => column.label)
  const body = report.rows.map((row) =>
    report.columns.map((column) => formatCell(row[column.key], column.kind, currency)),
  )

  if (report.totals) {
    body.push(
      report.columns.map((column, index) => {
        if (index === 0) return 'Total'
        const value = report.totals?.[column.key]
        return value === undefined ? '' : formatCell(value, column.kind, currency)
      }),
    )
  }

  return [head, ...body]
}

// ---------------------------------------------------------------------------
// Journal des exports sensibles
// ---------------------------------------------------------------------------

export type SensitiveScope =
  | 'donnees_financieres'
  | 'donnees_pisteurs'
  | 'donnees_partenaires'
  | 'aucune'

/**
 * Un export est sensible dès qu'il contient des montants ou des données
 * nominatives de pisteurs. Il doit alors être journalisé — pas pour surveiller
 * l'utilisateur, mais pour qu'une fuite puisse être retracée.
 */
export function classifyExport(columns: readonly ReportColumn[], hasAgentNames = false): SensitiveScope {
  if (hasAgentNames) return 'donnees_pisteurs'
  if (columns.some((column) => column.kind === 'money')) return 'donnees_financieres'
  return 'aucune'
}

export function requiresAuditEntry(scope: SensitiveScope): boolean {
  return scope !== 'aucune'
}
