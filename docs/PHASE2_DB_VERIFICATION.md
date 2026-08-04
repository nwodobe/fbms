# Savoir+ — Vérification réelle de la base Neon

**Date :** 2026-08-04  
**Projet Neon :** `savoir-plus`  
**Project ID :** `autumn-heart-85786511`  
**Branche vérifiée :** `preview/initial-schema`  
**Branch ID :** `br-super-sun-a6lrxz4f`

## 1. Objectif

Vérifier que la migration initiale Drizzle de Savoir+ est réellement applicable sur Neon et que les garanties structurelles annoncées par le schéma sont effectivement imposées par PostgreSQL.

Cette vérification a été réalisée sur une branche de prévisualisation isolée. La branche Neon `main` n’a pas été modifiée.

## 2. Limitation d’infrastructure rencontrée

L’environnement d’exécution utilisé pendant la session bloquait les connexions directes vers `*.neon.tech` ainsi que le transport WebSocket. La migration n’a donc pas pu être exécutée par le script local `npm run db:migrate` depuis ce bac à sable.

La migration a été appliquée par le connecteur Neon sur une branche de prévisualisation. Cette limitation ne remet pas en cause le SQL produit, mais elle signifie que le script local de migration doit encore être exécuté dans un environnement autorisant une connexion directe à Neon avant une mise en production.

## 3. Résultat structurel observé

La branche `preview/initial-schema` contient :

| Élément | Résultat observé |
|---|---:|
| Tables publiques | 37 |
| Types énumérés | 22 |
| Clés étrangères | 54 |
| Contraintes CHECK | 32 |
| Index publics | 96 |
| Index partiels | 5 |
| Entrées du journal Drizzle | 1 |

Les 96 index incluent les index explicites ainsi que ceux créés automatiquement par PostgreSQL pour les clés primaires et contraintes d’unicité.

## 4. Garanties métier vérifiées

Les contrôles suivants ont été exécutés directement contre PostgreSQL sur la branche de prévisualisation.

### IT-01 — Rejeu hors ligne

La contrainte d’unicité sur les tentatives refuse la réinsertion d’une même tentative logique. Le mécanisme anti-doublon est donc porté par la base et ne dépend pas uniquement du code applicatif.

### Maîtrise d’une compétence

La base refuse qu’une compétence soit déclarée `mastered` lorsqu’elle possède moins de deux mesures. La règle `mastery_requires_two_measures_ck` est effective.

### Seuil d’erreur récurrente

Le statut récurrent exige le seuil structurel défini par `error_logs_recurrent_threshold_ck`.

### Unicité d’e-mail insensible à la casse

Deux utilisateurs ne peuvent pas contourner l’unicité en modifiant uniquement la casse de leur adresse électronique.

### Plan de révision actif unique

L’index partiel `revision_plans_one_active_uq` empêche la création de deux plans actifs équivalents, y compris lorsque `error_log_id` est nul.

Le contrôle complémentaire confirme qu’un plan terminé ne bloque pas la création d’un nouveau plan. L’index n’est donc pas excessivement restrictif.

### Publication d’un exercice

Un exercice publié ne peut pas être associé à moins de deux indices. La contrainte de qualité de contenu est imposée par la base.

## 5. Données de test résiduelles

La branche de prévisualisation contient quelques enregistrements créés pour les tests de contraintes, notamment dans :

- `users` ;
- `subjects` ;
- `chapters` ;
- `skills` ;
- `exercises` ;
- `exercise_versions` ;
- `exercise_attempts` ;
- `revision_plans`.

Ces données ne doivent pas être promues vers la branche principale. Elles sont acceptables sur la branche de validation, mais devront être supprimées ou la branche devra être recréée avant toute utilisation comme environnement de démonstration.

## 6. État de la branche principale

Au moment de cette vérification, la branche Neon `main` ne contient aucune table applicative Savoir+. Elle reste volontairement vierge jusqu’à validation du code et de la Pull Request GitHub correspondante.

## 7. Écart entre preuve et dépôt

La migration SQL est appliquée et vérifiée sur Neon preview. En revanche :

- le script de migration du dépôt n’a pas été exécuté depuis cet environnement en raison du blocage réseau ;
- aucune migration n’a encore été appliquée à Neon `main` ;
- aucun contenu pédagogique de référence n’a été chargé ;
- aucune authentification Auth.js n’est encore opérationnelle.

## 8. Verdict

**Phase 2, couche base de données : validée sur branche de prévisualisation.**

La promotion vers Neon `main` reste conditionnée à :

1. la validation de la Pull Request GitHub ;
2. une CI verte ;
3. l’exécution de la migration depuis un environnement autorisé ou par un canal Neon contrôlé ;
4. une vérification post-migration sur `main` ;
5. l’absence de données de test.

## 9. Prochaine étape

Démarrer le Lot 2 uniquement après fusion de la Phase 2 : Auth.js avec sessions en base, gardes serveur, test générique interdisant les actions non protégées et 18 tests d’autorisation bloquants.
