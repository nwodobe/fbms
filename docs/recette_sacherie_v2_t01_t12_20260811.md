# Recette contrôlée Sacherie V2 MVP - T01 à T12

Date : 11/08/2026  
Programme : AFLP 2027  
Référence : AFLP-SOP-006 / MVP Sacherie V2  
Statut : **RECETTE P0 EXÉCUTÉE - GO TECHNIQUE CONDITIONNEL / NO-GO PRODUCTION**

> Les tests ci-dessous ont été exécutés sur la branche Supabase `sacherie-v2-test-20260811` avec des données fictives uniquement. La création automatique de la branche a échoué au replay de migrations historiques (`MIGRATIONS_FAILED`). Un harness Farmer Buying minimal et isolé a donc été créé pour valider les RPC, triggers, contraintes et règles métier V2. Ces résultats valident la logique P0, mais ne remplacent pas une répétition sur un clone fidèle du schéma Production.

## 1. Règle de calcul de référence

Pour un RT avec stock RCN vérifié = 0 kg, volume financé restant = 2 000 kg, aucun sac détenu et aucune réservation :

`floor((0 + 2 000) x 1,10 / 80) = 27 sacs`

28 sacs doivent être refusés.

## 2. Résultats T01-T12

| Test | Scénario | Résultat exécuté | Statut |
|---|---|---|---|
| **T01** | Demande conforme | Demande créée `PENDING_BM`, plafond serveur 27 | **PASS** |
| **T02** | Dépassement plafond | Demande supérieure au plafond refusée côté serveur | **PASS** |
| **T03** | Remise sans approval | Exécution avant approval BM refusée | **PASS** |
| **T04** | Remise partielle | 19 approuvés, 15 exécutés, `PARTIALLY_EXECUTED`, Bag Movement ID créé | **PASS** |
| **T05** | Réutilisation approval | Deuxième exécution du même request refusée | **PASS** |
| **T06** | FULL sans Lot ID | Contrainte serveur bloque le mouvement | **PASS** |
| **T07** | Marge non cumulée | 2 000 kg financés, 400 kg achetés, 400 kg stock vérifié, 10 sacs détenus : plafond 27, nouvelle remise max 17 | **PASS** |
| **T08** | Stock cluster insuffisant | Approval 10 avec stock cluster 5 : exécution refusée `Stock sacs cluster insuffisant` | **PASS** |
| **T09** | Idempotence brouillon | Deux envois avec le même `client_request_id` retournent le même ID ; une seule ligne serveur | **PASS** |
| **T10** | Écart inventaire | Réconciliation journalière non incluse dans le lot P0 | **P1 / NOT IMPLEMENTED** |
| **T11** | Auto-approval UH | Appel direct de l'approval par UH refusé | **PASS** |
| **T12** | Historique V1 conservé | Mouvement V1 conservé, colonnes V2 nulles, aucun écrasement | **PASS** |

## 3. Tests de sécurité S01-S08

| Test | Contrôle | Résultat exécuté | Statut |
|---|---|---|---|
| **S01** | UH hors cluster | Refus `RT hors du cluster attribué à l utilisateur` | **PASS** |
| **S02** | Warehouse Keeper mauvais cluster | Exécution refusée | **PASS** |
| **S03** | Unit Head exécute la remise | Exécution refusée ; rôle magasinier/Assistant UH requis | **PASS** |
| **S04** | Deux approvals dépassent ensemble le plafond | 1er approval 20 accepté, 2e approval 20 refusé après prise en compte de la réservation | **PASS** |
| **S05** | Spoof RT / cluster | Trigger refuse le RT différent de celui approuvé | **PASS** |
| **S06** | DOTATION_RT directe | Insert direct sans request valide bloqué côté serveur | **PASS** |
| **S07** | Un seul cycle OPEN par RT | 2e cycle refusé ; après clôture du 1er, nouveau cycle accepté | **PASS** |
| **S08** | Responsabilité après sous-affectation producteur | 20 remis au RT, mouvements RT↔PRODUCTEUR : responsabilité calculée reste 20 | **PASS** |

## 4. Migration, sécurité et rollback

### Migration V2

La migration additive `sacherie_v2_mvp_20260811.sql` a été appliquée avec succès sur le harness de test.

### Supabase Security Advisor

Le premier scan a détecté :

- exposition anonyme de fonctions `SECURITY DEFINER` ;
- `search_path` non fixé sur `sacherie_code_cluster`.

Un correctif dédié a été ajouté :

`docs/migrations/sacherie_v2_security_hardening_20260811.sql`

Le premier hardening a été appliqué et une requête de contrôle a confirmé `anon_exec = false` sur les fonctions Sacherie. Une seconde révision du fichier réduit également l'exécution directe des helpers internes par `authenticated`. Cette dernière révision doit être rejouée lors de la prochaine recette fidèle après le rollback de test.

### Compatibilité avec le vrai référentiel RT

Une lecture seule de Production a montré que 116 RT actifs ont `rt.cluster` renseigné, mais seulement 93 ont également `data->>'cluster'`. **23 RT auraient donc été rejetés à tort par la première version qui lisait uniquement le JSON.**

Correctif ajouté :

`docs/migrations/sacherie_v2_rt_normalized_compat_20260811.sql`

La V2 lit désormais `rt.cluster` / `rt.nom` en priorité et le JSON uniquement en fallback. Ce correctif est obligatoire avant Production.

### Rollback

Le premier rollback a révélé une dépendance de policy RLS sur `sacherie_peut_lire_demande`. Le script a été corrigé pour retirer les policies V2 avant les helpers.

Le rollback corrigé a ensuite été réellement exécuté avec succès :

- RPC d'exécution supprimé : PASS ;
- RPC d'approval supprimé : PASS ;
- données `bag_movement_requests` conservées : PASS ;
- mouvement historique V1 conservé : PASS ;
- policy d'insertion V1 restaurée : PASS.

Le rollback est donc **TESTÉ PASS**.

## 5. Recette interface / CI GitHub

`Agent Quality Gates` run #30 a terminé en **SUCCESS**.

Le job Playwright a parcouru **18 pages x 3 viewports = 54 observations** :

- 390 x 844 ;
- 768 x 1024 ;
- 1440 x 900.

Résultat : **0 nouveau problème** détecté. Le workflow signale 20 problèmes hérités et 90 violations d'accessibilité déjà présentes dans le périmètre testé ; aucune nouvelle régression n'est attribuée à la Sacherie V2.

## 6. Verdict

### GO technique P0

La logique critique du MVP est validée :

- approval BM obligatoire ;
- plafond 80 kg / +10 % contrôlé côté serveur ;
- réservations empêchant le cumul d'approvals ;
- séparation demande / approval / exécution ;
- remise partielle non réutilisable ;
- stock cluster protégé ;
- périmètre cluster protégé ;
- idempotence ;
- historique V1 préservé ;
- rollback fonctionnel.

### NO-GO Production / pilote réel à ce stade

Il reste obligatoire de fermer les points suivants :

1. rejouer migration + hardening + compatibilité RT sur un environnement fidèle à Production, car le preview automatique a échoué sur l'historique des migrations ;
2. appliquer et revalider le dernier hardening des droits helpers ;
3. valider la durée métier de l'approval BM (24 h est encore une hypothèse MVP) ;
4. implémenter T10 si la réconciliation journalière fait partie du périmètre de mise en service ;
5. mettre les preuves photo sur Storage avant tout pilote utilisant REBUT/perte/anomalie ;
6. décider l'intégration avec l'infrastructure existante `rcn_jute_*` afin d'éviter deux registres Sacherie concurrents.

Aucune migration n'a été appliquée sur Production et aucune fusion GitHub n'a été effectuée.
