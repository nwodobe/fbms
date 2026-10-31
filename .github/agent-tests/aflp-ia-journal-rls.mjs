#!/usr/bin/env node
/**
 * Assistant IA AFLP — banc d'essai de la migration et des politiques RLS.
 *
 * Exécute du PostgreSQL AUTHENTIQUE (PGlite : PostgreSQL compilé en
 * WebAssembly), sans Docker ni droits administrateur — les deux étant
 * indisponibles sur ce poste de travail. Les contraintes, les déclencheurs et
 * les politiques RLS sont réellement évalués par PostgreSQL : quand ce banc dit
 * qu'un INSERT est refusé, il l'a été.
 *
 * CE QU'IL PROUVE
 *   · la migration s'applique sans erreur sur une base neuve ;
 *   · chaque politique refuse bien ce qu'elle doit refuser, rôle par rôle ;
 *   · le journal est en écriture unique, y compris pour son auteur ;
 *   · un catalogue publié est figé par déclencheur ;
 *   · l'idempotence empêche le double comptage d'une question rejouée ;
 *   · la vue de métriques respecte la RLS de celui qui l'interroge.
 *
 * CE QU'IL NE PROUVE PAS
 *   · le comportement de PostgREST ni des jetons JWT réels ;
 *   · l'état de la base de production (schéma existant, volumétrie, droits
 *     déjà accordés) — le pré-contrôle du 14/08/2026 a montré que le dépôt
 *     n'est PAS la source de vérité de cette base ;
 *   · la version exacte de PostgreSQL de Supabase (17.6 en production, 18.x
 *     ici). Les fonctionnalités employées existent depuis PostgreSQL 15.
 *
 * Prérequis : npm install --no-save @electric-sql/pglite@0.5.5
 * Usage     : node .github/agent-tests/aflp-ia-journal-rls.mjs
 * Sortie    : 0 si tout passe, 1 sinon. 0 avec avertissement si PGlite est absent.
 */
import fs from 'node:fs';
import path from 'node:path';

const RACINE = process.cwd();
const MIGRATION = 'docs/migrations/aflp_ia_journal_20260815.sql';

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.log('IGNORÉ - @electric-sql/pglite est absent.');
  console.log('         Installez-le pour exécuter réellement les politiques RLS :');
  console.log('         npm install --no-save @electric-sql/pglite@0.5.5');
  console.log('         Sans lui, la migration n\'est PAS vérifiée — ne pas lire ce message');
  console.log('         comme un succès.');
  process.exit(0);
}

/* --- Comptes de test. UUID fixes, noms fictifs, aucune donnée réelle. ------ */
const COMPTES = {
  bm:      { id: '00000000-0000-4000-8000-000000000001', nom: 'BM Test',      role: 'Branch Manager' },
  bm2:     { id: '00000000-0000-4000-8000-000000000002', nom: 'BM Test 2',    role: 'Branch Manager' },
  chef:    { id: '00000000-0000-4000-8000-000000000003', nom: 'Superviseur',  role: 'Supervisor' },
  agent:   { id: '00000000-0000-4000-8000-000000000004', nom: 'Agent Test',   role: 'Agent Recenseur' },
  agent2:  { id: '00000000-0000-4000-8000-000000000005', nom: 'Agent Test 2', role: 'Agent Recenseur' },
  inactif: { id: '00000000-0000-4000-8000-000000000006', nom: 'Inactif',      role: 'Agent Recenseur', actif: false },
};

const cas = [];
const ok = (nom, detail = '') => cas.push({ nom, etat: 'REUSSI', detail });
const ko = (nom, detail = '') => cas.push({ nom, etat: 'ECHOUE', detail });

async function doitRefuser(nom, fn, motif = null) {
  try {
    await fn();
    ko(nom, 'ACCEPTÉ alors que le refus était attendu');
  } catch (e) {
    if (motif && !new RegExp(motif, 'i').test(e.message)) {
      ko(nom, `refusé, mais pour un autre motif : ${e.message.slice(0, 120)}`);
    } else ok(nom);
  }
}

async function doitAccepter(nom, fn) {
  try { await fn(); ok(nom); }
  catch (e) { ko(nom, e.message.slice(0, 160)); }
}

/* PostgreSQL ne lève PAS d'erreur quand une politique RLS masque les lignes
   visées par un UPDATE ou un DELETE : il n'en modifie simplement aucune. C'est
   une propriété de sécurité tout aussi forte qu'un refus, mais elle se vérifie
   autrement — et l'oublier ferait passer un test au vert sans rien prouver.
   Ce piège a coûté quatre faux « conforme » à la première exécution de ce banc. */
async function doitNeRienChanger(nom, fn) {
  try {
    const r = await fn();
    if (r && typeof r.affectedRows === 'number' && r.affectedRows === 0) ok(nom);
    else ko(nom, `${(r && r.affectedRows) ?? '?'} ligne(s) modifiée(s) alors qu'aucune n'était attendue`);
  } catch (e) {
    /* Un refus franc (droit révoqué) est encore meilleur. */
    if (/permission|denied|droit|row-level/i.test(e.message)) ok(nom, 'refusé au niveau des privilèges');
    else ko(nom, e.message.slice(0, 160));
  }
}

/* --- Démarrage ------------------------------------------------------------ */
const db = await new PGlite();

await db.exec(fs.readFileSync(path.join(RACINE, '.github/agent-tests/aflp-ia-baseline.sql'), 'utf8'));

/* `gen_random_uuid()` fait partie du cœur de PostgreSQL depuis la version 13 :
   l'extension pgcrypto n'est nécessaire que pour d'autres fonctions. PGlite ne
   l'embarque pas ; on neutralise donc la seule ligne qui la demande, sans
   toucher au reste de la migration. La ligne est CONSERVÉE dans le fichier
   livré, parce que Supabase, lui, l'a. */
const migrationSrc = fs.readFileSync(path.join(RACINE, MIGRATION), 'utf8')
  .replace(/create extension if not exists "pgcrypto";/,
    '-- pgcrypto neutralisée pour le banc PGlite (gen_random_uuid est natif depuis PG13)');

try {
  await db.exec(migrationSrc);
  ok('La migration s\'applique sur une base neuve');
} catch (e) {
  ko('La migration s\'applique sur une base neuve', e.message.slice(0, 300));
  rapporter();
  process.exit(1);
}

/* Idempotence de la migration : la rejouer ne doit rien casser. Une migration
   qui n'est pas rejouable est une migration qu'on n'ose pas relancer après un
   incident — donc une migration qu'on ne relancera pas. */
try {
  await db.exec(migrationSrc);
  ok('La migration est rejouable sans erreur');
} catch (e) {
  ko('La migration est rejouable sans erreur', e.message.slice(0, 200));
}

/* --- Profils -------------------------------------------------------------- */
for (const c of Object.values(COMPTES)) {
  await db.query(
    `insert into public.profils(user_id, nom, email, role, actif) values ($1,$2,$3,$4,$5)
     on conflict (user_id) do nothing`,
    [c.id, c.nom, `${c.nom.toLowerCase().replace(/\s+/g, '.')}@test.invalid`, c.role, c.actif !== false]);
}

async function connecter(compte) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [compte ? compte.id : '']);
  await db.exec(compte ? 'set role authenticated' : 'set role anon');
}
async function proprietaire() {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}

const question = (cle, user) => ({
  cle_idempotence: cle,
  user_id: user.id,
  question_raw: 'Combien de RT à Béoumi ?',
  question_normalized: 'combien de rt a beoumi',
  detected_intent: 'coverage_rt_count',
  detected_scope_type: 'cluster',
  detected_scope_id: 'BEOUMI',
  detected_period: 'campaign',
  confidence: 0.98,
  result_status: 'reponse_produite',
});

async function insererQuestion(cle, user) {
  const q = question(cle, user);
  return db.query(
    `insert into public.aflp_ia_questions
       (cle_idempotence,user_id,question_raw,question_normalized,detected_intent,
        detected_scope_type,detected_scope_id,detected_period,confidence,result_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [q.cle_idempotence, q.user_id, q.question_raw, q.question_normalized, q.detected_intent,
     q.detected_scope_type, q.detected_scope_id, q.detected_period, q.confidence, q.result_status]);
}

/* =========================================================================
   1. RLS effectivement activée
   ===================================================================== */
{
  await proprietaire();
  const r = await db.query(`select tablename, rowsecurity from pg_tables
    where schemaname='public' and tablename like 'aflp_ia_%' order by 1`);
  const sans = r.rows.filter((x) => !x.rowsecurity).map((x) => x.tablename);
  if (r.rows.length !== 6) ko('Six tables créées', `${r.rows.length} trouvée(s)`);
  else if (sans.length) ko('RLS activée sur toutes les tables', sans.join(', '));
  else ok('RLS activée sur les six tables');
}

/* =========================================================================
   2. Le rôle anonyme n'a aucun accès
   -------------------------------------------------------------------------
   C'est le contrôle le plus important du lot : la clé publique Supabase est en
   clair dans les pages du site. Si `anon` pouvait lire le journal, celui-ci
   serait publiquement lisible par quiconque ouvre le code source.
   ===================================================================== */
await connecter(null);
await doitRefuser('anon ne peut pas lire le journal',
  () => db.query('select * from public.aflp_ia_questions'), 'permission|denied|droit');
await doitRefuser('anon ne peut pas écrire dans le journal',
  () => insererQuestion('anon-1', COMPTES.agent), 'permission|denied|droit');
await doitRefuser('anon ne peut pas lire le catalogue',
  () => db.query('select * from public.aflp_ia_intentions'), 'permission|denied|droit');

/* =========================================================================
   3. Journal des questions
   ===================================================================== */
await connecter(COMPTES.agent);
await doitAccepter('un agent actif journalise sa propre question',
  () => insererQuestion('q-agent-1', COMPTES.agent));

await doitRefuser('un agent ne peut pas journaliser au nom d\'un autre',
  () => insererQuestion('q-usurpation', COMPTES.agent2), 'row-level security|policy');

await connecter(COMPTES.inactif);
await doitRefuser('un compte désactivé ne peut rien journaliser',
  () => insererQuestion('q-inactif', COMPTES.inactif), 'row-level security|policy');

await connecter(COMPTES.agent2);
await doitAccepter('un second agent journalise sa question',
  () => insererQuestion('q-agent2-1', COMPTES.agent2));
{
  const r = await db.query('select cle_idempotence from public.aflp_ia_questions');
  if (r.rows.length === 1 && r.rows[0].cle_idempotence === 'q-agent2-1') {
    ok('un agent ne voit QUE ses propres questions');
  } else {
    ko('un agent ne voit QUE ses propres questions',
      `${r.rows.length} ligne(s) visibles : ${r.rows.map((x) => x.cle_idempotence).join(', ')}`);
  }
}

await connecter(COMPTES.chef);
{
  const r = await db.query('select cle_idempotence from public.aflp_ia_questions');
  if (r.rows.length === 2) ok('un superviseur lit tout le journal');
  else ko('un superviseur lit tout le journal', `${r.rows.length} ligne(s) visibles`);
}

/* Écriture unique — vérifiée sur l'auteur ET sur le propriétaire de la base.
   La RLS ne s'applique pas au propriétaire ; le déclencheur, si. Sans lui, une
   correction faite depuis l'éditeur SQL réécrirait l'histoire en silence. */
await connecter(COMPTES.agent2);
await doitNeRienChanger('l\'auteur ne peut pas réécrire sa question',
  () => db.query(`update public.aflp_ia_questions set result_status='compris'
                  where cle_idempotence='q-agent2-1'`));
await proprietaire();
await doitRefuser('même le propriétaire de la base ne peut pas réécrire une question',
  () => db.query(`update public.aflp_ia_questions set result_status='compris'
                  where cle_idempotence='q-agent2-1'`), 'écriture unique');

await connecter(COMPTES.agent2);
await doitRefuser('un agent ne peut pas supprimer une question',
  () => db.query(`delete from public.aflp_ia_questions where cle_idempotence='q-agent2-1'`),
  'permission|denied|droit|row-level');

/* Idempotence : la file locale rejoue après une coupure. Le rejeu ne doit pas
   créer de doublon — sinon toute mesure de compréhension est fausse. */
await connecter(COMPTES.agent);
await doitRefuser('un rejeu avec la même clé d\'idempotence est refusé',
  () => insererQuestion('q-agent-1', COMPTES.agent), 'unique|duplicat');
await doitAccepter('un rejeu « ON CONFLICT DO NOTHING » passe sans doublon', async () => {
  await db.query(
    `insert into public.aflp_ia_questions
       (cle_idempotence,user_id,question_raw,question_normalized,result_status)
     values ('q-agent-1',$1,'x','x','reponse_produite')
     on conflict (cle_idempotence) do nothing`, [COMPTES.agent.id]);
  const r = await db.query(
    `select count(*)::int n from public.aflp_ia_questions where cle_idempotence='q-agent-1'`);
  if (r.rows[0].n !== 1) throw new Error(`${r.rows[0].n} lignes pour une même clé`);
});

/* =========================================================================
   4. Retours et validation
   ===================================================================== */
let idQuestionAgent;
{
  await proprietaire();
  const r = await db.query(
    `select id from public.aflp_ia_questions where cle_idempotence='q-agent-1'`);
  idQuestionAgent = r.rows[0].id;
}

await connecter(COMPTES.agent);
await doitAccepter('un agent signale une réponse à revoir', () => db.query(
  `insert into public.aflp_ia_feedback (question_id, auteur_uid, feedback_type)
   values ($1,$2,'reponse_incorrecte')`, [idQuestionAgent, COMPTES.agent.id]));

await doitRefuser('un agent ne peut pas valider son propre signalement', () => db.query(
  `insert into public.aflp_ia_feedback (question_id, auteur_uid, feedback_type, approval_status, reviewed_by, reviewed_at)
   values ($1,$2,'reponse_incorrecte','valide',$2,now())`, [idQuestionAgent, COMPTES.agent.id]),
  'row-level security|policy');

await doitNeRienChanger('un agent ne peut pas valider un signalement existant', () => db.query(
  `update public.aflp_ia_feedback set approval_status='valide', reviewed_by=$1, reviewed_at=now()`,
  [COMPTES.agent.id]));

await connecter(COMPTES.chef);
await doitAccepter('un superviseur valide un signalement en se nommant', () => db.query(
  `update public.aflp_ia_feedback set approval_status='valide', reviewed_by=$1, reviewed_at=now()`,
  [COMPTES.chef.id]));

await doitRefuser('un superviseur ne peut pas valider au nom d\'un autre', () => db.query(
  `update public.aflp_ia_feedback set approval_status='rejete', reviewed_by=$1, reviewed_at=now()`,
  [COMPTES.bm.id]), 'row-level security|policy|check');

/* =========================================================================
   5. Catalogue versionné — le cœur du workflow
   ===================================================================== */
await connecter(COMPTES.agent);
await doitRefuser('un agent ne peut pas ouvrir une version', () => db.query(
  `insert into public.aflp_ia_catalogue_versions (version, statut, cree_par)
   values ('9.9.9','brouillon',$1)`, [COMPTES.agent.id]), 'row-level security|policy');

await connecter(COMPTES.chef);
await doitAccepter('un superviseur ouvre un brouillon', () => db.query(
  `insert into public.aflp_ia_catalogue_versions (version, statut, cree_par)
   values ('1.1.0','brouillon',$1)`, [COMPTES.chef.id]));

await doitRefuser('un superviseur ne peut pas créer une version DÉJÀ publiée', () => db.query(
  `insert into public.aflp_ia_catalogue_versions (version, statut, cree_par, publie_par, publie_le)
   values ('2.0.0','publie',$1,$1,now())`, [COMPTES.chef.id]), 'row-level security|policy');

await doitAccepter('un superviseur ajoute une formulation au brouillon', () => db.query(
  `insert into public.aflp_ia_formulations (version, code_intention, texte, texte_normalise, cree_par)
   values ('1.1.0','coverage_rt_count','Combien de RT à Béoumi ?','combien de rt a beoumi',$1)`,
  [COMPTES.chef.id]));

await doitRefuser('une formulation en double est refusée', () => db.query(
  `insert into public.aflp_ia_formulations (version, code_intention, texte, texte_normalise, cree_par)
   values ('1.1.0','coverage_rt_count','COMBIEN DE RT A BEOUMI','combien de rt a beoumi',$1)`,
  [COMPTES.chef.id]), 'unique|duplicat');

await doitNeRienChanger('un superviseur ne peut pas publier une version', () => db.query(
  `update public.aflp_ia_catalogue_versions set statut='publie', publie_par=$1, publie_le=now()
   where version='1.1.0'`, [COMPTES.chef.id]));

await connecter(COMPTES.bm);
await doitAccepter('le Branch Manager publie la version', () => db.query(
  `update public.aflp_ia_catalogue_versions set statut='publie', publie_par=$1, publie_le=now()
   where version='1.1.0'`, [COMPTES.bm.id]));

/* LA RÈGLE QUI FORCE LE VERSIONNEMENT. Sans elle, « corriger une formulation »
   et « publier une nouvelle version » seraient le même geste, et la version
   journalisée avec chaque question ne voudrait plus rien dire. */
await doitRefuser('une formulation d\'une version PUBLIÉE ne peut plus être modifiée', () => db.query(
  `update public.aflp_ia_formulations set texte='autre chose' where version='1.1.0'`),
  'publiée|publie');
await doitRefuser('une formulation d\'une version PUBLIÉE ne peut plus être supprimée', () => db.query(
  `delete from public.aflp_ia_formulations where version='1.1.0'`), 'publiée|publie');
await doitRefuser('une version publiée ne redevient pas un brouillon', () => db.query(
  `update public.aflp_ia_catalogue_versions set statut='brouillon' where version='1.1.0'`),
  'brouillon');

/* En revanche, un brouillon reste modifiable et annulable : c'est exactement
   « annuler une modification non publiée ». */
await doitAccepter('le Branch Manager ouvre un nouveau brouillon', () => db.query(
  `insert into public.aflp_ia_catalogue_versions (version, statut, cree_par)
   values ('1.2.0','brouillon',$1)`, [COMPTES.bm.id]));
await doitAccepter('une formulation de brouillon est modifiable', async () => {
  await db.query(
    `insert into public.aflp_ia_formulations (version, code_intention, texte, texte_normalise, cree_par)
     values ('1.2.0','cash_balance','Solde cash GBEKE 1','solde cash gbeke 1',$1)`, [COMPTES.bm.id]);
  await db.query(`update public.aflp_ia_formulations set actif=false where version='1.2.0'`);
});
await doitAccepter('une modification non publiée peut être annulée', () => db.query(
  `delete from public.aflp_ia_formulations where version='1.2.0'`));

/* Contraintes métier du catalogue. */
await doitRefuser('une intention publiée sans fonction de calcul est refusée', () => db.query(
  `insert into public.aflp_ia_intentions (version, code, nom, description, statut, cree_par)
   values ('1.2.0','sans_fonction','X','Y','publie',$1)`, [COMPTES.bm.id]),
  'aflp_ia_int_publiee_a_une_fonction|check');
await doitRefuser('une intention indisponible doit nommer la donnée manquante', () => db.query(
  `insert into public.aflp_ia_intentions (version, code, nom, description, statut, cree_par)
   values ('1.2.0','sans_motif','X','Y','non_disponible',$1)`, [COMPTES.bm.id]),
  'aflp_ia_int_indispo_nomme_la_donnee|check');

/* =========================================================================
   6. Audit
   ===================================================================== */
await connecter(COMPTES.chef);
{
  const r = await db.query(
    `select count(*)::int n from public.aflp_ia_audit where table_cible='aflp_ia_formulations'`);
  if (r.rows[0].n >= 3) ok('les modifications du catalogue sont auditées', `${r.rows[0].n} lignes`);
  else ko('les modifications du catalogue sont auditées', `${r.rows[0].n} ligne(s) seulement`);
}
await doitRefuser('le journal d\'audit ne peut pas être réécrit',
  () => db.query(`update public.aflp_ia_audit set operation='INSERT'`),
  'écriture unique|permission|denied|droit');

await connecter(COMPTES.agent);
await doitRefuser('un agent ne lit pas le journal d\'audit', async () => {
  const r = await db.query('select * from public.aflp_ia_audit');
  if (r.rows.length) return;
  throw new Error('aucune ligne visible');   // c'est le résultat attendu
}, 'aucune ligne visible');

/* =========================================================================
   7. La vue de métriques respecte la RLS de l'appelant
   -------------------------------------------------------------------------
   Sans `security_invoker`, une vue s'exécute avec les droits de son
   propriétaire : elle exposerait le journal entier à tout compte connecté.
   C'est le contournement de RLS le plus discret qui soit.
   ===================================================================== */
await connecter(COMPTES.agent2);
{
  const r = await db.query('select sum(questions)::int total from public.aflp_ia_metriques');
  if (r.rows[0].total === 1) ok('la vue de métriques n\'expose à un agent que ses propres questions');
  else ko('la vue de métriques n\'expose à un agent que ses propres questions',
    `total vu : ${r.rows[0].total}`);
}
await connecter(COMPTES.chef);
{
  const r = await db.query('select sum(questions)::int total from public.aflp_ia_metriques');
  if (r.rows[0].total >= 2) ok('la vue de métriques expose tout le journal à la supervision');
  else ko('la vue de métriques expose tout le journal à la supervision', `total vu : ${r.rows[0].total}`);
}

/* =========================================================================
   7 bis. Privilèges de la VUE — le trou que ce banc n'avait pas vu
   -------------------------------------------------------------------------
   `alter default privileges … grant all on tables to anon` s'applique AUSSI
   aux vues. La première version de la migration révoquait les droits sur les
   six tables et oubliait `aflp_ia_metriques`, qui naissait donc avec DELETE,
   INSERT, TRUNCATE, UPDATE et SELECT pour `anon`.

   Ce banc ne l'avait pas vu parce qu'il ne regardait que les tables. Le défaut
   a été trouvé sur la base RÉELLE, par le script de contrôle livré, après une
   première application. Ce contrôle-ci existe pour que cela ne se reproduise
   pas — et il est écrit ici, pas seulement dans le script SQL, parce que c'est
   ce banc qui tourne avant la fusion.
   ===================================================================== */
await proprietaire();
{
  const r = await db.query(
    `select privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name='aflp_ia_metriques' and grantee='anon'`);
  if (r.rows.length === 0) ok('la vue de métriques n\'accorde aucun droit à anon');
  else ko('la vue de métriques n\'accorde aucun droit à anon',
    r.rows.map((x) => x.privilege_type).join(', '));
}
{
  const r = await db.query(
    `select privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name='aflp_ia_metriques'
       and grantee='authenticated' and privilege_type <> 'SELECT'`);
  if (r.rows.length === 0) ok('la vue de métriques est en lecture seule pour authenticated');
  else ko('la vue de métriques est en lecture seule pour authenticated',
    r.rows.map((x) => x.privilege_type).join(', '));
}
{
  /* Un `search_path` modifiable est détournable par un schéma temporaire. Les
     advisors Supabase le signalent sur toute fonction, définisseur ou non. */
  const r = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where ((n.nspname='public' and p.proname like 'aflp_ia_%')
            or (n.nspname='aflp_ia_interne' and p.proname='auditer'))
       and (p.proconfig is null or not (p.proconfig::text like '%search_path%'))`);
  if (r.rows.length === 0) ok('les cinq fonctions ont un search_path figé');
  else ko('les cinq fonctions ont un search_path figé', r.rows.map((x) => x.proname).join(', '));
}

/* =========================================================================
   8. Contrôles du script de vérification livré
   ===================================================================== */
await proprietaire();
await doitAccepter('le script de contrôle livré s\'exécute sans erreur', async () => {
  const verif = fs.readFileSync(
    path.join(RACINE, 'docs/migrations/aflp_ia_journal_verify_20260815.sql'), 'utf8');
  await db.exec(verif);
});

/* =========================================================================
   Rapport
   ===================================================================== */
function rapporter() {
  const echecs = cas.filter((c) => c.etat === 'ECHOUE');
  cas.forEach((c) => {
    if (c.etat === 'ECHOUE') console.error(`  ✗ ${c.nom}${c.detail ? ' — ' + c.detail : ''}`);
  });
  console.log(`\n${cas.length - echecs.length}/${cas.length} contrôles conformes ` +
    `(PostgreSQL réel via PGlite, PostgREST non couvert).`);
  return echecs.length;
}

const nbEchecs = rapporter();
await db.close();
if (nbEchecs) process.exit(1);
console.log('OK - Migration et politiques RLS de l\'Assistant IA AFLP');
