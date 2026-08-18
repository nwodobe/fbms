-- ANAGROCI FBMS - AFLP Farmer Registry Phase 1 RLS and privileges
begin;

create or replace function public.farmer_registry_authority()
returns text language sql stable security definer set search_path=public as $$
 select coalesce(p.authority_level,case p.role
  when 'Branch Manager' then 'GLOBAL'
  when 'Branch Manager / Head of Programme' then 'GLOBAL'
  when 'Assistant Branch Manager' then 'GLOBAL'
  when 'Head of Field' then 'GLOBAL'
  when 'Procurement Officer' then 'GLOBAL'
  when 'Zonal Head' then 'ZONE'
  when 'Unit Head' then 'CLUSTER'
  when 'Assistant Unit Head' then 'CLUSTER'
  when 'Supervisor' then 'CLUSTER'
  when 'Warehouse Keeper' then 'CLUSTER'
  when 'RT / Field Partner' then 'VILLAGE'
  when 'Agent Recenseur' then 'VILLAGE'
  else 'TRANSVERSE' end)
 from public.profils p where p.user_id=auth.uid() and p.actif limit 1
$$;

create or replace function public.farmer_registry_can_access_village(target_village text,target_rt text default null)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare p public.profils%rowtype; v_cluster text; v_zone text;
begin
 select * into p from public.profils where user_id=auth.uid() and actif limit 1;
 if p.user_id is null then return false;end if;
 if public.farmer_registry_authority() in('GLOBAL','TRANSVERSE') then return true;end if;
 if p.zone is null and p.cluster is null and p.village_id is null and p.rt_id is null then return true;end if;
 if p.village_id is not null then
  if target_village is distinct from p.village_id then return false;end if;
  if p.rt_id is not null and target_rt is distinct from p.rt_id then return false;end if;
  return true;
 end if;
 select coalesce(v.cluster_code,upper(btrim(v.cluster))),c.zone_code into v_cluster,v_zone
 from public.villages v left join public.aflp_clusters c on c.code=v.cluster_code
 where v.id=target_village and not v.deleted;
 if v_cluster is null then return false;end if;
 if p.cluster is not null then return public.farmer_registry_norm_text(p.cluster)=public.farmer_registry_norm_text(v_cluster);end if;
 if p.zone is not null then return public.farmer_registry_norm_text(p.zone)=public.farmer_registry_norm_text(v_zone)
  or public.farmer_registry_norm_text(p.zone)=public.farmer_registry_norm_text((select label from public.aflp_zones where code=v_zone));end if;
 return false;
end$$;

create or replace function public.farmer_registry_can_access_producteur(pid text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.producteurs p where p.id=pid
  and public.farmer_registry_can_access_village(p.village_id,p.rt_id))
$$;

alter table public.aflp_zones enable row level security;
alter table public.aflp_clusters enable row level security;
alter table public.farmer_consents enable row level security;
alter table public.farmer_identity_documents enable row level security;
alter table public.farmer_change_log enable row level security;

drop policy if exists aflp_zones_select on public.aflp_zones;
create policy aflp_zones_select on public.aflp_zones for select to authenticated using(public.est_actif());
drop policy if exists aflp_clusters_select on public.aflp_clusters;
create policy aflp_clusters_select on public.aflp_clusters for select to authenticated using(public.est_actif());

drop policy if exists farmer_consents_select on public.farmer_consents;
create policy farmer_consents_select on public.farmer_consents for select to authenticated
 using(public.est_actif() and public.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_consents_insert on public.farmer_consents;
create policy farmer_consents_insert on public.farmer_consents for insert to authenticated
 with check(public.peut_editer_terrain() and created_by=auth.uid() and agent_id=auth.uid()
  and public.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_consents_update on public.farmer_consents;

drop policy if exists farmer_identity_documents_select on public.farmer_identity_documents;
create policy farmer_identity_documents_select on public.farmer_identity_documents for select to authenticated
 using(public.farmer_registry_can_access_producteur(producteur_id)
  and(public.peut_editer_config() or created_by=auth.uid()));
drop policy if exists farmer_identity_documents_insert on public.farmer_identity_documents;
create policy farmer_identity_documents_insert on public.farmer_identity_documents for insert to authenticated
 with check(public.peut_editer_terrain() and created_by=auth.uid()
  and public.farmer_registry_can_access_producteur(producteur_id));
drop policy if exists farmer_identity_documents_update on public.farmer_identity_documents;
create policy farmer_identity_documents_update on public.farmer_identity_documents for update to authenticated
 using(public.est_bm()) with check(public.est_bm());

drop policy if exists farmer_change_log_select on public.farmer_change_log;
create policy farmer_change_log_select on public.farmer_change_log for select to authenticated using(public.est_bm());

drop policy if exists farmer_registry_scope_guard on public.producteurs;
create policy farmer_registry_scope_guard on public.producteurs as restrictive for all to authenticated
 using(public.farmer_registry_can_access_village(village_id,rt_id))
 with check(public.farmer_registry_can_access_village(village_id,rt_id));

revoke all on public.aflp_zones,public.aflp_clusters from anon;
revoke insert,update,delete,truncate,references,trigger on public.aflp_zones,public.aflp_clusters from authenticated;
grant select on public.aflp_zones,public.aflp_clusters,public.farmer_passport_summary_v to authenticated;
revoke update,delete on public.farmer_consents from authenticated;
grant select,insert on public.farmer_consents to authenticated;
grant select,insert,update on public.farmer_identity_documents to authenticated;
grant select on public.farmer_change_log to authenticated;

revoke all on function public.farmer_registry_authority() from public,anon;
revoke all on function public.farmer_registry_can_access_village(text,text) from public,anon;
revoke all on function public.farmer_registry_can_access_producteur(text) from public,anon;
revoke all on function public.farmer_registry_set_code() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_producteur() from public,anon,authenticated;
revoke all on function public.farmer_registry_prepare_consent() from public,anon,authenticated;
revoke all on function public.farmer_registry_refresh_passport(text) from public,anon,authenticated;
revoke all on function public.farmer_registry_audit_trigger() from public,anon,authenticated;
grant execute on function public.farmer_registry_authority() to authenticated;
grant execute on function public.farmer_registry_can_access_village(text,text) to authenticated;
grant execute on function public.farmer_registry_can_access_producteur(text) to authenticated;
grant execute on function public.farmer_possible_duplicates(text,text,text,text) to authenticated;

commit;
