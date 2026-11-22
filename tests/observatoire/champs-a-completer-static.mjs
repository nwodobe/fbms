/* Observatoire · 22/11/2026 (demande du Branch Manager) : tous les champs du périmètre sont proposés à
   l'installation. Un champ incomplet reste choisissable, l'écran dit ce qui manque et ouvre de quoi le compléter ;
   l'installation d'un champ incomplet reste impossible (bouton désactivé, garde à l'envoi, règle serveur inchangée). */
import fs from 'node:fs'; import assert from 'node:assert/strict'; import test from 'node:test';
const s = fs.readFileSync(new URL('../../operations/observatoire.js', import.meta.url), 'utf8');
const v = s.slice(s.indexOf('function vueInstaller('), s.indexOf('function sansAccent('));
test('les champs incomplets sont dans la liste de choix', () => {
  assert.match(v, /var options = libres\.map\(/);
  assert.doesNotMatch(v, /var options = libres\.filter\(function \(p\) \{ return p\.eligible !== false; \}\)/);
  assert.match(v, /À COMPLÉTER/);
});
test('le choix d\'un champ incomplet affiche ce qui manque et les raccourcis', () => {
  assert.match(s, /function majCompletude\(\)/);
  assert.match(s, /#parcelles\/parcours\/' \+ encodeURIComponent\(o\.id\)/);
  assert.match(s, /#farmers\/' \+ encodeURIComponent\(o\.producteur_id\)/);
  assert.match(s, /data-act="preparer">Actualiser la liste/);
});
test('un champ incomplet ne peut pas être installé', () => {
  assert.match(s, /btn\.disabled = !!\(o && o\.incomplet\)/);
  assert.match(s, /if \(choix && choix\.incomplet\) \{ err\.innerHTML = note\(/);
});
