import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

const files = {
  loader: 'shared/uppercase.js',
  sync: 'shared/farmer-registry-sync.js',
  syncPolicy: 'shared/farmer-registry-sync-policy.js',
  assessment: 'shared/farmer-registry-assessment.js',
  passport: 'shared/farmer-registry-passport.js',
  operations: 'shared/farmer-registry-operations.js',
  evidence: 'shared/farmer-registry-evidence.js',
  guards: 'shared/farmer-registry-guards.js',
  migration: 'supabase/20260818_farmer_registry_complete.sql',
  privateEvidenceMigration: 'supabase/20260818_farmer_registry_complete_private_evidence.sql',
  performanceMigration: 'supabase/20260818_farmer_registry_complete_performance.sql',
  architecture: 'docs/farmer_passport_architecture.md',
  dictionary: 'docs/farmer_passport_data_dictionary.md',
  migrations: 'docs/farmer_passport_migrations.md',
  acceptance: 'docs/farmer_passport_acceptance_tests.md',
  limits: 'docs/farmer_passport_known_limits.md',
}

Object.values(files).forEach((file) => assert.ok(exists(file), `Fichier absent: ${file}`))

const sources = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)]),
)

for (const key of [
  'loader', 'sync', 'syncPolicy', 'assessment',
  'passport', 'operations', 'evidence', 'guards',
]) {
  new vm.Script(sources[key], { filename: files[key] })
}

for (const expected of [
  'farmer-registry-sync.js',
  'farmer-registry-sync-policy.js',
  'farmer-registry-assessment.js',
  'farmer-registry-passport.js',
  'farmer-registry-operations.js',
]) {
  assert.match(sources.loader, new RegExp(expected.replaceAll('.', '\\.')))
}
assert.match(sources.syncPolicy, /farmer-registry-evidence\.js/)
assert.match(sources.syncPolicy, /farmer-registry-guards\.js/)

assert.match(sources.passport, /AFLP Farmer Registry/)
assert.match(sources.passport, /Plans d’action/)
assert.match(sources.passport, /openFarmerPassport/)
assert.match(sources.operations, /navigator\.geolocation/)
assert.match(sources.operations, /farmer_finalize_sustainability_baseline/)
assert.match(sources.operations, /farmer_finalize_inspection/)
assert.match(sources.operations, /uploadEvidence/)
assert.match(sources.sync, /PENDING_SYNC/)
assert.match(sources.sync, /SYNC_ERROR/)
assert.match(sources.sync, /ignoreDuplicates:\s*true/)
assert.match(sources.syncPolicy, /farmer_verifications:\s*true/)
assert.match(sources.syncPolicy, /participants_formation:\s*true/)
assert.match(sources.evidence, /farmer-passport-evidence/)
assert.match(sources.evidence, /SHA-256/)
assert.match(sources.guards, /catalogue Sustainability n’est pas encore disponible/)
assert.match(sources.guards, /Vérification bloquée/)
assert.match(sources.guards, /verificationRequiresOnlineSync:\s*true/)
assert.doesNotMatch(
  sources.sync + sources.syncPolicy + sources.assessment + sources.passport
    + sources.operations + sources.evidence + sources.guards,
  /service_role|sb_secret_/i,
)

const syncContext = {
  console,
  window: null,
  navigator: { onLine: false },
  document: { addEventListener() {}, dispatchEvent() {} },
  localStorage: {
    data: new Map(),
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null },
    setItem(key, value) { this.data.set(key, value) },
  },
  CustomEvent: class {},
  crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  addEventListener() {},
  AUTH: { isConnected() { return false } },
  SB: null,
}
syncContext.window = syncContext
vm.createContext(syncContext)
vm.runInContext(sources.sync, syncContext, { filename: files.sync })
const cleanPayload = syncContext.AFLP_FARMER_REGISTRY.syncEngine.cleanPayload
const cleanedProduction = cleanPayload('farmer_production_baselines', {
  id: 'b1', campaign: '2026-2027', yield_kg_ha: 650,
  finalized_at: 'server', record_version: 4, _sync_status: 'LOCAL',
})
assert.deepEqual(JSON.parse(JSON.stringify(cleanedProduction)), {
  id: 'b1', campaign: '2026-2027',
})
const cleanedAction = cleanPayload('farmer_action_plans', {
  id: 'a1', status: 'OPEN', effective_status: 'OVERDUE', closed_at: 'server',
})
assert.deepEqual(JSON.parse(JSON.stringify(cleanedAction)), { id: 'a1', status: 'OPEN' })

const assessmentContext = { window: null }
assessmentContext.window = assessmentContext
vm.createContext(assessmentContext)
vm.runInContext(sources.assessment, assessmentContext, { filename: files.assessment })
const assessment = assessmentContext.AFLP_FARMER_REGISTRY.assessment
const catalog = [
  {
    question_code: 'D04', active: true, required: true,
    domain: 'SOCIAL_SAFETY', sequence_no: 1,
    label_fr: 'Mineurs dans des activités dangereuses',
    risk_trigger_answers: ['YES', 'UNKNOWN', 'NOT_VERIFIED'],
    risk_level: 'REVIEW_REQUIRED',
    default_corrective_action: 'Retirer immédiatement les mineurs.',
    default_priority: 'CRITICAL',
  },
  {
    question_code: 'B02', active: true, required: true,
    domain: 'ENVIRONMENT', sequence_no: 2,
    label_fr: 'Pare-feu présent',
    risk_trigger_answers: ['NO', 'PARTIAL', 'UNKNOWN', 'NOT_VERIFIED'],
    risk_level: 'HIGH',
    default_corrective_action: 'Créer un pare-feu.',
    default_priority: 'HIGH',
  },
]
const previewCritical = assessment.riskPreview(catalog, [
  { question_code: 'D04', answer: 'YES' },
  { question_code: 'B02', answer: 'YES' },
])
assert.equal(previewCritical.risk, 'REVIEW_REQUIRED')
assert.equal(previewCritical.reasons.length, 1)
assert.equal(previewCritical.reasons[0].priority, 'CRITICAL')
const previewUnknown = assessment.riskPreview(catalog, [
  { question_code: 'D04', answer: 'NO' },
  { question_code: 'B02', answer: 'UNKNOWN' },
])
assert.equal(previewUnknown.risk, 'HIGH')
assert.deepEqual(
  JSON.parse(JSON.stringify(assessment.validate(catalog, [{ question_code: 'D04', answer: 'NO' }]))),
  ['B02'],
)

const sql = [
  sources.migration,
  sources.privateEvidenceMigration,
  sources.performanceMigration,
].join('\n')
for (const table of [
  'farmer_plots', 'farmer_production_baselines',
  'farmer_sustainability_baselines', 'farmer_sustainability_answers',
  'farmer_inspections', 'farmer_inspection_answers',
  'farmer_action_plans', 'farmer_visits', 'farmer_verifications',
]) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
}
assert.match(sql, /AFLP-SUST-2026\.1/)
assert.match(sql, /UNKNOWN/)
assert.match(sql, /farmer_finalize_sustainability_baseline/)
assert.match(sql, /farmer_registry_dashboard_v/)
assert.match(sql, /farmer_registry_can_read_sensitive/)
assert.match(sql, /farmer-passport-evidence/)
assert.match(sql, /revoke all on function public\.farmer_finalize_production_baseline\(uuid\) from public, anon/i)
assert.match(sql, /grant execute on function public\.farmer_finalize_inspection\(uuid\) to authenticated/i)
assert.match(sql, /farmer_action_plans_baseline_idx/i)
assert.match(sql, /farmer_sustainability_supersedes_idx/i)
assert.match(sql, /drop index if exists public\.farmer_sust_answers_baseline_idx/i)
assert.doesNotMatch(sql, /^\s*truncate\s+table/im)
assert.doesNotMatch(sql, /^\s*drop\s+table/im)

console.log('Farmer Registry complet : syntaxe, offline, risque, garde-fous, preuves privées, performance et architecture SQL OK')