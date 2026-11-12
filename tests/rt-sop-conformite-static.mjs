// Contrat statique de la phase 4 SOP RT (conformité) : interface, RPC appelées, file hors connexion.
// Exécution : node tests/rt-sop-conformite-static.mjs
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('operations/rt-sop-console.js');
const html = read('operations/rt-sop-console.html');
const sql = read('supabase/20261112190000_rt_sop_conformite_corrections.sql');
const off = read('shared/offline-field.js');
const fails = [];
const must = (cond, msg) => { if (!cond) fails.push(msg); };

// Chaque RPC appelée par la console existe dans une migration SOP.
const allSql = sql + read('supabase/20261112180000_rt_sop_wave_finance.sql') + read('supabase/20261112181000_rt_sop_signed_bev_grn.sql');
for (const m of js.matchAll(/rpc\('([a-z_]+)'/g)) must(new RegExp('function public\\.' + m[1] + '\\(').test(allSql), 'RPC absente côté serveur : ' + m[1]);
// Chaque formulaire de la page est traité par submit().
for (const m of html.matchAll(/<form id="([A-Za-z]+)"/g)) must(js.includes("which==='" + m[1] + "'"), 'Formulaire non traité : ' + m[1]);
// Les dix questions du critère final sont affichées.
for (let i = 1; i <= 10; i++) must(new RegExp("line\\('" + i + '[\\.a-z–-]').test(js), 'Question ' + i + ' absente de la situation RT');
// Une absence de donnée n'est jamais affichée comme zéro.
must(/x==null\?'Non vérifié'/.test(js), "Valeur nulle affichée autrement que « Non vérifié »");
// Aucun rôle Finance inexistant en production.
must(!/Finance Officer|Accountant|Comptable/.test(js), 'Rôle Finance hors profils_role_check dans la console');
// Aucune écriture directe dans les tables financières depuis la console.
must(!/from\('(achats|avances|rt_sop_[a-z_]+)'\)\.(insert|update|delete|upsert)/.test(js), 'Écriture directe dans une table financière');
// Téléphone partagé : aucune opération enregistrée sans propriétaire.
must(/Agent non identifié sur ce téléphone/.test(off), 'Garde propriétaire absente dans offline-field.js');
// Migration : verrou BEV à l'insertion ET à la mise à jour ; GRN ANNULE exclu.
must(/before insert or update of status, document_ref/.test(sql), 'Verrou BEV limité à INSERT');
must(/upper\(coalesce\(grn\.status,''\)\)='EMIS'/.test(sql), 'GRN annulé non exclu');

if (fails.length) { console.error('ÉCHEC\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('PASS : contrat SOP RT phase 4 (' + [...js.matchAll(/rpc\('/g)].length + ' appels RPC, ' + [...html.matchAll(/<form id=/g)].length + ' formulaires)');
// Régression : l'apostrophe doit être échappée (sinon « undefined » s'affiche à la place).
{ const m = js.match(/const esc=(s=>[^\n]+);/); const esc = eval(m[1]);
  if (esc("par l'UH") !== 'par l&#39;UH') { console.error("ÉCHEC esc() apostrophe : " + esc("par l'UH")); process.exit(1); } }
