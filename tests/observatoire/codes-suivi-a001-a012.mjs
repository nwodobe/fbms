/* Recette métier (sans réseau) des codes de suivi A001 à A012 — mandat du 22/11/2026.
   Mêmes règles que le serveur (supabase/20261122140000_aflp_observatoire_7_codes_suivi.sql).
   Données fictives uniquement. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const C = require('../../shared/observatoire-coeur.js');
const lire = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const panel = n => ({ blocs: n.map((x, i) => ({ id: 'B' + (i + 1), numero: i + 1, tire: true, nb_arbres_inventories: x })) });
const DIABO = panel([3, 3, 3, 3]);   // exemple du mandat : B01..B04 = 3 arbres
const avant = JSON.stringify(DIABO);
const DEFAUT = ['A001', 'A002', 'A003', 'A004', 'A005', 'A006', 'A007', 'A008', 'A009', 'A010', 'A011', 'A012'];
const choix = codes => C.proposerChoixArbres(DIABO, 10, 2).choix.map((c, i) => ({ ...c, code_suivi: codes ? codes[i] : undefined }));
let n = 0; const ok = (m) => { n++; console.log('RÉUSSI  ' + m); };

// Codes autorisés
assert.deepEqual(C.CODES_SUIVI, DEFAUT);
assert.deepEqual(C.codesParDefaut(10, 2), DEFAUT);
for (const c of DEFAUT) assert.ok(C.codeSuiviValide(c));
for (const c of ['A000', 'A013', 'A0001', 'B001', 'a', '', null, 'A12']) assert.equal(C.codeSuiviValide(c), false, c);
ok('Seuls A001 à A012 sont autorisés (A000, A013 et formats libres refusés)');

// 1. Attribution automatique
const p1 = C.proposerChoixArbres(DIABO, 10, 2);
assert.deepEqual(p1.choix.map(x => x.code_suivi), DEFAUT);
const r1 = C.designerArbres(DIABO, p1.choix, 10, 2);
assert.deepEqual(r1.erreurs, []);
assert.deepEqual(r1.arbres.map(a => a.code + '=' + a.code_suivi), [
  'B01/A001=A001', 'B01/A002=A002', 'B01/A003=A003', 'B02/A001=A004', 'B02/A002=A005', 'B02/A003=A006',
  'B03/A001=A007', 'B03/A002=A008', 'B03/A003=A009', 'B04/A001=A010', 'B04/A002=A011', 'B04/A003=A012']);
assert.equal(r1.arbres[10].role, 'RESERVE'); assert.equal(r1.arbres[11].role, 'RESERVE');
assert.equal(JSON.stringify(DIABO), avant, 'Aucun inventaire modifié');
ok('A001 à A012 attribués automatiquement : accepté (exemple DIABO du mandat, réserves R1=A011, R2=A012)');

// 2. Ordre libre
const libre = [...DEFAUT]; libre[0] = 'A008'; libre[7] = 'A001';
const r2 = C.designerArbres(DIABO, choix(libre), 10, 2);
assert.deepEqual(r2.erreurs, []);
assert.equal(r2.arbres[0].code_suivi, 'A008'); assert.equal(r2.arbres[7].code_suivi, 'A001');
assert.equal(r2.arbres[0].code, 'B01/A001', 'Le numéro physique n’est pas remplacé par le code de suivi');
assert.equal(r2.arbres[0].id, r1.arbres[0].id, 'Identifiant technique indépendant du code de suivi');
ok('A001 à A012 dans un ordre différent (A008 au suivi 01, A001 au suivi 08) : accepté, id et code physique inchangés');

// 3. Doublon de code
const dbl = [...DEFAUT]; dbl[1] = 'A005';
assert.match(C.designerArbres(DIABO, choix(dbl), 10, 2).erreurs.join(' '), /A005 est attribué à deux arbres/);
assert.deepEqual(C.controlerCodesSuivi(dbl, 12).doublons, ['A005']);
assert.deepEqual(C.controlerCodesSuivi(dbl, 12).manquants, ['A002']);
ok('Deux arbres portant A005 : refusé (doublon et code manquant A002 signalés)');

// 4. Même arbre physique deux fois
const meme = choix(DEFAUT); meme[1] = { ...meme[0], code_suivi: 'A002' };
assert.match(C.designerArbres(DIABO, meme, 10, 2).erreurs.join(' '), /choisi deux fois/);
ok('Deux lignes désignant le même arbre physique : refusé');

// 5-6. A013 et A000
const c13 = [...DEFAUT]; c13[11] = 'A013';
assert.match(C.designerArbres(DIABO, choix(c13), 10, 2).erreurs.join(' '), /A013 refusé/);
ok('Code A013 : refusé');
const c0 = [...DEFAUT]; c0[0] = 'A000';
assert.match(C.designerArbres(DIABO, choix(c0), 10, 2).erreurs.join(' '), /A000 refusé/);
ok('Code A000 : refusé');

// Codes partiels
const part = choix(DEFAUT); delete part[4].code_suivi;
assert.match(C.designerArbres(DIABO, part, 10, 2).erreurs.join(' '), /chacun des 12 arbres/);
ok('Codes incomplets (11 sur 12) : refusé');

// Inventaire insuffisant : aucun arbre fictif
assert.equal(C.proposerChoixArbres(panel([3]), 10, 2).choix.length, 0);
ok('Inventaire insuffisant (3 pour 12) : aucune proposition, aucun arbre fictif');

// Libellés et ordre de visite
assert.equal(C.libelleArbre({ code: 'B02/A001', code_suivi: 'A004' }), 'A004 (B02/A001)');
assert.equal(C.libelleArbre({ code: 'B02/A001', code_suivi: 'A001' }, 'A004'), 'A004 (B02/A001)', 'Visite antérieure : code historique affiché');
assert.equal(C.libelleArbre({ code: 'B02/A001' }), 'B02/A001', 'Champ ancien sans code : code physique');
const ordre = C.arbresObserves(r2.arbres).map(a => a.code_suivi);
assert.deepEqual(ordre, ['A001', 'A002', 'A003', 'A004', 'A005', 'A006', 'A007', 'A008', 'A009', 'A010']);
ok('Visite hebdomadaire : arbres présentés par code de suivi ; visite antérieure affiche son code d’origine');

// Interface : éléments exigés par le mandat
const ui = lire('operations/observatoire.js');
for (const m of [/Attribuer automatiquement A001 à A/, /arbres identifiés, ' \+ doublons \+ ' doublon/, /data-choix="code"/, /echanger-code/, /Échanger : /,
                 /obsChoixEnregistrer/, /bouton\.disabled = !pret/, /enregistrerBrouillonChoix/, /restaurerChoix/, /pheno_arbres_codes_modifier/,
                 /Modifier les codes de suivi/, /Attribuer les codes A001 à A012/, /Arbre physique \(n° dans le bloc\)/, /Motif \(obligatoire\)/])
  assert.match(ui, m, String(m));
assert.match(lire('shared/observatoire-hors-ligne.js'), /brouillonChoix/);
assert.match(lire('shared/observatoire-hors-ligne.js'), /codes_suivi: !!\(p\.parametres \|\| \{\}\)\.codes_suivi/);
assert.match(lire('operations/observatoire.css'), /obs-compteur-ok/);
const html = lire('operations/field-buying.html');
for (const f of ['observatoire-coeur\\.js', 'observatoire-hors-ligne\\.js', 'observatoire\\.js', 'observatoire\\.css'])
  assert.match(html, new RegExp(f + '\\?v=20261123-reperes-gps-1'));
assert.match(lire('sw.js'), /ops-offline-v33-codes-a001/);
ok('Interface : bouton d’attribution, compteur, échange, brouillon, modification motivée, versions de cache');

// Migration : additive, rejouable, retour arrière fourni
const m7 = lire('supabase/20261122140000_aflp_observatoire_7_codes_suivi.sql');
assert.match(m7, /code_suivi ~ '\^A0\(0\[1-9\]\|1\[0-2\]\)\$'/);
assert.match(m7, /unique \(panel_id, code_suivi\) deferrable/);
assert.doesNotMatch(m7.replace(/--.*$/gm, ''), /\b(drop table|delete from|truncate)\b/i);
assert.doesNotMatch(m7.replace(/--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, ''), /update public\.pheno_(blocs|arbres|observations)\b/i, 'Aucune donnée existante réécrite par la migration (hors fonctions)');
assert.match(lire('supabase/20261122140100_aflp_observatoire_7_rollback.sql'), /drop function if exists public\.pheno_arbres_codes_modifier/);
ok('Migration 7 additive (aucune suppression, aucune réécriture de données), retour arrière fourni');

console.log(`PASS: codes de suivi A001-A012 (${n} contrôles).`);
