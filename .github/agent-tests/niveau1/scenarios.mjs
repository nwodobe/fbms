// ============================================================================
// Banc d'essai Niveau 1 — scénarios de recette
// ----------------------------------------------------------------------------
// Chaque scénario démarre sur une base NEUVE : aucun test ne dépend de l'ordre
// d'exécution ni de l'état laissé par le précédent.
// ============================================================================

import { demarrer, connecter, COMPTES, RT_TEST, RT_TEST_2, PROD_TEST,
         Rapport, doitRefuser, doitAccepter, doitEtreVrai, doitEgaler } from './socle.mjs';

const PLAFONDS = [
  ['plafond_cycle_montant_max', 9_000_000],
  ['plafond_avance_montant_max', 9_000_000],
  ['plafond_achat_montant_max', 5_000_000],
  ['cycle_duree_jours', 21],
];

/** Base prête : plafonds définis, cycle ouvert, avance versée. */

export async function contexteCycle(db, { montantCycle = 5_000_000, avance = 5_000_000 } = {}) {
  await connecter(db, COMPTES.bm);
  for (const [c, v] of PLAFONDS)
    await db.query(`select public.n1_definir_parametre($1,$2,null,null,'recette Niveau 1','GLOBAL')`, [c, v]);
  const cycle = (await db.query(`select public.n1_ouvrir_cycle($1,$2,20000) c`, [RT_TEST, montantCycle])).rows[0].c;
  if (avance > 0) {
    await db.query(
      `insert into public.avances(local_id,cle_idempotence,date,rt_id,source,montant,created_by)
       values ('AV-1','AV-1',current_date,$1,'Finance',$2,auth.uid())`, [RT_TEST, avance]);
  }
  return cycle;
}

export const achatSql =
  `insert into public.achats(local_id,cle_idempotence,date,rt_id,producteur_id,poids_net,prix_kg,montant,numero_recu,created_by)
   values ($1,$1,current_date,$2,$3,$4,$5,$6,$7,auth.uid()) returning id, achat_code`;

// ---------------------------------------------------------------------------
// T01 — LOT A : identifiants uniques et idempotence
// ---------------------------------------------------------------------------
export async function t01_identifiants() {
  const r = new Rapport('T01 — Identifiants uniques et idempotence (Lot A)');
  const db = await demarrer();
  await contexteCycle(db);
  await connecter(db, COMPTES.agent);
  const ach = (l, recu, poids = 100) =>
    db.query(achatSql, [l, RT_TEST, PROD_TEST, poids, 500, poids * 500, recu]);

  const a1 = await doitAccepter(r, 'achat initial accepté', () => ach('L1', 'R-0001'));
  doitEtreVrai(r, 'un code métier lisible est attribué',
    /^ACH-AFLP2027-/.test(a1?.rows[0].achat_code || ''), a1?.rows[0].achat_code);

  // P0-1 : le reçu dupliqué doit être impossible, y compris déguisé.
  await doitRefuser(r, 'P0-1 · reçu strictement identique refusé', () => ach('L2', 'R-0001'), 'achats_recu');
  await doitRefuser(r, 'P0-1 · reçu masqué par la casse et les espaces refusé', () => ach('L3', 'r 0001'), 'achats_recu');
  await doitRefuser(r, 'P0-1 · reçu masqué par la ponctuation refusé', () => ach('L4', 'R/0001'), 'achats_recu');
  await doitAccepter(r, 'un reçu réellement différent est accepté', () => ach('L5', 'R-0002'));

  // Le même numéro de reçu chez un AUTRE RT reste licite : les carnets papier
  // sont numérotés indépendamment par RT (périmètre documenté en migration 02).
  await connecter(db, COMPTES.bm);
  await db.query(`select public.n1_ouvrir_cycle($1,1000000,5000) c`, [RT_TEST_2]);
  await db.query(`insert into public.avances(local_id,cle_idempotence,date,rt_id,source,montant,created_by)
                  values ('AV-2','AV-2',current_date,$1,'Finance',1000000,auth.uid())`, [RT_TEST_2]);
  await doitAccepter(r, 'même numéro de reçu chez un autre RT : accepté (périmètre assumé)',
    () => db.query(achatSql, ['L6', RT_TEST_2, PROD_TEST, 100, 500, 50000, 'R-0001']));

  // P0-8 : rejeu de synchronisation.
  await connecter(db, COMPTES.agent);
  await doitRefuser(r, "P0-8 · rejeu de la même clé d'idempotence refusé", () => ach('L1', 'R-0009'), 'duplicate key');
  const n = await db.query(`select count(*)::int c from public.achats where local_id='L1'`);
  doitEgaler(r, 'P0-8 · une seule ligne après double envoi', n.rows[0].c, 1);

  // Immuabilité des identifiants.
  await connecter(db, COMPTES.bm);
  await doitRefuser(r, 'identifiant local non réécrivable',
    () => db.query(`update public.achats set local_id='PIRATE' where id=$1`, [a1.rows[0].id]), 'immuable');
  await doitRefuser(r, 'code métier non réécrivable',
    () => db.query(`update public.achats set achat_code='ACH-FAUX' where id=$1`, [a1.rows[0].id]), 'immuable');

  await db.close?.();
  return r;
}

// ---------------------------------------------------------------------------
// T02 — LOT B : invariants métier et règle centrale du programme
// ---------------------------------------------------------------------------
export async function t02_invariants() {
  const r = new Rapport('T02 — Invariants métier serveur (Lot B)');
  const db = await demarrer();
  const cycle = await contexteCycle(db, { montantCycle: 2_000_000, avance: 1_000_000 });

  // P0-2 — LA règle du programme.
  await doitRefuser(r, 'P0-2 · deuxième cycle sur un RT non réconcilié refusé',
    () => db.query(`select public.n1_ouvrir_cycle($1,500000) c`, [RT_TEST]), 'non réconcilié');
  await doitRefuser(r, 'P0-2 · avance directe sur un RT sans cycle refusée',
    () => db.query(`insert into public.avances(local_id,cle_idempotence,date,rt_id,source,montant,created_by)
                    values ('X','X',current_date,$1,'Finance',10000,auth.uid())`, [RT_TEST_2]),
    'Aucun cycle de financement ouvert');
  doitEtreVrai(r, 'P0-2 · le RT est déclaré non refinançable',
    (await db.query(`select public.n1_rt_refinancable($1) v`, [RT_TEST])).rows[0].v === false);

  await connecter(db, COMPTES.agent);
  await doitAccepter(r, 'achat conforme accepté',
    () => db.query(achatSql, ['A1', RT_TEST, PROD_TEST, 1000, 500, 500000, 'R1']));
  await doitRefuser(r, 'P0-9 · montant non conforme à poids × prix refusé',
    () => db.query(achatSql, ['A2', RT_TEST, PROD_TEST, 100, 500, 999999, 'R2']), 'incohérent');
  await doitRefuser(r, 'P0-7 · producteur hors référentiel refusé',
    () => db.query(achatSql, ['A3', RT_TEST, 'INCONNU', 100, 500, 50000, 'R3']), 'référentiel');
  await doitRefuser(r, 'P0-7 · RT hors référentiel refusé',
    () => db.query(achatSql, ['A4', '00000000-0000-4000-9000-000000000099', PROD_TEST, 100, 500, 50000, 'R4']), 'référentiel');
  await doitRefuser(r, 'date future refusée',
    () => db.query(`insert into public.achats(local_id,cle_idempotence,date,rt_id,producteur_id,poids_net,prix_kg,montant,numero_recu,created_by)
                    values ('A5','A5',current_date+1,$1,$2,10,500,5000,'R5',auth.uid())`, [RT_TEST, PROD_TEST]), 'futur');
  await doitRefuser(r, 'pesée incohérente (brut - tare ≠ net) refusée',
    () => db.query(`insert into public.achats(local_id,cle_idempotence,date,rt_id,producteur_id,poids_brut,tare,poids_net,prix_kg,montant,numero_recu,created_by)
                    values ('A6','A6',current_date,$1,$2,100,5,80,500,40000,'R6',auth.uid())`, [RT_TEST, PROD_TEST]), 'pesée');
  await doitRefuser(r, 'invariant 3 · achat au-delà du financement disponible refusé',
    () => db.query(achatSql, ['A7', RT_TEST, PROD_TEST, 2000, 500, 1000000, 'R7']), 'Financement insuffisant');

  const dispo = (await db.query(`select public.n1_cycle_disponible($1) v`, [cycle.id])).rows[0].v;
  doitEgaler(r, 'financement disponible calculé par le serveur', Number(dispo), 500000);
  await db.close?.();

  // Règle « absence de valeur = blocage » : sur une base neuve où aucun plafond
  // n'a été saisi, l'opération à risque doit être REFUSÉE, jamais tolérée.
  const vierge = await demarrer();
  await connecter(vierge, COMPTES.bm);
  await doitRefuser(r, 'plafond non défini · ouverture de cycle refusée par défaut',
    () => vierge.query(`select public.n1_ouvrir_cycle($1,100000) c`, [RT_TEST]), 'non défini');
  await vierge.close?.();

  return r;
}

// ---------------------------------------------------------------------------
// T03 — LOT C : journal d'audit append-only
// ---------------------------------------------------------------------------
export async function t03_audit() {
  const r = new Rapport('T03 — Journal d\'audit append-only (Lot C)');
  const db = await demarrer();
  await contexteCycle(db);
  await connecter(db, COMPTES.agent);
  await db.query(achatSql, ['A1', RT_TEST, PROD_TEST, 100, 500, 50000, 'R1']);

  const n = (await db.query(`select count(*)::int c from public.n1_audit where ressource='achats'`)).rows[0].c;
  doitEtreVrai(r, 'la création d\'un achat est journalisée', n >= 1, `${n} événement(s)`);

  await connecter(db, COMPTES.bm);
  await doitRefuser(r, 'P0-5 · un rôle opérationnel ne peut pas modifier l\'audit',
    () => db.query(`update public.n1_audit set motif='falsifie' where id=(select min(id) from public.n1_audit)`), 'permission denied');
  await doitRefuser(r, 'P0-5 · un rôle opérationnel ne peut pas supprimer l\'audit',
    () => db.query(`delete from public.n1_audit`), 'permission denied');

  // Le propriétaire de la base (équivalent service_role / SQL Editor) non plus.
  await db.exec('reset role');
  await doitRefuser(r, 'P0-5 · le PROPRIÉTAIRE ne peut pas modifier l\'audit',
    () => db.query(`update public.n1_audit set motif='falsifie' where id=(select min(id) from public.n1_audit)`), 'append-only');
  await doitRefuser(r, 'P0-5 · le PROPRIÉTAIRE ne peut pas supprimer l\'audit',
    () => db.query(`delete from public.n1_audit where id=(select min(id) from public.n1_audit)`), 'append-only');
  await doitRefuser(r, 'P0-5 · le PROPRIÉTAIRE ne peut pas tronquer l\'audit',
    () => db.query(`truncate public.n1_audit`), 'append-only');

  // Masquage : aucune photo ni secret ne doit entrer dans le journal.
  await connecter(db, COMPTES.agent);
  await db.query(
    `insert into public.achats(local_id,cle_idempotence,date,rt_id,producteur_id,poids_net,prix_kg,montant,numero_recu,recu_photo,created_by)
     values ('A2','A2',current_date,$1,$2,10,500,5000,'R2',$3,auth.uid())`,
    [RT_TEST, PROD_TEST, 'data:image/png;base64,' + 'A'.repeat(5000)]);
  const photo = (await db.query(
    `select nouvelles_valeurs ->> 'recu_photo' v from public.n1_audit
     where ressource='achats' and nouvelles_valeurs ->> 'local_id' = 'A2'`)).rows[0]?.v;
  doitEtreVrai(r, 'la photo du reçu est masquée dans l\'audit',
    typeof photo === 'string' && photo.startsWith('[masqué'), String(photo).slice(0, 40));

  // Un changement de rôle laisse une trace, et nul ne modifie son propre rôle.
  await connecter(db, COMPTES.bm);
  await doitRefuser(r, 'auto-modification de son propre rôle refusée',
    () => db.query(`update public.profils set role='Supervisor' where user_id=$1`, [COMPTES.bm.id]), 'Auto-modification');
  await doitRefuser(r, 'auto-désactivation de son propre compte refusée',
    () => db.query(`update public.profils set actif=false where user_id=$1`, [COMPTES.bm.id]), 'Auto-modification');
  await doitAccepter(r, 'changement de rôle d\'un tiers accepté',
    () => db.query(`update public.profils set role='Supervisor' where user_id=$1`, [COMPTES.agent.id]));
  const cr = (await db.query(`select count(*)::int c from public.n1_audit where action='CHANGEMENT_ROLE'`)).rows[0].c;
  doitEtreVrai(r, 'le changement de rôle est journalisé', cr >= 1, `${cr} événement(s)`);

  await db.close?.();
  return r;
}

// ---------------------------------------------------------------------------
// T04 — LOT B : soldes physiques non négatifs
// ---------------------------------------------------------------------------
export async function t04_soldes() {
  const r = new Rapport('T04 — Stock RCN et sacs non négatifs (Lot B)');
  const db = await demarrer();
  await contexteCycle(db);
  await connecter(db, COMPTES.agent);

  const sac = (l, src, dst, qte, prod = null) => db.query(
    `insert into public.sacs_mouvements(local_id,cle_idempotence,date,type,source,destination,cluster,rt_id,producteur_id,quantite,created_by)
     values ($1,$1,current_date,'MOUVEMENT',$2,$3,'ALPHA',$4,$5,$6,auth.uid())`,
    [l, src, dst, RT_TEST, prod, qte]);

  await doitAccepter(r, 'dotation de 100 sacs au RT', () => sac('S1', 'ANAGROCI', 'RT', 100));
  await doitAccepter(r, 'distribution de 60 sacs au producteur', () => sac('S2', 'RT', 'PRODUCTEUR', 60, PROD_TEST));
  await doitRefuser(r, 'P0-3 · sortie de 60 sacs sur un solde de 40 refusée',
    () => sac('S3', 'RT', 'PRODUCTEUR', 60, PROD_TEST), 'non_negatif');
  await doitAccepter(r, 'sortie du solde exact (40) acceptée', () => sac('S4', 'RT', 'PRODUCTEUR', 40, PROD_TEST));
  await doitRefuser(r, 'P0-3 · sortie sur un solde nul refusée',
    () => sac('S5', 'RT', 'PRODUCTEUR', 1, PROD_TEST), 'non_negatif');
  await doitRefuser(r, 'mouvement vers un producteur non identifié refusé',
    () => sac('S6', 'ANAGROCI', 'PRODUCTEUR', 10), 'sans identifiant');

  const soldeProd = (await db.query(
    `select quantite from public.n1_soldes where article='SACS_VIDES' and entite_type='PRODUCTEUR'`)).rows[0];
  doitEgaler(r, 'les 100 sacs sont bien chez le producteur', Number(soldeProd?.quantite), 100);

  // Stock RCN alimenté par l'achat, dans la même transaction.
  await db.query(achatSql, ['A1', RT_TEST, PROD_TEST, 1500, 500, 750000, 'R1']);
  const stock = (await db.query(
    `select quantite from public.n1_soldes where article='RCN_KG' and entite_type='RT'`)).rows[0];
  doitEgaler(r, 'l\'achat alimente le stock RCN du RT', Number(stock?.quantite), 1500);
  const lie = (await db.query(`select count(*)::int c from public.n1_stock_mouvements where type='ENTREE_ACHAT'`)).rows[0].c;
  doitEgaler(r, 'un mouvement de stock est lié à l\'achat', lie, 1);

  const evac = (l, kg) => db.query(
    `insert into public.n1_stock_mouvements(local_id,cle_idempotence,type,source_type,source_ref,destination_type,destination_ref,cluster,rt_id,poids_kg,created_by)
     values ($1,$1,'EVACUATION','RT',$2,'HUB','ALPHA','ALPHA',$2,$3,auth.uid())`, [l, RT_TEST, kg]);
  await doitAccepter(r, 'évacuation de 1200 kg sur 1500', () => evac('E1', 1200));
  await doitRefuser(r, 'P0-3 · évacuation de 500 kg sur 300 restants refusée', () => evac('E2', 500), 'non_negatif');
  await doitAccepter(r, 'évacuation du solde exact (300)', () => evac('E3', 300));

  await db.close?.();
  return r;
}

// ---------------------------------------------------------------------------
// T05 — LOT D : clôture, immutabilité, ajustements
// ---------------------------------------------------------------------------
export async function t05_cloture() {
  const r = new Rapport('T05 — Clôture, immutabilité et ajustements (Lot D)');
  const db = await demarrer();
  await contexteCycle(db);
  // L'achat est saisi par le BM : c'est le seul montage qui permet de vérifier
  // que l'AUTEUR d'une écriture ne peut pas approuver la correction de son
  // propre travail, puisque seul un BM approuve un ajustement.
  await connecter(db, COMPTES.bm);
  const id = (await db.query(achatSql, ['A1', RT_TEST, PROD_TEST, 1000, 500, 500000, 'R1'])).rows[0].id;

  await connecter(db, COMPTES.superviseur);
  await doitAccepter(r, 'un tiers valide l\'achat', () => db.query(`update public.achats set n1_statut='VALIDE' where id=$1`, [id]));
  await connecter(db, COMPTES.bm2);
  await doitAccepter(r, 'le second BM réconcilie', () => db.query(`update public.achats set n1_statut='RECONCILIE' where id=$1`, [id]));
  await doitRefuser(r, 'un champ est gelé dès la réconciliation',
    () => db.query(`update public.achats set observation='modif' where id=$1`, [id]), 'gelé');
  await doitAccepter(r, 'la clôture reste possible depuis RECONCILIE',
    () => db.query(`update public.achats set n1_statut='CLOTURE' where id=$1`, [id]));
  await connecter(db, COMPTES.bm);

  await doitRefuser(r, 'P0-4 · modification d\'un montant clôturé refusée',
    () => db.query(`update public.achats set montant=1 where id=$1`, [id]), 'interdite');
  await doitRefuser(r, 'P0-4 · changement de statut d\'une opération clôturée refusé',
    () => db.query(`update public.achats set n1_statut='SOUMIS' where id=$1`, [id]), 'interdite');
  await doitRefuser(r, 'P0-4 · suppression d\'une opération clôturée refusée',
    () => db.query(`delete from public.achats where id=$1`, [id]), 'interdite');
  await db.exec('reset role');
  await doitRefuser(r, 'P0-4 · le PROPRIÉTAIRE ne modifie pas une opération clôturée',
    () => db.query(`update public.achats set montant=1 where id=$1`, [id]), 'interdite');

  // Ajustement : motif, preuve, et double séparation des tâches.
  await connecter(db, COMPTES.bm);
  await doitRefuser(r, 'ajustement sans preuve refusé',
    () => db.query(`select public.n1_demander_ajustement('achats',$1,'CORRECTION_POIDS','erreur de pesée','')`, [id]), 'Preuve obligatoire');
  // Le demandeur est ici le second BM : il a donc le rôle pour approuver, ce
  // qui isole la règle de séparation du simple contrôle de rôle.
  await connecter(db, COMPTES.bm2);
  const aj = (await db.query(
    `select public.n1_demander_ajustement('achats',$1,'CORRECTION_POIDS','Erreur de pesée constatée au hub','PV-RECETTE-001',null,-50) a`,
    [id])).rows[0].a;
  doitEtreVrai(r, 'l\'ajustement référence l\'enregistrement d\'origine', aj.enregistrement === id);

  await doitRefuser(r, 'le demandeur, pourtant BM, ne peut pas approuver son ajustement',
    () => db.query(`select public.n1_approuver_ajustement($1,true)`, [aj.id]), 'demandeur ne peut pas approuver');
  await connecter(db, COMPTES.bm);
  await doitRefuser(r, 'l\'auteur de l\'achat, pourtant BM, ne peut pas approuver sa correction',
    () => db.query(`select public.n1_approuver_ajustement($1,true)`, [aj.id]), 'écriture d\'origine');
  await connecter(db, COMPTES.superviseur);
  await doitRefuser(r, 'un rôle de contrôle sans habilitation n\'approuve pas',
    () => db.query(`select public.n1_approuver_ajustement($1,true)`, [aj.id]), 'Seul le Branch Manager');

  // Il faut donc un TROISIÈME acteur : ni l'auteur, ni le demandeur.
  await connecter(db, COMPTES.bm);
  await db.query(`update public.profils set role='Branch Manager' where user_id=$1`, [COMPTES.controle.id]);
  await connecter(db, COMPTES.controle);
  await doitAccepter(r, 'un tiers habilité, ni auteur ni demandeur, approuve',
    () => db.query(`select public.n1_approuver_ajustement($1,true)`, [aj.id]));

  const apres = (await db.query(`select montant, poids_net, n1_statut from public.achats where id=$1`, [id])).rows[0];
  doitEgaler(r, 'l\'écriture d\'origine n\'est PAS réécrite', Number(apres.montant), 500000);
  doitEgaler(r, 'l\'écriture d\'origine est marquée ajustée', apres.n1_statut, 'AJUSTE');
  const contre = (await db.query(`select poids_kg from public.n1_stock_mouvements where type='AJUSTEMENT'`)).rows[0];
  doitEgaler(r, 'une contre-écriture de stock est produite', Number(contre?.poids_kg), 50);
  const stock = (await db.query(`select quantite from public.n1_soldes where article='RCN_KG' and entite_type='RT'`)).rows[0];
  doitEgaler(r, 'le stock reflète la correction (1000 - 50)', Number(stock?.quantite), 950);

  await db.close?.();
  return r;
}

// ---------------------------------------------------------------------------
// T06 — LOT E : moteur de réconciliation et blocage du refinancement
// ---------------------------------------------------------------------------
export async function t06_reconciliation() {
  const r = new Rapport('T06 — Réconciliation et blocage du refinancement (Lot E)');
  const db = await demarrer();
  const cycle = await contexteCycle(db, { montantCycle: 2_000_000, avance: 1_000_000 });
  await connecter(db, COMPTES.agent);
  await db.query(achatSql, ['A1', RT_TEST, PROD_TEST, 1000, 500, 500000, 'R1']);

  // --- Cycle sain : cash et stock déclarés conformes au calcul serveur -------
  await connecter(db, COMPTES.bm);
  await doitRefuser(r, 'réconciliation sans preuve refusée',
    () => db.query(`select public.n1_reconcilier_cycle($1,500000,1000,0,'')`, [cycle.id]), 'Preuve obligatoire');

  const ok = (await db.query(
    `select public.n1_reconcilier_cycle($1, 500000, 1000, 0, 'PV-CAISSE-001') v`, [cycle.id])).rows[0].v;
  doitEgaler(r, 'un cycle sain passe RECONCILIE', ok.statut, 'RECONCILIE');
  doitEgaler(r, 'aucun écart constaté', ok.ecarts, 0);
  doitEtreVrai(r, 'toutes les dimensions sont calculées', (ok.lignes || []).length === 5,
    `${(ok.lignes || []).length} dimension(s)`);

  // Le RT redevient refinançable, et seulement maintenant.
  doitEtreVrai(r, 'après réconciliation, le RT est refinançable',
    (await db.query(`select public.n1_rt_refinancable($1) v`, [RT_TEST])).rows[0].v === true);
  await doitAccepter(r, 'un nouveau cycle peut être ouvert',
    () => db.query(`select public.n1_ouvrir_cycle($1,500000) c`, [RT_TEST]));
  await db.close?.();

  // --- Cycle avec écart cash inexpliqué -------------------------------------
  const db2 = await demarrer();
  const c2 = await contexteCycle(db2, { montantCycle: 2_000_000, avance: 1_000_000 });
  await connecter(db2, COMPTES.agent);
  await db2.query(achatSql, ['A1', RT_TEST, PROD_TEST, 1000, 500, 500000, 'R1']);
  await connecter(db2, COMPTES.bm);
  // Attendu : 1 000 000 − 500 000 = 500 000. Déclaré : 400 000. Manque 100 000.
  const ko = (await db2.query(
    `select public.n1_reconcilier_cycle($1, 400000, 1000, 0, 'PV-CAISSE-002') v`, [c2.id])).rows[0].v;
  doitEgaler(r, 'un écart cash inexpliqué bloque le cycle', ko.statut, 'BLOQUE');
  const cash = (ko.lignes || []).find((l) => l.dimension === 'CASH_RESTANT');
  doitEgaler(r, "l'écart cash est calculé par le serveur", Number(cash?.ecart), -100000);
  doitEgaler(r, "l'écart cash est classé P0", cash?.criticite, 'P0');
  doitEgaler(r, 'une preuve est exigée pour le résoudre', cash?.preuve_requise, 'PV de comptage de caisse signé');
  doitEtreVrai(r, 'un responsable est désigné', !!cash?.responsable);
  doitEtreVrai(r, 'une échéance de résolution est fixée', !!cash?.echeance);

  // Le blocage doit couper le refinancement ET les nouvelles écritures.
  doitEtreVrai(r, 'P0-2 · un cycle bloqué rend le RT non refinançable',
    (await db2.query(`select public.n1_rt_refinancable($1) v`, [RT_TEST])).rows[0].v === false);
  await doitRefuser(r, 'P0-2 · aucun nouveau cycle sur un cycle bloqué',
    () => db2.query(`select public.n1_ouvrir_cycle($1,100000) c`, [RT_TEST]), 'non réconcilié');
  await doitRefuser(r, 'aucune nouvelle avance sur un cycle bloqué',
    () => db2.query(`insert into public.avances(local_id,cle_idempotence,date,rt_id,source,montant,created_by)
                     values ('AV9','AV9',current_date,$1,'Finance',10000,auth.uid())`, [RT_TEST]), 'BLOQUE');
  await connecter(db2, COMPTES.agent);
  await doitRefuser(r, 'aucun nouvel achat sur un cycle bloqué',
    () => db2.query(achatSql, ['A9', RT_TEST, PROD_TEST, 10, 500, 5000, 'R9']), 'bloqué');

  // --- Déblocage : rôle, motif, preuve, séparation des tâches ---------------
  await connecter(db2, COMPTES.superviseur);
  await doitRefuser(r, 'un superviseur ne débloque pas un cycle',
    () => db2.query(`select public.n1_debloquer_cycle($1,'motif','preuve')`, [c2.id]), 'Branch Manager');
  await connecter(db2, COMPTES.bm);
  await doitRefuser(r, 'déblocage sans preuve refusé',
    () => db2.query(`select public.n1_debloquer_cycle($1,'motif','')`, [c2.id]), 'obligatoires');
  await doitRefuser(r, "celui qui a ouvert le cycle ne le débloque pas seul",
    () => db2.query(`select public.n1_debloquer_cycle($1,'Erreur de comptage','PV-002')`, [c2.id]), 'Séparation');

  await connecter(db2, COMPTES.bm2);
  await doitAccepter(r, 'un second BM débloque avec motif et preuve',
    () => db2.query(`select public.n1_debloquer_cycle($1,'Erreur de comptage corrigée','PV-CORRECTION-002','ERREUR_SAISIE')`, [c2.id]));
  const trace = (await db2.query(
    `select statut, cause, preuve_fournie, resolu_par from public.n1_reconciliation_lignes
     where cycle_uid=$1 and dimension='CASH_RESTANT'`, [c2.id])).rows[0];
  doitEgaler(r, "l'écart reste inscrit, marqué résolu", trace.statut, 'RESOLU');
  doitEgaler(r, 'la preuve du déblocage est conservée', trace.preuve_fournie, 'PV-CORRECTION-002');
  const audit = (await db2.query(`select count(*)::int c from public.n1_audit where action='DEBLOCAGE'`)).rows[0].c;
  doitEgaler(r, 'le déblocage laisse une trace permanente en audit', audit, 1);

  // Vue opérationnelle
  const vue = (await db2.query(`select vue_operationnelle, ecarts_ouverts from public.n1_vue_cycles where id=$1`, [c2.id])).rows[0];
  doitEtreVrai(r, 'la vue opérationnelle expose le cycle', !!vue, JSON.stringify(vue));

  await db2.close?.();
  return r;
}
