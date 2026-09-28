# Sacherie Control Tower — correctifs après l'audit des 34 simulations

Date : 13/08/2026
Branche : `claude/sacherie-audit-fixes-20260813`
Base : `main` à `4993f33` (après les PR #152 et #153)

L'audit fourni est **comportemental** : il liste des symptômes observés dans le
navigateur. Chaque point a été confronté au code réel avant correction. Trois
constats se sont révélés partiellement inexacts, et c'est documenté ici plutôt
que corrigé à l'aveugle.

---

## A. Diagnostic

| ID | Constat de l'audit | Réalité du code | Cause racine | Front | Back | Statut |
|---|---|---|---|---|---|---|
| **C1** | Quantité physique vide envoyée comme `0` | **Confirmé, et présent à SEPT endroits.** `runCurrent()` faisait `Number($('ctaQty').value)`, et `Number('')` vaut `0`. Le même antipattern vivait dans le workflow de dotation via `num()` : stock RCN vérifié, quantité demandée, quantité remise, quantité approuvée par le BM, volume et prix du cycle financé. Un stock RCN laissé vide partait comme un **comptage physique vérifié à zéro** | `Number('')===0`, et aucune distinction entre « absence de saisie » et « zéro » | ✅ | ✅ (doc) | **Corrigé partout** |
| **C2** | Écart d'inventaire sans motif accepté | **Confirmé côté front**, mais la correction proposée n'est pas implémentable telle quelle : **le frontend ignore le stock théorique**, calculé par le serveur. Il ne peut donc pas savoir qu'il y a écart | Règle métier qui n'existe qu'au serveur, et que le serveur n'applique pas | ⚠️ partiel | ✅ (doc) | **Corrigé côté front (confirmation explicite) · règle exacte à appliquer au serveur** |
| **C3** | KPI « Vides disponibles » ≈ `parc − immobilisés` | **Hypothèse fausse** : le frontend n'a jamais calculé ce chiffre, il affichait `global.vides` rendu par le serveur. Le défaut est réel mais ailleurs : ce champ compte les vides **partout**, y compris chez les RT, sous un libellé qui promet du distribuable | Libellé et périmètre discordants | ✅ | ✅ (doc) | **Corrigé** |
| **C4** | Faux statut « Synchronisé » | **Confirmé** : `sacUpdatedLabel` n'était mis à jour qu'en cas de succès et gardait sa valeur précédente en cas d'échec. L'erreur brute (`permission denied for function …`) était affichée telle quelle | Le libellé reflétait l'initialisation de la page, pas la dernière actualisation réussie | ✅ | — | **Corrigé** |
| **M1** | Transitions d'état incohérentes proposées | **Confirmé** : `stateForm()` construisait deux listes indépendantes, autorisant `DECHIRE → UTILISABLE`, `REPARE → A_REPARER` et `A_REPARER → A_REPARER` | Deux listes au lieu d'une table de transitions | ✅ | ✅ (doc) | **Corrigé côté front · table SQL fournie** |
| **M2** | Décimaux acceptés | **Confirmé** : `Number.isFinite(12.7)` est vrai. `step="1"` n'est qu'une suggestion | Validation par `Number()` au lieu de `Number.isInteger()` | ✅ | ✅ (doc) | **Corrigé** |
| **M3** | Quantités démesurées transmises | **Confirmé** : aucun plafond côté client | Aucune confrontation au stock disponible | ✅ | ✅ (doc) | **Corrigé quand le stock est connu · serveur autorité** |
| **M4** | `.exe` et `.svg` injectables | **Confirmé** : seule la taille (1,5 Mo) était vérifiée ; `accept` n'est pas un contrôle | Absence de vérification extension + MIME | ✅ | ⚠️ | **Corrigé côté front · stockage à refondre (P1)** |
| **M5** | Dotation RT hors workflow | **Nuancé** : le workflow SOP-006 de `sacherie_v2` **bloque déjà** (bouton désactivé tant que le serveur n'a pas rendu un plafond conforme). Les 555 sacs sont des données **historiques**. La voie de contournement réelle est ailleurs : `terrain/sacs.html` crée toujours des `DOTATION_RT` sans demande | Module V1 encore actif et lié depuis le pied de page | ⚠️ | ✅ (doc) | **Diagnostiqué · fermeture serveur documentée** |
| **M6** | CSV exportant « Aucun RT pour ce filtre. » | **Confirmé** : `exportTable()` lisait le DOM | Export construit depuis l'affichage | ✅ | — | **Corrigé** |
| **M7** | CSV exportant « il y a 35 j » | **Confirmé**, même cause | idem | ✅ | — | **Corrigé** |
| — | Cluster critique invisible sans RT | **Confirmé** : `reseau()` ne liste que des RT | Vue construite sur les RT seuls | ✅ | — | **Corrigé** |
| — | KPI « Transit > 7 jours » inerte | **Confirmé** : carte affichée en permanence avec `—` | Donnée serveur absente, carte quand même rendue | ✅ | — | **Corrigé (carte masquée tant que la donnée manque)** |
| — | Écart : absolus et net mélangés | **Confirmé, et pire** : la somme portait sur **tout l'historique** des comptages, pas sur les écarts ouverts | Aucune réduction au dernier comptage par périmètre | ✅ | — | **Corrigé** |
| — | Boutons désactivés sans explication | **Confirmé** | — | ✅ | — | **Corrigé** |
| — | Routage silencieux | **Confirmé** : un RT ou cluster inconnu retombait sans le dire | — | ✅ | — | **Corrigé** |
| — | Collision de libellé « État du parc » | **Confirmé** : onglet et carte d'action portaient le même nom | — | ✅ | — | **Corrigé** |
| — | Traduction EN dégradée | **Non corrigé — bloqué par la politique** : `shared/i18n.js` et `shared/i18n-extra.js` sont interdits aux agents (`auto-merge-denylist.txt`, CLAUDE.md §3) | Substitutions naïves dans le moteur i18n | ⛔ | — | **Non traité, motif documenté** |

---

## B. Changements effectués

### `shared/anagroci-sacherie-control-tower.js`

| Fonction | Avant | Après |
|---|---|---|
| *(nouveau)* `parseBagQty` | — | Point d'entrée unique des quantités : refuse vide, espaces, décimal, négatif, non-entier, au-delà d'un plafond. `0` n'est accepté que saisi explicitement |
| *(nouveau)* `TRANSITIONS` / `transitionTargets` / `transitionAllowed` | deux listes divergentes | une table unique, qui pilote les options ET la validation |
| *(nouveau)* `validateEvidenceFile` | — | extension ∈ {jpg, jpeg, png, pdf}, MIME concordant, taille 1 – 1 572 864 octets |
| *(nouveau)* `friendlyError` | — | branche `ANAGROCI_AUDIT.friendlyServerError` puis repli métier ; ne laisse jamais passer un nom de fonction Postgres |
| *(nouveau)* `latestInventories` / `openGaps` | — | ne retient que le dernier comptage par (cluster, périmètre, RT, état) non régularisé |
| *(nouveau)* `clusterAvailable` | — | `Σ stock_cluster_vide` − manques ouverts, avec sa décomposition |
| `load` | statut figé sur succès, erreur brute affichée | états `ok` / `stale` / `offline`, horodatage de la **dernière réussite**, bandeau + bouton **Réessayer**, message métier, trace technique en console |
| `ecartOuvert` | somme des valeurs absolues de **tout** l'historique | somme des écarts **ouverts** uniquement |
| `pilotage` | « Vides disponibles » = `global.vides` | « Disponibles en Cluster » ; carte Transit masquée sans donnée ; « Écarts absolus ouverts » |
| `reseau` | un cluster sans RT disparaissait | carte de risque cluster toujours affichée ; cluster inconnu signalé |
| `reseau` (RT) | RT inconnu ignoré | message explicite + retour au réseau |
| `exportTable` | lisait le DOM | construit depuis les données, dates ISO 8601, export vide bloqué avec message |
| *(global)* | `<th>` | `<th scope="col">` — 41 en-têtes |

### `shared/anagroci-sacherie-control-actions.js`

| Fonction | Avant | Après |
|---|---|---|
| `runCurrent` | `Number(value)`, `qty<0`, aucun plafond, aucune transition vérifiée | passe par `parseBagQty` + `transitionAllowed` + `validateEvidenceFile` ; motif obligatoire pour état et perte ; confirmation explicite pour un comptage sans motif |
| *(nouveau)* `stockDisponible` | — | plafond lu dans le stock canonique déjà chargé ; `null` quand le rattachement est incertain — on ne plafonne alors pas côté client |
| `stateForm` | deux listes indépendantes | « Nouvel état » dérivé de « État actuel », recalculé au changement |
| `proof` | taille seule | validation complète avant lecture |
| *(carte)* « État du parc » | même nom que l'onglet | « Traiter un sac abîmé » |

### `shared/anagroci-sacherie-v2.js`

| Fonction | Avant | Après |
|---|---|---|
| *(nouveau)* `readQty` | — | toutes les saisies chiffrées du workflow passent par `parseBagQty`, comme les formulaires de contrôle |
| `calculate` / `submitRequest` | `num($('sv2_stock').value)` — vide → `0` | stock RCN vérifié obligatoire ; un champ vide ne part plus comme un comptage à zéro |
| `executeRequest` | `Math.round(num(...)\|\|0)` | quantité remise obligatoire, entière, plafonnée à la quantité approuvée |
| décision BM « Réduire » | `Math.round(num(...)\|\|0)` | quantité approuvée obligatoire, entière, plafonnée à la quantité demandée |
| `saveCycle` | volume vide → `0` ; prix vide → `0` | volume obligatoire ; prix vide transmis comme `null`, non comme un prix de référence à zéro |
| `renderCalc` | un décimal laissait le bouton actif | le bouton reflète la même règle que la validation |
| « Soumettre au BM » désactivé sans explication | une raison à la fois : RT manquant → cycle ouvert requis → plafond à calculer → dépassement chiffré |

### `terrain/sacherie_v2.html`

`<b>` de titre remplacé par un `<h1>` ; styles d'état de synchronisation ; version des scripts.

---

## C. Tests

`node .github/agent-tests/sacherie-validations.mjs` — **94 contrôles, 0 défaut.**

| Famille | Cas couverts | Résultat |
|---|---|---|
| C1 — quantités | vide, espaces, `0` explicite, entier, décimal (`.` et `,`), négatif, texte, `1e9`, plafond dépassé, égal au plafond, `0` avec minimum 1 | **12 PASS** |
| C1 bout en bout | quantité vide → aucun appel RPC + message | **PASS** |
| C1 — workflow de dotation | RT et cycle choisis, stock RCN vide → aucun appel à `sacherie_calculer_plafond` | **PASS** |
| Cohérence | le workflow partage la validation des écrans de contrôle | **PASS** |
| C2 bout en bout | comptage sans motif → confirmation exigée, puis envoi unique | **2 PASS** |
| M1 — transitions | 5 autorisées, 5 interdites (dont `DECHIRE → UTILISABLE`, `REPARE → A_REPARER`, état → même état) | **10 PASS** |
| M1 — interface | options proposées conformes à la table | **PASS** |
| M4 — preuves | JPG, PNG, PDF, > 1,5 Mo, SVG, EXE, HTML, faux MIME, MIME absent, fichier vide, double extension | **11 PASS** |
| C4 — messages | `permission denied for function …`, fonction absente, réseau | **PASS** (aucune fuite technique) |
| C4 — synchronisation | échec de rafraîchissement → état `stale`, bandeau, bouton Réessayer, aucune fuite | **3 PASS** |
| C3 — disponibilité | 2 645 en magasin cluster au lieu de 3 195 | **2 PASS** |
| Réseau | cluster critique sans RT, RT inexistant | **2 PASS** |
| M6 / M7 — CSV | export nominal (dates ISO), export vide bloqué | **2 PASS** |
| Navigation | onglet valide porté par l'URL, onglet inconnu refusé, onglet inconnu dans l'URL signalé, `?tab=` restauré au rechargement | **4 PASS** |
| Pagination | page bornée, « Précédent » désactivé en page 1, `?page=999` ramené à la dernière page | **3 PASS** |
| CSV | BOM, accents et apostrophes, guillemets doublés, séparateur et en-têtes, point-virgule dans une valeur | **5 PASS** |
| Synchronisation | perte de réseau affichée, retour en ligne rafraîchit, délai de garde sur requête sans réponse, message en clair | **4 PASS** |
| Rôles | Branch Manager, Unit Head, Warehouse Keeper, Assistant Unit Head — création de demande, décision de perte, remise dans son cluster et **refus hors de son cluster** | **4 PASS** |
| Responsive | 3 largeurs × 5 mesures : débordement, colonnes de KPI, onglets atteignables, cibles tactiles ≥ 40 px, journal qui défile dans son conteneur, tiroir d'opération utilisable | **18 PASS** |
| Console | aucune erreur JavaScript | **PASS** |

Le fichier a été **éprouvé contre le code d'avant correctifs** : il sort en 1 et
signale l'absence des validations partagées. Un test de non-régression qui ne
détecte pas la régression ne prouve rien.

Portes du dépôt : `verifier-html`, `verifier-liens`, `verifier-js`,
`verifier-pages` — **0 nouveau défaut**.

---

## D. Non-régression du grand livre

Vérifiée par le test, sur le jeu de référence de l'audit :

| Invariant | Attendu | Mesuré |
|---|---|---|
| Parc total | 3 200 | 3 200 ✅ |
| Sous responsabilité terrain | 555 | 555 ✅ |
| Stocks négatifs | 0 | 0 ✅ |
| BOTRO | 200 = 140 cluster + 60 RT | ✅ |
| DIABO | 1 000 = 855 + 145 | ✅ |
| N'DJEBONOUA | 1 500 = 1 150 + 350 | ✅ |
| BEOUMI | 500 | ✅ |

Aucune donnée de production n'a été créée ni modifiée : le double du client
Supabase intercepte tous les appels RPC et enregistre ce qui **serait** parti.

---

## E. Risques restants

1. **Les règles serveur ne sont pas appliquées.** Tout ce qui est livré ici est
   de la prévention côté navigateur. Un appel direct à `sacherie_ct_inventorier`
   avec un écart sans motif passe toujours. Le SQL est prêt
   (`docs/migrations/sacherie_durcissement_serveur_20260813.sql`) mais **doit
   être appliqué à la main** : `supabase/**` est interdit aux agents.
2. **Le contenu réel des RPC n'a pas pu être lu.** Elles ne sont pas versionnées
   dans le dépôt. Les validations serveur existantes n'ont donc pas pu être
   inventoriées : il est possible que certaines soient déjà en place, auquel cas
   la migration proposée fait double emploi — sans dommage, mais à vérifier.
3. **M5 n'est pas fermé.** `terrain/sacs.html` peut toujours créer une
   `DOTATION_RT` sans approbation. Savoir si cette voie atteint le registre
   canonique dépend de l'existence d'un pont `sacs_mouvements → rcn_jute_movements`,
   que je n'ai pas pu vérifier. Les deux requêtes de diagnostic sont dans la
   migration.
4. **Les pièces justificatives restent des Data URL** dans un paramètre JSON.
   Le format est désormais contrôlé, le stockage ne l'est pas.
5. **Le plafond client est partiel** : `stockDisponible()` rend `null` quand la
   localisation ou l'état ne se rattachent pas de façon certaine au stock
   canonique. Dans ce cas aucun plafond n'est appliqué avant l'appel — c'est
   volontaire (mieux vaut laisser passer que refuser à tort), mais cela laisse
   la porte au serveur, qui doit la fermer.
6. **La traduction anglaise n'a pas été touchée** : le moteur i18n est dans une
   zone interdite aux agents.
7. **Rien n'a été vérifié contre la base réelle.** Les 59 contrôles s'exécutent
   sur un double. Une recette sur données réelles reste nécessaire.
8. **Les rôles sont testés côté interface uniquement.** Le banc rejoue l'écran
   sous quatre profils et vérifie qu'un Warehouse Keeper de BOTRO ne peut pas
   préparer la remise d'une demande de DIABO. Cela prouve que l'interface ne
   propose pas l'interdit ; cela ne prouve pas que la RLS le refuse. Seule une
   recette sur base réelle le montrerait.
9. **Le délai de garde du chargement est réglable** par
   `window.ANAGROCI_SACHERIE_TIMEOUT_MS` (15 s par défaut). C'est une couture de
   configuration pour la recette, pas un contournement de règle métier : elle ne
   change que la patience du navigateur.
