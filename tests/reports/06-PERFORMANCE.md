# 06 — Performance frontend et demande client

**Exécution** : Chromium, 11 modules × 3 largeurs = 33 ouvertures instrumentées, chacune suivie
de **65 secondes d'observation au repos** (page ouverte, aucune interaction).
**Données brutes** : `tests/reports/donnees/03-performance.json`
**Rejouer** : `node tests/e2e/03-performance-demande.mjs`

Deux mesures très différentes cohabitent dans ce rapport ; les confondre conduirait à des
conclusions fausses.

| Mesure | Vaut-elle pour la production ? |
|---|---|
| **Poids, nombre de scripts, nœuds DOM, CLS, nombre de requêtes émises** | **Oui.** Ce sont les octets et le code réellement publiés. |
| **Temps de chargement (ms)** | **Non — ce sont des planchers.** Latence réseau ≈ 0 ici, CDN absent, bibliothèques tierces remplacées par des doublures légères. Le réel sera plus lent, jamais plus rapide. |
| **Demande réseau par utilisateur (req/min)** | **Oui.** Elle dépend du code, pas du serveur, et se multiplie directement par 100. |

---

## 1. Poids et structure des pages

Mesuré sur la largeur bureau. Les octets ci-dessous **excluent les bibliothèques tierces**
(remplacées par des doublures) : voir §2 pour le poids réel attendu.

| Module | Poids servi | dont JS | Scripts | dont **bloquants** | JS en ligne | Nœuds DOM | Requêtes API à l'ouverture |
|---|---:|---:|---:|---:|---:|---:|---:|
| **RCN TRACE** | **1 089 ko** | **1 040 ko** | **29** | 2 | 0 ko | 507 | **40** |
| Command Center | 684 ko | 548 ko | 14 | 1 | 36 ko | 986 | 9 |
| FBMS Référentiel | 593 ko | 221 ko | **21** | **7** | **325 ko** | 373 | 3 |
| Stock & Sacs | 395 ko | 317 ko | 10 | 1 | 0 ko | 166 | 13 |
| Achats Terrain | 237 ko | 155 ko | 8 | 1 | 27 ko | 283 | 9 |
| Caisse & Avances | 212 ko | 146 ko | 7 | 1 | 16 ko | 274 | 13 |
| ALIS Logistique | 209 ko | 160 ko | 8 | 1 | 7 ko | 189 | 8 |
| Hubs / Clusters | 208 ko | 146 ko | 8 | 2 | 15 ko | 183 | 6 |
| Audit Distances | 204 ko | 150 ko | 8 | 1 | 7 ko | 200 | 4 |
| Cartographie | 194 ko | 146 ko | 8 | 2 | 6 ko | 115 | 5 |
| Portail | 158 ko | 127 ko | 6 | 1 | 8 ko | 200 | 2 |

Deux valeurs sortent du lot :

- **RCN TRACE, 1,04 Mo de JavaScript en 29 fichiers.** Dont `sim-data.js` (346 ko),
  `rcntrace-ui.js` (206 ko), `rcntrace.js` (126 ko). Sur un téléphone d'entrée de gamme en 3G,
  c'est plusieurs dizaines de secondes avant le premier écran utile.
- **FBMS Référentiel, 325 ko de JavaScript écrit directement dans le HTML** et **7 scripts
  bloquants**. Un script bloquant suspend l'analyse du document : sept d'affilée, sur une
  liaison lente, se paient en attente écran blanc.

---

## 2. Ce que le banc ne pèse pas — et qu'il faut ajouter

Les bibliothèques tierces sont remplacées par des doublures de quelques centaines d'octets.
En production, chaque ouverture de page les télécharge depuis un CDN externe :

| Bibliothèque | Hôte | Pages concernées | Taille |
|---|---|---:|---|
| `@supabase/supabase-js@2` (UMD) | jsdelivr | 19 | **112 ko** (mesuré sur le paquet npm 2.47.10) |
| `leaflet@1.9.4` + CSS | unpkg | 2 | `NON MESURÉ` (hôte inaccessible) |
| `lucide@latest` | unpkg | 3 | `NON MESURÉ` — et **non épinglé** |
| `tailwindcss` (compilation dans le navigateur) | cdn.tailwindcss.com | 3 | `NON MESURÉ` — la compilation du CSS s'exécute **chez l'utilisateur** à chaque ouverture |
| `xlsx@0.18.5` | jsdelivr | 2 | `NON MESURÉ` |
| `chart.js@4` | jsdelivr | 1 | `NON MESURÉ` |
| Polices Archivo + IBM Plex (3 familles, 9 graisses) | Google Fonts | 18 | `NON MESURÉ` |
| 10 photos de tuiles | ftcdn.net | 1 (portail) | `NON MESURÉ` |

Le seul chiffre certain — 112 ko pour le SDK Supabase — suffit à déplacer chaque ligne du
tableau §1. Le poids réel du portail est donc **au moins 270 ko**, celui de RCN TRACE
**au moins 1,2 Mo**, avant polices et images.

**Dépendance bloquante** : sans `cdn.jsdelivr.net`, `shared/auth-gate.js` affiche « Impossible
de charger le module de sécurité (réseau) » et **aucune page ne s'ouvre**. La disponibilité de
l'application entière est suspendue à celle d'un CDN tiers, alors que le dépôt sait déjà héberger
des copies locales (`.github/vendor/`).

---

## 3. Repères de rendu (planchers)

| Module | Utilisable — mobile / tablette / bureau | LCP — mobile / tablette / bureau | CLS mobile | CLS bureau |
|---|---|---|---:|---:|
| Portail | 154 / 152 / 154 ms | 92 / 124 / 148 ms | 0 | 0,005 |
| Achats Terrain | 181 / 188 / 201 ms | 112 / 224 / 236 ms | 0 | 0,053 |
| **Stock & Sacs** | 202 / 252 / 221 ms | 152 / 172 / 180 ms | **0,374** | 0,052 |
| Caisse & Avances | 183 / 184 / 186 ms | 104 / 116 / 128 ms | 0 | 0,038 |
| Command Center | 201 / 224 / 223 ms | 116 / 156 / 148 ms | 0 | 0,055 |
| FBMS Référentiel | 181 / 186 / 181 ms | 152 / 116 / 112 ms | 0 | 0,071 |
| Cartographie | 143 / 149 / 175 ms | 88 / 96 / 112 ms | 0 | 0,040 |
| Hubs / Clusters | 138 / 187 / 176 ms | 88 / 96 / 92 ms | 0 | 0,017 |
| Audit Distances | 157 / 159 / 172 ms | 100 / 112 / 120 ms | 0 | 0,035 |
| ALIS Logistique | 165 / 189 / 179 ms | 88 / 116 / 108 ms | 0 | 0,040 |
| **RCN TRACE** | 169 / 186 / 166 ms | 184 / 200 / 196 ms | 0 | **0,161** |

« Utilisable » = instant où le portail d'authentification se lève et où l'écran devient
manipulable. Médiane 181 ms, p95 224 ms — **en réseau local, sans les bibliothèques tierces**.

### Deux dépassements réels de seuil

- **Stock & Sacs sur mobile 390×844 : CLS = 0,374.** Le seuil « bon » de Core Web Vitals est
  0,1 ; au-delà de 0,25 la note est « mauvaise ». Concrètement : la page bouge sous le doigt
  pendant le premier demi-seconde. Sur un écran de saisie de mouvements de sacs, un décalage de
  mise en page au moment où l'opérateur appuie fait toucher le mauvais bouton.
- **RCN TRACE sur bureau : CLS = 0,161.** Au-delà du seuil, cohérent avec ses 29 scripts qui
  injectent leur interface au fur et à mesure.

**INP** : `NON MESURÉ`. Cette mesure exige une interaction utilisateur réelle et une
instrumentation dédiée qui n'a pas été mise en place dans cette campagne.

---

## 4. Demande client : combien un utilisateur coûte-t-il par minute ?

C'est le chiffre qui sert au dimensionnement, et il ne dépend pas du serveur.

### 4.1 À l'ouverture d'une page

| Module | Requêtes backend à l'ouverture | Dont |
|---|---:|---|
| RCN TRACE | **40** | 4 × `profils`, 31 tables `rcn_*` distinctes, 1 **écriture** `POST rcn_jute_locations`, 1 `POST audit_log` |
| Stock & Sacs | 13 | référentiels + `sacs_mouvements` |
| Caisse & Avances | 13 | `avances`, `reconciliations`, `achats`, `rt` |
| Achats Terrain | 9 | `profils`, `villages`, `rt`, `producteurs`, `avances`, `audit_log` |
| Command Center | 9 | agrégats multi-tables |
| ALIS Logistique | 8 | 6 tables de paramétrage tarifaire |
| Hubs / Clusters | 6 | |
| Cartographie | 5 | |
| Audit Distances | 4 | |
| FBMS Référentiel | 3 | `profils`, `villages`, `rt` |
| Portail | 2 | `profils`, `audit_log` |

**Trois observations tirées de ces chiffres :**

1. **`profils` est lu 4 fois à l'ouverture de RCN TRACE.** Chaque bibliothèque de la page crée
   son propre client Supabase — Chromium le signale explicitement :
   « *Multiple GoTrueClient instances detected in the same browser context* ». Chaque client
   relit le profil et gère son propre rafraîchissement de jeton.
2. **RCN TRACE écrit en base au simple chargement de la page** (`POST rcn_jute_locations`).
   Ouvrir un écran ne devrait pas produire d'écriture métier.
3. **Chaque ouverture de module écrit dans `audit_log`.** C'est voulu et légitime, mais cela
   compte : 100 utilisateurs ouvrant 5 modules dans la journée = 500 écritures d'audit.

### 4.2 Au repos, page ouverte, sans aucune interaction

| Module | Requêtes / minute | Mécanisme |
|---|---:|---|
| **Cartographie** | **9** | Mesuré : 9 requêtes en 65 s, soit 3 cycles de 3 requêtes, identique aux trois largeurs. `setInterval(load, 20000)` relit `parametres_calcul`, `villages` et `hubs_clusters` toutes les 20 s → 3 cycles/minute en régime établi. S'y ajoute un abonnement Realtime `postgres_changes` sur `villages` et `hubs_clusters`. |
| FBMS Référentiel | 0 sur 65 s | Cycle de synchronisation complet toutes les **5 minutes** (`autoIntervalMin: 5`) — hors fenêtre d'observation |
| Command Center | 0 | `setInterval(renderLocal, 30000)` et `majFraicheur` à 60 s sont **locaux**, sans réseau — bon point |
| Tous les autres | 0 | Aucun rafraîchissement automatique |

> **Note de méthode.** La mesure de la Cartographie a d'abord donné 0 req/min : la doublure
> Leaflet du dépôt n'implémente pas `createPane`, ce qui interrompait le script de la page dès
> sa troisième instruction. Une doublure plus complète (`tests/bench/doublure-leaflet.js`) a été
> écrite pour que le script s'exécute entièrement, et la mesure refaite. Sans cette correction,
> la charge de la page cartographique aurait été comptée pour zéro.

### 4.3 Ce que cela donne à 100 utilisateurs

| Situation | Calcul | Requêtes / seconde |
|---|---|---:|
| 100 utilisateurs ouvrent RCN TRACE dans la même minute (début de journée) | 100 × 40 / 60 s | **67 req/s** en pic |
| 20 utilisateurs laissent la Cartographie ouverte | 20 × 9 / 60 s | 3 req/s **en permanence** |
| 100 utilisateurs laissent la Cartographie ouverte | 100 × 9 / 60 s | **15 req/s en permanence, sans qu'aucun ne touche à rien** |
| 100 utilisateurs sur FBMS Référentiel, synchronisation automatique | 100 cycles / 5 min, chacun = 4 lectures intégrales + 1 requête par fiche modifiée | **rafales** de 1 300 requêtes toutes les 5 min, si chaque utilisateur a 10 fiches modifiées |

Le dernier cas est le plus préoccupant : `syncNow` envoie **une requête HTTP par fiche
modifiée**, en série (`fbms/index.html:1730`), puis relit intégralement `villages`, `rt`,
`producteurs` et `parametres_calcul`. Aucun envoi par lot alors que PostgREST accepte
nativement un tableau d'objets.

---

## 5. Requêtes redondantes et motifs coûteux

| Motif | Où | Coût |
|---|---|---|
| **N+1 à la synchronisation** | `fbms/index.html:1730` — boucle `for (const v of locals) await RemoteVillages.upsert(v)` | 1 requête par fiche, en série. 50 fiches modifiées = 50 allers-retours séquentiels |
| **N+1 au contrôle de conflit** | `fbms/index.html:1092` — chaque `upsert` est précédé d'un `select` de contrôle | **double** le nombre de requêtes d'écriture |
| **Lecture intégrale sans pagination** | `villages`, `rt`, `producteurs`, `achats` sont lus **en entier** partout | À 5 000 villages et 50 000 achats, chaque ouverture de page rapatrie la table complète |
| **`select *` sur `achats`** | Command Center, exports | Rapatrie la colonne `recu_photo` en base64 (BUG-008) : 80 à 270 ko **par ligne** |
| **4 clients Supabase par page** | RCN TRACE | 4 lectures de `profils`, 4 rafraîchissements de jeton, contention sur le verrou de session |
| **`cache: 'no-store'` sur chaque navigation** | `i18n-sw.js:12` | Annule le cache HTTP de GitHub Pages ; les 343 ko de `fbms/index.html` repartent du CDN à chaque ouverture |
| **`lucide@latest` non épinglé** | 3 pages | Une publication amont peut modifier le rendu sans aucun commit ici |
| **Tailwind compilé dans le navigateur** | 3 pages | Coût processeur chez l'utilisateur à chaque ouverture, sur des téléphones de terrain |

---

## 6. Mobile et réseau dégradé

| Vérification | Résultat |
|---|---|
| Débordement horizontal, 390×844 | **0 sur 95 ouvertures** — la mise en page tient |
| Débordement horizontal, 768×1024 et 1440×900 | 0 |
| Rendu tactile (`isMobile`, `hasTouch`) | Aucune erreur spécifique au mobile |
| Zones tactiles < 44 px | `NON MESURÉ` dans cette campagne — la porte du dépôt `verifier-pages.mjs` le fait déjà |
| Réseau lent (4G / 3G / 2G) | **Mesuré** — voir le tableau ci-dessous |
| Perte temporaire de réseau | **Mesuré** — rapport 02 et 03 (T-INT-06), et couche PWA au rapport 05 |

### Temps avant qu'un écran devienne manipulable, par qualité de liaison

Débit et latence appliqués par le protocole DevTools de Chromium, plus une latence serveur
injectée dans l'émulateur. Viewport 390×844. **Les bibliothèques tierces sont remplacées par des
doublures légères : en production, ces temps seront plus longs, jamais plus courts.**

| Profil | Portail | Achats Terrain | **RCN TRACE** | Enregistrer un achat |
|---|---:|---:|---:|---:|
| Référence (local, 0 ms) | 124 ms | 199 ms | 145 ms | 100 ms |
| 4G correcte (9 Mb/s, 60 ms + 40 ms serveur) | 268 ms | 407 ms | 1 108 ms | 94 ms |
| 3G de brousse (780 kb/s, 300 ms + 150 ms serveur) | 2 008 ms | 1 965 ms | **11 250 ms** | 93 ms |
| 2G / EDGE (240 kb/s, 800 ms + 400 ms serveur) | 6 275 ms | 5 585 ms | **36 172 ms** | 99 ms |

Trois lectures :

1. **L'enregistrement d'un achat ne dépend pas du réseau** — 93 à 100 ms quelle que soit la
   liaison. C'est la conséquence directe du choix « local d'abord », et c'est un très bon point :
   l'agent n'attend jamais le serveur pour valider une pesée.
2. **Achats Terrain reste praticable jusqu'en 3G** (2 s) et devient pénible en 2G (5,6 s).
3. **RCN TRACE devient inutilisable dès la 3G** : 11 secondes avant le premier écran, 36 secondes
   en 2G. Un agent en zone de collecte n'attendra pas. Ces 1,04 Mo de JavaScript en 29 fichiers
   ne sont pas un problème de confort : ils rendent le module inaccessible là où il devrait
   servir.

---

## 7. Récapitulatif des points de performance

| # | Constat | Gravité | Effort de correction |
|---|---|---|---|
| P-1 | RCN TRACE : 40 requêtes et 1,04 Mo de JS — **11 s avant le premier écran en 3G, 36 s en 2G** | **HIGH** | Élevé (découpage du module) |
| P-2 | `syncNow` : une requête par fiche, en série, doublée par le contrôle de conflit | HIGH | Moyen (envoi par lot) |
| P-3 | Photos de reçus en base64 dans la table `achats` | HIGH | Faible (unifier la synchronisation, BUG-009) |
| P-4 | Cartographie : 9 req/min par utilisateur en permanence | MEDIUM | Faible (allonger l'intervalle, s'appuyer sur le Realtime déjà présent) |
| P-5 | 4 clients Supabase sur une même page | MEDIUM | Moyen (client partagé) |
| P-6 | CLS 0,374 sur Stock & Sacs mobile | MEDIUM | Faible (réserver la hauteur des blocs) |
| P-7 | Aucune pagination sur les lectures de référentiel | MEDIUM | Moyen |
| P-8 | Dépendance bloquante à jsdelivr, `lucide@latest` non épinglé | MEDIUM | Faible (héberger localement) |
| P-9 | `no-store` sur chaque navigation annule le cache du CDN | LOW | Faible |
| P-10 | 7 scripts bloquants sur FBMS Référentiel | LOW | Faible (`defer`) |
