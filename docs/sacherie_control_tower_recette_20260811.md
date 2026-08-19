# Recette Sacherie Control Tower — 11/08/2026

Statut : en cours, environnement Supabase de test `sacherie-v2-test-20260811`.

## Tests serveur exécutés

| ID | Test | Résultat |
|---|---|---|
| CT-01 | Entrée 500 sacs Usine → Cluster | PASS |
| CT-02 | Dotation 100 Cluster → RT dans historique synthétique | PASS |
| CT-03 | Distribution 40 RT → Producteur | PASS |
| CT-04 | Enlèvement 25 Producteur → Hub avec état PLEIN | PASS |
| CT-05 | 5 sacs déchirés : changement UTILISABLE → DECHIRE sans disparition du patrimoine | PASS |
| CT-06 | Stock global conservé après mouvements internes | PASS : 500 |
| CT-07 | Stock global par état | PASS : 470 utilisables, 25 pleins, 5 déchirés |
| CT-08 | Stock Cluster / réseau | PASS : 400 cluster, 60 RT, 15 producteur, 25 hub |
| CT-09 | Vue RT ne doit pas multiplier les stocks lors de la jointure historique | FAIL initial puis CORRIGÉ |
| CT-10 | Vue RT après correction | PASS : 60 total, 55 utilisables, 5 déchirés |
| CT-11 | Backfill rejoué sans doubler les mouvements | PASS : toujours 5 mouvements canoniques |
| CT-12 | Mouvement FULL sans Lot ID | PASS contrôle : rejeté par `sacs_full_lot_chk` |
| CT-13 | Dotation RT directe sans approval | PASS contrôle : rejetée par `sacherie_guard_mouvement` dans le scénario standard |

## Défaut découvert pendant la recette

La première version de `sacherie_ct_rt_stock` joignait directement le stock et les mouvements. La présence de trois mouvements pour le RT multipliait les lignes de stock et affichait 180 sacs au lieu de 60.

Correction : calculer le stock et la dernière activité dans deux agrégations séparées, puis joindre les résultats. Le test de non-régression donne 60 sacs, dont 55 utilisables et 5 déchirés.

## Tests restant obligatoires avant Production

- retours Producteur → RT et RT → Cluster ;
- workflow DECHIRE → A_REPARER → REPARE / REBUT ;
- perte / incident et décision ;
- inventaire physique, écart, HOLD et ajustement approuvé ;
- permissions par rôle et cluster ;
- snapshot `sacherie_ct_snapshot()` avec session authentifiée ;
- interface 390×844, 768×1024, 1440×900 ;
- historique legacy complet de Production backfillé en environnement contrôlé ;
- correction du chevauchement RLS de `sacs_mouvements` avant mise en service.

Aucun test ci-dessus n'a injecté de donnée réelle de Production. Les données CT-01 à CT-13 sont synthétiques et confinées à la branche Supabase de test.
