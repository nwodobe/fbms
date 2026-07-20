# Étape 2C-E — Design premium Achats / Cash / Sacs / Command

## Objectif

Harmoniser visuellement les modules opérationnels de terrain sans toucher à la logique métier, aux données, à Supabase, à IndexedDB ou aux fonctions existantes.

Modules concernés :

- `terrain/achats.html`
- `terrain/cash.html`
- `terrain/sacs.html`
- `terrain/command.html`

## Correction réalisée

Ajout d'une couche CSS dédiée :

- `shared/ops-premium.css`

Cette couche est importée dans :

- `shared/pjs-theme.css`

## Scope volontaire

La couche est limitée aux pages qui chargent `auth-gate.js` avec l'un des modules suivants :

- `data-module="achats"`
- `data-module="cash"`
- `data-module="sacs"`
- `data-module="command"`

Le ciblage utilisé évite d'appliquer ces styles aux autres modules :

- Audit distances
- ALIS
- Hubs / Carte
- FBMS cœur
- RCN Trace
- Portail

## Améliorations visuelles

La couche premium améliore :

- header opérationnel ;
- boutons ;
- KPI cards ;
- cards métier ;
- champs de formulaire ;
- alertes ;
- badges et statuts ;
- tableaux ;
- listes d'anomalies ;
- responsive mobile.

## Garanties métier

Aucun changement sur :

- les fonctions JavaScript métier ;
- la synchronisation ;
- les files d'attente hors-ligne ;
- IndexedDB ;
- Supabase ;
- les tables ;
- les politiques RLS ;
- les calculs ;
- les exports ;
- les workflows de validation.

## Fichiers modifiés

- `shared/ops-premium.css` ajouté.
- `shared/pjs-theme.css` modifié pour importer la nouvelle couche.

## Fichiers non modifiés volontairement

- `terrain/achats.html`
- `terrain/cash.html`
- `terrain/sacs.html`
- `terrain/command.html`

La correction passe par le thème partagé afin de réduire le risque de casser des fichiers applicatifs qui contiennent déjà leur logique métier.

## Limite volontaire

Cette étape reste une harmonisation visuelle. Les corrections fonctionnelles métier restent à traiter plus tard, notamment :

- achats : contrôle avance RT, verrouillage cluster, justificatifs, prix grille ;
- cash : pièces justificatives, signature, seuils, réconciliation renforcée ;
- sacs : verrou de stock négatif, validation retour, preuve photo distante ;
- command center : drill-down, workflow décision, priorités Branch Manager.

## Conclusion

L'étape 2C-E peut être fusionnée si la PR reste propre : elle améliore l'expérience visuelle des modules opérationnels sans toucher aux mécanismes sensibles.
