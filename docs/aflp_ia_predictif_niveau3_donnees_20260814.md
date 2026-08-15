# AFLP Niveau 3 — Audit de maturité des données, dictionnaire et risques de fuite

> Programme : **ANAGROCI FieldLink Programme (AFLP) 2027**
> Date : 2026-08-14 · Moteur `3.0.0` · variables `vars-1.0.0`
> Statut : **document de cadrage** — aucun modèle n'est en production

---

## 1. Pourquoi ce document vient avant tout choix d'algorithme

Le cadrage du Niveau 3 impose un ordre : **données fiables → définitions
stables → règles déterministes → statistiques simples → apprentissage
automatique**, et non l'inverse. Ce document établit le premier maillon.

Sa conclusion tient en une phrase : **le schéma FBMS actuel ne permet aujourd'hui
qu'une couche de baselines, et il l'interdit formellement pour un cas d'usage sur
six.** Ce n'est pas un jugement sur la qualité du travail de terrain — c'est un
constat sur ce que la base enregistre et sur ce qu'elle n'enregistre pas.

Tous les constats ci-dessous sont **vérifiables par lecture de
`supabase/*.sql`** ou **reproductibles par exécution** de
`AFLP_PRED.diagnostic()`. Aucun n'est une impression.

---

## 2. Porte obligatoire du Niveau 1 — treize prérequis, huit P0 ouverts

`AFLP_PRED.analyser(…).diagnostic.porteNiveau1` évalue ces points à chaque
exécution. Le tableau reproduit la sortie du 2026-08-14.

| Code | Prérequis | Criticité | Statut | Constat |
|---|---|---|---|---|
| N1-01 | Contraintes d'unicité | P0 | ✅ CONFORME | `local_id` UNIQUE sur `achats`, `avances`, `reconciliations`, `sacs_mouvements` : la synchronisation hors ligne est idempotente par construction. |
| N1-02 | Identifiants stables | P0 | ❌ NON CONFORME | `rt_id`, `producteur_id`, `village_nom` sont des `text` **sans clé étrangère**. Un renommage casse le rattachement historique en silence. |
| N1-03 | Journal d'audit | P0 | ⚠ PARTIEL | `rcn_audit` est append-only mais ne couvre que RCN TRACE. `audit_log` n'est protégé que « si la table existe » (`supabase/rls.sql`, bloc conditionnel) : son existence n'est pas garantie. **Aucun journal ne couvre `achats`, `avances`, `reconciliations`.** |
| N1-04 | Transactions clôturées et immuables | P0 | ❌ NON CONFORME | `achats_upd` autorise le BM à modifier **n'importe quel** achat, y compris `statut_validation = 'Validé'`. Aucune clôture, aucun verrou, aucune version antérieure. **Une cible d'apprentissage peut changer après coup, sans trace.** |
| N1-05 | Réconciliations fiables | P0 | ⚠ PARTIEL | `ecart` n'est contraint par aucune règle : rien n'impose au niveau base que `ecart = total_avance − total_paye − cash_restant − valeur_stock`. |
| N1-06 | Données de stock cohérentes | P0 | ❌ NON CONFORME | `achats.stock_statut` vaut `'Entrée RT'` par défaut ; aucun mouvement de sortie ne lui est associé. Le stock au niveau cluster n'est **pas observable**, seulement le cumul des entrées. |
| N1-07 | Synchronisation hors ligne maîtrisée | P1 | ⚠ PARTIEL | Idempotence assurée. Mais toute donnée non remontée est invisible du modèle, et la file locale n'est pas historisée. |
| N1-08 | Dates serveur fiables | P0 | ❌ NON CONFORME | `achats.date` est une `date` **fournie par le client**. Seule `created_at` porte `now()`. Un appareil mal réglé ou une saisie antidatée décale la série temporelle sans qu'aucun contrôle ne s'en aperçoive. **C'est le prérequis le plus critique pour toute prévision.** |
| N1-09 | Traçabilité bout en bout | P0 | ❌ NON CONFORME | La chaîne s'arrête à l'achat. Aucune colonne de `achats` ne référence un lot, une évacuation ou une réception usine ; `rcn_receptions.fournisseur` est un `text` libre. |
| N1-10 | Règles d'accès | P0 | ✅ CONFORME | RLS active sur les quatre tables, via `est_actif()` / `est_bm()` / `peut_editer_config()`. |
| N1-11 | Dictionnaire des données | P1 | ⚠ PARTIEL | `docs/DATA_MODEL.md` existe mais ne couvre pas les cibles prédictives. Le §4 ci-dessous le complète. |
| N1-12 | Qualité mesurable | P1 | ✅ CONFORME | Mesurée à chaque exécution : manquants, identifiants valides, aberrants, ruptures, retard. |
| N1-13 | Campagne identifiée | P0 | ❌ NON CONFORME | **Aucune colonne `campagne`** sur `achats`, `avances` ni `reconciliations`. Impossible de séparer deux campagnes, donc d'estimer une saisonnalité ou de rejouer un historique. |

**Huit P0 ouverts.** Conséquence, appliquée par le code et non seulement écrite
ici : statut maximal `SHADOW_ONLY`, aucun modèle en production, mention
« aide à la décision » sur tout chiffre affiché.

### Les quatre P0 qui comptent vraiment

Si un seul chantier devait être ouvert, ce serait **N1-08 (dates serveur)**. Une
prévision se construit sur l'axe du temps ; si cet axe est déclaré par
l'appareil, tout le reste est bâti sur du sable. Viennent ensuite **N1-13
(campagne)**, sans lequel il n'y aura jamais de saisonnalité, **N1-04
(immutabilité)**, sans lequel aucune erreur mesurée n'est opposable, et **N1-09
(traçabilité)**, qui débloque à lui seul deux cas d'usage sur six.

---

## 3. Matrice de maturité R0 → R3

Mesurée le 2026-08-14 sur un jeu **fictif** de 120 jours × 4 villages × 4 équipes
(384 achats), qui représente une campagne pilote plausible. **Sur les données
réelles, les niveaux peuvent être plus bas — jamais plus hauts** : les blocages
de schéma, eux, ne dépendent pas du volume de données.

| Cas d'usage | Niveau | Ce que cela autorise | Ce qui bloque le niveau suivant |
|---|:---:|---|---|
| 1 · Prévision des volumes par village | **R2** | Entraînement et comparaison **hors décision** | Une seule campagne (N1-13) ; dates client (N1-08) |
| 2 · Estimation du besoin de fonds | **R1** | Baseline uniquement | Durée de cycle mal estimée (< 30 réconciliations) ; frais de paiement absents du schéma |
| 3 · Scorecard des équipes RT | **R1** | Baseline uniquement | Moins de 10 équipes suffisamment actives ; aucune table d'incidents ; aucune ancienneté |
| 4 · Comportements inhabituels | **R1** | Règles + statistiques robustes | Aucun signal historiquement confirmé ou infirmé ; aucun identifiant d'appareil |
| 5 · Prévision des évacuations | **R0** | **Aucun modèle** | Aucune table d'évacuation ; aucune capacité de stockage ; N1-09 |
| 6 · Écarts de qualité | **R1** | Baseline uniquement | Aucune jointure vers `rcn_qualites` ; aucune qualité **cible** arrêtée avec Quality/Factory |

### Lecture honnête de la ligne « volumes »

R2 signifie « testable en mode shadow », pas « fiable ». Le modèle atteint
R2 parce qu'il dispose d'assez de profondeur pour une **validation temporelle à
12 plis** — pas parce qu'il a fait ses preuves métier. Le passage à R3 exige une
validation humaine qui n'a pas eu lieu.

---

## 4. Dictionnaire des données et des cibles

### 4.1 Cibles prédictives

| Cas | Cible | Définition exacte | Stabilité | Fenêtre |
|---|---|---|---|---|
| 1 | `volume_jour` | Somme de `achats.poids_net` groupée par `(date, village_nom)`, **zéros compris** | Stable | J+1, J+7, J+30 |
| 2 | `besoin_fonds` | `volume_prévu × (prix_moyen_observé + commission_moyenne)` | Stable, **dérivée** de la cible 1 | J+7 |
| 3 | *(aucune)* | 8 dimensions descriptives, **pas de cible unique** | Sans objet | cumul campagne |
| 4 | *(aucune)* | Détection non supervisée : pas de vérité terrain étiquetée | Sans objet | jour courant |
| 5 | `date_saturation` | Non calculable — voir §5 | — | — |
| 6 | `ecart_qualite` | `médiane(mesure, village) − médiane(mesure, autres villages)` | **Instable** : la norme évolue avec la population | jour courant |

### 4.2 Variables réellement employées

Seules les colonnes ci-dessous entrent dans un calcul. Toute autre variable citée
dans le cadrage est **absente du schéma** et signalée comme telle.

| Colonne | Table | Usage | Réserve |
|---|---|---|---|
| `date` | `achats`, `avances`, `reconciliations`, `sacs_mouvements` | Axe temporel, filtre de fuite | **Fournie par le client** (N1-08) |
| `poids_net` | `achats` | Cible du cas 1 | — |
| `montant`, `prix_kg` | `achats` | Prix moyen pondéré (cas 2) | Prix ANAGROCI et prix marché absents du schéma |
| `commission_rt` | `achats` | Cas 2 | — |
| `village_nom`, `cluster` | `achats` | Agrégation | `text` sans clé étrangère (N1-02) |
| `rt_id`, `rt_nom` | `achats`, `avances`, `reconciliations` | Agrégation, scorecard | idem |
| `producteur_id` | `achats` | Concentration (HHI, cas 4) | idem |
| `numero_recu`, `refinancable` | `achats` | Traçabilité, cas 2 et 3 | — |
| `humidite`, `kor` | `achats` | Cas 6 | Aucune cible contractuelle |
| `statut`, `ecart` | `reconciliations` | Règle AFLP, cas 2 et 3 | `ecart` non contraint (N1-05) |
| `type`, `source`, `destination`, `quantite` | `sacs_mouvements` | Cohérence cash-stock-sacs | — |

### 4.3 Variables du cadrage qui n'existent pas au schéma

Elles sont listées ici pour qu'aucune ne soit supposée disponible :
engagements producteurs · prix marché · accessibilité routière · temps de trajet ·
capacité et disponibilité des véhicules · capacité des points de stockage ·
temps de séjour en stock · créneaux de réception usine · frais de paiement Wave ·
liquidité disponible · rythme de refinancement · ancienneté des équipes RT ·
identifiant d'appareil · calendrier de marché · incidents validés ·
surface cultivée par producteur · grille de réfaction KOR ·
courbe de perte au séchage · données météorologiques.

**Aucune n'a été inventée, estimée ou remplacée par une valeur par défaut.**

---

## 5. Le cas 5 est R0 par fait de schéma, pas par manque de volume

C'est le point sur lequel il ne faut pas se tromper : donner davantage de temps
au pilote **ne fera pas passer les évacuations de R0 à R1**.

Au périmètre AFLP (`achats`, `avances`, `reconciliations`, `sacs_mouvements`),
**aucune table n'enregistre une sortie de stock**. Le stock d'un cluster ne peut
donc qu'être supposé égal au cumul acheté — ce qui devient faux dès la première
évacuation. Les tables `rcn_*` couvrent bien la réception usine, mais
`rcn_receptions.fournisseur` est un `text` libre : il n'existe **aucune clé de
jointure** entre un achat villageois et une réception.

Le calcul de saturation **est implémenté et testé**
(`AFLP_PRED.prevoirEvacuations`, contrôlé par
`.github/agent-tests/aflp-ia-predictif.mjs`). Il s'exécute dès qu'on lui fournit
`capacites` et `evacuations`. En leur absence, il ne produit aucune date : c'est
la différence entre une architecture prête et une architecture promise.

**Prérequis à ouvrir**, dans l'ordre :

| Code | Élément | Criticité |
|---|---|:---:|
| EVAC-P0-1 | Table des évacuations (date, origine, destination, tonnage, véhicule) | P0 |
| EVAC-P0-2 | Clé de jointure `achats` → lot → `rcn_receptions` | P0 |
| EVAC-P0-3 | Capacité (kg) de chaque point de stockage | P0 |
| EVAC-P1-1 | Capacité utile et disponibilité des véhicules | P1 |
| EVAC-P1-2 | Temps de trajet et état des routes par liaison | P1 |
| EVAC-P1-3 | Contraintes de réception usine | P1 |

---

## 6. Analyse des risques de fuite de données

La fuite temporelle est **empêchée à la construction du jeu de données**, pas
contrôlée après coup : `construireDataset()` écarte toute ligne dont la date
dépasse `dateRef`, et compte les lignes écartées. Un test dédié le vérifie —
ajouter des lignes futures ne change **rien** à la prévision produite.

| Cas | Risque | Nature | Traitement |
|---|---|---|---|
| 1 | Employer un cumul de campagne comme variable | Élevé si commis | Écarté : seules des fenêtres glissantes bornées à l'origine du repli sont employées |
| 1 | Backtest lisant au-delà de l'origine | Élevé | Origines espacées de `h`, cibles non chevauchantes, apprentissage tronqué à `serie.slice(0, o)` |
| 2 | Exposition ouverte calculée après coup | Modéré | Avances et réconciliations filtrées à `dateRef` |
| 3 | Score servant à prédire un incident futur | Élevé **si** la scorecard devenait prédictive | Écarté par conception : elle est **descriptive**, elle ne prédit rien |
| 4 | Norme de comparaison incluant l'observation testée | Modéré | Comparaison inter-équipes sur médiane et MAD, robustes à un point |
| 6 | Norme incluant le village testé | **Élevé** | **Leave-one-out** : la population de référence exclut explicitement l'entité évaluée |

### Le piège du cas 6, en clair

Comparer l'humidité d'un village à une moyenne qui **le contient** sous-estime
mécaniquement l'écart : plus le village dévie, plus il tire la référence vers
lui. Sur 4 villages, un village aberrant représente 25 % de sa propre norme.
D'où le retrait explicite de l'entité testée avant tout calcul de médiane, de
MAD et de quantiles.

---

## 7. Fiche du jeu de données (*dataset card*)

| Rubrique | Contenu |
|---|---|
| **Nom** | `aflp-dataset` — construit à la volée, jamais persisté |
| **Version** | `ds-<empreinte FNV-1a>` du contenu (date de référence, cardinalités, totaux) |
| **Origine** | Tables Supabase `achats`, `avances`, `reconciliations`, `sacs_mouvements`, `villages`, `rt`, `parametres_calcul`, lues sous RLS par la session du Branch Manager |
| **Périmètre temporel** | Du premier achat enregistré à `dateRef` incluse |
| **Granularité** | Journalière, **calendrier complet** (jours sans achat portés à zéro) |
| **Volumétrie observée (jeu fictif de contrôle)** | 384 achats · 120 jours · 4 villages · 4 équipes · 3 clusters |
| **Données personnelles** | `producteur_nom` et `rt_nom` sont lus. Ils **n'entrent dans aucun calcul** : seules les clés `producteur_id` / `rt_id` servent au regroupement. Les noms ne servent qu'à l'affichage, sous RLS. |
| **Sortie hors du dépôt** | **Aucune.** Aucun appel réseau, aucune API externe, aucun service d'IA tiers. |
| **Persistance** | Aucune. Le jeu vit le temps d'un affichage. Les prédictions ne seront persistées qu'après application de `docs/migrations/aflp_predictions_20260814.sql`. |
| **Biais connus** | Sous-représentation des zones à faible couverture réseau (données remontées plus tard, donc absentes au moment du calcul) ; absence des saisies papier non numérisées ; une seule campagne. |
| **Licence / diffusion** | Interne ANAGROCI. Application interne, URL non diffusable hors équipe (`README.md`). |

---

## 8. Seuils employés — et pourquoi ceux-là

Un seuil sans justification est un seuil qu'on abaissera un jour pour rendre les
données « éligibles ». Chacun est donc motivé, versionné, et surchargeable par la
table `parametres_calcul` (clés `aflp_pred_*`) sans toucher au code.

| Seuil | Valeur | Justification |
|---|---:|---|
| `r1MinJoursHistorique` | 14 | Deux fenêtres de 7 jours : le minimum pour qu'une moyenne mobile ait un sens |
| `r1MinObservations` | 8 | En deçà, la médiane est dictée par 1 ou 2 points |
| `r2MinJoursHistorique` | 60 | 4 plis × 7 jours de test + 28 jours d'apprentissage = 56, arrondi pour absorber les jours creux |
| `r2MinPlis` | 4 | En deçà, un WAPE n'est pas une mesure mais une anecdote |
| `r2MinCampagnes` | 2 | Une saisonnalité ne s'estime pas sur une seule campagne |
| `minResidusIntervalle` | 10 | Quantiles 10 % / 90 % : chaque borne doit reposer sur plus d'un point |
| `maxTauxManquant` | 0,30 | Au-delà, le manquant n'est plus un défaut ponctuel mais une caractéristique de la colonne |
| `zAnomalie` | 3,5 | **Iglewicz & Hoaglin (1993)**, seuil publié du z modifié — repris, non inventé |
| `hhiConcentration` | 0,40 | ≈ 2,5 producteurs équivalents |
| `wapeAvertissement` | 0,35 | Au-delà, la prévision se lit en fourchette, pas en chiffre |
| `retardDonneesJours` | 2 | Au-delà, la confiance est dégradée d'un cran |

### Deux seuils qui ne sont PAS justifiés statistiquement, et le sont dit

- **Seuil de dérive : ±30 %** de la médiane. Valeur provisoire, à recalibrer
  après une campagne complète d'observation. Le code le déclare lui-même dans le
  champ `reserveSeuil`.
- **`hhiConcentration = 0,40`** repose sur une lecture métier (« environ deux
  producteurs et demi »), pas sur une distribution observée. À réviser dès que la
  distribution réelle des HHI par équipe sera connue.

---

## 9. Ce qu'il faut pour progresser — chiffré

| Objectif | Ce qu'il faut | Délai réaliste |
|---|---|---|
| Cas 1 de R2 → R3 | Une campagne complète en mode shadow + validation du Branch Manager | **1 campagne** (~6 mois) |
| Saisonnalité inter-campagne | Colonne `campagne` + **2 campagnes** d'historique | **~18 mois** après ajout de la colonne |
| Cas 2 de R1 → R2 | ≥ 30 couples avance → réconciliation datés | ~2 mois d'exploitation normale |
| Cas 3 de R1 → R2 | ≥ 10 équipes à ≥ 30 achats chacune + table d'incidents | ~2 mois + 1 chantier schéma |
| Cas 4 de R1 → R2 | ≥ 500 achats, ≥ 10 équipes, et des signaux **clos par un humain** | ~3 mois d'observation |
| Cas 5 de R0 → R1 | EVAC-P0-1 à P0-3 | **Chantier schéma, indépendant du temps** |
| Cas 6 de R1 → R2 | Jointure `achats` ↔ `rcn_qualites` + qualité cible arrêtée avec Quality/Factory | **Chantier schéma + décision métier** |

**Le temps seul ne suffit pas.** Trois des sept lignes ci-dessus attendent une
décision ou un chantier, pas des données supplémentaires.
