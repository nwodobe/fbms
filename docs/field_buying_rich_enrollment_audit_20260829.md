# FIELD BUYING — Audit OLD → NEW des enrôlements riches

Date : 2026-08-29
Branche : `feat/field-buying-rich-enrollment`

## Décision d’architecture

La nouvelle Operations Suite conserve son shell et son moteur `operations/field-buying.js`. Une couche UI progressive `field-buying-rich-enrollment.js` enrichit les créations Village / RT / Producteur et le Farmer Passport sans réintroduire les anciens shells.

Aucune table `*_v2`, aucune base parallèle et aucune migration Supabase ne sont nécessaires : les structures historiques/canoniques sont déjà présentes.

## Matrice OLD → NEW

| Domaine | Ancien support retrouvé | Nouvelle restauration | Classe 2027 |
|---|---|---|---|
| Village / identité | `villages` + `data.s1` | nom, code, zone, cluster, région, département, sous-préfecture, commune/localité | minimum + recommandé |
| Village / GPS | colonnes `gps_lat/gps_lng` + `data.s1` | GPS courant, précision, distances, route, hub | optionnel |
| Village / organisation | `data.s2` | chef, leader, structure, membres, producteurs estimés | recommandé |
| Village / production | `data.s3` | période forte, production, ventes, cible, potentiel | recommandé |
| Village / concurrence | `data.s4` | acheteurs, concurrence, prix, historique, fidélité, intérêt ANAGROCI | recommandé |
| Village / accès | `data.s5` | route, pluie, véhicules, franchissements, temps hub, points critiques | recommandé |
| Village / paiement | `data.s6` | préférence, prix avant paiement, reçu écrit | recommandé |
| Village / RT candidats | `data.s7` | candidat principal + téléphone | optionnel |
| Village / conformité | `data.s8` | acceptation, litige, exclusivité, stockage, risques | recommandé |
| Village / décision | `data.s9` | décision, priorité, actions, besoins, risques, commentaire | recommandé |
| RT / identité | `rt` | nom, téléphones, village, localité, statut | minimum |
| RT / activité | `rt.data` | activité, producteur oui/non, disponibilité, influence | recommandé |
| RT / capacité | `rt.data` | expérience, réseau, volumes, mobilité, connaissance terrain, sacs | recommandé |
| RT / finance | `rt.data` | besoin avance, capacité, paiement, commission, tolérance, endettement | recommandé |
| RT / évaluation | `rt.data` | réputation, fiabilité, risque, recommandation, notes | recommandé |
| Producteur / identité | `producteurs` | nom, prénoms, sexe, naissance, téléphones, langue, pièce, village, RT | nom + village minimum |
| Producteur / agricole | `producteurs.data` | expérience anacarde, nb parcelles, surface, âge verger, arbres, production, canal, autres cultures | recommandé |
| Parcelle | `farmer_plots` | nom local, surface, foncier, âge, point GPS, précision, statut GPS | après campagne possible |
| Baseline production | `farmer_production_baselines` | surface productive, production précédente, prévision 2027, arbres | optionnel/progressif |
| Consentement | `farmer_consents` | statut, méthode, scopes, notes | progressif |
| Sustainability | `farmer_sustainability_baselines` | lecture dans Farmer Passport | après enrôlement |
| Visites | `farmer_visits` | lecture dans Farmer Passport | après enrôlement |
| Inspections | `farmer_inspections` | lecture dans Farmer Passport | après enrôlement |
| Vérifications | `farmer_verifications` | historique Farmer Passport | après enrôlement |
| Plans d’action | `farmer_action_plans` | actions/recommandations Farmer Passport | après enrôlement |
| Achats | `achats` | historique producteur | opérationnel |
| Traceability | moteur FIELD BUYING existant | lien Farmer ID → Achat → Lot → Expédition → Réception | opérationnel |

## Règle campagne 2027

La création d’un producteur exige seulement le minimum opérationnel. La parcelle, le GPS, la baseline et Sustainability ne sont pas des prérequis à l’achat. L’interface affiche explicitement « Parcelle à compléter après campagne » lorsque nécessaire.

## Anti-doublon / intégrité

- Producteur : RPC `farmer_possible_duplicates` avant insertion + triggers Farmer Registry.
- RT : précontrôle client puis `guard_rt_duplicate_identity` côté serveur.
- Village : précontrôle nom normalisé + cluster ; les triggers existants synchronisent les colonnes.
- Farmer ID / code producteur : `farmer_registry_set_code` et moteurs Farmer Registry existants.

## Farmer Passport 360

Le routeur `#farmers/<producteur_id>` ouvre 12 rubriques dans le shell Operations : Identité, Exploitation, Parcelles, Production, Sustainability, Consentements, Visites, Inspections, Achats, Lots / Traceability, Actions, Historique.

Le statut parcelle est lu dans `farmer_plots`, pas déduit de `producteurs.data`.

## UX progressive

- stepper par thème ;
- jauge de complétude ;
- Niveau 1 : minimum opérationnel ;
- Niveau 2 : profil enrichi ;
- Niveau 3 : dossier complet ;
- responsive desktop/tablette/mobile ;
- cibles tactiles ≥ 44 px sur mobile.

## Backend réutilisé

Tables / vues / RPC principales : `villages`, `rt`, `producteurs`, `farmer_passport_summary_v`, `farmer_plots`, `farmer_production_baselines`, `farmer_sustainability_baselines`, `farmer_consents`, `farmer_visits`, `farmer_inspections`, `farmer_verifications`, `farmer_action_plans`, `achats`, `farmer_possible_duplicates`, `farmer_registry_refresh_passport`.

Triggers vérifiés : `fn_sync_villages_colonnes`, `guard_rt_duplicate_identity`, `set_rt_cluster_and_code`, `farmer_registry_prepare_producteur`, `farmer_registry_set_code`, `farmer_registry_refresh_from_producteur_trigger`.

## Migrations

**Aucune migration Supabase.** Le besoin est couvert par les structures déjà présentes.

## Gaps conservés volontairement

- photos du village et pièces/preuves binaires : ne pas recréer un système de stockage sans réutiliser le moteur de preuves existant ;
- édition complète de chaque baseline/inspection directement depuis le Passport : la première restauration fournit le dossier 360 et l’enrôlement progressif, sans dupliquer les moteurs spécialisés ;
- vraie géométrie de parcelle/polygone satellite : `farmer_plots.geometry_geojson` existe mais le formulaire initial ne force qu’un point GPS facultatif.
