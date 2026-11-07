# Régularisation des 104 RT enregistrés comme producteurs

Contexte : 104 dossiers producteurs ont été créés le 27/08/2026 par la migration `RT_AUTO_ENROLLMENT_2026_08_27` à partir du recensement des relais terrain (RT). Leur `created_at` est la date de la migration, **pas** une date d'enrôlement ni de consentement.

Règles appliquées : aucun dossier supprimé, aucun consentement créé, aucune attestation créée, le 27/08/2026 n'est utilisé comme date d'aucun accord.
Registre interne : `regularisation_aflp.rt_producteurs_20261025` (schéma non exposé).

## 1. Classement (calculé sur les données, 25/10/2026)

| Groupe | Critère | Nombre | Superficie | Parcelle provisoire | Consentement PARTIAL existant |
|---|---|---:|---:|---:|---:|
| **G1** RT qui se déclare producteur | code RT retrouvé dans la table `rt`, activité déclarée « producteur » | 81 | 14 | 9 | 13 |
| **G2** RT à activité mixte | code RT retrouvé, activité « commerçant » et « producteur » | 10 | 0 | 0 | 0 |
| **G3** Sans code RT, même téléphone qu'un RT | lien indirect seulement | 8 | 8 | 8 | 0 |
| **G4** Origine incertaine | ni code RT, ni téléphone commun | 5 | 5 | 5 | 0 |

Autres constats : 0 achat enregistré pour ces 104 dossiers ; 77 sans sexe ni âge ; 12 RT encore « Pressenti » (non confirmés).

Les 13 consentements PARTIAL existants (saisis le 28/08/2026 par un Zonal Head, verbaux, sans pièce, périmètres identité + agriculture ± photos) sont conservés tels quels. Ils ne couvrent ni le GPS, ni les inspections, ni les transactions, ni explicitement la participation AFLP.

## 2. Ce qu'il faut distinguer à la visite

La question n'est pas « est-il RT ? » (il l'est) mais « **a-t-il lui-même une plantation de cajou qu'il exploite et dont il vendra la récolte ?** ». Un RT peut être aussi producteur ; un RT commerçant qui achète la noix des autres ne doit pas être compté comme producteur pour cette activité.

| Point à vérifier | Preuve acceptable | Conséquence |
|---|---|---|
| Possède ou exploite une plantation de cajou | visite de la plantation, ou à défaut déclaration + témoin (chef de village, voisin) | Oui : reste producteur. Non : passer `operational_status` à INACTIVE (motif : « RT non producteur ») ; le dossier RT reste intact |
| La récolte vendue est la sienne | déclaration ; volume cohérent avec la superficie et les arbres | Si commerçant : ses achats auprès d'autres ne peuvent pas être tracés sous son Farmer ID |
| Superficie et parcelles | relevé GPS de chaque parcelle, superficie déclarée | création des parcelles réelles ; la parcelle provisoire éventuelle passe en INACTIVE |
| Identité complète | sexe, année de naissance, pièce | complète l'identité du passeport |
| Statut RT | confirmé ou pressenti | un RT « Pressenti » qui n'est pas producteur ne doit rester dans aucun registre actif |
| Notice et consentement données | notice AFLP-NOTICE-2026.1 lue, chaque périmètre recueilli séparément | enregistrer la remise de notice et un **nouveau** consentement daté du jour de la visite |
| Accord de participation AFLP | question explicite au producteur | à enregistrer comme accord documenté du jour de la visite, jamais antidaté |
| Conflit d'intérêt RT / producteur | le RT est-il aussi celui qui enregistre ses propres achats ? | à signaler au Chef d'Unité : ses achats doivent être saisis par un tiers |

## 3. Ordre de traitement proposé

1. **G4 puis G3** (13 dossiers) : origine la moins sûre, et tous ont déjà une parcelle provisoire qu'il ne faut pas consolider avant confirmation.
2. **G2** (10) : risque de confusion commerçant / producteur.
3. **G1 « Pressenti »** (12), puis le reste de G1.

## 4. Ce qui reste interdit

- Supprimer un dossier : on désactive avec un motif.
- Créer un consentement ou une attestation sur la base de la migration du 27/08/2026.
- Reprendre les 13 consentements PARTIAL comme preuve de participation.
- Saisir une visite non réalisée.

La liste nominative de travail (Farmer ID, nom, village, cluster, groupe, points à vérifier) est fournie séparément au Branch Manager et n'est pas versée dans le dépôt.
