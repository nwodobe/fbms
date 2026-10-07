-- AFLP 2027 · Coopératives · 7d — Farmer Passport : l'affectation peut être une coopérative.
--
-- Avant : 20 points « affectation » et passage au stade BASIC exigeaient un RT.
-- Un membre de coopérative sans RT restait donc INCOMPLETE à vie, même avec un
-- dossier complet. Désormais : village + (RT OU affiliation ACTIVE à une
-- coopérative non archivée). Seul ce critère change ; le reste du calcul est
-- identique à l'existant. Aucun producteur actuel n'a d'affiliation : aucun
-- score existant ne bouge à l'application de cette migration.

begin;

create or replace function public.farmer_registry_refresh_passport(p_producteur_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
declare
  p public.producteurs%rowtype;
  c public.farmer_consents%rowtype;
  v_identity integer:=0;
  v_assignment integer:=0;
  v_consent integer:=0;
  v_plots integer:=0;
  v_gps integer:=0;
  v_production integer:=0;
  v_sustainability integer:=0;
  v_total integer:=0;
  v_stage text:='INCOMPLETE';
  v_risk text:='NOT_ASSESSED';
  v_sust_risk text:='NOT_ASSESSED';
  v_consent_status text:='NOT_RECORDED';
  v_plot_count integer:=0;
  v_gps_count integer:=0;
  v_production_count integer:=0;
  v_sust_count integer:=0;
  v_open_critical integer:=0;
  v_open_high integer:=0;
  v_verification_status text;
begin
  select * into p from public.producteurs where id=p_producteur_id;
  if p.id is null then return; end if;

  select * into c from public.farmer_consents
  where producteur_id=p_producteur_id
  order by event_order desc limit 1;

  if nullif(btrim(p.nom),'') is not null
     and p.sexe is not null
     and (p.birth_year is not null or nullif(btrim(p.age_band),'') is not null)
     and length(public.farmer_registry_norm_phone(p.telephone))=10 then v_identity:=30; end if;
  -- Affectation : RT (canal direct) OU coopérative active (canal coopérative).
  if p.village_id is not null and (p.rt_id is not null or exists (
       select 1 from public.aflp_coop_memberships m join public.aflp_cooperatives k on k.id = m.cooperative_id
        where m.producer_id = p.id and m.status = 'ACTIVE' and not k.archived)) then v_assignment:=20; end if;
  if c.id is not null then
    v_consent_status:=c.status;
    if c.status='GRANTED' then v_consent:=15;
    elsif c.status='PARTIAL' then v_consent:=8; end if;
  end if;

  select count(*) into v_plot_count from public.farmer_plots fp
  where fp.producteur_id=p_producteur_id and not fp.deleted and fp.status='ACTIVE';
  if v_plot_count>0 then v_plots:=10; end if;

  select count(*) into v_gps_count from public.farmer_plots fp
  where fp.producteur_id=p_producteur_id and not fp.deleted and fp.status='ACTIVE'
    and fp.gps_status in ('POINT_CAPTURED','GPS_VERIFIED');
  if v_gps_count>0 then v_gps:=10; end if;

  select count(*) into v_production_count from public.farmer_production_baselines b
  where b.producteur_id=p_producteur_id and b.status='FINAL';
  if v_production_count>0 then v_production:=10; end if;

  select count(*) into v_sust_count from public.farmer_sustainability_baselines b
  where b.producteur_id=p_producteur_id and b.status='FINAL';
  if v_sust_count>0 then
    v_sustainability:=5;
    select b.risk_profile into v_sust_risk from public.farmer_sustainability_baselines b
    where b.producteur_id=p_producteur_id and b.status='FINAL'
    order by b.finalized_at desc nulls last,b.version desc,b.created_at desc limit 1;
  end if;

  v_total:=v_identity+v_assignment+v_consent+v_plots+v_gps+v_production+v_sustainability;

  if v_identity=30 and v_assignment=20 and v_consent_status='GRANTED' then v_stage:='BASIC'; end if;
  if v_stage='BASIC' and v_plot_count>0 and v_gps_count>0 then v_stage:='MAPPED'; end if;
  if v_stage='MAPPED' and v_production_count>0 and v_sust_count>0 then v_stage:='BASELINE'; end if;

  select v.status into v_verification_status from public.farmer_verifications v
  where v.producteur_id=p_producteur_id
  order by v.verified_at desc,v.created_at desc limit 1;
  if v_stage='BASELINE' and v_verification_status='APPROVED' then v_stage:='VERIFIED'; end if;

  v_risk:=coalesce(v_sust_risk,'NOT_ASSESSED');
  if p.review_required or p.possible_duplicate or v_consent_status in ('PARTIAL','REFUSED','WITHDRAWN') then
    v_risk:='REVIEW_REQUIRED';
  end if;
  select count(*) filter(where priority='CRITICAL'),count(*) filter(where priority='HIGH')
    into v_open_critical,v_open_high
  from public.farmer_action_plans a
  where a.producteur_id=p_producteur_id and a.status in ('OPEN','IN_PROGRESS','OVERDUE');
  if v_open_critical>0 then v_risk:='REVIEW_REQUIRED';
  elsif v_open_high>0 then v_risk:=public.farmer_registry_max_risk(v_risk,'HIGH'); end if;

  update public.producteurs
  set passport_completion=v_total,
      passport_stage=v_stage,
      risk_profile=v_risk,
      consent_status=v_consent_status,
      consent_date=case when c.id is null then null else c.consent_at end,
      consent_version=case when c.id is null then null else c.text_version end,
      consent_method=case when c.id is null then null else c.method end
  where id=p_producteur_id
    and (passport_completion is distinct from v_total
      or passport_stage is distinct from v_stage
      or risk_profile is distinct from v_risk
      or consent_status is distinct from v_consent_status
      or consent_date is distinct from case when c.id is null then null else c.consent_at end
      or consent_version is distinct from case when c.id is null then null else c.text_version end
      or consent_method is distinct from case when c.id is null then null else c.method end);
end
$function$;

-- Recalcul du Passport quand une affiliation est créée, transférée ou clôturée.
create or replace function private.aflp_mbr_refresh_passport() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform public.farmer_registry_refresh_passport(new.producer_id);
  return new;
end $$;
create or replace trigger aflp_mbr_refresh_passport after insert or update of status on public.aflp_coop_memberships
  for each row execute function private.aflp_mbr_refresh_passport();
revoke all on function private.aflp_mbr_refresh_passport() from public, anon, authenticated;

commit;
