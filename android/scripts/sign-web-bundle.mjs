#!/usr/bin/env node
/**
 * Publication d'une mise à jour Web signée pour l'APK ANAGROCI FIELD BUYING.
 *
 *   # une seule fois, sur un poste de confiance, HORS du dépôt :
 *   node android/scripts/sign-web-bundle.mjs --generate-keys ~/cles-anagroci
 *
 *   # à chaque publication (depuis la racine, arbre propre, sur le commit à publier) :
 *   node android/scripts/sign-web-bundle.mjs --key ~/cles-anagroci/web-bundle-private.pem
 *
 *   # contrôle (CI ou relecture) : la signature et chaque empreinte correspondent-elles au dépôt ?
 *   node android/scripts/sign-web-bundle.mjs --verify [--pub android/update-keys/web-bundle-public.pem]
 *
 * Écrit android-updates/<canal>/web-bundle.json et web-bundle.json.sig, à commiter
 * puis publier par GitHub Pages avec les fichiers qu'ils décrivent.
 *
 * Refuse de signer si : l'arbre Web n'est pas propre, la clé privée est dans le
 * dépôt, le code Web ne sait pas fonctionner dans l'APK, ou une bibliothèque
 * dont la page principale a besoin manque à l'APK minimal visé.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWebFiles, fileTable, queueSchema, commitSequence, treeDirty, nativeCompatibility, requiredVendor, git, sha256 } from './web-bundle-lib.mjs';

const ANDROID = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = realpathSync(join(ANDROID, '..'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const props = Object.fromEntries(readFileSync(join(ANDROID, 'version.properties'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[a-zA-Z]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const channel = opt('--channel', 'stable');
if (!/^[a-z0-9-]+$/.test(channel)) throw new Error('Canal invalide');
const OUTDIR = join(REPO, 'android-updates', channel);
const insideRepo = (p) => { const r = resolve(p); return r === REPO || r.startsWith(REPO + sep); };
const die = (m) => { console.error('REFUS : ' + m); process.exit(1); };

if (has('--generate-keys')) {
  const dir = resolve(opt('--generate-keys'));
  if (insideRepo(dir)) die('les clés doivent être créées HORS du dépôt');
  mkdirSync(dir, { recursive: true });
  const priv = join(dir, 'web-bundle-private.pem');
  if (existsSync(priv)) die(priv + ' existe déjà : une seule clé, conservée pour toujours');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  chmodSync(priv, 0o600);
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(join(dir, 'web-bundle-public.pem'), pubPem);
  console.log(JSON.stringify({ private_key: priv, public_key: join(dir, 'web-bundle-public.pem'),
    public_key_sha256: sha256(publicKey.export({ type: 'spki', format: 'der' })),
    next: 'copier UNIQUEMENT web-bundle-public.pem vers android/update-keys/ ; sauvegarder la clé privée hors ligne' }, null, 1));
  process.exit(0);
}

if (has('--verify')) {
  const pubPath = opt('--pub', process.env.ANAGROCI_UPDATE_PUBKEY || join(ANDROID, 'update-keys', 'web-bundle-public.pem'));
  if (!existsSync(pubPath)) die('clé publique absente : ' + pubPath);
  const raw = readFileSync(join(OUTDIR, 'web-bundle.json'));
  const sig = Buffer.from(readFileSync(join(OUTDIR, 'web-bundle.json.sig'), 'utf8').trim(), 'hex');
  const ok = verify('sha256', raw, createPublicKey(readFileSync(pubPath, 'utf8')), sig);
  const m = JSON.parse(raw);
  const now = fileTable(REPO, Object.keys(m.files));
  const diff = Object.keys(m.files).filter((k) => !now[k] || now[k].sha256 !== m.files[k].sha256);
  console.log(JSON.stringify({ signature: ok ? 'valide' : 'INVALIDE', sequence: m.sequence, git_commit: m.git_commit,
    files: Object.keys(m.files).length, files_differing_from_repo: diff }, null, 1));
  process.exit(ok && diff.length === 0 ? 0 : 1);
}

const keyPath = opt('--key', process.env.ANAGROCI_WEB_BUNDLE_KEY);
if (!keyPath) die('--key <clé privée> requis');
if (insideRepo(keyPath)) die('la clé privée est DANS le dépôt : déplacez-la hors du dépôt et ne la commitez jamais');
if (treeDirty(REPO)) die('fichiers Web modifiés non commités : on ne signe que ce qui est commité');
const compat = nativeCompatibility(REPO);
if (compat.length) die('code Web incompatible avec l’APK :\n - ' + compat.join('\n - '));
const minNative = Number(opt('--min-native', props.webUpdateMinVersionCode || props.versionCode));
if (!Number.isInteger(minNative) || minNative < 1) die('--min-native invalide');

const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') die('clé ECDSA P-256 attendue');
const pubCommitted = join(ANDROID, 'update-keys', 'web-bundle-public.pem');
if (existsSync(pubCommitted)) {
  const a = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const b = createPublicKey(readFileSync(pubCommitted, 'utf8')).export({ type: 'spki', format: 'der' });
  if (!a.equals(b)) die('cette clé privée ne correspond pas à android/update-keys/web-bundle-public.pem embarquée dans les APK');
}

const commit = git(REPO, ['rev-parse', 'HEAD']);
const manifest = {
  format: 1,
  app_id: props.applicationId,
  channel,
  sequence: commitSequence(REPO),
  git_commit: commit,
  bundle_label: commit.slice(0, 7),
  created_at: new Date().toISOString(),
  min_native_version_code: minNative,
  queue_schema: queueSchema(REPO),
  required_vendor: requiredVendor(REPO),
  files: fileTable(REPO, listWebFiles(REPO)),
};
const raw = Buffer.from(JSON.stringify(manifest, null, 1) + '\n', 'utf8');
const sig = sign('sha256', raw, key);
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, 'web-bundle.json'), raw);
writeFileSync(join(OUTDIR, 'web-bundle.json.sig'), sig.toString('hex') + '\n');
console.log(JSON.stringify({ written: join('android-updates', channel), sequence: manifest.sequence, git_commit: commit,
  files: Object.keys(manifest.files).length, min_native_version_code: minNative, queue_schema: manifest.queue_schema,
  next: 'commiter android-updates/ dans une pull request ; GitHub Pages publiera manifeste et fichiers ensemble' }, null, 1));
