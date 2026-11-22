# Plan d'intégration dans FBMS : architecture, prototype, tests, publication

## 1. Comparaison des options

| Critère | A. Papier + Excel | B. Collecte structurée + génération locale (**MVP livré**) | C. Espace « Intelligence marché AFLP » dans FBMS |
|---|---|---|---|
| Coût | Impression des fiches | Nul (Python local) ; développement fait | Migrations, écrans hors ligne, RLS, recette : plusieurs jours |
| Fiabilité | Faible (ressaisie, pas de contrôle) | Bonne : listes contrôlées, statuts, dédoublonnage, tests | La meilleure (contrôles serveur, journal) |
| Formation | Faible | Faible (fiches papier identiques aux codes) | Moyenne (nouvel écran) |
| Maintenabilité | Mauvaise | Bonne (référentiel unique) | Bonne si le référentiel est repris tel quel |
| Hors ligne | Total (papier) | Papier sur le terrain, saisie au bureau | Saisie mobile hors ligne, synchronisation |
| Risques | Erreurs de saisie, fichiers multiples | Un fichier maître à protéger | Régression applicative ; sécurité si RLS mal posée |

**Choix** : B maintenant (pré-campagne), C après 4 à 6 semaines de collecte réelle, pour intégrer des fiches éprouvées.

## 2. MVP livré (option B)

- `veille/referentiel.py` : source unique des listes, colonnes et 5 questionnaires (P, A, C, T, V).
- `generer_rapport_marche.py` : lit `BASE_VEILLE_MARCHE.xlsx`, consolide, produit rapport PDF, brouillon Outlook, registre CCAK,
  fiches imprimables. La base saisie n'est jamais écrasée (copie avant consolidation, consolidation dans un fichier séparé).
- 15 tests sur données fictives. Aucune donnée fictive dans la production.

## 3. Option C : conception proposée (non développée, non appliquée)

Réutiliser les mécanismes existants plutôt que créer une nouvelle architecture :
- **Tables** : `mkt_observations` (colonnes du référentiel, `campaign_id`, `cluster_code`, `village_id`), `mkt_statut_historique`,
  `mkt_registre_reglementaire`. Ne pas réutiliser `rcn_proc_prix_marche` (procurement, sans nature de prix ni fiabilité) ;
  ne pas dupliquer les achats (`field_lots`, `field_shipments`) ni l'aval PJS : vues de lecture seulement.
- **Hors ligne** : file d'attente locale identique à celle de l'Observatoire (`shared/observatoire-hors-ligne.js`), clé d'idempotence par ligne.
- **Droits** (fonctions `private.*` sur le modèle `pheno_peut_lire_cluster`) : Unit Head et Assistant saisissent pour leur cluster ;
  Zonal Head valide et attribue les statuts dans sa zone ; Branch Manager et ABM lisent tout et produisent le rapport.
  Les RT n'ont pas de compte : fiches papier saisies par le Chef d'Unité, auteur et saisisseur distincts.
- **Rapport** : fonction serveur réservée BM / ABM / ZH ; rapports gelés dans une table, jamais réécrits.
- **Navigation V2.1** : saisie dans l'espace Terrain, validation et tableau de bord dans l'espace Management.

## 4. Tests à réaliser avant publication

1. Jeux fictifs SQL sur le projet de recette `fbms-recette-observatoire` (jamais en production).
2. Droits : UH d'un autre cluster, AUH, Supervisor, anon refusés ; ZH limité à sa zone.
3. Android (APK, itel de référence et émulateur) : saisie en mode avion, reprise, double envoi sans doublon.
4. Génération du rapport depuis les données de recette ; comparaison avec le moteur Python sur le même jeu.
5. Portes du dépôt : `verifier-html`, `verifier-js`, `verifier-liens`, `verifier-pages` (3 largeurs).

## 5. Étapes de publication et validations

| Étape | Validation requise |
|---|---|
| Fusion de ce MVP (documentation + outil local) dans `main` | GO du Branch Manager |
| Validation de la liste des villages fixes et des fiches | Branch Manager |
| Migrations de l'option C sur la recette | Branch Manager |
| Migrations en production, RLS | Autorisation explicite du Branch Manager |
| Publication Web et OTA stable | GO explicite du Branch Manager |
| Envoi d'un rapport à la Direction | Validation du Branch Manager à chaque envoi |

Coûts : développement interne ; carburant de collecte à chiffrer ; aucun abonnement requis.

## 6. Fonctionnalités restant à développer dans FBMS

Saisie mobile des 5 fiches · statuts et historique · tableau de bord par cluster · registre réglementaire partagé ·
rapprochement automatique avec l'Observatoire et les achats (lecture seule) · export du rapport · rappels de collecte du panel.
