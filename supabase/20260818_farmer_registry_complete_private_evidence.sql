-- =============================================================================
-- AFLP FARMER REGISTRY — PREUVES PRIVÉES, FORMATION ET PRIVILÈGES RPC
-- À appliquer après 20260818_farmer_registry_complete.sql
-- =============================================================================

begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'farmer-passport-evidence','farmer-passport-evidence',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.farmer_registry_can_access_evidence(
  p_entite_type text,
  p_entite_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare v_producteur_id text;
begin
  case p_entite_type
    when 'producteur' then v_producteur_id:=p_entite_id;
    when 'farmer_plot' then select producteur_id into v_producteur_id from public.farmer_plots where id=p_entite_id::uuid;
    when 'farmer_production_baseline' then select producteur_id into v_producteur_id from public.farmer_production_baselines where id=p_entite_id::uuid;
    when 'farmer_sustainability_baseline' then select producteur_id into v_producteur_id from public.farmer_sustainability_baselines where id=p_entite_id::uuid;
    when 'farmer_inspection' then select producteur_id into v_producteur_id from public.farmer_inspections where id=p_entite_id::uuid;
    when 'farmer_action_plan' then select producteur_id into v_producteur_id from public.farmer_action_plans where id=p_entite_id::uuid;
    when 'farmer_visit' then select producteur_id into v_producteur_id from public.farmer_visits where id=p_entite_id::uuid;
    when 'farmer_verification' then select producteur_id into v_producteur_id from public.farmer_verifications where id=p_entite_id::uuid;
    else return true;
  end case;
  return v_producteur_id is not null
    and private.farmer_registry_can_read_sensitive()
    and private.farmer_registry_can_access_producteur(v_producteur_id);
exception when invalid_text_representation then return false;
end
$$;

revoke all on function private.farmer_registry_can_access_evidence(text,text) from public,anon;
grant execute on function private.farmer_registry_can_access_evidence(text,text) to authenticated;

drop policy if exists farmer_registry_preuves_insert on public.preuves;
create policy farmer_registry_preuves_insert on public.preuves
for insert to authenticated
with check(
  entite_type in (
    'producteur','farmer_plot','farmer_production_baseline',
    'farmer_sustainability_baseline','farmer_inspection',
    'farmer_action_plan','farmer_visit','farmer_verification'
  )
  and private.farmer_registry_can_capture()
  and created_by=auth.uid()
  and private.farmer_registry_can_access_evidence(entite_type,entite_id)
);

drop policy if exists farmer_registry_preuves_sensitive_select on public.preuves;
create policy farmer_registry_preuves_sensitive_select on public.preuves
as restrictive for select to authenticated
using(
  entite_type not in (
    'producteur','farmer_plot','farmer_production_baseline',
    'farmer_sustainability_baseline','farmer_inspection',
    'farmer_action_plan','farmer_visit','farmer_verification'
  )
  or private.farmer_registry_can_access_evidence(entite_type,entite_id)
);

drop policy if exists farmer_passport_evidence_insert on storage.objects;
create policy farmer_passport_evidence_insert on storage.objects
for insert to authenticated
with check(
  bucket_id='farmer-passport-evidence'
  and private.farmer_registry_can_capture()
  and (storage.foldername(name))[1]=auth.uid()::text
  and private.farmer_registry_can_access_producteur((storage.foldername(name))[2])
);

drop policy if exists farmer_passport_evidence_select on storage.objects;
create policy farmer_passport_evidence_select on storage.objects
for select to authenticated
using(
  bucket_id='farmer-passport-evidence'
  and private.farmer_registry_can_read_sensitive()
  and private.farmer_registry_can_access_producteur((storage.foldername(name))[2])
);

drop policy if exists participants_formation_ins on public.participants_formation;
create policy participants_formation_ins on public.participants_formation
for insert to authenticated
with check(private.farmer_registry_can_capture());

-- Les trois fonctions suivantes sont des RPC métier explicites. Elles restent
-- accessibles aux utilisateurs connectés, mais jamais au rôle anonyme. Les
-- contrôles de rôle, de périmètre et d'état sont exécutés dans chaque fonction.
revoke all on function public.farmer_finalize_production_baseline(uuid) from public, anon;
revoke all on function public.farmer_finalize_sustainability_baseline(uuid) from public, anon;
revoke all on function public.farmer_finalize_inspection(uuid) from public, anon;
grant execute on function public.farmer_finalize_production_baseline(uuid) to authenticated;
grant execute on function public.farmer_finalize_sustainability_baseline(uuid) to authenticated;
grant execute on function public.farmer_finalize_inspection(uuid) to authenticated;

commit;