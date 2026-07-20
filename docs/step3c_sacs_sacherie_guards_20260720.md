# Étape 3C — Sacs / Sacherie terrain

Date : 20/07/2026
Branche : `step3c-sacs-sacherie-guards`

## Objectif

Sécuriser le module Sacs / Sacherie terrain du programme Farmer Buying sans modifier les données existantes.

Objectif métier :

- empêcher les mouvements de sacs incohérents ;
- bloquer les stocks négatifs ;
- rattacher les mouvements terrain aux RT, villages et producteurs ;
- protéger la file locale de synchronisation ;
- maintenir RCN Trace en dernière position du chantier.

## Fichiers inspectés

- `terrain/sacs.html`
- `shared/auth-gate.js`
- `shared/anagroci-audit.js`

Constat sur `terrain/sacs.html` :

- le module possède déjà `auth-gate.js` avec `data-module="sacs"` ;
- le module utilise la clé locale `anagroci_sacs` ;
- les documents de transaction sont conservés localement via `anagroci_sacs_docs` ;
- la synchronisation envoie les mouvements vers `sacs_mouvements` ;
- le module calcule déjà les soldes RT / producteurs / clusters ;
- les contrôles de base existaient, mais le blocage stock négatif n'était pas systématiquement externalisé et sécurisé comme garde métier.

## Changements réalisés

### 1. Nouveau garde métier dédié

Fichier ajouté :

- `shared/anagroci-sacs-guards.js`

Ce fichier est volontairement séparé de `terrain/sacs.html` afin de ne pas réécrire le module fonctionnel existant.

### 2. Chargement automatique par le portail sécurisé

Fichier modifié :

- `shared/auth-gate.js`

Ajout d'un chargement conditionnel :

```js
if (MODULE === "sacs") {
  shared/anagroci-sacs-guards.js?v=step3c
}
```

Le garde ne se charge que sur le module `sacs`.

## Contrôles ajoutés

### Contrôles généraux

- date future interdite ;
- quantité obligatoire ;
- quantité entière positive ;
- cluster obligatoire pour réception `USINE → CLUSTER` ;
- RT obligatoire pour tout mouvement terrain hors réception usine ;
- producteur obligatoire pour les mouvements producteur ;
- village hors cluster bloqué quand le référentiel est chargé ;
- RT hors village / cluster bloqué quand le référentiel est chargé ;
- producteur hors village ou non autorisé bloqué quand le référentiel est chargé.

### Blocage des stocks négatifs

Le garde calcule les soldes à partir de :

- `anagroci_sacs` local ;
- `anagroci_ref_sacs.server` ;
- mouvements serveur déjà chargés ;
- mouvements locaux non encore synchronisés.

Blocages :

- sortie d'un cluster si stock cluster insuffisant ;
- sortie d'un RT si stock RT insuffisant ;
- sortie d'un producteur si stock producteur insuffisant.

Messages opérationnels :

- `Stock sacs cluster insuffisant` ;
- `Stock sacs RT insuffisant` ;
- `Stock sacs producteur insuffisant`.

## Protection de la file locale

La file locale `anagroci_sacs` est normalisée avec :

- `pending` ;
- `syncing` ;
- `synced` ;
- `failed` ;
- `device_id` ;
- `sync_attempts` ;
- `last_attempt_at` ;
- `last_error` ;
- `recovered_at`.

Avant synchronisation Supabase, les métadonnées locales sont retirées temporairement afin de ne pas envoyer de colonnes inconnues à `sacs_mouvements`.

Après synchronisation, la file locale est fusionnée avec le résultat afin de préserver les opérations non synchronisées.

## Audit ajouté

Événements audit :

- `sacs_sacherie_guards_installed` ;
- `bag_movement_blocked_by_guard`.

Ces événements sont envoyés à `audit_log` si `ANAGROCI_AUDIT` est disponible.

## Ce qui n'a pas été fait

Aucune migration Supabase.

Aucune modification de données.

Aucun changement direct dans :

- `terrain/sacs.html` ;
- `terrain/achats.html` ;
- `terrain/cash.html` ;
- `terrain/command.html` ;
- `rcntrace/index.html`.

Aucun changement de structure des tables.

Aucune suppression.

## Note technique

Le premier commit de création de `shared/anagroci-sacs-guards.js` a été incomplet. Il a été réparé immédiatement par un commit suivant avec le fichier complet.

L'état final de la branche contient :

- un fichier `anagroci-sacs-guards.js` complet ;
- un chargement conditionnel propre dans `auth-gate.js` ;
- aucun changement direct du module `terrain/sacs.html`.

## Limites volontaires

Cette étape sécurise le frontend et la file locale.

Restent pour plus tard :

- validation BM des pertes exceptionnelles ;
- workflow de justification distante des documents ;
- liaison stricte achat ↔ sacs pleins ↔ enlèvement ;
- stockage distant des scans / photos ;
- rapport consolidé de pertes sacs.

## Prochaine étape recommandée

Étape 3D — Command Center BM.

Objectif : consolider les alertes Achats / Cash / Sacs pour donner au Branch Manager une vue de contrôle quotidienne.
