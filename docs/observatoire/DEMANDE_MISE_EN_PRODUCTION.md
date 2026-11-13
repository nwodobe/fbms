# Demande unique de validation : mise en production de l'Observatoire AFLP 2027

**Destinataire :** Monsieur KOUASSI, Branch Manager, ANAGROCI Centre, Bouaké.
**Date :** 13/11/2026. **Branche :** `feature/aflp-observatoire-2027` (base `3686cb1`, 13 commits). **État de la production :** inchangée ; aucune table `pheno_*` n'existe.

## 1. Recommandation

**Ne pas mettre en production aujourd'hui.** Je recommande une décision en deux temps, que vous pouvez prendre maintenant en une seule fois :

| N° | Décision demandée | Recommandation | Effet si accordée |
|---|---|---|---|
| D1 | Publier la branche sur GitHub (vous-même, procédure `PROCEDURE_TRANSFERT_GITHUB.md`) et ouvrir la demande de fusion en brouillon | OUI | Code inspectable par un auditeur indépendant (exigence P0 de la contre-expertise) |
| D2 | Créer un projet Supabase de TEST isolé (payant, plan de l'organisation) sans aucune donnée réelle, et y exécuter la recette HTTP | OUI | Seule preuve encore manquante : Auth, PostgREST et Storage réels |
| D3 | Traiter en priorité, SÉPARÉMENT, l'anomalie du bucket `photos` (front d'abord, puis migration) | OUI, avant toute ouverture terrain | Fin de l'exposition publique de 61 portraits |
| D4 | Appliquer les 4 migrations Observatoire en production, puis fusionner le front | OUI **sous condition** : D2 réussie à 100 %, D1 faite, D3 au moins décidée | Mise en ligne du module, désactivé par défaut |

Si vous accordez D4 sous condition, j'exécute ou fais exécuter la séquence du § 4 dès que les conditions sont constatées, sans nouvelle demande, et le rapport final indiquera chaque contrôle.

## 2. Migrations exactes (dossier `supabase/`)

| Ordre | Fichier | Lignes | Empreinte SHA-256 (16 premiers) | Contenu |
|---|---|---|---|---|
| 1 | `20261113100000_aflp_observatoire_1_schema.sql` | 305 | 6caf4a7870b654a2 | 11 tables `pheno_*`, contraintes, journal immuable |
| 2 | `20261113100100_aflp_observatoire_2_securite.sql` | 224 | 3f854a8210751269 | RLS lecture seule par périmètre, bucket privé `pheno-preuves` |
| 3 | `20261113100200_aflp_observatoire_3_rpc_sync.sql` | 805 | b086f16eedfd21cd | RPC SECURITY DEFINER, `pheno_sync_batch` |
| 4 | `20261113100300_aflp_observatoire_4_vues_pilote.sql` | 138 | fd4df7ff88901c99 | Vues pilote « PILOTE_NON_OFFICIEL » |
| R | `20261113100400_aflp_observatoire_rollback.sql` | 84 | 245c4c82c2e52e77 | Retour arrière (n'est appliqué qu'en cas d'incident) |

Purement additives : aucune instruction `drop`, `delete` ou `truncate` sur un objet existant (vérifié par recherche dans les fichiers ; les 170 objets existants comparés restent identiques après migration, test NR-03).

Point de gouvernance : `CLAUDE.md` interdit aux agents de modifier `supabase/**` de façon autonome. Ces 5 fichiers sont nouveaux et soumis à votre revue ; ils ne doivent entrer dans `main` que par la demande de fusion validée.

## 3. Résultats des tests (données 100 % fictives)

| Suite | Staging fidèle | Réplique | Échecs |
|---|---|---|---|
| Serveur : RLS, RPC SECURITY DEFINER, preuves photo, synchronisation, droits par campagne | 229/229 | 229/229 | 0 |
| Non-régression SQL (dont retour arrière et réapplication) | 8/8 | 8/8 | 0 |
| Cœur JavaScript | 21/21 | 21/21 | 0 |
| Navigateur de bout en bout (Service Worker réel, hors ligne, téléphone partagé) | 60/60 | 60/60 | 0 |
| Contrôles du dépôt (HTML, JS, liens, pages × 3 largeurs) | 0 nouvel écart | | |
| **Recette HTTP sur Supabase isolé (18 contrôles)** | **NON EXÉCUTÉE** | | |

Ajouts depuis la contre-expertise : 6 attaques logiques de synchronisation (clé légitime réutilisée vers un autre cluster, installation hors cluster, envoi après désactivation du compte, envoi après mutation de l'agent) : toutes refusées, rien d'écrit. Détails : `RAPPORT_TESTS_STAGING.md`, `AUDIT_SECURITY_DEFINER.md` (36 fonctions DEFINER, 20 exposées à `authenticated`, 0 à `anon`/PUBLIC), `MANIFESTE_STAGING_170.md`.

## 4. Séquence de mise en production (après D4)

1. Point de restauration Supabase vérifié (heure notée) ; export du schéma `public`.
2. Contrôles préalables en lecture seule (`DOSSIER_TECHNIQUE.md` § 4) : aucun `pheno_*`, dépendances présentes, bucket `pheno-preuves` absent.
3. Comparaison des empreintes SHA-256 des fichiers appliqués avec le tableau du § 2 (pas de dérive entre code testé et code déployé).
4. Migrations 1, 2, 3, 4, chacune dans sa transaction ; arrêt au premier écart.
5. Contrôles après migration : 11/11 tables sous RLS ; 0 politique d'écriture directe ; 0 fonction exécutable par `anon` ; conseillers de sécurité Supabase sans nouvel avertissement `pheno_*`.
6. Recette HTTP courte en production avec comptes de recette dédiés, sans donnée réelle : H-01, H-04, H-05, H-12.
7. Fusion du front par la demande de fusion validée. Module **désactivé par défaut** ; RT expérimental, étude des 90 fruits et prévisions IA désactivés.
8. Vous créez la graine de tirage de la campagne ; recette sur un champ de démonstration ; ouverture aux agents.

## 5. Risques résiduels

| Risque | Gravité | Traitement |
|---|---|---|
| Comportement Auth / PostgREST / Storage non testé en HTTP | P0 | D2 |
| Code non inspectable par un tiers (branche non publiée, refus d'écriture GitHub pour l'agent) | P0 | D1 |
| Bucket `photos` existant public, écriture et suppression par tout compte connecté | ÉLEVÉE, hors module | D3, `ANOMALIE_BUCKET_PHOTOS.md` |
| PostgreSQL 16 en test contre 17.6 en production | P1 | Couvert par D2 (projet en 17.x) |
| Retour arrière destructif une fois des données réelles saisies | P1 | Après les premières données : désactiver le module (revert du front) plutôt que supprimer les tables ; script R seulement après export |
| Lecture des indicateurs pilote comme chiffres officiels | P1 | Libellé permanent « PILOTE, NON OFFICIEL » ; dénominateurs et poids affichés |
| Cache photo du Service Worker sur téléphone partagé | P2 | Non testé ; le cache IndexedDB est cloisonné (E2E-58 à 60) |
| Marquage physique des arbres et découpage des blocs déclaratifs | Terrain | Contre-visites ; aucun test logiciel ne le prouve |

## 6. Retour arrière

- **Front :** revert du commit de fusion ; tables conservées, invisibles à l'écran, aucune perte.
- **Base avant toute donnée réelle :** export `pg_dump --data-only --table 'public.pheno_*'`, puis script R ; l'existant redevient strictement identique (NR-06 sur staging et réplique).
- **Base après données réelles :** ne pas supprimer ; revert du front uniquement, puis décision séparée.
- **Restauration complète :** point de restauration de l'étape 1.
- **Téléphones :** la file `anagroci_observatoire` est conservée ; les envois refusés restent visibles et réessayables.

## 7. Ce que je n'ai pas fait

Aucune migration en production, aucune fusion, aucun déploiement, aucune donnée réelle copiée, aucun contournement du refus d'écriture GitHub ou du refus de téléchargement d'exécutables externes (qui aurait permis une recette HTTP locale).
