# Enrôlement des Chefs d'Unité (AFLP 2027) — état de déploiement

Branche : `fix/aflp-unit-head-enrollment` · Projet Supabase : `jmbdgpdthzpszfnddwzi`

## Migrations appliquées en production le 16/10/2026

| Ordre | Fichier | Version Supabase | Contenu |
|---|---|---|---|
| 1 | `20261016_unit_head_village_cluster_scope.sql` | 20261016200239 | 2 politiques RESTRICTIVES villages (INSERT, UPDATE) + fonction |
| 2 | `20261016_prefixe_farmer_id_nouveaux_villages.sql` | 20261016200310 | déclencheur BEFORE INSERT préfixe Farmer ID |
| 3 | `20261016_producteurs_gps_perimetre.sql` | 20261016200333 | déclencheur BEFORE UPDATE OF gps_lat, gps_lng |

Variante appliquée : identique aux fichiers, sans les lignes `drop policy/trigger if exists`
(objets vérifiés absents juste avant). Les fichiers du dépôt gardent ces lignes : ils restent
réexécutables (testé, phase REJEU du banc).

**Préparée, non appliquée** : `20261016_rt_insert_cluster_scope_PREPARE.sql` (création de RT
cloisonnée par cluster). Le mandat laisse les RT « selon les permissions existantes ».

## Contrôles post-déploiement (SQL)

```sql
select policyname, permissive, cmd from pg_policies where tablename='villages' and policyname like 'villages_cluster_scope%';
select tgname, tgenabled from pg_trigger where tgname in ('trg_farmer_registry_village_code_prefix','trg_producteur_gps_perimetre');
```

## Retour arrière (dans l'ordre inverse, sans perte de données)

```sql
drop trigger if exists trg_producteur_gps_perimetre on public.producteurs;
drop function if exists private.producteur_gps_dans_mon_perimetre();
drop trigger if exists trg_farmer_registry_village_code_prefix on public.villages;
drop function if exists private.village_attribuer_prefixe_farmer_id();
drop policy if exists villages_cluster_scope_unit_head_ins on public.villages;
drop policy if exists villages_cluster_scope_unit_head_upd on public.villages;
drop function if exists private.aflp_village_ecriture_dans_mon_cluster(text, text, jsonb);
```

Un préfixe déjà attribué à un nouveau village est conservé par le retour arrière (il est
cohérent avec la règle historique et les Farmer ID qui en dépendent sont immuables).

## Règle Farmer ID (vérifiée sur les données réelles)

Règle de `supabase/20260818_farmer_registry_phase1_consolidated.sql` : 4 premiers caractères
normalisés du nom du village (complétés par X), puis suffixe 02, 03… en cas de collision.
Sur les 76 villages (dont 16 supprimés) : 57 préfixes = base, 19 = base + 2 chiffres,
0 non conforme, 0 doublon. Index unique `villages_farmer_code_prefix_uidx` et
`producteurs_code_key` en place. Au-delà de 99 collisions : refus explicite.

## Preuves

- Banc isolé : `bash tests/sql/unit-head/lancer-banc.sh` → `resultats-derniere-execution.txt`.
- Navigateur : `node tests/unit-head-enrollment-e2e.mjs` (390, 768, 1440 px).
