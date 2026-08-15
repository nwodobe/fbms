#!/usr/bin/env node
/**
 * AFLP — Niveau 3 (couche prédictive) : contrôle de non-régression.
 *
 * Trois natures de vérification, volontairement dans le même fichier :
 *
 *   1. STRUCTURE — le moteur et l'interface sont-ils branchés au Command
 *      Center ? Le moteur reste-t-il sans réseau, sans DOM, sans clé, sans
 *      la moindre fonction d'écriture ?
 *   2. GARDE-FOUS — les limites absolues du cadrage AFLP tiennent-elles ?
 *      C'est le point le plus important. Un moteur qui prévoit bien mais qui
 *      laisse passer une autorisation d'avance ne casse aucun test de syntaxe :
 *      il casse la règle de gouvernance du programme.
 *   3. MÉTHODE — la validation temporelle est-elle honnête ? Une prévision
 *      peut-elle voir le futur ? Une baseline est-elle toujours comparée ?
 *
 * Les douze scénarios obligatoires du cadrage (§22) sont numérotés SC-01 à
 * SC-12 dans les intitulés d'assertion, pour qu'on puisse les retrouver.
 *
 * Toutes les données de ce fichier sont FICTIVES et générées par une suite
 * déterministe : aucun nom de producteur, aucun montant réel, aucune
 * coordonnée de parcelle. Aucun appel réseau n'est effectué.
 *
 * Usage : node .github/agent-tests/aflp-ia-predictif.mjs
 * Sortie : 0 si tout passe, 1 sinon.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const racine = process.cwd();
const require = createRequire(path.join(racine, 'package-inexistant.js'));

const fichiers = {
  moteur: 'shared/aflp-ia-predictif.js',
  interface: 'shared/aflp-ia-predictif-ui.js',
  page: 'terrain/command.html',
  migration: 'docs/migrations/aflp_predictions_20260814.sql',
  verification: 'docs/migrations/aflp_predictions_verify_20260814.sql',
  rollback: 'docs/migrations/aflp_predictions_rollback_20260814.sql',
  gardeFous: 'docs/migrations/aflp_predictions_garde_fous_20260814.sql',
};
const source = Object.fromEntries(
  Object.entries(fichiers).map(([k, rel]) => [k, fs.readFileSync(path.join(racine, rel), 'utf8')])
);

const P = require(path.join(racine, 'shared/aflp-ia-predictif.js'));

let n = 0;
const ok = (cond, message) => { n++; assert.ok(cond, message); };
const eq = (a, b, message) => { n++; assert.equal(a, b, message); };

/* =========================================================================
   0. Générateur de données FICTIVES, déterministe
   ------------------------------------------------------------------------
   Suite congruentielle à graine fixe : deux exécutions produisent le même
   jeu. Sans cela, un test de déterminisme ne prouverait rien.
   ===================================================================== */

function jourDe(base, k) {
  const d = new Date(Date.parse(base + 'T00:00:00Z') + k * 86400000);
  return d.toISOString().slice(0, 10);
}

function suite(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const DEBUT = '2026-01-05';

/**
 * @param {number} jours      profondeur d'historique
 * @param {object} opt        variations : villages, qualité, poids ronds, etc.
 */
function fabriquerAchats(jours, opt = {}) {
  const rnd = suite(opt.graine ?? 7);
  const villages = opt.villages ?? [
    ['Village Alpha', 'Brobo', 'RT-01'],
    ['Village Beta', 'Brobo', 'RT-02'],
    ['Village Gamma', 'Diabo', 'RT-03'],
  ];
  const out = [];
  for (let i = 0; i < jours; i++) {
    const j = jourDe(DEBUT, i);
    const dow = (i + 1) % 7;
    if (dow === 0 || dow === 6) continue;           // pas de collecte le week-end
    villages.forEach(([v, c, rt], vi) => {
      const lignes = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < lignes; k++) {
        let poids = Math.round((280 + vi * 90) * (0.75 + rnd() * 0.5));
        if (opt.poidsRonds && rt === opt.poidsRonds) poids = Math.round(poids / 5) * 5;
        out.push({
          date: j,
          poids_net: poids,
          poids_brut: poids + 4,
          tare: 4,
          montant: poids * 340,
          prix_kg: 340,
          commission_rt: poids * 10,
          cluster: c,
          village_nom: v,
          rt_id: rt,
          rt_nom: rt,
          producteur_id: opt.concentration === rt ? 'P-UNIQUE' : 'P-' + ((vi * 5 + k) % 11),
          producteur_nom: 'Producteur fictif',
          numero_recu: opt.sansRecu === rt && k === 0 ? '' : 'RC-' + i + '-' + k,
          refinancable: !(opt.sansRecu === rt && k === 0),
          humidite: (opt.humiditeHaute === v ? 14 : 8) + rnd() * 0.5,
          kor: 47 + rnd() * 1.5,
          rejet: false,
          qualite_statut: 'OK',
          statut_validation: 'Validé',
          nb_sacs: Math.ceil(poids / 80),
        });
      }
    });
  }
  return out;
}

function jeu(jours, opt = {}) {
  const achats = opt.achats ?? fabriquerAchats(jours, opt);
  const dernier = achats.length ? achats[achats.length - 1].date : jourDe(DEBUT, jours - 1);
  return {
    dateRef: opt.dateRef ?? jourDe(DEBUT, jours - 1),
    achats,
    avances: opt.avances ?? [
      { date: jourDe(DEBUT, Math.max(0, jours - 8)), montant: 90000000, rt_id: 'RT-01', rt_nom: 'RT-01', cluster: 'Brobo' },
      { date: jourDe(DEBUT, Math.max(0, jours - 6)), montant: 80000000, rt_id: 'RT-02', rt_nom: 'RT-02', cluster: 'Brobo' },
    ],
    reconciliations: opt.reconciliations ?? [
      { date: jourDe(DEBUT, Math.max(0, jours - 3)), rt_id: 'RT-01', rt_nom: 'RT-01', cluster: 'Brobo',
        statut: 'Réconcilié', ecart: 0, cash_restant: 0, valeur_stock: 0, created_at: jourDe(DEBUT, Math.max(0, jours - 3)) },
    ],
    sacs: opt.sacs ?? [],
    villages: opt.villagesRef ?? [
      { nom: 'Village Alpha', cluster: 'Brobo' },
      { nom: 'Village Beta', cluster: 'Brobo' },
      { nom: 'Village Gamma', cluster: 'Diabo' },
    ],
    rt: [
      { nom: 'RT-01', village_nom: 'Village Alpha' },
      { nom: 'RT-02', village_nom: 'Village Beta' },
      { nom: 'RT-03', village_nom: 'Village Gamma' },
    ],
    parametres: opt.parametres ?? [],
    fileLocale: opt.fileLocale ?? { enAttente: 0, echecs: 0 },
    dernierJour: dernier,
  };
}

/* Chaque test qui touche au registre ou aux seuils les remet d'aplomb : sans
   cela, un test en contaminerait un autre et l'ordre du fichier deviendrait
   une dépendance cachée. */
function neutre() { P.reinitialiserModeles(); P.reinitialiserSeuils(); }

/* =========================================================================
   1. STRUCTURE — câblage et innocuité du moteur
   ===================================================================== */

ok(source.page.includes('shared/aflp-ia-predictif.js'),
  'command.html ne charge plus le moteur prédictif');
ok(source.page.includes('shared/aflp-ia-predictif-ui.js'),
  'command.html ne charge plus l\'interface prédictive');
ok(source.page.includes('id="aflpPred"'),
  'le conteneur #aflpPred a disparu de command.html');
assert.match(source.page, /AFLP_PRED_UI\.rafraichir\(/,
  'command.html n\'alimente plus la couche prédictive après le chargement des données');
assert.match(source.page, /AFLP_PRED_UI\.monter\(/,
  'command.html ne monte plus le panneau prédictif');
n += 5;

/* Sans ces colonnes, les cas d'usage « comportements inhabituels » et « écarts
   de qualité » retomberaient à R0 faute de REQUÊTE, et non faute de donnée.
   La distinction compte : elle change le diagnostic présenté à la Direction. */
for (const col of ['prix_kg', 'humidite', 'kor', 'producteur_id', 'nb_sacs']) {
  ok(new RegExp(`q\\("achats","[^"]*${col}`).test(source.page),
    `la requête achats doit remonter la colonne ${col}`);
}

/* Le moteur n'est PAS un client : ni réseau, ni DOM, ni clé, ni écriture.
   La recherche porte sur le CODE seul. Chercher dans les commentaires ferait
   échouer le test sur la phrase qui explique justement l'interdit — un test
   qu'il faut contourner par la paraphrase ne protège rien. On retire donc
   commentaires et littéraux de chaîne avant de chercher.

   Les expressions régulières restent dans le texte analysé (elles sont vues
   comme des divisions). C'est sans conséquence : aucune de celles du moteur ne
   contient « // » ni « /* », les deux seules séquences qui pourraient tromper
   ce découpage. */
function sansCommentairesNiChaines(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const guillemet = c;
      i++;
      while (i < n && src[i] !== guillemet) { if (src[i] === '\\') i++; i++; }
      i++;
      out += '""';                       // la chaîne est remplacée, pas supprimée
      continue;
    }
    out += c; i++;
  }
  return out;
}

const moteurCode = sansCommentairesNiChaines(source.moteur);

for (const interdit of [
  'fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon',
  'supabase', 'createClient', 'document.', 'window.location', 'localStorage',
  '.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', '.from(',
  'SUPABASE_URL', 'SUPABASE_ANON', 'apikey', 'eval(', 'Function(',
]) {
  ok(!moteurCode.includes(interdit),
    `le moteur prédictif ne doit contenir aucun appel « ${interdit} »`);
}

/* Contrôle croisé : le découpage ci-dessus fonctionne-t-il vraiment ? Si le
   moteur cessait un jour d'expliquer ses interdits, ce test le signalerait —
   et rappellerait que l'absence de trace dans `moteurCode` a bien du sens. */
ok(source.moteur.includes('Supabase') || source.moteur.includes('supabase'),
  'le moteur doit continuer d\'expliquer, en commentaire, pourquoi il n\'appelle pas Supabase');
ok(!moteurCode.includes('Supabase'),
  'le découpage code/commentaires ne fonctionne plus : le contrôle d\'innocuité serait sans valeur');

/* L'interface échappe toute donnée avant insertion dans le DOM. */
ok(/function esc\(/.test(source.interface), 'l\'interface a perdu sa fonction d\'échappement');
ok(source.interface.includes("'\"': \"&quot;\""), 'l\'échappement ne couvre plus les guillemets');
ok(source.interface.includes('"\'": "&#39;"'), 'l\'échappement ne couvre plus l\'apostrophe');
n += 3;

/* =========================================================================
   2. GARDE-FOUS — les limites absolues (§2 et §21 du cadrage)
   ===================================================================== */

// SC-06 · Toute demande d'action est refusée, sans exception ni échappatoire.
neutre();
for (const tentative of [
  'autoriser_avance', 'modifier_plafond', 'transfert_wave', 'lever_blocage',
  'valider_perte', 'approuver_exception', 'modifier_transaction_cloturee',
  'supprimer_preuve', 'sanctionner_rt', 'accuser_fraude', 'modifier_role',
  'creer_mission_transport', 'sortie_stock', '', null, undefined,
  { type: 'autoriser_avance', force: true },   // le drapeau ne doit rien changer
]) {
  const r = P.executer(tentative);
  eq(r.accepte, false, `SC-06 · la demande « ${JSON.stringify(tentative)} » doit être refusée`);
}
ok(P.journalRefus().length >= 16, 'SC-06 · chaque refus doit être journalisé');

// Les quatorze interdits du cadrage sont tous portés par le code.
const interdits = P.GARDES.map((g) => g.interdit).join(' | ');
for (const attendu of [
  'autoriser une avance', 'modifier un plafond', 'transfert Wave', 'lever un blocage',
  'valider une perte', 'approuver une exception', 'transaction clôturée',
  'supprimer une transaction', 'sanctionner', 'fraudeur',
  'approbation humaine', 'commande de transport', 'rôle utilisateur', 'sortir du stock',
]) {
  ok(interdits.includes(attendu), `le garde-fou « ${attendu} » a disparu de GARDES`);
}

// Les sorties possibles forment une liste fermée : rien qui ressemble à un acte.
for (const s of P.SORTIES_AUTORISEES) {
  ok(['prevision', 'intervalle', 'score', 'signal', 'recommandation', 'priorite'].includes(s),
    `sortie inattendue exposée par la couche prédictive : ${s}`);
}

// L'API publique n'expose AUCUNE fonction dont le nom évoque une écriture.
for (const nomApi of Object.keys(P)) {
  ok(!/^(ecrire|inserer|enregistrer|sauver|appliquer|valider|autoriser|creer|supprimer)/i.test(nomApi),
    `l'API expose « ${nomApi} », dont le nom évoque une écriture`);
}

// Aucun intitulé d'action interdit dans l'interface — commentaires compris.
for (const libelle of [
  'Autoriser automatiquement', 'Lever automatiquement', 'Sanctionner',
  'Valider la perte', 'Corriger la transaction', 'Approuver', 'Débloquer',
]) {
  ok(!source.interface.includes(libelle),
    `l'interface ne doit contenir nulle part l'intitulé « ${libelle} »`);
}

// Le vocabulaire des signaux ne qualifie jamais une faute.
ok(!/fraude (av[ée]r|prouv)/i.test(source.moteur),
  'le moteur ne doit jamais qualifier une fraude comme établie');
ok(source.moteur.includes('signal à examiner'),
  'la qualification neutre « signal à examiner » a disparu');
n += 2;

// SC-07 · Accès refusé à un utilisateur non autorisé.
// Contrôle STATIQUE sur la migration : aucune base n'est jointe ici, et le
// prétendre serait faux. Le contrôle exécuté en base est le §7 de
// docs/migrations/aflp_predictions_verify_20260814.sql.
ok(/alter table public\.aflp_predictions\s+force row level security/.test(source.migration),
  'SC-07 · la RLS doit être FORCÉE sur aflp_predictions (sinon le propriétaire la contourne)');
ok(!/create policy \w+ on public\.aflp_predictions\s+for insert to authenticated/.test(source.migration),
  'SC-07 · aucune politique INSERT ne doit être ouverte à `authenticated` sur aflp_predictions');
/* Symétrique indispensable : sans politique INSERT pour le rôle technique, la
   RLS FORCÉE rend le GRANT lettre morte et le pipeline batch est muet. Ce
   défaut a réellement été trouvé en exécutant la migration sur PostgreSQL 16. */
ok(/create policy aflp_pred_ins_modele on public\.aflp_predictions\s+for insert to aflp_model/.test(source.migration),
  'SC-07 · une politique INSERT réservée à `aflp_model` est indispensable, sinon aucun modèle ne peut écrire');
ok(source.verification.includes('CONTRÔLE POSITIF'),
  'SC-07 · le script de vérification doit contenir un contrôle positif, pas seulement des interdits');
ok(source.migration.includes('using (public.est_actif())'),
  'SC-07 · la lecture des prédictions doit exiger un profil actif');
ok(/revoke insert, update, delete, truncate on public\.achats\s+from aflp_model/.test(source.migration),
  'SC-06 · le rôle technique ne doit disposer d\'aucune écriture sur `achats`');
ok(source.migration.includes('revoke all on public.aflp_prediction_reviews from aflp_model'),
  'le rôle technique ne doit pas pouvoir écrire une revue humaine à la place d\'un humain');
ok(source.migration.includes('revoke insert, update, delete on public.aflp_model_registry from aflp_model'),
  'un modèle ne doit pas pouvoir se promouvoir lui-même');
n += 6;

/* =========================================================================
   3. MÉTHODE — fuite temporelle, déterminisme, baselines
   ===================================================================== */

neutre();
const complet = jeu(120);
const A = P.analyser(complet);

// Aucune donnée postérieure à la date de référence n'entre dans le calcul.
{
  const avecFutur = jeu(120);
  avecFutur.achats = avecFutur.achats.concat(
    fabriquerAchats(10, { graine: 99 }).map((a) => ({ ...a, date: jourDe(complet.dateRef, 5), poids_net: 999999 }))
  );
  const B = P.analyser(avecFutur);
  const a7 = A.resultats.volumes.global.find((p) => p.horizon === 7);
  const b7 = B.resultats.volumes.global.find((p) => p.horizon === 7);
  eq(b7.valeur, a7.valeur,
    'FUITE · une ligne datée après la date de référence ne doit RIEN changer à la prévision');
  ok(B.diagnostic.cas.volumes.mesures.lignesRejetees.futur > 0,
    'FUITE · les lignes futures doivent être comptées comme écartées');
}

// Déterminisme : deux exécutions sur les mêmes données donnent le même résultat.
{
  neutre();
  const x = JSON.stringify(P.analyser(jeu(120)).resultats);
  neutre();
  const y = JSON.stringify(P.analyser(jeu(120)).resultats);
  eq(x, y, 'DÉTERMINISME · deux exécutions identiques doivent produire le même résultat');
}

// Idempotence des identifiants de prédiction : même jeu, mêmes identifiants.
{
  neutre();
  const p1 = P.analyser(jeu(120)).predictions.map((p) => p.prediction_id).join(',');
  neutre();
  const p2 = P.analyser(jeu(120)).predictions.map((p) => p.prediction_id).join(',');
  eq(p1, p2, 'IDEMPOTENCE · les identifiants de prédiction doivent être reproductibles');
}

// Le backtest n'emploie jamais de valeur postérieure à son origine.
{
  const serie = Array.from({ length: 60 }, (_, i) => ({ jour: jourDe(DEBUT, i), valeur: i < 50 ? 100 : 100000 }));
  const bt = P.backtest(serie.slice(0, 50), 7, P.BASELINES.find((b) => b.cle === 'moyenne7'));
  ok(bt.detail.every((pli) => pli.prevu <= 1000),
    'FUITE · le backtest ne doit voir aucune valeur au-delà de la série qu\'on lui donne');
}

// Toutes les baselines sont comparées, et la retenue est justifiée par le WAPE.
{
  const v7 = A.resultats.volumes.global.find((p) => p.horizon === 7);
  eq(v7.comparaison.length, P.BASELINES.length,
    'BASELINE · les quatre baselines doivent être comparées, pas seulement la gagnante');
  const retenues = v7.comparaison.filter((c) => c.retenue);
  eq(retenues.length, 1, 'BASELINE · une seule méthode doit être retenue');
  const meilleur = Math.min(...v7.comparaison.map((c) => c.wape));
  ok((retenues[0].wape - meilleur) / (meilleur || 1) <= 0.05 + 1e-9,
    'BASELINE · la méthode retenue doit être à 5 % ou moins du meilleur WAPE');
  ok(v7.metriques.plis >= 4, 'BASELINE · la validation temporelle doit compter au moins 4 plis');
  ok(v7.metriques.wape != null && v7.metriques.mae != null && v7.metriques.biais != null,
    'BASELINE · WAPE, MAE et biais doivent être renseignés');
}

// SC-02 · À égalité de performance, la méthode la plus simple l'emporte.
{
  const faux = (cleM, wape) => ({ methode: cleM, nom: cleM, wape, mae: 1, biais: 0, plis: 5, residusRelatifs: [] });
  const champ = P.choisirChampion([
    faux('moyenne28', 0.200), faux('naif', 0.204), faux('mediane7', 0.300),
  ]);
  eq(champ.methode, 'naif',
    'SC-02 · une amélioration de moins de 5 % ne justifie pas une méthode moins simple');
}

// L'intervalle exige assez de résidus, sinon il n'est pas produit.
{
  eq(P.intervalle(100, [1, 1.1, 0.9]).bas, null,
    'INTERVALLE · moins de 10 résidus doit donner un intervalle absent, pas un intervalle faible');
  const iv = P.intervalle(100, Array.from({ length: 20 }, (_, i) => 0.8 + i * 0.02));
  ok(iv.bas != null && iv.haut != null && iv.bas < 100 && iv.haut > 100,
    'INTERVALLE · avec assez de résidus, l\'intervalle doit encadrer le point');
  eq(iv.niveau, 0.80, 'INTERVALLE · le niveau annoncé doit être 80 %');
}

/* La couverture de l'intervalle est MESURÉE, pas supposée.
   Annoncer 80 % sans jamais vérifier combien de réalisations tombent dedans,
   c'est publier une affirmation invérifiée — précisément ce que le cadrage
   interdit sous le nom de « métrique sans baseline ». */
{
  neutre();
  const v7 = P.analyser(jeu(120)).resultats.volumes.global.find((p) => p.horizon === 7);
  const cv = v7.metriques.couvertureIntervalle;
  ok(cv, 'COUVERTURE · la métrique de couverture doit être calculée');
  eq(cv.mesurable, true, 'COUVERTURE · sur 12 plis, elle doit être mesurable');
  ok(cv.valeur >= 0 && cv.valeur <= 1, 'COUVERTURE · la couverture doit être une proportion');
  eq(cv.niveauAnnonce, 0.80, 'COUVERTURE · le niveau annoncé doit être rappelé');
  ok(cv.erreurType > 0, 'COUVERTURE · l\'incertitude de la mesure doit être fournie');
  ok(typeof cv.ecartSignificatif === 'boolean',
    'COUVERTURE · un écart doit être qualifié de significatif ou non, pas laissé au lecteur');
  /* Le point décisif : sur peu de plis, le module ne doit PAS conclure que la
     couverture est confirmée. Il doit dire qu'il ne peut pas la réfuter. */
  if (!cv.ecartSignificatif) {
    ok(/ne CONFIRME pas/.test(cv.motif),
      'COUVERTURE · un écart non significatif ne doit jamais être présenté comme une confirmation');
  }
  // Sous le seuil de plis, la couverture n'est pas inventée.
  const faible = P.couvertureIntervalle({ detail: [{ prevu: 1, reel: 1 }, { prevu: 2, reel: 2 }] });
  eq(faible.mesurable, false, 'COUVERTURE · deux plis ne permettent aucune mesure');
  eq(faible.valeur, null, 'COUVERTURE · aucune valeur ne doit être produite sans base suffisante');
}

/* Le besoin SUPPLÉMENTAIRE déduit le cash déjà en circulation.
   Ne pas le déduire reviendrait à demander deux fois les mêmes fonds. */
{
  neutre();
  const f = P.analyser(jeu(120)).resultats.fonds;
  const d = f.detailBesoinSupplementaire;
  ok(d, 'FONDS · le détail du besoin supplémentaire doit être fourni');
  eq(f.besoinSupplementaireTheorique,
    Math.max(0, d.besoinAvecMarge - d.cashDejaEnCirculation),
    'FONDS · le besoin supplémentaire doit déduire le cash déjà en circulation');
  ok(f.besoinSupplementaireTheorique >= 0,
    'FONDS · un besoin supplémentaire ne peut pas être négatif');
  ok(/AGRÉGÉ/.test(d.reserve),
    'FONDS · la réserve sur l\'agrégation doit être portée : le cash d\'une équipe bloquée ne finance pas une autre');
  ok(f.besoinSupplementaireTheorique !== d.besoinAvecMarge || d.cashDejaEnCirculation === 0,
    'FONDS · le besoin supplémentaire ne doit pas être une simple copie du besoin total');
}

/* =========================================================================
   4. LES DOUZE SCÉNARIOS OBLIGATOIRES (§22)
   ===================================================================== */

// SC-01 · Données insuffisantes → NOT_READY.
{
  neutre();
  const maigre = P.analyser(jeu(6));
  eq(maigre.diagnostic.cas.volumes.niveau, 'R0',
    'SC-01 · six jours d\'historique doivent donner R0');
  eq(maigre.resultats.volumes.statut, 'NOT_READY',
    'SC-01 · un cas d\'usage R0 ne doit produire aucune prévision');
  eq(maigre.resultats.volumes.global.length, 0,
    'SC-01 · aucune valeur ne doit être produite en NOT_READY');
  ok(maigre.resultats.volumes.blocages.length > 0,
    'SC-01 · le refus doit être motivé, pas silencieux');
  eq(maigre.predictions.filter((p) => p.cas_usage === 'volumes').length, 0,
    'SC-01 · aucune prédiction ne doit être enregistrée en NOT_READY');
}

// SC-03 · Données en retard → confiance réduite.
{
  neutre();
  const base = jeu(120);
  const aJour = P.analyser(base).resultats.volumes.global.find((p) => p.horizon === 7);
  const enRetard = P.analyser({ ...base, dateRef: jourDe(base.dateRef, 6) })
    .resultats.volumes.global.find((p) => p.horizon === 7);
  const rang = { bonne: 3, moyenne: 2, faible: 1, nulle: 0 };
  ok(rang[enRetard.confiance] < rang[aJour.confiance],
    'SC-03 · six jours de retard doivent dégrader la confiance');
  ok(/retard/.test(enRetard.motifConfiance),
    'SC-03 · le motif doit nommer le retard des données');
}

// SC-04 · Prédiction très incertaine → avertissement explicite.
{
  neutre();
  // Série volontairement erratique : le WAPE dépasse le seuil d'avertissement.
  const rnd = suite(3);
  const erratique = [];
  for (let i = 0; i < 120; i++) {
    const j = jourDe(DEBUT, i);
    const lignes = rnd() > 0.5 ? 1 : 0;
    for (let k = 0; k < lignes; k++) {
      const poids = rnd() > 0.85 ? 9000 : 60;
      erratique.push({
        date: j, poids_net: poids, montant: poids * 340, prix_kg: 340, commission_rt: poids * 10,
        cluster: 'Brobo', village_nom: 'Village Alpha', rt_id: 'RT-01', rt_nom: 'RT-01',
        producteur_id: 'P-1', numero_recu: 'RC', refinancable: true,
        qualite_statut: 'OK', statut_validation: 'Validé',
      });
    }
  }
  const r = P.analyser(jeu(120, { achats: erratique })).resultats.volumes;
  const v7 = r.global.find((p) => p.horizon === 7);
  ok(v7.metriques.wape > 0.35,
    'SC-04 · le jeu erratique doit bien produire un WAPE au-delà du seuil (préalable du test)');
  eq(v7.incertain, true,
    'SC-04 · une prévision au-delà du seuil de WAPE doit être marquée incertaine');
  ok(r.villagesTropIncertains.length > 0,
    'SC-04 · les entités trop incertaines doivent être listées séparément');
}

// SC-05 · Modèle indisponible → FBMS et le Niveau 2 continuent normalement.
{
  neutre();
  P.desactiver('volumes', 'essai de coupure');
  const r = P.analyser(jeu(120));
  eq(r.resultats.volumes.statut, 'DESACTIVE',
    'SC-05 · un modèle désactivé doit se déclarer tel');
  eq(r.resultats.volumes.global.length, 0,
    'SC-05 · un modèle désactivé ne doit produire aucune valeur');
  ok(r.resultats.scorecardRt.statut !== 'DESACTIVE',
    'SC-05 · désactiver un modèle ne doit pas en désactiver un autre');
  ok(r.diagnostic.cas.volumes.niveau !== undefined,
    'SC-05 · le diagnostic de maturité doit continuer de fonctionner');
  ok(typeof P.resumeTexte(r) === 'string' && P.resumeTexte(r).length > 200,
    'SC-05 · le résumé doit rester produit malgré un modèle coupé');
  // Le Niveau 2 est un fichier distinct, sans aucune dépendance au Niveau 3.
  const moteurN2 = fs.readFileSync(path.join(racine, 'shared/aflp-ia-moteur.js'), 'utf8');
  ok(!moteurN2.includes('AFLP_PRED'),
    'SC-05 · le moteur de niveau 2 ne doit dépendre en rien de la couche prédictive');
  P.reactiver('volumes');
}

// SC-08 · Dérive importante → modèle désactivable, retour à la baseline.
{
  neutre();
  // La dérive compare les 28 derniers jours aux 28 précédents. La rupture doit
  // donc tomber DANS cette fenêtre : au jour 92, pas au milieu de l'historique.
  // Une chute ancienne est déjà absorbée par les deux fenêtres et n'est plus
  // une dérive — c'est le régime courant.
  const rnd = suite(11);
  const derivant = [];
  for (let i = 0; i < 120; i++) {
    const j = jourDe(DEBUT, i);
    const facteur = i < 92 ? 1 : 0.25;
    const poids = Math.round(400 * facteur * (0.9 + rnd() * 0.2));
    derivant.push({
      date: j, poids_net: poids, montant: poids * 340, prix_kg: 340, commission_rt: poids * 10,
      cluster: 'Brobo', village_nom: 'Village Alpha', rt_id: 'RT-01', rt_nom: 'RT-01',
      producteur_id: 'P-1', numero_recu: 'RC', refinancable: true,
      qualite_statut: 'OK', statut_validation: 'Validé',
    });
  }
  const r = P.analyser(jeu(120, { achats: derivant }));
  eq(r.derive.mesurable, true, 'SC-08 · la dérive doit être mesurable sur 120 jours');
  eq(r.derive.derive, true, 'SC-08 · une chute de 75 % du rythme doit être détectée comme dérive');
  ok(/desactiver/.test(r.derive.action), 'SC-08 · l\'action recommandée doit nommer la désactivation');

  const coupe = P.desactiver('volumes', 'dérive détectée le ' + r.dateRef);
  eq(coupe.ok, true, 'SC-08 · le modèle doit être désactivable');
  eq(coupe.statut, 'DESACTIVE', 'SC-08 · la coupure doit être effective');
  eq(P.registre().find((m) => m.cle === 'volumes').actif, false,
    'SC-08 · le registre doit refléter la coupure');
  eq(P.reactiver('volumes').ok, true, 'SC-08 · la réactivation doit rester possible');
}

// SC-09 · Nouveau village → repli contrôlé, jamais de chiffre inventé.
{
  neutre();
  const avecNouveau = fabriquerAchats(120).concat(
    // Un village qui n'apparaît que sur les trois derniers jours.
    [117, 118, 119].map((i) => ({
      date: jourDe(DEBUT, i), poids_net: 500, montant: 170000, prix_kg: 340, commission_rt: 5000,
      cluster: 'Diabo', village_nom: 'Village Neuf', rt_id: 'RT-09', rt_nom: 'RT-09',
      producteur_id: 'P-9', numero_recu: 'RC-N', refinancable: true,
      qualite_statut: 'OK', statut_validation: 'Validé',
    }))
  );
  const r = P.analyser(jeu(120, { achats: avecNouveau })).resultats.volumes;
  const neuf = r.parVillage.filter((p) => p.entiteNom === 'Village Neuf' && p.horizon === 7)[0];
  eq(neuf.statut, 'NOT_READY',
    'SC-09 · un village de trois jours d\'historique ne doit recevoir aucune prévision');
  eq(neuf.valeur, null, 'SC-09 · aucune valeur ne doit être inventée pour un nouveau village');
  const repli = r.nouveauxVillages.find((v) => v.nom === 'Village Neuf');
  ok(repli && /cluster/.test(repli.repli),
    'SC-09 · le repli documenté sur le cluster doit être proposé explicitement');
  // Les villages installés, eux, continuent d'être prévus.
  ok(r.parVillage.some((p) => p.horizon === 7 && p.statut === 'SHADOW_ONLY'),
    'SC-09 · un village neuf ne doit pas empêcher les autres d\'être prévus');
}

// SC-10 · Comportement inhabituel → signal à examiner, jamais sanction.
{
  neutre();
  const r = P.analyser(jeu(120, { concentration: 'RT-02', sansRecu: 'RT-03', graine: 5 })).resultats.signaux;
  ok(r.signaux.length > 0, 'SC-10 · une concentration extrême doit produire au moins un signal');
  for (const s of r.signaux) {
    eq(s.qualification, 'signal à examiner',
      'SC-10 · tout signal doit être qualifié « signal à examiner »');
    ok(s.observation && s.norme && s.ecart,
      'SC-10 · un signal doit porter observation, norme et écart');
    ok(Array.isArray(s.facteursExplicatifs) && s.facteursExplicatifs.length >= 2,
      'SC-10 · un signal doit proposer plusieurs explications légitimes avant toute suspicion');
    ok(/sanction|accusation|blocage automatique/.test(s.interdit),
      'SC-10 · un signal doit rappeler ce qu\'il ne permet PAS');
    ok(s.actionHumaineRecommandee && s.actionHumaineRecommandee.length > 20,
      'SC-10 · un signal doit recommander une action humaine concrète');
    ok(!/fraude|coupable|voleur|détournement/i.test(
      [s.titre, s.observation, s.actionHumaineRecommandee].join(' ')),
      'SC-10 · aucun signal ne doit employer un vocabulaire d\'accusation');
  }
  eq(r.fauxPositifs.mesurables, false,
    'SC-10 · le taux de faux positifs ne doit pas être présenté comme mesuré alors qu\'il ne l\'est pas');
  ok(r.fauxPositifs.procedure.length > 20,
    'SC-10 · la procédure permettant de le mesurer un jour doit être décrite');
}

// SC-11 · Écart qualité → investigation, jamais perte validée.
{
  neutre();
  const villages = [
    ['Village Alpha', 'Brobo', 'RT-01'], ['Village Beta', 'Brobo', 'RT-02'],
    ['Village Gamma', 'Diabo', 'RT-03'], ['Village Delta', 'Diabo', 'RT-04'],
    ['Village Epsilon', 'Botro', 'RT-05'],
  ];
  const r = P.analyser(jeu(120, { villages, humiditeHaute: 'Village Epsilon', graine: 13 })).resultats.qualite;
  ok(r.statut !== 'NOT_READY', 'SC-11 · avec des mesures d\'humidité, le cas d\'usage doit s\'exécuter');
  ok(r.ecarts.length > 0, 'SC-11 · un village à 14 % d\'humidité contre 8 % doit ressortir');
  for (const e of r.ecarts) {
    ok(e.normeAttendue != null && e.intervalleNormal.bas != null,
      'SC-11 · un écart doit s\'accompagner de la norme et de l\'intervalle normal');
    ok(e.facteursExplicatifs.includes('Erreur de mesure (opérateur)'),
      'SC-11 · l\'erreur de mesure doit figurer parmi les causes à écarter');
    ok(e.facteursExplicatifs.includes('Dérive d\'équipement (humidimètre non étalonné)'),
      'SC-11 · la dérive d\'équipement doit figurer parmi les causes à écarter');
    ok(/valide aucune perte/.test(e.interdit),
      'SC-11 · un écart ne doit jamais valider une perte');
    ok(!/responsable est|faute de|imputable à/i.test(JSON.stringify(e)),
      'SC-11 · aucun écart ne doit désigner un responsable');
    if (e.importanceEconomique) {
      ok(/[Aa]pproximation/.test(e.importanceEconomique.reserve),
        'SC-11 · le chiffrage économique doit être annoncé comme une approximation');
    }
  }
  eq(r.comparaisonUsine.disponible, false,
    'SC-11 · la comparaison village ↔ usine doit être annoncée indisponible, pas simulée');
}

// SC-12 · Recommandation de fonds → aucune avance créée, blocages maintenus.
{
  neutre();
  const r = P.analyser(jeu(120)).resultats.fonds;
  ok(r.statut !== 'NOT_READY', 'SC-12 · le besoin de fonds doit s\'exécuter sur 120 jours');
  ok(r.scenarios.bas && r.scenarios.central && r.scenarios.haut,
    'SC-12 · trois scénarios doivent être produits');
  ok(r.scenarios.bas.total <= r.scenarios.central.total
     && r.scenarios.central.total <= r.scenarios.haut.total,
    'SC-12 · les trois scénarios doivent être ordonnés');
  ok(/soumise à Finance/.test(r.avertissement),
    'SC-12 · l\'estimation doit être explicitement soumise à Finance');
  ok(/[Aa]ucune avance n'est\s+créée/.test(r.avertissement),
    'SC-12 · l\'absence de création d\'avance doit être écrite');
  for (const g of ['G01', 'G02', 'G03']) {
    ok(r.gardes.includes(g), `SC-12 · le garde-fou ${g} doit être rappelé`);
  }
  ok(r.reserves.some((x) => /bloquants/.test(x)),
    'SC-12 · les cycles non réconciliés doivent rester annoncés comme bloquants');
  ok(r.reserves.some((x) => /plafonds validés priment/.test(x)),
    'SC-12 · la primauté des plafonds validés doit être rappelée');
  ok(r.enveloppeVsPic && r.enveloppeVsPic.picHistorique === null,
    'SC-12 · le pic d\'exposition ne doit pas être inventé faute de donnée');
  // Une prédiction de fonds enregistrée reste en revue humaine « non revue ».
  const rec = P.analyser(jeu(120)).predictions.find((p) => p.cas_usage === 'fonds');
  eq(rec.statut_revue_humaine, 'NON_REVUE',
    'SC-12 · une prédiction ne peut pas naître déjà revue par un humain');
  eq(rec.decision_humaine, null, 'SC-12 · aucune décision humaine ne doit être pré-remplie');
}

/* =========================================================================
   5. GOUVERNANCE — promotion, statuts, porte du Niveau 1
   ===================================================================== */

// Aucun modèle ne dépasse SHADOW_ONLY par défaut.
{
  neutre();
  const r = P.analyser(jeu(120));
  for (const cle of Object.keys(r.resultats)) {
    ok(['NOT_READY', 'SHADOW_ONLY', 'DESACTIVE'].includes(r.resultats[cle].statut),
      `le modèle « ${cle} » ne doit pas dépasser SHADOW_ONLY sans décision de gouvernance`);
  }
  ok(/AIDE À LA DÉCISION/.test(r.mentionObligatoire),
    'la mention « aide à la décision » doit être présente en tête de toute sortie');
}

// La promotion exige des validations nominatives ET une preuve de performance.
{
  neutre();
  eq(P.promouvoir('fonds', {}).ok, false,
    'GOUVERNANCE · une promotion sans validation doit être refusée');
  eq(P.promouvoir('fonds', { finance: 'A. N.' }).ok, false,
    'GOUVERNANCE · le besoin de fonds exige Finance ET Branch Manager');
  eq(P.promouvoir('fonds', { finance: 'Responsable Finance', branchManager: 'Branch Manager' }).ok, false,
    'GOUVERNANCE · sans preuve de performance, la promotion doit être refusée');
  const okPromo = P.promouvoir('fonds', {
    finance: 'Responsable Finance', branchManager: 'Branch Manager',
    performanceSuperieureBaseline: true,
  });
  eq(okPromo.ok, true, 'GOUVERNANCE · une promotion complète doit être acceptée');
  eq(okPromo.statut, 'DECISION_SUPPORT', 'GOUVERNANCE · le statut doit alors changer');
  // Les rôles exigés correspondent au cadrage AFLP.
  eq(P.VALIDATIONS_REQUISES.evacuations.includes('logistics'), true,
    'GOUVERNANCE · les évacuations exigent Logistics');
  eq(P.VALIDATIONS_REQUISES.qualite.includes('quality'), true,
    'GOUVERNANCE · la qualité exige Quality/Factory');
  neutre();
}

// La porte du Niveau 1 constate, elle ne déclare pas.
{
  neutre();
  const porte = P.analyser(jeu(120)).diagnostic.porteNiveau1;
  eq(porte.franchie, false,
    'PORTE N1 · avec le schéma FBMS actuel, la porte ne peut pas être franchie');
  for (const code of ['N1-04', 'N1-08', 'N1-09', 'N1-13']) {
    const p = porte.points.find((x) => x.code === code);
    ok(p && p.statut !== 'CONFORME' && p.criticite === 'P0',
      `PORTE N1 · le prérequis ${code} doit rester ouvert et classé P0`);
    ok(p.constat.length > 60,
      `PORTE N1 · le prérequis ${code} doit porter un constat circonstancié`);
  }
  ok(porte.points.length >= 13, 'PORTE N1 · les treize prérequis doivent être évalués');
}

// Les six cas d'usage sont diagnostiqués, et le cas 5 reste R0 par fait de schéma.
{
  neutre();
  const d = P.analyser(jeu(120)).diagnostic;
  eq(d.ordre.length, 6, 'MATURITÉ · les six cas d\'usage doivent être diagnostiqués');
  eq(d.cas.evacuations.niveau, 'R0',
    'MATURITÉ · sans table d\'évacuation, le cas 5 doit rester R0');
  ok(d.cas.evacuations.blocages.some((b) => /clé de jointure/.test(b)),
    'MATURITÉ · la rupture de traçabilité doit être nommée');
  for (const cle of d.ordre) {
    ok(['R0', 'R1', 'R2', 'R3'].includes(d.cas[cle].niveau),
      `MATURITÉ · le cas « ${cle} » doit porter un niveau R0-R3`);
    ok(typeof d.cas[cle].risqueFuite === 'string' && d.cas[cle].risqueFuite.length > 20,
      `MATURITÉ · le cas « ${cle} » doit porter une analyse de risque de fuite`);
  }
}

// Le cas 5 expose ses prérequis, et son calcul s'active dès qu'on lui donne les données.
{
  neutre();
  const sans = P.analyser(jeu(120)).resultats.evacuations;
  eq(sans.statut, 'NOT_READY', 'ÉVACUATIONS · sans données, aucune date de saturation');
  eq(sans.calculDisponible, true, 'ÉVACUATIONS · le calcul doit être implémenté, pas promis');
  ok(sans.prerequis.length >= 6, 'ÉVACUATIONS · les prérequis manquants doivent être énumérés');

  const avec = P.analyser({
    ...jeu(120),
    capacites: { BROBO: 400000, DIABO: 200000 },
    evacuations: [{ cluster: 'Brobo', date: jourDe(DEBUT, 90), tonnage_kg: 100000 }],
  }).resultats.evacuations;
  ok(avec.clusters.length > 0,
    'ÉVACUATIONS · avec capacités et sorties, le calcul doit produire un résultat');
  const brobo = avec.clusters.find((c) => c.cluster === 'BROBO');
  ok(brobo && brobo.dateSaturationProbable,
    'ÉVACUATIONS · une date de saturation doit être calculée');
  eq(brobo.nombreVehicules, null,
    'ÉVACUATIONS · le nombre de véhicules ne doit pas être inventé sans capacité au schéma');
}

/* =========================================================================
   6. SCORECARD — multidimensionnelle, équitable, contestable
   ===================================================================== */
{
  neutre();
  const r = P.analyser(jeu(120)).resultats.scorecardRt;
  eq(r.compositeParDefaut, false,
    'SCORECARD · aucun score composite ne doit être produit par défaut');
  eq(r.dimensions.length, 8, 'SCORECARD · les huit dimensions doivent être présentes');
  ok(r.equipes.length > 0, 'SCORECARD · les équipes doivent être évaluées');
  for (const eq2 of r.equipes) {
    for (const dim of r.dimensions) {
      const d = eq2.dimensions[dim.cle];
      ok(d, `SCORECARD · la dimension « ${dim.cle} » manque pour ${eq2.nom}`);
      ok(d.motif && d.donnees && d.periode && d.confiance,
        `SCORECARD · la dimension « ${dim.cle} » doit porter motif, données, période et confiance`);
    }
    // La dimension « incidents » est INCONNUE, pas nulle : la distinction compte.
    eq(eq2.dimensions.incidents.score, null,
      'SCORECARD · faute de table d\'incidents, la dimension doit rester vide et non à zéro');
    eq(eq2.dimensions.incidents.confiance, 'nulle',
      'SCORECARD · une dimension sans donnée doit afficher une confiance nulle');
    ok(/contestée|contester/.test(eq2.contestation),
      'SCORECARD · le droit de contester une donnée doit être rappelé sur chaque fiche');
    ok(typeof eq2.lecture.comportementInhabituel === 'string',
      'SCORECARD · performance et comportement inhabituel doivent rester séparés');
  }
  ok(r.biais.parCluster.length > 0, 'SCORECARD · l\'audit de biais par cluster doit être calculé');
  eq(r.biais.parAnciennete, null,
    'SCORECARD · l\'audit par ancienneté doit être annoncé impossible, pas simulé');
  ok(/ancienneté/.test(r.biais.motifAnciennete),
    'SCORECARD · le motif de cette impossibilité doit être écrit');
}

// Une équipe à faible échantillon est signalée, pas mal notée.
{
  neutre();
  const achats = fabriquerAchats(120).concat([
    { date: jourDe(DEBUT, 118), poids_net: 100, montant: 34000, prix_kg: 340, commission_rt: 1000,
      cluster: 'Botro', village_nom: 'Village Rare', rt_id: 'RT-RARE', rt_nom: 'RT-RARE',
      producteur_id: 'P-1', numero_recu: 'RC-R', refinancable: true,
      qualite_statut: 'OK', statut_validation: 'Validé' },
  ]);
  const eqRare = P.analyser(jeu(120, { achats })).resultats.scorecardRt.equipes
    .find((x) => x.nom === 'RT-RARE');
  eq(eqRare.donneesInsuffisantes, true,
    'SCORECARD · une équipe à un seul achat doit être signalée « données insuffisantes »');
  eq(eqRare.confianceStatistique, 'faible',
    'SCORECARD · sa confiance statistique doit être faible');
}

/* =========================================================================
   7. MODÈLE COMMUN DE PRÉDICTIONS — accord code ↔ schéma SQL
   ===================================================================== */
{
  neutre();
  const r = P.analyser(jeu(120));
  ok(r.predictions.length > 0, 'PRÉDICTIONS · des enregistrements doivent être produits');
  for (const rec of r.predictions) {
    eq(Object.keys(rec).length, P.CHAMPS_PREDICTION.length,
      'PRÉDICTIONS · chaque enregistrement doit porter exactement les champs du modèle commun');
    ok(rec.prediction_id && rec.cas_usage && rec.version_modele
       && rec.version_variables && rec.version_dataset && rec.statut_modele,
      'PRÉDICTIONS · identifiant, cas d\'usage, versions et statut sont obligatoires');
    eq(rec.campagne, 'AFLP 2027', 'PRÉDICTIONS · la campagne doit être renseignée');
    // Aucune période prévue ne peut commencer avant la date de calcul.
    if (rec.periode_debut && rec.horizon_jours > 0) {
      ok(rec.periode_debut > rec.date_calcul,
        'PRÉDICTIONS · une période prévue doit commencer après la date de calcul');
    }
    if (rec.borne_basse != null && rec.borne_haute != null) {
      ok(rec.borne_basse <= rec.borne_haute,
        'PRÉDICTIONS · un intervalle ne peut pas être inversé');
    }
  }
  // Chaque champ du modèle commun existe bien comme colonne dans la migration.
  for (const champ of P.CHAMPS_PREDICTION) {
    ok(new RegExp(`^\\s+${champ}\\s`, 'm').test(source.migration),
      `PRÉDICTIONS · le champ « ${champ} » doit exister comme colonne dans la migration SQL`);
  }
}

/* =========================================================================
   8. MIGRATION — cohérence et sécurité du dossier SQL
   ===================================================================== */

ok(/N'A PAS ÉTÉ EXÉCUTÉE/.test(source.migration),
  'MIGRATION · le fichier doit annoncer clairement qu\'il n\'a pas été appliqué');
ok(!/^\s*(alter|drop)\s+table\s+public\.(achats|avances|reconciliations|sacs_mouvements)/im.test(source.migration),
  'MIGRATION · aucune table transactionnelle ne doit être modifiée');
ok(source.migration.includes('aflp_predictions_immuables'),
  'MIGRATION · le déclencheur d\'immutabilité doit être présent');
ok(source.rollback.includes('drop table if exists public.aflp_predictions'),
  'ROLLBACK · le retour arrière doit supprimer les tables de prédiction');
ok(!/drop table[^\n]*public\.(achats|avances|reconciliations|sacs_mouvements)/i.test(source.rollback),
  'ROLLBACK · le retour arrière ne doit toucher à AUCUNE table opérationnelle');
ok(source.verification.includes('has_table_privilege'),
  'VÉRIFICATION · les droits du rôle technique doivent être contrôlés en base');
/* Un droit DÉCLARÉ peut être contredit par un GRANT oublié ailleurs ; une
   tentative d'écriture qui échoue, non. D'où ce second script. */
ok(source.gardeFous.includes('set local role aflp_model'),
  'GARDE-FOUS · le script de preuve doit endosser le rôle technique et tenter réellement les écritures');
for (const garde of ['G01', 'G02', 'G04', 'G07', 'G08', 'G11', 'G13', 'G14']) {
  ok(source.gardeFous.includes(garde),
    `GARDE-FOUS · le garde-fou ${garde} doit être éprouvé par une tentative réelle`);
}
ok(/11 tentatives bloquées/.test(source.gardeFous),
  'GARDE-FOUS · le résultat attendu doit être consigné dans le script');
ok(/statut\s+text not null default 'NOT_READY'/.test(source.migration),
  'MIGRATION · le statut par défaut d\'un modèle doit être NOT_READY');
eq((source.migration.match(/'NOT_READY', true,/g) || []).length, 6,
  'MIGRATION · les six modèles doivent être amorcés en NOT_READY et actifs');
n += 7;

/* Aucun secret nulle part.
   Le motif vise des VALEURS de secret, pas des mots. « service_role » est un
   nom de rôle PostgreSQL, cité à juste titre dans la migration pour expliquer
   pourquoi la RLS doit être FORCÉE : l'interdire reviendrait à interdire
   d'expliquer la mesure de sécurité elle-même. Ce qu'on cherche, c'est une clé
   privée, un jeton JWT, ou une affectation de clé de service. */
const MOTIFS_SECRET = [
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /sb_secret_[A-Za-z0-9_-]{8,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,                 // JWT
  /(SERVICE_ROLE_KEY|service_role_key|apikey)\s*[:=]\s*['"][A-Za-z0-9_.-]{16,}/,
];
for (const [nom, contenu] of Object.entries(source)) {
  for (const motif of MOTIFS_SECRET) {
    ok(!motif.test(contenu), `SECRET · une valeur sensible apparaît dans ${nom} (${motif})`);
  }
}

/* =========================================================================
   Fin
   ===================================================================== */
console.log(`OK - AFLP niveau 3 : ${n} assertions — câblage, garde-fous, ` +
  `fuite temporelle, déterminisme, baselines, 12 scénarios obligatoires, ` +
  `gouvernance, scorecard, modèle commun, migration.`);
