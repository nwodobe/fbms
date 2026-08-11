# Recette contrôlée Sacherie V2 MVP - T01 à T12

Date : 11/08/2026  
Programme : AFLP 2027  
Référence : AFLP-SOP-006 / MVP Sacherie V2  
Statut : **MVP P0 DÉPLOYÉ EN BASE PRODUCTION - FRONTEND EN COURS DE MISE EN LIGNE**

> Les tests métier ont été exécutés avec des données fictives sur la branche Supabase `sacherie-v2-test-20260811`. Le 11/08/2026, les migrations P0, compatibilité RT, hardening sécurité et nettoyage de compatibilité ont ensuite été appliqués avec succès sur la base Production `FIELD BUYING ANAGROCI`. Aucun jeu de données fictif n'a été injecté en Production.

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

## 4. Vérifications Production après migration

Contrôles exécutés en lecture sur Production :

- table `bag_movement_requests` présente : **PASS** ;
- colonne `bag_movement_code` présente : **PASS** ;
- RPC création / approval / exécution présents : **PASS** ;
- trigger `trg_sacherie_guard_mouvement` présent : **PASS** ;
- historique `sacs_mouvements` conservé : **11 lignes**, identique au contrôle pré-déploiement ;
- demandes V2 initiales : **0** ;
- cycles Sacherie OPEN initiaux : **0** ;
- fonctions Sacherie exécutables par `anon` : **0** ;
- helpers internes principaux non exécutables directement par `authenticated` : **PASS**.

La Production n'a reçu aucune donnée de test et aucun cycle n'a été inventé à partir d'un montant d'avance. Le Branch Manager devra configurer explicitement le volume financé en kg lors de l'ouverture du premier cycle réel.

## 5. Compatibilité RT et transition V1

Le référentiel Production contient 116 RT actifs avec `rt.cluster` renseigné, dont 23 sans ancienne copie JSON du cluster. La V2 lit donc `rt.cluster` / `rt.nom` en priorité et le JSON uniquement en fallback.

Pendant la transition :

- la route portail historique `terrain/sacs.html` bascule vers `terrain/sacherie_v2.html` ;
- l'historique V1 reste accessible explicitement via `terrain/sacs.html?legacy=1` ;
- une ancienne `DOTATION_RT` V1 est bloquée et doit être recréée dans V2 avec approval BM ;
- les autres mouvements V1 restent disponibles pendant la transition.

## 6. Limites P0 assumées

Le déploiement P0 ne prétend pas livrer les fonctions P1 suivantes :

- T10 réconciliation journalière complète ;
- confirmation RT authentifiée ;
- cycle REBUT / réparation complet ;
- preuves Storage pour pertes et anomalies ;
- intégration unifiée avec l'infrastructure `rcn_jute_*`.

La durée de validité d'un approval reste fixée à 24 h dans le MVP et devra être confirmée comme règle métier définitive avant V1.0.
