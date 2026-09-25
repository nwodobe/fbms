// ============================================================================
// Banc d'essai Niveau 1 — migrations, idempotence et retour arrière
// ----------------------------------------------------------------------------
// Vérifie ce qu'on ne découvre habituellement qu'en production : qu'une
// migration rejouée ne casse rien, et que le retour arrière fait ce qu'il
// promet — sans emporter de données.
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrer, connecter, COMPTES, RT_TEST, PROD_TEST,
         Rapport, doitRefuser, doitAccepter, doitEtreVrai, doitEgaler, RACINE } from './socle.mjs';
import { contexteCycle, achatSql } from './scenarios.mjs';

const DOSSIER = join(RACINE, 'docs', 'migrations', 'niveau1');
const fichiers = () => readdirSync(DOSSIER).filter((f) => /^\d{8}_\d{2}_.*\.sql$/.test(f)).sort();

export async function t11_migrations() {
  const r = new Rapport('T11 — Migrations : idempotence et retour arrière');
  const db = await demarrer();

  doitEgaler(r, 'les dix migrations du Niveau 1 sont appliquées', db._migrations.length, 10);

  // --- Idempotence : rejouer chaque migration ne doit rien casser ----------
  // Une migration qu'on ne peut pas rejouer est une migration qu'on ne peut pas
  // reprendre après une interruption.
  for (const f of fichiers()) {
    await doitAccepter(r, `rejeu sans erreur de ${f.replace(/^\d+_\d+_/, '').replace('.sql', '')}`,
      () => db.exec(readFileSync(join(DOSSIER, f), 'utf8')));
  }

  // Le rejeu ne doit pas non plus dupliquer les données de référence.
  doitEgaler(r, 'le rejeu ne duplique pas la machine d\'état',
    (await db.query(`select count(*)::int c from public.n1_transitions`)).rows[0].c,
    (await db.query(`select count(distinct (entite,statut_source,statut_cible))::int c
                     from public.n1_transitions`)).rows[0].c);

  // Et les règles restent actives après rejeu.
  await contexteCycle(db);
  await connecter(db, COMPTES.agent);
  await doitAccepter(r, 'après rejeu, un achat conforme passe toujours',
    () => db.query(achatSql, ['M1', RT_TEST, PROD_TEST, 100, 500, 50000, 'RM1']));
  await doitRefuser(r, 'après rejeu, le reçu dupliqué est toujours refusé',
    () => db.query(achatSql, ['M2', RT_TEST, PROD_TEST, 100, 500, 50000, 'RM1']), 'achats_recu');
  await doitRefuser(r, 'après rejeu, le solde négatif est toujours refusé',
    () => db.query(`insert into public.sacs_mouvements(local_id,cle_idempotence,date,type,source,
                      destination,cluster,rt_id,quantite,created_by)
                    values ('MS1','MS1',current_date,'X','RT','CLUSTER','ALPHA',$1,10,auth.uid())`,
      [RT_TEST]), 'non_negatif');

  await db.close?.();
  return r;
}

export async function t12_retour_arriere() {
  const r = new Rapport('T12 — Retour arrière : ce qui tombe, ce qui reste');
  const db = await demarrer();
  await contexteCycle(db);
  await connecter(db, COMPTES.agent);
  await db.query(achatSql, ['R1', RT_TEST, PROD_TEST, 100, 500, 50000, 'RR1']);
  await db.query(`insert into public.sacs_mouvements(local_id,cle_idempotence,date,type,source,
                    destination,cluster,rt_id,quantite,created_by)
                  values ('RS1','RS1',current_date,'DOT','ANAGROCI','RT','ALPHA',$1,50,auth.uid())`,
    [RT_TEST]);

  // Comptages de référence AVANT le retour arrière.
  // Relevés en PROPRIÉTAIRE, comme le seront ceux d'après : la RLS filtre
  // n1_audit selon l'identité, et comparer deux identités différentes ferait
  // apparaître une « perte » là où il n'y a qu'un périmètre de lecture.
  await db.exec('reset role');
  const avant = {};
  for (const t of ['achats', 'avances', 'sacs_mouvements', 'n1_audit', 'n1_cycles', 'n1_soldes']) {
    avant[t] = (await db.query(`select count(*)::int c from public.${t}`)).rows[0].c;
  }
  doitEtreVrai(r, 'des données existent avant le retour arrière',
    avant.achats > 0 && avant.n1_audit > 0 && avant.n1_cycles > 0, JSON.stringify(avant));

  // --- Exécution du retour arrière -----------------------------------------
  await db.exec('reset role');
  await doitAccepter(r, 'le script de retour arrière s\'exécute sans erreur',
    () => db.exec(readFileSync(join(DOSSIER, 'ROLLBACK_niveau1.sql'), 'utf8')));

  // --- Ce qui doit avoir disparu -------------------------------------------
  doitEgaler(r, 'plus aucun trigger Niveau 1 sur les tables métier',
    (await db.query(`select count(*)::int c from pg_trigger t
                     join pg_class c on c.oid = t.tgrelid
                     where t.tgname like 'trg_n1%' and not t.tgisinternal`)).rows[0].c, 0);
  doitEgaler(r, 'plus aucune fonction n1_*',
    (await db.query(`select count(*)::int c from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname='public' and p.proname like 'n1\\_%'`)).rows[0].c, 0);
  doitEgaler(r, 'l\'index d\'unicité du reçu est retiré',
    (await db.query(`select count(*)::int c from pg_indexes
                     where indexname='achats_recu_campagne_rt_uidx'`)).rows[0].c, 0);

  // --- Ce qui doit avoir survécu — l'essentiel -----------------------------
  for (const t of Object.keys(avant)) {
    doitEgaler(r, `aucune donnée perdue dans ${t}`,
      (await db.query(`select count(*)::int c from public.${t}`)).rows[0].c, avant[t]);
  }
  doitEtreVrai(r, 'le journal d\'audit est intact et reste consultable',
    (await db.query(`select count(*)::int c from public.n1_audit`)).rows[0].c === avant.n1_audit);
  doitEtreVrai(r, 'les colonnes ajoutées ne sont pas supprimées',
    (await db.query(`select count(*)::int c from information_schema.columns
                     where table_schema='public' and table_name='achats'
                       and column_name in ('cle_idempotence','campagne','cycle_uid')`)).rows[0].c === 3);

  // --- La politique RLS d'origine est bien rétablie ------------------------
  const pol = (await db.query(
    `select qual from pg_policies where schemaname='public' and tablename='achats'
       and policyname='achats_upd'`)).rows[0];
  doitEtreVrai(r, 'la politique achats_upd d\'origine est rétablie (est_bm)',
    /est_bm/.test(pol?.qual || ''), pol?.qual);

  // --- Et le verrou est bien retombé : c'est le prix du retour arrière -----
  await connecter(db, COMPTES.agent);
  await doitAccepter(r, 'AVERTISSEMENT vérifié : le reçu dupliqué redevient possible',
    () => db.query(`insert into public.achats(local_id,date,rt_id,producteur_id,poids_net,
                      prix_kg,montant,numero_recu,created_by)
                    values ('RB1',current_date,$1,$2,100,500,50000,'RR1',auth.uid())`,
      [RT_TEST, PROD_TEST]));

  await db.close?.();
  return r;
}
