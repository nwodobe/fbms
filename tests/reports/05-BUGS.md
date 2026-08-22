# 05 — Registre des anomalies

Chaque anomalie porte sa preuve : le test qui l'a produite, la valeur observée, la ligne de code
en cause. Aucune n'est déduite d'une lecture seule sans confirmation, sauf mention explicite.

**Sévérités** — BLOCKER : perte ou corruption de données, ou opération faussement déclarée
réussie · CRITICAL : perte possible, fuite d'accès, incohérence de données · HIGH : donnée
métier fausse ou absente, dégradation notable · MEDIUM : gêne réelle, contournable ·
LOW : défaut de finition.

| ID | Sévérité | Module | Titre | Test |
|---|---|---|---|---|
| BUG-001 | **CRITICAL** | Portail / FBMS | Cinq pages servies sans portail d'authentification | S-12, S-13, matrice §2 du rapport 02 |
| BUG-002 | **BLOCKER** | Achats Terrain | Achat déclaré « validé » et perdu quand le stockage local est saturé | T-INT-04 |
| BUG-003 | **CRITICAL** | Achats Terrain | File locale tronquée : disparition silencieuse des saisies | T-INT-05 |
| BUG-004 | **HIGH** | Achats Terrain | La liste RT s'efface pendant la saisie | trace `renderRefs`, §7 du rapport 02 |
| BUG-005 | **HIGH** | Achats Terrain | Producteur enrôlé enregistré comme « provisoire » | T-INT-17 |
| BUG-006 | **CRITICAL** | FBMS Référentiel | Modification de village écrasée sans avertissement | T-INT-08 |
| BUG-007 | **HIGH** | Achats Terrain | Même numéro de reçu papier accepté deux fois | T-INT-02 |
| BUG-008 | **HIGH** | Achats Terrain | Photo du reçu écrite en base64 dans la table `achats` | T-INT-14 |
| BUG-009 | **HIGH** | Achats Terrain | Trois implémentations de synchronisation superposées ; un brouillon part en base | T-INT-15 |
| BUG-010 | **HIGH** | Rôles / RLS | Le portail et la base ne connaissent plus les mêmes rôles | S-14 |
| BUG-011 | **HIGH** | ALIS | `shared/alis-hardening.js` ne s'exécute pas (erreur de syntaxe) | rapport 02 §3 — **défaut déjà daté** |
| BUG-012 | **MEDIUM** | PWA | Le service worker principal ne sait pas répondre hors ligne | rapport 02, tests PWA |
| BUG-013 | **MEDIUM** | RCN TRACE | 40 requêtes et une écriture au simple chargement de la page | rapport 06 §4.1 |
| BUG-014 | **MEDIUM** | Sécurité | Aucun cloisonnement des données par zone ou cluster | S-05 |
| BUG-015 | **MEDIUM** | Sécurité | Le rôle « Consultation uniquement » lit directement les montants et les tiers | S-06 |
| BUG-016 | **MEDIUM** | Stock & Sacs | Décalage de mise en page sur mobile (CLS 0,374) | rapport 06 §3 |
| BUG-017 | **MEDIUM** | Transverse | Quatre clients Supabase sur une même page | rapport 06 §4.1 |
| BUG-018 | **LOW** | FBMS | Fiche village sans section `s9` : erreur JavaScript intermittente | rapport 02 §3 |
| BUG-019 | **LOW** | FBMS | `manifest.webmanifest` et `icon-192.png` en 404 | rapport 02 §5 — **défaut déjà daté** |
| BUG-020 | **LOW** | Logistique | Trois pages logistiques servies, dont deux identiques, aucune référencée | rapport 02 §6 |
| BUG-021 | **LOW** | Transverse | `lucide@latest` non épinglé | 01-MAPPING §8 |
| BUG-022 | **LOW** | Achats Terrain | Message trompeur après un double-clic | T-INT-01 |
| BUG-023 | **LOW** | Rôles | Un rôle inconnu se voit accorder le niveau « agent » | lecture de `shared/aflp-access.js:523` |

---

## BUG-001 — Cinq pages servies sans portail d'authentification

- **Sévérité** : CRITICAL
- **Module** : Portail, FBMS Référentiel, Logistique, Suite
- **Rôle concerné** : tous, y compris **aucun** (visiteur non connecté) et les comptes désactivés
- **URL** : `/fbms/index.html`, `/logistique/index.html`, `/logistique.html`, `/logistique/ancien.html`, `/suite/index.html`

**Scénario.** Ouvrir directement `https://nwodobe.github.io/fbms/fbms/index.html` sans être
connecté, ou avec un compte désactivé par le Branch Manager.

**Étapes.**
1. Se déconnecter (ou utiliser une fenêtre privée).
2. Ouvrir l'URL du référentiel FBMS.

**Résultat attendu.** L'écran de connexion s'affiche, comme sur les 14 autres pages.

**Résultat obtenu.** L'interface complète s'affiche. Vérifié pour les cinq personas de test,
aux trois largeurs : les cinq pages sont en état `levé`, y compris pour le persona
`compte désactivé`, là où toutes les autres pages affichent `connexion` ou `Accès non autorisé`
(matrice complète, rapport 02 §2).

**Diagnostic.** Ces cinq fichiers ne chargent pas `shared/auth-gate.js`. Vérification :

```
$ for f in $(git ls-files '*.html'); do grep -q auth-gate "$f" || echo "$f"; done
fbms/index.html
logistique.html
logistique/ancien.html
logistique/index.html
suite/index.html
```

`SECURITE.md` déclare pourtant : « Le verrou est posé sur : portail, ALIS, Audit distances,
Hubs, Carte, **FBMS (`fbms/app.html`)** ». La passerelle protégée `fbms/app.html` existe bien
et redirige vers `fbms/index.html` — mais **le portail ne pointe pas vers elle** :
`index.html` déclare `href:'fbms/index.html'`. La porte a été posée à côté du chemin.

**Portée réelle du risque.** L'interface s'ouvre, mais les données restent protégées par la RLS
(la table `villages` n'est lisible que par un profil actif). Ce qui est exposé :

- la structure de l'application, ses champs, sa logique métier ;
- **le cache IndexedDB local**, s'il subsiste sur l'appareil d'un utilisateur dont le compte a
  été désactivé — c'est le cas qui compte : révoquer un compte ne referme pas cet écran ;
- toute page de saisie utilisable en apparence, qui accumulera des données localement.

**Recommandation.** Ajouter `<script defer src="../shared/auth-gate.js" data-module="fbms">` à
`fbms/index.html`, et faire pointer la tuile du portail sur cette page (ou sur `app.html`).
Supprimer ou protéger les trois pages logistiques et `suite/index.html`.

---

## BUG-002 — Achat déclaré « validé » et perdu quand le stockage local est saturé

- **Sévérité** : **BLOCKER** — critère NO-GO §19 : « opération déclarée réussie alors qu'elle
  n'est pas enregistrée »
- **Module** : Achats Terrain · **Rôle** : Agent Recenseur · **URL** : `/terrain/achats.html`

**Scénario.** Le stockage local du téléphone est plein. L'agent saisit un achat et valide.

**Étapes.**
1. Saturer `localStorage` du domaine (mesuré : 48 blocs jusqu'au refus, `QuotaExceededError`,
   **32 octets de marge résiduelle**).
2. Remplir le formulaire avec des valeurs valides (village, RT, 100 kg, 400 F/kg, 2 sacs, reçu).
3. Cliquer sur « Valider l'achat complet ».

**Attendu.** Un message d'échec explicite, ou l'achat réellement conservé.

**Obtenu.**
- Message : **« Achat validé (complet). Producteur provisoire — à valider par le Chef d'Unité. »**
- Classe CSS du bandeau : `alert show warn` — aucune mention d'erreur.
- File locale : **0 achat**. Table `achats` : **0 ligne**.

**Console.** Aucune erreur : l'exception est avalée.
**Requête réseau.** Aucune : rien n'a jamais été mis en file.

**Diagnostic.** `terrain/achats.html:293`

```js
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
```

`save()` appelle `persistQueue(all)` → `store()`, puis affiche son message de succès sans
vérifier l'écriture. Le `catch(e){}` vide fait disparaître `QuotaExceededError`.

**Pourquoi le quota se remplit en usage normal.** `onPhoto()` (`achats.html:513`) encode la photo
du reçu en JPEG 1 000 px qualité 0,6, puis en base64 : 80 à 270 ko par achat, conservés dans la
file jusqu'à synchronisation. Quota courant : 5 à 10 Mo. **20 à 45 achats photographiés hors
ligne suffisent** — une journée de collecte.

**Recommandation.** Vérifier le succès de l'écriture et refuser la validation en cas d'échec.
Sortir les photos de `localStorage` vers IndexedDB, comme le fait déjà `fbms/index.html`.

---

## BUG-003 — File locale tronquée : disparition silencieuse

- **Sévérité** : CRITICAL · **Module** : Achats Terrain

**Scénario.** L'écriture de la file est interrompue (onglet fermé, batterie vide, processus tué
pendant `setItem`). La chaîne JSON reste incomplète.

**Étapes.** Enregistrer un achat · tronquer `anagroci_achats` à 60 % · recharger.

**Attendu.** Alerte visible, ou récupération partielle.

**Obtenu.** 1 achat avant ; **0 vu par l'application** après rechargement ; **646 octets
illisibles** restent en base locale ; **aucun message** ; compteur « en attente » à 0.

**Diagnostic.** `terrain/achats.html:292` — `JSON.parse` échoue, `catch` renvoie `[]`.
L'application repart d'une file vide et l'affiche comme un état normal.

**Recommandation.** Mettre la valeur illisible en quarantaine sous une autre clé, afficher un
bandeau, ne jamais présenter une file vide comme saine.

---

## BUG-004 — La liste RT s'efface pendant la saisie

- **Sévérité** : HIGH · **Module** : Achats Terrain

**Scénario.** L'agent choisit le village, puis le RT, puis remplit les champs. Au moment de
saisir le numéro de reçu, la sélection du RT disparaît.

**Obtenu** (trace posée sur le champ `#f_rt`) :

```
avant recu: TEST_LOAD_RT_01
apres recu: (vide)
trace: set innerHTML sur #f_rt
       at renderRefs   (terrain/achats_dropdown_patch.js:57)
       at refreshDropdowns (terrain/achats_dropdown_patch.js:64)
```

Un rafraîchissement asynchrone de la liste, déclenché plus tôt par la saisie du village,
se termine **pendant** que l'opérateur remplit les champs suivants, et reconstruit le `<select>`
— ce qui remet sa valeur à vide. La validation refuse alors l'achat avec « RT requis : un achat
doit être rattaché à une équipe RT », alors que l'opérateur a bien choisi un RT.

**Aggravation attendue sous réseau lent** : le rafraîchissement se termine d'autant plus tard
que la liaison est mauvaise — donc d'autant plus probablement pendant la saisie. C'est
exactement la condition du terrain.

**Recommandation.** Mémoriser la valeur sélectionnée avant de reconstruire la liste et la
restaurer ; ou ne reconstruire que si le village a réellement changé.

---

## BUG-005 — Producteur enrôlé enregistré comme « provisoire »

- **Sévérité** : HIGH · **Module** : Achats Terrain · **Impact métier : le plus élevé du registre**

**Scénario.** L'agent choisit un producteur **dans la liste des producteurs enrôlés du village**.

**Obtenu.**
- Valeur de la liste : `TEST_LOAD_P0001 - TEST_LOAD_PRODUCTEUR_1`
- Message : « Producteur non référencé : téléphone obligatoire (+ village) pour un producteur provisoire. »
- En base : `producteur_ref = false`, `producteur_statut = "Nouveau producteur provisoire"`,
  **`producteur_id = null`**

**Diagnostic.** Deux conventions incompatibles :

| Fichier | Convention |
|---|---|
| `terrain/achats_dropdown_patch.js:15` (`prodValue`) | valeur de l'option = `CODE - NOM` |
| `terrain/achats.html` (`currentProdRow` / `prodLabel`) | recherche par **NOM seul** |

`keyc("TEST_LOAD_P0001 - TEST_LOAD_PRODUCTEUR_1")` ≠ `keyc("TEST_LOAD_PRODUCTEUR_1")`.
La correspondance échoue pour **tout producteur possédant un code**, c'est-à-dire tous, puisque
`supabase/producteurs_auto_code.sql` en génère un automatiquement.

**Conséquences.** Un téléphone est réclamé à chaque saisie ; chaque achat est marqué « à
régulariser » ; **le lien achat ↔ producteur enrôlé n'existe pas en base**. La traçabilité
producteur, raison d'être du référentiel, ne se constitue pas.

**Recommandation.** Aligner les deux conventions : option porteuse du `code` seul et recherche
par `code`.

---

## BUG-006 — Modification de village écrasée sans avertissement

- **Sévérité** : CRITICAL · **Module** : FBMS Référentiel

**Scénario.** Deux utilisateurs modifient la même fiche village et enregistrent dans la même
seconde.

**Obtenu.** Les deux ont lu la même version de référence (`updated_at` identique, vérifié).
Valeur finale : `TEST_LOAD_MODIF_B`. **La modification de A est perdue, sans conflit signalé à
personne.**

**Diagnostic.** `fbms/index.html:1092-1112` — le contrôle de conflit est un `select` suivi d'un
`upsert`, comparés en JavaScript. Rien n'empêche une écriture concurrente de s'intercaler.
Le motif protège contre une modification ancienne, pas contre une modification **simultanée**.

**Portée.** Même motif sur `villages`, `rt` et `producteurs`. Les achats ne sont pas concernés.

**Recommandation.** Écriture conditionnelle côté serveur : `UPDATE … WHERE id = ? AND
updated_at = ?`, « 0 ligne affectée » = conflit. L'écran d'arbitrage existe déjà côté client.

---

## BUG-007 — Même numéro de reçu papier accepté deux fois

- **Sévérité** : HIGH · **Module** : Achats Terrain

**Obtenu.** Deux achats portant `TEST_LOAD_RECU_UNIQUE`, 100 kg / 40 000 F et 250 kg / 100 000 F,
tous deux acceptés, message « Achat validé (complet) » dans les deux cas.

**Diagnostic.** Aucune contrainte sur `achats.numero_recu` (`supabase/achats.sql`). Or le client
**attend** cette contrainte : `terrain/achats.html:610` prévoit une catégorie d'erreur
« Bloqué reçu doublon » déclenchée par un code `23505` que la base n'émettra jamais.

Un contrôle partiel existe (`shared/anagroci-audit.js:143`) mais ne voit que **l'appareil
courant** : deux téléphones différents passent.

**Recommandation.** Index unique partiel sur `numero_recu`, après arbitrage métier : le même
numéro peut-il légitimement apparaître deux fois (deux carnets, deux campagnes) ? Si oui, la clé
doit inclure le carnet ou le RT.

---

## BUG-008 — Photo du reçu écrite en base64 dans la table

- **Sévérité** : HIGH · **Module** : Achats Terrain

**Obtenu.** Photo réelle déposée dans le champ fichier : aucune URL Storage, **1 039 octets de
base64 écrits dans la colonne `recu_photo` de la table `achats`**, copie locale effacée.

**Diagnostic.** La page prévoit le bon comportement (`uploadRecu()` vers le bucket `recus`, puis
`delete payload.recu_photo` — « jamais de base64 dans la table »). Ce chemin ne s'exécute pas :
c'est `shared/anagroci-audit.js:syncQueueWithErrors` qui envoie, et il transmet la ligne
entière.

**Impact de charge.** Une ligne d'achat passe de ~600 octets à 80–270 ko. Tout `select *` sur
`achats` — Command Center, exports — rapatrie les images.
100 agents × 30 achats/jour × 150 ko ≈ **450 Mo par jour** dans une table transactionnelle.

**Recommandation.** Voir BUG-009 : unifier la synchronisation en conservant le chemin Storage.

---

## BUG-009 — Trois implémentations de synchronisation superposées

- **Sévérité** : HIGH · **Module** : Achats Terrain · **Cause commune de BUG-008 et de ce défaut**

**Obtenu.** Un brouillon **sans numéro de reçu** — donc non validable et non refinançable —
arrive en base : file locale `[["draft", null]]` → serveur
`[{"statut":"Brouillon","recu":null,"mode":"Brouillon"}]`.

**Diagnostic.** Au chargement de `terrain/achats.html`, trois couches se succèdent sur
`window.syncAll` :

| Ordre | Origine | Filtre appliqué | Traitement de la photo | Traitement du KOR |
|---|---|---|---|---|
| 1 | `terrain/achats.html:619` | `pending` ou `failed` | envoi vers Storage, base64 retiré | conservé |
| 2 | `achats_dropdown_patch.js:71` | `≠ synced` → **brouillons inclus** | aucun envoi | **`delete payload.kor`** |
| 3 | `shared/anagroci-audit.js:156` | envoie elle-même via `syncQueueWithErrors`, puis appelle la couche 2 | envoie la ligne telle quelle | conservé |

Ce qui part réellement (corps POST capturé) contient `kor` **et** `recu_photo` : c'est la
couche 3 qui écrit. Aucune des trois n'est complètement fausse ; c'est leur empilement qui
produit un comportement que personne n'a décrit.

**Recommandation.** Une seule implémentation. C'est la correction la plus rentable du registre :
elle referme BUG-008, BUG-009, et lève l'incertitude sur le KOR.

---

## BUG-010 — Le portail et la base ne connaissent plus les mêmes rôles

- **Sévérité** : HIGH · **Module** : Rôles et RLS
- **Portée** : modèle vérifié par lecture croisée du code et du SQL ; **état de la production
  `NON CONFIRMÉ`**

**Diagnostic.** L'écran d'administration propose les rôles de `shared/aflp-access.js` :

> Branch Manager / Head of Programme · Zonal Head · Logistics Coordinator · Unit Head ·
> Assistant Unit Head · Warehouse Keeper · Finance / Controller · RT / Field Partner ·
> Read Only / Audit — plus les six libellés historiques.

Les fonctions de `supabase/rls.sql` ne connaissent que les libellés historiques :

```sql
create or replace function public.peut_editer_terrain() … select public.mon_role() in
  ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
   'Supervisor','Agent Recenseur')

create or replace function public.est_bm() … and role = 'Branch Manager'
```

Conséquences pour un compte créé avec un libellé récent :

| Rôle attribué | Ce que le portail ouvre | Ce que la base autorise |
|---|---|---|
| `Zonal Head` | niveau `chef` : Achats, Caisse, ALIS, Audit | **aucune écriture** (`peut_editer_terrain` = faux) |
| `Warehouse Keeper` | niveau `agent` : Achats, Sacs, FBMS | **aucune écriture** |
| `Branch Manager / Head of Programme` | niveau `bm` : **tout, y compris l'Administration** | **ni suppression, ni gestion des comptes** (`est_bm` = faux) |

Un Branch Manager créé avec le libellé récent obtient l'écran d'administration et **ne peut
créer aucun compte**. Un chef de zone obtient les écrans de saisie et **ne peut rien
enregistrer**.

`supabase/20260818_farmer_registry_phase1_security.sql` connaît pourtant ces rôles (il les
utilise pour son mapping de périmètre) : c'est bien `rls.sql` qui n'a pas suivi.

**Recommandation.** Mettre à jour les trois fonctions d'aide de `rls.sql` — modification de la
zone interdite aux agents (`CLAUDE.md` §3), à faire par une personne, avec vérification que
chaque compte existant conserve son accès.

---

## BUG-011 — `shared/alis-hardening.js` ne s'exécute pas

- **Sévérité** : HIGH · **Module** : ALIS · **Défaut déjà daté** (`CLAUDE.md` §6, `js-baseline.json`)

**Obtenu.** `Unexpected token 'function'` sur **15 ouvertures sur 15** de
`logistique/alis_fbms.html`, pour les deux rôles autorisés et aux trois largeurs.

Le fichier est chargé en production (`shared/uppercase.js:127` l'injecte dynamiquement) mais
n'est jamais exécuté : 14 ko de garde-fous absents sur un écran qui **modifie des barèmes
tarifaires**.

**Apport de cette campagne** : la confirmation que l'erreur se produit bien à chaque ouverture
en condition réelle, et pas seulement à l'analyse statique.

---

## BUG-012 — Le service worker principal ne sait pas répondre hors ligne

- **Sévérité** : MEDIUM · **Module** : couche PWA

**Diagnostic.** Deux service workers coexistent :

| Fichier | Enregistré par | Portée | Repli hors ligne |
|---|---|---|---|
| `i18n-sw.js` | `index.html:270` | `/fbms/` — **tout le site** | **aucun** |
| `sw.js` | `fbms/index.html:5127` | `/fbms/fbms/` | oui (`caches.match`) |

`i18n-sw.js` intercepte chaque navigation HTML, force `cache: 'no-store'`, et en cas d'échec
retente un `fetch` — sans jamais consulter `caches`. Hors ligne, les deux échouent.

Toutes les pages hors du dossier `fbms/` — dont **Achats Terrain**, le module de terrain par
excellence — dépendent de ce service worker.

Second effet : `no-store` annule le cache HTTP du CDN ; chaque ouverture retélécharge la page
entière.

---

## BUG-013 — RCN TRACE : 40 requêtes et une écriture au chargement

- **Sévérité** : MEDIUM · **Module** : RCN TRACE

**Obtenu** (relevé réseau à l'ouverture, largeur bureau) : 40 requêtes, dont
**4 lectures de `profils`** (quatre clients Supabase distincts), 31 tables `rcn_*`, un
`POST audit_log`, et **un `POST rcn_jute_locations`** — une écriture métier déclenchée par le
simple fait d'ouvrir l'écran.

Poids de la page : **1 089 ko**, dont 1 040 ko de JavaScript en 29 fichiers.

À 100 utilisateurs ouvrant ce module dans la même minute : **≈ 67 requêtes/seconde** en pic.

---

## BUG-014 — Aucun cloisonnement des données par zone ou cluster

- **Sévérité** : MEDIUM · **Portée** : modèle vérifié / déploiement `NON CONFIRMÉ`

Les politiques de lecture des tables terrain sont `est_actif()`, sans filtre de périmètre :
tout compte actif lit **tous** les villages, **tous** les producteurs, **tous** les achats,
quel que soit son rôle ou sa zone.

`shared/aflp-access.js` et `docs/migrations/aflp_acces_perimetres_20260816.sql` décrivent
pourtant un modèle de périmètres (zone / cluster / village). Ce modèle n'est pas appliqué par
`supabase/rls.sql`.

Ce n'est pas une fuite entre utilisateurs au sens du §19 — c'est un choix de conception, peut-être
assumé pour une branche unique. Il devient un vrai sujet le jour où plusieurs branches partagent
la base.

---

## BUG-015 — « Consultation uniquement » lit directement montants et tiers

- **Sévérité** : MEDIUM · **Portée** : modèle vérifié / déploiement `NON CONFIRMÉ`

Le portail interdit à ce rôle les modules Achats et Caisse (`ACCESS` de `auth-gate.js`).
La RLS ne l'en empêche pas : avec sa session et la clé publiable — visible dans les pages — il
lit `achats` (montants, noms de producteurs, numéros de reçus) et `avances`.

**L'écran est fermé, la donnée ne l'est pas.**

---

## BUG-016 — Décalage de mise en page sur mobile (Stock & Sacs)

- **Sévérité** : MEDIUM

CLS **0,374** à 390×844 (seuil « bon » : 0,1 ; « mauvais » au-delà de 0,25). Sur un écran de
saisie tactile, un décalage de cette ampleur au premier demi-seconde fait toucher le mauvais
bouton. RCN TRACE présente également 0,161 sur bureau.

---

## BUG-017 — Quatre clients Supabase sur une même page

- **Sévérité** : MEDIUM

Chromium le signale : « *Multiple GoTrueClient instances detected in the same browser context.
It is not an error, but this should be avoided as it may produce undefined behavior when used
concurrently under the same storage key* ». Chaque client relit le profil et gère son propre
rafraîchissement de jeton, avec contention sur le verrou de session — piste probable des
rafraîchissements tardifs observés en BUG-004.

---

## BUG-018 — Fiche village sans section `s9` : erreur JavaScript

- **Sévérité** : LOW

`Cannot read properties of undefined (reading 'potentiel20')` sur 4 ouvertures de
`fbms/index.html` sur 15. `fbms/index.html:759` — `scoreOf(v)` lit `v.s9` sans garde. La même
fonction est appelée dans `RemoteVillages.upsert` : une fiche ancienne sans `s9` ferait échouer
la synchronisation.

---

## BUG-019 — `manifest.webmanifest` et `icon-192.png` en 404

- **Sévérité** : LOW · **Défaut déjà daté** (`liens-baseline.json`)

`fbms/index.html` les référence en relatif ; ils sont à la racine. **404 observée dans la
console du navigateur**, pas seulement déduite. L'écran principal de la PWA n'a pas de manifeste.

---

## BUG-020 — Trois pages logistiques servies, dont deux identiques

- **Sévérité** : LOW

`logistique.html` et `logistique/ancien.html` sont strictement identiques (32 326 octets).
Aucune des trois pages logistiques n'est référencée par le portail, qui pointe vers
`logistique/alis_fbms.html`. Trois surfaces exposées sans utilisateur déclaré.

---

## BUG-021 — `lucide@latest` non épinglé

- **Sévérité** : LOW

`https://unpkg.com/lucide@latest` sur trois pages. Une publication amont peut modifier le rendu
sans aucun commit dans ce dépôt, et sans qu'aucune porte ne le détecte.

---

## BUG-022 — Message trompeur après un double-clic

- **Sévérité** : LOW

Après un double-clic sur « Valider l'achat complet », le second clic affiche
« Poids net invalide (brut − tare doit être > 0) » alors que l'achat vient d'être enregistré
correctement. Le formulaire a été vidé entre les deux clics. Aucune donnée en jeu, mais un
message qui inquiète l'opérateur au mauvais moment.

---

## BUG-023 — Un rôle inconnu se voit accorder le niveau « agent »

- **Sévérité** : LOW

`shared/aflp-access.js:523` — `default: return "agent"`. Un libellé de rôle absent de la liste
(saisi directement en SQL, ou hérité d'une version antérieure) ouvre les modules Achats, Sacs et
FBMS. La base, elle, refuse les écritures (`peut_editer_terrain` ne le connaît pas non plus)
mais **autorise toutes les lectures** (`est_actif()` ne teste que `actif = true`).

Les 15 rôles réellement proposés par l'écran d'administration sont tous couverts : ce défaut
n'est atteignable que par une modification directe en base. Le principe reste discutable — un
rôle inconnu devrait fermer, pas ouvrir.
