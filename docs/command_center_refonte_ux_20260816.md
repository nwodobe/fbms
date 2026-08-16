# Command Center BM — refonte de l'architecture de l'information

> ## ⚠ Document historique — architecture remplacée
>
> La navigation décrite ici (**six sections défilantes**, avec navigation locale
> à pastilles et deux panneaux repliés) a été **remplacée le 16 août 2026** par
> **huit onglets à un seul niveau**. Voir
> [`command_center_onglets_20260816.md`](command_center_onglets_20260816.md).
>
> Ce document est conservé parce qu'il explique **pourquoi** la hiérarchie
> SITUATION → RISQUE → ACTION → ANALYSE a été retenue, et parce que ce
> raisonnement, lui, survit au changement de navigation : l'ordre des huit
> onglets en découle directement. Les sections 3 (navigation collante),
> 5 (dévoilement progressif) et 6 (panneaux repliés) ne décrivent plus le code.

**Date** : 16 août 2026 · **Portée** : `terrain/command.html`, plus deux
accesseurs en lecture seule dans `shared/aflp-ia-ui.js` et
`shared/aflp-ia-predictif-ui.js`.

> **Aucune règle métier n'a été modifiée.** Les mêmes tables sont interrogées,
> avec les mêmes colonnes ; les agrégats, les seuils, la liste des anomalies,
> le calcul du risque, la file locale et les appels aux modules AFLP sont
> repris à l'identique. Ce qui change est l'ordre, le groupement et le moment
> où l'information est montrée.

---

## 1. Le problème

La page empilait quinze blocs de même poids visuel sur près de 5 000 pixels de
haut. Rien n'y distinguait ce qui appelle une décision de ce qui documente. Un
Branch Manager devait parcourir toute la page pour savoir s'il avait quelque
chose à faire, et n'avait aucun moyen de revenir à un bloc déjà consulté.

Deux blocs pesaient à eux seuls plus de la moitié de la hauteur : l'Assistant
IA AFLP et les Prévisions AFLP, tous deux dépliés en permanence alors qu'ils
relèvent de l'analyse, pas de la décision du jour.

## 2. Le principe directeur

**SITUATION → RISQUE → ACTION → ANALYSE**, et non plus donnée après donnée.

Six sections, dans cet ordre, chacune répondant à une question que le BM se
pose réellement :

| Section | Question | Contenu |
|---|---|---|
| **Synthèse** | Que dois-je savoir maintenant ? | 4 KPI + bandeau « situation du jour » + verdict |
| **À traiter** | Qu'est-ce qui exige mon intervention ? | Anomalies priorisées + file de synchronisation |
| **Terrain** | Où en sont les clusters ? | Par cluster (recherche + tri) + référentiel compacté |
| **Contrôle & risques** | Quelles équipes appellent une action ? | RT à risque, badges sémantiques |
| **Assistant IA** | Que me dit l'assistant ? | Panneau replié, résumé en en-tête, 4 raccourcis |
| **Prévisions** | Que disent les modèles ? | Panneau replié, 8 onglets intacts |

L'ordre diffère de celui proposé initialement sur un point : **l'Assistant IA
passe avant les Prévisions**. L'assistant sert tous les jours ; les prévisions
sont un outil d'analyse ponctuel. Le quotidien précède l'occasionnel.

## 3. Navigation locale collante

Sous l'en-tête du module, une barre de pastilles `icône + libellé` reste
visible pendant le défilement, à `top: hauteur réelle de la barre suite`
(mesurée au chargement, pas codée en dur).

- clic → défilement doux jusqu'à la section, ancre mise à jour dans l'URL ;
- la pastille de la section courante s'active toute seule au défilement ;
- deux pastilles portent un compteur : anomalies à traiter, RT à risque ;
- une section repliée visée par la navigation **s'ouvre** — un lien qui mène à
  un titre vide passe pour un lien mort ;
- sur mobile, la barre défile horizontalement et la pastille active est
  ramenée dans le champ de vision.

La navigation **globale** (`shared/suite-bar.js`) n'est pas touchée.

### Trois pièges rencontrés, résolus par la mesure

1. **`scrollIntoView` sur la pastille active interrompait le défilement doux du
   document** : la page s'arrêtait à mi-chemin. Le recentrage agit désormais
   sur le seul défilement horizontal de la barre.
2. **Un verrou de 900 ms** empêche l'espion de suivre les sections traversées
   pendant l'animation. Il ne les oublie pas : une relance est programmée, et
   un geste explicite (molette, tactile, clavier) le lève immédiatement.
3. **Une marge de fin de page calculée** (`#ccSpacer`) : sans elle, la dernière
   section ne peut pas remonter sous les en-têtes collants quand la page est
   courte, et la pastille cliquée paraît « ne rien faire ». Elle vaut 0 dès que
   la page est assez haute.

## 4. Dévoilement progressif

| Bloc | Par défaut | Ouverture |
|---|---|---|
| Anomalies du jour | 5 lignes | « Afficher les N autres » |
| RT à risque | les 3 plus critiques | « Voir tous les RT à risque (N) » |
| Assistant IA AFLP | replié, résumé en en-tête | en-tête ou l'un des 4 raccourcis |
| Prévisions AFLP | replié, résumé en en-tête | en-tête ou la pastille de navigation |

Le choix de repli est mémorisé par poste (`localStorage`). Un BM qui ouvre
l'assistant tous les matins le retrouve ouvert.

**Aucune donnée n'a été retirée.** Le référentiel terrain garde ses 8
indicateurs (grille compacte au lieu de 8 lignes de tableau) ; les Prévisions
gardent leurs 8 onglets ; l'assistant garde ses 4 vues.

## 5. Résumés d'en-tête : lus, jamais recalculés

Les en-têtes repliés affichent « 11 points demandent votre attention » et
« Porte Niveau 1 : non franchie (8 P0 ouverts) ». Ces phrases viennent de deux
accesseurs **en lecture seule** ajoutés aux modules :

- `AFLP_IA_UI.resume()` → compte les alertes déjà produites par le moteur ;
- `AFLP_PRED_UI.resume()` → relit le diagnostic déjà calculé.

Aucun des deux ne calcule quoi que ce soit. Recalculer ici aurait créé une
seconde vérité métier — et deux vérités qui divergent valent moins qu'aucune.
Les deux renvoient `null` tant qu'aucune donnée n'a été reçue, pour qu'un
appelant ne confonde jamais « zéro alerte » et « pas encore chargé ».

## 6. Ce que la couche de style partagée imposait

`shared/pjs-theme.css` importe quatre feuilles qui **se chargent bel et bien**
(mesuré : quatre réponses 200, voir §9), dont `ops-premium.css`, qui cible ce
module par `html:has(script[data-module="command"])` et pose des `!important`.
Elle arrive après la feuille de la page : seule une spécificité supérieure
permet de la reprendre. D'où l'identifiant `#ccMain`, employé **uniquement**
pour les points où le cockpit diverge du gabarit commun :

| Reprise | Pourquoi |
|---|---|
| largeur 1180 → 1320 px | à contenu égal, la page est moins haute |
| KPI sur 2 colonnes ≤ 560 px | 4 KPI empilés font 4 écrans de haut |
| KPI critique en rouge | la couche premium reforçait toutes les valeurs en vert : un risque critique ne se voyait pas |
| champs de filtre à 46 px | seuil tactile de la politique (44 px), avec la marge de l'arrondi sous-pixel |

**Un défaut sérieux trouvé par la mesure** : `shared/anagroci-ui.css` peint
*tout* `<button>` dépourvu de `.ghost` en émeraude plein — la règle
`button:not(.ghost):not(.ag-out):not(.ag-cog)`, de spécificité 0-3-1, l'emporte
sur une simple classe. Les en-têtes repliables devenaient des pavés verts et
leur résumé gris tombait à **1,04 de contraste**, illisible. Trois reprises
sous `#ccMain` rétablissent le dessin voulu.

## 7. États

Chargement (squelettes), aucune donnée, échec, hors ligne, file locale en
attente, échecs de synchronisation. Deux ajouts :

- **fraîcheur** : « Actualisé il y a N min », pastille orange au-delà de 15 min
  — un chiffre vieux de quarante minutes n'est pas une erreur, mais le BM doit
  le savoir avant de décider ;
- **bandeau hors ligne** discret, qui disparaît au retour du réseau.

## 8. Accessibilité

Écarts axe-core (WCAG 2.0/2.1 A et AA) **imputables à la page elle-même**,
imputation faite par contenance dans le DOM et non par ressemblance de
sélecteur :

| | total | barre suite | modules AFLP | **page** |
|---|---|---|---|---|
| avant (`b22d723`) | 71 | 2 | 56 | **13** |
| après, tout déplié | **6** | 2 | **4** | **0** |
| après, état par défaut | 2 | 2 | 0 | **0** |

Corrections : gris `#7A7878` → `#666565` et ambre `#9A6600` → `#8A5B00` (tous
deux mesurés sous 4,5 aux tailles employées) ; `tabindex="0"` et nom accessible
sur les zones à défilement ; cibles tactiles du cockpit toutes ≥ 44 px.

**Le même gris `#7A7878` peuplait aussi les deux feuilles des modules AFLP** —
3 occurrences dans `aflp-ia-ui.js`, 10 dans `aflp-ia-predictif-ui.js`. Les y
remplacer par `#666565` fait tomber leurs écarts de **54 à 4**. Une seule
couleur portait donc l'essentiel du reliquat : la corriger coûtait treize
caractères, la déclarer « hors périmètre » coûtait cinquante violations.

Les 2 écarts restants viennent de `shared/suite-bar.js` (navigation globale),
hors périmètre ; les 4 derniers des modules AFLP tiennent à des teintes
violettes propres à la couche prédictive (`#6b6580`, `#5c5670`), non mesurées
ici et laissées en l'état plutôt que changées à l'aveugle.

## 9. Ce qui a été mesuré, et comment

Les portes du dépôt ouvrent la page **sans session** : `loadAll()` ne s'exécute
pas et tout ce qui fait le cockpit reste invisible à la mesure. Un banc dédié
comble ce trou — `.github/agent-tests/command-center/`, voir son `LISEZ-MOI.md`.
Il sert le dépôt tel quel et ne double que le SDK Supabase et `auth-gate.js`,
comme le fait déjà `verifier-pages.mjs`. Données entièrement fictives.

**106 contrôles, aux trois largeurs imposées (390×844, 768×1024, 1440×900), tous
au vert**, dont : hauteur de page à données égales **5 047 → 2 591 px (−49 %)**,
aucune erreur JS, aucun débordement horizontal, navigation collante et ancres,
dévoilement progressif, recherche, tri, états, accessibilité.

### Un garde-fou qui se mesurait à lui-même

La comparaison de hauteur lisait `git show HEAD:terrain/command.html`. C'était
juste tant que la refonte n'était pas commise ; elle l'est depuis, et `HEAD`
**est** la refonte. Le contrôle se comparait donc à lui-même et basculait au
pixel près — vert à 2 592 contre 2 591, rouge à la mesure suivante. La
référence est désormais **épinglée à `b22d723`**, dernier commit à avoir touché
cette page avant la refonte (`CC_REF_AVANT` permet d'en viser une autre). Un
garde-fou dont la référence bouge avec ce qu'il garde ne garde rien.

Portes du dépôt : `verifier-html`, `verifier-js`, `verifier-liens`,
`verifier-pages` — **0 nouveau problème** sur les quatre.

### Une note du dépôt à corriger

`terrain/aflp-ia-admin.html` (§ commentaire d'en-tête) et `CLAUDE.md` §6
affirment que les quatre `@import` de `shared/pjs-theme.css` sont résolus
relativement au **document** et produisent quatre 404 dans `terrain/`. C'est
faux : mesuré sur Chromium, les quatre reviennent en **200** — la spécification
CSS résout un `@import` relativement à la **feuille** qui le contient, non au
document. La preuve pratique est que `ops-premium.css` s'applique bel et bien à
cette page. Le défaut consigné dans le référentiel des portes est donc mal
décrit ; le corriger relève d'une pull request dédiée.

## 10. Ce qui n'a pas été fait

- La navigation globale et son style n'ont pas été touchés : ses 2 écarts de
  contraste et ses 8 cibles sous 44 px restent (hors périmètre).
- Les 4 derniers écarts des modules AFLP (teintes violettes de la couche
  prédictive) n'ont pas été touchés, faute de les avoir mesurés.
- Les libellés nouveaux ne sont pas dans le dictionnaire `shared/i18n.js` : en
  anglais, ils restent en français. Ajout à faire dans `shared/i18n-extra.js`
  si la version anglaise est utilisée sur le terrain.

## 11. Zones et clusters — deuxième passe

Le tableau « Zones et clusters » vit **dans** l'assistant IA, sur l'onglet
Synthèse. La première passe s'était contentée de lui donner un en-tête collant
et un survol de ligne depuis la feuille de la page, en évitant d'entrer dans le
module. C'était un demi-geste : sans recherche ni tri, une table de six
clusters se lit encore, une table de vingt ne se lit plus.

Elle reçoit donc, **dans `shared/aflp-ia-ui.js` et sans toucher au moteur** :

| Ajout | Détail |
|---|---|
| recherche | cluster **ou** zone, insensible aux accents (« beoumi » trouve « Béoumi ») |
| tri | volume, solde le plus bas, sacs le plus bas, zone, nom A→Z |
| compteur | « 1 sur 6 » dès qu'un filtre est actif |
| badge de zone | discret, pour regrouper l'œil — il ne signale pas un risque |
| repli | le bloc entier se replie, `aria-expanded` suivi |
| état vide | « Aucun cluster ne correspond à … » |

Le tableau **reste un tableau** : le transformer en cartes ferait perdre la
comparaison colonne à colonne, qui est tout l'intérêt de ce bloc.

Deux points de mise en œuvre qui ne se devinent pas :

1. `rendre()` réécrit **tout** le panneau par `innerHTML`. Recherche et tri ne
   réécrivent donc que le corps du tableau et son compteur : repasser par
   `rendre()` recréerait le champ de saisie, qui perdrait le focus et le
   curseur à chaque frappe. Le banc le vérifie explicitement.
2. L'état du filtre vit au niveau du **module**, pas dans le DOM — sinon chaque
   rafraîchissement des données le viderait.

Le module écoute par **délégation** sur son conteneur, comme le reste du
fichier. Conséquence pour qui écrira des mesures : un `new Event('input')` sans
`bubbles: true` n'atteint jamais l'écouteur, alors qu'une vraie frappe, elle,
remonte. Le contrôle passerait à côté sans rien signaler.
