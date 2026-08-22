# 04 — Charge : 1 à 100 utilisateurs simultanés

**Outil** : Grafana k6 v0.55.0 · **Scripts** : `tests/load/` · **Lanceur** : `node tests/load/executer.mjs`
**Données brutes** : `tests/reports/donnees/04-charge-latence0.json`, `04-charge-latence150.json`,
et un résumé k6 par exécution (`k6-palier-*.json`, `k6-montee.json`, `k6-pic.json`,
`k6-concurrence.json`, `k6-statique.json`).

---

## 0. Ce que ce rapport mesure — et ce qu'il ne mesure pas

**Ce rapport ne dit pas si Supabase tient 100 utilisateurs. Il ne peut pas le dire.**

La cible de production `jmbdgpdthzpszfnddwzi.supabase.co` est injoignable depuis l'environnement
d'exécution de cette campagne (`CONNECT → 403`, constat reproductible en 01-MAPPING §0). Les
exécutions ci-dessous visent l'émulateur local décrit en 01-MAPPING §0.

Un chiffre suffit à mesurer l'écart : **la concurrence maximale observée côté serveur émulé est
de 1** — une seule requête en vol à tout instant, y compris au palier de 100 utilisateurs.
L'émulateur traite chaque requête en une fraction de milliseconde ; il n'a jamais formé de file
d'attente. Les temps de réponse de la colonne « p95 » sont donc **le coût du transport local et
rien d'autre**. Les citer comme « performance de l'application » serait faux.

Ce que ces exécutions établissent réellement, et qui vaut :

| Ce qui est établi | Portée |
|---|---|
| La **forme et le volume** de la demande que 100 utilisateurs adressent au backend | Vaut pour la production : elle dépend du client, pas du serveur |
| Le **débit** que le client génère à chaque palier (requêtes/seconde) | Vaut : c'est la charge à absorber |
| Le **comportement d'intégrité** sous concurrence réelle (§6) | Vaut : la sémantique d'unicité et d'upsert est celle de PostgREST |
| Le fait que les scripts sont **corrects et rejouables** contre la production | Vaut : il ne reste qu'à changer une variable d'environnement |
| Le **temps de réponse** du serveur | **`NON TESTÉ`** |
| Le **point de saturation** | **`NON TESTÉ`** |
| Le comportement du **pooler** et des quotas Supabase | **`NON TESTÉ`** |
| La tenue du **CDN GitHub Pages** | **`NON TESTÉ`** — script prêt, sans risque : `tests/load/04-statique.js` |

---

## 1. Architecture de la simulation

Répartition hybride retenue, conforme au §10 du cahier de charge :

| Volet | Effectif | Outil | Ce qu'il apporte |
|---|---:|---|---|
| Protocole | 90 | k6 | Le volume de requêtes, mesurable et reproductible |
| Navigateur | 10 | Playwright / Chromium | Ce que le protocole ne voit pas : rendu, files locales, mélange de sessions, erreurs JavaScript sous charge |
| **Total** | **100** | | |

**Pourquoi pas 100 navigateurs.** Une session Chromium chargée de ce code consomme 150 à 400 Mo
(RCN TRACE charge 1,04 Mo de JavaScript et construit 507 nœuds). Cent sessions mesureraient
surtout la machine de test. Dix suffisent à couvrir ce que le protocole ne peut pas voir.

Le volet navigateur se lance par `node tests/load/06-navigateurs.mjs`, en parallèle d'un palier
k6 à 90 utilisateurs.

### Résultat de la simulation hybride 100 utilisateurs

90 utilisateurs protocole (k6) et 10 utilisateurs navigateur (Chromium), **sur la même cible,
en même temps**, pendant 3 minutes.

| Volet | Mesure | Valeur |
|---|---|---|
| Protocole (90) | Requêtes | 10 459 |
| | Débit | 41,8 req/s |
| | Erreurs | **0 %** |
| | p95 / p99 | 2 ms / 13 ms |
| Navigateur (10) | Ouvertures de pages | 249 |
| | Saisies d'achat complètes | 16 |
| | **Échecs de parcours** | **0** |
| | **Erreurs JavaScript** | **0** |
| | **Mélanges de session** | **0** |
| | **Doublons (`local_id` ou n° de reçu)** | **0** |
| | Temps d'ouverture p50 / p95 / p99 | 176 ms / 374 ms / 2 087 ms |
| | Temps d'enregistrement d'un achat (p50) | 2 561 ms |
| Total en base à la fin | Achats | 414 |

Les 2 561 ms d'enregistrement ne sont pas un temps serveur : ils incluent l'attente délibérée du
script après le clic. Ce qui compte ici est ailleurs : **dix navigateurs réels ont tourné trois
minutes sous une charge protocolaire de 90 utilisateurs sans une seule erreur JavaScript, sans
un seul mélange d'identité et sans un seul doublon.** Le p99 d'ouverture à 2,1 s montre une
queue longue — quelques ouvertures lentes — qu'il faudra réobserver contre un serveur réel.

---

## 2. Répartition des actions

Calquée sur l'usage réel du produit, pas sur un modèle générique. Les proportions du §11 du
cahier de charge ont été retenues telles quelles, car elles correspondent à ce que la
cartographie montre d'une journée de campagne :

| Part | Action | Requêtes déclenchées | Justification |
|---:|---|---|---|
| 40 % | Consultation | `villages` (liste complète) + `hubs_clusters` | Ouvrir un module est le geste le plus fréquent ; chaque ouverture relit le référentiel en entier |
| 20 % | Recherche / filtre | `producteurs` filtrés par village + `rt` | Le formulaire d'achat recharge ces deux listes à chaque changement de village |
| 20 % | Création | `POST achats` (upsert `on_conflict=local_id`) + relecture du jour | Le geste de campagne |
| 10 % | Modification | `SELECT` de contrôle **puis** `UPSERT villages` | Reproduit fidèlement le motif de `fbms/index.html:1092` — deux requêtes par écriture |
| 5 % | Export / rapport | `achats?select=*` | Command Center et exports |
| 5 % | Opération lourde | cycle de synchronisation FBMS complet (4 lectures intégrales) | `fbms/index.html:syncNow` |

Répartition des rôles : 55 % Agent Recenseur, 25 % Supervisor, 10 % niveau Branch Manager,
10 % Consultation uniquement.

**Correction apportée en cours de campagne.** Une première série affichait 0,5 à 0,8 %
d'erreurs à partir de 50 utilisateurs. En examinant les échecs plutôt qu'en les acceptant, il
s'agissait de **refus RLS parfaitement légitimes** : le scénario faisait tenter des écritures au
rôle « Consultation uniquement », qui n'a pas ce droit. Le scénario a été corrigé — les rôles en
lecture seule consultent — et la série relancée. Les chiffres ci-dessous sont ceux de la série
corrigée. Le taux d'erreur d'un test doit mesurer l'application, pas le test.

Cadence : un geste toutes les 5 à 12 secondes par utilisateur, ce qui plafonne le débit à
≈ 43 req/s pour 100 utilisateurs — un rythme de saisie de terrain, pas un rythme de robot.

---

## 3. Paliers 1 → 100

Émulateur local, latence serveur nulle, 60 secondes par palier.

| Charge | Requêtes | Débit | Succès | Erreurs | p50 | p95 | p99 | max | Achats créés | Verdict |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 28 | 0,42/s | 100 % | 0 % | 1 ms | 2 ms | 4 ms | 5 ms | 0 | seuils respectés |
| 5 | 146 | 2,25/s | 100 % | 0 % | 1 ms | 2 ms | 3 ms | 4 ms | 11 | seuils respectés |
| 10 | 300 | 4,37/s | 100 % | 0 % | 1 ms | 2 ms | 3 ms | 4 ms | 15 | seuils respectés |
| 25 | 787 | 11,24/s | 100 % | 0 % | 1 ms | 6 ms | 8 ms | 16 ms | 43 | seuils respectés |
| 50 | 1 552 | 22,18/s | 100 % | 0 % | 0 ms | 5 ms | 28 ms | 45 ms | 71 | seuils respectés |
| 75 | 2 315 | 32,50/s | 100 % | 0 % | 0 ms | 12 ms | 26 ms | 35 ms | 108 | seuils respectés |
| 100 | 3 037 | 43,17/s | 100 % | 0 % | 0 ms | 10 ms | 21 ms | 31 ms | 135 | seuils respectés |

**Lecture honnête de ce tableau** : le débit croît linéairement avec le nombre d'utilisateurs
(0,43 req/s par utilisateur, constant du palier 1 au palier 100), les temps restent au niveau du
bruit, et la concurrence côté serveur n'a jamais dépassé **1**. Autrement dit : *le générateur
de charge a fonctionné, la cible n'a rien senti*. Le seul enseignement solide est celui du
débit : **100 utilisateurs actifs demandent environ 43 requêtes par seconde en régime de
saisie**.

### Temps par famille d'action (ms — p50 / p95 / p99)

| Charge | Authentification | Consultation | Recherche | Création | Modification | Export | Opération lourde |
|---:|---|---|---|---|---|---|---|
| 1 | 2 / 6 / 7 | 1 / 1 / 2 | 1 / 1 / 1 | — | — | — | — |
| 5 | 2 / 3 / 4 | 1 / 2 / 3 | 1 / 1 / 2 | 1 / 3 / 4 | 1 / 2 / 2 | 2 / 2 / 2 | — |
| 10 | 2 / 4 / 4 | 1 / 2 / 4 | 1 / 1 / 2 | 1 / 2 / 3 | 1 / 3 / 3 | 1 / 1 / 1 | 1 / 3 / 3 |
| 25 | 1 / 8 / 10 | 1 / 6 / 11 | 1 / 5 / 8 | 1 / 7 / 9 | 1 / 8 / 12 | 1 / 5 / 7 | 1 / 7 / 16 |
| 50 | 1 / 27 / 45 | 1 / 3 / 7 | 1 / 1 / 5 | 1 / 4 / 7 | 1 / 8 / 11 | 1 / 5 / 6 | 1 / 4 / 8 |
| 75 | 1 / 14 / 31 | 1 / 13 / 23 | 1 / 13 / 24 | 1 / 12 / 25 | 1 / 14 / 25 | 1 / 18 / 23 | 1 / 13 / 41 |
| 100 | 1 / 22 / 32 | 1 / 10 / 20 | 1 / 7 / 15 | 1 / 8 / 21 | 1 / 9 / 22 | 1 / 11 / 20 | 1 / 9 / 25 |

L'authentification est systématiquement l'action la plus lente, y compris sur un émulateur :
c'est la seule qui n'est pas une simple lecture. Sur un serveur réel, l'écart sera bien plus
marqué — GoTrue vérifie un mot de passe haché à chaque connexion.

### Seconde série : 150 ms de latence serveur injectée

Pour observer le client face à un serveur qui répond lentement — et non face à un serveur
instantané — la même série de paliers a été rejouée avec 150 ms de latence injectée dans
l'émulateur. **Ce n'est pas une mesure de la latence réelle vers Supabase** : c'est un paramètre
de scénario, choisi comme ordre de grandeur plausible pour une liaison mobile ouest-africaine.

| Charge | Requêtes | Débit | p95 | p99 | Erreurs |
|---:|---:|---:|---:|---:|---:|
| 1 | 28 | 0,43/s | 153 ms | 157 ms | 0 % |
| 5 | 146 | 2,12/s | 152 ms | 153 ms | 0 % |
| 10 | 292 | 4,14/s | 152 ms | 154 ms | 0 % |
| 25 | 720 | 10,48/s | 154 ms | 155 ms | 0 % |
| 50 | 1 473 | 20,56/s | 154 ms | 162 ms | 0 % |
| 75 | 2 165 | 30,51/s | 153 ms | 159 ms | 0 % |
| 100 | 2 915 | 41,03/s | 156 ms | 159 ms | 0 % |

Le p95 reste **plat à 153–156 ms** du premier au centième utilisateur : aucune file d'attente ne
se forme, la latence observée est exactement celle injectée. Deux enseignements réels :

- **le client ne s'écroule pas quand le serveur est lent** : pas de tempête de reprises, pas de
  multiplication des requêtes, pas de blocage ;
- le débit ne baisse que de 5 % (43,2 → 41,0 req/s) : la cadence est imposée par le rythme de
  saisie, pas par le réseau. **Cent utilisateurs demanderont donc ≈ 41 req/s même sur une
  liaison médiocre** — le dimensionnement ne se relâche pas quand le réseau se dégrade.

---

## 4. Montée progressive et maintien

Profil : 0 → 10 → 25 → 50 → 75 → 100, puis **2 minutes de maintien** à 100.

| Indicateur | Valeur |
|---|---|
| Requêtes | 13 208 |
| Débit moyen | 27,9 req/s |
| Taux d'erreur HTTP | **0 %** |
| p95 / p99 | 1 ms / 1 ms |
| Maximum observé | 10 ms |
| Dégradation pendant le maintien | **aucune** |
| Concurrence serveur maximale | 1 |

Aucune dérive, aucune erreur, aucun signe de fuite. **Sur cette cible**, ce qui, à ce niveau de
sollicitation, était acquis d'avance.

---

## 5. Pic 10 → 100

Profil : 45 s à 10 utilisateurs (référence), montée à 100 en **10 secondes**, 90 s sous pic,
retombée à 10, 90 s de récupération.

| Indicateur | Valeur |
|---|---|
| Requêtes | 7 029 |
| Taux d'erreur HTTP | **0 %** |
| p95 / p99 | 1 ms / 1 ms |
| Maximum | 21 ms |
| Récupération après le pic | immédiate, retour au niveau de référence |

**Ce que ce test ne prouve pas** : que la production encaisserait le même pic. Ce qu'il prouve :
que le client n'introduit aucun comportement pathologique lors d'une arrivée brutale — pas de
tempête de reconnexions, pas de multiplication des requêtes, pas de blocage d'interface.

---

## 6. Concurrence dure — le résultat le plus important de ce rapport

25 utilisateurs pendant 60 secondes, ciblant **volontairement les mêmes enregistrements**.
1 500 itérations, 6 000 requêtes.

| Contrôle | Résultat | Interprétation |
|---|---|---|
| **Même `local_id` d'achat envoyé deux fois** | **500 contrôles sur 500 réussis** — aucun doublon | La contrainte `achats.local_id text unique` et `resolution=ignore-duplicates` tiennent parfaitement sous concurrence. **C'est le point fort de l'application.** |
| **Même fiche village modifiée simultanément** | **211 écrasements silencieux sur 500 écritures — 42 %** | Confirmation à l'échelle de BUG-006. Quatre écritures concurrentes sur dix disparaissent sans que personne ne l'apprenne. |
| **Même numéro de reçu papier** | **500 contrôles sur 500 en échec** : chaque contrôle trouve plusieurs achats sous le même numéro | Confirmation de BUG-007. Aucune contrainte n'existe sur `numero_recu`. |

> **Précision sur le compteur `doublons_recu_acceptes` (14 232).** Ce compteur additionne, à
> chaque contrôle, le nombre de lignes excédentaires trouvées. Comme plusieurs utilisateurs
> virtuels partagent le même numéro de reçu de test, la même ligne est recomptée à chaque
> passage : **14 232 n'est pas un nombre de doublons distincts**. Le chiffre à retenir est
> « 500 contrôles sur 500 trouvent plus d'un achat sous le même numéro de reçu ».

Les 211 écrasements sont un chiffre solide et directement transposable : le motif « lire puis
écrire » de `fbms/index.html` ne dépend d'aucune particularité de l'émulateur. Sur PostgreSQL
réel, il se comporterait de la même façon — c'est la définition d'un contrôle non atomique.

**Extrapolation prudente** : le test provoque volontairement la collision à chaque itération.
En usage réel, deux utilisateurs modifient rarement la même fiche village à la même seconde.
Le taux de 42 % ne se transpose pas ; ce qui se transpose, c'est que **rien n'empêche la perte
quand la collision se produit**, et que personne n'en est averti — ni l'auteur de la
modification perdue, ni celui qui l'a écrasée.

---

## 7. Publication statique (GitHub Pages)

Exécuté contre le serveur local, montée 0 → 100 sur 100 secondes puis 60 secondes de maintien.

| Indicateur | Valeur |
|---|---|
| Requêtes | 8 205 |
| Débit | 43,7 req/s |
| Erreurs | 0 % |
| p95 | 1 ms |

`NON TESTÉ` contre GitHub Pages. **C'est le premier test à lancer le jour où l'accès sortant est
ouvert** : il est en lecture seule, sans aucun risque pour les données, et il mesure la seule
couche que le projet ne maîtrise pas.

```bash
k6 run -e SITE=https://nwodobe.github.io/fbms tests/load/04-statique.js
```

---

## 8. La demande client à 100 utilisateurs — le chiffre à retenir

Cette section ne dépend pas de l'émulateur : elle vient des mesures navigateur du rapport 06,
qui portent sur le code réel.

| Situation | Requêtes/seconde adressées au backend |
|---|---:|
| 100 utilisateurs en régime de saisie (rythme 5–12 s) | **≈ 43** |
| 100 utilisateurs ouvrant RCN TRACE dans la même minute (début de journée) | **≈ 67 en pic** |
| 100 utilisateurs laissant la Cartographie ouverte, sans rien toucher | **15, en permanence** |
| 100 utilisateurs sur FBMS Référentiel, synchronisation automatique toutes les 5 min | **rafales** de ≈ 1 300 requêtes, si chacun a 10 fiches modifiées |

Deux de ces quatre lignes sont évitables sans rien changer au métier :

- les **15 req/s permanents** de la Cartographie viennent d'un `setInterval` à 20 s, alors que la
  page dispose **déjà** d'un abonnement Realtime aux mêmes tables ;
- les **rafales de synchronisation** viennent d'un envoi fiche par fiche, en série, chacun
  précédé d'une lecture de contrôle : c'est deux requêtes par fiche là où PostgREST accepte un
  tableau d'objets en une seule.

Ces deux corrections diviseraient la charge de fond par un facteur important, avant même de
savoir ce que le serveur supporte.

---

## 9. Tableau de synthèse demandé (§24)

| Charge | Succès | Erreurs | p50 | p95 | p99 | Verdict |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 100 % | 0 % | 1 ms | 2 ms | 4 ms | seuils respectés — **cible émulée** |
| 5 | 100 % | 0 % | 1 ms | 2 ms | 3 ms | seuils respectés — **cible émulée** |
| 10 | 100 % | 0 % | 1 ms | 2 ms | 3 ms | seuils respectés — **cible émulée** |
| 25 | 100 % | 0 % | 1 ms | 6 ms | 8 ms | seuils respectés — **cible émulée** |
| 50 | 100 % | 0 % | 0 ms | 5 ms | 28 ms | seuils respectés — **cible émulée** |
| 75 | 100 % | 0 % | 0 ms | 12 ms | 26 ms | seuils respectés — **cible émulée** |
| 100 | 100 % | 0 % | 0 ms | 10 ms | 21 ms | seuils respectés — **cible émulée** |

**Aucune de ces lignes ne vaut validation de la production.** La mention « cible émulée » n'est
pas une réserve de style : la concurrence serveur observée est de 1, ce qui signifie que la
cible n'a jamais été sollicitée au-delà d'une requête à la fois.

---

## 10. Ce qui reste à mesurer, et comment

| Mesure manquante | Script prêt | Risque | Préalable |
|---|---|---|---|
| Tenue du CDN GitHub Pages à 100 ouvertures | `tests/load/04-statique.js` | **Aucun** — lecture de fichiers publics | Accès sortant |
| Temps de réponse Supabase en lecture, 1 → 100 | `tests/load/01-paliers.js -e ECRITURE=0` | Faible — consomme du quota | Accès sortant + créneau hors collecte |
| Comportement en écriture sous charge | `tests/load/01-paliers.js` | **Élevé** — écrit en base | **Projet Supabase de test** (`tests/load/LISEZ-MOI.md` §3) |
| Collisions réelles sur PostgreSQL | `tests/load/05-concurrence.js` | **Élevé** — modifie une fiche existante | **Projet de test uniquement** |
| Comportement à la volumétrie de production | tous | — | Jeu de données représentatif : toutes les lectures de référentiel sont intégrales et sans pagination, le comportement à 5 000 villages n'a rien à voir avec celui à 40 |
