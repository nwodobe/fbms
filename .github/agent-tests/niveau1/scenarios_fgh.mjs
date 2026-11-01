// ============================================================================
// Banc d'essai Niveau 1 — scénarios des lots F, G et H
// ============================================================================

import { demarrer, connecter, COMPTES, RT_TEST, PROD_TEST,
         Rapport, doitRefuser, doitAccepter, doitEtreVrai, doitEgaler } from './socle.mjs';
import { contexteCycle, achatSql } from './scenarios.mjs';

// ---------------------------------------------------------------------------
// T07 — LOT F : moteur d'alertes déterministe
// ---------------------------------------------------------------------------
export async function t07_anomalies() {
  const r = new Rapport("T07 — Moteur d'alertes déterministe (Lot F)");
  const db = await demarrer();
  const cycle = await contexteCycle(db, { montantCycle: 2_000_000, avance: 1_000_000 });
  await connecter(db, COMPTES.bm);

  // Idempotence : trois détections du même problème = une seule anomalie.
  for (let i = 0; i < 3; i++) {
    await db.query(
      `select public.n1_signaler_tentative('RECU_DUPLIQUE','Reçu R-0001 déjà enregistré','achats','ABC',$1,'ALPHA')`,
      [RT_TEST]);
  }
  const uniq = (await db.query(
    `select count(*)::int c, max(occurrences)::int o from public.n1_anomalies where type_anomalie='RECU_DUPLIQUE'`)).rows[0];
  doitEgaler(r, "trois détections identiques ne créent qu'une anomalie", uniq.c, 1);
  doitEgaler(r, 'les occurrences sont comptées', uniq.o, 3);

  await db.query(
    `select public.n1_signaler_tentative('RECU_DUPLIQUE','Autre reçu','achats','XYZ',$1,'ALPHA')`, [RT_TEST]);
  doitEgaler(r, 'un problème distinct crée une anomalie distincte',
    (await db.query(`select count(*)::int c from public.n1_anomalies where type_anomalie='RECU_DUPLIQUE'`)).rows[0].c, 2);

  const a = (await db.query(
    `select anomalie_code, criticite, echeance, statut, responsable from public.n1_anomalies limit 1`)).rows[0];
  doitEtreVrai(r, "l'anomalie porte un identifiant unique", /^ANO-\d{4}-\d{6}$/.test(a.anomalie_code), a.anomalie_code);
  doitEgaler(r, 'une criticité est attribuée', a.criticite, 'P0');
  doitEtreVrai(r, 'une échéance de résolution est fixée', !!a.echeance);

  const id = (await db.query(`select id from public.n1_anomalies limit 1`)).rows[0].id;
  await doitRefuser(r, 'résolution sans preuve refusée',
    () => db.query(`select public.n1_resoudre_anomalie($1,'corrigé','')`, [id]), 'obligatoires');
  await doitAccepter(r, 'résolution avec preuve acceptée',
    () => db.query(`select public.n1_resoudre_anomalie($1,'Reçu corrigé au carnet','PV-ANO-001')`, [id]));
  doitEgaler(r, "l'historique de l'anomalie est conservé",
    (await db.query(`select count(*)::int c from public.n1_anomalies_historique where anomalie_id=$1`, [id])).rows[0].c, 2);

  // Une récidive après résolution doit rouvrir : sinon un problème résolu trop
  // vite masquerait toutes ses réapparitions.
  await db.query(
    `select public.n1_signaler_tentative('RECU_DUPLIQUE','Reçu R-0001 déjà enregistré','achats','ABC',$1,'ALPHA')`,
    [RT_TEST]);
  doitEgaler(r, 'une récidive après résolution rouvre une anomalie',
    (await db.query(`select count(*)::int c from public.n1_anomalies where type_anomalie='RECU_DUPLIQUE'`)).rows[0].c, 3);

  // Détection par lot. Simuler l'écoulement du temps demande d'écrire sur
  // n1_cycles, ce qu'aucun rôle applicatif ne peut faire : on repasse donc
  // propriétaire pour ce seul montage de scène, jamais pour un contrôle.
  await db.exec('reset role');
  await db.query(`update public.n1_cycles set echeance = current_date - 10 where id = $1`, [cycle.id]);
  await connecter(db, COMPTES.bm);
  const det = (await db.query(`select public.n1_detecter_anomalies() v`)).rows[0].v;
  doitEtreVrai(r, 'la détection par lot signale le cycle en retard', Number(det.detections) >= 1, JSON.stringify(det));
  doitEgaler(r, 'un retard de plus de sept jours est classé P0',
    (await db.query(`select criticite from public.n1_anomalies where type_anomalie='CYCLE_NON_CLOTURE_DELAI'`)).rows[0].criticite, 'P0');

  const det2 = (await db.query(`select public.n1_detecter_anomalies() v`)).rows[0].v;
  doitEgaler(r, 'relancer la détection ne duplique aucune alerte', det2.ouvertes, det.ouvertes);

  await db.close?.();
  return r;
}

// ---------------------------------------------------------------------------
// T08 — LOT G : hors ligne maîtrisé
// ---------------------------------------------------------------------------
export async function t08_synchronisation() {
  const r = new Rapport('T08 — Hors ligne, idempotence et conflits (Lot G)');
  const db = await demarrer();
  await contexteCycle(db);
  await connecter(db, COMPTES.agent);

  const charge = (local, recu) => ({
    local_id: local, date: new Date().toISOString().slice(0, 10), rt_id: RT_TEST,
    producteur_id: PROD_TEST, poids_net: 100, prix_kg: 500, montant: 50000, numero_recu: recu,
  });
  const pousser = (cle, term, res, ch) =>
    db.query(`select public.n1_sync_pousser($1,$2,$3,$4::jsonb) v`, [cle, term, res, JSON.stringify(ch)]);

  const r1 = (await pousser('IDEM-1', 'TEL-A', 'achats', charge('L1', 'R1'))).rows[0].v;
  doitEgaler(r, 'une saisie hors ligne est acceptée', r1.resultat, 'ACCEPTE');
  doitEtreVrai(r, 'le serveur émet un accusé de réception', r1.accuse === true);
  doitEtreVrai(r, "l'accusé porte l'identifiant serveur", !!r1.enregistrement);
  doitEtreVrai(r, "la purge locale n'est autorisée qu'après accusé", r1.purge_locale_autorisee === true);

  // Cas 2 et 3 du protocole : double clic, puis reprise après temporisation.
  const r2 = (await pousser('IDEM-1', 'TEL-A', 'achats', charge('L1', 'R1'))).rows[0].v;
  doitEgaler(r, 'double envoi signalé comme doublon', r2.resultat, 'DOUBLON');
  doitEgaler(r, "le doublon renvoie le MÊME identifiant serveur", r2.enregistrement, r1.enregistrement);
  doitEgaler(r, 'aucun doublon en base après plusieurs envois',
    (await db.query(`select count(*)::int c from public.achats where local_id='L1'`)).rows[0].c, 1);

  // Cas 4 : le même événement synchronisé par deux appareils.
  const r3 = (await pousser('IDEM-1', 'TEL-B', 'achats', charge('L1', 'R1'))).rows[0].v;
  doitEgaler(r, 'même clé depuis un autre terminal : aucune seconde écriture', r3.resultat, 'DOUBLON');
  // Le registre des conflits n'est lisible que par un rôle de contrôle : un
  // agent de terrain n'a pas à voir les arbitrages en cours.
  doitEgaler(r, "un agent ne voit pas le registre des conflits",
    (await db.query(`select count(*)::int c from public.n1_sync_conflits`)).rows[0].c, 0);
  await connecter(db, COMPTES.bm);
  doitEgaler(r, 'un conflit DOUBLE_TERMINAL est ouvert pour arbitrage',
    (await db.query(`select count(*)::int c from public.n1_sync_conflits where type_conflit='DOUBLE_TERMINAL'`)).rows[0].c, 1);
  await connecter(db, COMPTES.agent);

  // Règle critique : une exposition financière ne naît jamais d'un cache local.
  const fin = (await db.query(
    `select public.n1_sync_pousser('IDEM-AV','TEL-A','avances',$1::jsonb) v`,
    [JSON.stringify({ rt_id: RT_TEST, montant: 500000, date: '2026-08-14', source: 'Finance' })])).rows[0].v;
  doitEgaler(r, 'une avance créée hors ligne est REJETÉE', fin.resultat, 'REJETE');
  doitEtreVrai(r, 'le motif du rejet est explicite', /exposition financière/.test(fin.message || ''), fin.message);

  // Cas 10 : refus serveur d'une opération créée hors ligne. Le rejet doit
  // survivre à l'annulation de la transaction, sinon l'agent ne saura jamais.
  let motif = '';
  try {
    await pousser('IDEM-KO', 'TEL-A', 'achats', charge('L2', 'R1'));
  } catch (e) { motif = String(e.message).slice(0, 200); }
  doitEtreVrai(r, 'un achat au reçu déjà utilisé est refusé', motif.length > 0, motif.slice(0, 70));
  await db.query(`select public.n1_sync_enregistrer_rejet('IDEM-KO','TEL-A','achats',$1::jsonb,$2)`,
    [JSON.stringify(charge('L2', 'R1')), motif]);
  const etat = (await db.query(`select public.n1_sync_etat('TEL-A') v`)).rows[0].v;
  doitEgaler(r, 'le rejet est conservé dans la file serveur', Number(etat.rejetees), 2);
  doitEtreVrai(r, "l'agent peut consulter la raison du refus",
    (etat.rejets || []).some((x) => x.cle === 'IDEM-KO'));

  // Cas 7 : appareil perdu. La vérité est côté serveur, pas dans le téléphone.
  const global = (await db.query(`select public.n1_sync_etat() v`)).rows[0].v;
  doitEtreVrai(r, "un nouveau terminal retrouve l'état du compte",
    Number(global.acceptees) >= 1, JSON.stringify({ acceptees: global.acceptees }));

  await doitRefuser(r, "une opération sans clé d'idempotence est refusée",
    () => pousser('', 'TEL-A', 'achats', charge('L9', 'R9')), 'obligatoire');
  await doitRefuser(r, 'une opération sans identifiant de terminal est refusée',
    () => pousser('IDEM-9', '', 'achats', charge('L9', 'R9')), 'terminal');

  await connecter(db, COMPTES.bm);
  const conflit = (await db.query(`select id from public.n1_sync_conflits limit 1`)).rows[0].id;
  await doitRefuser(r, 'arbitrage sans décision motivée refusé',
    () => db.query(`select public.n1_sync_arbitrer_conflit($1,'')`, [conflit]), 'motivée');
  await doitAccepter(r, "un rôle de contrôle arbitre le conflit",
    () => db.query(`select public.n1_sync_arbitrer_conflit($1,'Terminal B est un rejeu du terminal A')`, [conflit]));

  await db.close?.();
  return r;
}

// ---------------------------------------------------------------------------
// T09 — LOT H : protocole papier de secours numéroté
// ---------------------------------------------------------------------------
export async function t09_papier() {
  const r = new Rapport('T09 — Protocole papier de secours numéroté (Lot H)');
  const db = await demarrer();
  await contexteCycle(db);
  await connecter(db, COMPTES.bm);

  const s = (await db.query(`select public.n1_papier_creer_serie('ALPHA',$1,1,10) v`, [RT_TEST])).rows[0].v;
  doitEtreVrai(r, 'une série numérotée est créée', !!s.serie_code, s.serie_code);
  doitEgaler(r, 'chaque numéro de la plage est matérialisé',
    (await db.query(`select count(*)::int c from public.n1_papier_numeros where serie_id=$1`, [s.id])).rows[0].c, 10);
  const n1 = (await db.query(`select numero_lisible from public.n1_papier_numeros where sequence=1`)).rows[0].numero_lisible;
  doitEtreVrai(r, 'le numéro respecte le format convenu', /^AFLP-AFLP2027-ALP-.+-000001$/.test(n1), n1);

  await doitRefuser(r, 'un numéro non attribué ne justifie aucune opération',
    () => db.query(`select public.n1_papier_consommer($1,'achats',gen_random_uuid())`, [n1]), 'non attribué');

  const att = (await db.query(`select public.n1_papier_attribuer($1,$2,'Responsable Test') v`,
    [s.id, COMPTES.agent.id])).rows[0].v;
  doitEgaler(r, 'la plage est attribuée à un responsable nommé', att.numeros_attribues, 10);
  await doitRefuser(r, 'une série déjà attribuée ne peut pas être réattribuée',
    () => db.query(`select public.n1_papier_attribuer($1,$2,'Autre')`, [s.id, COMPTES.agent.id]), 'déjà attribuée');

  await connecter(db, COMPTES.agent);
  const ach = (await db.query(achatSql, ['P1', RT_TEST, PROD_TEST, 100, 500, 50000, 'R-PAP-1'])).rows[0];
  await doitAccepter(r, 'un achat papier est rapproché de son formulaire',
    () => db.query(`select public.n1_papier_consommer($1,'achats',$2)`, [n1, ach.id]));
  const lien = (await db.query(`select papier_numero_id, source_saisie from public.achats where id=$1`, [ach.id])).rows[0];
  doitEtreVrai(r, 'la référence papier est conservée dans la transaction', !!lien.papier_numero_id);
  doitEgaler(r, "l'origine papier de la saisie est tracée", lien.source_saisie, 'PAPIER_SECOURS');

  const ach2 = (await db.query(achatSql, ['P2', RT_TEST, PROD_TEST, 100, 500, 50000, 'R-PAP-2'])).rows[0];
  await doitRefuser(r, 'un formulaire ne justifie pas deux opérations',
    () => db.query(`select public.n1_papier_consommer($1,'achats',$2)`, [n1, ach2.id]), 'déjà utilisé');
  await doitRefuser(r, 'un numéro hors registre est refusé',
    () => db.query(`select public.n1_papier_consommer('AFLP-FAUX-000999','achats',$1)`, [ach2.id]), 'inconnu du registre');

  await connecter(db, COMPTES.bm);
  const n3 = (await db.query(`select numero_lisible from public.n1_papier_numeros where sequence=3`)).rows[0].numero_lisible;
  await doitRefuser(r, 'annulation sans justification refusée',
    () => db.query(`select public.n1_papier_declarer($1,'ANNULE','')`, [n3]), 'Justification obligatoire');
  await doitAccepter(r, 'annulation justifiée acceptée',
    () => db.query(`select public.n1_papier_declarer($1,'ANNULE','Carnet déchiré par la pluie')`, [n3]));
  await connecter(db, COMPTES.agent);
  await doitRefuser(r, 'un numéro annulé ne peut plus servir',
    () => db.query(`select public.n1_papier_consommer($1,'achats',$2)`, [n3, ach2.id]), 'annule');

  await connecter(db, COMPTES.bm);
  const n4 = (await db.query(`select numero_lisible from public.n1_papier_numeros where sequence=4`)).rows[0].numero_lisible;
  await doitAccepter(r, 'perte déclarée et justifiée',
    () => db.query(`select public.n1_papier_declarer($1,'PERDU','Formulaire égaré entre le village et le hub')`, [n4]));
  doitEgaler(r, 'une perte déclarée lève une anomalie',
    (await db.query(`select count(*)::int c from public.n1_anomalies where type_anomalie='PAPIER_MANQUANT'`)).rows[0].c, 1);

  // Clôture quotidienne : le trou entre deux numéros utilisés doit se voir.
  await connecter(db, COMPTES.agent);
  const n5 = (await db.query(`select numero_lisible from public.n1_papier_numeros where sequence=5`)).rows[0].numero_lisible;
  await db.query(`select public.n1_papier_consommer($1,'achats',$2)`, [n5, ach2.id]);
  await connecter(db, COMPTES.bm);
  const cl = (await db.query(`select public.n1_papier_cloture_quotidienne('ALPHA') v`)).rows[0].v;
  doitEgaler(r, 'la clôture quotidienne marque les numéros utilisés', Number(cl.numeros_clotures), 2);
  doitEtreVrai(r, 'un numéro sauté entre deux numéros utilisés est signalé',
    Number(cl.anomalies_levees) >= 1, `${cl.anomalies_levees} anomalie(s)`);

  doitEgaler(r, 'le registre complet est consultable et imprimable',
    (await db.query(`select count(*)::int c from public.n1_vue_registre_papier`)).rows[0].c, 10);

  await db.close?.();
  return r;
}
