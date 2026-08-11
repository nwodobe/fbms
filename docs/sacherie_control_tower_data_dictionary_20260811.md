# Dictionnaire de données — Sacherie Control Tower

## Localisation

- `scope_type` : CLUSTER, RT, PRODUCTEUR, HUB, FACTORY, TRANSIT, REPARATION, REBUT.
- `cluster` : cluster AFLP de rattachement.
- `rt_id` : identifiant RT lorsque la localisation représente une responsabilité RT.
- `producteur_id` : identifiant producteur lorsque le sac est physiquement chez un producteur.

## État canonique

- `UTILISABLE` : sac vide disponible.
- `PLEIN` : sac rempli de RCN.
- `EN_TRANSIT` : expédié, réception non encore confirmée.
- `DECHIRE` : endommagé et à évaluer.
- `A_REPARER` : orienté vers réparation.
- `REPARE` : revenu de réparation, avant reclassement utilisable.
- `REFORME` : REBUT, encore physiquement comptable.
- `HUMIDE` : sac humide.
- `A_CLASSER` : état temporaire nécessitant contrôle.

## Réconciliation

- `theoretical_qty` : quantité issue du ledger.
- `counted_qty` : comptage physique.
- `difference_qty` : physique - théorique.
- `reconciliation_status` : PASS si écart nul, HOLD si écart non nul.

## Perte

Une déclaration `SOUMIS` ne modifie pas le patrimoine. Une perte `APPROUVE` par le BM crée un mouvement canonique de sortie. Une perte `REFUSE` ne modifie aucun stock.
