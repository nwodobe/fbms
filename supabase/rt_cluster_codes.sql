-- FBMS Referential: cluster visibility + short RT codes
-- Applied to Supabase project jmbdgpdthzpszfnddwzi on 2026-07-07.

alter table public.villages add column if not exists cluster text;
alter table public.rt add column if not exists cluster text;
alter table public.rt add column if not exists id_rt text;

update public.villages
set cluster = nullif(trim(data->'s1'->>'cluster'), '')
where cluster is null or cluster <> nullif(trim(data->'s1'->>'cluster'), '');

update public.rt r
set cluster = v.cluster
from public.villages v
where r.village_id = v.id
  and (r.cluster is null or r.cluster <> v.cluster);

create or replace function public.fbms_slug3(txt text)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(
      translate(upper(coalesce(txt,'')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸÆŒ', 'AAAAAACEEEEIIIINOOOOOUUUUYYAO'),
      '[^A-Z0-9]+', '', 'g'
    ) || 'XXX',
    3
  )
$$;

with numbered as (
  select r.id,
         'RT-' || public.fbms_slug3(coalesce(r.village_nom, v.village, v.data->'s1'->>'village', 'VIL')) || '-' ||
         lpad(row_number() over (partition by r.village_id order by r.created_at, r.id)::text, 2, '0') as new_code
  from public.rt r
  left join public.villages v on v.id = r.village_id
  where r.deleted = false and (r.id_rt is null or trim(r.id_rt) = '')
)
update public.rt r
set id_rt = numbered.new_code
from numbered
where r.id = numbered.id;

create unique index if not exists rt_id_rt_unique_idx on public.rt(id_rt) where id_rt is not null;
create index if not exists villages_cluster_idx on public.villages(cluster);
create index if not exists rt_cluster_idx on public.rt(cluster);

create or replace function public.set_rt_cluster_and_code()
returns trigger
language plpgsql
as $$
declare
  base_code text;
  next_num integer;
begin
  if new.cluster is null or trim(new.cluster) = '' then
    select v.cluster into new.cluster from public.villages v where v.id = new.village_id;
  end if;
  if new.id_rt is null or trim(new.id_rt) = '' then
    base_code := 'RT-' || public.fbms_slug3(coalesce(new.village_nom, 'VIL')) || '-';
    select coalesce(max((regexp_match(id_rt, '[0-9]+$'))[1]::int), 0) + 1
      into next_num
    from public.rt
    where id_rt like base_code || '%';
    new.id_rt := base_code || lpad(next_num::text, 2, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_rt_cluster_and_code on public.rt;
create trigger trg_set_rt_cluster_and_code
before insert or update on public.rt
for each row execute function public.set_rt_cluster_and_code();