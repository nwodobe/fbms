# Dictionnaire des indicateurs : Intelligence marché AFLP

Implémentation de référence : `veille/moteur.py`. Les indicateurs du panel décrivent les villages et acteurs enquêtés ;
ils **ne mesurent pas** l'ensemble du marché régional. Une case inconnue reste « n/d ». L'absence de transaction observée
n'est pas une preuve d'absence de marché.

## Règles transversales

| Règle | Contenu |
|---|---|
| Fait établi | statut CONFIRME (preuve directe ou source officielle) ou CORROBORE (au moins deux chaînes de source indépendantes concordantes) |
| Signal | NON_CONFIRME, CONTESTE (chaînes indépendantes en désaccord de plus de 15 %), ou information ancienne : section « Signaux à vérifier » seulement |
| Indépendance | Deux lignes de même `chaine_source`, ou sans chaîne renseignée, valent une seule source |
| Ancienneté | Fait daté de plus de 14 jours avant le début de la semaine : exclu des tendances de la semaine |
| Validation | Le statut validé par le Chef de Zone prime ; le moteur calcule un statut de contrôle et signale les désaccords |
| Comparabilité | Évolution seulement entre semaines valides, même stade commercial, même nature de prix, mêmes règles |

## Indicateurs prioritaires

| # | Indicateur | Formule | Source | Dénominateur | Limites | Contrôle |
|---|---|---|---|---|---|---|
| 1 | Prix payé bord champ : médiane, fourchette, évolution | médiane des prix `PAYE`, stade `BORD_CHAMP`, FCFA/kg, statut établi ; publiée si n ≥ 3 ; évolution = médiane S − médiane S-1 | OBSERVATIONS (M02) | nombre de prix payés comparables | Qualité (KOR, humidité) rarement homogène : la médiane mélange des qualités ; moyenne pondérée par volume seulement si toutes les quantités sont vérifiées | Recalcul indépendant dans les tests ; conservation de la valeur d'origine |
| 1b | Prix proposé, prix demandé | médianes séparées | idem | idem | Déclarations intéressées possibles | Jamais mélangés au prix payé |
| 1c | Écart au prix réglementaire | médiane payée − prix plancher **applicable à la campagne** | registre CCAK | | Aucune référence 2027 publiée : non calculé ; un écart n'est pas présumé infraction | Lien vers l'entrée du registre |
| 2 | Points d'achat actifs | `A01 = ACTIF` / points contrôlés | Fiche A | points effectivement contrôlés | Points invisibles (achats informels) non comptés | Liste par village |
| 3 | Volume de transactions documentées | Σ `quantite_kg` (grandeur `ACHETEE_OU_EXPEDIEE`, source `TRANSACTION_VERIFIEE`), un lot = une fois | M02, M05 | | Échantillon seulement | `lot_ref` dédoublonné |
| 4 | Disponibilité physique vérifiée | Σ `quantite_kg` grandeur `OBSERVEE_PHYSIQUEMENT`, lot unique | P06 (vu), A07 | | Stock vu ≠ stock vendable | Jamais additionnée aux quantités annoncées |
| 4b | Quantités annoncées | Σ grandeur `ANNONCEE_ESTIMEE` | P04, C02 | | Déclaratif | Affichée à part, jamais en disponibilité |
| 5 | Producteurs ayant commencé la récolte | `P03 = OUI` / (OUI + NON) | Fiche P | producteurs interrogés (n affiché) | Sélection des répondants | n toujours publié |
| 6 | Activité logistique | constats établis M05 (camions, tarifs, délais, routes) | Fiches A, T, V | | Observations ponctuelles | Origine/destination seulement si légalement connue |
| 7 | Nouvelles décisions réglementaires applicables | entrées du registre publiées dans la semaine | Registre CCAK | | Dépend de la veille | Statut et validité 2027 |
| 8 | Couverture et qualité des enquêtes | villages fixes visités / prévus ; villages tournants ; refus ; fiches ; part d'informations établies | OBSERVATIONS | 12 fixes + 6 tournants | | Par cluster |
| 9 | Événements significatifs corroborés | lignes M07 / M10 établies | idem | | | Preuve et incertitude obligatoires |
| 10 | Préparation opérationnelle ANAGROCI | objectifs, capacités, promesses, achats réalisés, livraisons reconnues, chacun séparé | FBMS (lots, BEV, sacherie), CAPACITES_ANAGROCI | | Fonds non sourcés aujourd'hui | Nature de chaque chiffre affichée |

## Confiance par cluster

INSUFFISANTE : aucune observation · FAIBLE : panel fixe incomplet ou moins de 5 constats établis ·
MOYENNE : panel fixe complet et au moins 5 constats établis · BONNE : idem avec une médiane de prix payé publiable.

## Seuils paramétrables (`veille/moteur.py`)

`SEUIL_PRIX = 3` · `ECART_CONTESTE = 0,15` · `ANCIENNETE_MAX_J = 14` · 2 villages fixes et 1 tournant par cluster.
