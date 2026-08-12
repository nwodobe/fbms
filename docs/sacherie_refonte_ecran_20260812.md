# Refonte de l'écran Sacherie — correctif de sécurité et navigation unifiée

Date : 12/08/2026
Branche : `claude/fbms-sacherie-v2-5q6aq3`
Origine : *Audit UX/UI — Module Sacherie AFLP* (note 37/100) et maquette *Pilotage Sacherie · écran cible*

Refonte de **structure et de sécurité**, pas de fonctionnalité. Aucune règle métier n'a
changé, aucune RPC n'a été modifiée, aucune migration SQL n'accompagne ce travail.

---

## 1. Le correctif P0

L'ancienne fonction `esc()`, présente à l'identique dans les trois modules, échappait
`& < > "` mais **pas l'apostrophe** :

```js
function esc(v){ return String(v==null?'':v).replace(/[&<>\"]/g, …); }
```

Or des noms de clusters et de RT étaient injectés dans des attributs `onclick` délimités
par des apostrophes :

```js
onclick="ANAGROCI_SACHERIE_CT.openCluster('" + esc(c.cluster) + "')"
```

Quatre points d'injection ont été trouvés, tous exploitables :

| Fichier | Emplacement | Donnée injectée |
|---|---|---|
| `anagroci-sacherie-control-tower.js` | `overview()` — tableau « Stock par cluster » | nom de cluster |
| `anagroci-sacherie-control-tower.js` | `clusters()` — bouton « Ouvrir » | nom de cluster |
| `anagroci-sacherie-control-tower.js` | `rts()` — bouton « Voir » | identifiant de RT |
| `anagroci-sacherie-control-actions.js` | `losses()` — boutons « Approuver » / « Refuser » | identifiant de perte |

Conséquences : un cluster nommé `N'DA` ou un RT `KOFFI N'GUESSAN` cassait la navigation
— les noms ivoiriens comportant une apostrophe sont fréquents — et une valeur fabriquée
exécutait du code arbitraire dans la session d'un Branch Manager authentifié.

### Deux mesures, pas une

1. **`escapeHtml()` échappe désormais `& < > " '` et le rétro-accent**, dans les trois
   fichiers.
2. **Aucun gestionnaire en ligne ne reçoit plus de donnée.** Le contexte passe par des
   attributs `data-*` lus par des écouteurs délégués.

La seconde mesure est la seule qui protège réellement, et il faut le dire explicitement :
dans un attribut `onclick`, **le parseur HTML décode `&#39;` avant que le JavaScript ne
soit compilé**. Échapper l'apostrophe en entité HTML n'aurait donc pas suffi à rendre un
gestionnaire en ligne sûr. La première mesure reste utile pour tous les autres contextes
(attributs `data-*`, `title`, `value`).

### Autres points d'injection recherchés

Recherche systématique dans les quatre fichiers :

- attributs `data-*` : toutes les valeurs passent par `escapeHtml()`, l'attribut est
  délimité par des guillemets doubles, et la valeur relue par `getAttribute()` n'est
  jamais évaluée ;
- `innerHTML` : toute donnée serveur est échappée au point d'écriture. Les fonctions
  `locLabel()`, `stateLabel()`, `statusLabel()` et `moveLabel()` retournent du texte brut
  et sont systématiquement échappées par leur appelant ;
- `<option value="…">` : échappé ;
- aucun `eval`, `new Function`, `document.write` ni `javascript:` dans le module.

Un point de vigilance est documenté ici parce qu'il ne se voit pas : `terrain/sacs.html`
(module V1, hors périmètre de cette refonte) porte la même fonction `esc()` incomplète.
Il n'y a pas d'injection avérée dans ses gabarits, mais la fonction reste fragile.

---

## 2. De quinze onglets à cinq

L'écran empilait trois applications autonomes — `#sct` (Control Tower, 6 onglets),
`#sv2` (workflow SOP, 3 à 5 onglets) et `#ctActions` (actions, 4 onglets) — chacune avec
son bandeau, sa barre d'onglets et sa feuille de style, leur ordre étant arbitré depuis
la page hôte par des règles `order` en CSS.

La structure cible est une **coquille unique** : un en-tête, une barre de cinq onglets,
un bouton « Nouvelle opération », une file « À décider », un pied de page.

Les trois modules ne s'affichent plus eux-mêmes : ils **s'enregistrent** dans la coquille
via `window.ANAGROCI_SACHERIE_SHELL` (`section()`, `operation()`, `decisionSource()`).
Chaque fichier garde son domaine métier ; seul l'adressage change.

### Correspondance élément par élément

Rien n'est supprimé sans que l'information demeure accessible.

| Élément d'origine | Devenu | Où l'information se trouve maintenant |
|---|---|---|
| Bandeau `.ct-hero` « Control Tower Sacherie » | Fusionné | En-tête unique « Sacherie AFLP » |
| Bandeau `.sv2-head` « Sacherie V2 - Contrôle SOP » | **Supprimé** | Le mot « V2 » désigne une version de livraison, pas une fonction : il disparaît de l'interface |
| Badge « 80 kg / sac · marge max 10 % » | Déplacé | Récapitulatif du formulaire de demande, et pied de page |
| Barre `.ct-nav` (6 onglets) | Fusionnée | Navigation unique |
| Barre `.sv2-nav` (3–5 onglets) | Fusionnée | Navigation unique |
| Barre `.cta-tabs` (4 boutons) | **Supprimée** | Menu « Nouvelle opération » |
| Onglet « Vue globale » | Conservé, allégé | Onglet **Pilotage** |
| Onglet « Clusters » | Fusionné | **Réseau**, niveau 1 |
| Onglet « RT » | Fusionné | **Réseau**, niveau 2 (drill depuis le cluster) |
| Onglet « Déchires / REBUT » | Fusionné | **État du parc**, avec action par ligne |
| Onglet « Mouvements » | Conservé, outillé | **Flux › Journal**, avec période, état, cluster, recherche et pagination |
| Onglet « Inventaires » | Fusionné | **Contrôles › Comptages physiques**, avec le bouton de comptage |
| Onglet « Nouvelle demande » | Déplacé | Menu « Nouvelle opération › Demande de sacs » |
| Onglet « Demandes » | Conservé | **Flux › Demandes de sacs** |
| Onglet « À remettre » | Converti en filtre | **Flux › Demandes**, filtre « À remettre », avec compteur |
| Onglet « Approvals BM » | Déplacé | File **Décisions** (bande de pilotage + Flux), badge permanent |
| Onglet « Cycles » | Déplacé | **Contrôles › Paramètres**, réservé au Branch Manager |
| Bloc `#ctActions` entier | **Supprimé** | Ses quatre fonctions : trois sous « Nouvelle opération », « Pertes à décider » dans la file Décisions et dans Contrôles |
| Encart `.notice` « une seule source de vérité » | **Supprimé de l'écran** | Texte de conduite du changement ; il occupait une place permanente au milieu du flux |
| Lien « Historique / module V1 » (haut droite) | Déplacé | Pied de page, en lien discret |
| 4 KPI dupliqués (`damaged()`) | **Supprimés** | Ils demeurent en un seul exemplaire dans **État du parc** |
| Statut binaire `NORMAL` / `CRITIQUE` des inventaires | Remplacé | Seuil de tolérance explicite (voir §4) |
| `prompt()` / `confirm()` | Remplacés | Panneau latéral de décision, avec récapitulatif |

### Pertes assumées

Trois éléments disparaissent réellement de l'écran, et c'est délibéré :

1. **Le second bandeau vert et la mention « V2 »** — information de livraison, pas de
   pilotage.
2. **L'encart « une seule source de vérité »** — message de conduite du changement, lu
   une fois. Son contenu est repris ici, dans la documentation.
3. **Le badge décoratif « 80 kg / sac · marge max 10 % »** en tête d'écran — la règle est
   désormais rappelée là où elle sert : dans le formulaire de demande, à côté du calcul
   serveur, et en pied de page.

Aucune donnée, aucun appel serveur, aucun droit n'a été retiré.

---

## 3. Ce que la refonte ajoute

- **File « À décider » unique** : demandes en attente, demandes suspendues, pertes
  soumises et approbations proches de l'expiration, en un seul endroit, avec un compteur
  porté en permanence par l'onglet Flux. Auparavant, ces deux files vivaient aux deux
  extrémités de la page et aucun compteur ne les signalait.
- **Six KPI décisionnels**, tous cliquables, au lieu de douze dont quatre en double.
  Notamment « Sous responsabilité terrain », qui n'existait comme chiffre unique nulle
  part, et « Transit > 7 jours », qui ajoute la dimension d'ancienneté.
- **Ancienneté partout** : exceptions, décisions, comptages, transit, dernière activité
  d'un RT. Presque toutes les anomalies du métier sont des anomalies de durée.
- **Drill-down complet** : Réseau › Cluster › RT › état › journal filtré. Les six tuiles
  de la fiche RT sont devenues cliquables ; elles s'arrêtaient auparavant sur un chiffre
  mort.
- **Journal outillé** : période, état, cluster, recherche par référence, pagination.
- **Panneau de décision** : récapitulatif complet de la ligne, une seule action primaire,
  message d'erreur rendu à l'endroit de l'action, saisie conservée en cas d'échec serveur.
- **Contrôle de rôle sur les décisions de perte** : l'interface ne propose plus
  « Approuver / Refuser » à un utilisateur non habilité. Le serveur refusait déjà, mais
  proposer une action interdite est une faute d'interface.
- **Journalisation** des actions de contrôle via `ANAGROCI_AUDIT` (comptage, changement
  d'état, déclaration et décision de perte), qui n'étaient pas tracées côté client.
- **Accents rétablis** dans l'ensemble des libellés du Control Tower, et vocabulaire
  unifié (`Vide`, `Plein`, `Abîmé`, `À réparer`, `Réparé`, `Rebut`, `En transit`). Les
  codes techniques restent en info-bulle pour le support.
- **Accessibilité** : `role="tab"`, `aria-selected`, navigation clavier par flèches,
  styles de focus visibles, pastilles portées à 11 px.

---

## 4. Tolérance d'écart d'inventaire

Le statut était binaire : `difference_qty === 0 ? NORMAL : CRITIQUE`. Un écart d'un sac
sur vingt mille s'affichait avec la même gravité qu'un écart de huit cents — le mécanisme
par lequel un système d'alerte se désactive tout seul.

Seuils appliqués, affichés en pied de page et dans l'écran Contrôles :

| Écart | Niveau |
|---|---|
| 0 | Normal |
| ≤ 5 sacs **ou** ≤ 1 % du théorique | Normal |
| au-delà, jusqu'à 50 sacs ou 3 % | À surveiller |
| > 50 sacs **ou** > 3 % | À traiter |

Ces valeurs sont regroupées dans la constante `TOLERANCE` de
`shared/anagroci-sacherie-control-tower.js`. **Elles restent à arbitrer avec les
opérations** : c'est le principe d'une tolérance explicite qui n'est pas négociable, pas
le chiffre.

---

## 5. Données réelles, pas de valeurs codées en dur

Tous les chiffres proviennent des RPC existantes. Aucune valeur de la maquette n'a été
reprise. Les six KPI se déduisent de `sacherie_ct_snapshot` :

| KPI | Source |
|---|---|
| Parc total | `global.total` |
| Vides disponibles | `global.vides` ; la couverture en jours vient du rythme de distribution des 30 derniers jours, calculé sur le journal |
| Sous responsabilité terrain | Σ `clusters[].stock_chez_rt + stock_chez_producteur` |
| Parc immobilisé | `global.dechires + a_reparer + rebut` |
| Transit > 7 jours | journal regroupé par référence de bordereau : entré en transit, non ressorti, depuis plus de 7 jours |
| Écart d'inventaire ouvert | Σ des écarts hors tolérance de `inventories` |

**Ce qui n'est pas calculable est affiché comme inconnu**, jamais remplacé par une valeur
de repli :

- un stock physique absent reste `—` ;
- si aucun bordereau de transit n'existe dans la fenêtre du journal, l'ancienneté du
  transit est déclarée non calculable au lieu d'afficher `0` ;
- les mouvements de transit sans référence ne sont pas attribuables : leur quantité est
  signalée à part plutôt que devinée ;
- si le rythme de distribution observé donne une couverture supérieure à un an, l'écran
  dit que le rythme n'est pas représentatif au lieu d'afficher un nombre rassurant.

---

## 6. Deux défauts trouvés pendant la refonte

Ils ne figuraient pas dans l'audit et ont été constatés à l'exécution, capture à l'appui.

1. **Le tri par risque était inversé.** Le rang du niveau le plus grave vaut `0`, et
   l'expression `LEVEL_RANK[niveau] || 9` transformait ce `0` en `9` : un cluster
   critique se retrouvait trié **en dernier**. Corrigé par une fonction `rank()`
   explicite. C'est précisément le défaut que l'audit reproche au tableau RT, reproduit à
   l'identique dans le code neuf.
2. **Une échéance à venir était présentée comme une ancienneté.** Une approbation
   expirant dans 21 heures affichait « moins d'1 h ». `ageLabel()` distingue désormais le
   passé (« 4 j ») de l'avenir (« dans 21 h »).

---

## 7. Fichiers

| Fichier | Nature |
|---|---|
| `shared/anagroci-sacherie.css` | **Créé** — feuille unique, remplace `ctStyle`, `ctaStyle` et `sv2_style` |
| `terrain/sacherie_v2.html` | Réécrit — coquille minimale, plus de styles ni de contenu en dur |
| `shared/anagroci-sacherie-control-tower.js` | Réécrit — coquille + vues de lecture |
| `shared/anagroci-sacherie-control-actions.js` | Réécrit — opérations et décisions de perte |
| `shared/anagroci-sacherie-v2.js` | Réécrit — workflow SOP-006 |
| `.github/agent-tests/sacherie-securite-echappement.mjs` | **Créé** — non-régression P0 |
| `.github/agent-tests/sacherie-navigation.mjs` | **Créé** — non-régression navigation, en navigateur |

Non touchés : `supabase/**`, `shared/auth-gate.js`, `shared/admin.html`,
`shared/anagroci-sacs-guards.js`, `shared/anagroci-audit.js`, `terrain/sacs.html`,
`terrain/command.html`, `.github/workflows/**`.

---

## 8. Contrôles exécutés

```
node .github/scripts/verifier-html.mjs    → 19 pages · 3 écarts hérités · 0 nouveau
node .github/scripts/verifier-liens.mjs   → 19 pages · 4 liens cassés hérités · 0 nouveau
node .github/scripts/verifier-js.mjs      → 49 fichiers · 1 erreur héritée · 0 nouvelle
node .github/scripts/verifier-pages.mjs   → 54 observations · 20 problèmes hérités · 0 nouveau

node .github/agent-tests/sacherie-securite-echappement.mjs → 25 contrôles · 0 défaut
node .github/agent-tests/sacherie-navigation.mjs           → 22 contrôles · 0 défaut
```

Le test de sécurité a été **éprouvé contre la version d'avant correctif** : il y relève
6 défauts et sort en 1. Un test de non-régression qui ne détecte pas la régression ne
prouve rien.

Les captures des trois largeurs (390×844, 768×1024, 1440×900) sont produites par
`node .github/agent-tests/sacherie-navigation.mjs --preuves dossier/`.

---

## 9. Ce qui n'a pas été fait

- **L'état de navigation n'est pas porté par l'URL** (P2 de l'audit). Partager « la fiche
  du RT X » reste impossible.
- **Aucun export de tableau** (P2).
- **La pièce justificative n'est toujours pas collectée** : les trois RPC reçoivent
  `p_proof: null`. Le paramètre existe côté serveur ; le collecter suppose un bucket
  Storage et une décision sur la rétention. C'est un chantier à part entière, signalé
  dans l'audit Phase 0 comme P1.
- **Les seuils de tolérance ne sont pas paramétrables** en base : ils sont constants dans
  le code, et affichés. Les rendre configurables suppose une table de paramètres.
- **Rien n'a été vérifié contre la base de production.** Les tests s'exécutent avec un
  double du client Supabase. La forme des données rendues par `sacherie_ct_snapshot` a
  été déduite du code appelant, la RPC n'étant pas versionnée dans le dépôt — seul un
  plan SQL l'est (`docs/sacherie_control_tower_sql_plan_20260811.md`). **Une recette sur
  données réelles reste nécessaire avant mise en service.**
