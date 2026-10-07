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

## 6. Enrôlement des producteurs depuis une coopérative (lot 7, migrations `20261007060*`)

Trois actions distinctes dans l'onglet Producteurs :

| Action | RPC | Effet |
|---|---|---|
| + Enrôler un producteur | `aflp_coop_enroll_producer` | Nouveau producteur dans `public.producteurs` (registre unique), affiliation, baseline DRAFT et parcelles **seulement si déclarées**, consentement **seulement si recueilli** (méthode + date), sinon NON RECUEILLI |
| Associer un producteur existant | `aflp_coop_add_member` | Affiliation seule : Farmer ID, RT, parcelles, Passport et achats inchangés |
| Importer Excel | `aflp_coop_import_rows` | Assistant 10 étapes, lots de 200 lignes, 6 catégories, staging dans la file « À vérifier » |

Anti-doublon (`private.aflp_match_core`, exposé par `aflp_coop_match_producers_v2`) :

| Règle | Confiance | Effet |
|---|---|---|
| Farmer ID identique | 100 | création impossible, même forcée |
| Même téléphone (même village / ailleurs) | 95 / 85 | création réservée à la supervision, avec motif |
| Téléphone secondaire | 80 | idem |
| Nom + prénoms, même village / même année de naissance / même cluster | 75 / 70 / 65 | motif obligatoire ou file « À vérifier » |
| Même nom de famille dans le village, prénoms absents d'un côté | 60 | idem |

Deux prénoms renseignés et différents avec le même nom de famille désignent deux personnes (fratrie) : pas de signalement. Un producteur hors périmètre est signalé sans identité (Farmer ID seul).

File « À vérifier » (`aflp_coop_enrollment_reviews`) : candidats qui ne sont pas encore des producteurs. Décisions tracées : associer l'existant, compléter puis enrôler (nouveau contrôle anti-doublon), créer après justification (10 caractères min.), laisser à compléter, ignorer (motif).

Qualité des données : `aflp_producer_quality_v` mesure la **complétude du dossier** sur 8 éléments (téléphone, sexe, âge, village, GPS, superficie, potentiel, consentement), jamais une note du producteur.

Farmer Passport : l'affectation (20 points) accepte un RT **ou** une affiliation coopérative active (migration 7d).

Livraisons mode B : supplier, origine (jamais déduite, migration 7g), entrepôt, poids, sacs, camion, chauffeur, réception WMS, répartition, niveau de traçabilité ; visibles dans la fiche coopérative et dans Procurement › Delivery Plan (filtre Tous / Direct AFLP / Coopératives / LBA / Direct Supplier).

Reports : `aflp_coop_report` combine côté serveur campagne, canal, coopérative, statut, zone, cluster, village, section, producteur et période ; un producteur compté une fois ; QA exclues.

## 7. Recette

* SQL : `tests/sql/aflp_cooperatives_scenarios.sql` (37 contrôles) et `tests/sql/aflp_coop_enrolement_e2e.sql` (43 contrôles) joués sur la base réelle en transaction **annulée** ; empreintes md5 des tables métier identiques avant/après.
* Charge (registre gonflé de 5 000 producteurs QA, annulé) : import 10 / 100 / 520 / 1 000 lignes en 0,15 / 1,3 / 7,1 / 16,0 s, aucune ligne perdue.
* UI : `tests/cooperatives/recette-ui.mjs` — 177 écrans (FR et EN × 390, 768, 1440), dont enrôlement, doublon, association, À vérifier, import complet, Delivery Plan, Farmer Passport ; contrôle des libellés français restés en EN.

## 8. Points ouverts

* Photo de la carte Coopératives : aucune photo de réunion de coopérative dans le dépôt (photos disponibles vérifiées : productrice en verger, enfant portant un sac, achat LBA, transfert, entrepôt, rapports, traçabilité, usine). La photo actuelle (productrice, verger d'anacardiers, sac en jute) est conservée. À remplacer par une photo interne ANAGROCI quand elle existera.
* Préfinancement : non construit ; une coopérative liée à un Supplier peut déjà utiliser les modules Procurement / Financing existants.
* Traducteur global (`shared/i18n.js`, zone protégée) : remplacement mot à mot ; les écrans Coopératives, Farmer Passport, Reports coopératives, Delivery Plan coopératives et la navigation utilisent désormais des libellés EN explicites. Les autres modules restent dépendants du traducteur global (dette antérieure).
* Fonctions `aflp_coop_match_producers` (v1) et `aflp_coop_import_commit` conservées pour compatibilité, plus appelées par l'interface.
