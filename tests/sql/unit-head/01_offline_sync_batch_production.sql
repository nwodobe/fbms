-- Copie exacte de public.offline_sync_batch (production, 2026-10-16), branches
-- FARMER_ENROLL et FIELD_GPS_UPDATE. Les branches coopératives, achats et sacherie
-- dépendent d'objets absents de ce banc et renvoient ici « non supporté ».
CREATE OR REPLACE FUNCTION private.offline_result_status(p_message text, p_state text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $f$
  select case
    when coalesce(p_message,'') ~* 'DOUBLON|déjà|already|duplicate|correspondance|receipt.*util|reçu.*util'
      then 'NEEDS_REVIEW'
    when p_state in ('23505','40001') then 'CONFLICT'
    when p_state in ('42501','23514','22023') then 'NEEDS_REVIEW'
    else 'FAILED'
  end;
$f$;

CREATE OR REPLACE FUNCTION public.offline_sync_batch(p_operations jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private', 'pg_temp' AS $f$
declare
  v_uid uuid := auth.uid();
  v_profile public.profils%rowtype;
  v_op jsonb; v_payload jsonb; v_row jsonb; v_type text;
  v_key uuid; v_client uuid; v_device uuid; v_campaign uuid; v_campaign_code text; v_hash text;
  v_existing private.offline_sync_receipts%rowtype;
  v_result jsonb; v_results jsonb := '[]'::jsonb;
  v_pid text; v_farmer_code text; v_msg text; v_state text;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into v_profile from public.profils where user_id = v_uid and actif = true limit 1;
  if v_profile.user_id is null then raise exception 'Profil actif requis.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_operations,'[]'::jsonb)) <> 'array' then
    raise exception 'Lot de synchronisation invalide.' using errcode = '22023';
  end if;
  for v_op in select value from jsonb_array_elements(coalesce(p_operations,'[]'::jsonb)) loop
    begin
      v_key := nullif(v_op->>'idempotency_key','')::uuid;
      v_client := nullif(v_op->>'client_operation_id','')::uuid;
      v_device := nullif(v_op->>'device_id','')::uuid;
      v_campaign := nullif(v_op->>'campaign_id','')::uuid;
      v_type := upper(coalesce(nullif(v_op->>'operation_type',''),''));
      v_payload := coalesce(v_op->'payload','{}'::jsonb);
      v_hash := md5(jsonb_strip_nulls(v_op - 'created_at_client')::text);
      if v_key is null or v_client is null or v_device is null or v_campaign is null or v_type = '' then
        raise exception 'Métadonnées offline incomplètes.' using errcode = '22023';
      end if;
      select code into v_campaign_code from public.campaigns where id = v_campaign and status = 'OPEN';

      if v_type = 'FARMER_ENROLL' then
        if not public.peut_ecrire_referentiel_terrain() then
          raise exception 'Vous n’avez plus le droit d’enrôler un producteur.' using errcode = '42501';
        end if;
        v_row := coalesce(v_payload->'row','{}'::jsonb);
        if nullif(btrim(v_row->>'nom'),'') is null or nullif(v_row->>'village_id','') is null then
          raise exception 'Nom et village sont obligatoires.' using errcode = '23514';
        end if;
        if not private.farmer_registry_can_access_village(v_row->>'village_id', nullif(v_row->>'rt_id','')) then
          raise exception 'Village ou RT hors de votre périmètre.' using errcode = '42501';
        end if;
        v_pid := 'fb-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS') || '-' || substr(md5(random()::text),1,6);
        insert into public.producteurs(id,data,nom,village_id,rt_id,statut,created_by)
        values(v_pid, coalesce(v_row->'data','{}'::jsonb), upper(btrim(v_row->>'nom')), v_row->>'village_id',
               nullif(v_row->>'rt_id',''), 'Identifié', public.fbms_email())
        returning code into v_farmer_code;
        v_result := jsonb_build_object('status','SYNCED','server_id',v_pid,'farmer_id',v_farmer_code);

      elsif v_type = 'FIELD_GPS_UPDATE' then
        if not public.peut_modifier_rt_producteur() then
          raise exception 'Modification producteur non autorisée.' using errcode = '42501';
        end if;
        v_row := coalesce(v_payload->'row','{}'::jsonb);
        update public.producteurs
        set gps_lat = nullif(v_row->>'gps_lat','')::numeric,
            gps_lng = nullif(v_row->>'gps_lng','')::numeric
        where id = v_row->>'producteur_id'
        returning id,code into v_pid,v_farmer_code;
        if v_pid is null then raise exception 'Producteur introuvable.'; end if;
        v_result := jsonb_build_object('status','SYNCED','server_id',v_pid,'farmer_id',v_farmer_code);
      else
        raise exception 'Type d’opération offline non supporté : %',v_type using errcode = '22023';
      end if;
      v_results := v_results || jsonb_build_array(v_result);
    exception when others then
      v_msg := sqlerrm; v_state := sqlstate;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status',private.offline_result_status(v_msg,v_state),'message',v_msg,'sqlstate',v_state));
    end;
  end loop;
  return jsonb_build_object('results',v_results,'processed_at',now());
end;
$f$;
grant execute on function public.offline_sync_batch(jsonb) to authenticated;
