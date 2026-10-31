# Guide opérationnel AFLP · Sustainability, inspection et régularisation terrain

Version 1.0 · 25/10/2026 · Questionnaire de référence : **AFLP-SUST-2026.2** (25 critères, 4 domaines)

> Rappel permanent : un Farmer Passport complet **n'est pas une certification**. Il prouve qu'un dossier est renseigné et contrôlé, pas qu'un organisme certificateur l'a validé.

---

## 1. Ce qui fonctionne aujourd'hui (vérifié le 25/10/2026)

Parcours testé de bout en bout sur données synthétiques, dans une transaction annulée, avec un compte Unit Head réel :

| Étape | Résultat |
|---|---|
| Producteur → parcelle avec point GPS et précision | OK, passeport passe à MAPPED (si consentement GRANTED) |
| Deuxième parcelle pour le même producteur | OK |
| Baseline production → finalisation | OK (champs obligatoires contrôlés par le serveur) |
| Baseline Sustainability 25 réponses → finalisation | OK, passeport BASELINE, complétude 100 % |
| Inspection 25 réponses → finalisation | OK, **9 actions correctives générées automatiquement** sur les réponses à risque |
| Visite terrain | OK |
| Réponse « Non vérifié » | Traitée comme un **risque** (action critique), jamais comme une réponse favorable |

## 2. Deux blocages à lever AVANT le pilote

| Code | Blocage | Effet terrain | Correctif |
|---|---|---|---|
| **P0-1** | La règle d'enregistrement des consentements exclut Unit Head, Zonal Head et Assistant Unit Head | Aucun membre de l'équipe AFLP actuelle ne peut enregistrer le consentement recueilli. Le passeport ne dépasse jamais INCOMPLETE. | Préparé et testé : `supabase/PREPARE_20261025_consentements_roles_aflp_et_separation_taches.sql`. **Autorisation du Branch Manager requise.** |
| **P1-1** | Un même superviseur peut enrôler, saisir, finaliser puis approuver le passeport | Auto-validation possible (testé : passeport VERIFIED par son propre auteur) | Même fichier : contrôle de séparation des tâches, testé (auto-vérification refusée, vérification par un autre superviseur acceptée). |

Constat d'organisation : la base compte **7 comptes**, tous de supervision (1 Branch Manager, 1 Supervisor, 2 Zonal Heads, 3 Unit Heads). **Aucun compte agent terrain.** Les 166 enrôlements hors ligne d'octobre ont été saisis par 2 Unit Heads et 1 Zonal Head. Tant que les agents n'ont pas de compte, la séparation « collecte / contrôle » n'existe pas dans les faits.

## 3. Rôles

| Rôle | Fait | Ne fait pas |
|---|---|---|
| **Agent terrain** (`Agent Recenseur`, `Assistant Unit Head`) | Lit la notice, recueille les accords, enregistre parcelle + GPS, baselines, questionnaire, observations, photos de preuve. Soumet (finalise la saisie). | Valide un passeport. Remplit une réponse non observée. |
| **Chef d'Unité** (`Unit Head`) | Contrôle la complétude sous 48 h, renvoie les dossiers incohérents, suit les actions correctives de son cluster. | Vérifie (APPROVED) un dossier qu'il a lui-même saisi. |
| **Chef de Zone** (`Zonal Head`) | Arbitre les écarts, contrôle par sondage (≥ 10 % des dossiers finalisés, sur place pour au moins 2 %), approuve les passeports qu'il n'a pas saisis. | Approuver ses propres saisies. |
| **Branch Manager** | Supervision générale, validation des attestations, arbitrage des risques HIGH / REVIEW_REQUIRED, décisions de droits. | Saisie terrain de routine. |

Les droits de l'application font foi : capture = `farmer_registry_can_capture()`, vérification = `farmer_registry_can_supervise()`. Le rôle `RT / Field Partner` ne peut pas saisir parcelles, baselines ni inspections (choix de conception documenté).

## 4. Parcours terrain (smartphone, français, hors ligne possible)

1. **Ouvrir** Field Buying → Producteurs → fiche du producteur (recherche par Farmer ID, nom ou téléphone).
2. **Vérifier l'identité** : pièce présentée, nom, téléphone. Si doute (homonyme, téléphone partagé) : ne pas continuer, signaler au Chef d'Unité.
3. **Notice et accords** : lire la notice AFLP-NOTICE-2026.1, recueillir chaque accord séparément, enregistrer remise de notice et consentement (voir notice, mode opératoire). *Bloqué tant que P0-1 n'est pas appliqué pour les Unit/Zonal Heads.*
4. **Parcelle** : onglet Parcelles. Si une ligne « EXPLOITATION DÉCLARÉE · À VÉRIFIER » existe, c'est la superficie historique migrée.
   - Relever chaque parcelle réelle séparément : nom local, superficie déclarée, bouton GPS au centre de la parcelle (attendre une précision ≤ 15 m).
   - Quand toutes les parcelles réelles sont saisies, passer la ligne provisoire en **INACTIVE** (le Chef d'Unité le confirme). Ne jamais laisser la ligne provisoire ACTIVE à côté des parcelles réelles : double comptage.
5. **Production** : baseline production (surface productive, production précédente, prévision, arbres productifs). Finaliser.
6. **Sustainability** : 25 questions, réponse par question selon ce qui est **vu ou documenté**. Utiliser `Non vérifié` quand on n'a pas pu contrôler ; cela crée une action, c'est voulu.
7. **Preuves** : photo (registre, équipement de protection, stockage des produits) rattachée à la question. Les photos partent à la reconnexion.
8. **Inspection** : type BASELINE_CHECK à la première visite, FOLLOW_UP ensuite. GPS de la position de l'inspecteur.
9. **Actions correctives** : générées à la finalisation ; vérifier l'échéance (7 j critique, 14 j élevée, 30 j moyenne, 60 j faible) et le responsable.
10. **Soumettre** : finaliser. Le dossier apparaît chez le Chef d'Unité.

**Interdits** : préremplir des réponses favorables ; saisir une visite ou une inspection non réalisée ; copier les réponses d'un producteur à l'autre ; antidater.

## 5. Pilote six clusters

Objectif : valider le parcours réel avant généralisation. Pré-requis : P0-1 appliqué, usage de la notice AFLP-NOTICE-2026.1 en pilote autorisé par le Branch Manager (elle reste « en attente de validation juridique » et n'est pas une version officiellement approuvée), comptes agents créés si possible.

| Paramètre | Valeur |
|---|---|
| Clusters | N'Djebonoua, Brobo, Sakassou, Béoumi, Botro, Diabo |
| Échantillon | 5 producteurs par cluster = **30 dossiers**, tirés au hasard parmi les producteurs ayant une parcelle provisoire (aucun dossier en anomalie d'identité) |
| Durée | 2 semaines |
| Équipe par visite | 1 agent saisit, 1 Chef d'Unité contrôle dans les 48 h, 1 Chef de Zone vérifie 3 dossiers par cluster sur place |
| Critères de réussite | ≥ 90 % des 30 dossiers finalisés sans erreur bloquante ; 100 % des parcelles réelles avec GPS ≤ 15 m ; 0 parcelle provisoire restée ACTIVE à côté de parcelles réelles ; 100 % des consentements avec remise de notice enregistrée ; temps moyen par dossier mesuré |
| Mesures à relever | Temps par étape, échecs de synchronisation, questions incomprises, réponses « Non vérifié » par critère |
| Sortie | Note de retour d'expérience au Branch Manager, ajustements du questionnaire (version 2026.3 si nécessaire) |

Rien n'est déclaré réalisé avant la visite effective : le tableau de bord ne compte que des baselines et inspections FINAL.

## 6. Tableau de bord : ce qui est mesurable

| Indicateur | Source |
|---|---|
| Producteurs actifs, passeports par stade, complétude | `farmer_sustainability_dashboard_v` |
| Parcelles ACTIVE, points GPS, hectares déclarés / vérifiés | idem (les parcelles « À vérifier » n'y sont **pas** comptées) |
| Baselines production / sustainability finalisées, risques, actions ouvertes / en retard / critiques | idem |
| Accord de participation (attestation / documenté / absent), remise de notice, parcelles à vérifier, information + consentement complets | `farmer_regularisation_status_v` (nouvelle vue, 25/10/2026) |

Non encore affiché dans l'interface : les indicateurs de régularisation (vue disponible, écran à construire).
