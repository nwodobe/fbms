# Plan d'enquête marché : protocole d'échantillonnage et calendrier

## 1. Trois échantillons distincts, à ne pas confondre

| Échantillon | Objet | Unité |
|---|---|---|
| Villages AFLP (60) | Périmètre d'achat ANAGROCI | Village |
| Champs de l'Observatoire (28 prévus) | Biologie des arbres (catégorie A) | Arbre désigné |
| **Panel marché** (ce plan) | Prix, transactions, comportements (catégorie B) | Acteur et point d'achat |

Un village peut appartenir à plusieurs échantillons ; les données restent séparées.

## 2. Panel fixe et panel tournant

- **Panel fixe : 12 villages**, 2 par cluster, tirés de façon reproductible parmi les 60 villages approuvés (empreinte SHA-256,
  graine `AFLP-MARCHE-2027-v1`, liste dans la feuille PANEL de la base). Le tirage limite le biais des villages faciles d'accès.
  **Proposition à valider par le Branch Manager** : il peut remplacer un village inaccessible, en le notant.
- **Panel tournant : 6 villages par semaine**, 1 par cluster, dans l'ordre de rotation de la feuille PANEL (les 48 autres
  villages sont tous visités en 8 à 10 semaines).
- **Par village visité** : 1 fiche Village (V) ; 3 producteurs (P), choisis à des endroits différents du village (pas seulement
  les proches de l'agent ni les leaders), en changeant de producteurs d'un passage à l'autre ; tous les points d'achat visibles (A) ;
  la coopérative si elle existe (C) ; 1 transporteur ou point de chargement si présent (T).
- **Volume pilote** : 18 villages par semaine, 3 par cluster, soit environ 54 entretiens producteurs par semaine.
  Charge : environ une demi-journée par village, intégrée aux tournées existantes des Chefs d'Unité et assistants (motos AFLP).
  Coût marginal : carburant à chiffrer avec le simulateur carburant AFLP sur les distances réelles ; **coût non documenté à ce jour**.

## 3. Calendrier

| Période | Fréquence | Contenu |
|---|---|---|
| Pré-campagne (fin novembre à l'ouverture officielle 2027) | Panel fixe toutes les 2 semaines ; veille documentaire chaque semaine | Préparatifs, stocks anciens, intentions, acheteurs présents, réglementation |
| Campagne (de l'ouverture à la fin des achats) | Panel fixe chaque semaine + panel tournant | Prix payés, transactions, stocks vus, logistique, qualité |
| Fin de campagne | Toutes les 2 semaines | Stocks résiduels, impayés, bilan |

Semaine ISO lundi-dimanche, clôture dimanche 23 h 59 (Abidjan). Saisie dans la base au plus tard le lundi midi ;
validation par le Chef de Zone ; compilation le lundi après-midi par le Branch Manager.

## 4. Circuit de collecte (sans supposer de smartphone)

1. RT ou agent remplit la fiche papier (codes identiques à la base).
2. Le Chef d'Unité ou l'assistant vérifie et saisit dans `BASE_VEILLE_MARCHE.xlsx` (puis, après intégration, dans FBMS).
   L'auteur de la fiche et le saisisseur sont notés séparément ; aucun identifiant de connexion n'est partagé.
3. Le Chef de Zone attribue le statut (CONFIRME, CORROBORE, NON_CONFIRME, CONTESTE, OBSOLETE) et trace tout changement
   dans HISTORIQUE_STATUTS.
4. Le Branch Manager lance la compilation, relit et arbitre les recommandations.

## 5. Règles d'enquête

- Accord de la personne ; refus respecté et compté ; aucun nom, téléphone ou coordonnée de personne.
- Les avances ou préfinancements ne sont notés que s'ils sont évoqués spontanément.
- Aucune information confidentielle de concurrent ; aucune discussion sur la fixation de prix, le partage de villages ou
  la stratégie commerciale avec d'autres acheteurs (risque anticoncurrentiel).
- Aucun suivi de véhicule ou de personne ; seuls les mouvements visibles ou documentés sont notés.
- Tout prix est noté avec son unité d'origine, sa nature (demandé, proposé, payé), son stade et la preuve éventuelle.
- KOR et humidité : seulement mesurés, avec l'appareil ; une qualité dite est notée « DÉCLARÉE ».

## 6. Veille documentaire (Branch Manager ou assistant, chaque lundi)

CCAK (site et délégations régionales), AIP, Ministère de l'Agriculture, African Cashew Alliance, INC, publications spécialisées
(Commodity Board, APEDA), statistiques douanières. Chaque information va au registre avec date de publication, date d'effet,
source originale, zone, disposition, conséquence, chaîne de source et statut. Une dépêche reprise par cinq médias reste une seule chaîne.
