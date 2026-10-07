-- =============================================================================
-- AFLP 2027 · Coopératives — 4/5 : fonctions métier (RPC)
-- -----------------------------------------------------------------------------
-- Toutes les écritures composites passent par ces fonctions : une transaction,
-- des contrôles serveur, l'audit automatique des tables. Les fonctions sont
-- SECURITY DEFINER mais revérifient explicitement rôle ET périmètre
-- (private.aflp_coop_can_edit / farmer_registry_can_access_village) : elles ne
-- donnent aucun droit que la RLS refuserait.
-- =============================================================================
begin;

create or replace function private.aflp_require_edit(p_coop uuid) returns void
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.est_actif() then raise exception 'Session inactive' using errcode = '42501'; end if;
  if not private.aflp_coop_can_edit(p_coop) then
    raise exception 'Droit insuffisant sur cette coopérative (rôle ou périmètre)' using errcode = '42501';
  end if;
end $$;

create or replace function private.aflp_txt(p jsonb, k text) returns text
language sql immutable as $$ select nullif(btrim(p->>k), '') $$;
create or replace function private.aflp_numv(p jsonb, k text) returns numeric
language sql immutable as $$ select nullif(btrim(p->>k), '')::numeric $$;

-- ------------------------------------------------- créer / modifier une coopérative
create or replace function public.aflp_coop_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_id uuid := nullif(p->>'id','')::uuid; r public.aflp_cooperatives; v_campaign text;
  v_pres text; v_pres_phone text;
begin
  perform private.aflp_require_edit(v_id);
  v_campaign := coalesce(private.aflp_txt(p,'campaign'), '2027');
  if private.aflp_txt(p,'name') is null then raise exception 'Le nom officiel de la coopérative est obligatoire'; end if;
  if private.aflp_txt(p,'phone') is not null and regexp_replace(p->>'phone','[^0-9]','','g') !~ '^0[0-9]{9}$' then
    raise exception 'Téléphone de la coopérative : 10 chiffres attendus';
  end if;
  if v_id is null then
    if exists (select 1 from public.aflp_cooperatives where not archived
               and public.farmer_registry_norm_text(name) = public.farmer_registry_norm_text(p->>'name')) then
      raise exception 'Une coopérative active porte déjà ce nom';
    end if;
    insert into public.aflp_cooperatives(code, name, acronym, legal_name, org_type, registration_no, approval_no, rccm,
      creation_date, head_office, address, region, departement, sous_prefecture, locality, locality_village_id,
      gps_lat, gps_lng, cluster_code, phone, email, declared_members, aflp_status, compliance_status,
      producer_registry_status, aflp_join_date, notes, is_qa)
    values (private.aflp_txt(p,'code'), p->>'name', private.aflp_txt(p,'acronym'), private.aflp_txt(p,'legal_name'),
      coalesce(private.aflp_txt(p,'org_type'),'SCOOPS'), private.aflp_txt(p,'registration_no'), private.aflp_txt(p,'approval_no'),
      private.aflp_txt(p,'rccm'), nullif(p->>'creation_date','')::date, private.aflp_txt(p,'head_office'), private.aflp_txt(p,'address'),
      coalesce(private.aflp_txt(p,'region'),'GBEKE'), private.aflp_txt(p,'departement'), private.aflp_txt(p,'sous_prefecture'),
      private.aflp_txt(p,'locality'), private.aflp_txt(p,'locality_village_id'), private.aflp_numv(p,'gps_lat'), private.aflp_numv(p,'gps_lng'),
      private.aflp_txt(p,'cluster_code'), nullif(regexp_replace(coalesce(p->>'phone',''),'[^0-9]','','g'),''), private.aflp_txt(p,'email'),
      private.aflp_numv(p,'declared_members')::int, coalesce(private.aflp_txt(p,'aflp_status'),'PROSPECT'),
      coalesce(private.aflp_txt(p,'compliance_status'),'NON_EVALUE'), coalesce(private.aflp_txt(p,'producer_registry_status'),'NON_FOURNI'),
      nullif(p->>'aflp_join_date','')::date, private.aflp_txt(p,'notes'), coalesce((p->>'is_qa')::boolean,false))
    returning * into r;
  else
    select * into r from public.aflp_cooperatives where id = v_id for update;
    if r.id is null then raise exception 'Coopérative introuvable'; end if;
    if p ? 'row_version' and (p->>'row_version')::int <> r.row_version then
      raise exception 'Fiche modifiée entre-temps par un autre utilisateur : rechargez avant d''enregistrer';
    end if;
    update public.aflp_cooperatives set
      -- Mise à jour partielle : seules les clés présentes dans le payload sont modifiées.
      name = coalesce(nullif(btrim(p->>'name'),''), name),
      acronym = case when p ? 'acronym' then private.aflp_txt(p,'acronym') else acronym end,
      legal_name = case when p ? 'legal_name' then private.aflp_txt(p,'legal_name') else legal_name end,
      org_type = case when p ? 'org_type' then coalesce(private.aflp_txt(p,'org_type'), org_type) else org_type end,
      registration_no = case when p ? 'registration_no' then private.aflp_txt(p,'registration_no') else registration_no end,
      approval_no = case when p ? 'approval_no' then private.aflp_txt(p,'approval_no') else approval_no end,
      rccm = case when p ? 'rccm' then private.aflp_txt(p,'rccm') else rccm end,
      creation_date = case when p ? 'creation_date' then nullif(p->>'creation_date','')::date else creation_date end,
      head_office = case when p ? 'head_office' then private.aflp_txt(p,'head_office') else head_office end,
      address = case when p ? 'address' then private.aflp_txt(p,'address') else address end,
      region = case when p ? 'region' then coalesce(private.aflp_txt(p,'region'), region) else region end,
      departement = case when p ? 'departement' then private.aflp_txt(p,'departement') else departement end,
      sous_prefecture = case when p ? 'sous_prefecture' then private.aflp_txt(p,'sous_prefecture') else sous_prefecture end,
      locality = case when p ? 'locality' then private.aflp_txt(p,'locality') else locality end,
      locality_village_id = case when p ? 'locality_village_id' then private.aflp_txt(p,'locality_village_id') else locality_village_id end,
      gps_lat = case when p ? 'gps_lat' then private.aflp_numv(p,'gps_lat') else gps_lat end,
      gps_lng = case when p ? 'gps_lng' then private.aflp_numv(p,'gps_lng') else gps_lng end,
      cluster_code = case when p ? 'cluster_code' then private.aflp_txt(p,'cluster_code') else cluster_code end,
      phone = case when p ? 'phone' then nullif(regexp_replace(coalesce(p->>'phone',''),'[^0-9]','','g'),'') else phone end,
      email = case when p ? 'email' then private.aflp_txt(p,'email') else email end,
      declared_members = case when p ? 'declared_members' then private.aflp_numv(p,'declared_members')::int else declared_members end,
      compliance_status = case when p ? 'compliance_status' then coalesce(private.aflp_txt(p,'compliance_status'), compliance_status) else compliance_status end,
      producer_registry_status = case when p ? 'producer_registry_status' then coalesce(private.aflp_txt(p,'producer_registry_status'), producer_registry_status) else producer_registry_status end,
      aflp_join_date = case when p ? 'aflp_join_date' then nullif(p->>'aflp_join_date','')::date else aflp_join_date end,
      notes = case when p ? 'notes' then private.aflp_txt(p,'notes') else notes end
    where id = v_id returning * into r;
  end if;

  -- paramètres de campagne
  insert into public.aflp_coop_campaigns(cooperative_id, campaign, payment_model, declared_potential_mt, secured_volume_mt,
     zone_head_name, unit_head_name, referent_rt_id, destination_warehouse_id)
  values (r.id, v_campaign, coalesce(private.aflp_txt(p,'payment_model'),'INDIVIDUAL_FARMER'), private.aflp_numv(p,'declared_potential_mt'),
     private.aflp_numv(p,'secured_volume_mt'), private.aflp_txt(p,'zone_head_name'), private.aflp_txt(p,'unit_head_name'),
     private.aflp_txt(p,'referent_rt_id'), nullif(p->>'destination_warehouse_id','')::uuid)
  -- Mise à jour partielle : une clé absente du payload ne remet JAMAIS une valeur à NULL.
  on conflict (cooperative_id, campaign) do update set
     payment_model = case when p ? 'payment_model' then excluded.payment_model else aflp_coop_campaigns.payment_model end,
     declared_potential_mt = case when p ? 'declared_potential_mt' then excluded.declared_potential_mt else aflp_coop_campaigns.declared_potential_mt end,
     secured_volume_mt = case when p ? 'secured_volume_mt' then excluded.secured_volume_mt else aflp_coop_campaigns.secured_volume_mt end,
     zone_head_name = case when p ? 'zone_head_name' then excluded.zone_head_name else aflp_coop_campaigns.zone_head_name end,
     unit_head_name = case when p ? 'unit_head_name' then excluded.unit_head_name else aflp_coop_campaigns.unit_head_name end,
     referent_rt_id = case when p ? 'referent_rt_id' then excluded.referent_rt_id else aflp_coop_campaigns.referent_rt_id end,
     destination_warehouse_id = case when p ? 'destination_warehouse_id' then excluded.destination_warehouse_id else aflp_coop_campaigns.destination_warehouse_id end;
  if p ? 'target_mt' then
    update public.aflp_coop_campaigns set target_mt = private.aflp_numv(p,'target_mt')
     where cooperative_id = r.id and campaign = v_campaign and target_mt is distinct from private.aflp_numv(p,'target_mt');
  end if;

  -- président (contact, jamais RT)
  v_pres := private.aflp_txt(p,'president_name');
  v_pres_phone := nullif(regexp_replace(coalesce(p->>'president_phone',''),'[^0-9]','','g'),'');
  if v_pres is not null then
    if v_pres_phone is not null and v_pres_phone !~ '^0[0-9]{9}$' then raise exception 'Téléphone du président : 10 chiffres attendus'; end if;
    update public.aflp_coop_contacts set full_name = v_pres, phone = v_pres_phone
     where cooperative_id = r.id and role = 'PRESIDENT' and active;
    if not found then
      insert into public.aflp_coop_contacts(cooperative_id, role, full_name, phone, is_primary)
      values (r.id, 'PRESIDENT', v_pres, v_pres_phone, true);
    end if;
  end if;
  return to_jsonb(r);
end $$;

-- --------------------------------------------- statut / archivage (direction)
create or replace function public.aflp_coop_set_status(p_coop uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r public.aflp_cooperatives;
begin
  perform private.aflp_require_edit(p_coop);
  if p_status in ('SUSPENDUE','SORTIE') and nullif(btrim(p_reason),'') is null then
    raise exception 'Motif obligatoire pour suspendre ou sortir une coopérative du programme';
  end if;
  update public.aflp_cooperatives set aflp_status = p_status, status_reason = nullif(btrim(p_reason),''),
    aflp_join_date = case when p_status = 'ACTIVE' and aflp_join_date is null then current_date else aflp_join_date end
   where id = p_coop returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.aflp_coop_archive(p_coop uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r public.aflp_cooperatives; v_used jsonb;
begin
  perform private.aflp_require_edit(p_coop);
  if nullif(btrim(p_reason),'') is null then raise exception 'Motif d''archivage obligatoire'; end if;
  v_used := jsonb_build_object(
    'membres_ouverts', (select count(*) from public.aflp_coop_memberships where cooperative_id = p_coop and status <> 'ENDED'),
    'achats', (select count(*) from public.achats where cooperative_id = p_coop),
    'livraisons', (select count(*) from public.aflp_coop_deliveries where cooperative_id = p_coop and status <> 'ANNULEE'));
  update public.aflp_cooperatives set archived = true, archived_at = now(), archived_by = auth.uid(),
    archive_reason = btrim(p_reason), aflp_status = case when aflp_status in ('ACTIVE','APPROUVEE') then 'SORTIE' else aflp_status end
   where id = p_coop returning * into r;
  insert into public.aflp_coop_audit(cooperative_id, entity, entity_id, operation, after_data, note, actor_email, actor_role)
  values (p_coop, 'aflp_cooperatives', p_coop::text, 'ARCHIVE', v_used, btrim(p_reason), public.fbms_email(), public.fbms_role());
  -- l'historique (affiliations, achats, livraisons, lots) reste intact et traçable
  return to_jsonb(r) || jsonb_build_object('usage_conserve', v_used);
end $$;

-- ---------------------------------------- recherche de doublons (unitaire et en masse)
-- Entrée : tableau de {idx, farmer_id, nom, prenoms, telephone, village_id}
-- Sortie : une ligne par correspondance, la plus forte d'abord.
create or replace function public.aflp_coop_match_producers(p_rows jsonb)
returns table(idx int, producer_id text, farmer_id text, nom text, prenoms text, village_id text, village_nom text,
              telephone_masque text, reason text, confidence int, coop_codes text)
language sql stable security definer set search_path = public, private as $$
  with r as (
    select (x->>'idx')::int idx, upper(nullif(btrim(x->>'farmer_id'),'')) fid,
           public.farmer_registry_norm_text(coalesce(x->>'nom','')) nom_n,
           public.farmer_registry_norm_text(coalesce(x->>'nom','') || ' ' || coalesce(x->>'prenoms','')) full_n,
           public.farmer_registry_norm_phone(x->>'telephone') tel, nullif(x->>'village_id','') vid
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
  ), hits as (
    select r.idx, p.id, 'FARMER_ID'::text reason, 100 conf from r join public.producteurs p on upper(p.code) = r.fid
     where r.fid is not null and not p.deleted
    union all
    select r.idx, p.id, case when p.village_id = r.vid then 'TELEPHONE_MEME_VILLAGE' else 'TELEPHONE' end,
           case when p.village_id = r.vid then 95 else 85 end
      from r join public.producteurs p on public.farmer_registry_norm_phone(p.telephone) = r.tel
     where r.tel <> '' and length(r.tel) >= 8 and not p.deleted
    union all
    select r.idx, p.id, 'NOM_PRENOMS_MEME_VILLAGE', 75
      from r join public.producteurs p on p.village_id = r.vid
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = r.full_n
     where r.vid is not null and r.full_n <> '' and not p.deleted
    union all
    select r.idx, p.id, 'NOM_MEME_VILLAGE', 60
      from r join public.producteurs p on p.village_id = r.vid and public.farmer_registry_norm_text(p.nom) = r.nom_n
     where r.vid is not null and r.nom_n <> '' and not p.deleted
  ), best as (
    select distinct on (h.idx, h.id) h.* from hits h order by h.idx, h.id, h.conf desc
  )
  select b.idx, p.id, p.code, p.nom, p.prenoms, p.village_id, p.village_nom,
         case when p.telephone is null then null else '******' || right(regexp_replace(p.telephone,'[^0-9]','','g'), 4) end,
         b.reason, b.conf,
         (select string_agg(distinct c.code, ', ') from public.aflp_coop_memberships m join public.aflp_cooperatives c on c.id = m.cooperative_id
           where m.producer_id = p.id and m.status <> 'ENDED')
  from best b join public.producteurs p on p.id = b.id
  where public.est_actif() and private.farmer_registry_can_access_producteur(p.id)
  order by b.idx, b.conf desc;
$$;

-- -------------------------------------------- ajouter un membre (existant ou nouveau)
-- p = {cooperative_id, campaign, producer_id?  (associer un existant)
--      | nom, prenoms, telephone, village_id, sexe, birth_year (nouveau),
--      member_number, section_id, is_primary, verified, verification_method,
--      followup_rt_id, confirm_new (true après revue des doublons), confirm_reason, source}
create or replace function public.aflp_coop_add_member(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_coop uuid := (p->>'cooperative_id')::uuid; v_campaign text := coalesce(private.aflp_txt(p,'campaign'),'2027');
  v_pid text := private.aflp_txt(p,'producer_id'); v_new boolean := false; v_tel text; v_vid text; v_dups int;
  v_primary boolean; m public.aflp_coop_memberships; c public.aflp_cooperatives; v_code text; v_source text;
begin
  perform private.aflp_require_edit(v_coop);
  select * into c from public.aflp_cooperatives where id = v_coop;
  if c.archived then raise exception 'Coopérative archivée : ajout de membre impossible'; end if;
  if c.aflp_status = 'SORTIE' then raise exception 'Coopérative sortie du programme : ajout de membre impossible'; end if;
  v_source := coalesce(private.aflp_txt(p,'source'), case when v_pid is null then 'MANUEL' else 'ASSOCIATION_EXISTANT' end);

  if v_pid is null then
    -- Création d'un producteur dans le REGISTRE UNIQUE, après contrôle des doublons.
    v_vid := private.aflp_txt(p,'village_id');
    if private.aflp_txt(p,'nom') is null then raise exception 'Nom du producteur obligatoire'; end if;
    if v_vid is null then raise exception 'Village du producteur obligatoire (référentiel villages AFLP)'; end if;
    if not exists (select 1 from public.villages where id = v_vid and not deleted) then raise exception 'Village inconnu du référentiel'; end if;
    if not private.farmer_registry_can_access_village(v_vid, null) then
      raise exception 'Village hors de votre périmètre' using errcode = '42501';
    end if;
    v_tel := nullif(regexp_replace(coalesce(p->>'telephone',''),'[^0-9]','','g'),'');
    if v_tel is not null and v_tel !~ '^0[0-9]{9}$' then raise exception 'Téléphone : 10 chiffres commençant par 0'; end if;
    select count(*) into v_dups from public.aflp_coop_match_producers(jsonb_build_array(jsonb_build_object(
      'idx',0,'farmer_id',p->>'farmer_id','nom',p->>'nom','prenoms',p->>'prenoms','telephone',v_tel,'village_id',v_vid)));
    if v_dups > 0 and not coalesce((p->>'confirm_new')::boolean,false) then
      raise exception 'DOUBLON_POSSIBLE: % producteur(s) potentiellement déjà enregistré(s). Associez l''existant ou confirmez la création avec un motif.', v_dups
        using errcode = 'P0001';
    end if;
    if v_dups > 0 and private.aflp_txt(p,'confirm_reason') is null then
      raise exception 'Motif obligatoire pour créer un producteur malgré un doublon possible';
    end if;
    v_pid := 'fb-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS') || '-' || substr(md5(random()::text),1,6);
    insert into public.producteurs(id, data, nom, prenoms, telephone, village_id, sexe, birth_year, statut, possible_duplicate,
                                   review_required, review_reason, created_by)
    values (v_pid, jsonb_strip_nulls(jsonb_build_object('id', v_pid, 'source', 'AFLP_COOPERATIVE', 'cooperativeCode', c.code,
              'superficieHa', private.aflp_numv(p,'superficie_ha'), 'potentiel2027Kg', private.aflp_numv(p,'potentiel_kg'),
              'prodPrecKg', private.aflp_numv(p,'production_prec_kg'))),
            upper(btrim(p->>'nom')), nullif(upper(btrim(coalesce(p->>'prenoms',''))),''), v_tel, v_vid,
            case upper(coalesce(p->>'sexe','')) when 'M' then 'M' when 'H' then 'M' when 'F' then 'F' else null end,
            private.aflp_numv(p,'birth_year')::int, 'Identifié', v_dups > 0, v_dups > 0,
            case when v_dups > 0 then 'Créé malgré doublon possible : ' || private.aflp_txt(p,'confirm_reason') end,
            public.fbms_email())
    returning code into v_code;
    insert into public.aflp_producer_enrollment(producer_id, enrollment_channel, enrolled_cooperative_id, enrolled_campaign, source)
    values (v_pid, 'COOPERATIVE', v_coop, v_campaign, v_source);
    v_new := true;
  else
    if not exists (select 1 from public.producteurs where id = v_pid and not deleted) then raise exception 'Producteur introuvable'; end if;
    if not private.farmer_registry_can_access_producteur(v_pid) then raise exception 'Producteur hors de votre périmètre' using errcode = '42501'; end if;
    select code into v_code from public.producteurs where id = v_pid;
    if exists (select 1 from public.aflp_coop_memberships where producer_id = v_pid and cooperative_id = v_coop
               and campaign = v_campaign and status <> 'ENDED') then
      raise exception 'Ce producteur est déjà membre de cette coopérative pour la campagne %', v_campaign;
    end if;
  end if;

  -- Principale par défaut si le producteur n'a pas encore d'affiliation principale pour la campagne.
  v_primary := coalesce((p->>'is_primary')::boolean,
    not exists (select 1 from public.aflp_coop_memberships where producer_id = v_pid and campaign = v_campaign and is_primary and status <> 'ENDED'));
  if v_primary then
    if exists (select 1 from public.aflp_coop_memberships where producer_id = v_pid and campaign = v_campaign and is_primary and status <> 'ENDED') then
      raise exception 'Le producteur a déjà une coopérative principale pour %. Utilisez " Changer de coopérative " ou associez-le en affiliation secondaire.', v_campaign;
    end if;
  end if;

  insert into public.aflp_coop_memberships(producer_id, cooperative_id, campaign, section_id, member_number, status,
     membership_start, is_primary, verified, verification_date, verification_method, verified_by, source, followup_rt_id, notes)
  values (v_pid, v_coop, v_campaign, nullif(p->>'section_id','')::uuid, private.aflp_txt(p,'member_number'),
     coalesce(private.aflp_txt(p,'status'),'ACTIVE'), coalesce(nullif(p->>'membership_start','')::date, current_date), v_primary,
     coalesce((p->>'verified')::boolean,false),
     case when coalesce((p->>'verified')::boolean,false) then current_date end,
     case when coalesce((p->>'verified')::boolean,false) then coalesce(private.aflp_txt(p,'verification_method'),'LISTE_COOPERATIVE') end,
     case when coalesce((p->>'verified')::boolean,false) then auth.uid() end,
     v_source, private.aflp_txt(p,'followup_rt_id'), private.aflp_txt(p,'notes'))
  returning * into m;

  return jsonb_build_object('producer_id', v_pid, 'farmer_id', v_code, 'created', v_new, 'membership', to_jsonb(m));
end $$;

-- ---------------------------------- import en masse (après prévisualisation client)
-- p_rows : [{idx, action:'CREATE'|'LINK'|'SKIP', producer_id?, nom, prenoms, telephone, village_id,
--            sexe, birth_year, member_number, section_id, superficie_ha, potentiel_kg, verified, confirm_reason}]
-- Chaque ligne est traitée dans son propre sous-bloc : une ligne en erreur n'annule
-- pas les autres et n'est JAMAIS perdue silencieusement (statut + message).
create or replace function public.aflp_coop_import_commit(p_coop uuid, p_campaign text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare x jsonb; res jsonb := '[]'::jsonb; r jsonb; v_action text; n_imp int := 0; n_link int := 0; n_rej int := 0; n_skip int := 0;
  v_count int;
begin
  perform private.aflp_require_edit(p_coop);
  v_count := jsonb_array_length(coalesce(p_rows,'[]'::jsonb));
  if v_count > 5000 then raise exception 'Import limité à 5 000 lignes par envoi (reçu %)', v_count; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_action := upper(coalesce(x->>'action','CREATE'));
    if v_action = 'SKIP' then
      n_skip := n_skip + 1;
      res := res || jsonb_build_array(jsonb_build_object('idx', x->'idx', 'statut', 'IGNORE', 'message', coalesce(x->>'skip_reason','Ignoré à la revue')));
      continue;
    end if;
    begin
      r := public.aflp_coop_add_member(
        (x - 'action' - 'idx' - 'producer_id')
        || jsonb_build_object('cooperative_id', p_coop, 'campaign', coalesce(p_campaign,'2027'), 'source', 'IMPORT_EXCEL',
                              'confirm_new', coalesce((x->>'confirm_new')::boolean, x ? 'confirm_reason'))
        || case when v_action = 'LINK' then jsonb_build_object('producer_id', x->>'producer_id') else '{}'::jsonb end);
      if (r->>'created')::boolean then n_imp := n_imp + 1; else n_link := n_link + 1; end if;
      res := res || jsonb_build_array(jsonb_build_object('idx', x->'idx',
        'statut', case when (r->>'created')::boolean then 'IMPORTE' else 'EXISTANT_ASSOCIE' end,
        'farmer_id', r->>'farmer_id', 'producer_id', r->>'producer_id'));
    exception when others then
      n_rej := n_rej + 1;
      res := res || jsonb_build_array(jsonb_build_object('idx', x->'idx',
        'statut', case when sqlerrm like 'DOUBLON_POSSIBLE%' then 'DOUBLON_POTENTIEL' else 'REJETE' end, 'message', sqlerrm));
    end;
  end loop;
  insert into public.aflp_coop_audit(cooperative_id, entity, entity_id, operation, after_data, note, actor_email, actor_role)
  values (p_coop, 'import_producteurs', null, 'IMPORT',
          jsonb_build_object('lignes', v_count, 'importes', n_imp, 'existants_associes', n_link, 'rejetes', n_rej, 'ignores', n_skip),
          'Import Excel producteurs', public.fbms_email(), public.fbms_role());
  return jsonb_build_object('lignes', v_count, 'importes', n_imp, 'existants_associes', n_link, 'rejetes', n_rej,
                            'ignores', n_skip, 'details', res);
end $$;

-- --------------------------------------------- changement de coopérative (historisé)
create or replace function public.aflp_coop_transfer_member(p_membership uuid, p_new_coop uuid, p_reason text,
  p_member_number text default null, p_section uuid default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare old_m public.aflp_coop_memberships; new_m public.aflp_coop_memberships;
begin
  select * into old_m from public.aflp_coop_memberships where id = p_membership for update;
  if old_m.id is null then raise exception 'Affiliation introuvable'; end if;
  perform private.aflp_require_edit(old_m.cooperative_id);
  perform private.aflp_require_edit(p_new_coop);
  if old_m.status = 'ENDED' then raise exception 'Affiliation déjà clôturée'; end if;
  if p_new_coop = old_m.cooperative_id then raise exception 'Choisissez une autre coopérative'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Motif de changement obligatoire'; end if;
  -- l'ancienne ligne est fermée, jamais supprimée
  update public.aflp_coop_memberships set status = 'ENDED', is_primary = false,
    membership_end = greatest(current_date, membership_start),
    notes = concat_ws(' · ', notes, 'Sortie ' || to_char(current_date,'DD/MM/YYYY') || ' : ' || btrim(p_reason))
   where id = old_m.id;
  insert into public.aflp_coop_memberships(producer_id, cooperative_id, campaign, section_id, member_number, status,
     membership_start, is_primary, source, followup_rt_id, notes)
  values (old_m.producer_id, p_new_coop, old_m.campaign, p_section, nullif(btrim(p_member_number),''), 'ACTIVE',
     current_date, old_m.is_primary, 'TRANSFERT', old_m.followup_rt_id, 'Transfert depuis affiliation ' || old_m.id::text)
  returning * into new_m;
  return jsonb_build_object('ancienne', old_m.id, 'nouvelle', to_jsonb(new_m));
end $$;

create or replace function public.aflp_coop_end_member(p_membership uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare m public.aflp_coop_memberships;
begin
  select * into m from public.aflp_coop_memberships where id = p_membership for update;
  if m.id is null then raise exception 'Affiliation introuvable'; end if;
  perform private.aflp_require_edit(m.cooperative_id);
  if nullif(btrim(p_reason),'') is null then raise exception 'Motif de retrait obligatoire'; end if;
  update public.aflp_coop_memberships set status = 'ENDED', is_primary = false, membership_end = greatest(current_date, membership_start),
    notes = concat_ws(' · ', notes, 'Retrait : ' || btrim(p_reason))
   where id = m.id returning * into m;
  return to_jsonb(m);
end $$;

create or replace function public.aflp_coop_set_primary(p_membership uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare m public.aflp_coop_memberships;
begin
  select * into m from public.aflp_coop_memberships where id = p_membership for update;
  if m.id is null or m.status <> 'ACTIVE' then raise exception 'Affiliation ACTIVE introuvable'; end if;
  perform private.aflp_require_edit(m.cooperative_id);
  update public.aflp_coop_memberships set is_primary = false
   where producer_id = m.producer_id and campaign = m.campaign and is_primary and id <> m.id;
  update public.aflp_coop_memberships set is_primary = true where id = m.id returning * into m;
  return to_jsonb(m);
end $$;

create or replace function public.aflp_coop_verify_member(p_membership uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare m public.aflp_coop_memberships;
begin
  select * into m from public.aflp_coop_memberships where id = p_membership;
  if m.id is null then raise exception 'Affiliation introuvable'; end if;
  perform private.aflp_require_edit(m.cooperative_id);
  update public.aflp_coop_memberships set verified = true, verification_date = current_date,
    verification_method = coalesce(nullif(p_method,''),'LISTE_COOPERATIVE'), verified_by = auth.uid()
   where id = m.id returning * into m;
  return to_jsonb(m);
end $$;

-- ------------------------------ identité organisationnelle commune avec Procurement
create or replace function public.aflp_coop_link_supplier(p_coop uuid, p_supplier uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c public.aflp_cooperatives; s public.procurement_suppliers;
begin
  perform private.aflp_require_edit(p_coop);
  if not private.aflp_coop_is_direction() and not private.ops_has_role(private.procurement_supplier_editor_roles()) then
    raise exception 'Lier une coopérative à un Supplier : direction ou Procurement' using errcode = '42501';
  end if;
  select * into s from public.procurement_suppliers where supplier_id = p_supplier;
  if s.supplier_id is null then raise exception 'Supplier introuvable'; end if;
  if s.entity_type <> 'COOPERATIVE' then raise exception 'Le Supplier % n''est pas de type COOPERATIVE (type %)', s.display_name, s.entity_type; end if;
  if exists (select 1 from public.aflp_cooperatives where supplier_id = p_supplier and id <> p_coop) then
    raise exception 'Ce Supplier est déjà lié à une autre coopérative AFLP';
  end if;
  update public.aflp_cooperatives set supplier_id = p_supplier where id = p_coop returning * into c;
  return to_jsonb(c);
end $$;

-- Crée l'identité Procurement (Supplier Direct de type COOPERATIVE) à partir de la fiche
-- AFLP, puis lie les deux : une organisation, deux rôles, aucun doublon libre.
create or replace function public.aflp_coop_create_supplier(p_coop uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c public.aflp_cooperatives; r jsonb; v_pres record;
begin
  perform private.aflp_require_edit(p_coop);
  select * into c from public.aflp_cooperatives where id = p_coop;
  if c.supplier_id is not null then raise exception 'Coopérative déjà liée à un Supplier Procurement'; end if;
  if c.is_qa then raise exception 'Coopérative QA : pas de Supplier Procurement réel'; end if;
  select full_name, phone into v_pres from public.aflp_coop_contacts where cooperative_id = p_coop and role = 'PRESIDENT' and active limit 1;
  r := public.procurement_create_direct_supplier_profile(jsonb_build_object(
        'name', c.name, 'legal_name', coalesce(c.legal_name, c.name), 'entity_type', 'COOPERATIVE',
        'origin', coalesce(c.locality, c.departement, 'GBEKE'), 'contact_person', v_pres.full_name,
        'phone', coalesce(c.phone, v_pres.phone), 'email', c.email, 'region', c.region,
        'registration_no', coalesce(c.registration_no, c.rccm), 'address', c.address,
        'notes', 'Créé depuis AFLP Coopératives (' || c.code || ')'));
  update public.aflp_cooperatives set supplier_id = (r->>'supplier_id')::uuid where id = p_coop;
  return r;
end $$;

-- --------------------------------------------- Delivery Plan d'une coopérative
create or replace function public.aflp_coop_plan_delivery(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_coop uuid := (p->>'cooperative_id')::uuid; c public.aflp_cooperatives; cc public.aflp_coop_campaigns;
  v_campaign text := coalesce(private.aflp_txt(p,'campaign'),'2027'); v_arr jsonb; d public.aflp_coop_deliveries;
  v_code text; v_wh uuid;
begin
  perform private.aflp_require_edit(v_coop);
  select * into c from public.aflp_cooperatives where id = v_coop;
  if c.aflp_status not in ('APPROUVEE','ACTIVE') or c.archived then
    raise exception 'Coopérative % (statut %) : livraison non planifiable', c.code, c.aflp_status;
  end if;
  select * into cc from public.aflp_coop_campaigns where cooperative_id = v_coop and campaign = v_campaign;
  v_wh := coalesce(nullif(p->>'warehouse_id','')::uuid, cc.destination_warehouse_id);
  if v_wh is null then raise exception 'Entrepôt de destination obligatoire'; end if;
  if private.aflp_numv(p,'planned_kg') is null then raise exception 'Quantité prévue (kg) obligatoire'; end if;
  if nullif(p->>'planned_date','') is null then raise exception 'Date de livraison prévue obligatoire'; end if;

  -- Si la coopérative est contrepartie commerciale (Supplier lié), la livraison entre
  -- dans le Delivery Plan Procurement existant (canal COOPERATIVE) : même planning,
  -- même réception Warehouse, aucun circuit parallèle.
  if c.supplier_id is not null and coalesce((p->>'to_procurement_plan')::boolean, true) then
    select h.code into v_code from public.procurement_supplier_code_history h where h.supplier_id = c.supplier_id and h.is_current limit 1;
    v_arr := public.procurement_schedule_supplier_arrival(jsonb_build_object(
      'purchase_type','COOPERATIVE','supplier_code', v_code, 'origin', coalesce(c.locality, c.departement, 'GBEKE'),
      'warehouse_id', v_wh, 'expected_kg', private.aflp_numv(p,'planned_kg'), 'expected_bags', p->>'planned_bags',
      'expected_at', (p->>'planned_date')::date + time '08:00', 'truck', p->>'truck', 'driver', p->>'driver',
      'transporter', p->>'transporter', 'reference', coalesce(private.aflp_txt(p,'reference'), c.code)));
  end if;

  insert into public.aflp_coop_deliveries(cooperative_id, campaign, payment_model, section_id, collection_point_id, warehouse_id,
     planned_date, planned_kg, planned_bags, arrival_id, notes)
  values (v_coop, v_campaign, coalesce(cc.payment_model,'INDIVIDUAL_FARMER'), nullif(p->>'section_id','')::uuid,
     nullif(p->>'collection_point_id','')::uuid, v_wh, (p->>'planned_date')::date, private.aflp_numv(p,'planned_kg'),
     private.aflp_numv(p,'planned_bags')::int, v_arr->>'id', private.aflp_txt(p,'notes'))
  returning * into d;
  return to_jsonb(d) || jsonb_build_object('arrival', v_arr);
end $$;

create or replace function public.aflp_coop_record_delivery(p_delivery uuid, p_delivered_kg numeric, p_bags int,
  p_reception_id text default null, p_status text default 'RECUE')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d public.aflp_coop_deliveries; v_rcv text;
begin
  select * into d from public.aflp_coop_deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Livraison introuvable'; end if;
  perform private.aflp_require_edit(d.cooperative_id);
  v_rcv := coalesce(nullif(p_reception_id,''), (select reception_id from public.rcn_proc_arrivages where id = d.arrival_id));
  if v_rcv is not null and not exists (select 1 from public.wms_receptions where id = v_rcv) then
    raise exception 'Réception Warehouse % introuvable', v_rcv;
  end if;
  update public.aflp_coop_deliveries set delivered_kg = p_delivered_kg, delivered_bags = p_bags,
    delivered_at = coalesce(delivered_at, now()), wms_reception_id = v_rcv, status = coalesce(p_status,'RECUE')
   where id = p_delivery returning * into d;
  return to_jsonb(d);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'public.aflp_coop_save(jsonb)','public.aflp_coop_set_status(uuid,text,text)','public.aflp_coop_archive(uuid,text)',
    'public.aflp_coop_match_producers(jsonb)','public.aflp_coop_add_member(jsonb)','public.aflp_coop_import_commit(uuid,text,jsonb)',
    'public.aflp_coop_transfer_member(uuid,uuid,text,text,uuid)','public.aflp_coop_end_member(uuid,text)',
    'public.aflp_coop_set_primary(uuid)','public.aflp_coop_verify_member(uuid,text)','public.aflp_coop_link_supplier(uuid,uuid)',
    'public.aflp_coop_create_supplier(uuid)','public.aflp_coop_plan_delivery(jsonb)',
    'public.aflp_coop_record_delivery(uuid,numeric,integer,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.aflp_require_edit(uuid) from public, anon;
grant execute on function private.aflp_require_edit(uuid), private.aflp_txt(jsonb,text), private.aflp_numv(jsonb,text) to authenticated;

commit;
