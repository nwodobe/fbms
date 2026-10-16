#!/usr/bin/env node
/**
 * Prépare le paquet Web embarqué dans l'APK ANAGROCI FIELD BUYING.
 *
 *   node android/scripts/prepare-web.mjs        (depuis la racine du dépôt)
 *
 * 1. Copie les pages et scripts de l'application Web (la MÊME version que
 *    GitHub Pages, sans aucune modification) vers android/app/src/main/assets/www.
 * 2. Télécharge depuis npm, à versions FIGÉES, les bibliothèques que les pages
 *    chargent depuis des CDN, et les polices : l'application démarre sans réseau.
 * 3. Écrit _native/bundle-manifest.json : version, commit, fichiers critiques
 *    vérifiés au démarrage, table CDN -> fichier local.
 *
 * Aucune donnée, aucun identifiant, aucune clé n'est ajouté par ce script.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWebFiles, fileTable, queueSchema, commitSequence, treeDirty, nativeCompatibility } from './web-bundle-lib.mjs';

const ANDROID = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ANDROID, '..');
const OUT = join(ANDROID, 'app', 'src', 'main', 'assets', 'www');
const CACHE = join(ANDROID, '.vendor-cache');

/* INCLUDE / EXCLUDE : voir web-bundle-lib.mjs (règle partagée avec les mises à jour signées). */

/* Bibliothèques CDN -> paquets npm figés. Les clés sont les URL exactes vues dans les pages. */
const VENDOR = [
  { pkg: '@supabase/supabase-js', version: '2.118.0', files: {
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js': 'dist/umd/supabase.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js': 'dist/umd/supabase.js' } },
  { pkg: 'leaflet', version: '1.9.4', dirs: {
      'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/': 'dist/',
      'https://unpkg.com/leaflet@1.9.4/dist/': 'dist/' }, files: {
      'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js': 'dist/leaflet.js',
      'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css': 'dist/leaflet.css' } },
  { pkg: 'exceljs', version: '4.4.0', files: {
      'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js': 'dist/exceljs.min.js' } },
  { pkg: 'xlsx', version: '0.18.5', files: {
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js': 'dist/xlsx.full.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'dist/xlsx.full.min.js' } },
  { pkg: 'chart.js', version: '4.5.1', files: {
      'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js': 'dist/chart.umd.min.js' } },
  { pkg: 'lucide', version: '1.58.0', files: {
      'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js': 'dist/umd/lucide.min.js' } },
];
const FONTS = [
  { pkg: '@fontsource/archivo', version: '5.3.0', family: 'Archivo', id: 'archivo', weights: [600, 700, 800] },
  { pkg: '@fontsource/ibm-plex-sans', version: '5.3.0', family: 'IBM Plex Sans', id: 'ibm-plex-sans', weights: [400, 500, 600, 700] },
  { pkg: '@fontsource/ibm-plex-mono', version: '5.3.0', family: 'IBM Plex Mono', id: 'ibm-plex-mono', weights: [400, 500, 600] },
];
const SUBSETS = [
  ['latin-ext', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ['latin', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
function unpack(pkg, version) {
  const dest = join(CACHE, `${pkg.replace('/', '__')}@${version}`);
  if (existsSync(join(dest, 'package', 'package.json'))) return join(dest, 'package');
  mkdirSync(dest, { recursive: true });
  const tgz = execFileSync('npm', ['pack', '--silent', `${pkg}@${version}`, '--pack-destination', dest], { encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['xzf', join(dest, tgz), '-C', dest]);
  const real = JSON.parse(readFileSync(join(dest, 'package', 'package.json'), 'utf8')).version;
  if (real !== version) throw new Error(`${pkg} : version ${real} reçue, ${version} attendue`);
  return join(dest, 'package');
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* 1. Application Web */
const compat = nativeCompatibility(REPO);
if (compat.length) throw new Error('Code Web incompatible avec l’APK :\n - ' + compat.join('\n - '));
const webFiles = listWebFiles(REPO);
let count = 0;
for (const rel of webFiles) {
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  copyFileSync(join(REPO, rel), join(OUT, rel)); count++;
}

/* 2. Bibliothèques et polices */
const vendorMap = {};
const vendorInfo = [];
for (const v of VENDOR) {
  const pkgDir = unpack(v.pkg, v.version);
  const base = `_vendor/${v.pkg.replace('/', '__')}@${v.version}/`;
  const copy = (from) => {
    const dst = join(OUT, base, from);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(pkgDir, from), dst);
    return base + from;
  };
  for (const [prefix, d] of Object.entries(v.dirs || {})) {
    for (const f of walk(join(pkgDir, d))) {
      const rel = relative(pkgDir, f).split('\\').join('/');
      if (/\.map$/.test(rel)) continue;
      vendorMap[prefix + rel.slice(d.length)] = copy(rel);
    }
  }
  for (const [url, from] of Object.entries(v.files || {})) vendorMap[url] = copy(from);
  vendorInfo.push({ package: v.pkg, version: v.version });
}
let css = '/* Polices ANAGROCI embarquées (paquets @fontsource, licence OFL). */\n';
for (const ft of FONTS) {
  const pkgDir = unpack(ft.pkg, ft.version);
  for (const w of ft.weights) for (const [sub, range] of SUBSETS) {
    const name = `${ft.id}-${sub}-${w}-normal.woff2`;
    const dst = join(OUT, '_vendor', 'fonts', name);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(pkgDir, 'files', name), dst);
    css += `@font-face{font-family:'${ft.family}';font-style:normal;font-display:swap;font-weight:${w};src:url(/_vendor/fonts/${name}) format('woff2');unicode-range:${range};}\n`;
  }
  vendorInfo.push({ package: ft.pkg, version: ft.version });
}
writeFileSync(join(OUT, '_vendor', 'fonts', 'fonts.css'), css);
vendorMap['https://fonts.googleapis.com/css'] = '_vendor/fonts/fonts.css';

/* 3. Pont natif + manifeste */
mkdirSync(join(OUT, '_native'), { recursive: true });
copyFileSync(join(ANDROID, 'native-web', 'bridge.js'), join(OUT, '_native', 'bridge.js'));

/* Fichiers critiques : tout ce que la page FIELD BUYING charge, plus les
   scripts injectés dynamiquement par auth-gate.js. Vérifiés au démarrage. */
const fb = readFileSync(join(OUT, 'operations', 'field-buying.html'), 'utf8');
const critical = new Set(['operations/field-buying.html', 'index.html', '_native/bridge.js',
  'shared/aflp-access.js', 'shared/i18n.js', 'shared/anagroci-audit.js', vendorMap['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js']]);
for (const m of fb.matchAll(/(?:src|href)="([^"]+)"/g)) {
  let u = m[1];
  if (/^https?:/.test(u)) { const k = u.startsWith('https://fonts.googleapis.com/') ? 'https://fonts.googleapis.com/css' : u; if (vendorMap[k]) critical.add(vendorMap[k]); continue; }
  u = u.split('?')[0];
  const rel = join('operations', u).split('\\').join('/').replace(/^operations\/\.\.\//, '').replace(/\/\.\//g, '/').replace(/^operations\/\.\//, 'operations/');
  if (/\.(js|css|png|webmanifest)$/.test(rel)) critical.add(rel);
}
for (const f of critical) if (!existsSync(join(OUT, f))) throw new Error('Fichier critique manquant dans le paquet : ' + f);

let commit = null;
try { commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (e) {}
const dirty = treeDirty(REPO);
const props = Object.fromEntries(readFileSync(join(ANDROID, 'version.properties'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[a-zA-Z]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
/* Numéro de version du paquet Web = date du commit. Un arbre modifié non commité
   reçoit 0 : aucune mise à jour signée ne pourra être confondue avec lui… et
   toute mise à jour signée le remplacera. Ne jamais distribuer un tel APK. */
const sequence = dirty ? 0 : commitSequence(REPO);
const manifest = {
  app: 'ANAGROCI FIELD BUYING', app_id: props.applicationId, generated_at: new Date().toISOString(),
  git_commit: commit, web_tree_dirty: dirty, file_count: count,
  sequence, bundle_label: (commit || 'local').slice(0, 7) + (dirty ? '-modifié' : ''),
  queue_schema: queueSchema(REPO),
  files: Object.fromEntries(Object.entries(fileTable(REPO, webFiles)).map(([k, v]) => [k, v.sha256])),
  critical: [...critical].sort(),
  critical_sha256: Object.fromEntries([...critical].sort().map((f) => [f, sha(join(OUT, f))])),
  vendor: vendorInfo, vendor_map: vendorMap,
};
writeFileSync(join(OUT, '_native', 'bundle-manifest.json'), JSON.stringify(manifest, null, 1));

/* 4. Source approuvée des mises à jour Web signées.
   - URL racine du site publié : variable ANAGROCI_UPDATE_ROOT_URL, ou fichier
     android/update.properties (ignoré par git) : rootUrl=https://…/
   - Clé PUBLIQUE ECDSA P-256 : android/update-keys/web-bundle-public.pem
     (ou variable ANAGROCI_UPDATE_PUBKEY = chemin). La clé privée n'est jamais ici.
   Sans l'une des deux, le mécanisme est désactivé : l'APK sert sa propre version. */
const upd = existsSync(join(ANDROID, 'update.properties')) ? Object.fromEntries(readFileSync(join(ANDROID, 'update.properties'), 'utf8')
  .split(/\r?\n/).filter((l) => /^[a-zA-Z]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()])) : {};
let rootUrl = process.env.ANAGROCI_UPDATE_ROOT_URL || upd.rootUrl || '';
const channel = process.env.ANAGROCI_UPDATE_CHANNEL || upd.channel || 'stable';
const pubPath = process.env.ANAGROCI_UPDATE_PUBKEY || join(ANDROID, 'update-keys', 'web-bundle-public.pem');
const cfg = { format: 1, app_id: props.applicationId, channel, enabled: false };
if (rootUrl && !rootUrl.endsWith('/')) rootUrl += '/';
if (!rootUrl) cfg.reason = 'aucune URL de publication fournie au build';
else if (!/^https:\/\/[^/]+\//.test(rootUrl)) cfg.reason = 'URL de publication non HTTPS';
else if (!existsSync(pubPath)) cfg.reason = 'aucune clé publique de publication fournie au build';
else {
  const { createPublicKey } = await import('node:crypto');
  const key = createPublicKey(readFileSync(pubPath, 'utf8'));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Clé publique de publication : ECDSA P-256 attendue');
  if (/PRIVATE/.test(readFileSync(pubPath, 'utf8'))) throw new Error('Le fichier de clé publique contient une clé PRIVÉE : refus');
  Object.assign(cfg, { enabled: true, web_root_url: rootUrl, manifest_url: `${rootUrl}android-updates/${channel}/web-bundle.json`,
    public_key_der_hex: key.export({ type: 'spki', format: 'der' }).toString('hex'),
    public_key_sha256: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex') });
}
writeFileSync(join(OUT, '_native', 'update-config.json'), JSON.stringify(cfg, null, 1));
const size = walk(OUT).reduce((t, f) => t + statSync(f).size, 0);
console.log(JSON.stringify({ out: relative(REPO, OUT), web_files: count, vendor_urls: Object.keys(vendorMap).length,
  critical: critical.size, size_mb: +(size / 1048576).toFixed(1), git_commit: commit, web_tree_dirty: dirty,
  sequence, queue_schema: manifest.queue_schema, updates: cfg.enabled ? { channel, public_key_sha256: cfg.public_key_sha256 } : { enabled: false, reason: cfg.reason } }, null, 1));
