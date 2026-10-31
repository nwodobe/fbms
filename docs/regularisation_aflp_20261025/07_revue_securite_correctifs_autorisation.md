# Revue de sécurité · correctifs d'autorisation P0-1 et P1-1

Fichier revu : `supabase/PREPARE_20261025_consentements_roles_aflp_et_separation_taches.sql` (version finale v2)
Statut : **PRÉPARÉ, TESTÉ, NON APPLIQUÉ**. Principe validé par le Branch Manager le 25/10/2026 ; application en production non autorisée à ce stade.

## 1. Ce que change le correctif

| Code | Avant | Après |
|---|---|---|
| P0-1 | `farmer_consents_insert` exige `peut_editer_terrain()` : BM, ABM, Head of Field, Procurement Officer, Supervisor, Agent Recenseur, Chef d'équipe. **Exclut Unit Head, Zonal Head, Assistant Unit Head.** | Exige `private.farmer_registry_can_capture()` : même liste + Zonal Head, Unit Head, Assistant Unit Head. Profil actif obligatoire. Périmètre et imputation inchangés. |
| P1-1 | Aucune règle : l'auteur d'un dossier peut l'approuver. | Trigger `trg_farmer_verification_separation` (BEFORE INSERT OR UPDATE) : refus d'un APPROVED par quiconque a créé le producteur, recueilli un consentement, saisi/relevé une parcelle active, saisi/finalisé une baseline ou une inspection FINAL. |

Inchangé : `peut_editer_terrain()` (utilisée ailleurs), absence de politiques UPDATE/DELETE sur `farmer_consents` et `farmer_verifications` (registres immuables), trigger `farmer_registry_prepare_consent` (date non future, version de texte, cohérence des périmètres), trigger `farmer_registry_prepare_verification` (réservé à la supervision, périmètre, stade BASELINE, contrôles cochés, aucune action critique ouverte).

## 2. Matrice de tests (exécutée le 25/10/2026, transaction annulée, comptes réels)

Test : `tests/sql/regularisation_aflp/03_droits_matrice_roles.sql`. Après exécution : aucune donnée, règle ou fonction persistée (vérifié).

| Cas | Attendu | Obtenu |
|---|---|---|
| C0 Unit Head, consentement dans son cluster, **règle actuelle** | refus (défaut prouvé) | REFUSÉ |
| C1 Unit Head, consentement dans son cluster, règle corrigée | autorisé | AUTORISÉ |
| C2 Unit Head, producteur d'un autre cluster | refus | REFUSÉ |
| C3 Unit Head, consentement imputé à un autre agent | refus | REFUSÉ |
| C4 Zonal Head, tout cluster | autorisé | AUTORISÉ |
| C5 Branch Manager | autorisé | AUTORISÉ |
| C6 Supervisor (profil sans cluster ni zone) | refus | REFUSÉ (voir §4) |
| C7 Compte authentifié sans profil | refus | REFUSÉ |
| C8 Unit Head désactivé | refus | REFUSÉ |
| C9 GRANTED sans tous les périmètres | refus | REFUSÉ |
| C10 Date de consentement future | refus | REFUSÉ |
| V1 Unit Head auteur approuve son dossier | refus | REFUSÉ (séparation des tâches) |
| V2 Auteur rejette son dossier (REJECTED) | autorisé | AUTORISÉ |
| V3 Unit Head d'un autre cluster approuve | refus | REFUSÉ (hors périmètre) |
| V4 Zonal Head approuve le dossier d'un Unit Head | autorisé | AUTORISÉ |
| V5 Zonal Head auteur approuve son dossier | refus | REFUSÉ (séparation des tâches) |
| V6 Second Zonal Head approuve ce dossier | autorisé | AUTORISÉ |
| V7 Branch Manager ayant recueilli un consentement approuve | refus | REFUSÉ (séparation des tâches) |
| V8 Second Zonal Head approuve ce même dossier | autorisé | AUTORISÉ |
| V9 Branch Manager non impliqué approuve | autorisé | AUTORISÉ |
| Garde-fou existant : vérification d'un passeport non BASELINE | refus | REFUSÉ |

**21/21 conformes.**

## 3. Fonctions SECURITY DEFINER concernées

| Fonction | search_path fixé | Exécution anon | Exécution authenticated | Avis |
|---|---|---|---|---|
| `private.farmer_verification_separation_guard` (nouvelle) | oui | non | non (révoquée) | conforme : fonction de trigger, non appelable |
| `private.farmer_registry_can_capture` / `can_supervise` | oui | non | oui | conforme |
| `private.farmer_registry_can_access_producteur` / `can_access_village` / `authority` | oui | **oui** | oui | renvoient `false` sans utilisateur ; schéma `private` normalement non exposé par l'API. Recommandation : révoquer l'exécution à `anon` (hors périmètre de ce correctif) |
| `public.peut_editer_terrain`, `mon_role`, `est_actif`, `portee_terrain_globale` | oui | non | oui | conforme |
| `public.farmer_registry_prepare_consent` / `prepare_verification` / `refresh_passport` | oui | non | non | conforme (triggers) |

## 4. Circuits de supervision : risques de blocage

| Constat | Effet | Recommandation |
|---|---|---|
| Le compte **Supervisor** n'a ni cluster, ni zone, ni permission multi-zone : `can_access_village` renvoie faux | Ce compte ne voit et ne peut rien faire sur les producteurs | Lui attribuer un périmètre (zone ou `permissions.zones`) ou le désactiver |
| Les Zonal Heads ont une portée terrain globale par rôle | Ils peuvent vérifier tout dossier qu'ils n'ont pas saisi : pas de blocage | Conserver ; c'est le circuit de secours |
| Un Zonal Head a saisi 85 enrôlements | Ces dossiers devront être vérifiés par l'autre Zonal Head ou le Branch Manager | Organiser la répartition |
| Un consentement PARTIAL postérieur à un GRANTED fait redescendre le passeport | Comportement voulu (le dernier choix du producteur fait foi) | À expliquer aux agents |
| Aucun compte agent terrain | Les superviseurs saisissent ; la règle P1-1 les force à faire vérifier par un tiers | Créer des comptes `Agent Recenseur` / `Assistant Unit Head` |

## 5. Procédure d'application (après autorisation écrite)

1. Relecture du fichier PREPARE par un développeur autre que l'auteur.
2. Rejouer `03_droits_matrice_roles.sql` sur la base : 21/21 attendus.
3. Exécuter le fichier PREPARE (une transaction par correctif).
4. Exécuter les contrôles de la section V du fichier.
5. En cas d'incident : section R (retour arrière exact, sans perte de données).
