# Audit de sécurité : migration « suivi des téléphones »

*Fichiers : `supabase/20261122090000_ota_suivi_installations.sql` et `…090100_…_rollback.sql`, branche `recette/cloture-20261122`. Statut : **corrigée et testée en local, NON appliquée**. Production vérifiée le 22/11/2026 à 12:05 UTC (lecture seule) : `app_installations`, `ota_installations_v` et `ota_installation_signaler` absents. Environnement de recette Supabase : aucun accès identifié, non vérifié.*

## 1. Faille confirmée : détournement d'une installation

**Mécanisme.** La clé de la table était `installation_id` seul, et la fonction faisait `ON CONFLICT (installation_id) DO UPDATE SET user_id = excluded.user_id, …`. Tout compte actif connaissant l'identifiant d'un autre téléphone pouvait donc, par un simple signalement :

1. s'approprier la ligne (compte, rôle, cluster, zone remplacés par les siens) ;
2. y écrire de fausses versions ;
3. faire disparaître le téléphone du tableau de son vrai Chef d'Unité ;
4. bloquer le signalement du vrai propriétaire pendant 30 s à chaque fois (anti-rafale partagé).

L'identifiant n'est pas secret : il est visible dans le tableau par l'encadrement du périmètre.

**Preuve avant correction** (PostgreSQL 16 local, `tests/ota/suivi-installations-sql.sh`) :

| Test | Résultat sur la migration d'origine |
|---|---|
| SQL-34 La ligne du propriétaire garde son compte | **ÉCHEC** : la ligne du propriétaire n'existe plus |
| SQL-35 Le propriétaire voit toujours son appareil | **ÉCHEC** : 0 ligne |
| SQL-39 Le signalement d'un tiers ne bloque pas le propriétaire | **ÉCHEC** : `IGNORE` |

**Correction.** Clé primaire `(installation_id, user_id)` ; `ON CONFLICT (installation_id, user_id)` ; `user_id` n'est plus jamais modifié ; anti-rafale lu par compte. Un signalement ne peut toucher que la ligne du compte appelant. Celui qui recopie l'identifiant d'autrui ne crée qu'une ligne à son propre nom, dans son propre périmètre.

**Après correction : 42 tests réussis sur 42**, dont les 10 tests négatifs SQL-33 à SQL-42.

## 2. Revue point par point

| Point du mandat | Constat | Preuve |
|---|---|---|
| 1. Usurpation d'identifiant | Corrigée (§ 1) | SQL-33 à SQL-36, SQL-39 |
| 2. Appareil partagé entre comptes | Une ligne par compte ; colonne `appareil_partage` dans la vue (compte seulement, aucune ligne hors périmètre révélée) | SQL-37, SQL-38 |
| 3. Rôles et périmètres | Relus dans `public.profils` côté serveur ; rien n'est cru du téléphone | SQL-02, SQL-13, SQL-15 |
| 4. Accès BM, ABM, ZH, UH | BM et ABM : tout ; ZH : sa zone ; UH : son cluster ; autres : leur appareil | SQL-16 à SQL-22 |
| 5. Hors périmètre | Refusé par la RLS | SQL-18, SQL-19, SQL-21, SQL-38 |
| 6. RLS, SECURITY DEFINER, EXECUTE, vue, API | RLS active ; aucune politique d'écriture ; `search_path` fixé ; vue en `security_invoker` ; fonctions de périmètre dans le schéma `private`, non exposé par l'API ; `anon` sans aucun droit | SQL-23 à SQL-26, SQL-31, SQL-40 à SQL-42 |
| 7. Limitation, rétention, purge, intégrité | 30 s par compte et par installation ; 10 installations actives par compte ; purge ≥ 90 jours, BM seul ; champs bornés et typés | SQL-03, SQL-10 à SQL-12, SQL-27 à SQL-30 |
| 8. Accès public, secrets | Aucun ; la migration ne contient ni clé ni jeton | Lecture du fichier ; SQL-31 |
| Retour arrière | Supprime vue, fonctions et table ; `profils` intacte | SQL-32 |

## 3. Limites qui subsistent après correction

- **Les versions sont déclaratives.** Le téléphone dit quelle version il a activée ; le serveur ne peut pas le prouver. Un agent malveillant peut mentir sur **son propre** appareil. Le tableau est un outil de pilotage, pas une preuve opposable.
- **Bruit possible.** Un compte peut créer jusqu'à 10 lignes à son nom. Elles restent dans son périmètre et signées de son compte.
- **Tests sur PostgreSQL local**, avec des rôles fictifs. La RLS n'a pas été éprouvée sur une copie de production ni avec de vrais comptes : à faire juste après application (deux comptes réels de rôles différents).
- Les identifiants d'installation vivent dans le localStorage : une réinstallation crée une nouvelle ligne.

## 4. Tableau de suivi : ce qu'il distingue

| Notion | Colonne |
|---|---|
| Version publiée | En-tête (lue sur le canal stable) |
| Version vue par le téléphone | « OTA vue » |
| Version téléchargée, en attente | « Téléchargée, en attente » (ajoutée le 22/11) |
| Version réellement activée | « Web active » et « Dernière activation » |
| Dernier signalement | « Dernier signalement » |
| Erreur | « Dernière erreur » |
| Non confirmé récemment | État « Non confirmé récemment » au-delà de 72 h |

Tests du classement : 20 réussis sur 20 (`tests/ota/suivi-coeur.test.cjs`).

## 5. Application en production : préparée, bloquée

Ordre proposé, à n'exécuter qu'avec le GO écrit du Branch Manager : appliquer `20261122090000` ; vérifier en lecture avec un compte Unit Head et un compte Zonal Head réels ; en cas d'écart, exécuter `20261122090100`. Aucune de ces étapes n'a été faite.
