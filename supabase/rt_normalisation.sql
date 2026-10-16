-- ============================================================================
-- ANAGROCI — NORMALISATION CANONIQUE DES RT
-- 2026-08-24
-- ----------------------------------------------------------------------------
-- Source de vérité : public.villages.
-- Pour chaque RT actif, village_nom, cluster et JSON data sont réalignés sur
-- village_id -> villages.id. Ne jamais recalculer un cluster depuis un texte RT.
-- ============================================================================

-- 1) Canonicaliser toutes les lignes actives depuis le village maître actif.
update public.rt r
set village_nom = trim(coalesce(v.village, v.data->'s1'->>'village')),
    cluster = upper(trim(coalesce(nullif(trim(v.cluster),''), nullif(trim(v.data->'s1'->>'cluster'),'')))),
    data = jsonb_strip_nulls(
      coalesce(r.data,'{}'::jsonb) || jsonb_build_object(
        'id', r.id,
        'idRt', r.id_rt,
        'nom', r.nom,
        'telephone', r.telephone,
        'villageId', v.id,
        'villageNom', trim(coalesce(v.village, v.data->'s1'->>'village')),
        'cluster', upper(trim(coalesce(nullif(trim(v.cluster),''), nullif(trim(v.data->'s1'->>'cluster'),'')))),
        'statut', coalesce(nullif(r.statut,''),'Pressenti'),
        'score', coalesce(r.score,0),
        'deleted', r.deleted
      )
    ),
    updated_at = now()
from public.villages v
where r.village_id=v.id
  and coalesce(r.deleted,false)=false
  and coalesce(v.deleted,false)=false;

-- 2) Contrôles attendus à zéro.
select count(*) as rt_actifs_sans_village
from public.rt
where coalesce(deleted,false)=false and village_id is null;

select count(*) as rt_anomalies_geographiques
from public.rt_data_quality_issues;

-- 3) Lecture recommandée pour les calculs/rapports : public.rt_canonical.
-- Exemple : select * from public.rt_canonical where cluster='DIABO';
-- ============================================================================
