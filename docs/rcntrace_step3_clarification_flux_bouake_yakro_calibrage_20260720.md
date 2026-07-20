# RCN Trace — Étape 3 : clarification du flux Bouaké / Yakro / Calibrage

Date : 20/07/2026  
Projet : ANAGROCI Operations Suite / RCN Trace  
Statut : correction d'interface ciblée  
Décision : exécuter avant l'étape 11 Farmer Buying

---

## 1. Objectif

L'étape 3 corrige le risque principal identifié en étape 2 : la confusion possible entre :

- Bouaké entrepôt ;
- Yakro entrepôt ;
- Calibrage ;
- transfert Bouaké vers Yakro ;
- transfert Yakro vers calibrage ;
- livraison directe fournisseur à Yakro.

L'objectif n'est pas de modifier le moteur métier, ni les tables Supabase, ni les données existantes.

L'objectif est de rendre le flux plus lisible directement dans l'interface.

---

## 2. Principe métier retenu

### 2.1 Bouaké

Bouaké est traité comme un entrepôt de réception, stockage, séchage, triage, BIN et transfert.

### 2.2 Yakro

Yakro est traité comme un second entrepôt.

Une matière reçue à Yakro ou transférée à Yakro reste de la matière en entrepôt tant qu'elle n'a pas fait l'objet d'un transfert vers le calibrage.

### 2.3 Calibrage

Le calibrage est un atelier de production distinct de Yakro entrepôt.

Le calibrage ne doit consommer que les transferts explicitement destinés au calibrage.

### 2.4 Livraison directe Yakro

Une livraison fournisseur directe à Yakro doit être enregistrée comme une réception Yakro complète :

- camion ;
- fournisseur ;
- origine ;
- sampling ;
- décision GM ;
- déchargement ;
- analyse finale ;
- lot officiel ;
- BIN Yakro.

Elle ne doit pas être confondue avec une réception au calibrage.

---

## 3. Correction appliquée

### 3.1 Fichier ajouté

- `rcntrace/flow-clarity.js`

Ce fichier ajoute une couche visuelle non destructive.

Il insère automatiquement un bandeau explicatif après le titre de l'écran actif.

### 3.2 Fichier modifié

- `rcntrace/procurement-export.js`

Un petit chargeur a été ajouté à la fin du fichier pour charger :

```text
./flow-clarity.js?v=step3-flow-clarity-20260720
```

Cette méthode évite une réécriture lourde de `rcntrace-ui.js`, qui est un fichier volumineux et sensible.

---

## 4. Écrans clarifiés

La couche de clarification couvre notamment :

- accueil ;
- activité entrepôt ;
- réception ;
- qualité ;
- stock & BIN ;
- séchage / triage ;
- transfert ;
- calibrage ;
- transferts attendus au calibrage ;
- réception au calibrage ;
- opérations de calibrage ;
- sorties de calibrage ;
- contrôle qualité des sorties ;
- BIN de calibre ;
- traçabilité ;
- rapports ;
- audit.

---

## 5. Messages métier ajoutés

### 5.1 Accueil

Bouaké et Yakro sont des entrepôts. Le calibrage est un atelier distinct.

### 5.2 Réception

La réception se fait dans un site précis : Bouaké ou Yakro.

Une livraison directe à Yakro n'est pas un calibrage.

### 5.3 Stock & BIN

Une BIN appartient à un site d'entrepôt.

Une BIN Yakro n'est pas automatiquement disponible pour calibrage.

### 5.4 Transfert

Un transfert Bouaké vers Yakro est un transfert entrepôt vers entrepôt.

Un transfert Yakro vers Calibrage est un transfert vers l'atelier de production.

### 5.5 Calibrage

Le calibrage ne consomme que les transferts explicitement destinés au calibrage.

### 5.6 BIN de calibre

Les BIN de calibre sont des BIN de sortie de production, différentes des BIN RCN de stockage entrepôt.

---

## 6. Ce qui n'a pas été modifié

Aucune migration Supabase n'a été appliquée.

Aucune table n'a été modifiée.

Aucune donnée n'a été modifiée.

Aucun trigger n'a été ajouté.

Aucune règle serveur n'a été ajoutée.

Aucun flux Farmer Buying n'a été modifié.

Le moteur `rcntrace.js` n'a pas été modifié.

Le routeur principal `rcntrace-ui.js` n'a pas été modifié.

---

## 7. Incident traité

Pendant l'étape, une première tentative de modification de `rcntrace/procurement-export.js` a produit un contenu incomplet.

L'incident a été détecté immédiatement.

Le fichier a été restauré avant la finalisation de l'étape.

Le chargeur final a ensuite été ajouté proprement.

---

## 8. Limites

Cette étape améliore la lisibilité de l'interface, mais ne crée pas encore de verrou serveur.

Les prochaines corrections doivent traiter :

- le typage strict des destinations de transfert ;
- la distinction serveur entre destination entrepôt et destination calibrage ;
- le filtrage strict des matières disponibles pour calibrage ;
- la réception Yakro directe avec workflow complet ;
- les preuves documentaires liées aux mouvements.

---

## 9. Décision recommandée

Passer à :

```text
RCN Trace — Étape 4 : verrouillage métier du transfert Bouaké / Yakro / Calibrage
```

Objectif de l'étape 4 : empêcher côté métier qu'une matière simplement stockée à Yakro soit utilisée comme matière disponible pour calibrage sans transfert explicite vers calibrage.
