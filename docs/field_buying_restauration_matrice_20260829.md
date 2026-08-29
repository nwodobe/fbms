# FIELD BUYING — matrice OLD → NEW (restauration fonctionnelle)

Établie par audit croisé : ancien front (`fbms/`, `terrain/`, `logistique/`,
`shared/`) et schéma Supabase réel (tables, vues, RPC, RLS). Elle a précédé le
codage : aucune fonction n'a été reconstruite sans avoir vérifié qu'elle
n'existait pas déjà.

Légende ACTION : RÉINTÉGRÉ = disponible dans `operations/field-buying.html` ;
GAP = manque documenté, à traiter dans une PR dédiée.

| Ancienne fonction | Où elle vivait | État avant cette PR | Nouvel emplacement | Moteur réutilisé | Action |
|---|---|---|---|---|---|
| Recensement village (fiche s1…s9) | `fbms/index.html` FormView | absente du nouveau shell | FIELD BUYING → Recensement → + Nouveau village | table `villages` (colonnes + `data` s1…s9), `fn_sync_villages_colonnes` | RÉINTÉGRÉ (champs essentiels ; photos et candidats RT : GAP) |
| Création RT | `fbms/index.html` saveRT | absente | Recensement → + Nouveau RT | table `rt` (+ trigger `id_rt`, cluster dérivé du village, `guard_rt_duplicate_identity`) | RÉINTÉGRÉ |
| Création producteur | `fbms/index.html` + `farmer-enrollment-phase1.js` | absente | Recensement → + Nouveau producteur | table `producteurs`, RPC `farmer_possible_duplicates`, code auto `next_producteur_code` (trigger) | RÉINTÉGRÉ (consentement + pièce d'identité Phase 1 : GAP) |
| RT → Producteur (préremplissage + anti-doublon) | `shared/rt-to-producer.js` | absente | RT & Villages → RT → bouton « → Producteur » (activité contient PRODUCTEUR) | mêmes règles, mêmes tables | RÉINTÉGRÉ |
| Farmer Registry (liste, recherche) | `fbms/index.html` producteurs | tableau brut sans action | Producteurs (recherche, filtres, statuts, parcelle) | vue `farmer_passport_summary_v` | RÉINTÉGRÉ |
| Farmer Passport | `shared/farmer-registry-passport.js` | absent | Producteurs → clic → Passport (identité, KPI, achats, liens Sustainability/Traceability) | `farmer_passport_summary_v`, `achats` | RÉINTÉGRÉ (formulaires passeport — parcelles, baselines, inspections, visites : GAP) |
| Saisie achat bord champ | `terrain/achats.html` | absente (lecture seule) | Achat Bord Champ → + Nouvel achat | table `achats`, barème 400 F/kg, commission RT 10 F/kg, seuils humidité 10 %/KOR 45, échelle À valider/À contrôler/Validation BM requise, `Entrée RT`, gardes serveur `fb_prevent_achat_over_advance` + RLS | RÉINTÉGRÉ (photo du reçu + file hors-ligne : GAP) |
| Liste et pilotage des achats | `terrain/achats.html` + command | partielle | Achat Bord Champ (KPI jour/semaine/campagne, filtres, 13 colonnes) | table `achats` | RÉINTÉGRÉ |
| Caisse & avances | `terrain/cash.html` | tableau brut | Caisse & Avances (balances par RT, écart caisse, cycles) | tables `avances`, `reconciliations`, règle anti-cumul (réconciliation exigée) | RÉINTÉGRÉ en lecture + alertes (saisie avance/réconciliation : GAP volontaire — circuit BM existant) |
| Sacherie AFLP | `terrain/sacherie_v2.html` + moteur central | absente | Sacherie AFLP (enveloppe, allocations, stock cluster, RT Bag Account, + Nouvelle demande RT) | moteur central `ops_bag_requests`/`ops_release_bags` (multi-release), vues `sacherie_ct_cluster_stock`/`sacherie_ct_rt_stock`, `aflp_bag_envelopes` | RÉINTÉGRÉ (décision BM et sortie physique restent dans le circuit central : conservé) |
| Hubs & géographie AFLP | `fbms/fbms_hubs.html` | absente | Hubs & Cartographie (zones GBEKE 1/2 → 6 clusters → hubs → usine) | `aflp_zones`, `aflp_clusters`, `hubs_clusters` (PK `id_hub`), `log_hubs` | RÉINTÉGRÉ |
| Carte interactive | `fbms/fbms_carte.html` | absente | Hubs & Cartographie (Leaflet 1.9.4 + OSM, marqueurs villages colorés, popups fiche, axes village→hub et hub→usine) | GPS villages `data.s1` (virgule tolérée) + colonnes, cascade distance routière > saisie > Haversine, usine via `parametres_calcul`, barycentre si hub sans GPS | RÉINTÉGRÉ (édition GPS hub et validation de distance : GAP — restent dans audit_distances) |
| Cluster détail | agrégats `fbms_hubs.html` | absente | Hubs → clic cluster → Cluster Passport | mêmes agrégats + stock sacherie | RÉINTÉGRÉ |
| Command Center BM | `terrain/command.html` | vide | Command Center (17+ types d'alertes, filtres cluster/sévérité, lien direct vers l'objet) | mêmes règles : achats sans reçu, prix hors barème, qualité, écart caisse, villages sans RT/GPS/achat, sacs aging, demandes en attente, doublons | RÉINTÉGRÉ (volet Assistant IA : GAP hors périmètre) |
| Sustainability | `terrain/sustainability.html` | vide | Sustainability (KPI + tableau par village) | vue `farmer_sustainability_dashboard_v` | RÉINTÉGRÉ |
| Traceability 360 terrain | `terrain/traceability.html` | vide | Traceability (recherche chaîne complète) | RPC `field_traceability_search` | RÉINTÉGRÉ en recherche (constitution de lot, sacs, expéditions : restent dans Traceability 360, conservés) |
| Vue d'ensemble / dashboard | dispersée | 5 KPI statiques | Vue d'ensemble (objectif 3 000 MT, jour/semaine/campagne, potentiel/sécurisé, vues zone/cluster) | agrégats des référentiels | RÉINTÉGRÉ |
| Doublons fonctionnels retirés | `field-buying-v2.js` (vitrine) | chargé | plus chargé (fichier conservé au dépôt) | — | CONSOLIDÉ |

## Gaps assumés (vrais restes à faire)
1. Photos village (bucket `photos`) et 3 candidats RT du recensement s7.
2. Enrôlement producteur Phase 1 complet : consentement (`farmer_consents`), pièce (`farmer_identity_documents`).
3. Formulaires du Farmer Passport (parcelles, baselines, inspections, visites, preuves) — moteurs `farmer_registry_operations` à porter.
4. Saisie d'avance et de réconciliation dans le shell (aujourd'hui lecture + alertes).
5. Édition GPS hub / validation de distance routière (workflow 7 statuts de `fbms_hubs.html`).
6. Mode hors-ligne (files locales `anagroci_*`) — le nouveau moteur est en ligne d'abord.
