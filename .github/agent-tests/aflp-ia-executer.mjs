#!/usr/bin/env node
/**
 * Assistant IA AFLP — exécution de tous les bancs de contrôle.
 *
 * POURQUOI CE FICHIER EXISTE
 * `.github/workflows/**` est interdit à toute modification automatique
 * (CLAUDE.md §3). Les bancs de l'assistant ne sont donc PAS branchés dans
 * l'intégration continue : personne ne les exécute à ma place. Ce lanceur est
 * la seule chose qu'un agent puisse offrir — une commande unique, que le
 * Branch Manager ou un relecteur lance avant de fusionner :
 *
 *     node .github/agent-tests/aflp-ia-executer.mjs
 *
 * Le branchement CI demande UNE ligne dans `.github/workflows/agent-quality-gates.yml`,
 * et c'est un geste humain. Elle est écrite mot pour mot dans
 * docs/aflp_ia_langue_apprentissage_20260815.md, section « Ce qui
 * reste à faire par un humain ».
 *
 * Sortie : 0 si tous les bancs passent, 1 sinon.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));

const BANCS = [
  ['Moteur, règle de refinancement, RT/Béoumi, contrat fermé', 'aflp-ia-assistant.mjs'],
  ['Corpus de compréhension (190 formulations, variantes, refus)', 'aflp-ia-corpus.mjs'],
  ['Sécurité (secrets, isolation, charge linguistique, RLS lues)', 'aflp-ia-securite.mjs'],
  ['Migration et politiques RLS, exécutées sur PostgreSQL', 'aflp-ia-journal-rls.mjs'],
];

let echecs = 0;
const resultats = [];

for (const [titre, fichier] of BANCS) {
  process.stdout.write(`\n━━ ${titre}\n`);
  const r = spawnSync(process.execPath, [path.join(ICI, fichier)], {
    encoding: 'utf8', cwd: process.cwd(),
  });
  const sortie = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(sortie);
  const code = r.status == null ? 1 : r.status;
  /* Un banc qui s'IGNORE faute de dépendance sort en 0. Le compter comme
     « réussi » transformerait « je n'ai pas pu vérifier » en « j'ai vérifié,
     tout va bien » — précisément ce que le README de ce dossier interdit.
     Le cas s'est produit : `npm install --no-save playwright` désinstalle
     `@electric-sql/pglite`, et le banc RLS s'est mis à passer sans rien tester. */
  const ignore = /^IGNORÉ/m.test(sortie);
  resultats.push({ titre, fichier, code, ignore });
  if (code !== 0) echecs++;
}

console.log('\n' + '═'.repeat(72));
for (const r of resultats) {
  const etat = r.code !== 0 ? 'ÉCHOUÉ ' : r.ignore ? 'IGNORÉ ' : 'RÉUSSI ';
  console.log(`${etat} ${r.fichier.padEnd(28)} ${r.titre}`);
}
console.log('═'.repeat(72));

const ignores = resultats.filter((r) => r.ignore && r.code === 0);
if (echecs) {
  console.error(`\n${echecs} banc(s) en échec. Ne pas fusionner.`);
  process.exit(1);
}
if (ignores.length) {
  console.error(`\n${ignores.length} banc(s) IGNORÉ(S) faute de dépendance : ` +
    ignores.map((r) => r.fichier).join(', '));
  console.error('Ce n\'est pas un succès. Installez les dépendances puis relancez :');
  console.error('  npm install --no-save @electric-sql/pglite@0.5.5');
  process.exit(1);
}
console.log('\nTous les bancs de l\'Assistant IA AFLP sont au vert.');
console.log('Rappel : ces bancs ne couvrent ni PostgREST, ni le rendu des pages');
console.log('(node .github/scripts/verifier-pages.mjs, qui exige Playwright),');
console.log('ni la production (node .github/scripts/smoke-production.mjs).');
