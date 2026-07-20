# Étape 3A — Sécurisation métier Achats Terrain Farmer Buying

Date : 20/07/2026

## Décision de priorité

RCN Trace est volontairement repoussé en dernière position.

La priorité métier est le programme Farmer Buying. L'étape 3 démarre donc par le module d'entrée opérationnel : Achats Terrain.

## Objectif

Renforcer les contrôles métier de la saisie des achats sans modifier directement le fichier compact `terrain/achats.html` et sans toucher aux données Supabase.

Cette étape vise à réduire les risques critiques suivants :

- achat rattaché à un mauvais cluster ;
- RT hors village ou hors cluster ;
- numéro de reçu dupliqué ;
- paiement bancaire utilisé alors que Farmer Buying doit fonctionner sans banque ;
- date future ;
- perte silencieuse d'achats en attente quand le stockage local atteint le plafond historique ;
- absence de traçabilité locale de la synchronisation.

## Fichier modifié

- `shared/anagroci-audit.js`

## Pourquoi ce fichier ?

`shared/anagroci-audit.js` est injecté par `auth-gate.js` sur les modules protégés.

Le module Achats charge déjà `auth-gate.js` avec :

```html
<script defer src="../shared/auth-gate.js" data-module="achats"></script>
```

La correction peut donc être appliquée sans réécrire `terrain/achats.html`, ce qui évite de casser la saisie, la synchronisation ou le rendu existant.

## Contrôles ajoutés sur Achats Terrain

### 1. Date future interdite

Un achat terrain ne peut pas être saisi avec une date future.

### 2. Village hors cluster bloqué

Quand le référentiel local est chargé, le village saisi doit appartenir à la liste proposée pour le cluster sélectionné.

### 3. RT hors périmètre bloqué

Quand le référentiel local est chargé, le RT saisi doit appartenir à la liste proposée pour le village ou le cluster.

### 4. Numéro de reçu dupliqué bloqué

Un numéro de reçu déjà utilisé sur l'appareil bloque le nouvel enregistrement.

### 5. Paiement bancaire bloqué

Le mode `Virement` est bloqué pour Farmer Buying.

Message affiché :

```text
Paiement bancaire désactivé pour Farmer Buying. Utilisez Mobile Money / Wave.
```

## Protection de la file locale

Le module Achats existant garde historiquement les 300 derniers achats dans `localStorage`.

Cette étape ajoute une protection autour de `save()` :

- sauvegarde les opérations non synchronisées présentes avant l'enregistrement ;
- laisse le module existant enregistrer l'achat ;
- restaure toute opération pending/failed/syncing qui aurait disparu ;
- normalise les statuts locaux.

Objectif : éviter qu'un achat non synchronisé disparaisse silencieusement.

## Statuts de synchronisation locale

Les statuts locaux suivants sont normalisés :

- `pending`
- `syncing`
- `synced`
- `failed`

Des métadonnées locales sont ajoutées :

- `device_id`
- `sync_attempts`
- `last_attempt_at`
- `last_error`
- `recovered_at` si une opération a dû être restaurée

## Point de sécurité important

Les métadonnées locales ne sont pas envoyées à Supabase.

Avant d'appeler la synchronisation existante, une copie nettoyée de la file est temporairement utilisée afin d'éviter l'envoi de colonnes inconnues vers la table `achats`.

Après synchronisation, les statuts Supabase sont réconciliés avec la file locale enrichie.

## Audit ajouté

Quand une saisie est bloquée, un audit est tenté avec l'action :

```text
achat_blocked_by_farmer_buying_guard
```

Quand les gardes sont installés :

```text
farmer_buying_guards_installed
```

## Fonctions métier préservées

Les fonctions suivantes ne sont pas modifiées directement :

- `save`
- `syncAll`
- `render`
- `calc`
- `loadRef`
- `onVillage`
- `onCluster`

Elles sont enveloppées côté audit/garde pour préserver le fonctionnement existant.

## Aucun changement destructif

- Aucune migration Supabase.
- Aucune suppression de table.
- Aucune modification de données existantes.
- Aucun changement direct dans `terrain/achats.html`.
- Aucun changement dans IndexedDB.
- Aucun changement dans Cash, Sacs, Command ou RCN Trace.

## Limites volontaires

Cette étape sécurise Achats Terrain au niveau frontend.

Les étapes suivantes devront traiter :

1. contrôle d'avance RT avant achat ;
2. validation BM pour prix hors barème ;
3. liaison stricte achat → cash → sacs ;
4. conservation distante des photos de reçu ;
5. remplacement progressif du stockage `localStorage` par IndexedDB pour les transactions critiques.
