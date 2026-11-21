-- FBMS — Intégrité RT / Village / Cluster
-- 2026-08-24
--
-- Règle de vérité :
--   villages.id -> rt.village_id -> village_nom + cluster dérivés du village maître.
-- Le client ne peut plus imposer un cluster ou un nom de village divergents.
-- Les RT actifs ne peuvent plus pointer vers un village absent/supprimé.

-- 1) Réparer la colonne cluster plate des villages depuis data.s1.cluster.
update public.villages
set cluster = upper(trim(data->'s1'->>'cluster')), updated_at = now()
where coalesce(deleted,false)=false
  and nullif(trim(data->'s1'->>'cluster'),'') is not null
  and coalesce(cluster,'') is distinct from upper(trim(data->'s1'->>'cluster'));

-- 2) Canonicaliser les RT actifs depuis leur village actif.
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
        'statut', r.statut,
        'score', r.score,
        'deleted', r.deleted
      )
    ),
    updated_at = now()
from public.villages v
where r.village_id=v.id
  and coalesce(r.deleted,false)=false
  and coalesce(v.deleted,false)=false;

-- 3) Trigger strict : le village maître est toujours la source de vérité.
create or replace function public.set_rt_cluster_and_code()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  base_code text;
  next_num integer;
  vvillage text;
  vcluster text;
  vdeleted boolean;
begin
  if coalesce(new.deleted,false)=false then
    if new.village_id is null or trim(new.village_id)='' then
      raise exception 'RT actif invalide: village_id obligatoire.';
    end if;

    select trim(coalesce(v.village, v.data->'s1'->>'village')),
           upper(trim(coalesce(nullif(trim(v.cluster),''), nullif(trim(v.data->'s1'->>'cluster'),'')))),
           coalesce(v.deleted,false)
      into vvillage, vcluster, vdeleted
    from public.villages v
    where v.id=new.village_id;

    if vvillage is null then
      raise exception 'RT actif invalide: village_id % introuvable.', new.village_id;
    end if;
    if vdeleted then
      raise exception 'RT actif invalide: le village % est supprime.', new.village_id;
    end if;
    if vcluster is null or vcluster='' then
      raise exception 'RT actif invalide: cluster absent sur le village %.', new.village_id;
    end if;

    new.village_nom := vvillage;
    new.cluster := vcluster;
  elsif new.cluster is not null then
    new.cluster := upper(trim(new.cluster));
  end if;

  if new.id_rt is null or trim(new.id_rt)='' then
    base_code := 'RT-' || public.fbms_slug3(coalesce(new.village_nom,'VIL')) || '-';
    select coalesce(max((regexp_match(id_rt,'[0-9]+$'))[1]::int),0)+1
      into next_num
    from public.rt
    where id_rt like base_code || '%';
    new.id_rt := base_code || lpad(next_num::text,2,'0');
  end if;

  new.data := jsonb_strip_nulls(
    coalesce(new.data,'{}'::jsonb) || jsonb_build_object(
      'id', new.id,
      'idRt', new.id_rt,
      'nom', new.nom,
      'telephone', new.telephone,
      'villageId', new.village_id,
      'villageNom', new.village_nom,
      'cluster', new.cluster,
      'statut', new.statut,
      'score', new.score,
      'deleted', new.deleted
    )
  );

  new.updated_at := now();
  return new;
end;
$function$;

-- 4) Bloquer les doublons forts : même nom normalisé + même numéro 10 chiffres.
create or replace function public.guard_rt_duplicate_identity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(new.deleted,false)=false
     and nullif(trim(coalesce(new.nom,'')),'') is not null
     and nullif(trim(coalesce(new.telephone,'')),'') is not null then
    if exists (
      select 1
      from public.rt r
      where r.id is distinct from new.id
        and coalesce(r.deleted,false)=false
        and upper(public.unaccent(trim(coalesce(r.nom,'')))) = upper(public.unaccent(trim(new.nom)))
        and exists (
          select 1
          from regexp_matches(coalesce(r.telephone,''), '([0-9]{10})', 'g') as rp,
               regexp_matches(coalesce(new.telephone,''), '([0-9]{10})', 'g') as np
          where rp[1]=np[1]
        )
    ) then
      raise exception 'Doublon RT bloque: meme nom et numero de telephone deja actifs.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_rt_duplicate_identity on public.rt;
create trigger trg_guard_rt_duplicate_identity
before insert or update of nom, telephone, deleted on public.rt
for each row execute function public.guard_rt_duplicate_identity();

-- 5) Vue canonique à utiliser pour les futurs calculs et rapports.
create or replace view public.rt_canonical
with (security_invoker=true)
as
select
  r.id,
  r.id_rt,
  r.nom,
  r.telephone,
  r.village_id,
  trim(coalesce(v.village, v.data->'s1'->>'village')) as village_nom,
  upper(trim(coalesce(nullif(trim(v.cluster),''), nullif(trim(v.data->'s1'->>'cluster'),'')))) as cluster,
  r.statut,
  r.score,
  r.created_at,
  r.updated_at,
  r.created_by,
  r.updated_by,
  r.data,
  v.data as village_data
from public.rt r
join public.villages v on v.id=r.village_id
where coalesce(r.deleted,false)=false
  and coalesce(v.deleted,false)=false;

-- 6) Moniteur : après normalisation, cette vue doit rester vide.
create or replace view public.rt_data_quality_issues
with (security_invoker=true)
as
select r.id as rt_id, r.id_rt,
       'MISSING_VILLAGE_ID'::text as issue_type,
       r.village_nom as rt_village, r.cluster as rt_cluster,
       null::text as master_village, null::text as master_cluster
from public.rt r
where coalesce(r.deleted,false)=false and r.village_id is null
union all
select r.id, r.id_rt,
       case
         when v.id is null then 'BROKEN_VILLAGE_REFERENCE'
         when coalesce(v.deleted,false)=true then 'SOFT_DELETED_VILLAGE_REFERENCE'
         when trim(coalesce(r.village_nom,'')) is distinct from trim(coalesce(v.village,v.data->'s1'->>'village','')) then 'VILLAGE_NAME_MISMATCH'
         when upper(trim(coalesce(r.cluster,''))) is distinct from upper(trim(coalesce(nullif(trim(v.cluster),''),nullif(trim(v.data->'s1'->>'cluster'),''),''))) then 'CLUSTER_MISMATCH'
         when coalesce(r.data->>'villageId','') is distinct from coalesce(r.village_id,'') then 'JSON_VILLAGE_ID_MISMATCH'
         when trim(coalesce(r.data->>'villageNom','')) is distinct from trim(coalesce(r.village_nom,'')) then 'JSON_VILLAGE_NAME_MISMATCH'
         when upper(trim(coalesce(r.data->>'cluster',''))) is distinct from upper(trim(coalesce(r.cluster,''))) then 'JSON_CLUSTER_MISMATCH'
       end as issue_type,
       r.village_nom, r.cluster,
       trim(coalesce(v.village,v.data->'s1'->>'village')),
       upper(trim(coalesce(nullif(trim(v.cluster),''),nullif(trim(v.data->'s1'->>'cluster'),''))))
from public.rt r
left join public.villages v on v.id=r.village_id
where coalesce(r.deleted,false)=false
  and (
    v.id is null
    or coalesce(v.deleted,false)=true
    or trim(coalesce(r.village_nom,'')) is distinct from trim(coalesce(v.village,v.data->'s1'->>'village',''))
    or upper(trim(coalesce(r.cluster,''))) is distinct from upper(trim(coalesce(nullif(trim(v.cluster),''),nullif(trim(v.data->'s1'->>'cluster'),''),'')))
    or coalesce(r.data->>'villageId','') is distinct from coalesce(r.village_id,'')
    or trim(coalesce(r.data->>'villageNom','')) is distinct from trim(coalesce(r.village_nom,''))
    or upper(trim(coalesce(r.data->>'cluster',''))) is distinct from upper(trim(coalesce(r.cluster,'')))
  );
