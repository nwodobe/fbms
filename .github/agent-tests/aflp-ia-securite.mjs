#!/usr/bin/env node
/**
 * Assistant IA AFLP — banc de sécurité.
 *
 * Il vérifie les INTERDITS de la demande, un par un, par lecture de code et par
 * exécution. Ce sont des propriétés structurelles : si l'une tombe, ce n'est
 * pas une régression cosmétique mais une capacité que l'assistant n'était pas
 * censé avoir.
 *
 * CE QU'IL PROUVE
 *   · aucun secret, aucune clé `service_role` dans les fichiers livrés ;
 *   · le moteur et la couche de compréhension n'ont ni réseau, ni DOM,
 *     ni écriture ;
 *   · aucune fonction atteignable depuis un contrat ne mute quoi que ce soit ;
 *   · la charge envoyée au fournisseur linguistique ne contient AUCUN chiffre
 *     métier — vérifié en la construisant sur un état réel et en cherchant les
 *     montants dedans ;
 *   · la couche linguistique est désactivée par défaut et refuse un contrat
 *     non conforme ;
 *   · les politiques RLS proposées respectent les règles de la demande.
 *
 * CE QU'IL NE PROUVE PAS
 *   · le comportement de PostgREST ni de Supabase Auth ;
 *   · que la migration a été appliquée en production — elle ne l'a pas été ;
 *   · qu'aucun secret n'existe côté serveur : il n'y en a aucun à ce jour.
 *
 * Usage : node .github/agent-tests/aflp-ia-securite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { charger, DONNEES, CONTEXTE, RACINE } from './aflp-ia-fixture.mjs';

const { CATALOGUE, COMPREHENSION, IA, JOURNAL, LANGUE } = charger();

let echecs = 0;
const ko = (m) => { echecs++; console.error('  ✗ ' + m); };
const verifier = (condition, m) => { if (!condition) ko(m); };

const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');

/* Les commentaires de ce lot NOMMENT les interdits pour les expliquer : « aucun
   service_role », « éviter SECURITY DEFINER », « jamais user_metadata ». Les
   chercher dans le fichier entier reviendrait à sanctionner la documentation de
   la règle. On contrôle donc le CODE seul. */
const sansCommentairesSql = (s) => s.replace(/--[^\n]*/g, '');
const sansCommentairesJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const FICHIERS_ASSISTANT = [
  'shared/aflp-ia-catalogue.js',
  'shared/aflp-ia-comprehension.js',
  'shared/aflp-ia-moteur.js',
  'shared/aflp-ia-journal.js',
  'shared/aflp-ia-langue.js',
  'shared/aflp-ia-ui.js',
  'terrain/aflp-ia-admin.html',
];

/* =========================================================================
   1. Aucun secret livré au navigateur
   -------------------------------------------------------------------------
   `shared/anagroci-config.js` porte déjà la clé PUBLIQUE Supabase, en clair et
   par conception : c'est la clé anonyme, et la RLS est ce qui protège. Ce qui
   ne doit JAMAIS apparaître, c'est une clé `service_role`, une clé de
   fournisseur d'IA, ou un jeton personnel.
   ===================================================================== */
const MOTIFS_SECRETS = [
  [/service_role/i, 'référence à service_role'],
  [/sk-[A-Za-z0-9_-]{16,}/, 'clé de fournisseur au format sk-…'],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'clé Anthropic'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clé AWS'],
  [/ghp_[A-Za-z0-9]{20,}/, 'jeton GitHub'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'jeton JWT en dur'],
  [/(api[_-]?key|apikey|secret|password|mot[_-]?de[_-]?passe)\s*[:=]\s*["'][^"']{8,}["']/i,
    'affectation d\'un secret littéral'],
];
for (const f of FICHIERS_ASSISTANT) {
  const src = lire(f);
  for (const [motif, nom] of MOTIFS_SECRETS) {
    if (motif.test(src)) ko(`${f} : ${nom}`);
  }
}

/* La fonction Edge PROPOSÉE ne doit pas non plus porter de valeur en dur :
   elle lit ses secrets dans l'environnement, et rien d'autre. */
const edge = lire('docs/edge-functions/aflp-ia-langue/index.ts');
const edgeCode = sansCommentairesJs(edge);
verifier(/Deno\.env\.get\("AFLP_IA_LANGUE_CLE"\)/.test(edge),
  'la fonction Edge doit lire sa clé dans l\'environnement');
verifier(!/AFLP_IA_LANGUE_CLE\s*=\s*["'][^"']+["']/.test(edge),
  'la fonction Edge ne doit contenir aucune valeur de clé');
verifier(!/service_role|SERVICE_ROLE/.test(edgeCode),
  'la fonction Edge ne doit jamais employer service_role');

/* =========================================================================
   2. Le moteur et la compréhension : ni réseau, ni DOM, ni écriture
   ===================================================================== */
const SANS_RESEAU = ['shared/aflp-ia-moteur.js', 'shared/aflp-ia-comprehension.js',
  'shared/aflp-ia-catalogue.js'];
for (const f of SANS_RESEAU) {
  const src = lire(f);
  verifier(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|createClient|\.functions\.invoke/.test(src),
    `${f} contient un appel réseau — le calcul doit rester hors ligne`);
  verifier(!/\bdocument\b|\bwindow\.document\b|localStorage/.test(src),
    `${f} touche au DOM ou au stockage`);
}

/* Aucune écriture de données, où que ce soit dans la chaîne de compréhension
   et de calcul. `insert`, `update`, `delete`, `upsert`, `rpc` sont les verbes
   PostgREST : leur absence est ce qui rend structurellement impossible qu'une
   question modifie une transaction, crée une avance ou lève un blocage. */
const VERBES_ECRITURE = /\.(insert|update|upsert|delete|rpc)\s*\(/;
for (const f of ['shared/aflp-ia-moteur.js', 'shared/aflp-ia-comprehension.js',
  'shared/aflp-ia-catalogue.js', 'shared/aflp-ia-langue.js']) {
  verifier(!VERBES_ECRITURE.test(lire(f)),
    `${f} contient un verbe d'écriture PostgREST`);
}

/* Le journal écrit — c'est son rôle — mais UNIQUEMENT dans ses deux tables. */
const journalSrc = lire('shared/aflp-ia-journal.js');
const tablesEcrites = [...journalSrc.matchAll(/from\((TABLE\w*|"[^"]+")\)/g)].map((m) => m[1]);
for (const t of tablesEcrites) {
  verifier(/TABLE/.test(t) || /aflp_ia_/.test(t),
    `le journal écrit dans une table hors de son périmètre : ${t}`);
}
verifier(!/achats|avances|reconciliations|sacs_mouvements|profils|parametres_calcul/.test(journalSrc),
  'le journal ne doit jamais nommer une table transactionnelle');

/* =========================================================================
   3. Aucune fonction de mutation atteignable depuis un contrat
   -------------------------------------------------------------------------
   Le registre `FONCTIONS` est la liste CLOSE de ce qu'un contrat peut
   déclencher. On vérifie qu'aucun de ses noms n'évoque une mutation, et
   surtout qu'un appel ne modifie pas l'état sur lequel il travaille.
   ===================================================================== */
const VERBES_INTERDITS = /(creer|create|modif|update|supprim|delete|valid|autoris|debloqu|lever|sanction|cloture|payer|verser|ecrire|write)/i;
for (const nom of IA.fonctionsDisponibles) {
  verifier(!VERBES_INTERDITS.test(nom),
    `le registre expose une fonction au nom de mutation : ${nom}`);
}

/* Preuve par exécution : on interroge l'assistant sur toutes les formulations
   du catalogue et l'on vérifie que l'état n'a pas bougé d'un octet. */
const etat = IA.construireEtat(DONNEES);
const avant = JSON.stringify(etat);
for (const c of CATALOGUE.corpus()) IA.repondre(c.question, etat);
verifier(JSON.stringify(etat) === avant,
  'répondre à une question a modifié l\'état — une lecture ne doit rien muter');

/* Une intention publiée ne peut désigner qu'une fonction du registre. */
for (const i of CATALOGUE.intentions.filter((x) => x.statut === 'publie')) {
  verifier(IA.fonctionsDisponibles.includes(i.fonction),
    `${i.code} désigne une fonction hors registre : ${i.fonction}`);
}

/* Et un contrat désignant une intention inexistante ne produit rien. */
const refus = IA.repondre('x', etat, null, null, {
  intent: 'tout_supprimer', scope: { type: 'global', id: null, label: 'g' },
  period: 'campaign', filters: {}, confidence: 1,
  requires_clarification: false, clarification_question: null,
});
verifier(refus.confiance === 'nulle' && /refus/i.test(refus.texte),
  'un contrat désignant une intention inconnue doit être refusé sans calcul');

/* =========================================================================
   4. La charge envoyée au fournisseur linguistique ne porte aucun chiffre
   -------------------------------------------------------------------------
   Le contrôle le plus important de ce fichier. On construit la charge réelle à
   partir d'un état réel, puis on cherche dedans les montants et volumes de la
   fixture. Aucun ne doit s'y trouver.
   ===================================================================== */
LANGUE.configurer({ client: { functions: { invoke: () => Promise.resolve({ data: null }) } } });
const charge = JSON.stringify(LANGUE.chargeUtile(
  'Combien de RT avons-nous à Béoumi ?', IA.contexteComprehension(etat)));

const CHIFFRES_INTERDITS = [
  ['6000000', 'un montant d\'achat'],
  ['7000000', 'un montant d\'avance'],
  ['12000', 'un poids net'],
  ['20000', 'le cumul de volume'],
  ['11000000', 'le total des avances'],
  ['R-001', 'un numéro de reçu'],
];
for (const [valeur, quoi] of CHIFFRES_INTERDITS) {
  verifier(!charge.includes(valeur), `la charge linguistique contient ${quoi} (${valeur})`);
}
/* Ce qu'elle DOIT contenir : le vocabulaire et les noms de lieux, sans quoi
   elle ne peut pas situer une question. */
verifier(charge.includes('coverage_rt_count'), 'la charge doit porter le catalogue des intentions');
verifier(charge.includes('Béoumi'), 'la charge doit porter les noms de clusters');
verifier(!/\bmontant\b\s*:\s*\d/.test(charge), 'aucune paire montant/valeur ne doit y figurer');

/* La charge ne doit contenir aucune clé de données métier. */
for (const cle of ['achats', 'avances', 'reconciliations', 'sacs', 'solde', 'volumeKg']) {
  verifier(!charge.includes('"' + cle + '"'), `la charge expose la clé de données « ${cle} »`);
}

/* =========================================================================
   5. La couche linguistique : désactivée, bornée, refusable
   ===================================================================== */
verifier(LANGUE.etat().active === false,
  'la couche linguistique doit être DÉSACTIVÉE par défaut');
verifier(LANGUE.activee() === false,
  'aucune interprétation ne doit être possible sans activation explicite');
verifier(LANGUE.etat().timeoutMs > 0, 'un délai maximal doit être défini');

/* Kill switch : il l'emporte sur toute activation. */
LANGUE.configurer({ active: true });
LANGUE.couper('essai');
verifier(LANGUE.activee() === false, 'le kill switch doit couper la couche linguistique');
LANGUE.configurer({ active: false, tueur: false });

/* Un contrat renvoyé par le serveur est revalidé côté client : les mêmes
   mutations que dans le banc principal doivent toutes être refusées. */
const contratValide = COMPREHENSION.comprendre('Combien de RT avons-nous à Béoumi ?', CONTEXTE).contrat;
for (const [nom, mutation] of [
  ['intention inventée', { intent: 'donne_moi_tout' }],
  ['portée inventée', { scope: { type: 'pays', id: 'CI', label: 'Côte d\'Ivoire' } }],
  ['clé supplémentaire', { sql: 'select * from achats' }],
  ['réponse glissée', { answer_text: '3 000 MT' }],
]) {
  verifier(COMPREHENSION.valider(Object.assign({}, contratValide, mutation)).length > 0,
    `un contrat serveur avec ${nom} doit être refusé`);
}

/* =========================================================================
   6. Caviardage du journal
   ===================================================================== */
const caviarde = JOURNAL.caviarder(
  'Combien a payé KOFFI au 0709123456 pour le reçu 123456789 ? mail: a.b@c.ci');
verifier(!/0709123456/.test(caviarde), 'un numéro de téléphone doit être caviardé');
verifier(!/123456789/.test(caviarde), 'une suite de chiffres longue doit être caviardée');
verifier(!/a\.b@c\.ci/.test(caviarde), 'une adresse électronique doit être caviardée');
verifier(/Combien a paye|Combien a payé/.test(caviarde), 'le sens métier de la question doit survivre');
verifier(JOURNAL.caviarder('Combien de RT à Béoumi ?') === 'Combien de RT à Béoumi ?',
  'une question sans donnée personnelle doit passer intacte');
verifier(JOURNAL.caviarder('x'.repeat(900)).length <= 500,
  'la longueur journalisée doit être bornée');

/* Le journal reste inerte sans client : aucune tentative réseau hors ligne. */
JOURNAL.configurer({ client: null });
verifier(JOURNAL.etat().clientConfigure === false,
  'le journal doit rester inerte tant qu\'aucun client n\'est fourni');

/* =========================================================================
   7. Les politiques RLS proposées
   -------------------------------------------------------------------------
   Lecture du SQL. Ce n'est pas une exécution — celle-ci est faite par
   aflp-ia-journal-rls.mjs — mais ces règles-là se lisent, et un oubli s'y voit.
   ===================================================================== */
const sql = sansCommentairesSql(lire('docs/migrations/aflp_ia_journal_20260815.sql'));

for (const t of ['aflp_ia_questions', 'aflp_ia_feedback', 'aflp_ia_catalogue_versions',
  'aflp_ia_intentions', 'aflp_ia_formulations', 'aflp_ia_audit']) {
  verifier(new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(sql),
    `RLS non activée sur ${t}`);
}

/* Aucune politique « TO authenticated using (true) » : être connecté n'est pas
   une autorisation. */
verifier(!/to authenticated\s+using \(true\)/i.test(sql),
  'une politique accorde la lecture à tout compte connecté sans prédicat');

/* Chaque politique UPDATE porte USING et WITH CHECK. */
const updates = [...sql.matchAll(/create policy (\w+)[\s\S]*?for update[\s\S]*?(?=\n(?:create|drop|--|alter|\n))/gi)];
for (const u of updates) {
  verifier(/using \(/i.test(u[0]) && /with check \(/i.test(u[0]),
    `la politique UPDATE ${u[1]} n'a pas à la fois USING et WITH CHECK`);
}

/* SECURITY DEFINER : un seul emploi est toléré, celui du déclencheur d'audit,
   et seulement s'il respecte les quatre garde-fous. La règle n'est pas
   « aucun », elle est « aucun dans le schéma exposé, et aucun sans
   justification ni révocation ». */
const definers = [...sql.matchAll(/create or replace function\s+([\w.]+)\s*\([^)]*\)[\s\S]{0,400}?security definer/gi)]
  .map((m) => m[1]);
verifier(definers.length <= 1,
  `la migration crée ${definers.length} fonctions SECURITY DEFINER, une seule est justifiée`);
for (const f of definers) {
  verifier(f.startsWith('aflp_ia_interne.'),
    `la fonction SECURITY DEFINER ${f} est dans un schéma exposé par PostgREST`);
  verifier(new RegExp(`revoke all on function ${f.replace('.', '\\.')}\\(\\) from public`).test(sql),
    `EXECUTE n'est pas révoqué à PUBLIC sur ${f}`);
  verifier(new RegExp(`revoke all on function ${f.replace('.', '\\.')}\\(\\) from authenticated`).test(sql),
    `EXECUTE n'est pas révoqué à authenticated sur ${f}`);
}
verifier(/security definer\s*\n\s*set search_path = public, pg_temp/i.test(sql),
  'une fonction SECURITY DEFINER doit figer son search_path');
verifier(!/create or replace function\s+public\.[\w]+\s*\([^)]*\)[\s\S]{0,300}?security definer/i.test(sql),
  'aucune fonction SECURITY DEFINER ne doit vivre dans le schéma public exposé');
verifier(/security_invoker\s*=\s*true/.test(sql),
  'la vue de métriques doit être en security_invoker, sinon elle contourne la RLS');
verifier(!/user_metadata/.test(sql),
  'aucune décision d\'autorisation ne doit reposer sur user_metadata');
verifier(/revoke all on public\.aflp_ia_questions\s+from anon/.test(sql),
  'les droits du rôle anon doivent être explicitement révoqués');
verifier(/revoke update, delete, truncate on public\.aflp_ia_questions from authenticated/.test(sql),
  'le journal ne doit être ni modifiable ni supprimable depuis le navigateur');
verifier(/revoke insert on public\.aflp_ia_audit from authenticated/.test(sql),
  'l\'audit ne doit pas être alimentable à la main : il ne prouverait plus rien');
verifier(/est_bm\(\)/.test(sql) && /peut_editer_config\(\)/.test(sql),
  'les politiques doivent s\'appuyer sur les fonctions d\'autorisation existantes');
verifier(/create trigger aflp_ia_int_fige/.test(sql) && /create trigger aflp_ia_form_fige/.test(sql),
  'un catalogue publié doit être figé par déclencheur, pas seulement par politique');
verifier(/cle_idempotence\s+text not null unique/.test(sql),
  'la clé d\'idempotence doit être unique, sinon le rejeu hors ligne compte double');

/* =========================================================================
   8. L'écran d'administration
   ===================================================================== */
const admin = lire('terrain/aflp-ia-admin.html');
verifier(/data-module="admin"/.test(admin),
  'la page d\'administration doit passer par le portail avec le module « admin »');
verifier(/auth-gate\.js/.test(admin), 'la page d\'administration doit charger le portail');
verifier(!/\son(?:click|change|input|error|load|submit)\s*=\s*["']/i.test(admin),
  'la page d\'administration contient un gestionnaire d\'événement en ligne');
verifier(/replace\(\/\[&<>"'\]\/g/.test(admin),
  'la page d\'administration doit échapper les données affichées, apostrophe comprise');
verifier(!/from\((["'])(achats|avances|reconciliations|sacs_mouvements)\1\)/.test(admin),
  'la page d\'administration ne doit lire aucune table transactionnelle');
const tablesAdmin = [...admin.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
verifier(tablesAdmin.length > 0, 'la page d\'administration n\'interroge aucune table');
for (const t of tablesAdmin) {
  verifier(t.startsWith('aflp_ia_'),
    `la page d'administration touche une table hors du périmètre de l'assistant : ${t}`);
}

/* L'interface de l'assistant ne doit contenir aucun gestionnaire en ligne. */
verifier(!/\son(?:click|change|input|error|load)\s*=\s*["']/i.test(lire('shared/aflp-ia-ui.js')),
  'shared/aflp-ia-ui.js contient un gestionnaire d\'événement en ligne');

/* =========================================================================
   Verdict
   ===================================================================== */
if (echecs) {
  console.error(`\nÉCHEC — ${echecs} contrôle(s) de sécurité en défaut.`);
  process.exit(1);
}
console.log('OK - Sécurité AFLP : secrets, isolation du calcul, charge linguistique, RLS proposées, administration');
