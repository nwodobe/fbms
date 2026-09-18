-- AFLP Farmer Passport hierarchy hardening
-- Fixes legacy N'DJEBONOUA labels so village -> cluster -> zone resolves for every producer.

update public.aflp_clusters
set aliases = case
  when code = 'DJEBONOUA' then array['DJEBONOUA','N''DJEBONOUA','DJEBONOU','DJEBONOA']::text[]
  else aliases
end,
updated_at = now()
where code = 'DJEBONOUA';

create or replace function public.farmer_registry_resolve_cluster_code(value text)
returns text
language sql
stable
set search_path = public
as $$
  select c.code
  from public.aflp_clusters c
  where c.active
    and (
      public.farmer_registry_norm_text(c.code) = public.farmer_registry_norm_text(value)
      or public.farmer_registry_norm_text(c.label) = public.farmer_registry_norm_text(value)
      or exists (
        select 1
        from unnest(c.aliases) a(alias)
        where public.farmer_registry_norm_text(a.alias) = public.farmer_registry_norm_text(value)
      )
    )
  order by c.code
  limit 1
$$;

update public.villages v
set cluster_code = public.farmer_registry_resolve_cluster_code(
  coalesce(nullif(v.cluster,''), nullif(v.data->'s1'->>'cluster',''))
)
where not v.deleted
  and (v.cluster_code is null or btrim(v.cluster_code) = '')
  and public.farmer_registry_resolve_cluster_code(
    coalesce(nullif(v.cluster,''), nullif(v.data->'s1'->>'cluster',''))
  ) is not null;

create or replace function public.farmer_registry_prepare_village_cluster_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_label text;
  v_code text;
begin
  if new.deleted then return new; end if;
  if new.cluster_code is not null and btrim(new.cluster_code) <> ''
     and exists(select 1 from public.aflp_clusters c where c.code = new.cluster_code and c.active) then
    return new;
  end if;

  v_label := coalesce(nullif(new.cluster,''), nullif(new.data->'s1'->>'cluster',''));
  if v_label is null then return new; end if;

  v_code := public.farmer_registry_resolve_cluster_code(v_label);
  if v_code is not null then new.cluster_code := v_code; end if;
  return new;
end
$$;

drop trigger if exists trg_farmer_registry_village_cluster_code on public.villages;
create trigger trg_farmer_registry_village_cluster_code
before insert or update of cluster, data, cluster_code, deleted
on public.villages
for each row
execute function public.farmer_registry_prepare_village_cluster_code();
