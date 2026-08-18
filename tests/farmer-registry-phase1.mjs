import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));

const enrollmentPath = 'shared/farmer-enrollment-phase1.js';
const readModelPath = 'shared/farmer-registry-read-phase1.js';
const privacyPath = 'shared/farmer-registry-privacy-phase1.js';
const loaderPath = 'shared/uppercase.js';
const coreSqlPath = 'supabase/20260818_farmer_registry_phase1_consolidated.sql';
const securitySqlPath = 'supabase/20260818_farmer_registry_phase1_security.sql';
const historySqlPath = 'supabase/20260818_farmer_registry_phase1_identity_history.sql';
const verifySqlPath = 'supabase/20260818_farmer_registry_phase1_verify.sql';

for (const file of [
  enrollmentPath, readModelPath, privacyPath, loaderPath,
  coreSqlPath, securitySqlPath, historySqlPath, verifySqlPath
]) {
  assert.ok(exists(file), `Fichier absent: ${file}`);
}

const enrollment = read(enrollmentPath);
const readModel = read(readModelPath);
const privacy = read(privacyPath);
const loader = read(loaderPath);
const coreSql = read(coreSqlPath);
const securitySql = read(securitySqlPath);
const historySql = read(historySqlPath);
const verifySql = read(verifySqlPath);

for (const [file, code] of [
  [enrollmentPath, enrollment], [readModelPath, readModel],
  [privacyPath, privacy], [loaderPath, loader]
]) {
  new vm.Script(code, { filename: file });
}

assert.match(loader, /farmer-enrollment-phase1\.js/);
assert.match(loader, /farmer-registry-read-phase1\.js/);
assert.match(loader, /farmer-registry-privacy-phase1\.js/);
assert.match(enrollment, /AFLP-DATA-CONSENT-2026\.1/);
assert.match(enrollment, /POSSIBLE DUPLICATE/);
assert.match(enrollment, /Année de naissance ou tranche d’âge obligatoire/);
assert.match(enrollment, /farmer_consents/);
assert.match(enrollment, /farmer_identity_documents/);
assert.match(enrollment, /passportCompletion/);
assert.match(enrollment, /RT sélectionné n’appartient pas au village/);
assert.match(privacy, /numéro de pièce n’a pas été conservé sur le téléphone/);
assert.match(privacy, /localIdentityNumbersPersisted:\s*false/);
assert.match(privacy, /delete safe\.pieceNum/);
assert.match(privacy, /WITHDRAWN/);
assert.doesNotMatch(enrollment + readModel + privacy, /service_role/i);
assert.doesNotMatch(enrollment + readModel + privacy, /sb_secret_/i);

assert.match(coreSql, /create table if not exists public\.farmer_consents/i);
assert.match(coreSql, /create table if not exists public\.farmer_identity_documents/i);
assert.match(coreSql, /create table if not exists public\.farmer_change_log/i);
assert.match(coreSql, /farmer_registry_set_code/i);
assert.match(coreSql, /Farmer ID est immuable/i);
assert.match(coreSql, /farmer_possible_duplicates/i);
assert.match(coreSql, /farmer_passport_summary_v/i);
assert.doesNotMatch(coreSql, /^\s*drop\s+table/im);
assert.doesNotMatch(coreSql, /^\s*truncate\s+table/im);

assert.match(securitySql, /create schema if not exists private/i);
assert.match(securitySql, /enable row level security/i);
assert.match(securitySql, /farmer_registry_scope_guard/i);
assert.match(securitySql, /revoke update, delete on public\.farmer_consents/i);
assert.match(securitySql, /farmer_identity_documents_select/i);
assert.match(historySql, /set status = case when new\.status = 'WITHDRAWN'/i);
assert.match(historySql, /supersedes_id/i);
assert.match(verifySql, /sensitive_audit_rows/i);
assert.match(verifySql, /identity_numbers_in_master/i);

const requiredDocs = [
  'docs/farmer_passport_architecture.md',
  'docs/farmer_passport_data_dictionary.md',
  'docs/farmer_passport_migrations.md',
  'docs/farmer_passport_acceptance_tests.md',
  'docs/farmer_passport_known_limits.md'
];
requiredDocs.forEach(file => assert.ok(exists(file), `Documentation absente: ${file}`));

const elements = new Map();
const modalRoot = {
  firstElementChild: null,
  querySelector() { return null; },
  addEventListener() {}
};
elements.set('modal-root', modalRoot);
const persisted = [];
const context = {
  console,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  alert() {},
  confirm() { return true; },
  crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  navigator: { onLine: false },
  document: { getElementById(id) { return elements.get(id) || null; } },
  MutationObserver: class { observe() {} },
  openProdModal() {},
  captureProdModalFields() {},
  async saveProducteur() { return 'legacy'; },
  ProducteursView() {
    return "Registre par village — l'application ne charge que les producteurs du village sélectionné.";
  },
  RemoteProducteurs: {
    async upsert(value) { return { producteur: value }; },
    async listByVillage() { return []; }
  },
  isSupabase() { return false; },
  SB: null,
  AUTH: { isConnected() { return false; }, session: {} },
  STATE: { producteurs: [], rt: [], villages: [] },
  PROD_ADAPTER: {
    async upsert(value) { persisted.push(value); },
    async list() { return []; }
  },
  closeProdModal() {},
  renderContent() {}
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(enrollment, context, { filename: enrollmentPath });
vm.runInContext(readModel, context, { filename: readModelPath });
vm.runInContext(privacy, context, { filename: privacyPath });
await new Promise(resolve => setTimeout(resolve, 320));
assert.equal(context.FARMER_ENROLLMENT_PHASE1?.installed, true);
assert.equal(context.FARMER_REGISTRY_READ_PHASE1?.installed, true);
assert.equal(context.FARMER_REGISTRY_PRIVACY_PHASE1?.installed, true);
assert.match(context.ProducteursView(), /AFLP Farmer Registry/);

await context.PROD_ADAPTER.upsert({ id: 'p-test', pieceNum: 'SECRET-001', nom: 'TEST' });
assert.equal(persisted.length, 1);
assert.equal(persisted[0].pieceNum, undefined);
assert.equal(persisted[0].nom, 'TEST');

console.log('Farmer Registry Phase 1: contrôles statiques, runtime et cache local OK');
