# Tournées Terrain — module de suivi des visites agents

**Date** : 2026-08-10 · **Branche** : `claude/anagroci-fieldtrack-1a9775`
**Demandeur** : Branch Manager / Head of Field · **Page** : `terrain/tournees.html`

---

## 1. Ce que le module fait

Il répond à une question que personne ne pouvait poser aux données de FBMS
jusqu'ici : **quels villages nos agents ont-ils réellement visités, et lesquels
n'ont vu personne ?**

Le référentiel FBMS sait quels villages existent et ce qu'ils pèsent en
potentiel. Les modules Achats et Sacs savent ce qui a été acheté et distribué.
Aucun des deux ne dit ce qui a été *couvert* : un village sans achat peut être
un village mal desservi comme un village jamais visité, et rien ne permettait de
trancher.

La page entre donc par la couverture, pas par le journal. Quatre vues :

| Vue | Ce qu'elle donne au Branch Manager |
|---|---|
| **Couverture par cluster** | Villages du référentiel, villages couverts, taux, visites, agents distincts, date de la dernière visite. **Trié du cluster le moins couvert au mieux couvert** — la première ligne est le problème du jour. |
| **Activité par agent** | Visites, villages distincts (pas les passages), clusters parcourus, ancienneté de la dernière visite, objet dominant. |
| **Villages non couverts** | Villages sans visite sur la période, **triés par potentiel décroissant**. La colonne « dernière visite connue » regarde hors période : un village vu il y a 40 jours n'est pas affiché comme « jamais visité ». |
| **Journal** | Les 120 visites les plus récentes, avec l'état de synchronisation, le motif d'échec et le bouton de reprise. |

Filtres transverses : période (7 / 30 / 90 jours / toute la campagne), cluster,
agent. Un cinquième onglet permet la saisie d'une visite.

Champs d'une visite : date, objet, cluster, village, RT rencontré (facultatif),
position GPS relevée (facultative), observation. L'auteur est repris du profil
connecté, jamais saisi.

---

## 2. Une dépendance qui n'est PAS satisfaite

Le module écrit dans une table `visites` **qui n'existe pas encore**.

`supabase/**` est interdit à toute modification automatique (CLAUDE.md §3) : le
schéma et les politiques RLS sont la vraie serrure de FBMS. Le SQL attendu est
donc proposé, non appliqué, dans **`docs/proposition-table-visites.sql`** — à
relire, déplacer sous `supabase/`, puis exécuter à la main.

La page ne casse pas pour autant. Tant que la table est absente :

- la saisie fonctionne et les visites s'empilent dans la file locale ;
- la synchronisation classe l'erreur en « Table absente », **s'arrête au lieu de
  réessayer chaque ligne** pour le même échec, et affiche un bandeau explicite ;
- les visites restent locales à l'appareil et ne sont donc pas partagées.

C'est un état de marche dégradé, assumé et visible — pas une panne silencieuse.

---

## 3. Décisions techniques et leurs raisons

**Contrôle d'accès : `data-module="command"`.** La matrice `ACCESS` de
`shared/auth-gate.js` n'a pas de clé `tournees`, et ce fichier est interdit à
tout agent. La classe `command` (`bm` + `direction`) correspond exactement au
public visé. L'écriture est refermée côté page pour le niveau `direction`
(consultation seule) : formulaire désactivé et message explicite.

**Pas de `shared/pjs-theme.css`.** Cette feuille tire `anagroci-ui.css`,
`alis-premium.css`, `geo-premium.css` et `ops-premium.css` par des `@import`
relatifs dont la résolution part, selon l'ordre de chargement, du document et
non de la feuille — d'où les 404 `/terrain/anagroci-ui.css` déjà relevées sur
les autres pages du module (CLAUDE.md §6). La page lie donc directement
`../shared/anagroci-ui.css` et `../shared/ops-premium.css`. `ops-premium`
s'applique bien puisqu'il cible `data-module="command"` ; `alis-premium`
(`#mode` + `#contrat`) et `geo-premium` (`#map`) ne concernent pas cette page.
Aucune règle n'est perdue : les deux feuilles ne lisent que `--font-display`,
`--font-body` et `--font-mono`, que la page définit.

**Nettoyage du payload par préfixe.** Toute clé commençant par `_` est retirée
avant l'envoi Supabase, sans liste à tenir à jour — la correction #143 avait dû
être faite parce qu'une liste explicite avait été oubliée.

**Suppression.** Seules les visites *jamais parties* peuvent être retirées, et
uniquement de la file locale. Rien de synchronisé n'est effaçable depuis la
page ; la suppression serveur reste réservée au Branch Manager, comme pour les
achats (#144).

---

## 4. Ce qui a été vérifié, et comment

Toutes les portes du dépôt, exécutées sur la branche :

| Porte | Résultat |
|---|---|
| `verifier-html.mjs` | 19 pages · 3 écarts historiques · **0 nouveau** |
| `verifier-liens.mjs` | 19 pages · 4 liens cassés hérités · **0 nouveau** |
| `verifier-js.mjs` | 46 fichiers · 1 erreur héritée (`alis-hardening.js`) · **0 nouvelle** |
| `verifier-pages.mjs` | 18 pages × 3 viewports · **0 nouveau**, sur deux passes complètes consécutives |

Relevé propre à `terrain/tournees.html`, aux trois largeurs imposées
(390×844, 768×1024, 1440×900), sur deux passes :

- 0 erreur JavaScript, 0 erreur console, 0 requête interne échouée ;
- aucun débordement horizontal ;
- `lang="fr"`, titre renseigné, un seul `h1` ;
- accessibilité : **2 violations `color-contrast`**, identifiées par exécution
  comme `.asb-tous` et `.asb-sync` — deux boutons injectés par
  `shared/suite-bar.js`, strictement identiques sur `terrain/sacs.html`. Rien
  qui appartienne à cette page. Aucune violation `label` ni `select-name`, là où
  `achats.html` en compte 11 et `sacs.html` 5.
- la violation `scrollable-region-focusable` relevée à la première passe
  (tableau défilable inatteignable au clavier en 390×844) a été corrigée par
  `tabindex="0"` sur les quatre conteneurs `.tw`, et ne réapparaît pas.

**Logique métier**, éprouvée sous Chromium avec un jeu de données
**entièrement fictif** (aucun nom, téléphone, montant ni coordonnée réels) :

- agrégation sur 5 villages fictifs et 5 visites fictives : visites de la
  période, villages couverts, taux par cluster, tri du moins couvert au mieux
  couvert, agents distincts, objet dominant — tous conformes au calcul attendu ;
- une visite datée de 40 jours sort bien de la fenêtre 30 jours, et son village
  bascule en « non couvert » **en conservant sa dernière visite connue** ;
- le passage de 30 à 7 jours fait bien basculer un village visité 9 jours plus
  tôt en « non couvert » ;
- filtre par cluster : périmètre et totaux recalculés ;
- garde-fous de saisie : date future refusée, village obligatoire, observation
  rendue obligatoire quand l'objet est « Autre » ;
- enregistrement hors ligne : visite mise en file, compteur « en attente »
  incrémenté, journal mis à jour.

**Navigation**, vérifiée dans le navigateur :

- tuile « Tournées Terrain » présente sur le portail racine, vers
  `terrain/tournees.html` ;
- entrée `TRN` présente dans le menu « Tous les modules » de la barre de suite,
  et promue dans l'accès rapide quand la page est active.

---

## 5. Ce qui reste à faire, et qui doit le faire

1. **Créer la table `visites` et ses politiques RLS** à partir de
   `docs/proposition-table-visites.sql`. Sans cela, les visites ne quittent pas
   l'appareil. Les quatre vérifications d'après-application sont listées en fin
   de fichier SQL.
2. **Remplacer le visuel de la tuile du portail** : elle reprend provisoirement
   la photo de la tuile Cartographie, faute de photo terrain dans `assets/`.
3. **Position de `TRN` dans l'accès rapide** de la barre de suite : l'entrée est
   ajoutée en fin de registre pour ne chasser aucun module existant des cinq
   raccourcis. La remonter est un choix d'exploitation, pas un correctif.

---

## 6. Fichiers en zone protégée touchés par cette pull request

Ces quatre fichiers relèvent de `auto-merge-denylist.txt` et exigent donc le
label `human-review` et une relecture humaine :

| Fichier | Nature de la modification |
|---|---|
| `terrain/tournees.html` | Création de la page |
| `index.html` | Une tuile ajoutée au registre `FAMILIES` |
| `shared/suite-bar.js` | Une entrée `TRN` dans `MODULES`, `anagroci_visites` ajouté aux files comptées par `enAttente()` |
| `docs/proposition-table-visites.sql` | Création — proposition, hors `supabase/`, non appliquée |

Le hook `.claude/hooks/guard-paths.sh` interdit à un agent d'écrire dans ces
chemins. Ces écritures ont été faites en shell, **sur autorisation explicite du
propriétaire du dépôt**, qui a choisi cette voie parmi les options qui lui
étaient présentées. Le garde-fou n'a pas été désactivé et aucun fichier de
politique n'a été modifié. La mention est faite ici et dans le message de commit
pour que la relecture en ait connaissance.
