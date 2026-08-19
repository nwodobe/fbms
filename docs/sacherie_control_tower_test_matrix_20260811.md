# Matrice de tests — Sacherie Control Tower

## Comptabilité du patrimoine

- Entrée externe augmente le patrimoine.
- Transfert interne conserve le patrimoine.
- Changement d'état conserve le patrimoine.
- REBUT conserve le patrimoine tant qu'il n'est pas détruit / sorti.
- Perte déclarée ne modifie pas le stock.
- Perte approuvée BM diminue le patrimoine.
- Rejeu du backfill ne duplique aucun mouvement.

## Résultats déjà exécutés sur la base de test

- 500 sacs reçus → total 500.
- 100 transférés au RT → total toujours 500.
- 40 distribués à un producteur → total toujours 500.
- 25 enlevés comme sacs pleins vers le hub → total toujours 500.
- 5 classés déchirés → total toujours 500 et déchirés = 5.
- 3 déchirés envoyés en réparation + 2 classés REBUT → total toujours 500, à réparer = 3, REBUT = 2.
- Inventaire Cluster théorique 400 / physique 398 → écart -2, statut HOLD.
- Perte synthétique de 4 sacs : la déclaration seule ne doit pas diminuer le stock ; après approbation BM, total 496 et responsabilité RT 56.

## Non-régression à exécuter avant Production

- profil UH limité à son cluster ;
- Warehouse Keeper limité à son cluster ;
- Assistant UH limité à son cluster ;
- BM accès global ;
- utilisateur sans fonction refusé ;
- classement REBUT refusé hors BM ;
- perte refusée ne touche pas le stock ;
- quantité supérieure au stock refusée ;
- inventaire avec écart sans motif refusé ;
- dotation RT toujours soumise au workflow SOP-006 ;
- affichage mobile, tablette et desktop ;
- lien legacy toujours disponible pendant la transition.
