# PHASE 0 — Audit Sacherie V2 (avant tout codage)

Date : 11/08/2026
Branche : `claude/fbms-sacherie-v2-5q6aq3`
Références : *Cahier des charges FBMS — Module Sacherie V2 V0.1* et *MVP FBMS — Module Sacherie V2 V0.1* (AFLP-SOP-006 V0.9)
Portée de l'audit : `terrain/sacs.html`, `shared/anagroci-sacs-guards.js`, `shared/auth-gate.js`,
`shared/anagroci-audit.js`, `terrain/command.html`, `terrain/cash.html`, `terrain/achats.html`,
`supabase/sacs.sql`, `supabase/sacs_documents.sql`, `supabase/cash.sql`, `supabase/achats.sql`, `supabase/rls.sql`.

**Aucune ligne de code applicatif n'a été modifiée à ce stade.** Ce document est le seul livrable de la Phase 0.

---

## 0. Méthode et limites de l'audit

Ce qui a été fait :

- lecture intégrale des deux documents de référence ;
- lecture ligne à ligne des fichiers listés ci-dessus ;
- exécution des portes qualité existantes du dépôt, à titre de référence avant travaux.

```
node .github/scripts/verifier-js.mjs     → 46 fichiers · 1 erreur héritée (shared/alis-hardening.js) · 0 nouvelle
node .github/scripts/verifier-html.mjs   → 18 pages · 3 écarts historiques · 0 nouveau · 2 remarques
node .github/scripts/verifier-liens.mjs  → 18 pages · 4 liens cassés hérités · 0 nouveau
```

Ce qui **n'a pas** été fait, et qu'il ne faut pas croire fait :

| Limite | Conséquence |
|---|---|
| Aucune page ouverte dans un navigateur | Aucun comportement d'écran n'est ici « vérifié » au sens du CLAUDE.md §5.2. Les constats sont des constats de code. |
| Aucun accès à la base Supabase de production | Le schéma réel peut différer du dépôt (voir §9, contrainte C4). Les colonnes, triggers et policies réellement déployés ne sont pas prouvés. |
| Aucun compte de test | Les tests T01–T12 ne sont aujourd'hui **pas exécutables** : toutes les pages sont derrière `auth-gate.js`. Voir §11, décision D4. |

---

## 1. Ce que fait réellement le module aujourd'hui

`terrain/sacs.html` est un **registre de mouvements**, pas un système de contrôle. Constats factuels :

1. **Un seul geste utilisateur** : un formulaire « Nouveau mouvement » qui écrit directement dans la file locale
   puis dans `sacs_mouvements`. Il n'existe ni demande, ni approbation, ni exécution séparée.
   `saveMov()` (`terrain/sacs.html:40`) crée le mouvement et appelle `syncAll()` dans la foulée.
2. **8 types de mouvement** (`terrain/sacs.html:24`) : `USINE_CLUSTER`, `DOTATION_RT`, `DISTRIBUTION`,
   `ENLEVEMENT`, `RETOUR_PROD`, `RETOUR_RT`, `DECHIRE_RT`, `DECHIRE_PROD`.
3. **Les soldes sont calculés, jamais stockés** : `saldos()` (`terrain/sacs.html:35`) reconstruit les soldes
   RT / producteur / cluster à partir de la somme des mouvements (`destination` = +, `source` = −).
   C'est un choix sain qu'il faut **conserver**.
4. **Le blocage du stock négatif est purement navigateur** : `validateMove()` (`terrain/sacs.html:39`) et
   `validateMovement()` (`shared/anagroci-sacs-guards.js:39`). `supabase/sacs.sql` ne contient
   **aucune contrainte, aucun trigger, aucune fonction** empêchant un solde négatif.
5. **Le garde métier est correctement branché** : `auth-gate.js` injecte `anagroci-sacs-guards.js` uniquement
   si `data-module="sacs"`, et le garde enveloppe `saveMov` et remplace `syncAll`. Ce mécanisme fonctionne et
   doit être réutilisé, pas contourné.
6. **L'idempotence hors ligne fonctionne** : `upsert(..., {onConflict:'local_id', ignoreDuplicates:true})`
   sur `local_id` unique. À préserver strictement.
7. **RLS actuelle de `sacs_mouvements`** (`supabase/sacs.sql:45-48`) :
   lecture = tout profil actif ; **insertion = tout profil actif** ; update/delete = Branch Manager.
   Autrement dit : *n'importe quel agent actif peut aujourd'hui enregistrer une dotation RT de 500 sacs,
   côté serveur, sans que rien ne s'y oppose.*

### 1.1 Trois défauts non documentés, découverts pendant l'audit

Ils ne figurent pas dans les documents de référence et ils ont un impact direct sur le MVP.

| # | Constat | Preuve | Effet |
|---|---|---|---|
| **A** | **L'état du sac n'est jamais envoyé au serveur.** `etat_sac` est saisi dans le formulaire puis **supprimé du payload** avant l'upsert. Aucune colonne `etat_sac` n'existe dans `sacs_mouvements`. | `terrain/sacs.html:44` et `shared/anagroci-sacs-guards.js:37` (`cleanPayload`), `supabase/sacs.sql:12-31` | L'information VIDE/PLEIN/DÉCHIRÉ n'existe que sur le téléphone qui a saisi, et disparaît quand la file locale est purgée (`MAX_SYNCED=500`). **La V2 ne peut pas s'appuyer sur l'existant pour `bag_state`.** |
| **B** | **Les photos ne quittent jamais l'appareil, et leur perte est silencieuse.** Les images sont stockées en base64 dans `localStorage` (`anagroci_sacs_docs`). `store()` avale l'exception : `catch(e){}`. `delDoc()` est défini mais **jamais appelé** — rien ne purge jamais les images. | `terrain/sacs.html:26` (`store`), `:27` (`setDoc`/`delDoc`), `:38` (compression 1280 px / q0.8) | À ~150–300 Ko par photo, le quota `localStorage` (5–10 Mo) est atteint vers 30–50 photos. Ensuite, **l'agent voit « enregistré » et la preuve n'existe pas**. Rendre la photo obligatoire pour REBUT sans passer par Storage transformerait ce défaut en perte de preuve réglementaire. |
| **C** | **`loadRef()` charge toute la table** : `SB.from("sacs_mouvements").select("*")` sans filtre ni limite, à chaque authentification et après chaque synchronisation. | `terrain/sacs.html:30` | Tenable aujourd'hui, intenable après une campagne. À traiter en P2, mais à ne pas aggraver en V2. |

---

## 2. Matrice d'écarts — exigences MVP vs existant

Priorités : **P0** = indispensable avant pilote · **P1** = avant déploiement large · **P2** = ultérieur.

| # | Exigence MVP | Existant | Écart | Risque | Modification requise | Fichier concerné | Prio |
|---|---|---|---|---|---|---|---|
| 1 | **MVP-BR-01** Aucune sortie sans approval BM | Aucune notion de demande ni d'approbation. Insertion directe autorisée à tout profil actif | **Total** | Le risque même que le SOP-006 vise : sacs remis puis régularisés après coup | Table `bag_movement_requests` + statuts métier + exécution liée à une demande APPROVED | `supabase/sacherie_v2.sql` (nouveau), `terrain/sacs.html`, `terrain/command.html` | **P0** |
| 2 | **MVP-BR-04** Plafond = ⌊(stock RCN + volume financé restant) × 1,10 ÷ 80⌋ | Aucun calcul. Seuls des seuils fixes cosmétiques : alerte si solde RT > 50, producteur > 10, cluster < 20 (`sacs.html:41-42`) | **Total, et les deux entrées manquent** (voir §5) | Le UH calcule de tête ; aucun contrôle possible | Fonction SQL `sacherie_plafond(rt_id)` + vues d'appui ; affichage temps réel | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P0** |
| 3 | **MVP-BR-05** Déduction des sacs déjà détenus | `saldos()` calcule déjà le solde RT — **réutilisable tel quel** | Partiel : le solde existe, mais ne distingue pas les sacs *utilisables* des REBUT/pleins | Plafond faussé à la hausse si les REBUT sont comptés comme utilisables | Vue SQL `v_sacs_solde_rt` ventilée par `bag_state` | `supabase/sacherie_v2.sql` | **P0** |
| 4 | **MVP-BR-03** La marge de 10 % ne se cumule jamais | Sans objet (pas de marge) | Total | Un refinancement doublerait la dotation autorisée | Le plafond se calcule sur le **volume financé restant total**, jamais par tranche ; règle portée par la fonction SQL, pas par le navigateur | `supabase/sacherie_v2.sql` | **P0** |
| 5 | **MVP-BR-06** Bag Movement ID unique et non réutilisable | Aucun identifiant métier. Seul `local_id` (UUID technique) existe | Total | Impossible de reconstruire l'histoire d'un mouvement (US-08) | Colonne `bag_movement_code` + **index unique** + séquence par branche/année (`BAG-2027-BEO-000125`) | `supabase/sacherie_v2.sql` | **P0** |
| 6 | **MVP-BR-07** Remise partielle : le reliquat est annulé | Aucune notion d'approuvé vs exécuté | Total | Réutilisation du reliquat = sortie non autorisée | `approved_qty` / `executed_qty` + **index unique sur `request_id`** (une demande = au plus une exécution) + statut `PARTIALLY_EXECUTED` | `supabase/sacherie_v2.sql` | **P0** |
| 7 | **MVP-BR-09** Lot ID obligatoire si sac PLEIN | Ni `lot_id`, ni `bag_state` côté serveur (défaut A) | Total | Sacs pleins non traçables jusqu'à l'usine | Colonnes `bag_state` + `lot_id` ; contrainte `check` : `bag_state='FULL' ⇒ lot_id not null` | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P0** |
| 8 | **Contrôles serveur P0** (MVP §5.3) : stock, approval, quantité, unicité | **Aucun**. Tout est dans le navigateur | Total | Un `curl` avec le jeton d'un agent contourne 100 % des règles | Triggers `before insert/update` + contraintes + RLS par rôle | `supabase/sacherie_v2.sql` | **P0** |
| 9 | **Seul le BM approuve** (RLS) | `est_bm()` existe et est strict (`role = 'Branch Manager'`) — **réutilisable** | La colonne de statut à protéger n'existe pas encore | Auto-approbation par un UH | Policy `update` réservée à `est_bm()` sur les colonnes d'approbation ; RPC `approuver_demande_sacs()` | `supabase/sacherie_v2.sql` | **P0** |
| 10 | **Séparation statut métier / statut technique** | Statuts techniques `pending/syncing/synced/failed` corrects et robustes — **à conserver** | Aucun statut métier | Confusion « enregistré » = « autorisé » | Colonne `business_status` distincte de `_status` (qui reste local, jamais envoyé) | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P0** |
| 11 | **Rôles MVP** : UH, Warehouse Keeper, Assistant UH, RT, Logistics Coordinator, Zonal Head | **Aucun de ces rôles n'existe.** Les 7 rôles FBMS sont : Branch Manager, Assistant Branch Manager, Head of Field, Procurement Officer, Supervisor, Agent Recenseur, Consultation uniquement | **Total, et bloquant** | Sans rôles, la RLS « le magasinier exécute, le UH ne peut pas » est inécrivable | Décision D1 (§11) : ajouter les rôles ou établir une table de correspondance | `shared/auth-gate.js`, `shared/admin.html`, `supabase/rls.sql` — **tous trois interdits aux agents** | **P0 — décision requise** |
| 12 | **Périmètre par cluster** (« son cluster », « son périmètre ») | `profils` ne porte **ni cluster ni zone** (`supabase/rls.sql:20`, `shared/admin.html`) | Total | La RLS ne peut pas restreindre un UH à son cluster | Colonne additive `profils.cluster` + `profils.zone` | `supabase/rls.sql` (interdit aux agents) | **P0 — décision requise** |
| 13 | **Volume financé restant en kg** | `avances` ne contient qu'un `montant` FCFA. Ni `cycle_id`, ni `volume_finance_kg`, ni `prix_reference_kg`. Aucune conversion `/400` n'existe dans le code (bonne nouvelle) | Total | Sans kg, pas de plafond. C'est l'entrée n°1 de BR-04 | Colonnes additives sur `avances` + saisie dans `terrain/cash.html` | `supabase/sacherie_v2.sql`, `terrain/cash.html` | **P0** |
| 14 | **Stock RCN sous responsabilité du RT (kg)** | `achats.poids_net` existe par RT. **Mais rien n'enregistre l'évacuation du RCN du RT vers le cluster/l'usine** côté terrain | Total | Entrée n°2 de BR-04 manquante ; sans sortie, le stock RCN ne décroît jamais et le plafond gonfle indéfiniment | Vue `v_rcn_stock_rt` + hypothèse documentée (§11, D2) | `supabase/sacherie_v2.sql` | **P0** |
| 15 | **Confirmation de réception par le RT** (`received_by/at`) | Aucune. Un seul acteur saisit tout | Total | La chaîne de garde n'existe pas | Colonnes `issued_by/at`, `received_by/at` + écran de confirmation | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P1** |
| 16 | **Réconciliation journalière PASS/HOLD/FAIL** | Aucune pour les sacs. `reconciliations` existe mais concerne **le cash**, avec un autre schéma | Total | Écart physique jamais détecté | Table `bag_reconciliations` (ne pas réutiliser `reconciliations`) | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P1** |
| 17 | **REBUT tracé (quantité + motif + photo)** | Approchant : types `DECHIRE_RT` / `DECHIRE_PROD` exigent déjà observation + photo (`sacs.html:39`) — **à conserver et étendre** | États REBUT/RÉPARATION/TRANSFERT absents ; photo locale seulement (défaut B) | Sacs endommagés sortis du stock sans traitement final | `bag_state` = `REBUT` + `rebut_statut` + preuve Storage | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P1** |
| 18 | **Preuves dans Supabase Storage** (`bag-evidence`) | `localStorage` uniquement. `supabase/sacs_documents.sql` prépare une colonne `document` (data URI) — **piste à ne pas suivre** (volumétrie) | Total, avec perte silencieuse (défaut B) | Preuve réglementaire perdue sans avertissement | Bucket `bag-evidence` + `document_url`, `document_hash`, `uploaded_by`, `uploaded_at` | `supabase/sacherie_v2.sql`, `terrain/sacs.html` | **P1** |
| 19 | **Inbox Approval BM dans le Command Center** | `command.html` lit `sacs_mouvements` et affiche « Sacs en main RT ». Aucune file d'approbation | Total | Le BM n'a aucun endroit où approuver | Panneau « Approbations Sacherie » + KPI `PENDING_BM` / `HOLD` | `terrain/command.html` | **P1** |
| 20 | **Écrans MVP** : Demandes / À remettre / Réconciliation / Soldes / REBUT / Historique | 3 onglets : Nouveau mouvement / Soldes / Historique | Partiel : 2 des 6 onglets existent et sont bons | Le workflow guidé n'existe pas | Extension de la barre d'onglets existante (`setTab`), pas de réécriture | `terrain/sacs.html` | **P1** |
| 21 | **Audit minimum** (`request_created`, `request_approved`, …) | `ANAGROCI_AUDIT.log()` fonctionne et écrit dans `audit_log` — **réutilisable tel quel** | Les 6 événements Sacherie ne sont pas émis | Piste d'audit incomplète | Appels `log()` aux points du workflow | `terrain/sacs.html`, `terrain/command.html` | **P1** |
| 22 | **Hors ligne : `DRAFT_LOCAL`, pas d'approval local** | File locale robuste (`normalizeQueue`, reprise des `syncing` orphelins) — **socle solide à conserver** | Rien n'empêche de présenter un enregistrement local comme autorisé | Un agent croit avoir le droit de remettre | Statut local explicite + refus d'exécution sans preuve d'approval synchronisée | `shared/anagroci-sacs-guards.js`, `terrain/sacs.html` | **P0** |
| 23 | **Validité de l'approval (24 h)** — MVP §8.3 | Sans objet | Total | Approval dormant réutilisé plus tard | Colonne `expires_at` + contrôle serveur à l'exécution | `supabase/sacherie_v2.sql` | **P1** |
| 24 | **Chaîne Achat → RT → Lot ID → sacs pleins** | `achats` porte `poids_net`, `nb_sacs`, `rt_id`. Aucun `lot_id` | Partiel | Traçabilité rompue entre achat et évacuation | `achats.lot_id` additif, alimenté plus tard | `supabase/sacherie_v2.sql`, `terrain/achats.html` | **P2** |
| 25 | **Aucun effacement, correction par mouvement correctif** | `delete` déjà réservé au BM par la RLS — **base correcte** | Pas de `correction_of`, et le BM peut encore supprimer | Effacement d'un mouvement exécuté | `correction_of` + interdiction de `delete` sur les lignes exécutées | `supabase/sacherie_v2.sql` | **P1** |

---

## 3. Synthèse par priorité

**P0 — sans quoi le pilote n'a pas de sens** (lignes 1–14, 22)
Modèle de données de la demande, calcul serveur du plafond, unicité du Bag Movement ID, remise partielle,
Lot ID sur les sacs pleins, contrôles serveur, séparation statut métier / technique, règle hors ligne,
**et les deux décisions bloquantes : les rôles (ligne 11) et les deux entrées kg du plafond (lignes 13–14).**

**P1 — avant déploiement large** (15–21, 23, 25)
Confirmation RT, réconciliation, REBUT, Storage, Inbox BM, onglets, audit, expiration, correctifs.

**P2 — ultérieur** (24, défaut C)
Chaîne Lot ID côté Achats, pagination du chargement de l'historique.

---

## 4. Fonctions existantes réutilisables — à ne pas réécrire

| Élément | Où | Pourquoi le garder |
|---|---|---|
| `saldos()` / `balanceMaps()` | `sacs.html:35`, `guards.js:30` | Modèle « solde = somme des mouvements » correct et éprouvé. La V2 le ventile par `bag_state`, elle ne le remplace pas. |
| `normalizeQueue()` / `pendingMap()` | `guards.js:35-36` | Reprise des `syncing` orphelins, `device_id`, tri chronologique. C'est du travail déjà fait et difficile à refaire aussi bien. |
| `cleanPayload()` | `guards.js:37` | Le bon point d'entrée pour n'envoyer au serveur que les champs qui existent. **Toute nouvelle colonne devra être retirée de sa liste d'exclusion** (piège n°1 de la V2 — voir §6). |
| `upsert(onConflict:'local_id')` | `sacs.html:45`, `guards.js:65` | Idempotence hors ligne. À reproduire à l'identique pour les nouvelles tables. |
| `est_bm()`, `est_actif()`, `mon_role()` | `rls.sql:26-40` | `SECURITY DEFINER`, déjà utilisées partout. Base directe des policies d'approbation. |
| `ANAGROCI_AUDIT.log()` | `anagroci-audit.js:22` | Journal d'audit fonctionnel vers `audit_log`. |
| Mécanisme d'injection du garde | `auth-gate.js` (`injectModuleGuards`) | Permet d'ajouter la logique V2 **hors** de `sacs.html`, donc sans risque pour l'existant. |
| `setTab()` + barre d'onglets | `sacs.html:28` | Les 6 onglets cibles s'ajoutent à ce mécanisme. |
| Compression d'image `compressImg()` | `sacs.html:38` | 1280 px / q0.8 : bon compromis terrain. À conserver, en changeant seulement la destination (Storage au lieu de `localStorage`). |
| Contrôles preuve obligatoire (`t.proof`) | `sacs.html:39` | Le motif + photo obligatoires pour déchiré/perdu existent déjà : c'est la moitié de la règle REBUT. |

---

## 5. Le point dur : les deux entrées du plafond n'existent pas

`Plafond = ⌊(stock RCN sous responsabilité + volume financé restant) × 1,10 ÷ 80⌋`

| Entrée | État réel | Conséquence |
|---|---|---|
| **Volume financé restant (kg)** | `avances.montant` est en **FCFA uniquement**. Aucun `volume_finance_kg`, aucun `prix_reference_kg`, aucun `cycle_id`. | Le cahier des charges (§16.1) et votre consigne §13 interdisent explicitement `montant / 400`. **Il n'existe donc aujourd'hui aucun moyen légitime d'obtenir ce chiffre.** Il doit être saisi. |
| **Stock RCN sous responsabilité (kg)** | `achats.poids_net` donne le RCN acheté par RT. **Rien n'enregistre la sortie** de ce RCN vers le cluster ou l'usine côté terrain (`rcntrace` traite les réceptions usine, pas les évacuations RT). | Un cumul d'achats sans sortie fait croître le stock indéfiniment, donc le plafond aussi. **Utiliser `Σ poids_net` tel quel serait pire que ne rien calculer.** |

Sans décision sur ces deux points, la règle métier centrale du MVP (BR-04) reste déclarative.
Deux décisions sont demandées en §11 (D2 et D3).

---

## 6. Risques de régression identifiés

| # | Risque | Mécanisme | Parade prévue |
|---|---|---|---|
| R1 | **Colonnes silencieusement effacées** | `cleanPayload()` supprime une liste fixe de champs. Le champ `etat_sac` est perdu **exactement de cette façon** depuis l'origine (défaut A). Ajouter `bag_state`/`lot_id` sans toucher aux deux `cleanPayload` reproduirait le bug à l'identique. | Traiter les deux `cleanPayload` (`sacs.html:44` **et** `guards.js:37`) comme un seul point de vérité ; test d'acceptation dédié. |
| R2 | **Casser la synchronisation en envoyant une colonne inexistante** | PostgREST rejette la ligne entière si une colonne du payload n'existe pas. Le correctif #147 du dépôt corrige précisément ce type d'incident. | **Migration SQL exécutée AVANT tout déploiement du frontend.** Ordre non négociable (§ procédure de déploiement, Phase 1). |
| R3 | **Rupture du chargement du module** | `sacs.html` est un fichier unique servi tel quel : une accolade en trop rend la page inerte, sans build pour l'attraper (cf. `alis-hardening.js`). | Toute logique V2 nouvelle placée dans un fichier séparé injecté par le garde ; `verifier-js.mjs` + `verifier-html.mjs` après chaque incrément. |
| R4 | **Blocage des utilisateurs légitimes par la RLS** | Une policy d'approbation trop stricte, ou des rôles inexistants dans `profils`, ferme le module à tout le monde. | Policies additives ; aucun `drop policy` sur l'existant ; recette RLS par rôle avant bascule. |
| R5 | **Perte de l'historique** | Toute reconstruction de `sacs_mouvements` détruirait les données de campagne. | **Aucun `drop`, aucun `alter column type`.** Uniquement `add column if not exists`. Les anciennes lignes gardent `business_status` nul = « historique V1 » (test T12). |
| R6 | **Quota `localStorage` saturé** | Défaut B. Rendre la photo obligatoire pour REBUT accélère la saturation, et `store()` échoue en silence. | Storage avant d'imposer la photo. Si Storage n'est pas prêt, rendre l'échec d'écriture **visible** au lieu de l'avaler. |
| R7 | **Divergence UI / RLS sur « BM »** | `auth-gate.js` classe ABM, Head of Field et Procurement Officer au niveau `bm` et leur ouvre le Command Center, alors que `est_bm()` n'accepte **que** `Branch Manager`. Ces utilisateurs verraient les boutons d'approbation et recevraient un refus serveur. | Boutons d'approbation conditionnés à `role === 'Branch Manager'`, pas au niveau `bm`. |
| R8 | **Rejet différé d'une demande créée hors ligne** | Le plafond sera recalculé côté serveur au moment de la synchronisation : une demande valide au moment de la saisie peut devenir non conforme. | C'est le comportement correct (l'autorité est le serveur), mais il exige un message terrain clair et un statut lisible, pas un `failed` muet. |

---

## 7. Dépendances entre modules

```
                    ┌──────────────┐
   volume financé   │    CASH      │  avances.montant (FCFA)  ── manque volume_finance_kg
   (kg, cycle)      │ terrain/cash │
                    └──────┬───────┘
                           │ (D3)
┌──────────────┐    ┌──────▼───────┐    ┌────────────────┐
│   ACHATS     │───▶│  SACHERIE V2 │───▶│ COMMAND CENTER │
│ poids_net    │    │ demande      │    │ Inbox approval │
│ nb_sacs, RT  │    │ approval BM  │    │ KPI PENDING_BM │
│ (manque lot) │    │ exécution    │    │ HOLD / REBUT   │
└──────────────┘    └──────┬───────┘    └────────────────┘
      (D2)                 │
                    ┌──────▼───────┐
                    │  RÉFÉRENTIEL │  villages / rt / producteurs (inchangé)
                    └──────────────┘
```

- **Sacherie → Command Center** : `command.html` agrège déjà `sacs_mouvements` par RT et cluster.
  Ajouter un panneau ne casse rien ; en revanche `command.html` interroge des colonnes nommées explicitement
  (`q("sacs_mouvements", "type,source,...")`) — la liste devra inclure les nouvelles colonnes.
- **Sacherie → Cash** : dépendance **entrante** et bloquante (volume financé kg).
- **Sacherie → Achats** : dépendance sortante, non bloquante pour le MVP (Lot ID, P2).
- **Sacherie → RCN Trace** : `rcn_lots` (`RCN-AAAAMMJJ-SEQ`) est un lot **usine**, issu des réceptions camions.
  Ce **n'est pas** le Lot ID terrain du SOP-006. Ne pas coupler les deux : réutiliser la convention de
  nommage, pas la table.

---

## 8. Incohérences frontend / backend constatées

| # | Incohérence | Effet |
|---|---|---|
| I1 | `etat_sac` et `proof_required` saisis côté client, exclus du payload, absents du schéma | Défaut A. Information perdue. |
| I2 | `guards.js` sait traduire un message serveur « stock sacs insuffisant » (`guards.js:23`) alors qu'**aucun trigger du dépôt ne produit ce message** | Soit un trigger existe en base sans être versionné (dette invisible), soit le code anticipe une protection qui n'a jamais été écrite. **À vérifier en base avant la Phase 2.** |
| I3 | `supabase/sacs_documents.sql` prépare une colonne `document` (data URI) que le frontend n'alimente pas | Chemin mort. Le cahier des charges §19 tranche pour Storage : ne pas activer cette colonne. |
| I4 | `sacs.html` déclare `SUPABASE_URL`/`SUPABASE_ANON` en local alors que `auth-gate.js` publie déjà `window.ANAGROCI_SUPABASE_*` | Duplication de la clé publique à trois endroits. Sans gravité (clé publique, la sécurité vient de la RLS), mais à ne pas multiplier. |
| I5 | `delDoc()` et `EXP` sont morts dans `sacs.html` | Aucune purge des images ; symptôme du défaut B. |
| I6 | RLS `sacs_upd` réservée au BM, alors que le workflow V2 exige que le **magasinier** écrive `executed_qty` et le **RT** `received_at` | La policy actuelle bloquerait le workflow cible. Il faudra des policies par colonne/par RPC, pas un simple assouplissement. |

---

## 9. Contraintes Supabase à respecter

| # | Contrainte | Conséquence sur le plan |
|---|---|---|
| C1 | La clé publique est visible dans les pages (`SECURITE.md`) | Toute règle P0 **doit** être serveur. Le JS ne fait qu'expliquer un refus, il ne le crée pas. |
| C2 | Le frontend n'a que PostgREST et RPC | Les règles multi-lignes (plafond, unicité, remise partielle) passent par **triggers** + **contraintes** + **fonctions `SECURITY DEFINER`**, pas par de la logique applicative. |
| C3 | Les triggers doivent tolérer l'upsert idempotent | `on conflict do nothing` ne doit **jamais** transformer un rejeu hors ligne en erreur bloquante (T09). |
| C4 | Le schéma réel n'est pas prouvé par le dépôt | `profils` et `audit_log` sont créés hors dépôt. **Toute migration doit être idempotente** (`if not exists`, `create or replace`) et vérifiée avant exécution. |
| C5 | Aucune migration n'est appliquée automatiquement | Les fichiers `supabase/*.sql` sont exécutés **à la main** dans l'éditeur SQL. Le déploiement frontend doit donc être **postérieur et manuel** (risque R2). |
| C6 | `sacs_mouvements.rt_id` est `text`, `rt.id` est un uuid côté référentiel | Les jointures des vues de solde doivent gérer les deux formes (id ou clé normalisée), comme le fait déjà `saldos()`. |

---

## 10. Contradictions entre les documents et le code — signalées comme demandé

| # | Contradiction | Arbitrage proposé (§18 : solution la plus sûre et la plus restrictive) |
|---|---|---|
| X1 | **Le code n'est pas la vérité métier** : `sacs.html` autorise une dotation RT immédiate, ce que le SOP-006 interdit | Le MVP prime. La dotation directe devient une **demande**. Le type `DOTATION_RT` actuel est conservé pour l'historique mais ne sera plus créable sans demande approuvée. |
| X2 | `PARTIALLY_EXECUTED` figure au cahier des charges §6 et dans votre consigne §5.I, mais **pas** dans la liste MVP §5.1 | Retenu (union des trois sources). Sans lui, on ne distingue pas une remise partielle d'une remise complète. |
| X3 | Sac PLEIN sans Lot ID : cahier T6 dit **HOLD**, MVP T06 dit « HOLD / blocage », votre consigne dit « HOLD/STOP » | **STOP serveur** sur toute *nouvelle* exécution FULL sans `lot_id` ; **HOLD** réservé aux lignes historiques et aux écarts de réconciliation. Le plus restrictif pour les nouvelles données, sans casser l'existant. |
| X4 | Votre consigne §5.H demande le workflow `REBUT → RÉPARATION → UTILISABLE` ; le MVP §1.3 classe « workflow complet de réparation avec prestataire » **hors MVP** | Les **états** et leurs transitions sont implémentés (traçabilité) ; la gestion du prestataire ne l'est pas. |
| X5 | Votre consigne §3 demande de préserver « la prévention des stocks négatifs » comme un acquis | Elle n'est acquise que dans le navigateur. Le cahier §2 dit d'ailleurs « conserver **et renforcer côté serveur** ». La V2 la crée réellement côté serveur. |
| X6 | `reconciliations` existe déjà — mais pour le cash | Ne pas réutiliser cette table. Créer `bag_reconciliations`, comme le prescrit le cahier §15.3. |

---

## 11. Décisions qui vous appartiennent (bloquantes avant la Phase 2)

Je ne peux pas les trancher seul : elles touchent la délégation d'autorité, la définition des rôles et la
politique de modification du dépôt.

**D1 — Rôles (bloque les lignes 11 et 12 de la matrice).**
Les rôles *Unit Head*, *Warehouse Keeper*, *Assistant UH*, *RT*, *Logistics Coordinator*, *Zonal Head*
n'existent nulle part dans FBMS. Deux options :
&nbsp;&nbsp;**(a)** Ajouter ces rôles à `profils` / `admin.html` / `auth-gate.js` — propre, mais ces trois fichiers
sont **explicitement interdits aux agents** (CLAUDE.md §3). Il faudrait votre accord et une relecture humaine.
&nbsp;&nbsp;**(b)** Établir une correspondance sans toucher à l'authentification : `Supervisor` → UH,
`Agent Recenseur` → Warehouse Keeper/Assistant, `Branch Manager` → BM.
Plus rapide, mais moins fidèle au SOP, et la traçabilité nommera un rôle qui n'est pas celui du terrain.
&nbsp;&nbsp;*Ma recommandation :* **(a)**, parce que le SOP-006 et FBMS doivent « raconter la même histoire »
(cahier, règle finale de conception), et parce qu'une correspondance approximative dans un journal d'audit
est une faiblesse de contrôle interne, pas un raccourci technique.

**D2 — Stock RCN sous responsabilité du RT.**
Aucune sortie de RCN n'est enregistrée côté terrain. Trois options :
&nbsp;&nbsp;**(a)** Saisie manuelle par le UH au moment de la demande, avec traçabilité de qui a saisi.
&nbsp;&nbsp;**(b)** `Σ achats.poids_net` du RT sur le cycle, **moins** les enlèvements — mais les enlèvements
ne sont pas enregistrés en kg aujourd'hui.
&nbsp;&nbsp;**(c)** Considérer le stock RCN à 0 pour le MVP et ne compter que le volume financé
(c'est exactement l'exemple des deux documents : 2 000 kg, stock 0, plafond 27).
&nbsp;&nbsp;*Ma recommandation :* **(c) pour le pilote, avec champ saisissable optionnel (a)** — l'hypothèse la
plus restrictive : un stock RCN non prouvé ne gonfle pas le plafond.

**D3 — Volume financé en kg.**
Il faut l'ajouter (`cycle_id`, `volume_finance_kg`, `prix_reference_kg` sur `avances`) et **le faire saisir
dans `terrain/cash.html`**. Confirmez-vous que le module Cash peut évoluer, et **qui** saisit le kg ?
Sans cela, le plafond n'a pas d'entrée et le MVP-BR-04 reste sur le papier.

**D4 — Comment recetter T01–T12 ?**
Tout est derrière `auth-gate.js` et il n'existe aucune suite de tests dans ce dépôt. Trois options :
&nbsp;&nbsp;**(a)** Un harnais Playwright hors ligne, avec Supabase simulé — prouve le frontend, pas la RLS.
&nbsp;&nbsp;**(b)** Un projet Supabase de test + comptes de recette — seule façon de prouver réellement
T03, T05, T08 et T11, qui sont des tests **serveur**.
&nbsp;&nbsp;**(c)** Un script SQL de recette exécuté par vous dans l'éditeur, avec sorties PASS/FAIL.
&nbsp;&nbsp;*Ma recommandation :* **(c) + (a)** — (c) prouve les règles serveur sans exiger un second projet
Supabase ; (a) prouve les écrans. Je ne déclarerai PASS que ce qui aura réellement été exécuté.

**D5 — Conflit de politique interne sur `supabase/**` (à trancher explicitement).**
`CLAUDE.md §3` interdit à tout agent de modifier `supabase/**`, et
`.github/agent-policy/auto-merge-denylist.txt` place `terrain/**`, `shared/*.js` et `*.html` hors
fusion automatique. Votre demande impose au contraire des migrations SQL et de la RLS.
&nbsp;&nbsp;*Ce que je propose, et que j'appliquerai sauf avis contraire :*
1. **Créer des fichiers SQL nouveaux** (`supabase/sacherie_v2.sql`, `supabase/sacherie_v2_rls.sql`,
   `supabase/sacherie_v2_tests.sql`) — sans jamais modifier `sacs.sql`, `rls.sql`, `cash.sql`, `achats.sql`.
2. **Ne jamais exécuter** quoi que ce soit contre votre base : vous exécutez, après lecture.
3. **Ne pas ouvrir de pull request avec fusion automatique** ; relecture humaine obligatoire.
4. Toute modification de `auth-gate.js` ou `admin.html` (option D1a) reste **suspendue à votre accord écrit**.

---

## 12. Ce que je propose pour la suite

La Phase 1 (plan d'implémentation détaillé : fichiers, migrations, fonctions, ordre, rollback) est prête à
être rédigée. Elle sera structurée autour de quatre principes issus de cet audit :

1. **Le serveur d'abord.** Aucune règle P0 ne sera écrite dans le navigateur seul (contrainte C1).
2. **Additif seulement.** `add column if not exists`, nouvelles tables, nouvelles policies. Aucun `drop`,
   aucun changement de type, aucune donnée touchée (risque R5, test T12).
3. **Hors de `sacs.html` autant que possible.** La logique V2 vit dans un fichier chargé par le garde,
   pour que le module actuel reste chargeable même si la V2 échoue (risque R3).
4. **Migration avant frontend.** Toujours (risque R2, contrainte C5).

Comme vous l'avez prévu, je m'arrête ici et n'écris aucune ligne de code applicatif. La suite naturelle est
de challenger cet audit — en particulier les décisions **D1 à D3**, sans lesquelles la règle métier centrale
du MVP (le plafond) ne peut être ni calculée, ni contrôlée.
