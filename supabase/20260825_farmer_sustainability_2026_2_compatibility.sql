begin;

-- 2026.1 stays readable for history but is not offered to new records.
update public.sustainability_question_catalog
set active=false, updated_at=now()
where catalog_version='AFLP-SUST-2026.1' and active;

-- Temporary compatibility with cached clients still sending 2026.1.
create or replace function public.farmer_registry_upgrade_sustainability_catalog()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.catalog_version is null or new.catalog_version='AFLP-SUST-2026.1' then
    new.catalog_version := 'AFLP-SUST-2026.2';
  end if;
  return new;
end;
$$;
revoke all on function public.farmer_registry_upgrade_sustainability_catalog() from public,anon,authenticated;

drop trigger if exists aaa_farmer_registry_upgrade_sust_baseline on public.farmer_sustainability_baselines;
create trigger aaa_farmer_registry_upgrade_sust_baseline
before insert on public.farmer_sustainability_baselines
for each row execute function public.farmer_registry_upgrade_sustainability_catalog();

drop trigger if exists aaa_farmer_registry_upgrade_inspection on public.farmer_inspections;
create trigger aaa_farmer_registry_upgrade_inspection
before insert on public.farmer_inspections
for each row execute function public.farmer_registry_upgrade_sustainability_catalog();

create or replace function public.farmer_registry_align_sustainability_answer_catalog()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_table_name='farmer_sustainability_answers' then
    select b.catalog_version into new.catalog_version
    from public.farmer_sustainability_baselines b
    where b.id=new.baseline_id;
  elsif tg_table_name='farmer_inspection_answers' then
    select i.catalog_version into new.catalog_version
    from public.farmer_inspections i
    where i.id=new.inspection_id;
  end if;
  if new.catalog_version is null then
    raise exception 'Version Sustainability parente introuvable.';
  end if;
  return new;
end;
$$;
revoke all on function public.farmer_registry_align_sustainability_answer_catalog() from public,anon,authenticated;

drop trigger if exists aaa_farmer_registry_align_sust_answer on public.farmer_sustainability_answers;
create trigger aaa_farmer_registry_align_sust_answer
before insert on public.farmer_sustainability_answers
for each row execute function public.farmer_registry_align_sustainability_answer_catalog();

drop trigger if exists aaa_farmer_registry_align_inspection_answer on public.farmer_inspection_answers;
create trigger aaa_farmer_registry_align_inspection_answer
before insert on public.farmer_inspection_answers
for each row execute function public.farmer_registry_align_sustainability_answer_catalog();

commit;
