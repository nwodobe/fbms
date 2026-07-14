-- FBMS — Cluster des RT dérivé du village (corrige le filtrage par cluster)
--
-- Problème : dans la Base RT, le filtre par cluster ne montrait presque rien
-- (surtout BROBO). Cause : le cluster était stocké sur la fiche RT mais restait
-- vide/incohérent pour beaucoup de RT — en particulier ceux des villages dont la
-- COLONNE plate `cluster` était vide (ex. BROBO, renseigné seulement dans
-- data->s1->cluster). Le trigger RT lisait cette colonne plate vide, laissant le
-- cluster du RT vide → aucun RT ne correspondait au filtre.
--
-- Ce script (déjà appliqué en base) : (1) répare la colonne cluster des villages
-- depuis data->s1->cluster ; (2) recalcule rt.cluster à partir du village ;
-- (3) rend le trigger RT robuste (dérive du village : colonne plate OU
-- data->s1->cluster, en MAJUSCULES).

-- 1) Colonne cluster plate des villages depuis data.s1.cluster
update public.villages
set cluster = upper(trim(data->'s1'->>'cluster')), updated_at = now()
where coalesce(deleted,false)=false
  and nullif(trim(data->'s1'->>'cluster'),'') is not null
  and coalesce(cluster,'') is distinct from upper(trim(data->'s1'->>'cluster'));

-- 2) rt.cluster dérivé du village (par village_id, sinon par nom normalisé)
with vcl as (
  select id, village, data->'s1'->>'village' as vjson,
         upper(trim(coalesce(nullif(trim(data->'s1'->>'cluster'),''), nullif(trim(cluster),'')))) as cl
  from public.villages where coalesce(deleted,false)=false
)
update public.rt r
set cluster = m.cl, updated_at = now()
from (
  select r2.id as rid,
    coalesce(
      (select cl from vcl where vcl.id = r2.village_id and cl is not null limit 1),
      (select cl from vcl where upper(regexp_replace(coalesce(vcl.village,vcl.vjson,''),'[^A-Za-z0-9]','','g'))
                                = upper(regexp_replace(coalesce(r2.village_nom,''),'[^A-Za-z0-9]','','g')) and cl is not null limit 1)
    ) as cl
  from public.rt r2 where coalesce(r2.deleted,false)=false
) m
where r.id = m.rid and m.cl is not null and coalesce(r.cluster,'') is distinct from m.cl;

-- 3) Trigger RT robuste : cluster dérivé du village (colonne OU data.s1), MAJUSCULES
create or replace function public.set_rt_cluster_and_code()
returns trigger language plpgsql as $function$
declare
  base_code text;
  next_num integer;
  vcl text;
begin
  if new.cluster is null or trim(new.cluster) = '' then
    select upper(trim(coalesce(nullif(trim(v.cluster),''), nullif(trim(v.data->'s1'->>'cluster'),''))))
      into vcl
      from public.villages v where v.id = new.village_id;
    if vcl is not null and vcl <> '' then new.cluster := vcl; end if;
  else
    new.cluster := upper(trim(new.cluster));
  end if;
  if new.id_rt is null or trim(new.id_rt) = '' then
    base_code := 'RT-' || public.fbms_slug3(coalesce(new.village_nom, 'VIL')) || '-';
    select coalesce(max((regexp_match(id_rt, '[0-9]+$'))[1]::int), 0) + 1
      into next_num from public.rt where id_rt like base_code || '%';
    new.id_rt := base_code || lpad(next_num::text, 2, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
