# AFLP FLEET 10 : aptitude technique et parcours de mise en service

**Statut exact (03/11/2026, 21 h 45 UTC) :**
- **Serveur : APPLIQUÉ EN PRODUCTION** sur demande du Branch Manager (« corrige les défauts et adoucis le module »). Empreintes des 8 fonctions identiques à la réplique testée. Aucun statut de moto, aucun contrôle existant, aucune politique RLS modifié (vérifié avant et après).
- **Écran : en attente de la fusion de la PR #286** (revue humaine), puis augmentation de `CACHE_VERSION` dans `sw.js`. D'ici là, l'écran actuel fonctionne avec le nouveau serveur (compatibilité testée).

## 1. Diagnostic : ce qui rendait la moto « dure à rendre apte »

Constaté en lisant les fonctions de production (empreintes identiques à la réplique) et l'historique réel :

| # | Blocage | Preuve |
|---|---|---|
| B1 | Trois boutons de contrôle visibles (inspection initiale, état contradictoire, contrôle de remise en service) ; un seul rend la moto apte, rien ne le dit | MOTO-003 : 4 contrôles enregistrés le 03/11 (1 inspection, 2 états de remise, 1 remise en service) là où 1 suffisait |
| B2 | Après réparation et levée d'immobilisation, retour à « À contrôler » : il fallait refaire une inspection initiale complète (13 points, 5 photos si moto en exploitation) après la contre-visite qui vérifie déjà les mêmes 13 points | `moto_recalculer_statuts` ne regardait que l'inspection initiale |
| B3 | Conclusion « Apte / Inapte » saisie à la main : charge inutile et faille (un éclairage ou un klaxon HS pouvait être déclaré apte) | `moto_inspection_initiale` reprenait le résultat envoyé par le client hors point critique |
| B4 | Écran et serveur divergeaient : l'écran affichait « aucune anomalie critique ouverte » comme condition de circulation, le serveur ne la vérifiait pas | `moto_mettre_en_service` |
| B5 | Rien ne disait quoi faire ensuite (quel document manque, quelle étape) : 5 conditions génériques, il fallait ouvrir Documents et Anomalies | `ongletSynthese` |
| B6 | Garage obligatoire, saisie perdue si la fenêtre se fermait | formulaire d'inspection |
| B7 | Le coordinateur logistique, autorisé par le serveur à faire la contre-visite, n'avait pas le bouton | droits écran `incident_piloter` |

## 2. Options comparées

| Option | Gain | Risque | Verdict |
|---|---|---|---|
| A. Alléger le formulaire (supprimer des champs, des photos) | Rapide | Baisse de preuve et de sécurité ; ne règle ni B1, ni B2, ni B4 | Rejetée seule |
| B. Assistant guidé | Lève B1, B5, B6 | Ne corrige pas la règle serveur (B2, B3, B4) | Retenue |
| C. Parcours selon le risque | Lève B2, B3, B4 : seul le risque réel bloque | Liste des points bloquants = décision métier | Retenue |

Solution livrée : **B + C**, sans table ni statut nouveau.

## 3. Ce qui change

**Serveur** (`supabase/20261106090000_aflp_fleet_10_aptitude_mise_en_service.sql`)
- Résultat calculé : critique → inapte + immobilisation ; point bloquant pour la circulation → inapte ; avis défavorable du mécanicien → inapte ; autres défauts décrits → apte (« Apte avec réserves »). Un « APTE » envoyé par le client n'est jamais repris.
- Paramètre `points_circulation_bloquants` (provisoire, modifiable par le BM, journalisé) : ECLAIRAGE, KLAXON, RETROVISEURS, CHAINE, NIVEAU_HUILE, NUMEROS, TRANSMISSION. Les points critiques bloquent toujours.
- Mécanicien nommé toujours obligatoire ; garage facultatif. Compteur et 5 photos de l'état de référence inchangés.
- Contre-visite APTE (personne autre que l'utilisateur de la moto) rend la moto apte sans refaire l'inspection, à condition qu'une inspection initiale existe. Une contre-visite inapte retire l'aptitude ; un point critique à la contre-visite immobilise.
- Mise en service refusée tant qu'un défaut de sécurité reste ouvert (non clôturé après vérification par une autre personne). La vue flotte retire « autorisée à circuler » dans le même cas.
- Lecture `moto_aptitude(moto)` : liste courte des exigences restantes, calculée par le serveur.

**Écran** (`moto/moto-app.js`, `moto-core.js`, `moto.css`)
- Section « Aptitude et mise en service » : 2 cartes séparées (aptitude technique, autorisation de circuler), 4 étapes, « Ce qu'il reste à faire » avec bouton d'action direct, lien vers l'historique.
- Bouton « Évaluer l'aptitude » : un formulaire en 4 étapes, 13 points sans aucune réponse pré-remplie, niveau de risque affiché par point, description exigée pour une réserve, résultat calculé en direct (même règle que le serveur), brouillon local restauré (texte et réponses, jamais les photos).
- Contre-visite proposée seulement quand elle sert ; ouverte aux 4 classes que le serveur autorise déjà.
- Aucun bouton « forcer apte ».

## 3 bis. Assouplissements ajoutés le 03/11/2026 (2e passe)

- **Un contrôle complet clôture les défauts constatés corrigés.** Contre-visite ou nouvelle évaluation qui trouve conforme un point en défaut : l'action est clôturée, avec la trace du contrôle (vérificateur, date, mécanicien). Plus besoin du circuit planifier / déclarer réalisé / vérifier pour un défaut non critique.
  Garde-fous testés : jamais une action CRITIQUE (levée d'immobilisation inchangée), jamais par l'utilisateur de la moto, jamais par celui qui a déclaré la réparation.
- **Niveau d'huile bas** devient une réserve (à décrire) et non plus un blocage.
- La contre-visite enregistre désormais ses défauts comme actions correctives (suivi identique à l'inspection).

Défauts corrigés au passage : fonction `moto_formation_support_immuable` (migration 9) exécutable par `anon` et sans `search_path` fixé ; test FL-16 faux du 2 au 19 de chaque mois (la fenêtre de coordination qui s'ouvre après la mise en service est légitimement due).

## 4. Mesure réelle (navigateur, même parcours avec l'écran de production puis le nouveau)

| Parcours | Avant | Après |
|---|---|---|
| Première évaluation, moto en exploitation (13 points, compteur, 5 photos) | 2 écrans, 24 actions | 2 écrans, 22 actions |
| Après immobilisation et réparation | contre-visite (2 écrans, 16 actions) **+ nouvelle inspection complète (2 écrans, 24 actions, 5 photos)** | contre-visite seule (2 écrans, 16 actions) : **−60 % d'actions** |
| Clôturer un défaut non critique réparé | planifier, déclarer réalisé, vérifier : 5 écrans, 10 actions, 2 personnes | 0 de plus : la contre-visite suffit |
| Savoir ce qui manque avant circulation | Synthèse + onglets Documents et Anomalies (3 écrans) | Synthèse seule (1 écran), action directe sur chaque ligne |

Lecture honnête : sur la première évaluation le gain d'actions est faible (−8 %) ; le gain principal est l'absence de mauvais chemin (B1), la fin de la double inspection (B2) et la liste d'exigences.

## 5. Tests (preuves dans `tests/moto/resultats/`)

- `tests_aptitude_10.py` : **66/66** sur réplique 1-9 + 10 (T01 résultat jamais favorable par défaut ; T02 critique ; T03 défaut bloquant ; T04 réserves justifiées ; T05 avis défavorable ; T06 aucun contournement ; T07 contre-visite ; T08 mise en service et circulation ; T09 aucun changement rétroactif et exigences réglementaires conservées ; T10 droits et cohérence écran/serveur).
- `aptitude-e2e.mjs` : **18/18** dans Chromium à 390×844, 768×1024, 1440×900, 0 erreur console, aucun débordement ; captures dans `captures/aptitude-10/`.
- `core.test.mjs` : 18/18.
- Non-régression : suites existantes rejouées avec 9 + 10 : 349/352, 204/204, 140/140, 180/180. Les 3 écarts sont voulus : FL-06f (éclairage HS n'est plus « apte »), FL-20j (moto apte après contre-visite et levée), RV-02c (l'action était déjà clôturée par un contrôle complet ; l'utilisateur reste refusé). REG-04, S25j et FL-16, qui échouaient avant ce lot, passent.
- Retour arrière : `verifier_rollback_10.sh`, empreinte identique à l'état 1-9 après migration puis rollback (chacun rejoué deux fois).

Commande unique : `PGHOST=… PGPORT=… tests/moto/executer_tests_aptitude_10.sh`

## 6. Effet constaté en production après application

Avant / après identiques : MOTO-003 APTE, MOTO-004/005/006 À contrôler, aucune en service, action OUTILLAGE toujours ouverte (non bloquante), 4 contrôles inchangés. `moto_aptitude` lue sous un compte Branch Manager : ce qui bloque réellement les 4 motos, ce sont les **3 documents obligatoires (carte grise, plaque, assurance) non déposés comme tels**, puis la remise et l'autorisation ; MOTO-004 à 006 doivent en plus être évaluées.

Mise en production : appliquer la migration après fusion, puis augmenter `CACHE_VERSION` dans `sw.js` (fichier protégé, hors de ce lot) pour que les téléphones chargent le nouvel écran. Un ancien écran en cache reste compatible (sa conclusion « Inapte » est respectée, sa conclusion « Apte » est recalculée).

## 7. Décisions à prendre et risques résiduels

1. **Liste des points bloquants** : éclairage, klaxon, rétroviseurs, chaîne, numéros, transmission (provisoire, modifiable par le BM). Batterie et niveau d'huile sont des réserves à décrire ; gilet et casque oubliés au départ ne suspendent pas la circulation dans la vue (déjà contrôlés à la remise). À valider par le BM.
2. **Contre-visite = aptitude** : la recette précédente (FL-20j) imposait une nouvelle inspection initiale. Ce lot l'inverse : décision à confirmer explicitement.
3. La contre-visite n'exige ni photo ni compteur (inchangé).
4. Un défaut signalé à la main sans code de point (« signaler une anomalie », gravité MAJEURE) ne bloque pas la circulation ; seule la gravité CRITIQUE le fait.
5. Préexistant, hors périmètre : `private.moto_formation_support_immuable()` (migration 9) est exécutable par `anon` en production (fonction de déclencheur, sans effet direct connu) ; FL-16 dépend de la date d'exécution.
6. Le résultat d'aptitude reste un avis technique, pas un certificat réglementaire.

## 8. Retour arrière

`supabase/20261106090100_aflp_fleet_10_rollback.sql` : restaure les 4 fonctions et la vue (droits compris), supprime les 3 fonctions et le paramètre ajoutés. Aucune donnée métier supprimée ; les contrôles enregistrés entre-temps restent tels quels. Écran : revenir au commit précédent de `moto/`.
