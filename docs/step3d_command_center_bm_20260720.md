# Étape 3D — Command Center BM

Date : 2026-07-20

## Décision de séquence

RCN Trace reste en dernière position. La priorité opérationnelle reste le programme Farmer Buying.

Étapes terminées avant celle-ci :

- Étape 3A — Achats Terrain
- Étape 3B — Cash / Avances RT
- Étape 3C — Sacs / Sacherie terrain

Cette étape renforce le pilotage Branch Manager.

---

## Objectif

Donner au Branch Manager une vue journalière claire des risques terrain :

- achats à risque ;
- cash et avances RT ;
- sacs et sacherie ;
- synchronisations locales en attente ;
- RT à risque ;
- villages sans RT ;
- villages sans GPS.

---

## Fichier modifié

- `terrain/command.html`

Aucune migration Supabase n'a été appliquée.
Aucune donnée n'a été modifiée.
Aucun fichier RCN Trace n'a été modifié.

---

## Changements réalisés

### 1. Refonte du Command Center BM

Le module devient une vraie page de pilotage quotidien avec :

- KPIs principaux ;
- bloc d'anomalies priorisées ;
- suivi des files locales ;
- analyse par cluster ;
- référentiel terrain ;
- tableau RT à risque.

---

### 2. KPIs consolidés

Les indicateurs visibles au Branch Manager sont :

- volume acheté ;
- cash engagé ;
- sacs en main RT ;
- risques critiques à traiter.

Le volume garde la logique de progression vers l'objectif Farmer Buying de 11 000 MT.

---

### 3. Alertes BM quotidiennes

Le bloc "À faire aujourd'hui" priorise les anomalies :

- synchronisations en attente ;
- échecs de synchronisation ;
- achats sans reçu ;
- RT en écart caisse ;
- soldes sacs négatifs ;
- achats qualité à contrôler ;
- achats prix hors barème ;
- villages sans RT ;
- villages sans GPS.

Les alertes sont classées par sévérité :

- critique ;
- moyen ;
- faible.

---

### 4. Files locales et mode hors-ligne

Le module lit les files locales suivantes :

- `anagroci_achats` ;
- `anagroci_avances` ;
- `anagroci_recons` ;
- `anagroci_sacs`.

Il affiche :

- achats en attente ;
- cash en attente ;
- sacs en attente ;
- échecs de synchronisation.

Cela permet au BM de savoir si les données terrain visibles sont complètes ou encore partiellement bloquées sur des appareils.

---

### 5. Analyse par cluster

La table par cluster affiche :

- nombre de villages ;
- nombre de RT ;
- volume acheté ;
- montant avancé ;
- solde caisse ;
- sacs disponibles au cluster.

Les soldes négatifs sont visuellement signalés.

---

### 6. RT à risque

Le tableau RT identifie :

- avance ouverte non réconciliée ;
- solde caisse négatif ;
- solde sacs RT négatif.

Une colonne "Risque" indique si le problème concerne :

- caisse ;
- sacs ;
- dépassement.

---

## Audit technique

### Ce qui n'a pas été fait

- Pas de migration Supabase.
- Pas de suppression de données.
- Pas de modification Achats.
- Pas de modification Cash.
- Pas de modification Sacs.
- Pas de modification RCN Trace.

### Ce qui a été fait

- Remplacement contrôlé de `terrain/command.html` par une version de pilotage BM plus complète.
- Lecture uniquement des tables existantes.
- Lecture uniquement du localStorage pour les files offline.
- Aucune écriture dans Supabase.

---

## Limites volontaires

Cette étape est un Command Center de lecture et de pilotage.

Elle ne crée pas encore :

- workflow d'approbation BM ;
- fermeture journalière ;
- export PDF journalier ;
- notification automatique WhatsApp ;
- contrôle backend global.

Ces points peuvent venir dans une étape suivante.

---

## Prochaine étape recommandée

Étape 3E — Audit final Farmer Buying.

Objectif : tester la cohérence globale Achats → Cash → Sacs → Command Center, puis documenter les points restants avant de passer à RCN Trace.