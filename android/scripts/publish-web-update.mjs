#!/usr/bin/env node
/**
 * Chaîne de publication des mises à jour Web de l'APK ANAGROCI FIELD BUYING (format 2).
 *
 * Source unique : le code Web du commit courant, le même que GitHub Pages publie.
 * Une exécution = contrôles -> paquet -> signature -> vérification -> journal.
 * Rien n'est publié si une étape échoue.
 *
 *   node android/scripts/publish-web-update.mjs --channel test   --key <clé privée hors dépôt> [--out <dossier>]
 *   node android/scripts/publish-web-update.mjs --channel stable --key <…> [--policy security] [--notes "…"]
 *   node android/scripts/publish-web-update.mjs --channel stable --key <…> --rollback-to <séquence>
 *   node android/scripts/publish-web-update.mjs --channel stable --key <…> --revoke <séquence>[,<séquence>]
 *   node android/scripts/publish-web-update.mjs --channel stable --verify [--pub <clé publique>]
 *
 * Dossier du canal (par défaut android-updates/<canal>/, à la racine du dépôt) :
 *   web-bundle.json(.sig)   manifeste signé de la version courante du canal
 *   version.json            identité lisible de cette version (non signé, informatif)
 *   releases.json           journal de publication (toutes les versions, statut)
 *   manifests/<n>.json(.sig) archive des manifestes signés (retour arrière)
 *   objects/aa/<sha256>     magasin immuable des fichiers, adressés par empreinte
 *
 * Les fichiers ne sont plus lus sur le site en direct : une publication Web
 * ultérieure ne peut donc ni invalider ni contaminer une version déjà signée.
 *
 * Retour arrière : --rollback-to republie le contenu d'une version archivée sous un
 * NOUVEAU numéro (les téléphones refusent tout numéro plus ancien : anti-rejeu).
 * Révocation : --revoke publie la liste des versions à ne plus utiliser ; un
 * téléphone qui en utilise une revient à la précédente au démarrage suivant.
 *
 * Clé privée : jamais dans le dépôt (refus), jamais affichée, jamais journalisée.
 * En CI : secret GitHub écrit dans un fichier temporaire (voir android/ci/).
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWebFiles, fileTable, queueSchema, commitSequence, treeDirty, nativeCompatibility, requiredVendor, git, sha256, webVersion } from './web-bundle-lib.mjs';

const ANDROID = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = realpathSync(join(ANDROID, '..'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const die = (m, code = 1) => { console.error('REFUS : ' + m); process.exit(code); };
const props = Object.fromEntries(readFileSync(join(ANDROID, 'version.properties'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[a-zA-Z]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));

const channel = opt('--channel', 'stable');
if (!/^[a-z0-9-]+$/.test(channel)) die('canal invalide');
const OUT = resolve(opt('--out', join(REPO, 'android-updates', channel)));
const insideRepo = (p) => { const r = resolve(p); return r === REPO || r.startsWith(REPO + sep); };
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return d; } };
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ contrôle */
if (has('--verify')) {
  const pubPath = opt('--pub', process.env.ANAGROCI_UPDATE_PUBKEY || join(ANDROID, 'update-keys', 'web-bundle-public.pem'));
  if (!existsSync(pubPath)) die('clé publique absente : ' + pubPath);
  const res = verifyChannel(OUT, createPublicKey(readFileSync(pubPath, 'utf8')));
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.ok ? 0 : 1);
}

/** Vérifie la signature du manifeste courant et la présence + l'empreinte de chaque objet. */
function verifyChannel(dir, pub) {
  const raw = readFileSync(join(dir, 'web-bundle.json'));
  const sig = Buffer.from(readFileSync(join(dir, 'web-bundle.json.sig'), 'utf8').trim(), 'hex');
  const signature = verify('sha256', raw, pub, sig);
  const m = JSON.parse(raw);
  const bad = [];
  for (const [rel, f] of Object.entries(m.files)) {
    const p = join(dir, m.objects_path || 'objects/', f.sha256.slice(0, 2), f.sha256);
    if (!existsSync(p)) { bad.push(rel + ' (objet absent)'); continue; }
    const b = readFileSync(p);
    if (b.length !== f.size || sha256(b) !== f.sha256) bad.push(rel + ' (empreinte)');
  }
  return { ok: signature && bad.length === 0, signature: signature ? 'valide' : 'INVALIDE', channel: m.channel,
    sequence: m.sequence, web_version: m.web_version, git_commit: m.git_commit, files: Object.keys(m.files).length, objects_invalid: bad };
}

/* -------------------------------------------------------------- publication */
const keyPath = opt('--key', process.env.ANAGROCI_WEB_BUNDLE_KEY);
if (!keyPath) die('--key <clé privée> requis (ou ANAGROCI_WEB_BUNDLE_KEY)');
if (insideRepo(keyPath)) die('la clé privée est DANS le dépôt : déplacez-la hors du dépôt et ne la commitez jamais');
const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') die('clé ECDSA P-256 attendue');
const pubPem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
const pubCommitted = opt('--expect-pub', channel === 'stable' ? join(ANDROID, 'update-keys', 'web-bundle-public.pem') : null);
if (pubCommitted && existsSync(pubCommitted)) {
  const a = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const b = createPublicKey(readFileSync(pubCommitted, 'utf8')).export({ type: 'spki', format: 'der' });
  if (!a.equals(b)) die('cette clé privée ne correspond pas à la clé publique embarquée dans les APK (' + pubCommitted + ')');
}

const policy = opt('--policy', 'recommended');
if (!['recommended', 'security'].includes(policy)) die('--policy recommended|security');
const minNative = Number(opt('--min-native', props.webUpdateMinVersionCode || props.versionCode));
if (!Number.isInteger(minNative) || minNative < 1) die('--min-native invalide');

const journalPath = join(OUT, 'releases.json');
const journal = readJson(journalPath, { channel, app_id: props.applicationId, releases: [] });
if (journal.channel !== channel) die('journal ' + journalPath + ' : canal ' + journal.channel + ' au lieu de ' + channel);
const current = readJson(join(OUT, 'web-bundle.json'), null);
const lastSeq = journal.releases.reduce((a, r) => Math.max(a, r.sequence || 0), current ? current.sequence : 0);
const revokedBefore = new Set((current && current.revoked_sequences) || []);
const toRevoke = (opt('--revoke', '') || '').split(',').filter(Boolean).map(Number);
if (toRevoke.some((n) => !Number.isInteger(n) || n <= 0)) die('--revoke : numéros invalides');
for (const n of toRevoke) {
  if (!journal.releases.some((r) => r.sequence === n)) die('--revoke : version ' + n + ' inconnue du journal');
  revokedBefore.add(n);
}

if (current && toRevoke.includes(current.sequence) && !opt('--rollback-to', null) && git(REPO, ['rev-parse', 'HEAD']) === current.git_commit)
  die('révoquer la version courante exige de publier autre chose à sa place : --rollback-to <version saine> ou un nouveau commit');

const steps = [];
const step = (name, detail) => { steps.push({ at: now(), step: name, detail }); };

let files, commit, label, sequence, rollbackOf = null, qSchema, vendor;
const rollbackTo = opt('--rollback-to', null);
if (rollbackTo) {
  /* Retour arrière : contenu archivé, nouveau numéro. Aucun test à relancer sur un
     contenu déjà publié et vérifié ; sa signature d'origine est revérifiée. */
  const n = Number(rollbackTo);
  const arch = join(OUT, 'manifests', n + '.json');
  if (!existsSync(arch)) die('--rollback-to : manifeste archivé ' + n + ' introuvable');
  const raw = readFileSync(arch);
  if (!verify('sha256', raw, createPublicKey(key), Buffer.from(readFileSync(arch + '.sig', 'utf8').trim(), 'hex'))) die('archive ' + n + ' : signature invalide');
  if (revokedBefore.has(n)) die('--rollback-to : la version ' + n + ' est révoquée');
  const old = JSON.parse(raw);
  files = old.files; commit = old.git_commit; label = old.web_version || old.bundle_label; qSchema = old.queue_schema; vendor = old.required_vendor;
  sequence = Math.max(lastSeq + 1, Math.floor(Date.now() / 1000));
  rollbackOf = n;
  step('retour arrière', 'contenu de la version ' + n + ' republié sous le numéro ' + sequence);
} else {
  /* 1. Préconditions */
  if (treeDirty(REPO)) die('fichiers Web modifiés non commités : on ne publie que ce qui est commité');
  const compat = nativeCompatibility(REPO);
  if (compat.length) die('code Web incompatible avec l’APK :\n - ' + compat.join('\n - '));
  step('préconditions', 'arbre propre, compatibilité native vérifiée');

  /* 2. Contrôles critiques : un échec bloque la diffusion */
  const gates = has('--gates') ? opt('--gates').split(';;').filter(Boolean) : [
    'node .github/scripts/verifier-js.mjs',
    'node .github/scripts/verifier-liens.mjs',
    'node tests/offline-field-static.mjs',
  ];
  for (const g of gates) {
    try { execSync(g, { cwd: REPO, stdio: 'pipe', timeout: 600000 }); step('contrôle', 'OK · ' + g); }
    catch (e) {
      const tail = String((e.stdout || '') + (e.stderr || '')).split('\n').filter(Boolean).slice(-5).join(' | ');
      die('contrôle critique en échec, publication bloquée : ' + g + (tail ? ' → ' + tail : ''), 2);
    }
  }

  commit = git(REPO, ['rev-parse', 'HEAD']);
  const cs = commitSequence(REPO);
  sequence = Math.max(cs, lastSeq + 1);
  label = webVersion(REPO, cs);
  files = fileTable(REPO, listWebFiles(REPO));
  qSchema = queueSchema(REPO);
  vendor = requiredVendor(REPO);
  if (current && current.git_commit === commit && !toRevoke.length && !has('--force')) {
    console.log(JSON.stringify({ unchanged: true, channel, sequence: current.sequence, git_commit: commit,
      message: 'ce commit est déjà la version publiée du canal : rien à publier' }, null, 1));
    process.exit(0);
  }
  if (current && current.git_commit === commit && toRevoke.length) sequence = Math.max(lastSeq + 1, cs);
}

/* 3. Magasin d'objets immuable */
let written = 0;
for (const f of Object.values(files)) {
  const dst = join(OUT, 'objects', f.sha256.slice(0, 2), f.sha256);
  if (existsSync(dst)) continue;
  const rel = Object.keys(files).find((k) => files[k].sha256 === f.sha256);
  let data;
  if (rollbackOf) die('objet ' + f.sha256 + ' absent du magasin : retour arrière impossible sans lui');
  else data = readFileSync(join(REPO, rel));
  if (sha256(data) !== f.sha256) die('empreinte divergente pendant la copie : ' + rel);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, data); written++;
}
step('objets', written + ' nouveau(x) fichier(s) dans le magasin');

/* 4. Manifeste signé */
const supabaseCompat = opt('--supabase-compat', (() => {
  try { return readdirSync(join(REPO, 'supabase')).filter((n) => /^\d{8,14}_.*\.sql$/.test(n)).sort().pop().split('_')[0]; } catch (e) { return 'inconnue'; }
})());
const manifest = {
  format: 2,
  app_id: props.applicationId,
  channel,
  sequence,
  web_version: label,
  git_commit: commit,
  bundle_label: String(commit).slice(0, 7),
  published_at: now(),
  created_at: now(),
  status: 'published',
  update_policy: policy,
  release_notes: opt('--notes', ''),
  rollback_of: rollbackOf,
  min_native_version_code: minNative,
  native: { latest_version_code: Number(props.versionCode), latest_version_name: props.versionName,
    procedure: 'Nouvel APK : demander le fichier signé au Branch Manager (canal interne), vérifier l’empreinte du certificat dans « Version et mises à jour », synchroniser jusqu’à 0 opération en attente, puis installer PAR-DESSUS l’application existante (ne jamais désinstaller).' },
  supabase_compat: supabaseCompat,
  queue_schema: qSchema,
  required_vendor: vendor,
  revoked_sequences: [...revokedBefore].sort((a, b) => a - b),
  objects_path: 'objects/',
  files,
};
const raw = Buffer.from(JSON.stringify(manifest, null, 1) + '\n', 'utf8');
const sig = sign('sha256', raw, key).toString('hex') + '\n';
if (!verify('sha256', raw, createPublicKey(key), Buffer.from(sig.trim(), 'hex'))) die('auto-vérification de la signature impossible');
mkdirSync(join(OUT, 'manifests'), { recursive: true });
writeFileSync(join(OUT, 'manifests', sequence + '.json'), raw);
writeFileSync(join(OUT, 'manifests', sequence + '.json.sig'), sig);
/* Le manifeste courant est écrit EN DERNIER : objets et archive d'abord, puis le manifeste qui les référence. */
writeFileSync(join(OUT, 'web-bundle.json'), raw);
writeFileSync(join(OUT, 'web-bundle.json.sig'), sig);
const verified = verifyChannel(OUT, createPublicKey(key));
if (!verified.ok) die('vérification après publication en échec : ' + JSON.stringify(verified));
step('signature', 'manifeste ' + sequence + ' signé et revérifié (' + verified.files + ' fichiers)');

/* 5. Identité lisible + journal */
const identity = { app_id: manifest.app_id, channel, sequence, web_version: label, git_commit: commit, published_at: manifest.published_at,
  status: 'published', update_policy: policy, min_native_version_code: minNative, native: manifest.native,
  supabase_compat: supabaseCompat, queue_schema: qSchema, rollback_of: rollbackOf, revoked_sequences: manifest.revoked_sequences };
writeFileSync(join(OUT, 'version.json'), JSON.stringify(identity, null, 1) + '\n');
for (const r of journal.releases) {
  if (manifest.revoked_sequences.includes(r.sequence)) r.status = 'revoked';
  else if (r.status === 'published') r.status = 'superseded';
}
journal.releases.push({ ...identity, files: Object.keys(files).length, objects_written: written, steps });
writeFileSync(journalPath, JSON.stringify(journal, null, 1) + '\n');
if (has('--write-root-version')) writeFileSync(join(REPO, 'version.json'), JSON.stringify({ ...identity, note: 'Version Web publiée et diffusée aux APK compatibles (canal ' + channel + ').' }, null, 1) + '\n');

console.log(JSON.stringify({ published: true, channel, out: OUT, sequence, web_version: label, git_commit: commit,
  update_policy: policy, rollback_of: rollbackOf, revoked_sequences: manifest.revoked_sequences,
  files: Object.keys(files).length, objects_written: written, min_native_version_code: minNative, queue_schema: qSchema }, null, 1));
