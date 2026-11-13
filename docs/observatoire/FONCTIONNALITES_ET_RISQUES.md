# Observatoire agronomique AFLP 2027 — périmètre livré et risques résiduels

## 1. Périmètre

### MVP livré sur la branche (testé sur réplique locale)
- Entrée « Observatoire agronomique » dans FIELD BUYING ; accès pilotage depuis le portail.
- Installation d'un champ du registre (`farmer_plots`) : blocs disjoints à repères, b fixé avant tirage, tirage reproductible journalisé et verrouillé, graines non choisies par l'agent.
- Inventaire exhaustif des blocs tirés (non modifiable), tirage de 10 titulaires et 2 réserves, codes permanents, probabilités d'inclusion, incompatibilité signalée sans gonfler N ni changer de bloc.
- Marquage GPS des arbres ; preuves photo dans un bucket privé refusé par défaut.
- Visite hebdomadaire mobile arbre 01 à 10 : aucune réponse préremplie, Retrouvé, F/N/P Oui/Non/Pas vu, chute en 5 réponses, source de preuve, raison du « Pas vu », anomalie, photo, ramassage, trois dates, fiche papier avec observateur distinct.
- Hors ligne complet : stockage local, file d'envoi dédiée, accusés serveur, idempotence, conflits explicites, propositions de correction, téléphone partagé protégé.
- Circuit : brouillon, soumission, vérification, demande de correction motivée, resoumission motivée, validation, décision sur les propositions ; historique (auteur, date, ancienne et nouvelle valeur, motif).
- Affectations agronomiques datées par campagne et cluster, accordées et révoquées par le BM.
- Écran Qualité : couverture, brouillons, visites à traiter, corrections, fiches papier, envois tardifs, non retrouvés, « Pas vu », écarts en attente.
- Suivis pilotes étiquetés non officiels : parts F/N/P et C hebdomadaire pondérées, C cumulatif par ratio pondéré, non-réponse pondérée, paliers 10/20/30 % expérimentaux affichés seulement avec plan complet et couverture ≥ 75 %.

### V1.1 (à décider)
- Contre-visite (type de visite distinct, observateur indépendant) et indicateur d'accord inter-observateurs.
- Saisie des probabilités amont (village, champ) depuis l'écran, avec le plan de sondage des 96 champs.
- Intervalle de confiance (bootstrap par champ) avant tout usage du mot « étayé ».
- Convergence avec la boîte d'envoi unique V2.1 (E0.3) et le contrat d'enveloppe § 5.1.
- Export Excel des observations validées.
- Préparation hors-ligne intégrée au bouton de préparation FIELD BUYING.

### V2
- Mode essai RT (séparé, jamais dans les indicateurs de référence).
- Carte des arbres et des champs ; rappels de visite.
- Événements de maturité exploités (délais floraison → chute) après calibration.

### Expérimental, désactivé par défaut (non livré)
- Étude des 90 fruits, prévisions IA (`aflp-ia-predictif` non utilisé), toute conversion en tonnage.

## 2. Risques résiduels

| N° | Risque | Gravité | Probabilité | Mesure en place | Action restante |
|---|---|---|---|---|---|
| R1 | Écart entre la réplique de test (18/09) et la production réelle (RLS, fonctions) | Élevée | Moyenne | Migrations additives ; empreinte de l'existant contrôlée ; dépendance au registre réduite à une RPC | Staging Supabase fidèle (P0-03, décisions D4/D5) puis rejouer la recette |
| R2 | Faille dans une RPC SECURITY DEFINER non couverte par les tests | Élevée | Faible | 68 tests sécurité (identité falsifiée, hors périmètre, AUH, RT, inactif, anon, écriture directe, privilèges EXECUTE, propriétaires) | Revue humaine du code + conseillers Supabase après application en staging |
| R3 | Manipulation du tirage par le découpage déclaré (B) ou le comptage (N) | Moyenne | Moyenne | Graines non choisies, tirage verrouillé et journalisé, inventaire non modifiable | Contre-visite d'un échantillon de champs (V1.1) |
| R4 | Lecture d'un suivi pilote comme chiffre officiel | Élevée | Moyenne | Bandeau permanent, étiquette `PILOTE_NON_OFFICIEL`, paliers masqués sans plan complet | Consigne écrite du BM aux destinataires |
| R5 | Biais de non-réponse (« Pas vu », arbres non retrouvés) | Moyenne | Moyenne | Non-réponse pondérée publiée par stade | Analyse de sensibilité en fin de pilote |
| R6 | Perte de données si un téléphone est réinitialisé avant envoi | Moyenne | Faible | Messages explicites « Non encore sauvegardé », envoi automatique, écran Envois | Consigne terrain : envoyer chaque jour avec réseau |
| R7 | Deux files hors ligne sur le même appareil (FIELD BUYING et Observatoire) | Faible | Certaine | Files indépendantes, aucune interférence testée | Convergence E0.3 |
| R8 | Aucun compte « Assistant Unit Head » actif en production | Moyenne | Certaine | Rôle présent dans la contrainte de `profils` | Créer les comptes AUH avant ouverture |
| R9 | Probabilités amont non saisies : pondération limitée au champ | Moyenne | Élevée | Statistique marquée « descriptive », sans palier | Saisie par le BM après tirage des villages et champs |
| R10 | Règles du dépôt (`CLAUDE.md`, plan du lot A) qui interdisent aux agents `supabase/**` | Moyenne | Certaine | Fichiers nouveaux, additifs, non appliqués, signalés | Revue humaine explicite de la PR |
| R11 | Branche non poussée : aucun lien de PR | Élevée pour le calendrier | Certaine | Lot git complet fourni (bundle) | Autoriser l'accès en écriture au dépôt ou pousser soi-même |
