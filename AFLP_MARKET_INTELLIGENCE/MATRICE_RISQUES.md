# Matrice des angles morts, contrôles préventifs et tests

| Angle mort | Manifestation | Contrôle préventif | Test vérifiable |
|---|---|---|---|
| Biais d'échantillonnage | Villages proches des routes, producteurs proches des agents, toujours les mêmes leaders | Tirage reproductible du panel fixe ; 3 producteurs à des endroits différents ; rotation des répondants | Part des villages fixes réellement visités ; répétition d'un même répondant (code anonyme) d'une semaine à l'autre |
| Biais commercial | Prix exagérés, déclarations intéressées, rumeurs de concurrents | Séparation demandé / proposé / payé ; médiane sur prix payés seulement | `test_prix_annonce_propose_paye_separes`, `test_non_confirme_hors_conclusions` |
| Fausse corroboration | Même rumeur répétée par deux agents ou cinq médias | Champ `chaine_source` ; sans chaîne = source unique | `test_meme_rumeur_une_seule_source` |
| Double comptage | Lot vu au village, au magasin puis à l'usine | `lot_ref` obligatoire quand une preuve existe ; un lot compté une fois | `test_lot_non_double_compte` |
| Confusion des volumes | Production, stock, intention, achat, expédition, réception mélangés | Quatre grandeurs distinctes (`grandeur_volume`) ; aucune prévision de volume | `test_grandeurs_de_volume_separees` |
| Biais temporel | Fait ancien rapporté cette semaine ; saisie tardive | `date_fait` distincte ; exclusion au-delà de 14 jours ; saisie au plus tard lundi midi | `test_information_ancienne_exclue` |
| Biais agronomique | Arbres désignés non représentatifs ; floraison lue comme date de vente | Catégories A / B séparées ; matrice de rapprochement sans conversion | Lecture des résultats de l'Observatoire sans recalcul ; aucun tonnage produit |
| Qualité non homogène | Prix comparés sans KOR ni humidité | KOR et humidité mesurés seulement ; qualité déclarée distincte | Part des prix payés accompagnés d'une mesure de qualité (à suivre) |
| Réglementation | Décision 2026 appliquée à 2027 ; document non officiel | Champ « validité 2027 » ; statut ; lien vers la source | `test_reglementation_2026_non_reportee_sur_2027` |
| Confidentialité et concurrence | Données personnelles inutiles ; documents de concurrents ; coordination de prix | Aucun nom ni téléphone ; consignes sur chaque fiche ; aucun document confidentiel accepté | Revue mensuelle d'un échantillon de lignes par le Branch Manager |
| Gestion | Recommandation entraînant une dépense disproportionnée ou des déplacements inutiles | Aucune décision d'achat ou de financement générée ; coût INCONNU affiché ; autorité de décision nommée | `test_aucune_decision_achat` |
| Sécurité numérique | Doublons de synchronisation ; perte de saisie ; accès non autorisé ; preuves exposées | Identifiant unique par ligne ; la base n'est jamais écrasée (copie avant consolidation) ; sorties hors dépôt public | `test_doublon_identifiant_rejete` ; `.gitignore` des sorties |
| Fiabilité des sources | Média recopiant un autre | Une chaîne = une source ; communiqué original recherché | Registre : colonne « chaîne de source » |
| Signaux manquants | Silence des acteurs, refus, marchés informels, routes coupées | Refus comptés ; « n/d » au lieu de zéro ; mention « absence de transaction ≠ absence de marché » | `test_refus_respecte_et_compte`, `test_etat_initial_sans_observation` |

Exécution des tests : `python -m unittest discover -s tests -v` (15 tests, données fictives).
