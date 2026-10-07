# AFLP 2027 · Intégration des coopératives

*Date : 07/10/2026 · Branche : `feature/aflp-cooperatives` · Projet Supabase : FIELD BUYING ANAGROCI*

## 1. Principe

> **Une donnée. Une identité. Une chaîne de traçabilité.**

| Objet | Rôle | Où il vit |
|---|---|---|
| Producteur | Unité centrale de traçabilité | `public.producteurs` (registre **unique**, inchangé) |
| RT | Acteur terrain AFLP | `public.rt` (inchangé) |
| Coopérative | Organisation partenaire, canal d'approvisionnement | `aflp_cooperatives` + tables `aflp_coop_*` |
| Procurement | Contrepartie commerciale / financière | `procurement_suppliers` (lien optionnel `aflp_cooperatives.supplier_id`) |
| Warehouse | Réception physique, LOT, BIN | `wms_*` (inchangé) |
| Traceability 360 | Chaîne complète | `operations_traceability_search_v` (étendue) + `aflp_coop_chain()` |
| Reports | Pilotage | `aflp_coop_dashboard()`, `aflp_channel_totals()` |

Deux canaux AFLP coexistent :

```
CANAL 1  AFLP DIRECT    Village → RT → Producteur
CANAL 2  COOPÉRATIVE    Coopérative → Section/Village → Producteur (+ RT de suivi éventuel)
```

Pas de sixième workspace : **Coopératives** est une rubrique de FIELD BUYING (`field-buying.html#cooperatives`).

## 2. Modèle de données (migrations `supabase/20261006230*_aflp_coop_*.sql`)

| Table | Contenu | Règles clés |
|---|---|---|
| `aflp_cooperatives` | Identité, localisation, statuts AFLP / conformité / liste producteurs, membres déclarés, lien Supplier | Code `COOP-NNN` automatique ; `QA-COOP-NNN` pour les fiches de test ; jamais supprimée (trigger) → archivage |
| `aflp_coop_campaigns` | Par campagne : modèle de paiement, potentiel **déclaré**, target, volume sécurisé, référents AFLP, entrepôt destination | Target modifiable par la direction uniquement (trigger) |
| `aflp_coop_sections` | Sections facultatives | Nom unique par coopérative |
| `aflp_coop_villages` | N villages par coopérative (référentiel ou localité libre signalée) | Un village peut être couvert par plusieurs coopératives |
| `aflp_coop_collection_points` | Points de collecte (GPS, capacité, entrepôt) | — |
| `aflp_coop_contacts` | Président, secrétaire, magasinier… | **Jamais des RT** |
| `aflp_coop_memberships` | Affiliation producteur ↔ coopérative, **par campagne, historisée** | 1 principale ouverte / producteur / campagne ; pas de doublon ouvert ; Member ID unique par coop ; sortie = `ENDED` + date de fin, jamais suppression |
| `aflp_producer_enrollment` | Source d'enrôlement figée (créé via coopérative) | Producteur sans ligne = enrôlé AFLP_DIRECT (aucun rattrapage écrit) |
| `aflp_coop_documents` | Pièces (bucket privé `aflp-coop-docs`) | Remplacement = nouvelle version + ancienne annulée |
| `aflp_coop_deliveries` / `aflp_coop_delivery_allocations` | Livraisons consolidées (mode B) et répartition par producteur | Sur-allocation refusée ; allocation à un non-membre refusée ; traçable seulement si alloué = livré |
| `aflp_coop_audit` | Journal de toutes les modifications | Alimenté par triggers |
| `achats` (+5 colonnes) | `sourcing_channel`, `cooperative_id`, `coop_membership_id`, `coop_member_number`, `coop_section_id` | Défaut `AFLP_DIRECT` ; renseignement automatique depuis l'affiliation principale (coopérative APPROUVÉE/ACTIVE, hors QA) ; achat au titre d'une coopérative suspendue refusé |

Source d'enrôlement ≠ affiliation actuelle : `aflp_producer_channel_v` donne, pour 2027, le canal (affiliation principale ouverte), la coopérative, le Member ID, la section, le RT de suivi et la source d'enrôlement.

## 3. Deux modèles d'achat

* **Mode A — INDIVIDUAL_FARMER** : l'achat reste une ligne `achats` saisie dans Achat Bord Champ ; la chaîne existante (lot terrain → expédition → réception WMS → `wms_lot_procurement_contributors`) conserve la coopérative.
* **Mode B — COOPERATIVE_CONSOLIDATED** : `aflp_coop_plan_delivery()` crée la livraison et, si la coopérative est liée à un Supplier, l'arrivage dans le **Delivery Plan Procurement** (`rcn_proc_arrivages`, canal COOPERATIVE). La réception WMS est reliée par `rcn_proc_arrivages.reception_id` ou saisie (`aflp_coop_record_delivery`). Statut `ALLOCATION_A_COMPLETER` tant que la répartition ≠ poids livré.

## 4. Chaîne de traçabilité

`aflp_lot_origin_v` : pour chaque LOT WMS, canal d'origine (AFLP_DIRECT / COOPERATIVE / MIXTE / LBA / DIRECT), coopérative(s), producteurs, villages, niveau de traçabilité.
Traceability 360 recherche désormais `COOPERATIVE`, `COOP_DELIVERY` et `WMS_LOT` ; l'ouverture d'une coopérative affiche Coopérative → Producteurs → Achats → Lots terrain → Livraisons → Lots → BIN → Transferts → Factory.
La fiche LOT du Warehouse affiche un panneau « Origine du LOT » (`warehouse-lot-origin.js`).

## 5. Permissions (RLS)

| Rôle | Coopératives | Affiliations (données nominatives) | Écriture |
|---|---|---|---|
| Branch Manager, ABM, Head of Field, Procurement Officer | toutes | selon Farmer Registry (global) | oui ; approbation, activation, target, archivage : BM / ABM / Head of Field |
| Zonal Head | toutes (portée globale du 17/09/2026) | oui | oui, sauf approbation / target / archivage |
| Unit Head, Supervisor | cluster ou villages de leur périmètre | dans leur périmètre | oui, dans leur périmètre |
| RT / Agent Recenseur | coopératives couvrant leur village | leurs producteurs | membres (via `peut_modifier_rt_producteur`) |
| Finance, Warehouse, Factory, QA, Viewer | fiche organisation + agrégats | **non** | non ; contacts et documents masqués pour Warehouse/Factory/QA |

Aucune politique DELETE (sauf correction d'une allocation avant réception) ; trigger de blocage de suppression physique.

## 6. Recette

* SQL : `tests/sql/aflp_cooperatives_scenarios.sql` — 37 contrôles joués sur la base réelle en transaction **annulée** (aucune donnée QA conservée), avec sessions simulées BM / Zonal Head / Supervisor / sans profil.
* UI : `tests/cooperatives/recette-ui.mjs` — 23 écrans × 3 largeurs (390, 768, 1440) en FR et 6 écrans × 3 largeurs en EN, doublure Supabase avec session et données fictives.

## 7. Points ouverts

* Photo de la carte Coopératives : photo Pexels déjà présente dans le dépôt (productrice, verger d'anacardiers, sac en jute), recadrée. À remplacer par une photo interne ANAGROCI d'une réunion de coopérative (aucun accès réseau aux banques d'images depuis l'environnement de développement).
* Préfinancement : non construit ; une coopérative liée à un Supplier peut déjà utiliser les modules Procurement / Financing existants.
* Les libellés du Farmer Passport hérités restent partiellement en français en mode EN (dette antérieure).
