-- FBMS — Normalisation des clusters (villages)
-- Contexte : les clusters etaient enregistres avec des casses et des espaces
-- incoherents (« DIABO », « Diabo », « Diabo », « N'DJEBONOUA »), ce qui faisait
-- apparaitre 3 clusters (voire plus) dans les statistiques au lieu de 2.
--
-- Ce script harmonise le cluster (JSON s1.cluster ET colonne plate `cluster`) en
-- MAJUSCULES sans espaces superflus, en gardant la ponctuation (apostrophe). On
-- prend en priorite la valeur JSON, puis la colonne plate. Idempotent : ne
-- modifie que les lignes qui changent reellement.

with norm as (
  select id,
         upper(trim(coalesce(nullif(trim(data->'s1'->>'cluster'),''), nullif(trim(cluster),''), ''))) as val
  from public.villages
  where coalesce(deleted,false)=false
)
update public.villages v
set data = jsonb_set(coalesce(v.data,'{}'::jsonb), '{s1,cluster}', to_jsonb(norm.val)),
    cluster = norm.val,
    updated_at = now()
from norm
where v.id = norm.id
  and norm.val <> ''
  and (coalesce(v.data->'s1'->>'cluster','') <> norm.val or coalesce(v.cluster,'') <> norm.val);

-- Verification (doit lister exactement 2 clusters) :
-- select data->'s1'->>'cluster' as cluster, count(*) from public.villages
-- where coalesce(deleted,false)=false group by 1 order by 2 desc;
