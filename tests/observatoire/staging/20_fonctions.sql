CREATE OR REPLACE FUNCTION public.aflp_cluster_code(p text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.code from public.aflp_clusters c
  where public.aflp_norm(p) is not null
    and (public.aflp_norm(p) = c.code or public.aflp_norm(p) = public.aflp_norm(c.label)
         or public.aflp_norm(p) = any (select public.aflp_norm(a) from unnest(c.aliases) a))
  order by c.code limit 1
$function$
;
revoke all on function aflp_cluster_code(text) from public; grant execute on function aflp_cluster_code(text) to authenticated;
CREATE OR REPLACE FUNCTION public.aflp_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nullif(upper(translate(btrim(coalesce(p, '')),
    'éèêëàâäîïôöûüçÉÈÊËÀÂÄÎÏÔÖÛÜÇ', 'eeeeaaaiioouucEEEEAAAIIOOUUC')), '')
$function$
;
revoke all on function aflp_norm(text) from public; grant execute on function aflp_norm(text) to authenticated;
CREATE OR REPLACE FUNCTION public.controler_statut_agent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if fbms_role() = 'Agent Recenseur' and new.statut not in ('Brouillon','Soumis') then
    raise exception 'Un Agent Recenseur ne peut placer une fiche qu''en Brouillon ou Soumis.';
  end if;
  return new;
end $function$
;
revoke all on function controler_statut_agent() from public; grant execute on function controler_statut_agent() to authenticated;
CREATE OR REPLACE FUNCTION public.est_actif()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif = true)
$function$
;
revoke all on function est_actif() from public; grant execute on function est_actif() to authenticated;
CREATE OR REPLACE FUNCTION public.est_bm()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profils
                 where user_id = auth.uid() and actif = true and role = 'Branch Manager')
$function$
;
revoke all on function est_bm() from public; grant execute on function est_bm() to authenticated;
CREATE OR REPLACE FUNCTION public.est_equipe_terrain()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in
    ('Chef d''equipe','Chef d''équipe','Agent Recenseur','Supervisor',
     'Procurement Officer','Head of Field',
     'Branch Manager','Assistant Branch Manager')
$function$
;
revoke all on function est_equipe_terrain() from public; grant execute on function est_equipe_terrain() to authenticated;
CREATE OR REPLACE FUNCTION public.farmer_registry_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rid text;
  before_payload jsonb;
  after_payload jsonb;
begin
  rid := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end,
    case when tg_op = 'DELETE' then to_jsonb(old)->>'producteur_id' else to_jsonb(new)->>'producteur_id' end,
    'UNKNOWN'
  );
  before_payload := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  after_payload := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;

  if tg_table_name = 'producteurs' then
    if before_payload is not null then
      before_payload := jsonb_set(before_payload - 'id_document_number', '{data}', coalesce(before_payload->'data','{}'::jsonb) - 'pieceNum', true);
    end if;
    if after_payload is not null then
      after_payload := jsonb_set(after_payload - 'id_document_number', '{data}', coalesce(after_payload->'data','{}'::jsonb) - 'pieceNum', true);
    end if;
  elsif tg_table_name = 'farmer_identity_documents' then
    if before_payload is not null then before_payload := before_payload - 'document_number'; end if;
    if after_payload is not null then after_payload := after_payload - 'document_number'; end if;
  end if;

  insert into public.farmer_change_log (
    table_name, record_id, operation, before_data, after_data,
    actor_id, actor_email, actor_role
  ) values (
    tg_table_name, rid, tg_op, before_payload, after_payload,
    auth.uid(), public.fbms_email(), public.fbms_role()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$
;
revoke all on function farmer_registry_audit_trigger() from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_max_risk(p_first text, p_second text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when public.farmer_registry_risk_rank(p_first) >= public.farmer_registry_risk_rank(p_second)
      then coalesce(p_first, 'NOT_ASSESSED')
    else coalesce(p_second, 'NOT_ASSESSED') end
$function$
;
revoke all on function farmer_registry_max_risk(text,text) from public; grant execute on function farmer_registry_max_risk(text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.farmer_registry_norm_phone(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g') like '225%'
      then right(regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g'), 10)
    else regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g')
  end
$function$
;
revoke all on function farmer_registry_norm_phone(text) from public; grant execute on function farmer_registry_norm_phone(text) to authenticated; grant execute on function farmer_registry_norm_phone(text) to anon;
CREATE OR REPLACE FUNCTION public.farmer_registry_norm_text(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select regexp_replace(upper(unaccent(coalesce(value, ''))), '[^A-Z0-9]+', '', 'g')
$function$
;
revoke all on function farmer_registry_norm_text(text) from public; grant execute on function farmer_registry_norm_text(text) to authenticated; grant execute on function farmer_registry_norm_text(text) to anon;
CREATE OR REPLACE FUNCTION public.farmer_registry_prepare_plot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_village_id text;
  v_gps_changed boolean := false;
begin
  select p.village_id into v_village_id
  from public.producteurs p
  where p.id = new.producteur_id and not p.deleted;

  if v_village_id is null then
    raise exception 'Producteur absent ou supprimé.';
  end if;
  if new.village_id is distinct from v_village_id then
    raise exception 'La parcelle doit appartenir au village du producteur.';
  end if;
  if not private.farmer_registry_can_access_producteur(new.producteur_id) then
    raise exception 'Parcelle hors périmètre utilisateur.';
  end if;

  v_gps_changed := tg_op = 'INSERT'
    or new.latitude is distinct from old.latitude
    or new.longitude is distinct from old.longitude
    or new.gps_accuracy_m is distinct from old.gps_accuracy_m
    or new.gps_captured_at is distinct from old.gps_captured_at;

  if new.latitude is not null and new.longitude is not null then
    new.gps_captured_at := coalesce(new.gps_captured_at, now());
    if v_gps_changed then new.gps_captured_by := auth.uid();
    elsif tg_op = 'UPDATE' then new.gps_captured_by := old.gps_captured_by;
    end if;
    if new.gps_status = 'NOT_MAPPED' then new.gps_status := 'POINT_CAPTURED'; end if;
  elsif new.gps_status in ('POINT_CAPTURED','GPS_VERIFIED') then
    raise exception 'Coordonnées GPS et métadonnées obligatoires pour une parcelle cartographiée.';
  end if;

  if new.gps_status = 'GPS_VERIFIED'
     and (tg_op = 'INSERT' or old.gps_status is distinct from 'GPS_VERIFIED')
     and not private.farmer_registry_can_supervise() then
    raise exception 'La vérification GPS est réservée à la supervision.';
  end if;

  if new.gps_verified_area is not null and new.gps_status <> 'GPS_VERIFIED' then
    raise exception 'Une superficie GPS vérifiée exige le statut GPS_VERIFIED.';
  end if;
  return new;
end
$function$
;
revoke all on function farmer_registry_prepare_plot() from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_prepare_producteur()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_village_nom text;
  v_rt_village text;
  v_document_number text;
  v_document_type text;
  v_sexe_norm text;
begin
  if new.data is null then new.data := '{}'::jsonb; end if;
  v_document_number := coalesce(
    nullif(btrim(new.id_document_number),''),
    nullif(btrim(new.data->>'pieceNum'),'')
  );
  v_document_type := coalesce(
    nullif(btrim(new.id_document_type),''),
    nullif(btrim(new.data->>'pieceType'),''),
    'OTHER'
  );

  select coalesce(v.village, v.data->'s1'->>'village')
    into v_village_nom
  from public.villages v
  where v.id = new.village_id and not v.deleted;
  if v_village_nom is null then raise exception 'Village producteur invalide ou supprime.'; end if;

  if new.rt_id is not null then
    select r.village_id into v_rt_village
    from public.rt r
    where r.id = new.rt_id and not r.deleted;
    if v_rt_village is null then raise exception 'RT producteur invalide ou supprime.'; end if;
    if v_rt_village is distinct from new.village_id then
      raise exception 'Le RT selectionne n''appartient pas au village du producteur.';
    end if;
  end if;

  new.village_nom := coalesce(nullif(new.village_nom,''), v_village_nom);
  new.prenoms := coalesce(new.prenoms, nullif(new.data->>'prenoms',''));

  v_sexe_norm := public.farmer_registry_norm_text(coalesce(new.sexe, new.data->>'sexe'));
  new.sexe := case v_sexe_norm
    when 'HOMME' then 'M'
    when 'MALE' then 'M'
    when 'M' then 'M'
    when 'FEMME' then 'F'
    when 'FEMALE' then 'F'
    when 'F' then 'F'
    when 'OTHER' then 'OTHER'
    when 'AUTRE' then 'OTHER'
    when 'UNKNOWN' then 'UNKNOWN'
    when 'INCONNU' then 'UNKNOWN'
    else nullif(new.sexe,'')
  end;

  new.birth_year := coalesce(new.birth_year, case
      when coalesce(new.data->>'anneeNaissance','') ~ '^[0-9]{4}$'
       and (new.data->>'anneeNaissance')::integer between 1900 and extract(year from current_date)::integer
      then (new.data->>'anneeNaissance')::integer else null end);
  if new.birth_year is not null and new.birth_year > extract(year from current_date)::integer then
    raise exception 'Annee de naissance future interdite.';
  end if;
  new.age_band := coalesce(new.age_band, nullif(new.data->>'ageBand',''));
  new.telephone_alt := coalesce(new.telephone_alt, nullif(new.data->>'telephoneAlt',''));
  new.preferred_language := coalesce(new.preferred_language, nullif(new.data->>'preferredLanguage',''));
  new.id_document_type := coalesce(new.id_document_type, nullif(new.data->>'pieceType',''));

  if v_document_number is not null and not exists (
    select 1 from public.farmer_identity_documents d
    where d.producteur_id = new.id and d.document_number = v_document_number
  ) then
    insert into public.farmer_identity_documents (
      producteur_id, document_type, document_number, status, source, created_by
    ) values (
      new.id, v_document_type, v_document_number, 'ACTIVE',
      case when new.data ? 'pieceNum' then 'LEGACY_UI_COMPAT' else 'FIELD_ENROLLMENT' end,
      auth.uid()
    );
  end if;
  new.id_document_number := null;

  if tg_op = 'UPDATE' and new.operational_status is distinct from old.operational_status then
    new.operational_status := new.operational_status;
  else
    new.operational_status := coalesce(nullif(new.data->>'operationalStatus',''), new.operational_status, 'ACTIVE');
  end if;
  if tg_op = 'UPDATE' and new.possible_duplicate is distinct from old.possible_duplicate then
    new.possible_duplicate := new.possible_duplicate;
  else
    new.possible_duplicate := coalesce((new.data->>'possibleDuplicate')::boolean, new.possible_duplicate, false);
  end if;
  if tg_op = 'UPDATE' and new.review_required is distinct from old.review_required then
    new.review_required := new.review_required;
  else
    new.review_required := coalesce((new.data->>'reviewRequired')::boolean, new.review_required, false);
  end if;
  if tg_op = 'UPDATE' and new.review_reason is distinct from old.review_reason then
    new.review_reason := new.review_reason;
  else
    new.review_reason := coalesce(new.review_reason, nullif(new.data->>'reviewReason',''));
  end if;

  new.data := (new.data - 'pieceNum') || jsonb_strip_nulls(jsonb_build_object(
    'prenoms', new.prenoms,
    'sexe', case new.sexe when 'M' then 'Homme' when 'F' then 'Femme' else coalesce(new.data->>'sexe', new.sexe) end,
    'anneeNaissance', new.birth_year,
    'ageBand', new.age_band,
    'telephoneAlt', new.telephone_alt,
    'preferredLanguage', new.preferred_language,
    'pieceType', new.id_document_type,
    'operationalStatus', new.operational_status,
    'possibleDuplicate', new.possible_duplicate,
    'reviewRequired', new.review_required,
    'reviewReason', new.review_reason
  ));

  if tg_op = 'UPDATE' then new.record_version := coalesce(old.record_version, 0) + 1;
  else new.record_version := greatest(coalesce(new.record_version, 1), 1); end if;
  new.updated_at := now();
  new.updated_by_user_id := auth.uid();
  if tg_op = 'INSERT' then new.created_by_user_id := coalesce(new.created_by_user_id, auth.uid()); end if;
  return new;
exception when invalid_text_representation then
  raise exception 'Valeur booleenne invalide dans les metadonnees producteur.';
end
$function$
;
revoke all on function farmer_registry_prepare_producteur() from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_prepare_village_cluster_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_label text;
  v_code text;
begin
  if new.deleted then
    return new;
  end if;

  if new.cluster_code is not null and btrim(new.cluster_code) <> ''
     and exists(select 1 from public.aflp_clusters c where c.code = new.cluster_code and c.active) then
    return new;
  end if;

  v_label := coalesce(nullif(new.cluster,''), nullif(new.data->'s1'->>'cluster',''));
  if v_label is null then
    return new;
  end if;

  v_code := public.farmer_registry_resolve_cluster_code(v_label);
  if v_code is not null then
    new.cluster_code := v_code;
  end if;
  return new;
end
$function$
;
revoke all on function farmer_registry_prepare_village_cluster_code() from public; grant execute on function farmer_registry_prepare_village_cluster_code() to authenticated; grant execute on function farmer_registry_prepare_village_cluster_code() to anon;
CREATE OR REPLACE FUNCTION public.farmer_registry_refresh_child_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_producteur_id text;
begin
  v_producteur_id:=coalesce(to_jsonb(new)->>'producteur_id',to_jsonb(old)->>'producteur_id');
  if v_producteur_id is not null then perform public.farmer_registry_refresh_passport(v_producteur_id); end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$
;
revoke all on function farmer_registry_refresh_child_trigger() from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_refresh_from_producteur_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin perform public.farmer_registry_refresh_passport(new.id); return new; end $function$
;
revoke all on function farmer_registry_refresh_from_producteur_trigger() from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_refresh_passport(p_producteur_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$
;
revoke all on function farmer_registry_refresh_passport(text) from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_resolve_cluster_code(value text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;
revoke all on function farmer_registry_resolve_cluster_code(text) from public; grant execute on function farmer_registry_resolve_cluster_code(text) to authenticated; grant execute on function farmer_registry_resolve_cluster_code(text) to anon;
CREATE OR REPLACE FUNCTION public.farmer_registry_risk_rank(p_risk text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_risk
    when 'REVIEW_REQUIRED' then 4
    when 'HIGH' then 3
    when 'MEDIUM' then 2
    when 'LOW' then 1
    else 0 end
$function$
;
revoke all on function farmer_registry_risk_rank(text) from public; grant execute on function farmer_registry_risk_rank(text) to authenticated;
CREATE OR REPLACE FUNCTION public.farmer_registry_set_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare prefix text; next_number integer;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then raise exception 'Le Farmer ID est immuable après attribution.'; end if;
    return new;
  end if;
  if new.code is null or btrim(new.code) = '' or new.code like 'TMP-%' then
    select v.farmer_code_prefix into prefix from public.villages v where v.id = new.village_id and not v.deleted;
    if prefix is null or btrim(prefix) = '' then raise exception 'Préfixe Farmer ID absent pour le village sélectionné.'; end if;
    insert into public.prod_code_seq (village_id, dernier) values (new.village_id, 1)
    on conflict (village_id) do update set dernier = public.prod_code_seq.dernier + 1 returning dernier into next_number;
    new.code := prefix || '-' || lpad(next_number::text, 4, '0');
  end if;
  return new;
end $function$
;
revoke all on function farmer_registry_set_code() from public;
CREATE OR REPLACE FUNCTION public.farmer_registry_touch_child_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.record_version := coalesce(old.record_version, 0) + 1;
  else
    new.record_version := greatest(coalesce(new.record_version, 1), 1);
  end if;
  return new;
end
$function$
;
revoke all on function farmer_registry_touch_child_row() from public;
CREATE OR REPLACE FUNCTION public.fb_preserve_media_rt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare k text;
begin
  if NEW.data is null or OLD.data is null then return NEW; end if;
  foreach k in array array['photo', 'pieceRecto', 'pieceVerso'] loop
    if not (NEW.data ? k) and (OLD.data ? k) then
      NEW.data := jsonb_set(NEW.data, array[k], OLD.data -> k, true);
    end if;
  end loop;
  return NEW;
end $function$
;
revoke all on function fb_preserve_media_rt() from public; grant execute on function fb_preserve_media_rt() to authenticated; grant execute on function fb_preserve_media_rt() to anon;
CREATE OR REPLACE FUNCTION public.fb_preserve_media_villages()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  new_c jsonb; old_c jsonb; merged jsonb := '[]'::jsonb;
  item jsonb; src jsonb; nom_new text; i int := 0; k text;
begin
  if NEW.data is null or OLD.data is null then return NEW; end if;
  new_c := NEW.data #> '{s7,candidats}';
  old_c := OLD.data #> '{s7,candidats}';
  if jsonb_typeof(new_c) <> 'array' or jsonb_typeof(old_c) <> 'array' then return NEW; end if;

  for item in select e.value from jsonb_array_elements(new_c) e loop
    nom_new := lower(btrim(coalesce(item ->> 'nom', '')));
    src := null;
    if nom_new <> '' then
      select o.value into src from jsonb_array_elements(old_c) o
       where lower(btrim(coalesce(o.value ->> 'nom', ''))) = nom_new limit 1;
    end if;
    if src is null then src := old_c -> i; end if;
    if src is not null and jsonb_typeof(src) = 'object' then
      foreach k in array array['photo', 'pieceRecto', 'pieceVerso'] loop
        if not (item ? k) and (src ? k) then
          item := jsonb_set(item, array[k], src -> k, true);
        end if;
      end loop;
    end if;
    merged := merged || jsonb_build_array(item);
    i := i + 1;
  end loop;

  NEW.data := jsonb_set(NEW.data, '{s7,candidats}', merged, true);
  return NEW;
end $function$
;
revoke all on function fb_preserve_media_villages() from public; grant execute on function fb_preserve_media_villages() to authenticated; grant execute on function fb_preserve_media_villages() to anon;
CREATE OR REPLACE FUNCTION public.fbms_controler_suppression()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(old.deleted, false) = false
     and new.deleted = true
     and coalesce(fbms_role(), '') <> 'Branch Manager' then
    raise exception 'Seul le Branch Manager peut supprimer des fiches.';
  end if;
  return new;
end $function$
;
revoke all on function fbms_controler_suppression() from public; grant execute on function fbms_controler_suppression() to authenticated;
CREATE OR REPLACE FUNCTION public.fbms_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email from profils where user_id = auth.uid() and actif = true;
$function$
;
revoke all on function fbms_email() from public; grant execute on function fbms_email() to authenticated;
CREATE OR REPLACE FUNCTION public.fbms_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from profils where user_id = auth.uid() and actif = true;
$function$
;
revoke all on function fbms_role() from public; grant execute on function fbms_role() to authenticated;
CREATE OR REPLACE FUNCTION public.fbms_slug3(txt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select left(
    regexp_replace(
      translate(upper(coalesce(txt,'')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸÆŒ', 'AAAAAACEEEEIIIINOOOOOUUUUYYAO'),
      '[^A-Z0-9]+', '', 'g'
    ) || 'XXX',
    3
  )
$function$
;
revoke all on function fbms_slug3(text) from public; grant execute on function fbms_slug3(text) to authenticated; grant execute on function fbms_slug3(text) to anon;
CREATE OR REPLACE FUNCTION public.fn_sync_villages_colonnes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Le JSONB data->'s1' fait foi. Les colonnes relationnelles en sont derivees.
  -- Si le JSONB est vide sur un champ, la valeur existante de la colonne est conservee.
  new.cluster := coalesce(nullif(upper(trim(new.data->'s1'->>'cluster')),''), new.cluster);
  new.gps_lat := coalesce(nullif(trim(new.data->'s1'->>'gpsLat'),'')::numeric, new.gps_lat);
  new.gps_lng := coalesce(nullif(trim(new.data->'s1'->>'gpsLng'),'')::numeric, new.gps_lng);
  return new;
exception when others then
  -- Une valeur GPS non numerique ne doit jamais bloquer l'ecriture du village.
  return new;
end;
$function$
;
revoke all on function fn_sync_villages_colonnes() from public; grant execute on function fn_sync_villages_colonnes() to authenticated; grant execute on function fn_sync_villages_colonnes() to anon;
CREATE OR REPLACE FUNCTION public.guard_rt_duplicate_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;
revoke all on function guard_rt_duplicate_identity() from public; grant execute on function guard_rt_duplicate_identity() to authenticated; grant execute on function guard_rt_duplicate_identity() to anon;
CREATE OR REPLACE FUNCTION public.mon_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.profils where user_id = auth.uid() and actif = true limit 1
$function$
;
revoke all on function mon_role() from public; grant execute on function mon_role() to authenticated;
CREATE OR REPLACE FUNCTION public.peut_ecrire_referentiel_terrain()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.peut_editer_terrain(), false) or coalesce(public.peut_modifier_rt_producteur(), false)
      or coalesce(public.mon_role() in ('Field Buying Operations Officer','General Manager'), false)
$function$
;
revoke all on function peut_ecrire_referentiel_terrain() from public; grant execute on function peut_ecrire_referentiel_terrain() to authenticated;
CREATE OR REPLACE FUNCTION public.peut_editer_config()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$function$
;
revoke all on function peut_editer_config() from public; grant execute on function peut_editer_config() to authenticated;
CREATE OR REPLACE FUNCTION public.peut_editer_terrain()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
     'Supervisor','Agent Recenseur','Chef d''equipe','Chef d''équipe')
$function$
;
revoke all on function peut_editer_terrain() from public; grant execute on function peut_editer_terrain() to authenticated;
CREATE OR REPLACE FUNCTION public.peut_modifier_rt_producteur()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in (
    'Branch Manager',
    'Assistant Branch Manager',
    'Head of Field',
    'Procurement Officer',
    'Zonal Head',
    'Unit Head',
    'Assistant Unit Head',
    'Supervisor',
    'Agent Recenseur',
    'Chef d''equipe',
    'Chef d''équipe',
    'Administrateur'
  )
$function$
;
revoke all on function peut_modifier_rt_producteur() from public; grant execute on function peut_modifier_rt_producteur() to authenticated;
CREATE OR REPLACE FUNCTION public.portee_terrain_globale()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in ('Zonal Head')
$function$
;
revoke all on function portee_terrain_globale() from public; grant execute on function portee_terrain_globale() to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_auh_actif()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from public.profils p
                 where p.user_id = auth.uid() and p.actif = true and p.role = 'Assistant Unit Head')
$function$
;
revoke all on function private.aflp_auh_actif() from public; grant execute on function private.aflp_auh_actif() to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_auh_cluster()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.farmer_registry_resolve_cluster_code(p.cluster)
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true and p.role = 'Assistant Unit Head'
  limit 1
$function$
;
revoke all on function private.aflp_auh_cluster() from public; grant execute on function private.aflp_auh_cluster() to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_auh_dans_perimetre(p_cluster text, p_village_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_mien text; v_cible text;
begin
  if not private.aflp_auh_actif() then return true; end if;
  v_mien := private.aflp_auh_cluster();
  if v_mien is null then return false; end if;
  v_cible := public.farmer_registry_resolve_cluster_code(p_cluster);
  if v_cible is null and nullif(btrim(coalesce(p_village_id,'')),'') is not null then
    v_cible := private.aflp_cluster_du_village(p_village_id);
  end if;
  return v_cible is not null and v_cible = v_mien;
end $function$
;
revoke all on function private.aflp_auh_dans_perimetre(text,text) from public; grant execute on function private.aflp_auh_dans_perimetre(text,text) to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_auh_garde_producteur()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare terrain constant text[] := array['Identifié','Enrôlé'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.statut,'Identifié') <> all (terrain) then
    raise exception 'Assistant Unit Head : producteur au statut « % » ; changement réservé au Chef d''Unité ou supérieur.', old.statut
      using errcode = '42501';
  end if;
  if coalesce(new.statut,'Identifié') <> all (terrain) then
    raise exception 'Assistant Unit Head : statut producteur « % » hors validation terrain (Identifié, Enrôlé).', new.statut
      using errcode = '42501';
  end if;
  return new;
end $function$
;
revoke all on function private.aflp_auh_garde_producteur() from public;
CREATE OR REPLACE FUNCTION private.aflp_auh_garde_rt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare terrain constant text[] := array['Pressenti','Confirmé'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.statut,'Pressenti') <> all (terrain) then
    raise exception 'Assistant Unit Head : RT au statut « % » (décision hiérarchique) ; changement réservé au Chef d''Unité ou supérieur.', old.statut
      using errcode = '42501';
  end if;
  if coalesce(new.statut,'Pressenti') <> all (terrain) then
    raise exception 'Assistant Unit Head : statut RT « % » réservé à la validation hiérarchique.', new.statut using errcode = '42501';
  end if;
  if new.statut = 'Confirmé' and (tg_op = 'INSERT'
       or lower(coalesce(old.created_by,'')) = lower(coalesce(public.fbms_email(),'-'))) then
    raise exception 'Assistant Unit Head : vous ne pouvez pas confirmer un RT que vous avez enregistré (contrôle à quatre yeux).'
      using errcode = '42501';
  end if;
  return new;
end $function$
;
revoke all on function private.aflp_auh_garde_rt() from public;
CREATE OR REPLACE FUNCTION private.aflp_auh_garde_village()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  terrain constant text[] := array['Brouillon','Soumis'];
  modifiables constant text[] := array['Brouillon','Soumis','À corriger'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.statut,'Brouillon') <> all (terrain) then
      raise exception 'Assistant Unit Head : une fiche village se crée en Brouillon ou Soumis (statut « % » réservé à la validation hiérarchique).', new.statut
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.statut is distinct from old.statut then
    if coalesce(old.statut,'Brouillon') <> all (modifiables) then
      raise exception 'Assistant Unit Head : la fiche est au statut « % » (validation hiérarchique) ; seul le Chef d''Unité ou un supérieur peut le changer.', old.statut
        using errcode = '42501';
    end if;
    if new.statut <> all (terrain) then
      raise exception 'Assistant Unit Head : statut « % » réservé à la validation hiérarchique. Validation terrain = Soumis.', new.statut
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$
;
revoke all on function private.aflp_auh_garde_village() from public;
CREATE OR REPLACE FUNCTION private.aflp_can_force_create()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(private.aflp_coop_is_direction() or private.farmer_registry_can_supervise(), false)
$function$
;
revoke all on function private.aflp_can_force_create() from public;
CREATE OR REPLACE FUNCTION private.aflp_cluster_du_village(p_village_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.farmer_registry_resolve_cluster_code(
           coalesce(nullif(btrim(v.cluster_code),''), nullif(btrim(v.cluster),''), v.data->'s1'->>'cluster'))
  from public.villages v where v.id = p_village_id
$function$
;
revoke all on function private.aflp_cluster_du_village(text) from public; grant execute on function private.aflp_cluster_du_village(text) to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_coop_can_edit(p_coop uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(public.mon_role() = any(private.aflp_coop_roles_editeurs()), false)
     and (p_coop is null or private.aflp_coop_can_read(p_coop))
$function$
;
revoke all on function private.aflp_coop_can_edit(uuid) from public; grant execute on function private.aflp_coop_can_edit(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_coop_can_read(p_coop uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_cluster text; v_zone text; p public.profils%rowtype;
begin
  if not public.est_actif() then return false; end if;
  if private.aflp_coop_scope_global() then return true; end if;
  if public.mon_role() = any(private.aflp_coop_roles_transverses()) then return true; end if;
  select c.cluster_code, k.zone_code into v_cluster, v_zone
  from public.aflp_cooperatives c left join public.aflp_clusters k on k.code = c.cluster_code
  where c.id = p_coop;
  select * into p from public.profils where user_id = auth.uid() and actif limit 1;
  if v_cluster is not null and p.village_id is null then
    if p.cluster is not null and public.farmer_registry_norm_text(p.cluster) = public.farmer_registry_norm_text(v_cluster) then return true; end if;
    if p.zone is not null and public.farmer_registry_norm_text(p.zone) in
       (public.farmer_registry_norm_text(v_zone),
        public.farmer_registry_norm_text((select label from public.aflp_zones where code = v_zone))) then return true; end if;
  end if;
  return exists (select 1 from public.aflp_coop_villages cv
                 where cv.cooperative_id = p_coop and cv.active and cv.village_id is not null
                   and private.farmer_registry_can_access_village(cv.village_id, p.rt_id));
end $function$
;
revoke all on function private.aflp_coop_can_read(uuid) from public; grant execute on function private.aflp_coop_can_read(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_coop_is_direction()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(public.mon_role() = any(private.aflp_coop_roles_direction()), false)
$function$
;
revoke all on function private.aflp_coop_is_direction() from public; grant execute on function private.aflp_coop_is_direction() to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_coop_roles_direction()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array['Branch Manager','Assistant Branch Manager','Head of Field','Administrateur']
$function$
;
revoke all on function private.aflp_coop_roles_direction() from public; grant execute on function private.aflp_coop_roles_direction() to authenticated; grant execute on function private.aflp_coop_roles_direction() to anon;
CREATE OR REPLACE FUNCTION private.aflp_coop_roles_editeurs()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array['Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Zonal Head',
               'Field Buying Operations Officer','Unit Head','Assistant Unit Head','Supervisor','Administrateur']
$function$
;
revoke all on function private.aflp_coop_roles_editeurs() from public; grant execute on function private.aflp_coop_roles_editeurs() to authenticated; grant execute on function private.aflp_coop_roles_editeurs() to anon;
CREATE OR REPLACE FUNCTION private.aflp_coop_roles_transverses()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array['General Manager','Finance','Finance Manager','LBA Purchase Officer','Warehouse Manager',
               'Storekeeper','QA / Lab','Factory User','Viewer / Auditor','Consultation uniquement',
               'Field Buying Operations Officer','Coordination']
$function$
;
revoke all on function private.aflp_coop_roles_transverses() from public; grant execute on function private.aflp_coop_roles_transverses() to authenticated; grant execute on function private.aflp_coop_roles_transverses() to anon;
CREATE OR REPLACE FUNCTION private.aflp_coop_scope_global()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select public.est_actif() and (
    coalesce(private.farmer_registry_authority(), '') = 'GLOBAL'
    or public.portee_terrain_globale()
    or public.mon_role() = 'Administrateur')
$function$
;
revoke all on function private.aflp_coop_scope_global() from public; grant execute on function private.aflp_coop_scope_global() to authenticated;
CREATE OR REPLACE FUNCTION private.aflp_producteur_rt_obligatoire()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_source text := coalesce(new.data->>'source', '');
  v_coop   boolean;
begin
  if coalesce(new.deleted, false) or coalesce(new.is_qa, false) then
    return new;
  end if;
  if new.rt_id is not null and btrim(new.rt_id) <> '' then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (select 1 from public.producteurs x where x.id = new.id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (old.rt_id is null or btrim(old.rt_id) = '') then
    return new;
  end if;
  v_coop := v_source ilike '%COOP%'
    or exists (select 1 from public.aflp_producer_enrollment e
               where e.producer_id = new.id and e.enrollment_channel = 'COOPERATIVE')
    or exists (select 1 from public.aflp_coop_memberships m
               where m.producer_id = new.id and m.status <> 'ENDED' and m.membership_end is null);
  if v_coop then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'RT obligatoire : un producteur en canal direct doit être rattaché à un RT de son village.',
    hint    = 'Choisissez le RT référent dans la fiche producteur. Si le village n''a pas encore de RT, créez-le d''abord.';
end;
$function$
;
revoke all on function private.aflp_producteur_rt_obligatoire() from public;
CREATE OR REPLACE FUNCTION private.aflp_village_ecriture_dans_mon_cluster(p_cluster_code text, p_cluster text, p_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_role text;
  v_mon_cluster text;
  v_signal text;
  v_code text;
  v_nb int := 0;
begin
  select role, cluster into v_role, v_mon_cluster
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;
  if v_role is null or v_role not in ('Unit Head', 'Assistant Unit Head') then
    return true;
  end if;
  v_mon_cluster := public.farmer_registry_resolve_cluster_code(v_mon_cluster);
  if v_mon_cluster is null then
    return false;
  end if;
  foreach v_signal in array array[p_cluster_code, p_cluster, p_data -> 's1' ->> 'cluster'] loop
    if nullif(btrim(coalesce(v_signal, '')), '') is null then
      continue;
    end if;
    v_code := public.farmer_registry_resolve_cluster_code(v_signal);
    if v_code is null or v_code <> v_mon_cluster then
      return false;
    end if;
    v_nb := v_nb + 1;
  end loop;
  return v_nb > 0;
end
$function$
;
revoke all on function private.aflp_village_ecriture_dans_mon_cluster(text,text,jsonb) from public; grant execute on function private.aflp_village_ecriture_dans_mon_cluster(text,text,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION private.campaigns_sync_legacy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'Le code de campagne % ne se modifie pas : il est référencé par les opérations.', old.code using errcode = '42501';
  end if;
  new.is_qa := new.campaign_type = 'QA';
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.row_version := old.row_version + 1; end if;
  begin
    insert into public.procurement_campaigns (code, starts_on, ends_on, source)
    values (new.code, coalesce(new.start_date, make_date(new.year, 1, 1)), coalesce(new.planned_end_date, make_date(new.year, 12, 31)), 'CAMPAIGNS')
    on conflict (code) do nothing;
  exception when check_violation then
    raise exception 'Code % refusé : pour l''instant, le code d''une campagne doit être une année sur 4 chiffres (ex. 2028). Les codes alphanumériques (RCN-2028, SIM-2027) seront acceptés après validation de la migration 4 par la direction.', new.code
      using errcode = '23514';
  end;
  return new;
end $function$
;
revoke all on function private.campaigns_sync_legacy() from public;
CREATE OR REPLACE FUNCTION private.farmer_controle_doublon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_tel text; v_idn text; v_nn text; v_hit record; v_justif boolean;
begin
  if coalesce(new.deleted, false) then return new; end if;
  if tg_op = 'UPDATE' and new.telephone is not distinct from old.telephone and new.nom is not distinct from old.nom
     and new.prenoms is not distinct from old.prenoms and new.village_id is not distinct from old.village_id
     and old.deleted is not distinct from new.deleted then
    return new;
  end if;
  v_tel := nullif(public.farmer_registry_norm_phone(new.telephone), '');
  if v_tel is not null and length(v_tel) < 8 then v_tel := null; end if;
  v_idn := nullif(public.farmer_registry_norm_text(coalesce(new.nom,'') || ' ' || coalesce(new.prenoms,'')), '');
  v_nn  := nullif(public.farmer_registry_norm_text(new.nom), '');
  v_justif := coalesce(new.possible_duplicate, false) and length(btrim(coalesce(new.review_reason,''))) >= 10;

  if v_tel is not null and v_idn is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: ce producteur existe déjà (Farmer ID %, même téléphone et même identité). Ouvrez la fiche existante au lieu d''en créer une nouvelle.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      if auth.uid() is not null and not private.aflp_can_force_create() then
        raise exception 'DOUBLON_FORT: création malgré un doublon fort réservée à la supervision (Supervisor, Unit Head, Zonal Head, direction).'
          using errcode = '42501';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;

  if v_idn is not null and nullif(btrim(coalesce(new.prenoms,'')),'') is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: un producteur de même nom et prénoms existe déjà dans ce village (Farmer ID %). Vérifiez la fiche existante ; une création exceptionnelle exige une justification.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;

  if v_tel is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
     limit 1;
    if v_hit.id is not null then
      new.possible_duplicate := true; new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : téléphone partagé avec le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (téléphone familial possible).');
      return new;
    end if;
  end if;

  if v_nn is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id and p.nom is not null
       and public.farmer_registry_norm_text(p.nom) = v_nn
       and (nullif(btrim(coalesce(new.prenoms,'')),'') is null or nullif(btrim(coalesce(p.prenoms,'')),'') is null)
     limit 1;
    if v_hit.id is not null then
      new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : même nom dans le même village que le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (indice faible).');
    end if;
  end if;
  return new;
end $function$
;
revoke all on function private.farmer_controle_doublon() from public;
CREATE OR REPLACE FUNCTION private.farmer_registry_authority()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(
    p.authority_level,
    case p.role
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
      when 'Logistics Coordinator' then 'TRANSVERSE'
      when 'Finance / Controller' then 'TRANSVERSE'
      when 'Read Only / Audit' then 'TRANSVERSE'
      when 'Consultation uniquement' then 'TRANSVERSE'
      else 'TRANSVERSE'
    end
  )
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true
  limit 1
$function$
;
revoke all on function private.farmer_registry_authority() from public; grant execute on function private.farmer_registry_authority() to authenticated; grant execute on function private.farmer_registry_authority() to anon;
CREATE OR REPLACE FUNCTION private.farmer_registry_can_access_producteur(pid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists (
    select 1
    from public.producteurs p
    where p.id = pid
      and private.farmer_registry_can_access_village(p.village_id, p.rt_id)
  )
$function$
;
revoke all on function private.farmer_registry_can_access_producteur(text) from public; grant execute on function private.farmer_registry_can_access_producteur(text) to authenticated; grant execute on function private.farmer_registry_can_access_producteur(text) to anon;
CREATE OR REPLACE FUNCTION private.farmer_registry_can_access_village(target_village text, target_rt text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  p public.profils%rowtype;
  v_cluster text;
  v_zone text;
  v_has_multi_zone boolean := false;
begin
  select * into p
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;

  if p.user_id is null then return false; end if;
  if private.farmer_registry_authority() = 'GLOBAL' then return true; end if;

  -- Portee terrain globale par role (Zonal Head). Dynamique : vaut pour toute
  -- zone existante ou creee ulterieurement, sans liste a maintenir.
  if public.portee_terrain_globale() then return true; end if;

  select coalesce(v.cluster_code, upper(btrim(v.cluster))), c.zone_code
    into v_cluster, v_zone
  from public.villages v
  left join public.aflp_clusters c on c.code = v.cluster_code
  where v.id = target_village and not v.deleted;

  if v_cluster is null then return false; end if;

  -- Multi-zone explicite : permissions = {"zones":["GBEKE_1","GBEKE_2"]}
  if jsonb_typeof(p.permissions) = 'object'
     and jsonb_typeof(p.permissions->'zones') = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(p.permissions->'zones') z
      where public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(v_zone)
         or public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(
                (select label from public.aflp_zones where code = v_zone)
              )
    ) into v_has_multi_zone;
    if v_has_multi_zone then return true; end if;
  end if;

  if p.village_id is not null then
    if target_village is distinct from p.village_id then return false; end if;
    if p.rt_id is not null and target_rt is distinct from p.rt_id then return false; end if;
    return true;
  end if;

  if p.cluster is not null then
    return public.farmer_registry_norm_text(p.cluster)
      = public.farmer_registry_norm_text(v_cluster);
  end if;

  if p.zone is not null then
    return public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(v_zone)
      or public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(
          (select z.label from public.aflp_zones z where z.code = v_zone)
        );
  end if;

  -- Plus d'acces large implicite si aucun perimetre n'est configure.
  return false;
end
$function$
;
revoke all on function private.farmer_registry_can_access_village(text,text) from public; grant execute on function private.farmer_registry_can_access_village(text,text) to authenticated; grant execute on function private.farmer_registry_can_access_village(text,text) to anon;
CREATE OR REPLACE FUNCTION private.farmer_registry_can_capture()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists(
    select 1 from public.profils p
    where p.user_id=auth.uid() and p.actif=true
      and p.role in (
        'Branch Manager','Branch Manager / Head of Programme','Assistant Branch Manager',
        'Head of Field','Procurement Officer','Zonal Head','Unit Head',
        'Assistant Unit Head','Supervisor','Agent Recenseur',
        'Chef d''equipe','Chef d''équipe'
      )
  )
$function$
;
revoke all on function private.farmer_registry_can_capture() from public; grant execute on function private.farmer_registry_can_capture() to authenticated;
CREATE OR REPLACE FUNCTION private.farmer_registry_can_read_sensitive()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.farmer_registry_can_capture() or private.farmer_registry_can_supervise()
$function$
;
revoke all on function private.farmer_registry_can_read_sensitive() from public; grant execute on function private.farmer_registry_can_read_sensitive() to authenticated;
CREATE OR REPLACE FUNCTION private.farmer_registry_can_supervise()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists(
    select 1 from public.profils p
    where p.user_id=auth.uid() and p.actif=true
      and p.role in (
        'Branch Manager','Branch Manager / Head of Programme','Assistant Branch Manager',
        'Head of Field','Procurement Officer','Zonal Head','Unit Head','Supervisor','Admin','Administrateur'
      )
  )
$function$
;
revoke all on function private.farmer_registry_can_supervise() from public; grant execute on function private.farmer_registry_can_supervise() to authenticated;
CREATE OR REPLACE FUNCTION private.moto_beneficiaire_valide(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ select coalesce(private.moto_classe_de(p_user) in ('UNITE','ZONE','ABM','LOGISTIQUE'), false) $function$
;
revoke all on function private.moto_beneficiaire_valide(uuid) from public;
CREATE OR REPLACE FUNCTION private.moto_chemin_permis_valide(p_nom text, p_titulaire uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_temp'
AS $function$
  select p_nom is not null and p_titulaire is not null
     and p_nom ~ ('^permis/' || p_titulaire::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
$function$
;
revoke all on function private.moto_chemin_permis_valide(text,uuid) from public;
CREATE OR REPLACE FUNCTION private.moto_classe_de(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
           when p.role = 'Branch Manager' then 'BM'
           when p.role = 'Assistant Branch Manager' then 'ABM'
           when p.role in ('Finance','Finance Manager') then 'FINANCE'
           when p.role = 'General Manager' then 'DIRECTION'
           when p.role = 'Zonal Head' then 'ZONE'
           when p.role = 'Unit Head' then 'UNITE'
           when p.role = 'Logistics Coordinator'
             or public.aflp_norm(p.fonction_operationnelle) in ('LOGISTICS COORDINATOR','LOGISTICS_COORDINATOR','COORDINATEUR LOGISTIQUE')
             then 'LOGISTIQUE'
           else null end
  from public.profils p
  where p.user_id = p_user and p.actif = true
  limit 1
$function$
;
revoke all on function private.moto_classe_de(uuid) from public; grant execute on function private.moto_classe_de(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_classe()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ select private.moto_classe_de(auth.uid()) $function$
;
revoke all on function private.moto_classe() from public; grant execute on function private.moto_classe() to authenticated;
CREATE OR REPLACE FUNCTION private.moto_dans_perimetre(p_moto uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_classe text := private.moto_classe(); m record;
begin
  if v_classe is null then return false; end if;
  if v_classe in ('BM','ABM','FINANCE','DIRECTION','LOGISTIQUE') then return true; end if;
  select cluster_code, zone_code into m from public.moto_motos where id = p_moto;
  if not found then return false; end if;
  if exists (select 1 from public.moto_affectations a where a.moto_id = p_moto and a.statut = 'ACTIVE' and a.beneficiaire_id = auth.uid()) then
    return true;
  end if;
  if v_classe = 'ZONE' then
    if public.portee_terrain_globale() then return true; end if;
    return m.zone_code is not null and m.zone_code = private.moto_ma_zone();
  end if;
  if v_classe = 'UNITE' then
    return private.moto_est_affectataire(p_moto)
        or (m.cluster_code is not null and m.cluster_code = private.moto_mon_cluster());
  end if;
  return false;
end $function$
;
revoke all on function private.moto_dans_perimetre(uuid) from public; grant execute on function private.moto_dans_perimetre(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_est_affectataire(p_moto uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from public.moto_affectations a
                 where a.moto_id = p_moto and a.statut = 'ACTIVE'
                   and a.type_affectation in ('REMISE','TRANSFERT') and a.beneficiaire_id = auth.uid())
$function$
;
revoke all on function private.moto_est_affectataire(uuid) from public; grant execute on function private.moto_est_affectataire(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_formation_peut_deposer(p_nom text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if private.moto_classe() not in ('BM','ABM') then return false; end if;
  return p_nom ~ '^(CONTROLE_SECURITE|CARBURANT_JUSTIFICATIFS|ENTRETIEN_PREVENTIF|INCIDENTS)/[0-9a-f-]{36}\.pdf$';
end $function$
;
revoke all on function private.moto_formation_peut_deposer(text) from public; grant execute on function private.moto_formation_peut_deposer(text) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_lecture_enveloppe(p_titulaire uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ select private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION') or (private.moto_classe() is not null and p_titulaire = auth.uid()) $function$
;
revoke all on function private.moto_lecture_enveloppe(uuid) from public; grant execute on function private.moto_lecture_enveloppe(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_lecture_fin_maintenance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ select coalesce(private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION','LOGISTIQUE'), false) $function$
;
revoke all on function private.moto_lecture_fin_maintenance() from public; grant execute on function private.moto_lecture_fin_maintenance() to authenticated;
CREATE OR REPLACE FUNCTION private.moto_lecture_permis(p_titulaire uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select coalesce(private.moto_classe() in ('BM','ABM','LOGISTIQUE'), false)
      or (p_titulaire is not null and p_titulaire = auth.uid() and private.moto_classe() is not null)
$function$
;
revoke all on function private.moto_lecture_permis(uuid) from public; grant execute on function private.moto_lecture_permis(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_ma_zone()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select c.zone_code from public.aflp_clusters c where c.code = public.aflp_cluster_code(p.cluster)),
    (select z.code from public.aflp_zones z where public.aflp_norm(z.code) = public.aflp_norm(p.zone)
                                               or public.aflp_norm(z.label) = public.aflp_norm(p.zone) limit 1))
  from public.profils p where p.user_id = auth.uid() and p.actif limit 1
$function$
;
revoke all on function private.moto_ma_zone() from public; grant execute on function private.moto_ma_zone() to authenticated;
CREATE OR REPLACE FUNCTION private.moto_mission_lecture_id(p_mission uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select coalesce((select private.moto_mission_lecture(m) from public.moto_missions m where m.id = p_mission), false)
$function$
;
revoke all on function private.moto_mission_lecture_id(uuid) from public; grant execute on function private.moto_mission_lecture_id(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_mission_lecture(p_mission moto_missions)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select p_mission.conducteur_id = auth.uid()
      or (private.moto_classe() in ('LOGISTIQUE','ABM','BM','FINANCE','DIRECTION') and private.moto_dans_perimetre(p_mission.moto_id))
      or (private.moto_classe() = 'ZONE' and private.moto_peut_operer(p_mission.moto_id))   -- sa zone (ou sa propre moto)
$function$
;
revoke all on function private.moto_mission_lecture(moto_missions) from public; grant execute on function private.moto_mission_lecture(moto_missions) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_mission_photo_lecture(p_nom text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select private.moto_classe() in ('BM','ABM')
      or exists (select 1 from public.moto_mission_photos ph where ph.chemin = p_nom and private.moto_mission_lecture_id(ph.mission_id))
$function$
;
revoke all on function private.moto_mission_photo_lecture(text) from public; grant execute on function private.moto_mission_photo_lecture(text) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_mon_cluster()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ select public.aflp_cluster_code(p.cluster) from public.profils p where p.user_id = auth.uid() and p.actif limit 1 $function$
;
revoke all on function private.moto_mon_cluster() from public; grant execute on function private.moto_mon_cluster() to authenticated;
CREATE OR REPLACE FUNCTION private.moto_peut_deposer(p_nom text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
        v_tit uuid;
begin
  if v_classe is null then return false; end if;
  if (storage.foldername(p_nom))[1] = 'depenses' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and v_cat = auth.uid()::text;
  end if;
  if (storage.foldername(p_nom))[1] = 'finmaint' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and (storage.foldername(p_nom))[3] in ('devis','facture')
       and exists (select 1 from public.moto_motos where id = private.moto_uuid_ou_null((storage.foldername(p_nom))[2]));
  end if;
  if (storage.foldername(p_nom))[1] = 'permis' then
    v_tit := private.moto_uuid_ou_null(v_cat);
    if v_tit is null or not private.moto_chemin_permis_valide(p_nom, v_tit) or not private.moto_beneficiaire_valide(v_tit) then return false; end if;
    return v_tit = auth.uid() or v_classe in ('BM','ABM','LOGISTIQUE');
  end if;
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document','mission'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo','mission'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle','mission'); end if;
  return false;
end $function$
;
revoke all on function private.moto_peut_deposer(text) from public; grant execute on function private.moto_peut_deposer(text) to authenticated;
CREATE OR REPLACE FUNCTION private.moto_peut_operer(p_moto uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v text := private.moto_classe(); v_zone text;
begin
  if v in ('BM','ABM','LOGISTIQUE') then return exists (select 1 from public.moto_motos where id = p_moto); end if;
  if v = 'ZONE' then
    if private.moto_est_affectataire(p_moto) then return true; end if;
    select zone_code into v_zone from public.moto_motos where id = p_moto;
    return v_zone is not null and v_zone = private.moto_ma_zone();
  end if;
  if v = 'UNITE' then return private.moto_est_affectataire(p_moto); end if;
  return false;
end $function$
;
revoke all on function private.moto_peut_operer(uuid) from public;
CREATE OR REPLACE FUNCTION private.moto_uuid_ou_null(p text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid else null end
$function$
;
revoke all on function private.moto_uuid_ou_null(text) from public; grant execute on function private.moto_uuid_ou_null(text) to authenticated;
CREATE OR REPLACE FUNCTION private.ops_has_role(allowed text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- fonction_operationnelle n'accorde plus de droit : seul le role fait foi.
  select (select auth.uid()) is not null and exists (
    select 1 from public.profils p
    where p.user_id = (select auth.uid())
      and p.actif = true
      and p.role = any(allowed)
  );
$function$
;
revoke all on function private.ops_has_role(text[]) from public; grant execute on function private.ops_has_role(text[]) to authenticated;
CREATE OR REPLACE FUNCTION private.procurement_supplier_editor_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array['Branch Manager','Assistant Branch Manager','General Manager','GM','Procurement Officer',
               'LBA Purchase Officer','Supervisor','Coordination','Administrateur']
$function$
;
revoke all on function private.procurement_supplier_editor_roles() from public; grant execute on function private.procurement_supplier_editor_roles() to authenticated; grant execute on function private.procurement_supplier_editor_roles() to anon;
CREATE OR REPLACE FUNCTION private.producteur_gps_dans_mon_perimetre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.gps_lat is not distinct from old.gps_lat and new.gps_lng is not distinct from old.gps_lng then
    return new;
  end if;
  if not private.farmer_registry_can_access_village(old.village_id, old.rt_id) then
    raise exception 'Coordonnées GPS : producteur hors de votre périmètre.' using errcode = '42501';
  end if;
  return new;
end
$function$
;
revoke all on function private.producteur_gps_dans_mon_perimetre() from public;
CREATE OR REPLACE FUNCTION private.profil_auh_coherence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_code text; v_zone text;
begin
  if new.role is distinct from 'Assistant Unit Head' then return new; end if;
  select c.code, c.zone_code into v_code, v_zone
  from public.aflp_clusters c
  where c.code = public.farmer_registry_resolve_cluster_code(new.cluster) and c.active;
  if v_code is null then
    raise exception 'Assistant Unit Head : un cluster AFLP actif est obligatoire.' using errcode = '23514';
  end if;
  new.cluster := v_code;
  new.zone := v_zone;
  if coalesce(new.authority_level, 'CLUSTER') <> 'CLUSTER' then
    raise exception 'Assistant Unit Head : portée « % » refusée, seule la portée CLUSTER est admise.', new.authority_level
      using errcode = '42501';
  end if;
  new.authority_level := 'CLUSTER';
  if coalesce(new.permissions, '[]'::jsonb) not in ('[]'::jsonb, '{}'::jsonb) then
    raise exception 'Assistant Unit Head : aucune permission additionnelle n''est admise sur ce rôle.' using errcode = '42501';
  end if;
  if new.village_id is not null or new.rt_id is not null then
    raise exception 'Assistant Unit Head : rattachement à un village ou à un RT non admis (périmètre = cluster).' using errcode = '23514';
  end if;
  return new;
end $function$
;
revoke all on function private.profil_auh_coherence() from public;
CREATE OR REPLACE FUNCTION private.profil_cluster_canonique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_k text; v_code text;
begin
  if nullif(btrim(coalesce(new.cluster,'')),'') is null then new.cluster := null; return new; end if;
  if tg_op = 'UPDATE' and new.cluster is not distinct from old.cluster then return new; end if;
  v_k := public.farmer_registry_norm_text(new.cluster);
  select c.code into v_code from public.aflp_clusters c
   where public.farmer_registry_norm_text(c.code) = v_k or public.farmer_registry_norm_text(c.label) = v_k
      or exists (select 1 from unnest(coalesce(c.aliases, '{}'::text[])) a where public.farmer_registry_norm_text(a) = v_k)
   order by c.active desc limit 1;
  if v_code is null then
    raise exception 'Cluster « % » inconnu : choisissez un cluster du référentiel AFLP.', new.cluster using errcode = '23514';
  end if;
  new.cluster := v_code;
  return new;
end $function$
;
revoke all on function private.profil_cluster_canonique() from public;
CREATE OR REPLACE FUNCTION private.profils_garde_habilitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  -- Validation du cluster pour tout ecrivain (y compris procedure administrateur)
  if tg_op in ('INSERT','UPDATE') and new.cluster is not null and btrim(new.cluster) <> ''
     and (tg_op = 'INSERT' or new.cluster is distinct from old.cluster)
     and private.sacherie_norm_cluster(new.cluster) is null then
    raise exception 'Cluster « % » inconnu du référentiel AFLP', new.cluster using errcode = '23514';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.authority_level = 'GLOBAL'
     and (tg_op = 'INSERT' or new.authority_level is distinct from old.authority_level)
     and new.role in ('Unit Head','Storekeeper') and v_uid is not null then
    -- Portee globale explicite d'un poste normalement limite : autorisee au BM,
    -- tracee dans l'audit. Aucune condition supplementaire ici.
    null;
  end if;
  -- Procedure administrateur (service_role / SQL) : tracee par l'audit.
  if v_uid is null then return coalesce(new, old); end if;

  if not public.est_bm() then
    raise exception 'Seul le Branch Manager actif peut modifier les comptes et leurs habilitations' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.user_id = v_uid then raise exception 'Vous ne pouvez pas supprimer votre propre compte' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'Identifiant de compte non modifiable' using errcode = '42501'; end if;
    if old.user_id = v_uid and (new.role is distinct from old.role or new.actif is distinct from old.actif
        or new.authority_level is distinct from old.authority_level or new.permissions is distinct from old.permissions) then
      raise exception 'Vous ne pouvez pas modifier vos propres habilitations (rôle, statut, portée)' using errcode = '42501';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.role is distinct from old.role) and new.role in ('Branch Manager','General Manager','Finance Manager') then
    raise exception 'Le rôle « % » ne s''attribue pas depuis l''écran : procédure administrateur requise', new.role using errcode = '42501';
  end if;
  return new;
end
$function$
;
revoke all on function private.profils_garde_habilitations() from public;
CREATE OR REPLACE FUNCTION private.profils_journaliser()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_role text;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'derniere_connexion') = (to_jsonb(old) - 'derniere_connexion') then
    return new;
  end if;
  if auth.uid() is not null then
    select role into v_role from public.profils where user_id = auth.uid();
  else
    v_role := coalesce(auth.role(), 'procedure administrateur ('||current_user||')');
  end if;
  insert into public.rcn_proc_audit_central(table_name, record_id, action, before_data, after_data, actor_id, actor_role)
  values ('profils', coalesce(new.user_id, old.user_id)::text, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid(), v_role);
  return coalesce(new, old);
end
$function$
;
revoke all on function private.profils_journaliser() from public;
CREATE OR REPLACE FUNCTION private.sacherie_norm_cluster(p_valeur text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with k as (
    select regexp_replace(upper(public.unaccent(coalesce(p_valeur,''))),'[^A-Z0-9]','','g') as v
  )
  select c.code
  from public.aflp_clusters c, k
  where k.v <> ''
    and (
      regexp_replace(upper(public.unaccent(c.code)),'[^A-Z0-9]','','g') = k.v
      or regexp_replace(upper(public.unaccent(c.label)),'[^A-Z0-9]','','g') = k.v
      or exists (select 1 from unnest(c.aliases) a
                 where regexp_replace(upper(public.unaccent(a)),'[^A-Z0-9]','','g') = k.v)
    )
  order by c.code
  limit 1
$function$
;
revoke all on function private.sacherie_norm_cluster(text) from public;
CREATE OR REPLACE FUNCTION private.village_attribuer_prefixe_farmer_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_base text;
  v_candidat text;
  i int := 1;
begin
  if nullif(btrim(coalesce(new.farmer_code_prefix, '')), '') is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('fbms.villages.farmer_code_prefix'));
  v_base := left(public.farmer_registry_norm_text(coalesce(new.village, new.data -> 's1' ->> 'village', new.id)) || 'XXXX', 4);
  v_candidat := v_base;
  while exists (select 1 from public.villages v where v.farmer_code_prefix = v_candidat) loop
    i := i + 1;
    if i > 99 then
      raise exception 'Préfixe Farmer ID : plus de 99 villages commencent par %.', v_base;
    end if;
    v_candidat := v_base || lpad(i::text, 2, '0');
  end loop;
  new.farmer_code_prefix := v_candidat;
  return new;
end
$function$
;
revoke all on function private.village_attribuer_prefixe_farmer_id() from public;
CREATE OR REPLACE FUNCTION private.village_controle_nom()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_nom text; v_k text; v_hit text;
begin
  if coalesce(new.deleted, false) then return new; end if;
  v_nom := nullif(btrim(coalesce(new.village, new.data->'s1'->>'village', '')), '');
  if v_nom is null then raise exception 'Le nom du village est obligatoire.' using errcode = '23514'; end if;
  v_k := public.farmer_registry_norm_text(v_nom);
  if v_k = '' then raise exception 'Le nom du village est obligatoire.' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and public.farmer_registry_norm_text(coalesce(old.village, old.data->'s1'->>'village','')) = v_k
     and old.cluster_code is not distinct from new.cluster_code and not coalesce(old.deleted,false) then
    return new;
  end if;
  select v.id into v_hit from public.villages v
   where not v.deleted and v.id <> new.id and v.cluster_code is not distinct from new.cluster_code
     and public.farmer_registry_norm_text(coalesce(v.village, v.data->'s1'->>'village','')) = v_k
   limit 1;
  if v_hit is not null then
    raise exception 'Le village « % » existe déjà dans ce cluster. Utilisez la fiche existante.', v_nom using errcode = '23505';
  end if;
  return new;
end $function$
;
revoke all on function private.village_controle_nom() from public;
CREATE OR REPLACE FUNCTION public.rcn_est_actif()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from profils p where p.user_id = auth.uid() and coalesce(p.actif,false)=true);
$function$
;
revoke all on function rcn_est_actif() from public; grant execute on function rcn_est_actif() to authenticated;
CREATE OR REPLACE FUNCTION public.rcn_proc_active_role(allowed text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select exists(select 1 from public.profils p where p.user_id=(select auth.uid()) and p.actif is true and p.role=any(allowed))
$function$
;
revoke all on function rcn_proc_active_role(text[]) from public; grant execute on function rcn_proc_active_role(text[]) to authenticated;
CREATE OR REPLACE FUNCTION public.set_rt_cluster_and_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;
revoke all on function set_rt_cluster_and_code() from public; grant execute on function set_rt_cluster_and_code() to authenticated; grant execute on function set_rt_cluster_and_code() to anon;
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at := now(); new.updated_by := fbms_email(); return new; end $function$
;
revoke all on function touch_updated_at() from public; grant execute on function touch_updated_at() to authenticated; grant execute on function touch_updated_at() to anon;
CREATE OR REPLACE FUNCTION public.wms_can(p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text; v_allowed jsonb;
begin
  select role into v_role from public.profils where user_id = auth.uid() and coalesce(actif,false) limit 1;
  if v_role is null then return false; end if;
  v_allowed := public.wms_param('roleMatrix') -> p_action;
  if v_allowed is null then return false; end if;
  return v_allowed ? v_role;
end $function$
;
revoke all on function wms_can(text) from public; grant execute on function wms_can(text) to authenticated;
CREATE OR REPLACE FUNCTION public.wms_param(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select value from public.wms_parameters
  where key = p_key and active and effective_from <= now() and governance_status <> 'ARCHIVE'
  order by (governance_status = 'VALIDE') desc, effective_from desc, version desc limit 1;
$function$
;
revoke all on function wms_param(text) from public; grant execute on function wms_param(text) to authenticated;
