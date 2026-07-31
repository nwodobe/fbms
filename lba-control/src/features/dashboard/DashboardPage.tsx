import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { buildKpis, purchaseSeries, stockBreakdown, type Kpi } from '@/domain/dashboard'
import { formatMoney, formatWeight } from '@/domain/money'
import { buildReport, classifyExport, requiresAuditEntry, type ReportColumn } from '@/domain/reports'
import { useCampaigns } from '@/features/contracts/api'
import { usePartnerCompanies } from '@/features/partners/api'
import { useSession } from '@/lib/auth/session'
import { downloadExcel, downloadPdf } from '@/lib/export/writers'
import { supabase } from '@/lib/supabase'
import { useBranding } from '@/lib/tenant/branding'
import { useDashboard } from './api'

function renderValue(kpi: Kpi): string {
  if (kpi.value === null) return '—'
  switch (kpi.kind) {
    case 'money':
      return formatMoney(kpi.value)
    case 'weight':
      return formatWeight(kpi.value)
    case 'percent':
      return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(kpi.value)} %`
    default:
      return new Intl.NumberFormat('fr-FR').format(kpi.value)
  }
}

const EXPORT_COLUMNS: ReportColumn[] = [
  { key: 'label', label: 'Indicateur', kind: 'text', width: 34 },
  { key: 'value', label: 'Valeur', kind: 'number', width: 18 },
  { key: 'unit', label: 'Unité', kind: 'text', width: 12 },
  { key: 'sources', label: 'Lignes sources', kind: 'number', width: 16 },
  { key: 'hint', label: 'Lecture', kind: 'text', width: 60 },
]

const UNITS: Record<Kpi['kind'], string> = {
  money: 'FCFA',
  weight: 'kg',
  percent: '%',
  number: '',
}

/**
 * Écrans H02 et H03 — tableau de bord dirigeant.
 *
 * Trois partis pris :
 *
 *  · **Aucun chiffre inventé.** Un indicateur sans source affiche « — ». Un
 *    zéro par défaut se lit comme une mesure et se compare comme une mesure.
 *
 *  · **Chaque indicateur porte sa lecture et son nombre de sources.** Une
 *    moyenne sur deux lignes et une moyenne sur deux cents n'ont pas le même
 *    poids ; masquer la différence rend la première abusivement crédible.
 *
 *  · **Les jours sans achat sont absents de la courbe**, pas à zéro : une
 *    chute à zéro le dimanche ressemble à un effondrement d'activité.
 */
export function DashboardPage() {
  const { role, user } = useSession()
  const branding = useBranding()
  const { data: campaigns } = useCampaigns()
  const { data: partners } = usePartnerCompanies()

  const [campaignId, setCampaignId] = useState('')
  const [partnerCompanyId, setPartnerCompanyId] = useState('')
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useDashboard({
    campaignId: campaignId || null,
    partnerCompanyId: partnerCompanyId || null,
  })

  const kpis = data
    ? buildKpis({
        purchases: data.purchases,
        transfers: data.transfers,
        advances: data.advances,
        advanceCoverage: data.advanceCoverage,
        stock: data.stock,
        latestTcb: data.latestTcb,
        openAlerts: data.openAlerts,
        latePlans: data.latePlans,
        openIncidents: data.openIncidents,
      })
    : []

  const series = data ? purchaseSeries(data.purchases) : []
  const breakdown = data ? stockBreakdown(data.stock) : []

  const scopeLabel = [
    campaignId ? campaigns?.find((c) => c.id === campaignId)?.name : 'Toutes campagnes',
    partnerCompanyId ? partners?.find((p) => p.id === partnerCompanyId)?.name : 'Toutes sociétés',
  ].join(' · ')

  function buildExport() {
    return buildReport(
      {
        title: 'Tableau de bord',
        // Un chiffre sorti de son périmètre finit par circuler seul.
        scope: scopeLabel,
        generatedAt: new Date().toISOString(),
        generatedBy: user?.email ?? 'utilisateur',
        tenantName: branding.commercialName,
        footer: branding.documentFooter,
      },
      EXPORT_COLUMNS,
      kpis.map((kpi) => ({
        label: kpi.label,
        value: kpi.value,
        unit: UNITS[kpi.kind],
        sources: kpi.sourceCount,
        hint: kpi.hint,
      })),
    )
  }

  async function runExport(kind: 'pdf' | 'xlsx') {
    setExporting(true)
    try {
      const report = buildExport()

      // Un export de montants qui ne laisse aucune trace ne peut pas être
      // retracé après une fuite — et c'est là qu'on en a besoin. L'échec de la
      // journalisation n'empêche pas l'export : refuser de livrer ses propres
      // données parce qu'un journal est indisponible serait disproportionné.
      const scope = classifyExport(EXPORT_COLUMNS)
      if (requiresAuditEntry(scope)) {
        await supabase.rpc('log_export', {
          p_scope: scope,
          p_document: report.meta.title,
          p_rows: report.rowCount,
          p_filters: { campaign_id: campaignId || null, partner_company_id: partnerCompanyId || null },
        })
      }

      const brandingForExport = {
        commercialName: branding.commercialName,
        primaryColor: branding.primaryColor,
        secondaryColor: branding.secondaryColor,
        documentFooter: branding.documentFooter,
        currency: branding.currency,
      }
      if (kind === 'pdf') await downloadPdf(report, brandingForExport)
      else await downloadExcel(report, brandingForExport)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-muted-foreground">
            {branding.commercialName}
            {role ? ` · profil ${role.replace(/_/g, ' ')}` : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={exporting || kpis.length === 0} onClick={() => runExport('pdf')}>
            Exporter en PDF
          </Button>
          <Button variant="ghost" disabled={exporting || kpis.length === 0} onClick={() => runExport('xlsx')}>
            Exporter en Excel
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Périmètre</CardTitle>
          <CardDescription>
            Les filtres s’appliquent à tous les indicateurs, et le périmètre retenu figure sur chaque
            export.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="filter-campaign" label="Campagne">
              <select
                id="filter-campaign"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
              >
                <option value="">Toutes campagnes</option>
                {(campaigns ?? []).map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="filter-partner" label="Société">
              <select
                id="filter-partner"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={partnerCompanyId}
                onChange={(event) => setPartnerCompanyId(event.target.value)}
              >
                <option value="">Toutes sociétés</option>
                {(partners ?? []).map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      {isLoading ? (
        <p role="status" className="text-muted-foreground">
          Chargement…
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kpis.map((kpi) => (
              <Card key={kpi.key}>
                <CardHeader className="pb-2">
                  <CardDescription>{kpi.label}</CardDescription>
                  <CardTitle className="text-2xl">{renderValue(kpi)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pt-0">
                  <p className="text-xs text-muted-foreground">{kpi.hint}</p>
                  <p className="text-xs text-muted-foreground">
                    {kpi.value === null
                      ? 'Aucune donnée sur ce périmètre.'
                      : `${kpi.sourceCount} ligne(s) source(s)`}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Achats par jour</CardTitle>
              <CardDescription>
                Les jours sans achat sont absents de la courbe plutôt que ramenés à zéro : un marché
                fermé n’est pas un effondrement d’activité.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {series.length === 0 ? (
                <p className="text-muted-foreground">Aucun achat sur ce périmètre.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip
                      formatter={(value: number, name: string) =>
                        name === 'amount' ? formatMoney(value) : formatWeight(value)
                      }
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      name="Valeur achetée"
                      stroke={branding.primaryColor}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      name="Poids acheté"
                      stroke={branding.secondaryColor}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stock par état</CardTitle>
              <CardDescription>
                Les états sans volume ne sont pas représentés — une barre à zéro suggère une mesure
                faite et nulle.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {breakdown.length === 0 ? (
                <p className="text-muted-foreground">Aucun stock sur ce périmètre.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={breakdown}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(value: number) => formatWeight(value)} />
                    <Bar dataKey="quantityKg" name="Quantité" fill={branding.primaryColor} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
