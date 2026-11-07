// ============================================================================
// Banc d'essai Niveau 1 — exécuteur
// ----------------------------------------------------------------------------
//   npm install --no-save @electric-sql/pglite@0.5.5
//   node .github/agent-tests/niveau1/executer.mjs
//
// Sortie : un tableau par scénario, puis une synthèse. Code de sortie 1 dès
// qu'un cas échoue — aucun échec n'est absous, aucun n'est masqué.
// ============================================================================

import * as lotsAE from './scenarios.mjs';
import * as lotsFH from './scenarios_fgh.mjs';
import * as amelioration1 from './scenarios_paiements.mjs';
import * as migrations from './scenarios_migrations.mjs';

const scenarios = { ...lotsAE, ...lotsFH, ...amelioration1, ...migrations };

process.on('unhandledRejection', (e) => {
  console.error('\nERREUR NON RATTRAPÉE :', String(e?.message || e).slice(0, 400));
  process.exit(1);
});

const nom = process.argv[2] || null;
const aExecuter = Object.entries(scenarios)
  // Seuls les scénarios tNN_ sont exécutés : les utilitaires partagés exportés
  // par scenarios.mjs (contexteCycle, achatSql) ne sont pas des cas de test.
  .filter(([k, v]) => typeof v === 'function' && /^t\d\d_/.test(k) && (!nom || k.includes(nom)));

if (aExecuter.length === 0) {
  console.error(`Aucun scénario ne correspond à « ${nom} ».`);
  process.exit(1);
}

const rapports = [];
const debut = Date.now();

for (const [cle, fn] of aExecuter) {
  let rapport;
  try {
    rapport = await fn();
  } catch (e) {
    console.error(`\n[${cle}] scénario interrompu : ${String(e?.message || e).slice(0, 300)}`);
    process.exitCode = 1;
    continue;
  }
  rapports.push(rapport);

  console.log(`\n${rapport.titre}`);
  console.log('-'.repeat(Math.max(60, rapport.titre.length)));
  for (const c of rapport.cas) {
    const marque = c.etat === 'REUSSI' ? '  reussi ' : '  ECHOUE ';
    console.log(`${marque} ${c.nom}`);
    if (c.detail) console.log(`           ${c.detail}`);
  }
  console.log(`  → ${rapport.reussis.length}/${rapport.cas.length} conformes`);
}

const total = rapports.reduce((n, r) => n + r.cas.length, 0);
const echecs = rapports.reduce((n, r) => n + r.echecs.length, 0);

console.log('\n' + '='.repeat(70));
console.log('SYNTHÈSE');
console.log('='.repeat(70));
for (const r of rapports) {
  const etat = r.echecs.length === 0 ? 'CONFORME' : `${r.echecs.length} ECHEC(S)`;
  console.log(`  ${etat.padEnd(12)} ${r.titre}`);
}
console.log('-'.repeat(70));
console.log(`  ${total - echecs}/${total} cas conformes · ${((Date.now() - debut) / 1000).toFixed(1)} s`);

if (echecs > 0) {
  console.log('\nCAS EN ÉCHEC :');
  for (const r of rapports)
    for (const c of r.echecs) console.log(`  · ${r.titre} → ${c.nom}\n    ${c.detail}`);
  process.exit(1);
}

// Une porte verte qui ne mesure rien est pire que pas de porte du tout : un
// scénario interrompu ne doit jamais se lire comme un succès.
if (rapports.length < aExecuter.length || total === 0) {
  console.log(`\nSUITE INCOMPLÈTE : ${rapports.length}/${aExecuter.length} scénarios exécutés,`
    + ` ${total} cas. Aucun verdict de conformité n'est prononcé.`);
  process.exit(1);
}
console.log('\nTous les cas sont conformes.');
