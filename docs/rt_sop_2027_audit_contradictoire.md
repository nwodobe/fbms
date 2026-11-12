# FBMS AFLP 2027 · Audit contradictoire et mise en conformité SOP RT

**Commanditaire :** Branch Manager ANAGROCI Centre
**Date :** 12 novembre 2026
**Branche livrée :** `audit/rt-sop-conformite-20261112` (commits `7bcc8c0`, `5703b62` et suivants), construite sur la PR #311 non fusionnée
**Statut : version de test. Rien n'est appliqué en production. Rien n'est fusionné.**

## 0. Point de départ réellement constaté

Le rapport d'audit du 12/11 portait sur le commit `8855692`. Le dépôt avait évolué depuis :

| Élément | Constat vérifié |
|---|---|
| `main` (déployé) | `27f7dbe` (#310). Contient #309 : calculateur `shared/rt-sop-ledger.js` en lecture seule et fiche hebdomadaire imprimable |
| PR #311 (brouillon) | Branche `feature/rt-sop-wave-signatures-bev-grn-20261112` : 3 migrations `rt_sop_*`, console `operations/rt-sop-console.html`, tests SQL sur schéma simplifié |
| Production Supabase (lecture seule) | Dernière migration `campagnes_5_raz_sacherie_caisse`. **Aucune** table `rt_sop_*` |
| Données de production | 0 achat, 0 avance, 0 expédition, 0 GRN, 0 mouvement de sacs, 0 incident. 117 RT actifs sur 7 clusters (126 lignes dont 9 supprimées). Campagne réelle `0002` (2027, OPEN, courante) et simulation `2027` |
| Profils actifs | 1 BM, 1 ABM, 2 ZH, 5 UH, 1 Supervisor. **Aucun Finance, aucun Assistant UH, aucun QFS** |

Décision : ne pas reconstruire. La PR #311 couvre déjà le bon modèle (option C). Le travail a consisté à l'éprouver contre le **vrai** schéma de production, à reproduire ses défauts, à les corriger et à compléter les manques.

## 1. Méthode de test (pourquoi les résultats sont crédibles)

1. **Réplique fidèle** (`tests/replica-prod/`) : PostgreSQL 17.6 (même version majeure que la production 17.6), avec les colonnes, contraintes, déclencheurs, fonctions de contrôle et politiques RLS d'écriture **extraits des catalogues de production** (`pg_get_functiondef`, `pg_get_triggerdef`). Aucune ligne réelle copiée.
2. **Identités réelles de session** : chaque appel est fait sous le rôle `authenticated` avec un JWT fictif (BM, Finance, UH cluster A, UH cluster B, Assistant UH, ZH, ABM, QFS). Les droits et la RLS s'appliquent vraiment.
3. **Avant / après** : la même recette est jouée sur la PR #311 seule puis avec les corrections.
4. **Concurrence réelle** : deux sessions PostgreSQL simultanées (S15).
5. **Navigateur réel** : console ouverte dans Chrome à 390, 768 et 1440 px.

Commande unique : `PGHOST=... PGPORT=... PGUSER=postgres tests/replica-prod/run.sh` (avant : `AVANT_CORRECTIONS=1`).

**Ce que la réplique ne reproduit pas** (repéré « STUB » dans le fichier) : déclencheurs `achats` sans lien avec la caisse (canal coopérative, contrôle mode A, mise à jour producteur, règle procurement), contexte WMS, politiques SELECT de périmètre, Storage réel, fonction `offline_sync_batch`. Voir section H.

## A. Rapport d'audit actualisé

| # | Fonctionnalité | Situation trouvée | Problème confirmé | Source de la preuve | Correction | Prio | Statut |
|---|---|---|---|---|---|---|---|
| D1 | Sortie de noix sans BEV | Verrou BEV de la PR à l'INSERT seulement | Expédition créée DRAFT puis passée DISPATCHED par UPDATE : **acceptée sans BEV** (politique `field_shipments_upd` = tout utilisateur actif) | Sonde D1, `recette-avant.txt` | Verrou à l'INSERT **et** à l'UPDATE ; données de remise figées après liaison au BEV | P1 | Corrigé et testé |
| D2 | GRN officiel | Statuts production `EMIS` / `ANNULE` | La PR n'exclut que `CANCELLED/VOID/DRAFT` : **GRN annulé = GRN_MATCHED** et clôture RECEIVED acceptée | Sonde D2 | Seul `EMIS` est officiel (vue + verrou de clôture) | P1 | Corrigé et testé |
| D3 | Retrait espèces, dépôt, comptage, ajustement | Absent | S3 impossible ; aucun écart de caisse mesurable | S3 avant | Registre `rt_sop_cash_events` (append-only, preuve obligatoire, ajustement Finance avec motif) | P0 | Corrigé et testé |
| D4 | Achats en attente, disponible | Non exposés | S1 illisible : attente non visible | S1 avant | `rt_sop_purchase_state_v` + vue financière à 10 montants distincts | P0 | Corrigé et testé |
| D5 | Restitution | Plafond calculé sans les achats en attente | **Restitution de 60 000 acceptée** alors que 50 000 seulement non engagés ; reste à justifier faux (30 000) | S2 avant | Plafond = fonds non engagés (attente incluse) | P0 | Corrigé et testé |
| D6 | Ordre des décisions UH | Tri par `created_at` puis UUID aléatoire | Deux décisions dans la même transaction : résultat non déterministe | Lecture du code | Colonne `review_seq` (identité) | P0 | Corrigé, testé indirectement (S1, S10) |
| D7 | Avance comptabilisée | Copie dans `avances` | **Modifiable ensuite par l'ABM** (politique `avances_upd`) : montant ×10 accepté | S14 avant | Avance SOP figée (montant, RT, campagne, statut, suppression) | P0 | Corrigé et testé |
| D8 | Séparation des tâches | BM peut attester la réception RT | Le BM demandeur atteste lui-même | Lecture du code | Le demandeur et le payeur ne peuvent pas attester | P0 | Corrigé et testé (S16) |
| D9 | Stock non négatif | Pas de plafond | BEV au-delà du stock acheté accepté (stock RT négatif) | Lecture du code + S5 | Plafond BEV = achats − BEV déjà signés, sous verrou | P1 | Corrigé et testé |
| D10 | Désaccord RT | Statut conservé | Aucune anomalie ouverte, pas de statut « non conforme » | S8 avant | Anomalie automatique + `rt_sop_weekly_status_v` | P0 | Corrigé et testé |
| D11 | Carte RCN, carte sacherie, tableau BM | Absents (PR) / partiels (sacherie_ct_rt_stock = soldes sans historique) | Les 10 questions du critère final sans réponse unique | S5, S7, S17 avant | Vues `rt_sop_rcn_custody_v`, `rt_sop_jute_card_v`, `rt_sop_jute_history_v`, `rt_sop_rt_dashboard_v` | P1 | Corrigé et testé |
| D12 | Contrôles ZH, suspension ciblée | Absents | SOP non couvert | S16 avant | `rt_sop_zh_controls`, `rt_sop_suspensions`, ouverture/clôture d'anomalie par rôle | P1 | Corrigé et testé |
| D13 | Concurrence | Verrou PR sur campagne réelle seulement ; contrôle historique `fb_prevent_achat_over_advance` sans verrou | **2 × 60 000 acceptés sur 100 000** en campagne de simulation | S15 avant | Déclencheur de verrou juste avant le contrôle historique (fonction historique inchangée) | P0 | Corrigé et testé |
| D14 | Achat validé | Politique `achats_upd` = BM | **BM modifie un achat validé : reste à justifier 30 000 → 130 000** sans trace | Sonde D14 | Achat figé dès la première décision UH | P0 | Corrigé et testé |
| D15 | Affichage console | `esc()` sans remplacement de l'apostrophe | « validés par l**undefined**UH », noms et motifs déformés | Capture Chrome | Échappement corrigé + test | P2 | Corrigé et testé |
| D16 | Console mobile | Tableau trop large | Débordement horizontal à 390 px | Chrome 390 px | Défilement interne et retour à la ligne | P2 | Corrigé et testé |
| D17 | Téléphone partagé | Opération sans `user_id` « appartient » à quiconque synchronise | Risque d'attribution à un autre agent | Lecture `shared/offline-field.js` | Refus d'enregistrer sans agent identifié | P0 | Corrigé, **non testé sur APK** |
| D18 | Rôles Finance | Console et PR acceptent `Finance Officer`, `Accountant`, `Comptable` | Rôles impossibles en production (`profils_role_check`) | Catalogue production | Liste ramenée à `Finance`, `Finance Manager` | P2 | Corrigé |
| R1 | Compte Finance | Aucun profil actif | Circuit Wave inutilisable en production | Lecture production | **Créer un vrai compte Finance** (hors mandat) | P0 | Bloqué : autorisation BM/RH |
| R2 | API Wave | Aucune intégration | Confirmation manuelle uniquement | Lecture code | Saisie + preuve + contrôle humain (conforme au mandat) | P0 | Conforme, conservé |
| R3 | Anti-doublon / idempotence | Clés uniques et `idempotency_key` | Aucun | S11 | Aucune | P0 | Déjà conforme, conservé |
| R4 | Séparation des campagnes | `campaign_id` partout + `campaign_stamp` | Aucun | S13 | Aucune | P0 | Déjà conforme, conservé |
| R5 | Assistant UH | Garde serveur existante + rôle exclu des RPC SOP | Aucun | S10 | Aucune | P0 | Déjà conforme, conservé |
| R6 | Cloisonnement des clusters (UH) | `rt_sop_can_read_rt` par cluster | Aucun pour les UH | S10 | Aucune. **Supervisor lit tous les RT** : à confirmer | P0 | Conforme, point à valider |
| R7 | Signature hebdomadaire | Versions liées, empreinte, aucune modification directe | Aucun | S9 | Ajout des valeurs théoriques serveur figées | P0 | Conforme, renforcé |

## B. Rapport des corrections

| Fichier | Contenu | Commit |
|---|---|---|
| `supabase/20261112190000_rt_sop_conformite_corrections.sql` | D1 à D14 : 6 tables (événements de caisse, liens d'anomalies, suspensions, contrôles ZH, lots du BEV), 9 vues, 7 nouvelles RPC, 6 RPC de la PR réécrites, 5 déclencheurs | `7bcc8c0`, `5703b62` |
| `supabase/rollback/..._down.sql` | Retour arrière exact vers la PR #311, refus si les nouveaux registres contiennent des lignes | idem |
| `operations/rt-sop-console.html` / `.js` | Onglet « 0. Situation du RT » (10 questions), espèces, refus Finance, complément BEV, onglet « 5. Contrôle ZH et écarts », D15, D16, D18 | `7bcc8c0` |
| `shared/offline-field.js` | D17 ; version de cache relevée dans `operations/field-buying.html` | `7bcc8c0` |
| `tests/replica-prod/` | Réplique, simulations, concurrence, sondes avant correction, empreinte, test navigateur | `7bcc8c0`, `5703b62` |
| `tests/rt-sop-conformite-static.mjs` | Contrat statique : chaque RPC existe, chaque formulaire est traité, aucune écriture directe, apostrophe | idem |
| `docs/rt-sop-2027-preuves/` | Sorties brutes avant/après, retour arrière, captures | `5703b62` |

**RPC nouvelles :** `rt_sop_record_cash_event`, `rt_sop_finance_reject`, `rt_sop_bev_complete`, `rt_sop_open_incident`, `rt_sop_close_incident`, `rt_sop_record_zh_control`.
**RPC de la PR réécrites (signatures inchangées, console compatible) :** `rt_sop_request_funding`, `rt_sop_rt_acknowledge`, `rt_sop_review_purchase`, `rt_sop_refund`, `rt_sop_register_signed_bev`, `rt_sop_weekly_sign`.
**Fonction historique non modifiée :** `fb_prevent_achat_over_advance` (verrou ajouté par un déclencheur voisin).

### Règle de calcul appliquée (vue `rt_sop_cash_balance_v`)

| Montant | Calcul |
|---|---|
| Avance demandée / versée non confirmée / confirmée / refusée | Statut de `rt_sop_funding_requests` (REQUESTED / FINANCE_SENT ou RT_ACK / POSTED / REJECTED) |
| Achats validés UH / en attente / rejetés UH | Dernière décision UH (`review_seq`) |
| **Reste à justifier** | confirmées − validés UH − restitutions ± ajustements Finance |
| Disponible théorique | confirmées − validés − en attente − rejetés − restitutions ± ajustements |
| Espèces théoriques | retraits − dépôts − achats payés en espèces |
| Wave théorique | disponible − espèces théoriques |
| Écart de caisse | dernier comptage − espèces théoriques (vide si aucun comptage) |

Un achat en attente ne réduit jamais le reste à justifier ; à la validation, il passe d'« attente » à « validé » sans double comptage. Un achat rejeté par l'UH reste dépensé (il réduit le disponible) mais reste à justifier.

## C. Version de test

- Branche : `audit/rt-sop-conformite-20261112` (sur la PR #311).
- Environnement : réplique PostgreSQL 17.6 locale, données fictives, reproductible par `tests/replica-prod/run.sh`.
- Interface : `operations/rt-sop-console.html`, test navigateur `tests/replica-prod/navigateur/run.mjs`.
- **Pas d'environnement Supabase de staging disponible** : la seule branche Supabase existante (`sacherie-v2-test-20260811`) est en échec de migration et inactive. Créer un projet ou une branche Supabase est payant et n'a pas été fait sans votre accord.

## D. Rapport des simulations

Preuves brutes : `docs/rt-sop-2027-preuves/recette-avant.txt` et `recette-apres.txt`.

| ID | Entrée | Attendu | Obtenu après correction | Avant | Après |
|---|---|---|---|---|---|
| S1 | 300 000 confirmés, 200 000 validés, 40 000 en attente | reste 100 000 ; attente 40 000 | reste 100 000 ; validés 200 000 ; attente 40 000 | FAIL (attente invisible) | PASS |
| S2 | + restitution 10 000 ; tentative 60 000 | reste 90 000 ; excès refusé | reste 90 000 ; 60 000 refusés | FAIL (60 000 acceptés, reste 30 000) | PASS |
| S3 | Retrait 100 000 | aucun déchargement | reste 90 000 inchangé ; espèces 100 000 | FAIL (impossible) | PASS |
| S4 | Achat sans reçu ni photo | en attente + alerte | EN_ATTENTE, 1 alerte, validation refusée | FAIL | PASS |
| S5 | 300 kg achetés, BEV 200 kg ; BEV +150 ; DRAFT→DISPATCHED | RT 100 ; transport 200 ; refus | 100 kg ; 200 kg ; BEV refusé ; contournement refusé | FAIL (contournement accepté, sonde D1) | PASS |
| S6 | BEV 200, GRN 195 ; GRN annulé | écart 5 kg à examiner, sans imputation | GRN annulé ignoré ; GRN émis : écart −5 kg, GRN_VARIANCE_REVIEW, 0 ajustement | FAIL (GRN annulé = conforme, sonde D2) | PASS |
| S7 | 100 reçus, 25 utilisés, 15 pleins expédiés | 75 vides, 10 pleins, 85 sous garde | 75 / 10 / 85, identique à `sacherie_ct_rt_stock` | FAIL (pas de carte) | PASS |
| S8 | RT en désaccord | non conforme, motif, anomalie | DESACCORD_NON_CLOTURE, anomalie OUVERT | FAIL | PASS |
| S9 | Modifier un bilan signé | original conservé, nouvelle version | UPDATE refusé ; version non liée refusée ; 2 versions, originale intacte | FAIL (test bloqué en amont) | PASS |
| S10 | AUH valide ; UH autre cluster ; BM comme Finance ; ZH clôt | refus serveur | 4 refus, achat toujours EN_ATTENTE | FAIL (test bloqué en amont) | PASS |
| S11 | Même opération envoyée 2 fois | 1 transaction | rejeu reconnu, 1 ligne ; `local_id` en double refusé | PASS | PASS |
| S12 | Agent B envoie une opération de A | refus | refus RLS (`created_by = auth.uid()`) | FAIL (test bloqué en amont) | PASS (serveur) |
| S13 | Opération en campagne de simulation | pas de contamination | réelle 90 000 → 90 000 ; simulation 50 000 | PASS | PASS |
| S14 | Avance sans preuve Wave ; saisie directe ; modification | non comptée ; refus | non comptée ; 2 refus | FAIL (modification ABM acceptée) | PASS |
| S15 | 2 achats de 60 000 simultanés, disponible 100 000 | ≤ 100 000 consommés | réelle : 1 accepté ; simulation : 1 accepté | réelle PASS ; **simulation FAIL (120 000)** | PASS |
| S16 | BM atteste sa propre demande ; BEV suspendu puis décision | refus puis rétablissement | refus ; BEV suspendu ; clôture BM ; BEV rétabli | FAIL | PASS |
| S17 | Tableau BM | chiffres des registres ; « non vérifié » ≠ 0 | A1 cohérent ; B1 « NON_VERIFIE » | FAIL | PASS |
| S18 | BM modifie un achat validé | refus | refus, montant inchangé | FAIL (sonde D14 : accepté) | PASS |

**Résultat : 3 PASS / 16 FAIL avant ; 19 / 19 PASS après.** Recette CI d'origine de la PR : toujours PASS. Portes du dépôt (`verifier-js`, `verifier-html`, `verifier-liens`) : 0 nouveau défaut.

**Limites des simulations :** une simulation réussie sur la réplique ne prouve pas le fonctionnement en production. Les déclencheurs repérés « STUB » peuvent refuser des achats en production pour d'autres raisons ; ils n'affaiblissent aucun contrôle testé ici.

## E. Matrice SOP → FBMS

| Exigence SOP | Formulaire / écran | Données | Acteur | Preuve | Fréquence | Contrôle serveur | État |
|---|---|---|---|---|---|---|---|
| Demande de financement | Console › 1 › Demander | `rt_sop_funding_requests` | BM | Plan d'achat | Selon besoin | Rôle BM, campagne ouverte, suspension FINANCEMENT | Conforme testé |
| Versement Wave direct | Console › 1 › Finance | idem (`wave_reference` unique) | Finance | Reçu Wave | Chaque versement | Rôle Finance, preuve privée | Conforme testé (réplique) ; **bloqué en production : aucun compte Finance** |
| Accusé de réception RT | Console › 1 › Signature RT | `rt_ack_*` | UH (témoin), RT sur papier | Fiche signée photographiée | Chaque versement | UH du cluster, ni demandeur ni payeur | Conforme testé |
| Compte Wave réservé AFLP | Champ « compte Wave » | `wave_account_ref` | BM | Déclaration | Une fois | Format seulement | **Partiel** : FBMS ne voit pas le relevé Wave |
| Achat payé Wave ou espèces | Field Buying existant | `achats.mode_paiement` | UH / AUH | Reçu | Chaque achat | Verrou + plafond fonds confirmés | Conforme testé ; mode de paiement « non précisé » si vide |
| Retrait espèces | Console › 1 › Espèces | `rt_sop_cash_events` | UH ou Finance | Reçu Wave | Chaque retrait | Preuve, rôle | Conforme testé |
| Vérification UH avant déchargement | Console › 2 | `rt_sop_purchase_reviews` | UH | Reçu + preuve de paiement | Chaque achat | Rôle UH du cluster, reçu exigé, achat figé ensuite | Conforme testé |
| Restitution | Console › 1 › Restitution | `rt_sop_refunds` | Finance | Preuve de retour | Selon besoin | Plafond fonds non engagés | Conforme testé |
| Ajustement par contre-écriture | Console › 1 › Espèces › Ajustement | `rt_sop_cash_events` | Finance | Décision | Exceptionnel | Rôle Finance, motif ≥ 10 car. | Conforme testé (droits) |
| Rapprochement Finance indépendant | Situation du RT + vues | `rt_sop_cash_balance_v` | Finance | Relevé Wave (hors FBMS) | Hebdomadaire | Lecture seule | **Partiel** : pas de rapprochement automatique au relevé Wave |
| Bilan hebdomadaire 3 comptes | Console › 3 + fiche imprimable | `rt_sop_weekly_signoffs` | RT + UH | Fiche signée scannée | Hebdomadaire | Version, empreinte, valeurs serveur figées | Conforme testé |
| D'accord / réserve / désaccord | Console › 3 | `rt_decision` | RT | Fiche | Hebdomadaire | Motif obligatoire, anomalie automatique | Conforme testé |
| Correction après signature | Console › 3 (nouvelle version) | `supersedes_id` | UH | Nouvelle fiche | Selon besoin | Original intouchable | Conforme testé |
| Contrôle ZH | Console › 5 | `rt_sop_zh_controls` | ZH | Photo / fiche | **À fixer** (14 jours par défaut) | Rôle ZH, écart = anomalie | Conforme testé ; fréquence à confirmer |
| Signalement et suspension ciblée | Console › 5 | `aflp_incidents` + `rt_sop_suspensions` | ZH, BM | Facultative | Immédiat | Seuls ZH/BM suspendent ; ZH ne clôt pas | Conforme testé |
| Décision qualité | Console › 5 (domaine Qualité) | idem | QFS seul | Décision | Selon besoin | Rôle `QA / Lab` seul | Conforme (droits) ; quarantaine WMS existante inchangée |
| BEV signé avant sortie | Console › 4 | `rt_sop_bev`, `rt_sop_bev_lots` | UH + RT + prestataire | BEV scanné | Chaque remise | Plafond stock, preuve, verrou expédition | Conforme testé |
| Transport et GRN | Procurement + WMS existants | `rt_sop_bev_grn_v` | Magasin / usine | GRN émis | Chaque réception | GRN `EMIS` seul, écart sans imputation | Conforme testé |
| Carte sacherie RT | Situation du RT | `rt_sop_jute_card_v` (registre canonique) | Lecture | Mouvements existants | Continue | Lecture seule | Conforme testé (S7) |
| Circuits logistiques par cluster | Procurement existant | `wms_warehouses` | Logistique | n/a | n/a | Aucun circuit forcé | **Non vérifiable** : configuration non fournie |

## G. Plan de déploiement

**Prérequis bloquants**

1. Créer un vrai compte Finance (et Finance Manager si besoin). Ne jamais prêter le rôle au BM.
2. Décider si `Supervisor` doit voir tous les RT (aujourd'hui oui).
3. Fixer la fréquence du contrôle ZH (14 jours par défaut dans la vue).
4. Fusion de la PR #311 elle-même : ces corrections en dépendent.

**Étapes**

| # | Étape | Qui | Contrôle |
|---|---|---|---|
| 1 | Sauvegarde complète (base + Storage) | SI | Restauration testée |
| 2 | Projet ou branche Supabase de staging, **schéma complet** de production | SI | Toutes les migrations passent |
| 3 | Appliquer `20261112180000`, `181000`, `182000` (PR #311) puis `190000` | SI | Aucune erreur |
| 4 | Rejouer `tests/replica-prod/10_simulations_sop.sql` et `20_concurrence.sh` sur staging | SI | 19/19 PASS |
| 5 | Tester les flux réels non simulés : `offline_sync_batch`, achats par l'APK, création d'expédition par Procurement, Storage `rt-sop-evidence` | SI + UH test | Aucun blocage inattendu |
| 6 | Recette métier : 2 RT fictifs sur 2 circuits, Finance, ZH, QFS | BM, Finance, ZH, QFS | Signatures papier scannées |
| 7 | Formation (guide F) | BM | Présence |
| 8 | Production, hors heures d'achat | SI | Empreinte de schéma = staging |
| 9 | Surveillance 7 jours | BM | Anomalies, refus serveur |

**Points de compatibilité**

- **APK** : la file hors connexion refuse désormais une opération sans agent identifié. Le service worker `sw.js` met `shared/offline-field.js` en cache : il faut relever sa version de cache (fichier interdit aux agents, à faire par un humain) et publier une mise à jour web de l'APK.
- **Campagne réelle `0002`** : dès l'étape 8, toute avance passe par Finance + RT, tout achat est plafonné aux fonds confirmés, toute sortie village exige un BEV. Les écrans anciens qui saisissaient une avance directe seront refusés : **c'est voulu**, mais à annoncer.
- **CI** : `.github/` est interdit aux agents. Ajouter à la main un job qui lance `tests/replica-prod/run.sh` sur PostgreSQL 17.

**Retour arrière**

`supabase/rollback/20261112190000_rt_sop_conformite_corrections_down.sql` restaure exactement l'état de la PR #311 (empreinte vérifiée identique). Il refuse de s'exécuter si les nouveaux registres contiennent des données, sauf décision écrite (`set rt_sop.force_rollback='on'`) après sauvegarde.

## H. Rapport final de décision

**Corrigé et testé (réplique fidèle)** : D1 à D16, D18. Quatre défauts métier graves étaient présents dans la PR #311 : sortie de noix sans BEV (D1), GRN annulé accepté (D2), restitution excessive (D5), achat validé modifiable (D14) ; plus le dépassement concurrent hors campagne réelle (D13) et l'avance modifiable (D7).

**Déjà conforme, conservé** : idempotence et anti-doublon, séparation des campagnes, garde Assistant UH, cloisonnement par cluster des UH, versions de signature, pas d'API Wave inventée.

**Partiellement corrigé** : téléphone partagé (corrigé dans le code, non testé sur APK) ; rapprochement Finance au relevé Wave (calcul fourni, rapprochement externe) ; personnes et lots du BEV (complément facultatif, une seule fois).

**Non testé** : Supabase de staging réel, Storage réel, APK Android et iPhone, `offline_sync_batch`, déclencheurs non financiers des achats, impression/scan réels.

**Bloqué** : workflow Finance en production (aucun compte Finance) ; circuits logistiques par cluster (configuration non fournie).

**Nécessite une autorisation de production** : migrations, création de comptes Finance, changement de version du service worker, publication APK, fusion des PR.

**Conflit de consignes signalé** : `CLAUDE.md` interdit aux agents de modifier `supabase/**`. Le mandat autorise à « préparer des migrations versionnées ». Les migrations sont donc préparées **sur branche uniquement**, jamais appliquées ; la liste d'exclusion du dépôt impose de toute façon une revue humaine.

**Avis** : la branche est **prête pour un staging**, pas pour la production. Le premier geste utile n'est pas technique : créer le compte Finance réel, sans lequel aucun franc ne peut être confirmé.
