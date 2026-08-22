# 03 — Intégrité des données et concurrence

**Exécution** : 17 scénarios dans Chromium, chacun contrôlé **des deux côtés** — ce que l'écran
annonce à l'utilisateur, et ce que le backend détient réellement.
**Données brutes** : `tests/reports/donnees/02-integrite.json`
**Rejouer** : `node tests/e2e/02-integrite-donnees.mjs`

C'est le rapport le plus important de la campagne : il traite le seul type de défaut qui ne se
rattrape pas. Une lenteur se corrige la semaine suivante ; un achat de 100 000 FCFA effacé au
milieu d'une campagne de collecte ne se retrouve pas.

**Résultat : 10 conformes, 7 défauts, dont 1 BLOCKER.**

---

## 1. Tableau de synthèse

| ID | Scénario | Verdict | Gravité |
|---|---|---|---|
| T-INT-01 | Double-clic sur « Valider l'achat complet » | **conforme** | — |
| T-INT-02 | Deux achats portant le même numéro de reçu papier | **défaut** | HIGH |
| T-INT-03 | Réponse perdue après commit serveur, puis renvoi | **conforme** | — |
| T-INT-04 | Saturation du quota `localStorage` pendant une saisie | **défaut** | **BLOCKER** |
| T-INT-05 | File locale tronquée (écriture interrompue) | **défaut** | CRITICAL |
| T-INT-06 | Coupure réseau pendant la saisie, puis reconnexion | **conforme** | — |
| T-INT-07 | Fermeture de l'onglet pendant la synchronisation | **conforme** | — |
| T-INT-08 | Deux utilisateurs modifient le même village | **défaut** | CRITICAL |
| T-INT-09 | Fiche village incomplète (section `s9` absente) | **conforme** | — |
| T-INT-10 | Valeurs limites, caractères spéciaux, injection | **conforme** | — |
| T-INT-11 | Deux onglets du même compte en parallèle | **conforme** | — |
| T-INT-12 | Rechargement pendant la synchronisation | **conforme** | — |
| T-INT-13 | Le KOR saisi arrive-t-il en base ? | **conforme** | — |
| T-INT-14 | Où finit la photo du reçu ? | **défaut** | HIGH |
| T-INT-15 | Un brouillon sans reçu part-il en base ? | **défaut** | HIGH |
| T-INT-16 | Un refus serveur est-il visible à l'écran ? | **conforme** | — |
| T-INT-17 | Producteur choisi dans la liste des enrôlés | **défaut** | HIGH |

---

## 2. Ce qui tient — et qui mérite d'être dit

Avant les défauts : la chaîne d'écriture des achats est **bien conçue** sur le point le plus
difficile, l'idempotence. Cela n'a rien d'évident et cela mérite d'être constaté.

### T-INT-01 — Double-clic : aucun doublon

Deux clics simultanés sur « Valider l'achat complet ».
Résultat : **1 enregistrement en file locale, 1 sur le serveur**. Le second clic est refusé par
la validation métier (le formulaire est déjà vidé) — mécanisme fortuit plutôt que garde
explicite, mais efficace.
*Réserve* : le message affiché après le second clic est « Poids net invalide (brut − tare doit
être > 0) », déroutant pour un opérateur qui vient de valider correctement.

### T-INT-03 — Réponse perdue après écriture réussie : aucun doublon

Scénario le plus redouté sur réseau instable : le serveur enregistre, la réponse n'arrive
jamais, l'utilisateur renvoie.
Déroulement observé : la connexion est coupée après le commit → **1 ligne serveur**, l'achat
passe en `failed` côté client → renvoi → **toujours 1 ligne serveur**, statut `synced`.
Le mécanisme est explicite et correct : `local_id` généré par `crypto.randomUUID()`,
contrainte `local_id text unique` (`supabase/achats.sql:11`), envoi en
`on_conflict=local_id` avec `Prefer: resolution=ignore-duplicates`.

### T-INT-06 — Coupure réseau puis reconnexion : rien perdu, rien dupliqué

Saisie hors ligne → 1 en file locale, 0 sur le serveur. Retour du réseau → **1 sur le serveur**.

### T-INT-07 et T-INT-12 — Onglet fermé / page rechargée en pleine synchronisation

Onglet fermé pendant l'envoi : 1 ligne serveur, statut client `failed` ; à la réouverture,
reprise automatique et statut `synced`, **toujours 1 ligne**.
Rechargement en pleine synchronisation : **1 ligne serveur**, aucun enregistrement bloqué.

### T-INT-11 — Deux onglets du même compte

Deux saisies simultanées dans deux onglets partageant le même `localStorage` :
**les 2 achats survivent** et arrivent tous les deux en base. La file n'est pas écrasée.

### T-INT-16 — Un refus serveur est visible

Refus RLS forcé (HTTP 403) : l'achat passe en `failed`, l'erreur est mémorisée, le compteur
« en attente » passe à 1 et un lien « Voir l'erreur » apparaît. L'utilisateur est averti.

### T-INT-09 et T-INT-10 — Robustesse aux données incomplètes et aux valeurs hostiles

Une fiche village dépourvue de sa section `s9` n'empêche pas la page de fonctionner.
Aucune valeur métier impossible n'est acceptée, aucune injection ne s'exécute.

---

## 3. Les défauts

### BUG-002 · T-INT-04 · **BLOCKER** — Achat déclaré enregistré, et perdu

**Module** : Achats Terrain · **Rôle** : Agent Recenseur · **URL** : `/terrain/achats.html`

**Scénario.** Le stockage local du téléphone est saturé — situation ordinaire après plusieurs
journées de saisie hors ligne avec photos de reçus. L'agent saisit un achat normal et valide.

**Reproduction.**
1. Saturer `localStorage` du domaine jusqu'au refus (mesuré : 48 blocs, `QuotaExceededError`,
   marge résiduelle **32 octets**).
2. Remplir le formulaire d'achat avec des valeurs valides.
3. Cliquer sur « Valider l'achat complet ».

**Résultat attendu** : un message d'échec explicite, ou l'achat réellement conservé.

**Résultat obtenu** :
> Message à l'écran : **« Achat validé (complet). Producteur provisoire — à valider par le Chef
> d'Unité. »** — classe CSS `alert show warn`, aucune mention d'erreur.
> File locale : **0 achat**. Serveur : **0 ligne**.

**L'achat n'existe nulle part. L'opérateur a lu « validé ».**

**Diagnostic.** `terrain/achats.html:293`
```js
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
```
Le `catch(e){}` vide avale `QuotaExceededError`. `save()` appelle `persistQueue(all)` → `store()`,
puis affiche son message de succès sans jamais vérifier que l'écriture a eu lieu.

**Pourquoi le quota se remplit.** `onPhoto()` (`achats.html:513`) redimensionne la photo du reçu
à 1 000 px et l'encode en JPEG qualité 0,6, soit en pratique 80 à 200 ko, puis **80 à 270 ko une
fois converti en base64**. Ces photos vivent dans la file `localStorage` jusqu'à synchronisation.
Le quota courant d'un domaine est de 5 à 10 Mo : **20 à 45 achats photographiés hors ligne
suffisent**. C'est une journée de terrain, pas un cas extrême.

**Recommandation.** Vérifier le succès de l'écriture (relire la clé après `setItem`, ou capturer
explicitement `QuotaExceededError`), refuser la validation et l'annoncer. Sortir les photos de
`localStorage` (IndexedDB, sans quota comparable) — `fbms/index.html` le fait déjà.

---

### BUG-003 · T-INT-05 · **CRITICAL** — File locale tronquée : disparition silencieuse

**Module** : Achats Terrain · **URL** : `/terrain/achats.html`

**Scénario.** L'écriture de la file est interrompue (onglet fermé, batterie vide, page tuée par
le système pendant `setItem`). La chaîne JSON reste tronquée.

**Reproduction.** Enregistrer un achat ; tronquer la valeur de `anagroci_achats` à 60 % de sa
longueur ; recharger la page.

**Résultat obtenu** :
> 1 achat avant, **0 vu par l'application** après rechargement.
> **646 octets illisibles** demeurent dans le stockage local.
> Message à l'écran : **aucun**. Compteur « en attente » : **0**.

**Diagnostic.** `terrain/achats.html:292`
```js
function load(k,def){try{const s=localStorage.getItem(k);return s?JSON.parse(s):def;}catch(e){return def;}}
```
`JSON.parse` échoue, `catch` renvoie la valeur par défaut `[]`. L'application repart d'une file
vide et l'affiche comme normale. Toute saisie non synchronisée est perdue, sans trace.

**Recommandation.** Sur échec de lecture : conserver la valeur brute sous une clé de
quarantaine, afficher un bandeau (« données locales illisibles, N octets mis de côté »),
et ne jamais présenter une file vide comme un état sain.

---

### BUG-006 · T-INT-08 · **CRITICAL** — Modification de village écrasée sans avertissement

**Module** : FBMS Référentiel · **URL** : `/fbms/index.html`

**Scénario.** Deux utilisateurs ouvrent la même fiche village, la modifient, et enregistrent
dans la même seconde.

**Reproduction.** Deux sessions distinctes (Branch Manager et Supervisor) lisent la même version
de référence (`updated_at` identique — vérifié), puis écrivent l'une après l'autre.

**Résultat obtenu** :
> Valeur finale : `TEST_LOAD_MODIF_B`.
> **La modification de A est perdue. Aucun conflit signalé, ni à A, ni à B.**

**Diagnostic.** `fbms/index.html:1092-1112` — le contrôle de conflit est un « lire puis
écrire » exécuté en JavaScript :
```js
const { data: cur } = await SB.from("villages").select("data, updated_at, updated_by")…
if (cur && new Date(cur.updated_at) > new Date(baseUpdatedAt)) return { conflict:true, … }
…
const { data, error } = await SB.from("villages").upsert(row)…
```
Entre le `select` et le `upsert`, rien n'empêche une autre écriture de passer. Le contrôle n'est
**pas atomique** : c'est un classique « vérifier puis agir ». Il protège contre une modification
survenue **il y a longtemps**, pas contre une modification **simultanée** — précisément le cas
de 100 utilisateurs.

L'intention est bonne : le code prévoit un écran d'arbitrage (`_conflictServer`) et refuse
d'écraser. Ce qui manque est l'écriture conditionnelle côté serveur.

**Recommandation.** Rendre l'écriture conditionnelle : `UPDATE … WHERE id = ? AND updated_at = ?`
et traiter « 0 ligne affectée » comme un conflit ; ou un déclencheur PostgreSQL qui refuse une
écriture dont l'`updated_at` de référence est périmé. La logique d'arbitrage du client est déjà
écrite : il suffit de lui donner un signal fiable.

**Portée.** `villages`, `rt` et `producteurs` utilisent tous le même motif. Les achats ne sont
pas concernés (chaque achat est une ligne nouvelle, protégée par `local_id`).

---

### BUG-007 · T-INT-02 · **HIGH** — Même reçu papier enregistré deux fois

**Module** : Achats Terrain

**Scénario.** Deux agents saisissent le même numéro de reçu papier — erreur de saisie, ou reçu
réellement compté deux fois.

**Résultat obtenu** :
> **2 lignes acceptées** pour `TEST_LOAD_RECU_UNIQUE`, poids 100 kg et 250 kg,
> montants 40 000 et 100 000 FCFA. Message affiché : « Achat validé (complet) ».

**Diagnostic.** Aucune contrainte n'existe sur `achats.numero_recu` (`supabase/achats.sql`).
Le plus révélateur : **le client attend cette contrainte**. `terrain/achats.html:610`
```js
if(/re[cç]u|recu|doublon|duplicate|unique|23505/.test(m)) return "Bloqué reçu doublon";
```
Une catégorie d'erreur « Bloqué reçu doublon » est prévue pour un code `23505` que la base
n'émettra jamais. Le garde-fou a été pensé côté client et oublié côté base.

Un contrôle partiel existe cependant : `shared/anagroci-audit.js:143` refuse un reçu déjà
présent **sur le même appareil**. Il ne voit rien de ce que fait un autre téléphone.

**Recommandation.** Index unique partiel sur `(numero_recu)` là où `numero_recu is not null`
et `rejet = false`, à valider d'abord avec le métier : le même numéro peut-il légitimement
apparaître deux fois (deux carnets, deux campagnes) ? Si oui, la clé doit inclure le carnet
ou le RT.

---

### BUG-008 · T-INT-14 · **HIGH** — La photo du reçu est écrite en base64 dans la table

**Module** : Achats Terrain

**Résultat obtenu** (photo réelle déposée dans le champ fichier, traitée par `onPhoto()`) :
> photo saisie : 1 039 octets · URL Storage : **aucune** ·
> base64 écrit dans la colonne `recu_photo` de la table `achats` : **1 039 octets** ·
> copie locale conservée : **non**

La preuve de paiement n'est pas perdue — mais elle est au mauvais endroit.

**Diagnostic.** La page prévoit le bon comportement : `uploadRecu()` envoie la photo vers le
bucket Storage `recus` et `syncAll` retire explicitement `recu_photo` du corps (« jamais de
base64 dans la table »). Ce chemin **n'est pas celui qui s'exécute**. Le code réellement
actif est `shared/anagroci-audit.js:syncQueueWithErrors`, qui envoie l'enregistrement tel quel,
base64 compris, sans jamais appeler `uploadRecu()`.

**Conséquences à 100 utilisateurs** — c'est là que le défaut devient dimensionnant :

- une ligne d'achat pèse ~600 octets sans photo, **80 à 270 ko avec** ;
- toute requête `select *` sur `achats` (Command Center, exports, écrans de suivi) rapatrie
  ces images ;
- 100 agents × 30 achats/jour × 150 ko ≈ **450 Mo par jour** dans une table transactionnelle,
  au lieu d'un bucket objet.

**Recommandation.** Faire converger les trois implémentations de synchronisation en une seule
(voir BUG-009), en conservant le chemin Storage prévu par la page.

---

### BUG-009 · T-INT-15 · **HIGH** — Un brouillon part en base

**Module** : Achats Terrain

**Résultat obtenu** :
> File locale `[["draft", null]]` → serveur `[{"statut":"Brouillon","recu":null,"mode":"Brouillon"}]`

Un achat volontairement laissé incomplet — **sans numéro de reçu**, donc non refinançable et
non validable — est envoyé dans la table transactionnelle.

**Diagnostic.** Trois implémentations de `syncAll` se superposent au chargement de la page
(détail : 01-MAPPING §6). Elles ne filtrent pas la même chose :

| Origine | Filtre |
|---|---|
| `terrain/achats.html:619` | `_status === "pending" \|\| _status === "failed"` |
| `terrain/achats_dropdown_patch.js:71` | `_status !== "synced"` — **les brouillons passent** |
| `shared/anagroci-audit.js:156` | enveloppe la précédente |

**Recommandation.** Une seule implémentation. Le fait que trois couches se réécrivent
mutuellement est la cause commune de BUG-008, BUG-009 et de la confusion du KOR — c'est la
correction la plus rentable de tout ce rapport.

---

### BUG-005 · T-INT-17 · **HIGH** — Producteur enrôlé enregistré comme provisoire

**Module** : Achats Terrain

**Résultat obtenu** :
> Valeur choisie dans la liste : `TEST_LOAD_P0001 - TEST_LOAD_PRODUCTEUR_1`
> Message : « Producteur non référencé : téléphone obligatoire (+ village) pour un producteur provisoire. »
> En base : `producteur_ref = false`, statut « Nouveau producteur provisoire », `producteur_id = null`

**Diagnostic.** Deux conventions incompatibles :

- `achats_dropdown_patch.js:15` écrit la valeur de l'option sous la forme `CODE - NOM` ;
- `achats.html:currentProdRow()` recherche le producteur par `prodLabel()`, qui ne rend
  **que le NOM**.

`keyc("TEST_LOAD_P0001 - TEST_LOAD_PRODUCTEUR_1")` ≠ `keyc("TEST_LOAD_PRODUCTEUR_1")` : la
correspondance échoue **systématiquement**, pour tout producteur ayant un code — c'est-à-dire
tous, puisque `supabase/producteurs_auto_code.sql` en génère un.

**Conséquence métier.** Chaque achat exige un numéro de téléphone que l'agent doit ressaisir,
est marqué « à régulariser », perd son `producteur_id`, et **le lien entre l'achat et le
producteur enrôlé est rompu dans la base**. La traçabilité producteur — raison d'être du
référentiel — ne se constitue pas.

C'est le défaut au plus fort impact métier de cette campagne, indépendamment de la charge.

**Recommandation.** Faire porter à l'option la valeur `code` seul et rechercher par `code` ;
ou faire correspondre `currentProdRow()` sur `CODE - NOM` en plus du nom.

---

## 4. Concurrence sous charge

Le scénario k6 `tests/load/05-concurrence.js` reprend les mêmes collisions à 25 utilisateurs
simultanés et compte : écrasements silencieux, doublons de `local_id`, doublons de reçu.
Résultats : rapport 04 §6.

---

## 5. Ce qui n'a pas été testé

| Élément | Raison |
|---|---|
| Collision sur les mêmes lignes en **production** | `NON TESTÉ` — base injoignable. Le comportement décrit en BUG-006 découle du code et est reproduit sur un backend appliquant la même sémantique PostgREST ; un déclencheur PostgreSQL non visible dans `supabase/*.sql` pourrait le corriger côté serveur — `NON CONFIRMÉ` |
| Intégrité du module Caisse & Avances (`avances`, `reconciliations`) | `NON TESTÉ` — les contraintes `local_id unique` existent et laissent attendre le même comportement que les achats, mais cela n'a pas été vérifié par exécution |
| Intégrité du module Sacs | `NON TESTÉ` |
| Intégrité RCN TRACE | `NON TESTÉ` |
| Corruption d'IndexedDB (FBMS Référentiel) | `NON TESTÉ` — seul `localStorage` a été soumis à corruption |
