# Command Center BM — navigation en huit onglets à un seul niveau

**Date** : 16 août 2026 · **Portée** : `terrain/command.html`, plus une ligne
additive dans `shared/aflp-ia-predictif-ui.js` et des entrées de dictionnaire
dans `shared/i18n.js` et `shared/i18n-extra.js`.

> **Aucune règle métier n'a été modifiée.** Les mêmes tables sont interrogées,
> avec les mêmes colonnes ; les agrégats, les seuils, la liste des anomalies, le
> calcul du risque, la file locale et les appels aux modules AFLP sont repris à
> l'identique. Le `Promise.all` des sept tables n'a pas bougé d'une ligne.

Ce document remplace, pour la partie navigation,
[`command_center_refonte_ux_20260816.md`](command_center_refonte_ux_20260816.md).
Le raisonnement de fond de ce dernier — **SITUATION → RISQUE → ACTION →
ANALYSE** — reste valable et dicte l'ordre des onglets.

---

## 1. Ce qui n'allait toujours pas

La refonte précédente avait ramené la page de 5 047 à 2 557 pixels en groupant
et en repliant. Elle laissait cependant **tout le contenu dans une seule vue à
défilement** : un BM cherchant l'état de la caisse traversait encore les KPI,
les anomalies, les clusters et le référentiel. Le repli aidait, mais un panneau
replié reste un obstacle sur le chemin d'un autre.

Deux sujets, en outre, n'avaient pas de place à eux : **la caisse** et **les
sacs**. Leurs chiffres existaient — ils étaient calculés à chaque chargement —
mais n'apparaissaient que fondus dans un KPI ou une colonne de tableau.

## 2. Huit onglets, un seul niveau

Un onglet, un sujet. Le panneau actif est le seul présent : les sept autres
portent `hidden`, donc ils ne sont ni peints, ni lus par un lecteur d'écran, ni
atteignables au clavier.

| # | Onglet | Question du BM | Contenu | Ancre |
|---|---|---|---|---|
| 1 | **Synthèse** | Que dois-je savoir maintenant ? | 4 KPI · Ce qui bouge aujourd'hui · Périmètre du jour · encart dérive | `#sec-synthese` |
| 2 | **À traiter** | Qu'est-ce qui exige mon intervention ? | Anomalies priorisées · File locale & synchronisation | `#sec-traiter` |
| 3 | **Terrain & clusters** | Où en sont les clusters ? | Par cluster · Référentiel terrain · Zones AFLP | `#sec-terrain` |
| 4 | **Contrôle & risques** | Quelles équipes appellent une action ? | RT à risque · Dérive · Contrôles ouverts | `#sec-risques` |
| 5 | **Caisse & avances** | Où est l'argent ? | 3 tuiles · Avances par équipe RT | `#sec-caisse` |
| 6 | **Stock & sacs** | Où sont les sacs ? | 3 tuiles · Sacs par cluster | `#sec-sacs` |
| 7 | **Assistant IA** | Que me dit l'assistant ? | Puces d'action · carte réponse · non-opposabilité | `#sec-ia` |
| 8 | **Prévisions AFLP** | Que disent les modèles ? | Bandeau SHADOW_ONLY · 8 analyses en cartes | `#sec-previsions` |

L'Assistant IA reste **avant** les Prévisions, pour la raison déjà retenue : le
quotidien précède l'occasionnel.

### Les ancres en circulation sont conservées

Les six identifiants de l'architecture précédente sont repris **à l'identique**.
Un lien existant vers `command.html#sec-terrain` ouvre l'onglet correspondant au
lieu de faire défiler. Deux ancres s'ajoutent : `#sec-caisse`, `#sec-sacs`.

L'onglet actif est écrit dans l'URL par `history.replaceState` — *replace* et
non *push* : changer d'onglet n'est pas une navigation, et le bouton
« précédent » doit ramener à la page d'avant, pas rejouer huit onglets. Un
rechargement, lui, retrouve bien l'onglet. Une ancre inconnue retombe sur le
premier onglet sans écran blanc.

## 3. Ce qui a été retiré

Un onglet ne défile pas. Toute la mécanique construite pour le défilement perd
son objet et a été supprimée, pas neutralisée :

- l'espion de défilement (`espionnerDefilement`) et son verrou anti-clignotement ;
- `allerA`, `centrerPill`, `activerPill` ;
- `majEspaceur` et `#ccSpacer` — la marge de fin de page calculée pour que la
  dernière section puisse remonter sous les en-têtes collants ;
- la mécanique de repli `.fold` / `basculer` / `initReplis` et sa persistance
  `localStorage`, les deux gros modules ayant désormais chacun leur onglet.

## 4. Deux onglets nouveaux, aucune requête nouvelle

**Caisse & avances** et **Stock & sacs** n'interrogent rien de plus. Ils
réutilisent des agrégats que `loadAll` produisait déjà et n'exposait pas sous
cet angle :

| Onglet | Source déjà calculée |
|---|---|
| Caisse & avances | `avByRt`, `payeByRt`, `reconByRt`, `totalAv`, `soldeGlobal` |
| Stock & sacs | `sacClus`, `sacRtTot`, `sacClusTot`, `dech` |

La colonne **Part** est la seule grandeur dérivée : c'est le même agrégat
« sacs cluster » exprimé en pourcentage du total affiché. Une mise en forme, pas
un indicateur.

## 5. Les zones AFLP sont lues, jamais recalculées

La répartition GBEKE 1 / GBEKE 2 appartient à `shared/aflp-ia-moteur.js`. La
page la relit par `AFLP_IA_UI.etatCourant().etat.clusters[].zone` au lieu d'en
recopier une seconde table : **deux tables pour une même vérité finissent
toujours par diverger**. Si le moteur n'a pas encore tourné, la zone vaut « — »
et rien n'est inventé. Le libellé « répartition à confirmer » reflète
`referentiel.zonesConfirmees`, comme dans le moteur.

## 6. Prévisions : une grille de cartes qui pilote le module

Le module `AFLP_PRED_UI` garde la charge de calculer **et d'afficher** chaque
analyse. La page se contente de remplacer son ruban d'onglets par une grille de
huit cartes ; chaque carte déclenche l'onglet correspondant du module. Son ruban
et son bandeau violet sont masqués par CSS depuis cette page — même technique
que le `#aflpPred > h2` déjà en place.

**Les libellés des cartes sont lus sur les boutons du module**, pas recopiés.
Recopiés, ils divergeraient au premier renommage côté module.

Les cartes ne portent pas de ligne d'état par analyse : le module n'expose
qu'un verdict global (`resume()`). Écrire « série trop courte » sous une carte
aurait été inventer un texte que rien ne produit.

## 7. La ligne ajoutée hors de la page

`shared/aflp-ia-predictif-ui.js` — `resume()` expose désormais `derive` :

```js
derive: ANALYSE.derive || null
```

Purement additif : aucun appelant existant n'est affecté, rien n'est calculé,
c'est l'objet déjà produit par `derive(dataset)`. Sans lui, l'encart « dérive »
des onglets 1 et 4 n'avait pas accès au motif rédigé par le moteur
(« Historique inférieur à 56 jours… ») et il aurait fallu l'inventer.

## 8. Le nom de classe `.tab` était déjà pris

`shared/anagroci-ui.css:60` définit :

```css
.tab{background:none!important;color:var(--ag-muted)!important; …}
.tab.on{color:var(--ag-forest)!important}
```

Une barre d'onglets nommée `.tab` sort donc **entièrement grise, actif et
inactif confondus** — constaté à l'écran, pas déduit. La convention du dépôt est
de préfixer (`aflp-tab`, `aflpp-tab`, `ct-tab`) ; d'où **`.cc-tab`**.

Deux autres pièges relevés par exécution :

1. Un panneau `role="tabpanel"` porte `tabindex="0"` : après la barre d'onglets,
   la tabulation entre **dans** le panneau. Il lui faut un focus visible — un
   `outline:none` y fait disparaître le curseur clavier au premier Tab.
2. `getComputedStyle().gridTemplateColumns` d'un panneau **caché** renvoie
   `repeat(3, 1fr)` non résolu, pas la valeur utilisée. Toute mesure de grille
   doit activer l'onglet d'abord, sinon elle mesure du vide.
3. `inline-flex` sur un enfant de conteneur flex est **blockifié en `flex`** par
   la spécification. Ce n'est pas un écrasement de la couche premium.

## 9. Accessibilité

`role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`,
`aria-controls`, `aria-labelledby`. Tabulation mobile (*roving tabindex*) : seul
l'onglet actif est atteignable par Tab, les flèches ← → circulent entre onglets,
`Home` / `End` vont aux extrémités, avec bouclage.

Anneau de focus **émeraude 3 px** déclaré une seule fois pour toute la page, afin
qu'aucun contrôle ajouté plus tard n'y échappe.

Mesuré : onglet actif `#053B23` à **12,68** de contraste, inactif `#5C6660` à
**5,96**, soulignement `#008F37`. Portes CI au vert, **0 nouveau problème** ;
accessibilité comparée à `origin/main` : **94 violations avant, 94 après**.

## 10. Traductions FR/EN

Le point à connaître : **deux dictionnaires tournent en même temps**.
`shared/i18n.js` est injecté par `shared/auth-gate.js` sur chaque page ;
`shared/i18n-extra.js` est injecté par le service worker `i18n-sw.js`. Chacun
tente d'abord une correspondance exacte, puis **remplace en sous-chaîne** toutes
ses clés de plus de deux caractères.

Conséquence, vérifiée à l'écran : sans entrée exacte, « Caisse & avances »
devenait « **Cash desk** & avances » (clé `Caisse`), et « Anomalies métier… »
devenait « **Anomalys** métier… » (clé `Anomalie`). Les phrases du Command
Center sont donc inscrites **en toutes lettres** dans `shared/i18n.js`, pour que
la correspondance exacte l'emporte avant que la sous-chaîne ne s'en mêle.

`shared/i18n-extra.js` reçoit un **second dictionnaire `E`, exact uniquement**,
qui ne rejoint jamais la boucle de sous-chaînes. Il n'existe que pour les
libellés trop courts pour être sûrs : `Part` y transformerait « Partiellement »
en « Sharediellement », et le dépôt contient ce mot.

Le retour au français a été vérifié : il restaure intégralement les huit onglets
et le contenu des tableaux.

**Limites connues** : la pastille de risque « Caisse » s'affiche « Cash desk »,
traduction du reste de la suite pour le module Caisse & Avances — la changer ici
la désaccorderait ailleurs. La ligne de comptage affiche « 1 critical ·
1 attention · 0 information » : « attention » s'écrit de même en anglais, et lui
donner une clé en minuscules ferait courir un risque de coupure de mot pour un
gain nul.

## 11. Adaptation

| Grille | ≥ 1081 px | ≤ 1080 px | ≤ 860 px | ≤ 560 px |
|---|---|---|---|---|
| KPI (`.kpis`) | 4 | 2 | 2 | 1 |
| Tuiles (`.tuiles`) | 3 | 3 | 2 | 1 |
| Cartes Prévisions (`.grille`) | 4 | 2 | 2 | 1 |
| Référentiel (`.stats`) | 3 | 2 | 2 | 2 |

Le référentiel passe à 2 colonnes **dès que sa colonne se réduit de moitié**, et
non 360 px plus bas : à 3 colonnes dans un conteneur de 365 px, les libellés en
capitales se coupent en trois lignes. Son plancher reste 2 — huit indicateurs
numériques courts sur une seule colonne allongeraient la page sans rien rendre
plus lisible.

Les tableaux défilent dans leur propre conteneur (`.scroll`, `tabindex="0"`), la
barre d'onglets en `overflow-x`. Vérifié à 1280 / 768 / 375 px : **aucun
défilement horizontal** imputable à la page.

## 12. Ce qui reste à vérifier humainement

La page est derrière `shared/auth-gate.js`. Tout ce qui dépend d'un chargement
Supabase réel n'a été observé **qu'avec des retours simulés** : cartes de
Prévisions peuplées, colonne Zone, tableaux Avances et Sacs, puces de
l'Assistant IA pilotant `#aflp-tab-*`, pastille « shadow ». La mécanique
d'onglets, elle, est vérifiée pour de bon.
