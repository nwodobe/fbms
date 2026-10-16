# Procédure d'application — enrôlement des Chefs d'Unité (AFLP 2027)

Branche : `fix/aflp-unit-head-enrollment` · Projet Supabase : `jmbdgpdthzpszfnddwzi`

L'ordre compte : **la serrure serveur d'abord, l'interface ensuite.** Publier l'interface
seule ouvrirait les formulaires aux Unit Heads sans cloisonnement serveur des villages.

## Étape 1 — Migration RLS (obligatoire, 2 minutes)

1. Supabase → SQL Editor → coller `20261016_unit_head_village_cluster_scope.sql` → Run.
2. Vérification (doit renvoyer `2 | 1`) :

```sql
select (select count(*) from pg_policies where tablename='villages' and policyname like 'villages_cluster_scope_unit_head_%') politiques,
       (select count(*) from pg_proc where proname='aflp_village_ecriture_dans_mon_cluster') fonction;
```

Nature : 2 politiques RESTRICTIVES + 1 fonction. Aucune donnée modifiée, aucun droit ajouté,
sans effet sur les rôles autres que Unit Head / Assistant Unit Head. Les 60 villages réels ont
des signaux de cluster cohérents (contrôlé le 16/10/2026) : aucun blocage attendu.

Retour arrière (immédiat, sans perte) :

```sql
drop policy if exists villages_cluster_scope_unit_head_ins on public.villages;
drop policy if exists villages_cluster_scope_unit_head_upd on public.villages;
drop function if exists private.aflp_village_ecriture_dans_mon_cluster(text, text, jsonb);
```

## Étape 2 — Interface

Fusionner la pull request de la branche. GitHub Pages publie ; la version de cache
`field-buying.js?v=20261016-unit-head-1` force le rechargement du script.

## Étape 3 — Préfixe Farmer ID des nouveaux villages (décision métier)

Sans cette étape, **aucun producteur ne peut être enrôlé dans un village créé après le
18/08/2026**, quel que soit le rôle (les 60 villages existants ne sont pas concernés).
`20261016_prefixe_farmer_id_nouveaux_villages.sql` applique la règle de la migration du 18/08
(4 lettres du nom, suffixe 02, 03… en cas de collision). Le Farmer ID étant immuable, valider
la règle avant de l'exécuter dans le SQL Editor.

## Preuves

- Banc isolé : `bash tests/sql/unit-head/lancer-banc.sh` (PostgreSQL local jetable,
  fonctions et politiques recopiées de la production).
- Navigateur : `node tests/unit-head-enrollment-e2e.mjs` (390, 768, 1440 px).
