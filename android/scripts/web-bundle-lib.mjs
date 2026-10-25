/**
 * Règles communes au paquet Web embarqué (prepare-web.mjs) et aux mises à jour
 * signées (sign-web-bundle.mjs). Une seule définition : l'APK et la mise à jour
 * décrivent exactement le même ensemble de fichiers.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/* Ce qui part dans l'APK et dans une mise à jour : l'application Web servie par GitHub Pages. */
export const INCLUDE = ['index.html', 'logistique.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'operations', 'shared', 'assets', 'terrain', 'fbms', 'rcntrace', 'logistique', 'suite'];
/* Jamais embarqué : documentation, tests, SQL, sauvegardes, Service Worker. */
export const EXCLUDE = [/\.md$/i, /(^|\/)\.[^/]+$/, /^shared\/admin-create-user/, /\.map$/];

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

/** Liste triée des fichiers Web (chemins relatifs « / »), après exclusions. */
export function listWebFiles(repo) {
  const out = [];
  for (const item of INCLUDE) {
    const src = join(repo, item);
    if (!existsSync(src)) throw new Error('Absent du dépôt : ' + item);
    const files = statSync(src).isDirectory() ? walk(src) : [src];
    for (const f of files) {
      const rel = relative(repo, f).split('\\').join('/');
      if (!EXCLUDE.some((re) => re.test(rel))) out.push(rel);
    }
  }
  return out.sort();
}

/** Empreinte et taille de chaque fichier Web. */
export function fileTable(repo, files = listWebFiles(repo)) {
  const t = {};
  for (const rel of files) {
    const b = readFileSync(join(repo, rel));
    t[rel] = { sha256: sha256(b), size: b.length };
  }
  return t;
}

/* Bases IndexedDB qui contiennent des opérations locales non synchronisées.
   Toute évolution de leur format (nom ou version) change queue_schema : une mise à
   jour qui la porte n'est activée qu'une fois toutes les files vidées (WebBundleUpdater). */
export const QUEUE_DBS = [
  ['shared/offline-field.js', 'file Field Buying'],
  ['shared/farmer-registry-sync.js', 'file du registre producteurs (parcelles, Sustainability, inspections)'],
];

/** Format des files d'opérations locales (IndexedDB) : nom@version de chaque base, joints par « + ». */
export function queueSchema(repo) {
  return QUEUE_DBS.map(([rel, label]) => {
    const p = join(repo, rel);
    if (!existsSync(p)) throw new Error('Absent du dépôt : ' + rel + ' (' + label + ')');
    const js = readFileSync(p, 'utf8');
    const name = (js.match(/var\s+DB_NAME\s*=\s*'([^']+)'/) || [])[1];
    const ver = (js.match(/var\s+DB_VERSION\s*=\s*(\d+)/) || [])[1];
    if (!name || !ver) throw new Error('DB_NAME / DB_VERSION introuvables dans ' + rel);
    return `${name}@${ver}`;
  }).join('+');
}

/**
 * Numéro de version lisible, commun au Web et à l'APK : AAAA.MM.JJ-HHMM.<commit court>
 * (date UTC du commit). Le même commit donne toujours le même numéro.
 */
export function webVersion(repo, sequence) {
  const d = new Date(sequence * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const sha = (git(repo, ['rev-parse', '--short=7', 'HEAD']) || 'local');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.${sha}`;
}

export function git(repo, args) {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim(); } catch (e) { return null; }
}

/**
 * Numéro de version monotone : date (secondes Unix) du commit Git du contenu.
 * L'APK et une mise à jour construits depuis le même commit ont le même numéro :
 * la mise à jour est alors ignorée (rien de plus récent).
 */
export function commitSequence(repo) {
  const t = git(repo, ['log', '-1', '--format=%ct', 'HEAD']);
  if (!t || !/^\d+$/.test(t)) throw new Error('Date du commit Git introuvable');
  return Number(t);
}

export function treeDirty(repo) {
  const s = git(repo, ['status', '--porcelain', '--', ...INCLUDE]);
  return s === null ? true : s !== '';
}

/** Clé CDN telle que la calcule AssetServer.vendorKey(). */
export function vendorKey(url) {
  let u; try { u = new URL(url); } catch (e) { return null; }
  if (u.host === 'fonts.googleapis.com') return 'https://fonts.googleapis.com/css';
  if (['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'].includes(u.host)) return 'https://' + u.host + u.pathname;
  return null;
}

/** Bibliothèques externes dont la page principale de l'APK a besoin pour démarrer. */
export function requiredVendor(repo) {
  const html = readFileSync(join(repo, 'operations', 'field-buying.html'), 'utf8');
  const keys = new Set();
  for (const m of html.matchAll(/(?:src|href)="(https:[^"]+)"/g)) { const k = vendorKey(m[1]); if (k) keys.add(k); }
  return [...keys].sort();
}

/**
 * Garde de compatibilité : le code Web publié doit savoir fonctionner dans l'APK.
 * Sans elle, une mise à jour signée depuis un code Web qui ignore le shell natif
 * casserait la préparation hors ligne de tous les téléphones.
 */
export function nativeCompatibility(repo) {
  const problems = [];
  const off = readFileSync(join(repo, 'shared', 'offline-field.js'), 'utf8');
  const fb = readFileSync(join(repo, 'operations', 'field-buying.js'), 'utf8');
  if (!/function\s+nativeShell\s*\(/.test(off) || !/native_bundle/.test(off)) problems.push('shared/offline-field.js ne reconnaît pas le shell Android (nativeShell / native_bundle)');
  if (!/native_bundle\s*===\s*true/.test(fb)) problems.push('operations/field-buying.js n’accepte pas le shell Android embarqué (native_bundle===true)');
  return problems;
}
