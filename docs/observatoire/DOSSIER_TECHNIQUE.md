# Observatoire agronomique AFLP 2027 (pilote) — dossier technique, migrations et restauration

Statut : **développé et testé sur réplique locale. Rien n'est appliqué en production.**
Cadre : spécification V2.1, espace E2.4 « Observatoire (pilote) : observations floraison/nouaison par protocole versionné, sans indicateur officiel ».

## 1. Architecture (C hybride)

- **Un seul domaine de données** (tables `pheno_*`), relié à `farmer_plots`, `producteurs`, `villages`, `campaigns`, `aflp_clusters`. Aucune double écriture dans `farmer_visits`.
- **Deux usages** : collecte dans FIELD BUYING (`operations/field-buying.html#observatoire`), pilotage depuis le portail (lien « Observatoire agronomique · pilotage, validation et qualité » → `#observatoire/validation`).
- **Hors ligne dédié** : `shared/observatoire-coeur.js` (règles métier identiques au serveur), `shared/observatoire-hors-ligne.js` (IndexedDB `anagroci_observatoire`), RPC `pheno_sync_batch`. La file FIELD BUYING (`anagroci_ops_offline`, `offline_sync_batch`) n'est ni lue ni modifiée. Convergence vers la boîte d'envoi unique V2.1 (E0.3) à décider.
- **Interface** : `operations/observatoire.js`, `operations/observatoire.css` ; branchement par une route `observatoire` dans `field-buying.js` et une entrée de menu dans `navigation-v2.js`.

## 2. Fichiers SQL (ordre d'application)

| Ordre | Fichier | Contenu |
|---|---|---|
| 1 | `supabase/20261113100000_aflp_observatoire_1_schema.sql` | 11 tables `public.pheno_*` (dont la graine de campagne immuable), `private.pheno_sync_recus`, journal immuable, bucket privé `pheno-preuves`, RLS activée sans politique (tout refusé) |
| 2 | `supabase/20261113100100_aflp_observatoire_2_securite.sql` | fonctions de périmètre, politiques de **lecture** uniquement, politiques Storage de dépôt/lecture des preuves |
| 3 | `supabase/20261113100200_aflp_observatoire_3_rpc_sync.sql` | RPC d'installation, inventaire, marquage, réserves, affectations, visite, synchronisation, vérification, correction, validation |
| 4 | `supabase/20261113100300_aflp_observatoire_4_vues_pilote.sql` | vues pilotes `security_invoker` (visites validées seulement) et vue qualité |
| R | `supabase/20261113100400_aflp_observatoire_rollback.sql` | retour arrière complet (objets `pheno_*` uniquement) |

Toutes les migrations sont additives et rejouables. Aucune instruction ne modifie un objet existant (contrôlé par empreinte, test NR-02).

## 3. Matrice des droits appliquée par la base

| Profil (`profils.role`) | Lecture | Installation et collecte | Vérification | Validation finale | Affectations |
|---|---|---|---|---|---|
| Branch Manager | tout | oui | oui | oui | oui |
| Assistant Branch Manager | tout | non | par affectation | par affectation | non |
| Zonal Head | sa zone | non | par affectation | par affectation | non |
| Unit Head | son cluster | son cluster | son cluster | par affectation | non |
| Assistant Unit Head | son cluster | son cluster | **jamais** | **jamais** | non |
| RT et autres rôles | rien | non | non | non | non |

Règles transverses : personne ne vérifie ni ne valide une visite qu'il a observée ou transcrite ; une affectation est datée, par campagne et par cluster, révocable, journalisée ; une affectation ne peut viser qu'un ZH, UH ou ABM actif.

## 4. Contrôles avant application en production (lecture seule)

```sql
-- 1. Rien de l'Observatoire n'existe encore
select count(*) from pg_class where relname like 'pheno\_%';                  -- attendu 0
-- 2. Les objets référencés existent
select to_regclass('public.farmer_plots'), to_regclass('public.campaigns'), to_regclass('public.aflp_clusters');
select proname from pg_proc where proname in ('aflp_cluster_code','aflp_norm');
-- 3. Le rôle « Assistant Unit Head » figure dans profils_role_check
select pg_get_constraintdef(oid) from pg_constraint where conname = 'profils_role_check';
-- 4. Aucun bucket du même nom
select id from storage.buckets where id = 'pheno-preuves';                     -- attendu 0 ligne
```

## 5. Procédure d'application (après décision du Branch Manager)

1. Sauvegarde : vérifier qu'un point de restauration Supabase récent existe (PITR ou sauvegarde quotidienne) et noter l'heure.
2. Exécuter les contrôles du § 4.
3. Appliquer 1, 2, 3, 4 dans cet ordre, chacun dans sa transaction (les fichiers contiennent `begin`/`commit`).
4. Contrôles après application :
```sql
select count(*) filter (where relrowsecurity) || '/' || count(*) from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'pheno\_%';   -- attendu 11/11
select count(*) from pg_policies where tablename like 'pheno\_%' and cmd <> 'SELECT';        -- attendu 0
select count(*) from pg_proc where proname like 'pheno\_%' and has_function_privilege('anon', oid, 'execute'); -- attendu 0
```
5. Lancer les conseillers de sécurité Supabase et vérifier qu'aucun nouvel avertissement ne concerne `pheno_*`.
6. Publication du front (fusion de la branche par le circuit de revue) **seulement après** les étapes 3 à 5 : le front sans migrations affiche des erreurs d'accès ; les migrations sans le front n'ont aucun effet visible.
7. Le Branch Manager crée la **graine de tirage** de la campagne (écran Observatoire › Affectations, une seule fois, avant toute installation). Sans elle, aucune installation n'est possible.
8. Recette en production sur un champ de démonstration désigné par le BM, puis ouverture aux agents (préparation hors-ligne obligatoire après la création de la graine).

## 6. Retour arrière et restauration

- **Front seul** : annuler la fusion (revert du commit de fusion). Les tables restent, inaccessibles à l'écran ; aucune donnée perdue.
- **Base, sans données à conserver** : exporter d'abord `pg_dump --data-only --table 'public.pheno_*'`, puis exécuter `20261113100400_aflp_observatoire_rollback.sql`. Tout objet `pheno_*` disparaît ; l'existant est strictement identique à l'état initial (test NR-06).
- **Restauration des données après retour arrière** : réappliquer 1 à 4, puis recharger l'export (`psql -f export.sql`) en désactivant temporairement le déclencheur du journal (`alter table public.pheno_journal disable trigger pheno_journal_immuable;` … `enable trigger`), opération réservée au BM et tracée.
- **Fichiers de preuves** : non supprimés par le script ; suppression éventuelle par l'API Storage, décision séparée.
- **Données des téléphones** : la file IndexedDB `anagroci_observatoire` reste sur les appareils ; après retour arrière, les envois seront refusés et resteront visibles dans « Envois ». Ne pas effacer les téléphones tant que la décision n'est pas prise.

## 7. Tirage : ce qui est garanti et ce qui ne l'est pas

- Graine de campagne aléatoire (aléa du serveur), créée avant toute installation, immuable même pour le superutilisateur, journalisée et vérifiable.
- Graines des blocs et des arbres dérivées de cette graine et de l'identifiant de parcelle : l'agent ne peut ni les choisir ni retirer.
- Restent déclaratifs : le découpage en blocs (B) et le comptage des arbres (N). Ils sont verrouillés dès l'enregistrement mais leur exactitude ne se contrôle que par contre-visite (V1.1).
- Les probabilités affichées sont celles du plan déclaré ; elles ne deviennent « plan complet » qu'une fois les probabilités amont (village, champ) saisies par le BM.

## 8. Tension avec les règles du dépôt

`CLAUDE.md` interdit aux agents toute modification automatique de `supabase/**` et `LOT_A_PLAN.md` prévoit qu'aucun code ne soit écrit avant les décisions D4/D5 (staging). Le mandat du Branch Manager du 13/11/2026 demande explicitement les scripts de migration. Les fichiers sont donc **nouveaux, additifs, non appliqués**, et leur fusion doit passer par une revue humaine explicite.
