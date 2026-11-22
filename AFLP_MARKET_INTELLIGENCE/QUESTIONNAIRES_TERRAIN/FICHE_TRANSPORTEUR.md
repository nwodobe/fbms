# Fiche T · Transporteur, chauffeur ou gare de chargement

Version du référentiel : 1.0.0. Utilisable sur papier (fiche imprimable `QUESTIONNAIRES_TERRAIN.pdf`, produite par le générateur) et, plus tard, dans FBMS : mêmes codes.

**Consigne.** Seulement des informations données volontairement. Aucun suivi de véhicule ou de personne.

**En-tête à remplir à chaque fiche** : date, heure, cluster, village, panel (FIXE / TOURNANT / HORS PANEL), type d'acteur, code agent, date du fait rapporté si différente, refus OUI/NON.

**Source de chaque réponse** : V = vu par l'agent · R = reçu ou preuve (photo de reçu, document) · D = dit par la personne · I = entendu dire (information indirecte).

| Code | Module | Cat. | Question | Réponse attendue | Unité |
|---|---|---|---|---|---|
| `T01_DISPO_VEHICULES` | M05 | B | Trouve-t-on facilement des camions cette semaine ? | FACILE / DIFFICILE / IMPOSSIBLE |  |
| `T02_TARIF` | M05 | B | Tarif de transport annoncé (trajet, unité) ? | FCFA par sac / tonne / voyage | FCFA |
| `T03_CHARGEMENTS` | M05 | B | Chargements de noix vus aujourd'hui (nombre de camions, origine, destination si connue légalement) | nombre | camions |
| `T04_ROUTE` | M07 | B | État de la route et des ponts vers les villages ? | BON / DIFFICILE / COUPÉ |  |
| `T05_INCIDENT` | M05 | B | Événement qui bloque les transports ? | texte court |  |

Règles : noter le montant et l'unité tels que dits (ex. 20 000 F le sac de 80 kg) ; préciser prix demandé, proposé ou payé ; une quantité dite n'est pas une quantité vue ; aucun nom, aucun téléphone ; un refus est respecté et noté.
