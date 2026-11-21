// ============================================================================
// Banc d'essai Niveau 1 — paiements, commissions et détecteurs complémentaires
// Cycle d'amélioration 1 · migration 10
// ============================================================================

import { demarrer, connecter, COMPTES, RT_TEST, PROD_TEST,
         Rapport, doitRefuser, doitAccepter, doitEtreVrai, doitEgaler } from './socle.mjs';
import { contexteCycle, achatSql } from './scenarios.mjs';

export async function t10_paiements_commissions() {
  const r = new Rapport('T10 — Paiements, commissions et détecteurs (amélioration 1)');
  const db = await demarrer();
  const cycle = await contexteCycle(db, { montantCycle: 5_000_000, avance: 5_000_000 });
  await connecter(db, COMPTES.bm);
  await db.query(`select public.n1_definir_parametre('commission_rt_fcfa_kg',10,null,null,
                  'Taux de commission RT — recette','GLOBAL')`);

  await connecter(db, COMPTES.agent);
  const ach = (await db.query(achatSql, ['A1', RT_TEST, PROD_TEST, 1000, 500, 500000, 'R1'])).rows[0];

  // --- Paiements -----------------------------------------------------------
  const paie = (l, montant, mode, ref = null, achatId = ach.id, type = 'PRODUCTEUR') => db.query(
    `insert into public.n1_paiements(local_id,cle_idempotence,rt_id,cluster,achat_id,
       beneficiaire,montant,mode_paiement,reference_externe,created_by,beneficiaire_type)
     values ($1,$1,$2,'ALPHA',$3,'Beneficiaire Test',$4,$5,$6,public.n1_uid(),$7)
     returning paiement_code, cycle_uid`, [l, RT_TEST, achatId, montant, mode, ref, type]);

  const p1 = await doitAccepter(r, 'paiement partiel en espèces accepté', () => paie('P1', 300000, 'ESPECES'));
  doitEtreVrai(r, 'un code de paiement lisible est attribué',
    /^PAI-AFLP2027-ALP-\d{6}$/.test(p1?.rows[0].paiement_code || ''), p1?.rows[0].paiement_code);
  doitEtreVrai(r, 'le paiement est rattaché au cycle automatiquement',
    p1?.rows[0].cycle_uid === cycle.id);

  await doitAccepter(r, 'second paiement partiel, dans la limite de l\'achat',
    () => paie('P2', 200000, 'ESPECES'));
  await doitRefuser(r, 'un paiement au-delà du montant de l\'achat est refusé',
    () => paie('P3', 1, 'ESPECES'), 'supérieur au montant de l');

  await doitRefuser(r, 'un paiement Wave sans référence externe est refusé',
    () => paie('P4', 100, 'WAVE', null, null, 'TRANSPORTEUR'), 'Référence externe obligatoire');
  await doitAccepter(r, 'un paiement Wave avec référence est accepté',
    () => paie('P5', 100, 'WAVE', 'WAVE-TX-0001', null, 'TRANSPORTEUR'));
  await doitRefuser(r, 'la même référence Wave ne peut pas servir deux fois',
    () => paie('P6', 200, 'WAVE', 'WAVE-TX-0001', null, 'TRANSPORTEUR'), 'duplicate key');
  await doitRefuser(r, 'un paiement daté dans le futur est refusé',
    () => db.query(`insert into public.n1_paiements(local_id,cle_idempotence,rt_id,beneficiaire,
                      montant,mode_paiement,date_paiement,created_by)
                    values ('P7','P7',$1,'X',100,'ESPECES',current_date+1,public.n1_uid())`, [RT_TEST]),
    'futur');
  await doitRefuser(r, 'le rejeu d\'une clé d\'idempotence est refusé',
    () => paie('P5', 100, 'WAVE', 'WAVE-TX-0002', null, 'TRANSPORTEUR'), 'duplicate key');

  // --- Commissions ---------------------------------------------------------
  await connecter(db, COMPTES.superviseur);
  const com = (await db.query(`select public.n1_calculer_commissions($1) v`, [cycle.id])).rows[0].v;
  doitEgaler(r, 'la base de commission vient des achats, pas d\'une saisie', Number(com.base_kg), 1000);
  doitEgaler(r, 'le montant dû est calculé par le serveur', Number(com.montant_du), 10000);
  doitEgaler(r, 'rien n\'est payé tant que rien n\'est versé', Number(com.montant_paye), 0);

  await doitRefuser(r, 'payer plus que le dû est refusé par contrainte',
    () => db.query(`update public.n1_commissions set montant_paye = 99999 where id=$1`, [com.id]),
    'surpaiement');
  await doitAccepter(r, 'un règlement partiel de commission est accepté',
    () => db.query(`update public.n1_commissions set montant_paye = 6000 where id=$1`, [com.id]));

  // Recalcul : idempotent, ne crée pas une seconde ligne pour le même cycle.
  await db.query(`select public.n1_calculer_commissions($1)`, [cycle.id]);
  doitEgaler(r, 'recalculer ne duplique pas la commission du cycle',
    (await db.query(`select count(*)::int c from public.n1_commissions where cycle_uid=$1`, [cycle.id])).rows[0].c, 1);

  await connecter(db, COMPTES.agent);
  await doitRefuser(r, 'un agent ne calcule pas les commissions',
    () => db.query(`select public.n1_calculer_commissions($1)`, [cycle.id]), 'insuffisant');

  // --- Dimensions financières de réconciliation ----------------------------
  await connecter(db, COMPTES.bm);
  const exec = (await db.query(`select gen_random_uuid() u`)).rows[0].u;
  const n = (await db.query(`select public.n1_recon_dimensions_financieres($1,$2) v`, [cycle.id, exec])).rows[0].v;
  doitEgaler(r, 'deux dimensions financières supplémentaires sont produites', Number(n), 2);

  const lignes = (await db.query(
    `select dimension, valeur_attendue, valeur_constatee, statut, criticite
     from public.n1_reconciliation_lignes where execution_uid=$1 order by dimension`, [exec])).rows;
  const comLigne = lignes.find((l) => l.dimension === 'COMMISSIONS');
  doitEgaler(r, 'la dimension COMMISSIONS oppose le dû au payé',
    [Number(comLigne?.valeur_attendue), Number(comLigne?.valeur_constatee)], [10000, 6000]);
  doitEgaler(r, 'un reste dû en cours de cycle n\'est pas un écart bloquant',
    comLigne?.statut, 'ECART_TOLERE');

  const paieLigne = lignes.find((l) => l.dimension === 'ACHATS_PAIEMENTS');
  doitEgaler(r, 'la dimension ACHATS_PAIEMENTS oppose achats et décaissements',
    [Number(paieLigne?.valeur_attendue), Number(paieLigne?.valeur_constatee)], [500000, 500000]);
  doitEgaler(r, 'des paiements égaux aux achats sont conformes', paieLigne?.statut, 'CONFORME');

  // --- Détecteurs complémentaires ------------------------------------------
  // Un surpaiement de commission ne peut pas être créé par l'application : on
  // passe propriétaire pour fabriquer l'anomalie que le détecteur doit voir.
  await db.exec('reset role');
  await db.query(`alter table public.n1_commissions drop constraint n1_comm_pas_de_surpaiement`);
  await db.query(`update public.n1_commissions set montant_paye = 15000 where cycle_uid=$1`, [cycle.id]);
  await connecter(db, COMPTES.bm);
  const det = (await db.query(`select public.n1_detecter_anomalies_complement() v`)).rows[0].v;
  doitEtreVrai(r, 'le détecteur complémentaire signale le surpaiement',
    Number(det.detections_complementaires) >= 1, JSON.stringify(det));
  doitEgaler(r, 'le surpaiement de commission est classé P0',
    (await db.query(`select criticite from public.n1_anomalies
                     where type_anomalie='DEPASSEMENT_PLAFOND'`)).rows[0]?.criticite, 'P0');

  const det2 = (await db.query(`select public.n1_detecter_anomalies_complement() v`)).rows[0].v;
  doitEgaler(r, 'relancer le détecteur complémentaire ne duplique rien',
    (await db.query(`select count(*)::int c from public.n1_anomalies
                     where type_anomalie='DEPASSEMENT_PLAFOND'`)).rows[0].c, 1);

  // --- Verrou de clôture sur les nouvelles entités -------------------------
  await connecter(db, COMPTES.superviseur);
  const pid = (await db.query(`select id from public.n1_paiements where local_id='P1'`)).rows[0].id;
  await doitAccepter(r, 'un tiers valide le paiement',
    () => db.query(`update public.n1_paiements set n1_statut='VALIDE' where id=$1`, [pid]));
  await connecter(db, COMPTES.bm);
  await db.query(`update public.n1_paiements set n1_statut='RECONCILIE' where id=$1`, [pid]);
  await db.query(`update public.n1_paiements set n1_statut='CLOTURE' where id=$1`, [pid]);
  await doitRefuser(r, 'un paiement clôturé n\'est plus modifiable',
    () => db.query(`update public.n1_paiements set montant=1 where id=$1`, [pid]), 'interdite');
  await doitRefuser(r, 'un paiement clôturé n\'est pas supprimable',
    () => db.query(`delete from public.n1_paiements where id=$1`, [pid]), 'permission denied');

  const audit = (await db.query(
    `select count(*)::int c from public.n1_audit where ressource in ('n1_paiements','n1_commissions')`)).rows[0].c;
  doitEtreVrai(r, 'paiements et commissions sont journalisés', audit >= 3, `${audit} événement(s)`);

  await db.close?.();
  return r;
}
