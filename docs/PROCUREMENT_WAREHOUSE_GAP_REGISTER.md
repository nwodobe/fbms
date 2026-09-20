# PROCUREMENT & WAREHOUSE GAP REGISTER

Date: 20 septembre 2026  
Branch: `feature/procurement-field-buying-warehouse`

## Principes retenus

- Field Buying = vérité de l'achat terrain.
- Procurement = vérité commerciale et orchestration des canaux.
- Logistics = vérité du déplacement.
- Quality = vérité qualitative.
- Warehouse = vérité physique.
- WMS Movement Ledger = vérité stock.
- Payment = vérité financière.
- Audit = vérité historique.

## Gaps audités

| ID | Domaine | Constat / risque | Priorité | Traitement |
|---|---|---|---|---|
| GAP-001 | Architecture | Pas de workspace Procurement transverse; LBA et Field Buying vivaient séparément. | P0 | CORRIGÉ — workspace Procurement créé. |
| GAP-002 | Field Buying | `achats.id` UUID mais frontend envoyait un ID texte `fb-...`. | P0 | CORRIGÉ — PostgreSQL génère l'UUID, `local_id` reste l'idempotency/offline key. |
| GAP-003 | Pricing | Prix campagne, commission RT, seuil Moisture et seuil KOR hardcodés en JS. | P0 | CORRIGÉ — `procurement_campaign_rules` versionné + RPC active rule. |
| GAP-004 | Pricing backend | Contrainte SQL imposait encore commission RT = 10 FCFA/kg. | P0 | CORRIGÉ — trigger serveur basé sur la règle active. |
| GAP-005 | Field traceability | Tables Lot/Contributors/Shipment existaient mais n'étaient pas utilisées par l'UI. | P0 | CORRIGÉ — RPC Lot + Evacuation et écran Procurement/Evacuations. |
| GAP-006 | Multi-Lot | Trigger Shipment générait le même Movement Code pour tous les Lots du camion. | P0 | CORRIGÉ — Movement Code unique par Shipment/Lot. |
| GAP-007 | Warehouse link | New Reception ne savait pas sélectionner une source Procurement. | P0 | CORRIGÉ — Field Shipment / Supplier Arrival liés et préremplis. |
| GAP-008 | Field genealogy | LOT WMS perdait Producteur / RT / Village après réception. | P0 | CORRIGÉ — `wms_lot_procurement_contributors` + capture automatique. |
| GAP-009 | Field vs Warehouse | Écart poids terrain/Warehouse non visible. | P0 | CORRIGÉ — vue Reconciliation; aucune redistribution automatique. |
| GAP-010 | Supplier Master | Warehouse saisissait des informations Supplier déconnectées du Procurement. | P0 | CORRIGÉ — Supplier Master unique `rcn_fournisseurs`. |
| GAP-011 | Cooperative | Supplier Master n'acceptait que LBA/DIRECT. | P1 | CORRIGÉ — catégorie COOPERATIVE ajoutée sans reclasser l'historique. |
| GAP-012 | LBA creation | Création LBA devait rester compatible avec la codification existante. | P1 | CORRIGÉ — réutilisation de `lba_create`. |
| GAP-013 | Direct/Coop | Aucun dossier pré-réception commun vers Warehouse. | P0 | CORRIGÉ — Planned Supplier Arrival via `rcn_proc_arrivages`. |
| GAP-014 | Purchase Type | Purchase Type Warehouse était libre. | P0 | CORRIGÉ — Master + dropdown + FK. |
| GAP-015 | Weight | Gross/Tare/Net devait être certifié. | P0 | DÉJÀ WMS + conservé — Net = Gross - Tare côté serveur. |
| GAP-016 | Field weight | Impossible de savoir si le poids terrain vient d'une balance ou d'une estimation. | P1 | CORRIGÉ — `weight_source`: SCALE / ESTIMATED / BAG_STANDARD. |
| GAP-017 | Commercial | Net Weight et Paid Weight étaient confondables. | P0 | CORRIGÉ — Settlement séparé; Refraction ne modifie jamais le stock physique. |
| GAP-018 | Quality | KOR devait être calculé, pas saisi, au Warehouse. | P0 | DÉJÀ WMS + conservé — snapshots Sampling/Final/Post-Dry. |
| GAP-019 | Rejection | REJECTED était un état terminal sans disposition. | P1 | CORRIGÉ — Rejection Case OPEN → RESOLVED avec action/motif/audit. |
| GAP-020 | Accepted/Rejected queue | Pas de board opérationnel clair. | P1 | CORRIGÉ — boards Accepted for Offloading / Rejected. |
| GAP-021 | Offline idempotency | Risque de double achat au rejeu sync. | P0 | PARTIELLEMENT COUVERT — `achats.local_id` UNIQUE; conflit multi-device reste à traiter. |
| GAP-022 | Offline conflict | RT offline et superviseur online peuvent modifier un même objet. | P1 | OUVERT — stratégie de résolution de conflit à formaliser avant offline complet. |
| GAP-023 | Field variance allocation | Qui supporte/répartit un écart Field → Warehouse ? | P0 business | BUSINESS_DECISION_REQUIRED — aucune allocation automatique implémentée. |
| GAP-024 | Refraction authority | Qui décide/approuve la Refraction ? | P1 business | BUSINESS_DECISION_REQUIRED — RPC séparée + SoD disponible, matrice métier à valider. |
| GAP-025 | Transport tolerance | Seuil acceptable de variance d'évacuation non officiel. | P1 business | BUSINESS_DECISION_REQUIRED — pas de seuil hardcodé. |
| GAP-026 | Rejection disposition catalog | Liste officielle des actions après rejet non fournie. | P1 business | BUSINESS_DECISION_REQUIRED — action libre auditée pour le moment. |
| GAP-027 | Producer already paid | Traitement financier d'un écart découvert après paiement producteur. | P0 business | BUSINESS_DECISION_REQUIRED — ne jamais réécrire le paiement. |
| GAP-028 | Required documents | Documents obligatoires peuvent varier par canal. | P1 business | BUSINESS_DECISION_REQUIRED — champs disponibles, matrice documentaire à valider. |
| GAP-029 | Kg/bag | Ancienne contrainte terrain 40–120 kg/sac est encore une règle technique héritée. | P1 business | À VALIDER — ne pas supprimer sans règle officielle. |
| GAP-030 | Campaign legacy values | Règle migrée: prix 400, commission 10, Moisture max 10, KOR min 45. | P0 business | BUSINESS_DECISION_REQUIRED — source marquée LEGACY, à superséder après validation. |

## Business Decisions Required avant exploitation complète

1. Valider/superséder les paramètres legacy de campagne.
2. Valider la politique Field → Warehouse variance: no allocation / proportional / commercial adjustment / autre.
3. Définir l'autorité Refraction et le niveau d'approbation.
4. Définir les tolérances de transport.
5. Définir le traitement financier après paiement producteur lorsqu'un écart Warehouse est détecté.
6. Définir le catalogue officiel de Rejection Disposition.
7. Définir les documents obligatoires par canal.
8. Valider la fourchette kg/sac ou la rendre paramétrable.
9. Définir la stratégie de conflits offline multi-device.

## Quality Gate

Aucune fusion vers `main` ne doit avoir lieu si:
- un P0 technique reste ouvert;
- Mass Balance échoue;
- stock négatif;
- mouvement dupliqué;
- généalogie orpheline;
- Reconciliation Field/Warehouse cassée;
- données TEST persistantes;
- régression critique.
