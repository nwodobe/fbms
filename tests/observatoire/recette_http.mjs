#!/usr/bin/env node
// RECETTE HTTP de l'Observatoire sur un projet Supabase ISOLÉ (Auth, PostgREST et Storage réels).
// NON EXÉCUTÉE à ce jour : aucun projet isolé n'existe. Prête à lancer dès qu'il existe.
// Refuse de s'exécuter contre la production. Aucun secret dans ce fichier : tout vient de la configuration.
//
// Usage : node tests/observatoire/recette_http.mjs chemin/recette_http.config.json
// Configuration (voir recette_http.config.exemple.json) :
//   url, anon_key, comptes { bm, uh_bro, uh_bot, auh_bro, inactif, sans_profil } = { email, mot_de_passe },
//   campagne, panel_bro, preuve_bro (chemin d'un objet du bucket pheno-preuves appartenant à BROBO)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const PROD = 'jmbdgpdthzpszfnddwzi';
const cfg = JSON.parse(readFileSync(process.argv[2] || '', 'utf8'));
if (!cfg.url || cfg.url.includes(PROD)) { console.error('REFUS : URL absente ou projet de PRODUCTION.'); process.exit(2); }
const R = [];
const rec = (id, compte, libelle, attendu, ok, obtenu) => { R.push({ id, compte, libelle, attendu, resultat: ok ? 'RÉUSSI' : 'ÉCHOUÉ', obtenu: String(obtenu).slice(0, 300) }); console.log((ok ? 'RÉUSSI ' : 'ÉCHEC  ') + id + ' ' + libelle + ' -> ' + String(obtenu).slice(0, 120)); };
const H = (jeton) => ({ apikey: cfg.anon_key, Authorization: 'Bearer ' + (jeton || cfg.anon_key), 'Content-Type': 'application/json' });

async function connexion(c) {
  const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: H(), body: JSON.stringify({ email: c.email, password: c.mot_de_passe }) });
  const j = await r.json(); if (!j.access_token) throw new Error('Connexion impossible pour ' + c.email); return j.access_token;
}
const rpc = (jeton, nom, corps) => fetch(cfg.url + '/rest/v1/rpc/' + nom, { method: 'POST', headers: H(jeton), body: JSON.stringify(corps) });
const lire = (jeton, table, filtre) => fetch(cfg.url + '/rest/v1/' + table + '?select=id' + (filtre || ''), { headers: H(jeton) });
const op = (cle, payload) => [{ idempotency_key: cle, type: 'VISITE_ENREGISTRER', payload, device_id: 'RECETTE-HTTP', created_at_client: new Date().toISOString() }];

const J = {};
for (const k of Object.keys(cfg.comptes)) J[k] = await connexion(cfg.comptes[k]);

// 1. Authentification et statut du compte
let r = await rpc(null, 'pheno_sync_batch', { p_operations: [] });
rec('H-01', 'anon', 'RPC de synchronisation sans session', 'refus 401/403/404', [401, 403, 404].includes(r.status), r.status);
r = await rpc(J.sans_profil, 'pheno_sync_batch', { p_operations: op(randomUUID(), { panel_id: cfg.panel_bro }) });
let t = await r.text(); rec('H-02', 'sans_profil', 'RPC par un compte connecté sans profil FBMS', 'aucune opération acceptée', !t.includes('"ACCEPTEE"'), r.status + ' ' + t);
r = await rpc(J.inactif, 'pheno_sync_batch', { p_operations: op(randomUUID(), { panel_id: cfg.panel_bro }) });
t = await r.text(); rec('H-03', 'inactif', 'RPC par un compte désactivé à session encore valide', 'aucune opération acceptée', !t.includes('"ACCEPTEE"'), r.status + ' ' + t);

// 2. Lecture cloisonnée par cluster et refus anonyme via PostgREST
for (const table of ['pheno_panels', 'pheno_visites', 'pheno_observations', 'pheno_graines', 'pheno_journal']) {
  r = await lire(null, table); t = await r.text();
  rec('H-04-' + table, 'anon', 'Lecture anonyme de ' + table, 'refus ou zéro ligne', r.status >= 400 || t.trim() === '[]', r.status + ' ' + t.slice(0, 80));
}
r = await lire(J.uh_bot, 'pheno_panels', '&id=eq.' + cfg.panel_bro); t = await r.text();
rec('H-05', 'uh_bot', 'Unit Head BOTRO lisant le champ BROBO', 'zéro ligne', t.trim() === '[]', r.status + ' ' + t);
r = await lire(J.uh_bro, 'pheno_panels', '&id=eq.' + cfg.panel_bro); t = await r.text();
rec('H-06', 'uh_bro', 'Unit Head BROBO lisant son champ (contrôle positif)', 'une ligne', (JSON.parse(t) || []).length === 1, r.status + ' ' + t);

// 3. Synchronisation réelle : concurrence, même clé contenu différent, campagne
const cle = randomUUID(); const vid = randomUUID();
const charge = { id: vid, panel_id: cfg.panel_bro, semaine_iso: cfg.semaine_libre, date_observation: cfg.date_libre, saisie_le: new Date().toISOString(), soumettre: false, ramassage: 'NON', observations: [] };
const [a, b] = await Promise.all([rpc(J.auh_bro, 'pheno_sync_batch', { p_operations: op(cle, charge) }), rpc(J.auh_bro, 'pheno_sync_batch', { p_operations: op(cle, charge) })]);
const ja = await a.json(), jb = await b.json();
const st = [ja, jb].map(x => (x.resultats || [])[0] || {});
rec('H-07', 'auh_bro', 'Deux envois HTTP simultanés de la même opération', 'deux accusés, une seule application', st.every(x => x.statut === 'ACCEPTEE') && st.filter(x => x.rejoue).length === 1, JSON.stringify(st));
r = await rpc(J.auh_bro, 'pheno_sync_batch', { p_operations: op(cle, { ...charge, date_observation: cfg.date_autre }) }); t = await r.text();
rec('H-08', 'auh_bro', 'Même clé, contenu différent', 'REJETEE', t.includes('REJETEE'), t);
r = await rpc(J.uh_bot, 'pheno_sync_batch', { p_operations: op(randomUUID(), { ...charge, id: randomUUID() }) }); t = await r.text();
rec('H-09', 'uh_bot', 'Agent BOTRO envoyant une visite sur un champ BROBO', 'aucune opération acceptée', !t.includes('"ACCEPTEE"'), t);

// 4. Storage réel : preuves photographiques
const obj = (jeton, p) => fetch(cfg.url + '/storage/v1/object/authenticated/pheno-preuves/' + p, { headers: H(jeton) });
r = await obj(J.uh_bot, cfg.preuve_bro); rec('H-10', 'uh_bot', 'Téléchargement d\'une preuve BROBO par un agent BOTRO', 'refus', r.status >= 400, r.status);
r = await obj(J.uh_bro, cfg.preuve_bro); rec('H-11', 'uh_bro', 'Téléchargement de sa preuve (contrôle positif)', '200', r.status === 200, r.status);
r = await fetch(cfg.url + '/storage/v1/object/public/pheno-preuves/' + cfg.preuve_bro); rec('H-12', 'anon', 'URL publique d\'une preuve', 'refus', r.status >= 400, r.status);
r = await fetch(cfg.url + '/storage/v1/object/sign/pheno-preuves/' + cfg.preuve_bro, { method: 'POST', headers: H(J.uh_bot), body: JSON.stringify({ expiresIn: 60 }) });
rec('H-13', 'uh_bot', 'Création d\'une URL signée sur une preuve hors périmètre', 'refus', r.status >= 400, r.status);
r = await fetch(cfg.url + '/storage/v1/object/pheno-preuves/' + cfg.preuve_bro.replace(/[^/]+$/, 'intrus.exe'), { method: 'POST', headers: { ...H(J.uh_bro), 'Content-Type': 'application/x-msdownload' }, body: 'MZ' });
rec('H-14', 'uh_bro', 'Dépôt d\'un exécutable dans pheno-preuves', 'refus (type)', r.status >= 400, r.status);

const ok = R.filter(x => x.resultat === 'RÉUSSI').length;
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'resultats'); mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'recette_http.json'), JSON.stringify({ date: new Date().toISOString(), cible: cfg.url, total: R.length, reussis: ok, tests: R }, null, 1));
console.log(`Recette HTTP : ${R.length} tests, ${ok} réussis, ${R.length - ok} échoués.`);
process.exit(ok === R.length ? 0 : 1);
