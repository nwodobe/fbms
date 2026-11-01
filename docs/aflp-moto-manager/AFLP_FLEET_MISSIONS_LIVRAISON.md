# AFLP FLEET : journal de mission et kilométrage contrôlé par photo (rapport de livraison)

**Demande du Branch Manager (1er novembre 2026)**

- L'agent photographie le compteur au départ et à la fin de chaque mission.
- La caméra est celle d'AFLP FIELD PROOF.
- La machine propose le chiffre, l'agent confirme, sans aucun coût.
- La photo du tableau de bord est compressée et visible par la hiérarchie, sans coordonnées GPS.

But : connaître les distances parcourues par chaque agent et piloter les coûts.

**Statut :** développé, testé, contre-expertisé (GO pour le pilote). La migration 8 n'est **PAS** appliquée en production. Le code n'est **PAS** fusionné.

## A. Architecture retenue (3 options comparées)

| Option | Avantages | Limites | Décision |
|---|---|---|---|
| **1. Table `moto_missions`**, relevés de mission versés dans `moto_releves_km` (source MISSION), positions dans une table séparée | Compteur, échéances et carnet alimentés sans double saisie ; corrections par le circuit à quatre yeux existant ; coordonnées isolées | Une table et des règles de plus | **Retenue** |
| 2. Étendre le contrôle avant départ | Réutilise l'écran existant | Mélange sécurité et mission ; pas d'arrivée | Écartée |
| 3. Rattacher aux missions FIELD PROOF | Un seul geste | FIELD PROOF n'a pas de table serveur et garde le GPS sur le téléphone | Écartée |

**Lecture du compteur, gratuite et hors ligne** (`moto/moto-ocr.js`, environ 10 Ko, aucune dépendance) :

- La lecture compare les chiffres à des modèles dessinés sur le téléphone : plusieurs polices et l'affichage à 7 segments.
- Elle propose un chiffre seulement si chaque chiffre est net et si la valeur est vraisemblable par rapport au dernier relevé.
- **Écartée : Tesseract.js.** C'est 6 à 8 Mo à télécharger, la lecture est lente sur les téléphones d'entrée de gamme, et le fonctionnement hors ligne serait fragile.

## B. Réalisé

**Terrain** (espace Opérations, bloc « Ma mission »)

1. Démarrer la mission.
2. Photographier le compteur, avec la caméra de l'application : la galerie n'est pas accessible.
3. Confirmer ou corriger le chiffre proposé.
4. Choisir l'objet et la destination (le dernier choix est repris), puis valider.

L'arrivée suit le même parcours.

- **Hors connexion :** tout fonctionne. Une arrivée ne part jamais avant son départ.
- **Photo partagée :** environ 28 Ko, vérifié en test. Elle montre :
  - la bande du compteur, nette ;
  - le tableau de bord ;
  - un bandeau : date, heure, moto, agent, localité.

  La photo ne contient aucune coordonnée et aucune donnée EXIF.
- **Origine du chiffre :** chaque relevé garde la sienne, contrôlée par le serveur : LU_CONFIRME, LU_CORRIGE ou SAISI.

**Serveur** (`supabase/20261104090000_aflp_fleet_8_missions_kilometrage.sql`)

Refus :
- compteur qui recule ;
- compteur « NaN » ou infini ;
- deuxième mission ouverte ;
- missions qui se chevauchent ;
- moto immobilisée ou non mise en service ;
- permis non valide, vérifié aujourd'hui et à la date déclarée ;
- photo absente, déposée par un tiers, trop lourde, ou déjà utilisée (empreinte du stockage).

Écarts à vérifier (jamais une sanction) :
- km hors mission (plus de 5 km) ;
- continuité du compteur ;
- vitesse ou distance hors norme ;
- horloge du téléphone ;
- GPS absent ;
- clôture tardive ;
- saisie différée de plus de 12 h ;
- relevés reçus dans le désordre ;
- photo de taille inhabituelle ;
- empreinte différente ;
- missions qui se chevauchent (l'arrivée annule automatiquement la mission, jamais estimée).

Les écarts sont traités par un responsable, jamais par le conducteur. Une mission non clôturée n'est jamais estimée : elle est annulée avec un motif.

**Lecture**

| Rôle | Ce qu'il voit |
|---|---|
| Agent | Ses missions et ses écarts |
| Chef de zone | Sa zone, positions comprises |
| Coordinateur, ABM, BM | Tout, positions comprises |
| Finance, Direction | Missions, distances, photos et coûts ; **aucune coordonnée** |

Le journal ne contient aucune coordonnée.

**Suivi** (espace Missions)

- Indicateurs : missions, km de mission, km hors mission, missions non clôturées à temps, écarts à vérifier, part des relevés corrigés ou saisis.
- Tableaux par agent et par moto.
- Coût par km de mission et par km total ; litres aux 100 km de mission.
- Contrôle d'empreinte des photos.
- Export Excel en 4 onglets.
- Le carnet de suivi de chaque moto inclut les missions.

**Retour arrière :** `supabase/20261104090100_aflp_fleet_8_rollback.sql`.
- Il est refusé tant qu'une mission existe.
- Il est prouvé identique à l'état actuel de la production, et peut être rejoué.

## C. Tests (réplique locale, données fictives uniquement)

| Contrôle | Résultat |
|---|---|
| Suites serveur existantes (1 à 7) | 352 + 204 + 140 réussis, aucune régression |
| Suite serveur migration 8 (`tests/moto/tests_missions_8.py`) | **180/180**, dont 68 attaques issues de la contre-expertise |
| Navigateur, 3 largeurs (`tests/moto/e2e/moto-e2e.mjs`) | **117/117**, dont 6 parcours de mission avec une caméra simulée |
| Retour arrière (`tests/moto/verifier_rollback_8.sh`) | Empreintes identiques, rejouable |
| Portes du dépôt (HTML, liens, JavaScript) | 0 nouveau défaut |

**Lecture gratuite du compteur : mesurée sur des images SYNTHÉTIQUES uniquement** (`tests/moto/ocr/banc_ocr.mjs`)

| Banc | Lecture juste | Chiffre faux proposé | Abstention |
|---|---|---|---|
| Conditions nettes (300 images) | 98,3 % | 0,3 % | 1,3 % |
| Conditions dégradées : flou, reflets, bruit, rotation, occultation (300 images) | 11,0 % | 0,7 % | 88,3 % |

- Les chiffres faux concernent les compteurs à dixièmes : le dernier chiffre est perdu, soit 0,6 et 2,3 km d'erreur.
- **Le taux réel sur les compteurs APSONIC reste inconnu.** Il faut 10 à 15 photos réelles, prises au soleil, à l'ombre et de nuit.
- Dans tous les cas, le chiffre retenu est celui que l'agent confirme.

## D. Contre-expertise indépendante (4 passages)

| Passage | Verdict | Constats |
|---|---|---|
| 1 | NO_GO | 3 bloquants : empreinte non vérifiée, compteur « NaN », départ antidaté. 6 majeurs : permis expiré contourné, arrivée hors connexion perdue, km hors mission doublés, continuité, Chef de zone hors zone, interblocage |
| 2 | NO_GO | Les 9 corrections sont confirmées, mais 2 régressions : saisies hors connexion rejetées à tort, purge par le BM seul |
| 3 | GO pour le pilote, sous réserve | Réserve N1 : départs honnêtes refusés quand les missions arrivent dans le désordre |
| 4 | **GO** | N1 levée, aucun chevauchement accepté ni double comptage. Restait : arrivée refusée pour chevauchement qui bloquait la moto (désormais annulée automatiquement avec écart CHEVAUCHEMENT) ; l'auteur d'une levée ne recontrôle pas la photo (corrigé) |

Tous les défauts sont corrigés et couverts par un test.

**Limites acceptées pour le pilote :**
- **Empreinte non recalculée par le serveur.** Elle est contrôlée par un responsable qui ouvre la photo, et obligatoirement **une fois par mois** pour toutes les photos. Un même fichier redéposé est refusé par l'empreinte du stockage. Une ancienne photo **réencodée** n'est détectable que par la relecture humaine du bandeau. Une fonction Edge ne changerait rien à ce cas.
- **Faux GPS et photo d'une autre moto :** non détectables par une application web. Ce risque est accepté (pas de QR) et réduit par le contrôle de continuité du compteur.
- **Seuils provisoires :** à ajuster après deux semaines avec les 4 Chefs d'unité.
- **Horloge en avance :** une heure de capture dans le futur est ramenée à l'heure de réception (écart HORLOGE). Une fenêtre résiduelle de quelques minutes peut refuser un départ capturé juste avant ; c'est sans fausse donnée.
- **Volume :** les politiques de lecture appellent des fonctions par ligne. C'est sans enjeu pour 4 motos, mais à mesurer avant d'étendre.

## E. Mise en production (sur autorisation du Branch Manager uniquement)

1. Appliquer la migration 8 sur Supabase.
2. Vérifier les empreintes de la production par rapport à la réplique.
3. Fusionner la pull request, puis vérifier le site publié aux 3 largeurs.
4. Faire des essais réels avec un Chef d'unité : 2 missions, dont une hors connexion.
5. Recueillir 10 à 15 photos réelles de compteurs pour mesurer la lecture.
