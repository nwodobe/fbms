/* Non-regression : 12 rangs dans le formulaire, mais jamais 12 arbres fictifs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const C = require('../../shared/observatoire-coeur.js');
const lire = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
function panel(nombres) {
  return { blocs: nombres.map((n, i) => ({
    id: 'B' + (i + 1), numero: i + 1, tire: true, nb_arbres_inventories: n
  })) };
}
const p = panel([3, 3, 3, 3]);
const avant = JSON.stringify(p);
const proposition = C.proposerChoixArbres(p, 10, 2);
assert.deepEqual(proposition.erreurs, []);
assert.equal(proposition.choix.length, 12);
assert.deepEqual(proposition.choix.map(x => x.role), [...Array(10).fill('TITULAIRE'), 'RESERVE', 'RESERVE']);
assert.deepEqual(proposition.choix.map(x => x.numero), [1,2,3,1,2,3,1,2,3,1,2,3]);
assert.equal(new Set(proposition.choix.map(x => x.bloc_id + ':' + x.numero)).size, 12);
assert.equal(JSON.stringify(p), avant, 'La proposition ne modifie jamais les inventaires.');
assert.equal(C.designerArbres(p, proposition.choix).erreurs.length, 0);
const insuffisant = C.proposerChoixArbres(panel([3]), 10, 2);
assert.equal(insuffisant.choix.length, 0);
assert.equal(insuffisant.capacite, 3);
assert.match(insuffisant.erreurs.join(' '), /3 arbre/);
assert.equal(C.proposerChoixArbres(panel([5,6]), 10, 2).choix.length, 0);
assert.equal(C.proposerChoixArbres(panel([null,20]), 10, 2).choix.length, 0);
const autre = C.proposerChoixArbres(panel([6,12]), 10, 2);
assert.equal(autre.choix.length, 12);
assert.equal(C.designerArbres(panel([6,12]), autre.choix).erreurs.length, 0);
const duplicata = autre.choix.map(x => ({...x}));
duplicata[1] = {...duplicata[0]};
assert.match(C.designerArbres(panel([6,12]), duplicata).erreurs.join(' '), /deux fois/);
const ui = lire('operations/observatoire.js');
assert.match(ui, /data-rang/);
assert.match(ui, /Arbre physique \(n° dans le bloc\)/);
assert.match(ui, /Choisir le bloc/);
assert.match(ui, /auto-designer/);
assert.match(ui, /verifierChoixArbres/);
assert.match(ui, /proposerChoixArbres/);
assert.match(ui, /data-choix-erreur/);
assert.match(lire('operations/observatoire.css'), /obs-choix-invalide/);
const html = lire('operations/field-buying.html');
assert.match(html, /observatoire-coeur\.js\?v=20261123-reperes-gps-1/);
assert.match(html, /observatoire\.js\?v=20261123-reperes-gps-1/);
assert.match(html, /observatoire\.css\?v=20261123-reperes-gps-1/);
assert.match(lire('sw.js'), /ops-offline-v33-codes-a001/);
console.log('PASS: Observatoire 12 rangs, selection sans doublons, capacite physique verifiee.');
