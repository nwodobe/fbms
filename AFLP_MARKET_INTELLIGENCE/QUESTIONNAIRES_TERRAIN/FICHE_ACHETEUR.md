# Fiche A · Point d'achat, acheteur ou pisteur (observation et questions volontaires)

Version du référentiel : 1.0.0. Utilisable sur papier (fiche imprimable `QUESTIONNAIRES_TERRAIN.pdf`, produite par le générateur) et, plus tard, dans FBMS : mêmes codes.

**Consigne.** Observer ce qui est visible. Ne demander que des informations que l'acteur accepte de donner. Ne jamais discuter de prix à fixer ensemble, de partage de villages ou de stratégie : interdit.

**En-tête à remplir à chaque fiche** : date, heure, cluster, village, panel (FIXE / TOURNANT / HORS PANEL), type d'acteur, code agent, date du fait rapporté si différente, refus OUI/NON.

**Source de chaque réponse** : V = vu par l'agent · R = reçu ou preuve (photo de reçu, document) · D = dit par la personne · I = entendu dire (information indirecte).

| Code | Module | Cat. | Question | Réponse attendue | Unité |
|---|---|---|---|---|---|
| `A01_POINT_ACTIF` | M04 | B | Le point d'achat est-il ouvert et actif aujourd'hui ? (observé) | ACTIF / INACTIF / FERMÉ DÉFINITIVEMENT |  |
| `A02_PRIX_AFFICHE` | M02 | B | Quel prix d'achat est annoncé ou affiché ? | FCFA/kg | FCFA/kg |
| `A03_TRANSACTION_VUE` | M02 | B | Une vente a-t-elle été vue ? Prix payé, poids, reçu ? | FCFA/kg + kg + reçu | FCFA/kg |
| `A04_PAIEMENT` | M02 | B | Comment l'acheteur paie-t-il ? (s'il le dit) | COMPTANT / DIFFÉRÉ / MOBILE MONEY |  |
| `A05_SACS` | M04 | B | L'acheteur a-t-il des sacs ? (observé) | OUI / PEU / NON |  |
| `A06_ENLEVEMENT` | M05 | B | Depuis combien de jours le stock attend-il un camion ? (s'il le dit) | jours | jours |
| `A07_STOCK_VU` | M05 | B | Stock visible au point d'achat (estimation en sacs, seulement si vu) | sacs | sacs |
| `A08_MOBILISATION` | M04 | B | Des actions de mobilisation des producteurs sont-elles visibles ? | texte court |  |
| `A09_NOUVEAU` | M04 | B | Nouvel acheteur ou nouveau point d'achat dans la zone ? | OUI / NON + type |  |
| `A10_QUALITE` | M06 | B | Contrôle qualité observé (KOR, humidité) ? Valeur et appareil | KOR lbs / humidité % |  |

Règles : noter le montant et l'unité tels que dits (ex. 20 000 F le sac de 80 kg) ; préciser prix demandé, proposé ou payé ; une quantité dite n'est pas une quantité vue ; aucun nom, aucun téléphone ; un refus est respecté et noté.
