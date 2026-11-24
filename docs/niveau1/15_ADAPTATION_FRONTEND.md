# Adaptation du frontend au Niveau 1 — A-08

Date : 14 août 2026 · Fichiers : `shared/n1-adaptateur.js`, `terrain/cash.html`,
`terrain/achats.html`

> ⚠ **Revue humaine obligatoire.** `agent-policy.yml` classe
> `business-logic-javascript` et `html-pages` en `human_review_required`. Ce
> document est fait pour rendre cette revue possible en une lecture.

## 1. Le problème que cela résout

Après la migration 03, une insertion directe dans `public.avances` échoue s'il
n'existe pas de cycle de financement ouvert. **Le module Caisse cessait donc de
fonctionner** dès l'application des migrations — c'était le risque de livraison
le plus lourd du Niveau 1 (angle mort A-08).

## 2. La décision de conception qui supprime le risque

**L'adaptateur est inerte tant que les migrations ne sont pas appliquées.**

Au premier appel, il sonde le serveur (`n1_sync_etat`, en lecture seule et sans
effet). Si la fonction n'existe pas, il conclut « mode passif » et laisse le
comportement historique **strictement** inchangé.

Conséquence : **le frontend peut partir en premier, seul, sans risque.** Le jour
où les migrations sont appliquées, l'adaptateur prend le relais au prochain
chargement de page. Il n'y a plus de livraison coordonnée à orchestrer, donc plus
de fenêtre de rupture.

C'est vérifié, pas supposé — voir §5.

## 3. Ce que l'adaptateur apporte, une fois actif

| # | Apport | Pourquoi |
|---|---|---|
| 1 | Clé d'idempotence + identifiant de terminal sur chaque écriture | Deux téléphones ne créent plus de doublon |
| 2 | Écritures routées vers `n1_sync_pousser`, qui renvoie un **accusé** | La file locale n'est purgée que sur cet accusé |
| 3 | Avance : `n1_ouvrir_cycle` appelé **en ligne** avant l'insertion | Une exposition financière ne naît jamais d'un cache |
| 4 | Traduction des erreurs PostgreSQL en français de terrain | Un agent qui ne comprend pas un refus finit par le contourner |
| 5 | Refus conservés côté serveur (`n1_sync_enregistrer_rejet`) | Un `ROLLBACK` efface l'audit du refus ; ce rappel le rétablit |

**Aucune règle métier n'est décidée dans le navigateur.** Le serveur reste seul
juge ; l'adaptateur ne fait que parler sa langue.

## 4. Modifications, fichier par fichier

### `shared/n1-adaptateur.js` — nouveau, 316 lignes

Expose `window.N1` : `terminalId`, `disponible`, `preparer`, `pousser`,
`assurerCycle`, `journaliserRefus`, `etatServeur`, `message`, `categorie`.

### `terrain/cash.html` — 3 modifications

| Ligne | Changement |
|---|---|
| en-tête | Ajout du `<script defer src="../shared/n1-adaptateur.js">` |
| `syncTable` | Réécrite : appelle `assurerCycleAvance()` avant toute avance, puis `N1.pousser`. Sans `window.N1`, retombe sur l'`upsert` d'origine |
| `saveAvance` | Message honnête : une avance est « mise en attente », pas « enregistrée », tant que le serveur n'a pas confirmé |
| formulaire | L'« Override BM » est étiqueté **demande, pas décision** — le serveur exige une exception approuvée par un tiers |

### `terrain/achats.html` — 2 modifications

| Ligne | Changement |
|---|---|
| en-tête | Ajout du script |
| `syncAll` | Route par `N1.pousser` ; affiche le message traduit ; distingue le cas `DOUBLON` (« déjà enregistré, aucun doublon créé ») |

`classifyErr` est **conservée** dans les deux pages : elle sert de repli si
l'adaptateur n'est pas chargé. Rien n'a été supprimé.

## 5. Vérifications réellement effectuées

Serveur statique local, Chromium, page `terrain/cash.html` puis
`terrain/achats.html`.

### Propriété de sûreté — la plus importante

Sonde exécutée contre la **vraie base de production** :

| Observation | Valeur constatée |
|---|---|
| Code retourné par `n1_sync_etat` | `PGRST202 — Could not find the function` |
| Conclusion de la sonde | `actif = false` → **mode passif** |
| Colonnes réellement envoyées par `pousser()` | `["local_id", "montant"]` |

`cle_idempotence` et `terminal_id` sont **correctement retirés** en mode passif :
ce ne sont pas encore des colonnes, et les envoyer aurait produit un
« column does not exist ». C'est le défaut que cette vérification a attrapé.

### Chargement et intégration

| Contrôle | Résultat |
|---|---|
| `window.N1` défini, 9 fonctions exposées | oui |
| Identifiant de terminal stable entre deux appels | oui (`TEL-78d0…`) |
| Ordre de chargement des scripts | adaptateur avant le bloc métier |
| `syncTable`, `assurerCycleAvance`, `saveAvance`, `syncAll` définies | oui |
| Gardes historiques (`anagroci-audit.js`, `classifyErr`) toujours en place | oui |

### Traduction des refus

| Erreur serveur | Message affiché |
|---|---|
| `Refinancement refusé : … statut BLOQUE` | « Le cycle précédent de ce RT n'est pas réconcilié. Aucune nouvelle avance n'est possible avant la réconciliation. » |
| `duplicate key … achats_recu_campagne_rt_uidx` | « Ce numéro de reçu a déjà été enregistré. Vérifiez le carnet : un reçu ne sert qu'une fois. » |
| `… n1_soldes_non_negatif_chk` | « Le solde de sacs ne permet pas cette sortie. Comptez les sacs avant de recommencer. » |
| `… en statut CLOTURE : modification directe interdite` | « Cette opération est clôturée. Une correction passe par un ajustement motivé et approuvé. » |

### Trois largeurs imposées

| Largeur | Débordement horizontal | Note « le serveur reste juge » |
|---|---|---|
| 390 × 844 | aucun (`scrollWidth` = 390) | lisible, 328 px dans un champ plus large |
| 768 × 1024 | aucun | visible, sans débordement |
| 1440 × 900 | aucun | visible, sans débordement |

### Console et réseau

- Deux 404 : `/terrain/manifest.webmanifest` et `/favicon.ico`. **Préexistants** —
  même famille de défaut que celui documenté dans `CLAUDE.md` §6 pour
  `fbms/index.html`.
- Un 401 : appel d'authentification Supabase hors session. Attendu.
- `shared/n1-adaptateur.js` → **200**.
- Aucune erreur JavaScript nouvelle.

### Portes du dépôt

| Porte | Résultat |
|---|---|
| `verifier-js.mjs` | 50 fichiers · 1 erreur héritée · **0 nouvelle** |
| `verifier-html.mjs` | 19 pages · 3 écarts historiques · **0 nouveau** |
| Suite Niveau 1 | **199/199 conformes** |

## 6. Un défaut de la porte JS, découvert au passage

`verifier-js.mjs:23` découvre les fichiers par `git ls-files`. **Un fichier
JavaScript neuf, non encore indexé, lui est invisible.**

Constaté par expérience : une faute de syntaxe volontaire dans
`shared/n1-adaptateur.js` non indexé a laissé la porte **verte** (49 fichiers,
0 nouvelle erreur). Après `git add`, la même faute est bien détectée
(50 fichiers, 1 nouvelle erreur).

C'est exactement le « porte verte qui ne mesure rien » contre lequel `CLAUDE.md`
met en garde. Le correctif n'est pas fait ici — `.github/scripts/**` est interdit
aux agents. **Recommandation** : ajouter `--others --exclude-standard` à
l'invocation `git ls-files`, ou exiger un arbre de travail propre avant la porte.

## 7. Ce qui reste à faire côté terminal

L'adaptateur couvre le chemin d'écriture. Ne sont **pas** faits :

1. affichage permanent du nombre d'opérations non synchronisées ;
2. alerte visuelle au-delà du seuil de retard de synchronisation ;
3. écran de récupération après changement de téléphone, appuyé sur
   `N1.etatServeur(sb, true)` — la fonction existe, l'écran non ;
4. `terrain/sacs.html` et `terrain/sacherie_v2.html` n'ont pas été adaptés : leur
   chemin d'écriture passe déjà par les RPC de la Sacherie V2 ;
5. le cas 3.10 du plan de recette — refus serveur d'une opération créée hors
   ligne — n'est vérifiable qu'avec un vrai téléphone.

## 8. Ce que cette vérification ne prouve pas

Les pages sont masquées par `shared/auth-gate.js` tant que l'utilisateur n'est
pas connecté, et je ne me suis pas authentifié. **Le parcours complet — saisir
une avance, la synchroniser, voir le refus s'afficher — n'a pas été joué.** Il
l'a été côté serveur (199 cas), et l'intégration côté page a été mesurée dans le
navigateur, mais le bout-en-bout avec un compte réel reste à faire en recette
(document 12, phases 2 et 3).
