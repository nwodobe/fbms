# Guide de migration — Niveau 1

Date : 14 août 2026

## 0. Avertissement

Ces migrations **n'ont jamais été appliquées à la production**, ni à aucun projet
Supabase. Elles ont été exécutées et vérifiées sur PostgreSQL 18.3 local
(PGlite), sur une base reproduisant la DDL du dépôt.

Elles se trouvent dans `docs/migrations/niveau1/` et non dans `supabase/`, parce
que `CLAUDE.md:74-87` interdit à un agent de modifier `supabase/**`. C'est le même
emplacement que la Sacherie V2, pour la même raison.

## 1. Ordre imposé

Aucun jalon n'est sautable.

| # | Jalon | Script | Validation avant l'étape suivante |
|---|---|---|---|
| 1 | Sauvegarde de production vérifiée | — | Restauration testée sur un projet neuf |
| 2 | Projet de recette restauré depuis cette sauvegarde | — | Le projet répond |
| 3 | **Pré-contrôle** | `PRECHECK_doublons_et_blocages.sql` | Sortie lue, comptages archivés |
| 4 | Décision de régularisation | — | Écrite, signée |
| 5 | Migrations 01 à 09 sur la **recette** | `20260814_0*.sql` | Aucune erreur |
| 6 | Vérification | `VERIFY_niveau1.sql` | Aucun verdict « BLOQUANT » |
| 7 | Paramétrage | voir §4 | `campagne_active` et 3 plafonds définis |
| 8 | Banc d'essai rejoué sur la recette | scénarios T01-T09 adaptés | 140/140 |
| 9 | Test de concurrence réelle | §6 | Aucun solde négatif |
| 10 | Adaptation du frontend | — | Cash et Achats fonctionnels |
| 11 | Recette terrain | `12_PLAN_RECETTE_TERRAIN.md` | Validée par le BM |
| 12 | Production, en fenêtre de faible activité | — | `VERIFY` rejoué |

## 2. Ce que change chaque migration

| Fichier | Contenu | Réversible |
|---|---|---|
| `20260814_01_socle_parametres_audit.sql` | Schéma `n1`, contexte, paramètres, journal d'audit | ✅ |
| `20260814_02_identifiants_idempotence.sql` | Clés d'idempotence, unicité du reçu, codes métier | ✅ |
| `20260814_03_cycles_invariants_metier.sql` | Cycles, machine d'état, exceptions, gardes, **RLS modifiée** | ✅ |
| `20260814_04_stock_sacs_non_negatifs.sql` | Soldes, stock RCN, lots, évacuations, réceptions | ✅ |
| `20260814_05_cloture_ajustements.sql` | Verrou de clôture, ajustements | ✅ |
| `20260814_06_reconciliation.sql` | Moteur de réconciliation, déblocage, vue cycles | ✅ |
| `20260814_07_anomalies.sql` | Moteur d'alertes | ✅ |
| `20260814_08_synchronisation.sql` | File serveur, accusés, conflits | ✅ |
| `20260814_09_papier_secours.sql` | Registre papier | ✅ |

Toutes sont **additives** : aucun `DROP TABLE`, aucun `DROP COLUMN`, aucun
`DELETE`. Aucune ne supprime de donnée.

## 3. Points de vigilance

### 3.1 Réécriture de table

La migration 02 ajoute à `public.achats` une colonne **générée**
`numero_recu_norme` (`GENERATED ALWAYS … STORED`). PostgreSQL **réécrit la
table** et prend un verrou `ACCESS EXCLUSIVE` pendant l'opération.

Sur une table volumineuse, cela peut durer. Mesurer d'abord avec la section
« VOLUMÉTRIE » du pré-contrôle, et prévoir une fenêtre.

### 3.2 Rupture fonctionnelle attendue — la plus importante

Après la **migration 03**, une insertion directe dans `public.avances` **échoue**
s'il n'existe pas de cycle ouvert pour le RT.

C'est exactement le correctif P0-2, et c'est voulu. Mais le frontend actuel fait
précisément cette insertion directe. **Le module Cash cessera de fonctionner**
tant qu'il n'appellera pas `n1_ouvrir_cycle()` puis n'insérera l'avance rattachée.

Trois conséquences opérationnelles à anticiper :

1. les migrations 03 et suivantes ne doivent pas partir en production sans
   l'adaptation du frontend correspondante ;
2. les messages d'erreur PostgreSQL remonteront bruts à l'utilisateur tant que
   l'interface ne les traduira pas ;
3. les achats échoueront aussi si `campagne_active` n'est pas défini (§4).

### 3.3 Rattachement de l'historique

Les achats et avances existants auront `cycle_uid` à NULL. Ils restent lisibles
et ne bloquent rien, mais ils **n'entrent pas dans la réconciliation** d'un cycle.

Deux options, à trancher par le programme :

- **Ne rien rattacher** : les cycles ne concernent que les opérations à venir.
  Simple, mais l'historique reste hors réconciliation.
- **Rattacher rétroactivement** : créer un cycle par (RT, campagne) et y
  rattacher l'historique. Plus fidèle, mais c'est une écriture de masse sur des
  données financières — elle exige une décision écrite et une sauvegarde.

Aucun script de rattachement n'est fourni : il modifierait des écritures
financières existantes, ce que cette intervention s'interdit.

## 4. Paramétrage obligatoire après migration

Tant que ces valeurs ne sont pas saisies, **les opérations correspondantes sont
refusées**. C'est la règle « absence = blocage », et elle est délibérée.

```sql
select public.n1_definir_parametre('campagne_active', null, 'AFLP2027', null,
       'Ouverture de la campagne 2027', 'GLOBAL');
select public.n1_definir_parametre('plafond_cycle_montant_max',  <à décider>, null, null,
       'Décision BM du <date>', 'GLOBAL');
select public.n1_definir_parametre('plafond_avance_montant_max', <à décider>, null, null,
       'Décision BM du <date>', 'GLOBAL');
select public.n1_definir_parametre('plafond_achat_montant_max',  <à décider>, null, null,
       'Décision BM du <date>', 'GLOBAL');
select public.n1_definir_parametre('cycle_duree_jours', 21, null, null,
       'Durée standard d''un cycle', 'GLOBAL');
```

Les tolérances non définies valent **zéro** — c'est-à-dire le plus strict.
Les définir *assouplit* ; les oublier ne crée aucun trou.

## 5. Validation différée des contraintes

Après régularisation de l'historique, et seulement alors :

```sql
alter table public.achats validate constraint achats_local_id_requis_chk;
alter table public.achats validate constraint achats_cle_idem_requise_chk;
-- idem pour avances, reconciliations, sacs_mouvements
```

Tant qu'elles ne sont pas validées, ces contraintes protègent déjà **toute ligne
nouvelle**. La validation ne sert qu'à certifier l'historique.

## 6. Test de concurrence à faire sur la recette

Non réalisable sur PGlite (mono-connexion). Sur le projet de recette, deux
sessions `psql` simultanées :

```sql
-- Session A                          -- Session B
begin;                                begin;
-- décrémenter le solde de 60         -- décrémenter le même solde de 60
--   (solde disponible : 100)
insert into sacs_mouvements …;        insert into sacs_mouvements …;
commit;                               -- doit ÉCHOUER sur n1_soldes_non_negatif_chk
```

Attendu : la seconde transaction échoue. Même exercice sur `n1_ouvrir_cycle()`
pour le même RT : une seule ouverture doit passer.

## 7. Retour arrière

`ROLLBACK_niveau1.sql`. Voir `11_RETOUR_ARRIERE.md` : le retour arrière fait
retomber les neuf verrous P0 et n'est jamais une position d'attente.
