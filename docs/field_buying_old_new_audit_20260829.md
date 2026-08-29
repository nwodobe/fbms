# FIELD BUYING — audit OLD → NEW

Date : 29/08/2026
Branche : `feat/field-buying-full-restoration`
Périmètre : ANAGROCI Operations Suite > FIELD BUYING / Achat Bord Champ

## Décision d'architecture

La nouvelle Operations Suite reste le shell unique. Les anciennes interfaces `fbms/*`, `terrain/*` et `rcntrace/*` ne doivent pas redevenir des écrans utilisateurs. En revanche, leurs moteurs métier, tables, RPC, gardes et règles utiles sont réutilisés.

La source canonique reste Supabase. Aucun référentiel parallèle n'est créé.

Règle campagne 2027 : la parcelle/GPS est facultative. Son absence ne bloque jamais la création d'un producteur, un Achat Bord Champ, un lot, le stock, un shipment ou une réception usine.

## Diagnostic global

Le nouveau `operations/field-buying-v2.js` est essentiellement un lecteur de quatre tables (`achats`, `producteurs`, `rt`, `avances`). Les rubriques Sacherie, Command Center, Sustainability et Traceability sont encore des placeholders. La perte fonctionnelle vient donc principalement de la couche UI/routage, pas d'une disparition du backend.

Le dépôt contient déjà des moteurs spécialisés réutilisables : Farmer Registry/Passport, RT → Producteur, achats terrain, cash, sacherie, contrôle sacherie, hubs/carte, sustainability et traceability. Supabase contient aussi les tables terrain modernes `field_lots`, `field_rcn_bags`, `field_stock_movements`, `field_shipments`, ainsi que `ops_bag_requests` / `ops_bag_releases` et les RPC de sacherie.

## Matrice OLD → NEW

| Ancienne capacité | État actuel | Nouvel emplacement | Moteur / source à réutiliser | Gap | Action |
|---|---|---|---|---|---|
| Dashboard Farmer Buying | Appauvri | FIELD BUYING > Vue d'ensemble | `achats`, `producteurs`, `rt`, `villages`, `avances`, vues sacherie/stock | KPI incomplets, pas de progression 3 000 MT | Restaurer |
| Recensement village | Absent du nouveau shell | Recensement > Villages | table `villages`, triggers de synchronisation existants | formulaire + liste + actions | Restaurer |
| Recensement RT | Liste seulement | Recensement / RT & Villages | table `rt`, anti-doublon, `set_rt_cluster_and_code`, `guard_rt_duplicate_identity` | création/édition absentes | Restaurer |
| RT → Producteur | Moteur présent mais non exposé | Recensement > Nouveau producteur / RT | `shared/rt-to-producer.js` | accès Operations | Reconnecter |
| Farmer Registry | Liste simplifiée | Producteurs | table `producteurs`, `shared/farmer-registry-*` | recherche, actions, fiche | Reconnecter |
| Farmer Passport | Existant hors nouvelle façade | Producteurs > Farmer Passport | `shared/farmer-registry-passport.js`, fonctions farmer_* | navigation native | Reconnecter sans seconde identité |
| Parcelle / GPS | Existant | Farmer Passport | `farmer_plots` | ne doit pas bloquer 2027 | Garder facultatif |
| Achat Bord Champ | Liste seule | Achat Bord Champ | table `achats`, gardes achats, canonicalisation producteur | création/filtrage/KPI | Restaurer |
| Lots terrain | Backend existant | Achat Bord Champ / Traceability | `field_lots`, `field_lot_contributors` | UI intégrée | Reconnecter |
| Sacs RCN remplis | Backend existant | Achat Bord Champ / Traceability | `field_rcn_bags` | UI intégrée | Reconnecter |
| Stock terrain | Backend existant | Vue d'ensemble / Command Center | `field_stock_movements`, `field_available_stock` | synthèse | Reconnecter |
| Shipments terrain | Backend existant | Traceability | `field_shipments`, `field_shipment_lots` | synthèse | Reconnecter |
| Hubs / clusters | Ancienne interface seulement | Hubs & Cartographie | `hubs_clusters`, `aflp_clusters`, `villages` | carte native Operations | Restaurer |
| Carte villages | Disparue du shell | Hubs & Cartographie | coordonnées `villages`, ancien moteur carte comme référence | rendu carte | Restaurer sans ancien shell |
| Cash / avances RT | Liste simplifiée | Caisse & Avances | `avances`, gardes cash, cycles | KPI/balances/exceptions | Restaurer |
| Command Center BM | Placeholder | Command Center | logique `terrain/command.html`, tables achats/avances/sacs/RT | alertes natives | Restaurer |
| Sacherie terrain historique | Ancienne UI | Sacherie AFLP | `sacs_mouvements`, gardes existants | ne pas réutiliser comme nouveau shell | Utiliser comme donnée/compatibilité |
| Sacherie centrale Operations | Backend présent | Sacherie AFLP | `ops_bag_requests`, `ops_bag_releases`, `aflp_bag_*`, `ops_release_bags`, RPC sacherie | UI FIELD BUYING absente | Restaurer en priorité |
| Approval ≠ release | Backend présent | Sacherie AFLP | demandes + releases séparés | non visible | Exposer clairement |
| Multi-release | Backend présent | Sacherie AFLP | `ops_bag_releases`, `ops_release_bags` | non visible | Conserver |
| Sustainability | Backend et ancien écran présents | Sustainability | `farmer_sustainability_*`, RPC farmer_* | placeholder Operations | Reconnecter |
| Traceability terrain | Backend présent | Traceability | `field_traceability_search`, lots/sacs/stock/shipments | placeholder Operations | Reconnecter |
| Intégrité Farmer ID | Présente | transversal | triggers/functions Farmer Registry | ne pas contourner | Réutiliser |
| Anti-doublon RT | Présent | transversal | index `rt_id_rt_unique_idx`, `guard_rt_duplicate_identity` | aucun besoin de nouvelle table | Réutiliser |
| Unicité reçu achat | Présente côté serveur | Achat Bord Champ | index unique `achats_numero_recu_unique_idx` | ancien audit obsolète | Ne pas recréer |

## Supabase audité

Objets canoniques confirmés, entre autres :

- référentiels : `villages`, `rt`, `producteurs`, `aflp_clusters`, `hubs_clusters` ;
- buying : `achats`, `avances` ;
- Farmer Passport : `farmer_plots`, `farmer_production_baselines`, `farmer_sustainability_baselines`, `farmer_consents`, `farmer_visits`, `farmer_inspections`, `farmer_verifications`, `farmer_action_plans` ;
- trace terrain : `field_purchase_sources`, `field_lots`, `field_lot_contributors`, `field_rcn_bags`, `field_stock_movements`, `field_shipments`, `field_shipment_lots` ;
- sacherie : `aflp_bag_envelopes`, `aflp_bag_cluster_allocations`, `ops_bag_requests`, `ops_bag_releases`, `sacs_mouvements` ;
- logistique : `warehouses`, `rcn_transferts`.

Fonctions/RPC utiles confirmées : `farmer_possible_duplicates`, `farmer_registry_refresh_passport`, `fb_prevent_achat_over_advance`, `fb_prevent_negative_bag_stock`, `field_available_stock`, `field_traceability_search`, `ops_release_bags`, `sacherie_creer_demande`, `sacherie_decider_demande`, `sacherie_stock_cluster`, `sacherie_sacs_sous_responsabilite_rt`.

## Gaps qui ne doivent pas être inventés

Certaines conventions financières et seuils d'alerte restent à valider métier. Elles doivent rester configurables ou informatives, pas être codées comme vérité métier sans SOP approuvée.

## Ordre d'implémentation retenu

1. Remplacer le moteur FIELD BUYING minimal par un moteur unique avec `FieldBuyingStore`, cache 45 s, base chargée avec `Promise.all` et lazy loading des domaines lourds.
2. Aligner la sidebar sur les 11 rubriques demandées.
3. Restaurer Vue d'ensemble, Recensement, Producteurs, RT & Villages, Hubs & Cartographie, Achat Bord Champ, Caisse & Avances.
4. Reconnecter Sacherie centrale avec demandes, approvals et multi-release sans confondre approbation et sortie physique.
5. Reconnecter Command Center, Sustainability et Traceability dans le même shell.
6. Ajouter les assertions statiques et E2E non destructives/rollback.
7. Ne fusionner qu'après contrôles verts et revue AVANT → APRÈS.
