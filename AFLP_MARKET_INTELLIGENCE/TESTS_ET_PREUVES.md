# Tests et preuves : Intelligence marché AFLP

Exécution du 22/11/2026, environnement Linux isolé, Python 3.

## Tests unitaires (données 100 % fictives, en mémoire)

`python3 -m unittest discover -s tests -v` : **15 tests, 15 réussis**.
Couverture : état initial sans donnée ; séparation prix demandé / proposé / payé ; médiane seulement si n ≥ 3 ; stades non mélangés ;
signaux non confirmés hors conclusions ; même rumeur = une source ; corroboration et contestation entre sources indépendantes ;
lot non double compté ; grandeurs de volume séparées ; information ancienne exclue ; évolution seulement si comparable ;
refus respecté ; doublon d'identifiant rejeté ; réglementation 2026 non reportée sur 2027 ; aucune décision d'achat.

Correction apportée pendant les tests : une ligne **sans chaîne de source** était comptée comme source indépendante (fausse
corroboration). Règle corrigée : chaîne absente = origine inconnue = une seule source.

## Essai de bout en bout isolé (`/tmp`, données fictives étiquetées `FIC-` et `VILLAGE-FICTIF`)

Copie de la base vierge, saisie de 4 prix payés fictifs avec preuve, relecture par le générateur :
`2027-W08 · MARCHE · 4 observation(s)` ; médiane BOTRO 422,5 FCFA/kg (n = 4, min 410, max 430), conforme au calcul manuel.
La base saisie est copiée avant consolidation et n'est jamais écrasée. Aucune donnée fictive n'a été écrite en production ni dans `sorties/`.

## Exécution réelle

`2026-W47 · ETAT_INITIAL_VEILLE · 0 observation(s) · 4 recommandation(s)`. Rapport PDF de 4 pages relu visuellement ;
classeurs ouverts et contrôlés (`BASE_VEILLE_MARCHE.xlsx` : 8 onglets avec listes déroulantes ; `REGISTRE_VEILLE_CCAK.xlsx` : 3 onglets) ;
fiches terrain imprimables (6 pages) ; brouillon Outlook FR 678 et EN 625 caractères, non envoyé.

## Non testé

Saisie Android et reprise hors ligne : pas de module FBMS à ce stade (option C non développée). Rendu sous Windows non observé.
