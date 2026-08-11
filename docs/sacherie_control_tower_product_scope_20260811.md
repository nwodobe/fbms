# Périmètre produit — Sacherie Control Tower AFLP 2027

## Question de management à résoudre

En moins de 30 secondes, le Branch Manager doit pouvoir savoir :

- combien de sacs sont sous contrôle ANAGROCI ;
- où ils se trouvent ;
- sous la responsabilité de qui ;
- dans quel état ils sont ;
- quels mouvements expliquent les chiffres ;
- où existent des écarts ou anomalies ;
- quelles actions requièrent une décision.

## Niveaux de lecture

### Global

Total, utilisables, pleins, transit, déchirés, réparation, réparés, REBUT, alertes.

### Cluster

Stock physique au cluster, stock chez les RT, stock chez producteurs, stock plein au hub, déchirés, réparation, REBUT, dernier inventaire, écart.

### RT

Total sous responsabilité, vides, pleins, déchirés, réparation, REBUT, dernière activité et historique détaillé.

## Contrôle métier

Le SOP-006 reste la règle d'autorisation des dotations Cluster → RT. Le Control Tower ne contourne pas ce workflow et ne transforme pas un brouillon offline en mouvement de stock validé.

## Règle de vérité

Tous les KPI sont calculés à partir du ledger transactionnel canonique. Aucun stock de management n'est saisi manuellement.

Un stock physique n'est affiché que lorsqu'un inventaire physique a été enregistré. En l'absence d'inventaire, la valeur est « inconnue » et non égale artificiellement au stock théorique.
