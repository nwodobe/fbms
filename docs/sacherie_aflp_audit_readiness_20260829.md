# Sacherie AFLP — audit, angles morts, readiness campagne 2027

Date : 2026-08-29 · Constats par lecture du code du dépôt **et** requêtes
lecture seule sur le projet Supabase live. Aucune donnée réelle citée.

## A. Audit OLD → NEW (matrice)

Trois moteurs hérités coexistent : **Sacherie V2 / SOP-006**
(`bag_movement_requests` + `sacs_mouvements`), **Control Tower**
(RPC/vues `sacherie_ct_*` sur le ledger `rcn_jute_*`), **RCN TRACE Jute**
(`rcn_jute_*`, entrepôt/fournisseurs). Le registre canonique est
`rcn_jute_movements`. Avant cette PR, la rubrique Operations n'avait
qu'une seule action (créer une demande) ; tout le reste était en lecture.

| Fonction | Ancienne sacherie | Nouvelle rubrique (avant) | Backend | Après cette PR |
|---|---|---|---|---|
| Pilotage global | CT snapshot 6 KPI drillables | 6 KPI, enveloppe sans filtre campagne | vues ct_* | 8 KPI, parc global, écarts, filtre campagne 2027 |
| Stock cluster / RT / producteur | CT + V2 | lecture partielle (états tronqués) | `sacherie_ct_cluster_stock` / `rt_stock` | colonnes déchirés / à réparer ajoutées |
| Demande RT | plafond SOP serveur bloquant | 3 champs sans contrôle | `sacherie_calculer_plafond` | plafond SOP restauré (80 kg / +10 %), DÉPASSEMENT SOP bloquant |
| Approbation | BM 4 issues, motif obligatoire, 24 h | absente | trigger `ops_bag_request_guard` | revue → consolidation → décision BM (partielle + motif, expiration 24 h) |
| Sortie physique | V2 : mono-coup (reliquat perdu) | absente | `ops_release_bags` multi-release | multi-release outillé, preuve photo, séparation approbateur/exécutant serveur |
| Réception / double confirmation | absente partout (P1 connu) | absente | colonne `received_qty` sans écrivain | confirmation cumulée + écart visible ; garde serveur proposée (voir H) |
| Retours RT / producteur | V1 legacy (RETOUR_RT/PROD) | absente | mouvements canoniques | **P1** — non couvert ici |
| Pertes | CT : SOUMIS → décision BM | absente | `sacherie_ct_declarer/decider_perte` | déclaration + décision BM outillées |
| Déchirés / réparations / réforme | CT transitions bornées | chiffre seul | `sacherie_ct_traiter_etat` | transitions DECHIRE→A_REPARER→REPARE→UTILISABLE, REFORME=BM |
| Inventaires / écarts | CT : PASS/HOLD serveur | absents | `sacherie_ct_inventorier` | inventaire outillé, HOLD jamais ajusté en silence |
| Transferts inter-entrepôts | RCN TRACE (EN_TRANSIT, écart auto) | absents | `rcn_jute_transfers` + `receive_partial` | **P1** — moteur existant, UI à brancher |
| Historique / sorties | CT journal paginé + export CSV | absents | `ops_bag_releases`, mouvements | dernières sorties + preuve signée ; journal complet **P1** |
| Preuves | base64 dans le RPC (CT) / Storage (RCN) | absentes | bucket privé `rcn-jute-proofs` | photos compressées vers le bucket privé, URL signée |
| Alertes | bandeau « À décider » | 4 règles | — | + écart réception (rouge), perte à décider, inventaire HOLD (rouge), stock négatif (rouge) |
| Idempotence | `client_request_id` / `event_key` / `local_id` | clé régénérée à chaque clic (défaut) | index uniques + RPC idempotents | clé posée à l'ouverture du formulaire (demande **et** sortie) |
| Clôture campagne | absente partout | absente | — | **P2** — à spécifier métier |

## B. Angles morts (classés)

**Critiques (corrigés dans cette PR)**
1. Codes de location inventés (`CLUSTER:x` / `RT:y`) alors que le registre
   attend `AFLP-CL-…` / `AFLP-RT-…` : **toute sortie physique aurait échoué**
   au contrôle de stock d'`ops_release_bags`. Corrigé : codes résolus depuis
   `rcn_jute_locations`, location RT créée via `sacherie_ct_location`.
2. `received_qty` sans écrivain : la double confirmation entrepôt→RT
   n'existait nulle part (limite P1 connue de l'ancien système). Corrigée
   côté UI (confirmation cumulée, écart bloquant sans observation) ;
   le verrouillage serveur reste à appliquer (voir H).
3. Idempotence affaiblie : clé régénérée à chaque soumission → double clic
   = double demande. Corrigé (clé posée à l'ouverture), vérifié par test.
4. Statut `PENDING` écrit par l'UI et écrasé en `REQUESTED` par le serveur ;
   filtres d'affichage alignés sur la vraie machine à états.

**Critiques (hors de portée d'une PR front — décision humaine requise)**
5. Politique RLS historique `sacs_mouvements_ins` (fichier `supabase/sacs.sql`)
   sans l'exclusion `DOTATION_RT` : les policies permissives se combinent en
   OR, seul le trigger protège réellement. Constat déjà documenté dans
   `docs/sacherie_control_tower_security_findings_20260811.md`, non corrigé.
6. Initialisation campagne 2027 : au moment de l'audit, enveloppe **0**,
   allocations **0**, 4 locations cluster sur 6, 4 locations RT. L'UI
   fournit désormais l'état READY/PARTIAL/MISSING et les actions de
   création (enveloppe, allocations), mais la décision des volumes est métier.

**Élevés (P1)**
7. Retours producteur→RT→cluster non outillés dans la rubrique.
8. Transferts inter-clusters (EN_TRANSIT, réception partielle, écart auto)
   existants côté serveur, non exposés.
9. Journal complet des mouvements (recherche « où sont passés les 100 sacs
   du RT X ? ») : le ledger le permet, l'UI ne l'expose pas encore.
10. Aging paramétrable (7/15/30/45 j) : seuil 30 j en dur — **À VALIDER MÉTIER**.
11. Mode hors ligne : la V2 avait des brouillons locaux « ne valant pas
    approbation » ; la rubrique Operations n'en a pas.
12. Expiration d'approbation 24 h : valeur MVP reprise telle quelle —
    **À VALIDER MÉTIER** (notée dans l'UI).

**Moyens (P2)** : clôture RT / cluster / campagne ; tolérance d'inventaire
paramétrable (aujourd'hui : tout écart = HOLD, comportement le plus sûr) ;
lien sacs pleins ↔ achats (`achats.nb_sacs` jamais rapproché du stock) ;
niveau de suivi RT→producteur (quantité globale = niveau A, recommandé) ;
pagination au-delà de 100 demandes / 60 sorties chargées.

**Faibles (P3)** : export CSV, valorisation financière, drill-down complet
national→mouvement, score de risque RT côté serveur.

## C. Architecture retenue

```
Rubrique FIELD BUYING (#bags)
  demandes    → ops_bag_requests   (INSERT, trigger ops_bag_request_guard)
  workflow    → UPDATE gardés      (REQUESTED→REVIEWED→CONSOLIDATED→BM_APPROVED)
  sorties     → rpc ops_release_bags (multi-release, idempotent, séparation des tâches)
  réception   → UPDATE received_qty (écart visible ; garde serveur proposée)
  contrôles   → rpc sacherie_ct_*  (pertes, inventaires, transitions d'état)
  preuves     → bucket privé rcn-jute-proofs (URL signées)
        ↓
  registre canonique unique : rcn_jute_movements (+ vues sacherie_ct_*)
```
Aucune table nouvelle, aucun moteur parallèle, aucune migration appliquée.

## D. Règles métier constatées (jamais inventées)

- Plafond demande : `⌊((stock RCN vérifié + volume financé restant) × 1,10) ÷ 80⌋`
  − sacs détenus − réservations (80 kg/sac confirmé dans `rcn_jute_settings`).
- Approbation : BM seul, partielle ≤ demandé, motif obligatoire HOLD/REJET,
  expiration 24 h (MVP), verrou consultatif par RT.
- Sortie : approbateur ≠ exécutant, trajet verrouillé sur l'autorisation,
  stock UTILISABLE vérifié sous verrou, releases cumulées jusqu'au dernier sac.
- États : UTILISABLE·PLEIN·EN_TRANSIT·DECHIRE·A_REPARER·REPARE·REFORME·HUMIDE ;
  transitions bornées ; REFORME réservé BM ; le total du parc ne change jamais
  sur un transfert ou un changement d'état.
- Perte : SOUMIS ne diminue rien ; seul le BM approuve (mouvement PERTE_APPROUVEE).
- Inventaire : écart ⇒ HOLD + motif, jamais d'ajustement silencieux.

## E. Matrice des rôles (constatée serveur : RLS + triggers + RPC)

| Action | GM | BM | Zonal Head | FB Ops Officer | Unit Head | Assist. UH | Warehouse Keeper/Storekeeper | RT |
|---|---|---|---|---|---|---|---|---|
| Voir | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | (via UH) |
| Demander | ✓ | ✓ | ✓ | ✓ | ✓ | — (OPS) | — | — |
| Revue | — | ✓ | ✓ | — | — | — | — | — |
| Consolider | — | ✓ | — | ✓ | — | — | — | — |
| Approuver | (LBA) | ✓ | — | — | — | — | — | — |
| Sortir | — | ✓ | — | — | — | ✓ | ✓ | — |
| Confirmer réception | — | ✓ | — | ✓ | ✓ | — | — | via UH |
| Inventaire / état / perte (déclarer) | selon accès location (`sacherie_ct_assert_location_access`) |
| Décider perte / réformer | — | ✓ | — | — | — | — | — | — |
| Enveloppe / allocations | ✓ | ✓ | — | — | — | — | — | — |

L'interface n'affiche que les boutons du rôle, mais **chaque action est
revalidée côté Supabase** ; un appel direct hors rôle est rejeté.

## F. Readiness

| Domaine | Avant | Après PR | Note |
|---|---|---|---|
| Pilotage | 40 | 75 | drill-down complet en P3 |
| Stock | 60 | 80 | états complets affichés |
| Demande | 25 | 85 | SOP restauré |
| Approbation | 0 | 85 | 4 issues + motifs |
| Sortie | 0 | 85 | multi-release + preuve |
| Réception | 0 | 65 | garde serveur à appliquer |
| RT (bag account) | 50 | 70 | historique par RT en P1 |
| Producteur | 20 | 20 | retours/remises P1 |
| Inventaire | 0 | 80 | tolérance paramétrable P2 |
| Pertes | 0 | 85 | — |
| Réparations | 0 | 70 | coût/réparateur via RCN TRACE (P1) |
| Transit | 10 | 10 | UI P1 (moteur prêt) |
| Offline | 0 | 5 | brouillons P1 |
| Sécurité | 55 | 70 | P0 RLS sacs_mouvements ouvert |
| Audit | 30 | 75 | audit_log sur chaque action |
| Performance | 50 | 65 | tri serveur + bornes ; pagination P2 |
| Clôture | 0 | 5 | P2 |

**Readiness campagne globale : 35/100 avant → 62/100 après cette PR.**

## G. Simulations exécutées

28 scénarios navigateur (doublure fidèle aux contrats serveur, 7 largeurs,
`tests/field-buying-e2e.mjs` SB1–SB23) : cockpit, workflow complet, 100
demandés → 80 approuvés (partielle + motif), sortie 90>80 bloquée, double
clic sortie = 1 seule sortie (clé idempotente), 60 libérés / 58 reçus →
écart affiché + observation obligatoire, rejet sans motif refusé, plafond
SOP 17 affiché / 28 bloqué, codes de location réels, perte sans motif
refusée, inventaire 90 vs 100 → HOLD −10, transition DECHIRE→A_REPARER,
décision de perte BM, alertes Command Center. Les simulations de charge
(20 000+ mouvements) et les écritures sur la base réelle n'ont **pas** été
exécutées (base de production, lecture seule) : à rejouer sur un
environnement de staging avant campagne.

## H. Migration serveur proposée (NON appliquée — décision humaine)

Pour verrouiller la réception côté serveur : étendre
`ops_bag_request_guard` afin que (1) `received_qty` ne dépasse jamais
`released_qty`, (2) seul un rôle de réception puisse l'écrire, (3) un écart
consigne un motif. À livrer en migration versionnée dès que la politique
d'écriture de `supabase/` le permet — la règle du dépôt interdit à un agent
de modifier `supabase/**` et la base sans instruction explicite.

## I. Réponse à la question finale

> « Si la campagne AFLP 2027 démarrait demain matin et durait six mois,
> pourrais-je confier la gestion complète de la sacherie à ce système sans
> Excel parallèle, sans cahier parallèle et sans perdre la traçabilité
> d'un seul sac ? »

**NON — pas demain matin.** Et il vaut mieux le savoir aujourd'hui :

1. **Le système n'est pas initialisé** : enveloppe 2027 absente, aucune
   allocation cluster, 2 locations cluster manquantes, locations RT
   incomplètes. L'UI fournit maintenant l'état et les actions, mais les
   volumes sont une décision GM/BM à prendre et à saisir.
2. **La boucle terrain n'est pas fermée** : remises RT→producteur, retours,
   transferts inter-clusters et mode hors ligne ne sont pas outillés dans
   la rubrique (P1). Sans eux, un cahier parallèle réapparaîtra chez les RT.
3. **Deux verrous serveur restent ouverts** : la réception (`received_qty`)
   n'est pas contrainte côté base, et la policy historique de
   `sacs_mouvements` affaiblit le blocage RLS des dotations.
4. **Rien n'a été éprouvé en volume réel** : 12 mouvements historiques dans
   le ledger, aucune campagne complète simulée sur staging.

**Ce qui est vrai après cette PR** : la chaîne demande → revue →
consolidation → approbation BM → sorties multi-release → réception avec
écart → pertes → inventaires → états fonctionne de bout en bout dans la
nouvelle interface, sur les moteurs serveur existants, avec idempotence,
preuves privées et audit. Avec l'initialisation faite, la migration de
réception appliquée et le lot P1 (retours, transferts, journal, offline),
la réponse peut devenir « OUI, MAIS » puis « OUI » après une simulation de
campagne sur staging.
