-- ANAGROCI Operations — Offline First FIELD BUYING
-- Queue serveur idempotente pour les opérations terrain synchronisées après une coupure réseau.
-- Les données métier restent dans leurs tables canoniques ; la table privée ne conserve que la preuve de synchronisation.

create table if not exists private.offline_sync_receipts (
  idempotency_key uuid primary key,
  client_operation_id uuid not null,
  operation_type text not null,
  user_id uuid not null,
  device_id uuid not null,
  campaign_id uuid not null references public.campaigns(id),
  request_hash text not null,
  result jsonb not null,
  created_at_client timestamptz,
  processed_at timestamptz not null default now()
);

create index if not exists offline_sync_receipts_user_idx
  on private.offline_sync_receipts(user_id, processed_at desc);
create index if not exists offline_sync_receipts_device_idx
  on private.offline_sync_receipts(device_id, processed_at desc);
create index if not exists offline_sync_receipts_campaign_idx
  on private.offline_sync_receipts(campaign_id, processed_at desc);

create or replace function private.offline_result_status(p_message text, p_state text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_message,'') ~* 'DOUBLON|déjà|already|duplicate|correspondance|receipt.*util|reçu.*util'
      then 'NEEDS_REVIEW'
    when p_state in ('23505','40001') then 'CONFLICT'
    when p_state in ('42501','23514','22023') then 'NEEDS_REVIEW'
    else 'FAILED'
  end;
$$;


create or replace function private.offline_sacherie_network_move(
  p_campaign_id uuid,
  p_client_operation_id text,
  p_flow text,
  p_cluster text,
  p_rt_id text,
  p_producteur_id text,
  p_qty integer,
  p_receiver_name text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $
declare
  v_uid uuid := auth.uid();
  v_flow text := upper(coalesce(p_flow,''));
  v_rt public.rt%rowtype;
  v_prod public.producteurs%rowtype;
  v_campaign text;
  v_from text; v_to text; v_from_state text := 'UTILISABLE'; v_to_state text := 'UTILISABLE';
  v_mid text; v_event text; v_available integer := 0;
  v_existing public.rcn_jute_movements%rowtype;
  v_cluster_loc text; v_rt_loc text; v_prod_loc text; v_hub_loc text;
  v_cluster_norm text := regexp_replace(upper(coalesce(p_cluster,'')),'[^A-Z0-9]','','g');
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
  select code into v_campaign from public.campaigns where id=p_campaign_id and status='OPEN';
  if v_campaign is null then raise exception 'Campagne fermée ou introuvable.' using errcode='42501'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Identifiant local obligatoire.' using errcode='22023'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantité invalide.' using errcode='23514'; end if;

  v_event := 'SACH-OFF:' || btrim(p_client_operation_id);
  select * into v_existing from public.rcn_jute_movements where event_key=v_event limit 1;
  if found then return to_jsonb(v_existing); end if;

  select * into v_rt from public.rt where id=p_rt_id and coalesce(deleted,false)=false limit 1;
  if not found then raise exception 'RT introuvable.' using errcode='23514'; end if;
  if regexp_replace(upper(coalesce(v_rt.cluster,'')),'[^A-Z0-9]','','g')<>v_cluster_norm
     and not (v_cluster_norm='DJEBONOUA' and regexp_replace(upper(coalesce(v_rt.cluster,'')),'[^A-Z0-9]','','g')='NDJEBONOUA')
  then raise exception 'RT hors du cluster sélectionné.' using errcode='42501'; end if;

  v_cluster_loc := public.sacherie_ops_resolve_cluster_location(p_cluster);
  if v_cluster_loc is null then raise exception 'Location cluster absente : initialisez la Sacherie.' using errcode='23514'; end if;
  v_rt_loc := public.sacherie_ct_location('RT',v_rt.cluster,v_rt.id,v_rt.nom,null,null);

  if v_flow in ('RT_TO_PRODUCTEUR','PRODUCTEUR_TO_RT','PRODUCTEUR_TO_HUB_FULL') then
    if coalesce(p_producteur_id,'')='' then raise exception 'Producteur obligatoire.' using errcode='23514'; end if;
    select * into v_prod from public.producteurs where id=p_producteur_id and coalesce(deleted,false)=false limit 1;
    if not found then raise exception 'Producteur introuvable.' using errcode='23514'; end if;
    if v_prod.rt_id is not null and v_prod.rt_id<>p_rt_id then raise exception 'Producteur rattaché à un autre RT.' using errcode='42501'; end if;
    v_prod_loc := public.sacherie_ct_location('PRODUCTEUR',v_rt.cluster,null,null,v_prod.id,coalesce(v_prod.nom,'Producteur'));
  end if;

  if v_flow='RT_TO_PRODUCTEUR' then v_from:=v_rt_loc; v_to:=v_prod_loc;
  elsif v_flow='PRODUCTEUR_TO_RT' then v_from:=v_prod_loc; v_to:=v_rt_loc;
  elsif v_flow='RT_TO_CLUSTER' then v_from:=v_rt_loc; v_to:=v_cluster_loc;
  elsif v_flow='PRODUCTEUR_TO_HUB_FULL' then
    v_hub_loc:=public.sacherie_ct_location('HUB',v_rt.cluster,null,null,null,null);
    v_from:=v_prod_loc; v_to:=v_hub_loc; v_to_state:='PLEIN';
  else raise exception 'Flux terrain non supporté.' using errcode='22023';
  end if;

  perform public.sacherie_ct_assert_location_access(v_from,true);
  perform public.sacherie_ct_assert_location_access(v_to,true);
  select coalesce(sum(qty),0)::integer into v_available from public.rcn_jute_v_stock where location_code=v_from and state=v_from_state;
  if v_available<p_qty then raise exception 'Stock sacs insuffisant à l’origine. Disponible: %',v_available using errcode='23514'; end if;

  v_mid := 'JUT-OFF-' || substr(md5(v_event),1,20);
  insert into public.rcn_jute_movements(
    id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,
    source_type,source_id,reference,note,movement_at,owner_type,created_by,campaign,campaign_id,cluster,rt_id,producteur_id
  ) values (
    v_mid,v_event,'TRANSFERT','INTERNE',p_qty,v_from,v_to,v_from_state,v_to_state,
    'SACHERIE_OFFLINE',p_client_operation_id,p_client_operation_id,
    trim(concat_ws(' | ',nullif(p_note,''),case when coalesce(p_receiver_name,'')<>'' then 'Réceptionnaire: '||p_receiver_name end)),
    now(),'ANAGROCI',v_uid,v_campaign,p_campaign_id,v_rt.cluster,v_rt.id,nullif(p_producteur_id,'')
  ) returning * into v_existing;

  return to_jsonb(v_existing);
exception when unique_violation then
  select * into v_existing from public.rcn_jute_movements where event_key=v_event limit 1;
  if found then return to_jsonb(v_existing); end if;
  raise;
end;
$;

create or replace function public.offline_sync_batch(p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profils%rowtype;
  v_op jsonb;
  v_payload jsonb;
  v_row jsonb;
  v_type text;
  v_key uuid;
  v_client uuid;
  v_device uuid;
  v_campaign uuid;
  v_campaign_code text;
  v_hash text;
  v_existing private.offline_sync_receipts%rowtype;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_pid text;
  v_farmer_code text;
  v_purchase uuid;
  v_local_id text;
  v_msg text;
  v_state text;
  v_coop_result jsonb;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profils
  where user_id = v_uid and actif = true
  limit 1;

  if v_profile.user_id is null then
    raise exception 'Profil actif requis.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_operations,'[]'::jsonb)) <> 'array' then
    raise exception 'Lot de synchronisation invalide.' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_operations,'[]'::jsonb)) > 50 then
    raise exception '50 opérations maximum par lot.' using errcode = '22023';
  end if;

  for v_op in
    select value from jsonb_array_elements(coalesce(p_operations,'[]'::jsonb))
  loop
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

      select * into v_existing
      from private.offline_sync_receipts
      where idempotency_key = v_key;

      if found then
        if v_existing.request_hash <> v_hash then
          v_result := jsonb_build_object(
            'idempotency_key',v_key,'client_operation_id',v_client,'status','CONFLICT',
            'message','Cette clé de synchronisation a déjà été utilisée avec un contenu différent.'
          );
        else
          v_result := v_existing.result;
        end if;
        v_results := v_results || jsonb_build_array(v_result);
        continue;
      end if;

      select code into v_campaign_code
      from public.campaigns
      where id = v_campaign and status = 'OPEN';

      if v_campaign_code is null then
        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,'status','NEEDS_REVIEW',
          'message','Cette opération appartient à une campagne qui n’est plus ouverte.'
        );
        insert into private.offline_sync_receipts
          (idempotency_key,client_operation_id,operation_type,user_id,device_id,campaign_id,request_hash,result,created_at_client)
        values
          (v_key,v_client,v_type,v_uid,v_device,v_campaign,v_hash,v_result,nullif(v_op->>'created_at_client','')::timestamptz);
        v_results := v_results || jsonb_build_array(v_result);
        continue;
      end if;

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
        insert into public.producteurs(
          id,data,nom,prenoms,sexe,birth_year,telephone,telephone_alt,
          id_document_type,id_document_number,village_id,rt_id,statut,
          possible_duplicate,review_required,review_reason,created_by
        )
        values(
          v_pid,
          coalesce(v_row->'data','{}'::jsonb) || jsonb_build_object(
            'source','OPERATIONS_FIELD_BUYING_OFFLINE',
            'clientOperationId',v_client::text,
            'deviceId',v_device::text
          ),
          upper(btrim(v_row->>'nom')),
          nullif(upper(btrim(coalesce(v_row->>'prenoms',''))),''),
          nullif(v_row->>'sexe',''),
          nullif(v_row->>'birth_year','')::int,
          nullif(regexp_replace(coalesce(v_row->>'telephone',''),'[^0-9]','','g'),''),
          nullif(regexp_replace(coalesce(v_row->>'telephone_alt',''),'[^0-9]','','g'),''),
          nullif(v_row->>'id_document_type',''),
          nullif(v_row->>'id_document_number',''),
          v_row->>'village_id',
          nullif(v_row->>'rt_id',''),
          'Identifié',
          false,false,null,
          public.fbms_email()
        )
        returning code into v_farmer_code;

        if coalesce(v_payload->'plot','{}'::jsonb) <> '{}'::jsonb and
           (nullif(v_payload->'plot'->>'declared_area','') is not null or
            nullif(v_payload->'plot'->>'latitude','') is not null or
            nullif(v_payload->'plot'->>'longitude','') is not null) then
          if (nullif(v_payload->'plot'->>'latitude','') is null) <>
             (nullif(v_payload->'plot'->>'longitude','') is null) then
            raise exception 'Parcelle : latitude et longitude doivent être renseignées ensemble.' using errcode = '23514';
          end if;
          insert into public.farmer_plots(
            id,producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,
            gps_status,gps_captured_at,area_source,evidence_level,status
          ) values (
            gen_random_uuid(),v_pid,v_row->>'village_id',
            coalesce(nullif(v_payload->'plot'->>'local_name',''),'PARCELLE PRINCIPALE'),
            nullif(v_payload->'plot'->>'declared_area','')::numeric,'HA',
            nullif(v_payload->'plot'->>'latitude','')::numeric,
            nullif(v_payload->'plot'->>'longitude','')::numeric,
            'NOT_MAPPED',
            null,
            'DECLARED','DECLARED','ACTIVE'
          );
        end if;

        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,'status','SYNCED',
          'local_id',v_payload->>'local_id','server_id',v_pid,'farmer_id',v_farmer_code
        );

      elsif v_type = 'COOP_FARMER_ENROLL' then
        v_row := coalesce(v_payload->'candidate','{}'::jsonb)
          || jsonb_build_object('campaign',v_campaign_code,'source','FORMULAIRE_OFFLINE');
        v_coop_result := public.aflp_coop_enroll_producer(v_row);

        if upper(coalesce(v_coop_result->>'status','')) = 'EN_VERIFICATION' then
          v_result := jsonb_build_object(
            'idempotency_key',v_key,'client_operation_id',v_client,'status','NEEDS_REVIEW',
            'local_id',v_payload->>'local_id',
            'message','Le serveur a trouvé une correspondance : vérification requise.',
            'review_id',v_coop_result->>'review_id'
          );
        else
          v_result := jsonb_build_object(
            'idempotency_key',v_key,'client_operation_id',v_client,'status','SYNCED',
            'local_id',v_payload->>'local_id',
            'server_id',v_coop_result->>'producer_id',
            'farmer_id',v_coop_result->>'farmer_id',
            'membership_id',v_coop_result->>'membership_id'
          );
        end if;

      elsif v_type = 'COOP_FARMER_LINK' then
        v_row := coalesce(v_payload->'member','{}'::jsonb)
          || jsonb_build_object('campaign',v_campaign_code,'source','ASSOCIATION_OFFLINE');
        v_coop_result := public.aflp_coop_add_member(v_row);
        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,'status','SYNCED',
          'producer_id',v_row->>'producer_id',
          'farmer_id',v_coop_result->>'farmer_id',
          'membership',v_coop_result->'membership'
        );

      elsif v_type = 'FIELD_PURCHASE_CREATE' then
        if not public.est_actif() then
          raise exception 'Compte utilisateur inactif.' using errcode = '42501';
        end if;

        v_row := coalesce(v_payload->'row','{}'::jsonb);
        v_local_id := nullif(v_row->>'local_id','');
        if v_local_id is null then
          raise exception 'Identifiant local de l’achat obligatoire.' using errcode = '23514';
        end if;

        select id into v_purchase from public.achats where local_id = v_local_id limit 1;
        if v_purchase is null then
          insert into public.achats(
            local_id,campaign,campaign_id,date,cluster,village_id,village_nom,rt_id,rt_nom,
            producteur_id,producteur_code,producteur_nom,producteur_tel,
            poids_brut,tare,poids_net,prix_kg,montant,nb_sacs,mode_paiement,weight_source,
            numero_recu,humidite,kor,observation,prix_hors_bareme,motif_prix,commission_rt,
            qualite_statut,statut_validation,refinancable,stock_libere,stock_statut,
            saisie_mode,created_by,created_by_nom
          )
          values(
            v_local_id,v_campaign_code,v_campaign,
            (v_row->>'date')::date,
            nullif(v_row->>'cluster',''),
            nullif(v_row->>'village_id',''),
            nullif(v_row->>'village_nom',''),
            nullif(v_row->>'rt_id',''),
            nullif(v_row->>'rt_nom',''),
            nullif(v_row->>'producteur_id',''),
            nullif(v_row->>'producteur_code',''),
            nullif(v_row->>'producteur_nom',''),
            nullif(v_row->>'producteur_tel',''),
            nullif(v_row->>'poids_brut','')::numeric,
            coalesce(nullif(v_row->>'tare','')::numeric,0),
            (v_row->>'poids_net')::numeric,
            (v_row->>'prix_kg')::numeric,
            (v_row->>'montant')::numeric,
            nullif(v_row->>'nb_sacs','')::int,
            nullif(v_row->>'mode_paiement',''),
            nullif(v_row->>'weight_source',''),
            nullif(v_row->>'numero_recu',''),
            nullif(v_row->>'humidite','')::numeric,
            nullif(v_row->>'kor','')::numeric,
            nullif(v_row->>'observation',''),
            coalesce((v_row->>'prix_hors_bareme')::boolean,false),
            nullif(v_row->>'motif_prix',''),
            nullif(v_row->>'commission_rt','')::numeric,
            nullif(v_row->>'qualite_statut',''),
            nullif(v_row->>'statut_validation',''),
            coalesce((v_row->>'refinancable')::boolean,false),
            coalesce((v_row->>'stock_libere')::boolean,false),
            nullif(v_row->>'stock_statut',''),
            'OPERATIONS_FIELD_BUYING_OFFLINE',
            v_uid,
            v_profile.nom
          )
          returning id into v_purchase;
        end if;

        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,'status','SYNCED',
          'purchase_id',v_purchase,'local_id',v_local_id
        );

      elsif v_type = 'BAG_MOVEMENT_CREATE' then
        v_row := coalesce(v_payload->'row','{}'::jsonb);
        v_coop_result := private.offline_sacherie_network_move(
          v_campaign,
          coalesce(nullif(v_row->>'client_operation_id',''),v_client::text),
          v_row->>'flow',
          v_row->>'cluster',
          v_row->>'rt_id',
          nullif(v_row->>'producteur_id',''),
          nullif(v_row->>'qty','')::integer,
          nullif(v_row->>'receiver_name',''),
          nullif(v_row->>'note','')
        );
        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,'status','SYNCED',
          'movement_id',v_coop_result->>'id'
        );

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
        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,'status','SYNCED',
          'server_id',v_pid,'farmer_id',v_farmer_code
        );

      else
        raise exception 'Type d’opération offline non supporté : %',v_type using errcode = '22023';
      end if;

      insert into private.offline_sync_receipts(
        idempotency_key,client_operation_id,operation_type,user_id,device_id,campaign_id,
        request_hash,result,created_at_client
      )
      values(
        v_key,v_client,v_type,v_uid,v_device,v_campaign,v_hash,v_result,
        nullif(v_op->>'created_at_client','')::timestamptz
      );

      v_results := v_results || jsonb_build_array(v_result);

    exception
      when unique_violation then
        select * into v_existing from private.offline_sync_receipts where idempotency_key = v_key;
        if found and v_existing.request_hash = v_hash then
          v_results := v_results || jsonb_build_array(v_existing.result);
        else
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'idempotency_key',v_key,'client_operation_id',v_client,'status','CONFLICT',
            'message','Cette opération semble déjà exister sur le serveur.'
          ));
        end if;
      when others then
        v_msg := sqlerrm; v_state := sqlstate;
        v_result := jsonb_build_object(
          'idempotency_key',v_key,'client_operation_id',v_client,
          'status',private.offline_result_status(v_msg,v_state),
          'message',v_msg,'sqlstate',v_state
        );
        if private.offline_result_status(v_msg,v_state) in ('CONFLICT','NEEDS_REVIEW') then
          begin
            insert into private.offline_sync_receipts(
              idempotency_key,client_operation_id,operation_type,user_id,device_id,campaign_id,
              request_hash,result,created_at_client
            )
            values(
              v_key,v_client,coalesce(v_type,'UNKNOWN'),v_uid,v_device,v_campaign,v_hash,v_result,
              nullif(v_op->>'created_at_client','')::timestamptz
            )
            on conflict (idempotency_key) do nothing;
          exception when others then null;
          end;
        end if;
        v_results := v_results || jsonb_build_array(v_result);
    end;
  end loop;

  return jsonb_build_object('results',v_results,'processed_at',now());
end;
$$;

revoke all on function public.offline_sync_batch(jsonb) from public;
revoke all on function public.offline_sync_batch(jsonb) from anon;
grant execute on function public.offline_sync_batch(jsonb) to authenticated;
