# Step 1C - Audit metier module par module

Date: 2026-07-19
Projet: ANAGROCI Operations Suite

## Objectif

Brancher un audit metier non destructif sur les actions sensibles des modules existants, sans modifier la logique metier et sans toucher aux donnees deja en production.

## Methode retenue

Le fichier `shared/anagroci-audit.js` est deja charge globalement par `shared/auth-gate.js`.

Cette etape ajoute des hooks automatiques autour des fonctions globales existantes. Les fonctions originales continuent de s'executer normalement. Apres execution, une entree est tentee dans `audit_log`.

## Actions couvertes

### Achats Terrain

- Fonction cible: `save`
- Action audit: `achat_create_attempt`
- Donnees tracees: date, cluster, village, RT, producteur, poids net, prix, montant, sacs, mode de paiement, numero recu, humidite, KOR, rejet.

### Caisse & Avances

- Fonction cible: `saveAvance`
- Action audit: `cash_advance_attempt`
- Donnees tracees: date, cluster, RT, source, montant, motif.

- Fonction cible: `saveRecon`
- Action audit: `cash_reconciliation_attempt`
- Donnees tracees: RT, cluster, avance, paye, cash restant, valeur stock.

### Stock & Sacs

- Fonction cible: `saveMov`
- Action audit: `bag_movement_attempt`
- Donnees tracees: date, type de mouvement, cluster, village, RT, producteur, quantite, observation.

### Hubs / Audit distances / FBMS geographique

- Fonction cible: `saveHub`
- Action audit: `hub_gps_update_attempt`
- Donnees tracees: hub, latitude, longitude.

- Fonction cible: `valide`
- Action audit: `distance_validation_attempt`
- Donnees tracees: id village, hub, seuil.

### ALIS

- Fonction cible: `calc`
- Action audit: `alis_simulation_attempt`
- Donnees tracees: mode, hub, village, volume, contrat, camion, objectif.

- Fonction cible: `saveBareme`
- Action audit: `alis_bareme_update_attempt`
- Donnees tracees: note bareme_collecte_courte.

### Synchronisation

- Fonction cible: `syncAll`
- Action audit: `sync_requested`
- Donnees tracees: statut online/offline.

## Points de prudence

- Les hooks sont non destructifs.
- Les actions sont tracees comme `attempt`, car certaines fonctions peuvent echouer sur validation metier interne.
- L'audit ne remplace pas les controles metier. Il les complete.
- Les validations/rejets specifiques non encore materialises par des fonctions separees devront etre branches lors des futures versions des modules.

## Controle effectue

- Aucun schema Supabase modifie pendant cette sous-etape.
- Aucun stockage local IndexedDB ou localStorage supprime.
- Aucun changement de logique metier existante.
- Un seul fichier fonctionnel modifie: `shared/anagroci-audit.js`.

## Limites restantes de l'Etape 1

A traiter ensuite dans les modules quand les workflows seront enrichis:

- validation / rejet achat avec fonction dediee;
- correction stock avec justification;
- decision BM ALIS;
- decision GM RCN TRACE;
- export de donnees;
- reception / transfert / calibrage dans RCN TRACE quand les workflows seront operationnels.

## Decision

Cette etape permet de commencer la tracabilite metier sur les modules existants sans attendre le refactoring design. Elle ne suffit pas encore pour un audit complet de niveau ERP, mais elle securise deja les operations sensibles actuelles.
