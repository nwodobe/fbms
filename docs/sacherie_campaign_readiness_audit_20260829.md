# Sacherie AFLP — audit campagne longue et P0

Date : 29/08/2026
Branche : `feat/sacherie-campaign-readiness-p0`

## Conclusion immédiate

**Readiness avant P0 : 43/100 — NON pour une campagne de 6 mois sans Excel/cahier parallèle.**

Le backend est beaucoup plus riche que la nouvelle rubrique FIELD BUYING. La nouvelle UI sait surtout lire les stocks, afficher les demandes `ops_bag_requests` et créer une demande simple. L’ancien moteur SOP-006 sait contrôler cycle financé, stock RCN physique, plafond, décision BM et remise, mais son exécution n’est pas réellement multi-release. Le moteur moderne `ops_bag_*` est donc retenu comme registre canonique des demandes/sorties, enrichi avec les contrôles utiles de l’ancien moteur.

## Décision d’architecture

- Interface unique : `operations/field-buying.html`.
- Registre physique canonique : `rcn_jute_locations` + `rcn_jute_movements` + vues `rcn_jute_v_*`.
- Demandes/sorties canoniques : `ops_bag_requests` + `ops_bag_releases`.
- Contrôles métier réutilisés : `sacherie_calculer_plafond`, cycles `avances`, stock RCN vérifié.
- `bag_movement_requests` reste legacy/compatibilité pendant la transition ; aucune nouvelle opération FIELD BUYING ne doit créer une seconde vérité dans ce registre.
- `sacs_mouvements` reste projeté vers le registre `rcn_jute_movements` via le bridge existant pour l’historique.

## Matrice OLD → NEW

| Fonction | Ancienne Sacherie | Nouvelle FIELD BUYING | Backend | Gap / décision |
|---|---|---|---|---|
| Pilotage global | Très riche | Synthèse | `sacherie_ct_snapshot` | Réintégrer drill-down/alertes |
| Stock cluster | Oui | Oui | `sacherie_ct_cluster_stock` | OK après correction droits |
| Stock RT | Oui | Oui | `sacherie_ct_rt_stock` | OK |
| Stock producteur | Oui | Synthèse cluster seulement | `rcn_jute_locations/v_stock` | P1 |
| Vides/pleins/transit/états | Oui | Partiel | `rcn_jute_v_stock` | P1 UI |
| Cycle financé + plafond | Oui | Non | `sacherie_calculer_plafond` | **P0** |
| Demande RT | Oui | Oui mais trop simple | deux registres | **P0 unifier sur `ops_bag_requests`** |
| Décision BM | Oui | Non | state machine `ops_bag_request_guard` | **P0** |
| Multi-release | Ancien moteur : non réel | Backend moderne : oui | `ops_release_bags` | **P0 exposer UI** |
| Confirmation réception | Faible | Non | colonnes partielles dans `ops_bag_releases` | **P0** |
| Écart remis/reçu | Non robuste | Non | aucune donnée dédiée | **P0** |
| Inventaire | Oui | Non | `sacherie_ct_inventorier` | P1 |
| Perte | Oui | Non | `sacherie_ct_declarer_perte/decider_perte` | P1 |
| Réparation / réforme | Oui | Non | `sacherie_ct_traiter_etat`, `rcn_jute_repairs` | P1 |
| Transferts | Oui | Non | `rcn_jute_transfers` | P1 |
| Offline | Brouillons demande | Non | localStorage ancien | P1, avec idempotence serveur |
| Audit/traçabilité | Oui | Partiel | mouvements + audit | P0/P1 |
| Clôture RT/cluster/campagne | Insuffisant | Non | pas de workflow complet | P2 |

## Angles morts critiques confirmés

1. **Deux moteurs de demande concurrents.** `bag_movement_requests` et `ops_bag_requests` peuvent diverger. P0 : FIELD BUYING écrit uniquement dans `ops_bag_requests`.
2. **Ancien “multi-release” trompeur.** `sacherie_executer_demande` ferme la demande après une seule exécution, y compris partielle. P0 : utiliser `ops_release_bags`, qui additionne les releases et possède une clé d’idempotence.
3. **Réception physique incomplète.** `ops_bag_releases` sait qui a reçu et quand, mais ne stocke pas proprement la quantité réellement reçue ni l’écart. P0 : ajouter quantité reçue, statut réception, preuve/commentaire et RPC idempotent.
4. **Readiness réseau incomplet.** 6 clusters actifs mais seulement 4 locations `CLUSTER` dans le registre Sacherie ; Brobo, Sakassou et Djébonoua ne sont pas prêts dans le registre canonique. Seulement 4 locations RT existent actuellement. P0 : rendre ces manques visibles et bloquer une opération vers une location inexistante.
5. **Organisation applicative non initialisée.** Les profils actifs observés sont Branch Manager, Supervisor et Agent Recenseur ; les fonctions opérationnelles attendues (Zonal Head, Unit Head, Assistant Unit Head, Warehouse Keeper, Logistics Coordinator) ne sont pas encore configurées dans `profils`. P0 : readiness rouge, ne pas affaiblir les RLS/RPC pour contourner ce manque.
6. **Enveloppe et allocations non initialisées.** `aflp_bag_envelopes` et `aflp_bag_cluster_allocations` sont vides. P0 : readiness explicite avant démarrage.
7. **Aucune enveloppe ne doit être confondue avec stock physique.** L’enveloppe est une autorisation, le registre `rcn_jute_*` est la vérité physique.
8. **Double clic/retry.** Les sorties modernes sont idempotentes (`client_release_id`), mais la création FIELD BUYING doit utiliser une clé client stable et le nouveau workflow contrôlé.
9. **Approbateur = exécutant.** `ops_release_bags` interdit déjà cette collusion ; conserver la séparation des tâches.
10. **Nom de cluster / normalisation.** `DJEBONOUA`, `Djébonoua` et l’historique `N'DJEBONOUA` peuvent créer deux emplacements logiques si une initialisation automatique est faite sans mapping validé. Ne pas auto-créer avant validation de correspondance.

## Readiness par domaine avant P0

| Domaine | Score |
|---|---:|
| Pilotage | 65 |
| Stock | 70 |
| Demande | 45 |
| Approbation | 30 |
| Sortie | 55 |
| Réception | 20 |
| RT / responsabilité | 55 |
| Producteur | 35 |
| Inventaire | 50 |
| Pertes | 55 |
| Réparations | 45 |
| Transit | 45 |
| Offline | 25 |
| Sécurité | 70 |
| Audit | 60 |
| Performance | 70 |
| Clôture | 15 |

**Score global indicatif : 43/100.**

## P0 retenu avant premier achat

1. Readiness campagne visible dans la nouvelle rubrique.
2. Demande RT contrôlée : cycle financé + stock RCN physique + plafond serveur.
3. Une seule demande canonique `ops_bag_requests`.
4. Décision BM (approuver, réduire, hold, rejeter) avec revalidation du plafond.
5. Multi-release via `ops_release_bags`, preuve facultative et idempotence.
6. Confirmation de réception par release avec quantité réellement reçue et écart.
7. Blocage/alerte sur écart de réception.
8. Tests non destructifs du state machine et des calculs.

## P1 premier mois

Inventaires physiques, pertes, changements d’état, réparations, transferts, Producteur Bag Account, offline synchronisé, aging configurable, exports et alertes avancées.

## P2 campagne longue

Clôture RT/cluster/campagne, transfert de responsabilité lors d’un remplacement, archivage/partitionnement logique, contrôles antifraude avancés, workflow de résolution d’écart et réconciliation finale.

## Question finale à ce stade

**NON.** Avant le P0, il n’est pas raisonnable de confier six mois de gestion complète de la sacherie au nouveau module sans registre parallèle. Le backend est assez riche pour atteindre cet objectif, mais les opérations critiques ne sont pas encore toutes exposées ni unifiées dans le nouveau shell.
