# Fiche P · Producteur (3 producteurs par village, choisis comme indiqué au plan d'enquête)

Version du référentiel : 1.0.0. Utilisable sur papier (fiche imprimable `QUESTIONNAIRES_TERRAIN.pdf`, produite par le générateur) et, plus tard, dans FBMS : mêmes codes.

**Consigne.** Se présenter, expliquer le but (connaître la saison), demander l'accord. Pas de nom, pas de téléphone. Un refus est respecté.

**En-tête à remplir à chaque fiche** : date, heure, cluster, village, panel (FIXE / TOURNANT / HORS PANEL), type d'acteur, code agent, date du fait rapporté si différente, refus OUI/NON.

**Source de chaque réponse** : V = vu par l'agent · R = reçu ou preuve (photo de reçu, document) · D = dit par la personne · I = entendu dire (information indirecte).

| Code | Module | Cat. | Question | Réponse attendue | Unité |
|---|---|---|---|---|---|
| `P01_ENTRETIEN` | M03 | A | Avez-vous déjà nettoyé votre plantation cette saison ? | OUI / NON / EN COURS |  |
| `P02_ETAT_ARBRES` | M03 | A | Vos arbres ont-ils des fleurs ? Des petites noix ? | FLEURS / PETITES NOIX / RIEN / NE SAIT PAS |  |
| `P03_RECOLTE_DEBUT` | M03 | B | Avez-vous déjà ramassé des noix cette saison ? | OUI / NON |  |
| `P04_QTE_RECOLTEE` | M03 | B | Si oui, combien avez-vous ramassé en tout ? (dire l'unité : sacs, kg, bassines) | nombre + unité | kg |
| `P05_QTE_VENDUE` | M03 | B | Combien avez-vous déjà vendu ? | nombre + unité | kg |
| `P06_STOCK_MAISON` | M03 | B | Avez-vous des noix gardées à la maison ? L'agent les a-t-il vues ? | OUI VU / OUI NON VU / NON | kg |
| `P07_PRIX_PROPOSE` | M02 | B | Quel prix un acheteur vous a-t-il proposé cette semaine ? Où et quand ? | FCFA/kg ou montant d'origine | FCFA/kg |
| `P08_PRIX_PAYE` | M02 | B | Si vous avez vendu : quel prix avez-vous reçu ? Avez-vous un reçu ? | FCFA/kg + reçu OUI/NON | FCFA/kg |
| `P09_PAIEMENT` | M02 | B | Avez-vous été payé tout de suite ou plus tard ? | COMPTANT / DIFFERE / MOBILE MONEY |  |
| `P10_PRIX_ESPERE` | M03 | B | À quel prix souhaitez-vous vendre ? | FCFA/kg | FCFA/kg |
| `P11_INTENTION` | M03 | B | Comptez-vous vendre bientôt ou attendre ? Pourquoi ? | VENDRE BIENTÔT / ATTENDRE + raison |  |
| `P12_ENGAGEMENT` | M03 | B | Avez-vous déjà promis vos noix à un acheteur ? Y a-t-il un papier ? | OUI ÉCRIT / OUI ORAL / NON / NE VEUT PAS DIRE |  |
| `P13_AVANCE` | M03 | B | (Seulement si la personne en parle d'elle-même) Avez-vous reçu une avance ? | OUI / NON / NON DEMANDÉ |  |
| `P14_SECHAGE` | M06 | B | Comment séchez-vous les noix ? Combien de jours ? | BÂCHE / SOL / AUTRE + jours | jours |
| `P15_MAIN_OEUVRE` | M03 | A | Trouvez-vous des personnes pour ramasser ? | FACILE / DIFFICILE |  |
| `P16_DIFFICULTES` | M03 | B | Quelle est votre plus grande difficulté pour vendre ? | texte court |  |

Règles : noter le montant et l'unité tels que dits (ex. 20 000 F le sac de 80 kg) ; préciser prix demandé, proposé ou payé ; une quantité dite n'est pas une quantité vue ; aucun nom, aucun téléphone ; un refus est respecté et noté.
