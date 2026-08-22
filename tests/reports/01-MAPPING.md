# 01 — Cartographie de l'application

**Cible** : ANAGROCI Operations Suite — `https://nwodobe.github.io/fbms/index.html`
**Dépôt** : `nwodobe/fbms` · commit cartographié `6933e8a` (`HEAD == main == origin/main`)
**Date** : 22 août 2026
**Méthode** : lecture du code source du dépôt **et** exécution réelle des pages dans Chromium
(19 pages × 5 personas × 3 largeurs = 285 ouvertures — `tests/reports/donnees/01-parcours-pages.json`).

> Convention : tout ce qui n'a pas été observé ou lu directement est marqué `NON CONFIRMÉ`.
> Rien n'est déduit d'une documentation sans vérification dans le code ou dans le navigateur.

---

## 0. Contrainte majeure de cette campagne — à lire en premier

**La production n'est pas joignable depuis l'environnement d'exécution de cette campagne.**

La politique de sortie réseau de la session refuse les deux hôtes qui comptent :

```
$ curl -sS -o /dev/null -w "%{http_code}" https://nwodobe.github.io/fbms/index.html
curl: (56) CONNECT tunnel failed, response 403

$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
"recentRelayFailures": [{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "nwodobe.github.io:443" }]
```

Hôtes testés un par un : `nwodobe.github.io` **refusé**, `jmbdgpdthzpszfnddwzi.supabase.co`
**refusé**, `cdn.jsdelivr.net` **refusé**, `unpkg.com` **refusé**, `tile.openstreetmap.org`
**refusé**. Seuls `github.com`, `api.github.com`, `raw.githubusercontent.com` et les registres
de paquets passent.

### Ce que cela change, et ce que cela ne change pas

| Question | Testable ici ? | Comment |
|---|---|---|
| Le code publié se comporte-t-il correctement ? | **Oui** | Les octets servis sont identiques à ceux du dépôt (GitHub Pages, `.nojekyll`, aucune génération). Empreintes SHA-256 comparées fichier par fichier — `tests/bench/verifier-banc.mjs`. |
| Combien de requêtes un utilisateur génère-t-il ? | **Oui** | Mesuré dans un vrai navigateur, indépendant du serveur. |
| Que fait le client en concurrence, hors ligne, sur double-clic ? | **Oui** | Mesuré, 17 scénarios — rapport 03. |
| Le modèle d'accès est-il cohérent ? | **Oui** | Politiques de `supabase/rls.sql` reproduites et confrontées au portail JavaScript. |
| **Combien de temps met Supabase à répondre à 100 utilisateurs ?** | **NON** | `NON TESTÉ` — le serveur est injoignable. |
| **Les politiques RLS sont-elles réellement déployées en production ?** | **NON** | `NON CONFIRMÉ` — vérifiable uniquement contre le projet Supabase. |
| **Le CDN GitHub Pages tient-il 100 ouvertures simultanées ?** | **NON** | `NON TESTÉ`. Le script est prêt : `tests/load/04-statique.js`, lecture seule, sans risque. |

### Le banc d'essai construit à la place

Faute de production, la campagne exécute **le vrai code sur un backend émulé** :

| Composant | Nature | Fidélité |
|---|---|---|
| Serveur statique | Sert les octets exacts du dépôt | **Identique à GitHub Pages** (hors latence CDN et en-têtes de cache) |
| `@supabase/supabase-js` | **Vrai paquet npm 2.47.10**, servi localement | Identique au SDK chargé depuis jsdelivr |
| Backend Supabase | Émulateur GoTrue + PostgREST + Storage (`tests/bench/faux-supabase.mjs`) | Reproduit unicité, `on_conflict`, `resolution=merge/ignore-duplicates`, `updated_at`, RLS de `supabase/rls.sql`, codes 23505 / 401 / 403 — **pas** le plan d'exécution PostgreSQL, la latence réseau, le pooler ni le Realtime |
| Leaflet, Lucide, Tailwind, XLSX, Chart.js | Doublures du dépôt (`.github/vendor/doublures/`) | Affichage seulement — un défaut de rendu cartographique observé ici n'est **pas** un défaut de production (voir 05-BUGS, faux positifs écartés) |

Le banc se contrôle lui-même : `node tests/bench/verifier-banc.mjs` → **17/17**.

---

## 1. Nature de l'application

| Trait | Valeur | Preuve |
|---|---|---|
| Type | Site statique multi-pages + PWA | Absence de `package.json` à la racine, `.nojekyll` présent |
| Construction | **Aucune** — les fichiers commis sont les fichiers servis | `.nojekyll`, aucun bundler |
| Hébergement | GitHub Pages, dépôt `nwodobe/fbms`, chemin `/fbms/` | `README.md`, chemins absolus `/fbms/shared/…` dans `i18n-sw.js` |
| Backend | **Supabase** — projet `jmbdgpdthzpszfnddwzi` | 14 fichiers référencent `https://jmbdgpdthzpszfnddwzi.supabase.co` |
| Clé cliente | `sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d`, **en clair dans les pages** | Assumé et documenté (`SECURITE.md`) : la protection réelle est la RLS |
| Authentification | Supabase GoTrue, email + mot de passe | `shared/auth-gate.js` |
| Autorisation | Deux couches : table `ACCESS` en JavaScript **+** politiques RLS | `shared/auth-gate.js`, `supabase/rls.sql` |
| Stockage local | `localStorage` (achats, caisse, sacs, RCN) **et** IndexedDB (FBMS Référentiel) | `terrain/achats.html:279`, `fbms/index.html:834` |
| Hors ligne | File locale + synchronisation différée | `fbms/index.html:syncNow`, `terrain/achats.html:syncAll` |
| Internationalisation | FR / EN, injectée par service worker | `i18n-sw.js`, `shared/i18n.js` (66 ko) |
| Temps réel | **Une seule page** y recourt | `SB.channel('fbms-map-live')` dans `fbms/fbms_carte.html` — unique occurrence du dépôt |

### Volumétrie du code servi

19 pages HTML servies (hors `savoir-plus/`, hors le fichier de sauvegarde), **63 fichiers JavaScript**,
pour un total de **≈ 2,1 Mo de JavaScript non minifié** dans `shared/` et `rcntrace/`.
Les plus lourds : `rcntrace/sim-data.js` (346 ko), `rcntrace/rcntrace-ui.js` (206 ko),
`rcntrace/rcntrace.js` (126 ko), `shared/aflp-ia-predictif.js` (118 ko),
`shared/aflp-ia-moteur.js` (96 ko), `shared/i18n.js` (65 ko).
La page la plus lourde est `fbms/index.html` : **343 ko de HTML en un seul fichier**, 5 134 lignes.

---

## 2. Carte des modules

Colonne « Rôles autorisés » = table `ACCESS` de `shared/auth-gate.js:43`, **vérifiée par exécution**
(test S-07 : 24 combinaisons page × persona ouvertes réellement dans le navigateur).

| Module | Route | Fonction | Rôles autorisés | Actions possibles | Tables / API | Criticité |
|---|---|---|---|---|---|---|
| Portail | `index.html` | Lanceur des 10 applications, filtre par rôle | bm · chef · agent · direction | Naviguer, rechercher, filtrer | `profils`, `audit_log` | Moyenne |
| Achats Terrain | `terrain/achats.html` | Saisie journalière RCN Producteur → RT | bm · chef · agent | **C**réer, lire, supprimer (BM), synchroniser, joindre une photo de reçu | `achats`, `villages`, `rt`, `producteurs`, `avances`, `audit_log` | **Maximale** — transaction financière |
| Stock & Sacs | `terrain/sacs.html` | Mouvements de sacherie | bm · chef · agent | Créer, lire, synchroniser | `sacs_mouvements`, `bag_movement_requests`, `rt` | Haute |
| Sacherie v2 | `terrain/sacherie_v2.html` | Tour de contrôle sacherie | bm · chef · agent | Lire, arbitrer | `sacs_mouvements`, `rcn_jute_*` | Haute |
| Caisse & Avances | `terrain/cash.html` | Avances RT et réconciliation | bm · chef | Créer, lire, réconcilier | `avances`, `reconciliations`, `achats` | **Maximale** — flux de trésorerie |
| Command Center | `terrain/command.html` | Anomalies, file hors ligne, RT à risque | bm · direction | Lire, exporter | `achats`, `avances`, `sacs_mouvements`, `rt`, `villages` | Haute |
| FBMS Référentiel | `fbms/index.html` | Zones, villages, RT, producteurs, passeport producteur | **aucun contrôle — voir §7** | Créer, lire, modifier, supprimer, importer, exporter, synchroniser | `villages`, `rt`, `producteurs`, `farmer_*`, Storage `photos` | **Maximale** — référentiel de toute la chaîne |
| Passerelle FBMS | `fbms/app.html` | Redirige vers `fbms/index.html` | bm · chef · agent | Rediriger | — | Faible |
| Hubs / Clusters | `fbms/fbms_hubs.html` | GPS des hubs, distances usine | bm · chef · agent · direction | Lire, modifier | `hubs_clusters`, `villages`, `parametres_calcul`, `log_hubs` | Moyenne |
| Cartographie | `fbms/fbms_carte.html` | Carte interactive Leaflet + temps réel | bm · chef · agent · direction | Lire, filtrer | `villages`, `hubs_clusters`, `parametres_calcul` + canal Realtime | Moyenne |
| Audit Distances | `fbms/audit_distances.html` | Validation des distances routières | bm · chef | Lire, valider, modifier | `villages`, `hubs_clusters`, `audit_log` | Moyenne |
| ALIS Logistique | `logistique/alis_fbms.html` | Coût rendu usine, barème collecte courte | bm · chef | Simuler, **modifier le barème tarifaire** | `parametres_collecte_courte`, `grilles_tarifaires`, `lignes_tarifaires`, `villages`, `hubs_clusters` | **Haute** — modifie des tarifs |
| RCN TRACE | `rcntrace/index.html` | Traçabilité, bilan matière, jute, procurement | bm · chef · agent · direction | CRUD étendu (≈ 30 tables `rcn_*`) | `rcn_*` (30 tables et vues) | Haute |
| Administration | `shared/admin.html` | Comptes et rôles | bm | Créer, modifier, activer / désactiver | `profils`, fonction Edge `admin-create-user` | **Maximale** |
| AFLP IA Admin | `terrain/aflp-ia-admin.html` | Catalogue et journal de l'assistant IA | bm | CRUD catalogue | `aflp_ia_*` | Moyenne |
| Suite | `suite/index.html` | Ancien lanceur | **aucun contrôle — voir §7** | Naviguer | `profils` | Faible |
| Logistique (racine) | `logistique.html` | **Doublon** de `logistique/ancien.html` (32 326 octets, identiques) | **aucun contrôle — voir §7** | Lire, paramétrer | `log_parametres`, `log_gabarits`, `log_hubs`, `log_grille_decisions`, `log_reperes` | Moyenne |
| Logistique (ancien) | `logistique/ancien.html` | Idem | **aucun contrôle** | Idem | Idem | Moyenne |
| Logistique (index) | `logistique/index.html` | Écran logistique complet | **aucun contrôle** | Lire, paramétrer | `log_*`, `villages` | Moyenne |

**Pages non servies** : `FBMS · Sauvegarde Master.html` (sauvegarde, jamais liée),
`savoir-plus/` (application Next.js séparée, hors périmètre par `CLAUDE.md` §1).

### Menus, écrans et sous-modules non listés par le portail

Le portail annonce 10 applications. L'exécution en révèle davantage :

- `shared/suite-bar.js` (13 ko) injecte une barre de navigation transverse sur `terrain/sacs.html`.
- `shared/uppercase.js:60-140` **injecte dynamiquement 12 scripts supplémentaires** selon l'URL :
  `fbms-field-hardening.js`, `fbms-dashboard-audit.js`, 8 scripts `farmer-registry-*`,
  `alis-hardening.js`, `audit-distances-fix.js`. Aucune recherche textuelle sur les pages
  ne les trouve : ils n'existent qu'à l'exécution.
- `shared/auth-gate.js` injecte à son tour `aflp-access.js`, `i18n.js`, `anagroci-audit.js`,
  `anagroci-sacs-guards.js` et — uniquement sur la page Achats — `achats_dropdown_patch.js`.
- Le module RCN TRACE est en réalité **une application dans l'application** : 24 fichiers
  JavaScript, plusieurs espaces (traçabilité, jute, procurement, pricing, incidents),
  ≈ 30 tables. Sa cartographie détaillée est `NON RÉALISÉE` dans cette campagne, faute de
  temps : elle mériterait une campagne à part entière.

---

## 3. Rôles utilisateurs réels

Source unique : `shared/auth-gate.js:20-40` (avec repli sur `shared/aflp-access.js`), croisée avec
`supabase/rls.sql` et `SECURITE.md`. Aucun rôle n'a été inventé.

| Rôle `profils.role` | Niveau interne | Poids retenu pour la simulation | Justification du poids |
|---|---|---|---|
| `Branch Manager` | `bm` | 10 % | Un seul par branche, plus les remplaçants |
| `Assistant Branch Manager` | `bm` | (inclus ci-dessus) | Même niveau d'accès |
| `Head of Field` | `bm` | (inclus) | Même niveau |
| `Procurement Officer` | `bm` | (inclus) | Même niveau |
| `Supervisor` | `chef` | 25 % | Encadrement des équipes terrain |
| `Agent Recenseur` | `agent` | 55 % | Le gros des effectifs en campagne |
| `Consultation uniquement` | `direction` | 10 % | Direction et suivi |
| *(rôle inconnu)* | `agent` **par défaut** | — | `default: return "agent"` — voir 05-BUGS BUG-011 |

Un compte est également caractérisé par `profils.actif` : un compte désactivé est déconnecté
au chargement (`auth-gate.js:run`).

---

## 4. Formulaires et opérations CRUD

Relevé par exécution (nombre de champs par page, colonne « champs » de
`tests/reports/donnees/01-parcours-pages.json`).

| Page | Champs de saisie | Boutons | Opérations |
|---|---:|---:|---|
| `terrain/achats.html` | 18 | 21 | **C** achat · **R** file locale + référentiels · **D** achat (BM seul) · synchroniser · promouvoir un brouillon |
| `terrain/cash.html` | 14 | 16 | **C** avance, **C** réconciliation · **R** soldes RT |
| `terrain/sacs.html` | 12 | 14 | **C** mouvement de sacs · **R** stock |
| `fbms/index.html` | 1 (+ formulaire village en 9 sections, généré) | 29 | **CRUD complet** villages / RT / producteurs, photos, import, export, synchronisation bidirectionnelle |
| `fbms/fbms_hubs.html` | 7 | 10 | **R** + **U** coordonnées GPS des hubs |
| `fbms/audit_distances.html` | 9 | 13 | **R** + **U** distances validées |
| `logistique/alis_fbms.html` | 15 | 9 | **R** simulation · **U** barème tarifaire (`saveBareme`) |
| `terrain/command.html` | 8 | 24 | **R** seule + exports |
| `shared/admin.html` | 6 | 8 | **CRUD** comptes |
| `index.html` | 3 | 7 | Recherche et filtre de rôle (affichage uniquement) |

**Nombre total d'appels d'écriture dans le code servi** : 39 `insert`, 66 `upsert`, 75 `update`,
13 `rpc` (le comptage de `delete` est inexploitable, le mot apparaissant surtout comme
`delete objet.propriété` en JavaScript).

### Le geste métier le plus fréquent — la saisie d'un achat

C'est celui qui décide de la campagne. Sa chaîne complète, telle qu'observée :

1. `save('complet')` valide 12 règles métier côté client (village, RT, poids net > 0, prix > 0,
   sacs ≥ 1, reçu obligatoire, téléphone si producteur provisoire, humidité 0-20 %, KOR 0-100 %,
   motif obligatoire hors barème, paiement bancaire interdit, date non future).
2. L'enregistrement est empilé dans `localStorage["anagroci_achats"]` avec un `local_id`
   `crypto.randomUUID()` et le statut `pending`.
3. `syncAll()` — **en réalité trois implémentations empilées** (voir §6) — envoie
   `POST /rest/v1/achats?on_conflict=local_id` avec `Prefer: resolution=ignore-duplicates`.
4. La contrainte `local_id text unique` de `supabase/achats.sql:11` garantit l'idempotence.

Ce point est **le plus solide de l'application** : les tests T-INT-01, T-INT-03, T-INT-06,
T-INT-07, T-INT-11 et T-INT-12 confirment tous zéro duplication.

---

## 5. Modèle de données

**Tables et vues référencées depuis le code servi : 70.** Les plus sollicitées :

| Table | Références | Rôle |
|---|---:|---|
| `villages` | 21 | Référentiel central, colonne `data` en JSONB (9 sections `s1`…`s9`) |
| `profils` | 20 | Comptes et rôles — lue à **chaque chargement de page** |
| `rt` | 13 | Équipes Relais Terrain |
| `producteurs` | 13 | Producteurs enrôlés |
| `hubs_clusters` | 10 | Hubs et distances |
| `achats` | 6 | Transactions d'achat |
| `sacs_mouvements` | 5 | Sacherie |
| `rcn_*` | ≈ 30 tables | Module RCN TRACE |
| `farmer_*` | 12 | Passeport producteur (phase 1) |
| `aflp_ia_*` | 6 | Assistant IA |
| `audit_log` | 2 | Journal — **écrit à chaque ouverture de module** |

### Contraintes d'intégrité déclarées (`supabase/*.sql`)

| Contrainte | Effet | Vérifiée |
|---|---|---|
| `achats.local_id text unique` | Idempotence de la synchronisation | **Oui**, T-INT-03 |
| `achats.poids_net > 0`, `prix_kg > 0` | Garde-fous métier | Oui (code) |
| `avances.local_id`, `reconciliations.local_id` uniques | Idempotence caisse | Oui (code) |
| `farmer_identity_documents` — index unique partiel « une seule identité active » | Anti-doublon producteur | Oui (code) |
| `villages.farmer_code_prefix` unique | Unicité des préfixes de code | Oui (code) |
| `prod_code_seq` avec `on conflict(village_id) do update … returning` | Séquence de codes producteur **atomique** | Oui (code) — bonne pratique |
| **`achats.numero_recu`** | **AUCUNE contrainte** | **Oui — c'est le problème**, T-INT-02 |

### Champs de contrôle de concurrence

`villages`, `rt`, `producteurs` portent `updated_at`. Le client s'en sert comme jeton de
version (`_serverUpdatedAt`), mais la comparaison se fait **en JavaScript entre un SELECT et un
UPSERT distincts** (`fbms/index.html:1092-1112`) : ce n'est pas une écriture conditionnelle.
Conséquence mesurée : T-INT-08.

---

## 6. Chaîne de synchronisation — ce que l'exécution révèle

C'est le point de la cartographie qu'aucune lecture de code seule ne donne.

Sur `terrain/achats.html`, **trois implémentations de `syncAll` se superposent au chargement** :

| Ordre | Origine | Ce qu'elle fait |
|---|---|---|
| 1 | `terrain/achats.html:619` (page) | Filtre `pending`/`failed`, retire `recu_photo` du corps, envoie la photo au Storage via `uploadRecu()` |
| 2 | `terrain/achats_dropdown_patch.js:71` (correctif injecté) | **Remplace** la précédente. Filtre tout ce qui n'est pas `synced` (brouillons compris), supprime `kor` du corps, ne touche pas au Storage |
| 3 | `shared/anagroci-audit.js:156` (garde métier) | **Enveloppe** la précédente. Effectue elle-même l'envoi via `syncQueueWithErrors()`, puis appelle la couche 2 |

Ce qui part réellement sur le réseau — capturé sur la requête POST :

```
POST /rest/v1/achats?on_conflict=local_id
clés du corps : local_id, date, cluster, village_id, village_nom, rt_id, rt_nom,
producteur_id, producteur_nom, producteur_tel, producteur_ref, producteur_statut,
poids_brut, tare, poids_net, prix_kg, montant, prix_hors_bareme, motif_prix,
mode_paiement, numero_recu, nb_sacs, humidite, kor, rejet, observation,
recu_photo, recu_photo_url, commission_rt, …
```

`kor` est présent (la couche 2 ne s'exécute donc pas en premier) **et** `recu_photo` l'est aussi
— c'est-à-dire **la photo du reçu en base64, écrite dans une colonne de la table `achats`**,
alors que le commentaire de la page annonce « jamais de base64 dans la table ». Conséquence
mesurée : T-INT-14, et impact de charge chiffré au rapport 04.

Sur `fbms/index.html`, la synchronisation est un cycle complet toutes les 5 minutes
(`fbms/index.html:1586`) : suppressions différées, puis **une requête par fiche modifiée**,
puis relecture intégrale de `villages`, `rt`, `producteurs` et `parametres_calcul`.

---

## 7. Contrôle d'accès — état réel

`SECURITE.md` déclare : « Le verrou est posé sur : portail (`index.html`), ALIS, Audit distances,
Hubs, Carte, FBMS (`fbms/app.html`) ».

Vérification par lecture de chaque fichier HTML servi :

**14 pages sur 19 chargent `shared/auth-gate.js`. Cinq ne le chargent pas :**

| Page sans portail | Gravité | Remarque |
|---|---|---|
| **`fbms/index.html`** | **CRITIQUE** | C'est la cible de la tuile « REF · FBMS Référentiel » du portail. La passerelle protégée `fbms/app.html` existe bien, mais **le portail ne pointe pas vers elle** (`index.html:href:'fbms/index.html'`). |
| `logistique/index.html` | Haute | Écran logistique complet |
| `logistique.html` | Moyenne | Doublon de `logistique/ancien.html` |
| `logistique/ancien.html` | Moyenne | Page héritée toujours servie |
| `suite/index.html` | Moyenne | Ancien lanceur |

Constat d'exécution correspondant : ces cinq pages s'ouvrent **entièrement** pour les cinq
personas testés, **y compris le compte désactivé**, là où les 14 autres affichent soit l'écran
de connexion, soit « Accès non autorisé ». Détail et conséquences : rapport 07.

---

## 8. Dépendances externes

| Hôte | Ressource | Points d'usage | Criticité |
|---|---|---:|---|
| `cdn.jsdelivr.net` | `@supabase/supabase-js@2` (UMD) | 19 | **Bloquante** — sans lui, aucune page ne s'ouvre : `auth-gate.js` affiche « Impossible de charger le module de sécurité » |
| `cdn.jsdelivr.net` | `xlsx@0.18.5`, `chart.js@4` | — | Exports et graphiques |
| `unpkg.com` | `leaflet@1.9.4`, `lucide@latest` | 10 | Carte et icônes. **`lucide@latest` n'est pas épinglé** : une version publiée en amont peut changer le rendu sans aucun commit ici |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Archivo, IBM Plex | 18 / 9 | Typographie |
| `cdn.tailwindcss.com` | Tailwind (mode navigateur) | 3 | **Compilation du CSS dans le navigateur du client** — coût par chargement |
| `tile.openstreetmap.org` | Tuiles cartographiques | 1 | Carte |
| `t3/t4.ftcdn.net` | 10 photos de tuiles du portail | 10 | Décoratif, mais téléchargé à chaque ouverture du portail |
| `script.google.com` | Ancien backend Apps Script | 2 | Chemin de repli hérité, inactif en mode Supabase |

**Point de fragilité structurel** : l'application entière dépend de la disponibilité de
`cdn.jsdelivr.net`. Aucune copie locale de secours n'existe alors que le dépôt en héberge déjà
pour ses propres contrôles (`.github/vendor/doublures/`).

---

## 9. Couche PWA

| Fichier | Enregistré par | Portée effective | Politique |
|---|---|---|---|
| `i18n-sw.js` | `index.html:270` | `/fbms/` — **tout le site** | Intercepte **chaque navigation HTML**, force `cache: 'no-store'`, lit la réponse entière, y injecte deux balises `<script>` i18n, reconstruit la réponse. **Aucun repli sur cache** |
| `sw.js` | `fbms/index.html:5127` | `/fbms/fbms/` — le seul dossier `fbms/` | Réseau d'abord avec **repli sur cache** ; efface tous les caches à chaque activation |

Deux conséquences directes, mesurées au rapport 02 :

1. Toute page hors de `fbms/` est servie par `i18n-sw.js`, qui **ne sait pas répondre hors
   ligne** : `fetch(req, {cache:'no-store'})` échoue, le repli `fetch(req)` échoue aussi, et
   rien ne consulte `caches`. Le rechargement hors ligne de `terrain/achats.html` échoue donc.
2. `no-store` sur chaque navigation annule le cache HTTP de GitHub Pages : les 343 ko de
   `fbms/index.html` repartent du CDN à chaque ouverture.

`manifest.webmanifest` existe à la racine mais `fbms/index.html` le référence en relatif
(`./manifest.webmanifest`), donc cherche `fbms/manifest.webmanifest`, **404 réel** — défaut
déjà consigné dans les référentiels du dépôt (`liens-baseline.json`).

---

## 10. Ce qui n'a pas été cartographié

| Élément | Raison |
|---|---|
| Détail fonctionnel du module RCN TRACE (24 fichiers, ≈ 30 tables) | `NON RÉALISÉ` — volume comparable à celui de tout le reste de la suite ; nécessite sa propre campagne |
| Assistant IA AFLP (`shared/aflp-ia-*`, 350 ko) | `NON RÉALISÉ` — même raison |
| Passeport producteur (`shared/farmer-registry-*`, 130 ko) | `NON RÉALISÉ` — chargé dynamiquement sur `fbms/index.html` uniquement |
| Fonction Edge `admin-create-user` | `NON TESTÉ` — nécessite le projet Supabase |
| Volumétrie réelle des données de production | `NON CONFIRMÉ` — base injoignable. Les projections du rapport 04 utilisent donc des hypothèses explicites |
| Nombre réel de comptes actifs | `NON CONFIRMÉ` |
