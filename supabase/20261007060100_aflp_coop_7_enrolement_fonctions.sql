-- AFLP 2027 · Coopératives · 7b — Enrôlement depuis une coopérative, anti-doublon,
-- file « À vérifier », import v2, qualité des dossiers.
--
-- Règles :
--   * un producteur n'existe qu'une fois (public.producteurs) ; la coopérative ne crée
--     que l'AFFILIATION quand le producteur existe déjà (Farmer ID, RT, parcelles,
--     Passport et achats antérieurs conservés) ;
--   * correspondance forte (≥ 85 : Farmer ID, téléphone) → jamais de création directe ;
--     Farmer ID déjà attribué → jamais de création, même forcée ;
--   * correspondance moyenne (60-84) → création seulement avec motif, sinon file ;
--   * aucune valeur absente n'est déduite : consentement NOT_RECORDED par défaut, pas de
--     parcelle, pas de baseline, pas de GPS si rien n'a été collecté ;
--   * la recherche de doublons porte sur TOUT le registre (hors périmètre compris), mais
--     n'expose que le Farmer ID et le village d'un producteur hors périmètre.

begin;

-- ---------------------------------------------------------------- noyau de recherche
-- Sans filtre de périmètre : sert à DÉCIDER (compter), jamais à afficher tel quel.
create or replace function private.aflp_match_core(p_rows jsonb)
returns table(idx int, producer_id text, reason text, conf int)
language sql stable security definer set search_path = public, private as $$
  with r as (
    select (x->>'idx')::int idx, upper(nullif(btrim(x->>'farmer_id'),'')) fid,
           nullif(public.farmer_registry_norm_text(coalesce(x->>'nom','')),'') nom_n,
           nullif(public.farmer_registry_norm_text(coalesce(x->>'nom','') || ' ' || coalesce(x->>'prenoms','')),'') full_n,
           nullif(public.farmer_registry_norm_phone(x->>'telephone'),'') tel,
           nullif(public.farmer_registry_norm_phone(x->>'telephone_alt'),'') tel2,
           nullif(x->>'village_id','') vid,
           case when coalesce(x->>'birth_year','') ~ '^[0-9]{4}$' then (x->>'birth_year')::int end yob,
           nullif(x->>'exclude_id','') excl,
           (select v.cluster_code from public.villages v where v.id = nullif(x->>'village_id','')) vcl
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
  ), hits as (
    -- Farmer ID (index upper(code))
    select r.idx, h.id, 'FARMER_ID'::text reason, 100 conf from r
      cross join lateral (select p.id from public.producteurs p where upper(p.code) = r.fid and not p.deleted) h
     where r.fid is not null
    union all
    -- téléphone principal (index farmer_registry_norm_phone(telephone))
    select r.idx, h.id, case when h.village_id = r.vid then 'TELEPHONE_MEME_VILLAGE' else 'TELEPHONE' end,
           case when h.village_id = r.vid then 95 else 85 end from r
      cross join lateral (select p.id, p.village_id from public.producteurs p
                          where public.farmer_registry_norm_phone(p.telephone) = r.tel and not p.deleted and p.telephone is not null) h
     where r.tel is not null and length(r.tel) >= 8
    union all
    -- téléphone secondaire, dans les deux sens (index sur telephone_alt et telephone)
    select r.idx, h.id, 'TELEPHONE_SECONDAIRE', 80 from r
      cross join lateral (select p.id from public.producteurs p
                          where public.farmer_registry_norm_phone(p.telephone_alt) = r.tel and not p.deleted and p.telephone_alt is not null) h
     where r.tel is not null and length(r.tel) >= 8
    union all
    select r.idx, h.id, 'TELEPHONE_SECONDAIRE', 80 from r
      cross join lateral (select p.id from public.producteurs p
                          where public.farmer_registry_norm_phone(p.telephone_alt) = r.tel2 and not p.deleted and p.telephone_alt is not null) h
     where r.tel2 is not null and length(r.tel2) >= 8
    union all
    select r.idx, h.id, 'TELEPHONE_SECONDAIRE', 80 from r
      cross join lateral (select p.id from public.producteurs p
                          where public.farmer_registry_norm_phone(p.telephone) = r.tel2 and not p.deleted and p.telephone is not null) h
     where r.tel2 is not null and length(r.tel2) >= 8
    union all
    -- nom + prénoms identiques (index nom complet normalisé), qualifiés par la localité
    select r.idx, h.id,
           case when h.village_id = r.vid then 'NOM_PRENOMS_MEME_VILLAGE'
                when r.yob is not null and h.birth_year = r.yob then 'NOM_PRENOMS_ANNEE_NAISSANCE'
                else 'NOM_PRENOMS_MEME_CLUSTER' end,
           case when h.village_id = r.vid then 75 when r.yob is not null and h.birth_year = r.yob then 70 else 65 end
      from r cross join lateral (select p.id, p.village_id, p.birth_year, v.cluster_code from public.producteurs p
                                 left join public.villages v on v.id = p.village_id
                                 where public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = r.full_n
                                   and not p.deleted) h
     where r.full_n is not null and position(' ' in r.full_n) > 0
       and (h.village_id = r.vid or (r.yob is not null and h.birth_year = r.yob) or (r.vcl is not null and h.cluster_code = r.vcl))
    union all
    -- même nom de famille dans le même village (index nom normalisé)
    select r.idx, h.id, 'NOM_MEME_VILLAGE', 60 from r
      cross join lateral (select p.id from public.producteurs p
                          where public.farmer_registry_norm_text(p.nom) = r.nom_n and not p.deleted and p.nom is not null
                            and p.village_id = r.vid) h
     where r.vid is not null and r.nom_n is not null
  )
  select distinct on (h.idx, h.id) h.idx, h.id, h.reason, h.conf
  from hits h join r on r.idx = h.idx
  where r.excl is null or h.id <> r.excl
  order by h.idx, h.id, h.conf desc;
$$;

-- Affichage des correspondances : identité complète si le producteur est dans le
-- périmètre de l'utilisateur, sinon seulement Farmer ID + village (signalement).
create or replace function public.aflp_coop_match_producers_v2(p_rows jsonb)
returns table(idx int, producer_id text, farmer_id text, nom text, prenoms text, village_id text, village_nom text,
              telephone_masque text, reason text, confidence int, coop_codes text, rt_id text, accessible boolean)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.est_actif() then raise exception 'Session inactive' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 1000 then raise exception 'Recherche limitée à 1 000 lignes par appel'; end if;
  return query
  select m.idx,
         case when acc then p.id end, p.code,
         case when acc then p.nom else 'PRODUCTEUR HORS PÉRIMÈTRE' end,
         case when acc then p.prenoms end, p.village_id, p.village_nom,
         case when acc and p.telephone is not null then '******' || right(regexp_replace(p.telephone,'[^0-9]','','g'), 4) end,
         m.reason, m.conf,
         case when acc then (select string_agg(distinct c.code, ', ') from public.aflp_coop_memberships x
                join public.aflp_cooperatives c on c.id = x.cooperative_id where x.producer_id = p.id and x.status <> 'ENDED') end,
         case when acc then p.rt_id end, acc
  from private.aflp_match_core(p_rows) m
  join public.producteurs p on p.id = m.producer_id
  cross join lateral (select private.farmer_registry_can_access_producteur(p.id) as acc) a
  order by m.idx, m.conf desc;
end $$;

-- Qui peut créer malgré une correspondance forte (téléphone) : supervision ou direction.
create or replace function private.aflp_can_force_create() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(private.aflp_coop_is_direction() or private.farmer_registry_can_supervise(), false)
$$;

-- ------------------------------------------------------------ mise en file d'attente
create or replace function private.aflp_queue_candidate(p_coop uuid, p_campaign text, p_category text, p_candidate jsonb,
  p_reason text, p_source text default 'FORMULAIRE', p_batch uuid default null, p_row int default null)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_matches jsonb; v_top int; v_qa boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object('producer_id', m.producer_id, 'farmer_id', p.code, 'reason', m.reason, 'confidence', m.conf)
                             order by m.conf desc), '[]'::jsonb), max(m.conf)
    into v_matches, v_top
  from private.aflp_match_core(jsonb_build_array(p_candidate || jsonb_build_object('idx', 0))) m
  join public.producteurs p on p.id = m.producer_id;
  select is_qa into v_qa from public.aflp_cooperatives where id = p_coop;
  insert into public.aflp_coop_enrollment_reviews(cooperative_id, campaign, batch_id, row_index, source, category, candidate,
                                                  matches, top_confidence, reason, is_qa)
  values (p_coop, coalesce(p_campaign,'2027'), p_batch, p_row, coalesce(p_source,'FORMULAIRE'),
          case when p_category = 'A_COMPLETER' then 'A_COMPLETER' else 'DOUBLON_A_VERIFIER' end,
          p_candidate - 'confirm_reason' - 'force_reason' - 'send_to_review' - 'review_id' - 'idx' - 'action',
          v_matches, v_top, p_reason, coalesce(v_qa,false))
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------- enrôlement complet
create or replace function public.aflp_coop_enroll_producer(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_coop uuid := nullif(p->>'cooperative_id','')::uuid; v_campaign text := coalesce(private.aflp_txt(p,'campaign'),'2027');
  c public.aflp_cooperatives; v_vid text; v_tel text; v_tel2 text; v_matches jsonb; v_top int; v_fid_hit boolean;
  v_pid text; v_code text; v_by int; v_band text; v_sexe text; v_cashew text; v_reason text; v_review uuid;
  v_member jsonb; v_source text := coalesce(private.aflp_txt(p,'source'),'FORMULAIRE'); x jsonb; v_consent text;
  v_scopes jsonb; v_lat numeric; v_lng numeric; v_acc numeric; v_area numeric; v_trees int; v_py int; v_completeness int;
  v_full constant text[] := array['identity','agriculture','gps','photos','training','inspections','transactions'];
begin
  perform private.aflp_require_edit(v_coop);
  select * into c from public.aflp_cooperatives where id = v_coop;
  if c.archived or c.aflp_status = 'SORTIE' then raise exception 'Coopérative % archivée ou sortie : enrôlement impossible', c.code; end if;

  -- ------------------------------------------------ contrôle des champs (rien n'est déduit)
  v_vid := private.aflp_txt(p,'village_id');
  if private.aflp_txt(p,'nom') is null then raise exception 'A_COMPLETER: nom du producteur manquant'; end if;
  if v_vid is null then raise exception 'A_COMPLETER: village manquant ou absent du référentiel AFLP'; end if;
  if not exists (select 1 from public.villages where id = v_vid and not deleted) then
    raise exception 'A_COMPLETER: village inconnu du référentiel AFLP'; end if;
  if not private.farmer_registry_can_access_village(v_vid, null) then
    raise exception 'Village hors de votre périmètre' using errcode = '42501'; end if;
  v_tel := nullif(regexp_replace(coalesce(p->>'telephone',''),'[^0-9]','','g'),'');
  v_tel2 := nullif(regexp_replace(coalesce(p->>'telephone_alt',''),'[^0-9]','','g'),'');
  if v_tel is not null and v_tel !~ '^0[0-9]{9}$' then raise exception 'Téléphone principal : 10 chiffres commençant par 0'; end if;
  if v_tel2 is not null and v_tel2 !~ '^0[0-9]{9}$' then raise exception 'Téléphone secondaire : 10 chiffres commençant par 0'; end if;
  if v_tel2 is not null and v_tel2 = v_tel then v_tel2 := null; end if;
  v_by := private.aflp_numv(p,'birth_year')::int;
  if v_by is not null and (v_by < 1920 or v_by > extract(year from current_date)::int - 15) then
    raise exception 'Année de naissance invalide (%)', v_by; end if;
  v_band := private.aflp_txt(p,'age_band');
  if v_band is not null and v_band not in ('18-24','25-34','35-44','45-54','55-64','65+','UNKNOWN') then
    raise exception 'Tranche d''âge invalide (%)', v_band; end if;
  v_sexe := case upper(coalesce(p->>'sexe','')) when 'M' then 'M' when 'H' then 'M' when 'F' then 'F' else null end;
  v_cashew := upper(coalesce(private.aflp_txt(p,'cashew_farmer'),'NON_COLLECTE'));
  if v_cashew not in ('OUI','NON','NON_COLLECTE') then v_cashew := 'NON_COLLECTE'; end if;
  v_area := private.aflp_numv(p,'total_area_ha');
  if v_area is not null and v_area <= 0 then raise exception 'Superficie anacarde : valeur positive attendue'; end if;
  v_py := private.aflp_numv(p,'planting_year')::int;
  if v_py is not null and (v_py < 1950 or v_py > extract(year from current_date)::int) then
    raise exception 'Année de plantation invalide (%)', v_py; end if;
  if private.aflp_numv(p,'home_gps_lat') is not null and private.aflp_numv(p,'home_gps_lng') is null
     or private.aflp_numv(p,'home_gps_lat') is null and private.aflp_numv(p,'home_gps_lng') is not null then
    raise exception 'GPS du producteur : latitude ET longitude requises'; end if;

  -- ---------------------------------------------------------------- anti-doublon
  select coalesce(jsonb_agg(jsonb_build_object('producer_id', m.producer_id, 'farmer_id', pr.code, 'reason', m.reason,
                                               'confidence', m.conf) order by m.conf desc), '[]'::jsonb),
         max(m.conf), coalesce(bool_or(m.reason = 'FARMER_ID'), false)
    into v_matches, v_top, v_fid_hit
  from private.aflp_match_core(jsonb_build_array(jsonb_build_object('idx',0,'farmer_id',p->>'farmer_id','nom',p->>'nom',
         'prenoms',p->>'prenoms','telephone',v_tel,'telephone_alt',v_tel2,'village_id',v_vid,'birth_year',v_by))) m
  join public.producteurs pr on pr.id = m.producer_id;

  if v_top is not null then
    v_reason := case
      when v_fid_hit then null
      when v_top >= 85 and private.aflp_txt(p,'force_reason') is not null then private.aflp_txt(p,'force_reason')
      when v_top < 85 then coalesce(private.aflp_txt(p,'confirm_reason'), private.aflp_txt(p,'force_reason')) end;
    if v_reason is null or length(btrim(v_reason)) < 10 then
      if coalesce((p->>'send_to_review')::boolean, false) then
        v_review := private.aflp_queue_candidate(v_coop, v_campaign, 'DOUBLON_A_VERIFIER', p || jsonb_build_object(
                      'telephone', v_tel, 'telephone_alt', v_tel2),
                      case when v_fid_hit then 'Farmer ID déjà attribué dans le registre'
                           when v_top >= 85 then 'Correspondance forte (téléphone) avec un producteur existant'
                           else 'Correspondance possible (nom / village) avec un producteur existant' end,
                      v_source, nullif(p->>'batch_id','')::uuid, private.aflp_numv(p,'row_index')::int);
        return jsonb_build_object('status','EN_VERIFICATION','review_id', v_review, 'matches', v_matches, 'top_confidence', v_top);
      end if;
      raise exception '%: % correspondance(s), confiance max % %%. Associez le producteur existant, envoyez en vérification ou justifiez (10 caractères min.).',
        case when v_fid_hit or v_top >= 85 then 'DOUBLON_FORT' else 'DOUBLON_POSSIBLE' end, jsonb_array_length(v_matches), v_top;
    end if;
    if v_fid_hit then raise exception 'DOUBLON_FORT: ce Farmer ID est déjà attribué ; création impossible, associez le producteur existant.'; end if;
    if v_top >= 85 and not private.aflp_can_force_create() then
      raise exception 'DOUBLON_FORT: création malgré une correspondance forte réservée à la supervision (Supervisor, Unit Head, Zonal Head, direction).'
        using errcode = '42501';
    end if;
  end if;

  -- --------------------------------------------- création dans le registre UNIQUE
  v_pid := 'fb-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS') || '-' || substr(md5(random()::text),1,6);
  insert into public.producteurs(id, data, nom, prenoms, telephone, telephone_alt, preferred_language, village_id,
                                 sexe, birth_year, age_band, gps_lat, gps_lng, statut, possible_duplicate, review_required,
                                 review_reason, created_by)
  values (v_pid, jsonb_strip_nulls(jsonb_build_object('id', v_pid, 'source', 'AFLP_COOPERATIVE', 'cooperativeCode', c.code,
            'cashewFarmer', v_cashew, 'plantationCount', private.aflp_numv(p,'plantation_count'),
            'plantingYear', v_py, 'qa', case when c.is_qa then true end)),
          upper(btrim(p->>'nom')), nullif(upper(btrim(coalesce(p->>'prenoms',''))),''), v_tel, v_tel2,
          private.aflp_txt(p,'preferred_language'), v_vid, v_sexe, v_by, v_band,
          private.aflp_numv(p,'home_gps_lat'), private.aflp_numv(p,'home_gps_lng'), 'Identifié',
          v_top is not null, v_top is not null,
          case when v_top is not null then 'Créé malgré correspondance ' || v_top || ' % : ' || btrim(v_reason) end,
          public.fbms_email())
  returning code into v_code;

  insert into public.aflp_producer_enrollment(producer_id, enrollment_channel, enrolled_cooperative_id, enrolled_campaign, source)
  values (v_pid, 'COOPERATIVE', v_coop, v_campaign, case when v_source = 'IMPORT_EXCEL' then 'IMPORT_EXCEL' else 'FORMULAIRE_COOPERATIVE' end);

  -- affiliation (mêmes règles que l'association d'un existant)
  v_member := public.aflp_coop_add_member(jsonb_strip_nulls(jsonb_build_object('cooperative_id', v_coop, 'campaign', v_campaign,
      'producer_id', v_pid, 'section_id', p->>'section_id', 'member_number', p->>'member_number',
      'status', coalesce(private.aflp_txt(p,'membership_status'),'ACTIVE'), 'membership_start', p->>'membership_start',
      'is_primary', p->'is_primary', 'verified', p->'verified', 'verification_method', p->>'verification_method',
      'source', case when v_source = 'IMPORT_EXCEL' then 'IMPORT_EXCEL' else 'MANUEL' end, 'followup_rt_id', p->>'followup_rt_id')));

  -- baseline production : seulement si une valeur a réellement été déclarée
  if coalesce(v_area, private.aflp_numv(p,'forecast_kg'), private.aflp_numv(p,'previous_production_kg'), private.aflp_numv(p,'tree_count')) is not null then
    insert into public.farmer_production_baselines(producteur_id, campaign, productive_area_ha, previous_production_kg, forecast_kg,
        productive_tree_count, data_source, evidence_level, status, notes)
    values (v_pid, v_campaign, v_area, private.aflp_numv(p,'previous_production_kg'), private.aflp_numv(p,'forecast_kg'),
        private.aflp_numv(p,'tree_count')::int, 'COOPERATIVE_ENROLLMENT', 'DECLARED', 'DRAFT',
        'Déclaré à l''enrôlement coopérative ' || c.code);
  end if;

  -- parcelles : une ligne par parcelle réellement relevée (aucune parcelle fictive)
  for x in select * from jsonb_array_elements(coalesce(p->'plots','[]'::jsonb)) loop
    v_lat := private.aflp_numv(x,'lat'); v_lng := private.aflp_numv(x,'lng'); v_acc := private.aflp_numv(x,'accuracy_m');
    v_trees := private.aflp_numv(x,'tree_count')::int;
    if v_lat is null and v_lng is null and private.aflp_numv(x,'area_ha') is null and v_trees is null then continue; end if;
    if (v_lat is null) <> (v_lng is null) then raise exception 'Parcelle : latitude ET longitude requises'; end if;
    if v_lat is not null and (v_acc is null or v_acc <= 0) then raise exception 'Parcelle : précision GPS (m) obligatoire avec des coordonnées'; end if;
    insert into public.farmer_plots(producteur_id, village_id, local_name, declared_area, area_unit, tree_count, orchard_age_years,
                                    latitude, longitude, gps_accuracy_m, area_source, evidence_level, notes)
    values (v_pid, v_vid, private.aflp_txt(x,'local_name'), private.aflp_numv(x,'area_ha'), 'HA', v_trees,
            case when private.aflp_numv(x,'planting_year') is not null then extract(year from current_date)::int - private.aflp_numv(x,'planting_year')::int end,
            v_lat, v_lng, v_acc, 'DECLARED', 'DECLARED', 'Relevé à l''enrôlement coopérative ' || c.code);
  end loop;

  -- consentement : rien par défaut (NOT_RECORDED). Jamais déduit.
  v_consent := upper(coalesce(p->'consent'->>'status','NOT_RECORDED'));
  if v_consent in ('GRANTED','PARTIAL','REFUSED') then
    if nullif(p->'consent'->>'method','') is null then raise exception 'Consentement : méthode obligatoire'; end if;
    if nullif(p->'consent'->>'consent_at','') is null then raise exception 'Consentement : date obligatoire'; end if;
    v_scopes := case when v_consent = 'GRANTED' then
                  (select jsonb_object_agg(k, true) from unnest(v_full) k)
                else coalesce(p->'consent'->'scopes','{}'::jsonb) end;
    insert into public.farmer_consents(producteur_id, status, scopes, consent_at, method, text_version, notes, source)
    values (v_pid, v_consent, v_scopes, (p->'consent'->>'consent_at')::timestamptz, p->'consent'->>'method',
            coalesce(nullif(p->'consent'->>'text_version',''), 'AFLP-DATA-CONSENT-2026.1'),
            'Recueilli à l''enrôlement coopérative ' || c.code, 'COOP_ENROLLMENT');
  end if;

  perform public.farmer_registry_refresh_passport(v_pid);
  select completeness_pct into v_completeness from public.aflp_producer_quality_v where producer_id = v_pid;

  return jsonb_build_object('status','ENROLE','producer_id', v_pid, 'farmer_id', v_code, 'created', true,
    'membership_id', v_member->'membership'->>'id', 'completeness_pct', v_completeness,
    'possible_duplicate', v_top is not null);
end $$;

-- ------------------------------------------------------- décision sur la file
create or replace function public.aflp_coop_review_decide(p_review uuid, p_decision text, p_producer_id text default null,
  p_reason text default null, p_patch jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r public.aflp_coop_enrollment_reviews; v_cand jsonb; res jsonb; v_dec text := upper(coalesce(p_decision,''));
begin
  select * into r from public.aflp_coop_enrollment_reviews where id = p_review for update;
  if r.id is null then raise exception 'Élément de vérification introuvable'; end if;
  perform private.aflp_require_edit(r.cooperative_id);
  if r.status <> 'OUVERT' then raise exception 'Élément déjà traité (%)', r.decision; end if;
  v_cand := r.candidate || coalesce(p_patch, '{}'::jsonb);

  if v_dec = 'ENREGISTRER_COMPLEMENT' then
    update public.aflp_coop_enrollment_reviews set candidate = v_cand where id = r.id;
    return jsonb_build_object('status','OUVERT','review_id', r.id);

  elsif v_dec = 'ASSOCIER_EXISTANT' then
    if p_producer_id is null then raise exception 'Choisissez le producteur existant à associer'; end if;
    res := public.aflp_coop_add_member(jsonb_strip_nulls(jsonb_build_object('cooperative_id', r.cooperative_id, 'campaign', r.campaign,
             'producer_id', p_producer_id, 'section_id', v_cand->>'section_id', 'member_number', v_cand->>'member_number',
             'status', coalesce(v_cand->>'membership_status','ACTIVE'), 'membership_start', v_cand->>'membership_start',
             'verified', v_cand->'verified', 'verification_method', v_cand->>'verification_method',
             'source', case when r.source = 'IMPORT_EXCEL' then 'IMPORT_EXCEL' else 'ASSOCIATION_EXISTANT' end)));
    update public.aflp_coop_enrollment_reviews set status = 'RESOLU', decision = 'ASSOCIER_EXISTANT', candidate = v_cand,
      decision_reason = p_reason, resolved_producer_id = p_producer_id, decided_by = auth.uid(), decided_by_email = public.fbms_email(),
      decided_at = now() where id = r.id;
    return jsonb_build_object('status','RESOLU','decision','ASSOCIER_EXISTANT','producer_id', p_producer_id, 'farmer_id', res->>'farmer_id');

  elsif v_dec = 'CREER_JUSTIFIE' then
    if nullif(btrim(p_reason),'') is null or length(btrim(p_reason)) < 10 then
      raise exception 'Motif de création obligatoire (10 caractères minimum)'; end if;
    res := public.aflp_coop_enroll_producer(v_cand || jsonb_build_object('cooperative_id', r.cooperative_id, 'campaign', r.campaign,
             'confirm_reason', p_reason, 'force_reason', p_reason, 'send_to_review', false,
             'source', case when r.source = 'IMPORT_EXCEL' then 'IMPORT_EXCEL' else 'FORMULAIRE' end));
    update public.aflp_coop_enrollment_reviews set status = 'RESOLU', decision = 'CREER_JUSTIFIE', candidate = v_cand,
      decision_reason = p_reason, resolved_producer_id = res->>'producer_id', decided_by = auth.uid(),
      decided_by_email = public.fbms_email(), decided_at = now() where id = r.id;
    return res || jsonb_build_object('decision','CREER_JUSTIFIE');

  elsif v_dec = 'ENROLER' then
    begin
      res := public.aflp_coop_enroll_producer((v_cand || jsonb_build_object('cooperative_id', r.cooperative_id, 'campaign', r.campaign,
               'send_to_review', false, 'source', case when r.source = 'IMPORT_EXCEL' then 'IMPORT_EXCEL' else 'FORMULAIRE' end))
               - 'confirm_reason' - 'force_reason');
    exception when others then
      if sqlerrm like 'DOUBLON%' or sqlerrm like 'A_COMPLETER%' then
        update public.aflp_coop_enrollment_reviews set candidate = v_cand,
          category = case when sqlerrm like 'DOUBLON%' then 'DOUBLON_A_VERIFIER' else 'A_COMPLETER' end,
          reason = sqlerrm,
          matches = coalesce((select jsonb_agg(jsonb_build_object('producer_id', m.producer_id, 'farmer_id', p.code, 'reason', m.reason,
                     'confidence', m.conf) order by m.conf desc) from private.aflp_match_core(jsonb_build_array(v_cand || '{"idx":0}'::jsonb)) m
                     join public.producteurs p on p.id = m.producer_id), '[]'::jsonb),
          top_confidence = (select max(m.conf) from private.aflp_match_core(jsonb_build_array(v_cand || '{"idx":0}'::jsonb)) m)
         where id = r.id;
        return jsonb_build_object('status','OUVERT','review_id', r.id, 'message', sqlerrm);
      end if;
      raise;
    end;
    update public.aflp_coop_enrollment_reviews set status = 'RESOLU', decision = 'ENROLE_APRES_COMPLEMENT', candidate = v_cand,
      resolved_producer_id = res->>'producer_id', decided_by = auth.uid(), decided_by_email = public.fbms_email(), decided_at = now()
     where id = r.id;
    return res || jsonb_build_object('decision','ENROLE_APRES_COMPLEMENT');

  elsif v_dec = 'IGNORER' then
    if nullif(btrim(p_reason),'') is null then raise exception 'Motif obligatoire pour ignorer une ligne'; end if;
    update public.aflp_coop_enrollment_reviews set status = 'RESOLU', decision = 'IGNORER', decision_reason = p_reason,
      decided_by = auth.uid(), decided_by_email = public.fbms_email(), decided_at = now() where id = r.id;
    return jsonb_build_object('status','RESOLU','decision','IGNORER');
  end if;
  raise exception 'Décision inconnue : %', p_decision;
end $$;

-- ----------------------------------------------------------------------- import v2
-- Chaque ligne termine dans UNE catégorie : NOUVEAU_ENROLE, EXISTANT_ASSOCIE,
-- A_COMPLETER, DOUBLON_A_VERIFIER, REJETE, IGNORE. Les lignes « À compléter » et
-- « Doublon à vérifier » sont conservées dans la file (jamais perdues, jamais créées
-- d'office dans le registre). Le lot garde le détail ligne à ligne.
create or replace function public.aflp_coop_import_rows(p_coop uuid, p_campaign text, p_batch uuid, p_file text,
  p_total int, p_rows jsonb, p_final boolean default false)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_batch uuid := p_batch; x jsonb; v_action text; r jsonb; v_det jsonb := '[]'::jsonb; v_stat text; v_msg text;
  v_review uuid; k jsonb := jsonb_build_object('NOUVEAU_ENROLE',0,'EXISTANT_ASSOCIE',0,'A_COMPLETER',0,'DOUBLON_A_VERIFIER',0,'REJETE',0,'IGNORE',0);
  v_n int; v_fid text; v_pid text; v_campaign text := coalesce(p_campaign,'2027');
begin
  perform private.aflp_require_edit(p_coop);
  v_n := jsonb_array_length(coalesce(p_rows,'[]'::jsonb));
  if v_n > 1000 then raise exception 'Import : 1 000 lignes maximum par envoi (reçu %)', v_n; end if;
  if v_batch is null then
    insert into public.aflp_coop_import_batches(cooperative_id, campaign, file_name, total_rows)
    values (p_coop, v_campaign, p_file, coalesce(p_total, v_n)) returning id into v_batch;
  elsif not exists (select 1 from public.aflp_coop_import_batches where id = v_batch and cooperative_id = p_coop and status = 'EN_COURS') then
    raise exception 'Lot d''import introuvable ou déjà clôturé';
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_action := upper(coalesce(x->>'action','CREATE')); v_msg := null; v_review := null; v_fid := null; v_pid := null;
    begin
      if v_action = 'SKIP' then
        v_stat := 'IGNORE'; v_msg := coalesce(x->>'reason','Ignoré à la revue');
      elsif v_action = 'REJECT' then
        v_stat := 'REJETE'; v_msg := coalesce(x->>'reason','Ligne rejetée à la revue');
      elsif v_action = 'COMPLETE' then
        v_review := private.aflp_queue_candidate(p_coop, v_campaign, 'A_COMPLETER', x, coalesce(x->>'reason','Données insuffisantes'),
                                                 'IMPORT_EXCEL', v_batch, (x->>'idx')::int);
        v_stat := 'A_COMPLETER'; v_msg := coalesce(x->>'reason','Données insuffisantes');
      elsif v_action = 'REVIEW' then
        v_review := private.aflp_queue_candidate(p_coop, v_campaign, 'DOUBLON_A_VERIFIER', x, coalesce(x->>'reason','Doublon possible à vérifier'),
                                                 'IMPORT_EXCEL', v_batch, (x->>'idx')::int);
        v_stat := 'DOUBLON_A_VERIFIER'; v_msg := coalesce(x->>'reason','Doublon possible à vérifier');
      elsif v_action = 'LINK' then
        r := public.aflp_coop_add_member(jsonb_strip_nulls(jsonb_build_object('cooperative_id', p_coop, 'campaign', v_campaign,
               'producer_id', x->>'producer_id', 'section_id', x->>'section_id', 'member_number', x->>'member_number',
               'membership_start', x->>'membership_start', 'source', 'IMPORT_EXCEL')));
        v_stat := 'EXISTANT_ASSOCIE'; v_fid := r->>'farmer_id'; v_pid := x->>'producer_id';
      else
        r := public.aflp_coop_enroll_producer(x - 'action' - 'producer_id' || jsonb_build_object('cooperative_id', p_coop, 'campaign', v_campaign,
               'source','IMPORT_EXCEL','send_to_review', true, 'batch_id', v_batch, 'row_index', x->'idx'));
        if r->>'status' = 'ENROLE' then v_stat := 'NOUVEAU_ENROLE'; v_fid := r->>'farmer_id'; v_pid := r->>'producer_id';
        else v_stat := 'DOUBLON_A_VERIFIER'; v_review := (r->>'review_id')::uuid; v_msg := 'Correspondance ' || (r->>'top_confidence') || ' % : à vérifier'; end if;
      end if;
    exception when others then
      if sqlerrm like 'A_COMPLETER%' then
        v_review := private.aflp_queue_candidate(p_coop, v_campaign, 'A_COMPLETER', x, sqlerrm, 'IMPORT_EXCEL', v_batch, (x->>'idx')::int);
        v_stat := 'A_COMPLETER';
      elsif sqlerrm like '%déjà membre de cette coopérative%' then
        v_stat := 'EXISTANT_ASSOCIE';
      else
        v_stat := 'REJETE';
      end if;
      v_msg := sqlerrm;
    end;
    k := jsonb_set(k, array[v_stat], to_jsonb((k->>v_stat)::int + 1));
    v_det := v_det || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('idx', x->'idx', 'statut', v_stat, 'message', v_msg,
               'farmer_id', v_fid, 'producer_id', v_pid, 'review_id', v_review)));
  end loop;

  update public.aflp_coop_import_batches set
    nouveaux = nouveaux + (k->>'NOUVEAU_ENROLE')::int, existants_associes = existants_associes + (k->>'EXISTANT_ASSOCIE')::int,
    a_completer = a_completer + (k->>'A_COMPLETER')::int, doublons_a_verifier = doublons_a_verifier + (k->>'DOUBLON_A_VERIFIER')::int,
    rejetes = rejetes + (k->>'REJETE')::int, ignores = ignores + (k->>'IGNORE')::int,
    details = details || v_det, status = case when p_final then 'TERMINE' else status end
   where id = v_batch;
  if p_final then
    insert into public.aflp_coop_audit(cooperative_id, entity, entity_id, operation, after_data, note, actor_email, actor_role)
    select p_coop, 'import_producteurs', v_batch::text, 'IMPORT',
           jsonb_build_object('fichier', b.file_name, 'lignes', b.total_rows, 'nouveaux', b.nouveaux, 'existants_associes', b.existants_associes,
                              'a_completer', b.a_completer, 'doublons_a_verifier', b.doublons_a_verifier, 'rejetes', b.rejetes, 'ignores', b.ignores),
           'Import Excel producteurs (v2)', public.fbms_email(), public.fbms_role()
      from public.aflp_coop_import_batches b where b.id = v_batch;
  end if;
  return jsonb_build_object('batch_id', v_batch, 'counts', k, 'details', v_det);
end $$;

-- --------------------------------------------------- qualité / complétude des dossiers
-- Mesure la COMPLÉTUDE DES DONNÉES (8 éléments), jamais une note du producteur.
create or replace view public.aflp_producer_quality_v with (security_invoker = true) as
with base as (
  select p.id, p.code, p.consent_status, p.possible_duplicate, p.review_required, p.passport_stage, p.passport_completion,
         coalesce(length(public.farmer_registry_norm_phone(p.telephone)),0) = 10 as has_phone,
         coalesce(p.sexe in ('M','F','OTHER'), false) as has_sex,
         (p.birth_year is not null or coalesce(p.age_band,'UNKNOWN') <> 'UNKNOWN') as has_age,
         p.village_id is not null as has_village,
         (p.gps_lat is not null or coalesce(pl.gps_plots,0) > 0) as has_gps,
         (coalesce(pl.area_ha,0) > 0 or pb.area_ha is not null or nullif(p.data->>'superficieHa','') is not null) as has_area,
         (pb.forecast_kg is not null or nullif(p.data->>'potentiel2027Kg','') is not null) as has_potential,
         coalesce(p.consent_status,'NOT_RECORDED') <> 'NOT_RECORDED' as consent_recorded,
         coalesce((p.data->>'qa')::boolean, false) as is_qa
  from public.producteurs p
  left join lateral (select sum(case when fp.area_unit = 'HA' then fp.declared_area end) as area_ha,
                            count(*) filter (where fp.latitude is not null and fp.longitude is not null) as gps_plots
                     from public.farmer_plots fp where fp.producteur_id = p.id and not coalesce(fp.deleted,false)) pl on true
  left join lateral (select b.forecast_kg, b.productive_area_ha as area_ha from public.farmer_production_baselines b
                     where b.producteur_id = p.id and b.status <> 'CANCELLED' order by b.version desc limit 1) pb on true
  where not p.deleted
)
select id as producer_id, code as farmer_id, has_phone, has_sex, has_age, has_village, has_gps, has_area, has_potential,
       consent_recorded, consent_status, possible_duplicate, review_required, passport_stage, passport_completion,
       round(100.0 * (has_phone::int + has_sex::int + has_age::int + has_village::int + has_gps::int + has_area::int
                      + has_potential::int + consent_recorded::int) / 8)::int as completeness_pct,
       array_remove(array[case when not has_phone then 'TELEPHONE' end, case when not has_sex then 'SEXE' end,
         case when not has_age then 'AGE' end, case when not has_village then 'VILLAGE' end, case when not has_gps then 'GPS' end,
         case when not has_area then 'SUPERFICIE' end, case when not has_potential then 'POTENTIEL' end,
         case when not consent_recorded then 'CONSENTEMENT' end], null) as missing_fields,
       is_qa
from base;

-- Membres : mêmes colonnes qu'avant (ordre conservé) + qualité du dossier en fin, calculée
-- sur la ligne (pas de jointure sur aflp_producer_quality_v : coût RLS sur tout le registre).
create or replace view public.aflp_coop_members_v with (security_invoker = true) as
select m.id as membership_id, m.cooperative_id, m.campaign, m.producer_id, p.code as farmer_id, p.nom, p.prenoms,
       p.village_id, p.village_nom, p.telephone, p.sexe, p.birth_year, p.rt_id, p.consent_status, p.passport_stage,
       p.passport_completion, p.operational_status, p.possible_duplicate,
       m.member_number, m.section_id, s.name as section_name, m.status, m.is_primary, m.verified, m.verification_date,
       m.verification_method, m.source, m.membership_start, m.membership_end, m.followup_rt_id,
       coalesce(pl.area_ha, pb.area_ha, nullif(p.data->>'superficieHa','')::numeric) as area_ha,
       coalesce(pb.forecast_kg, nullif(p.data->>'potentiel2027Kg','')::numeric) as potential_kg,
       case when pb.forecast_kg is not null then 'BASELINE' when nullif(p.data->>'potentiel2027Kg','') is not null then 'DECLARE' else 'NON_COLLECTE' end as potential_source,
       pl.plot_count, pl.gps_plots,
       (select max(a.date) from public.achats a where a.producteur_id = p.id and not coalesce(a.rejet,false)) as last_purchase_date,
       round(100.0 * (q.has_phone::int + q.has_sex::int + q.has_age::int + q.has_village::int + q.has_gps::int + q.has_area::int
                      + q.has_potential::int + q.consent_recorded::int) / 8)::int as completeness_pct,
       array_remove(array[case when not q.has_phone then 'TELEPHONE' end, case when not q.has_sex then 'SEXE' end,
         case when not q.has_age then 'AGE' end, case when not q.has_village then 'VILLAGE' end, case when not q.has_gps then 'GPS' end,
         case when not q.has_area then 'SUPERFICIE' end, case when not q.has_potential then 'POTENTIEL' end,
         case when not q.consent_recorded then 'CONSENTEMENT' end], null) as missing_fields,
       p.age_band, e.enrollment_channel, p.review_required, coalesce((p.data->>'qa')::boolean,false) as is_qa
from public.aflp_coop_memberships m
join public.producteurs p on p.id = m.producer_id and not p.deleted
left join public.aflp_coop_sections s on s.id = m.section_id
left join public.aflp_producer_enrollment e on e.producer_id = p.id
left join lateral (select sum(case when fp.area_unit = 'HA' then fp.declared_area end) as area_ha, count(*) as plot_count,
                          count(*) filter (where fp.latitude is not null and fp.longitude is not null) as gps_plots
                   from public.farmer_plots fp where fp.producteur_id = p.id and not coalesce(fp.deleted,false)) pl on true
left join lateral (select b.forecast_kg, b.productive_area_ha as area_ha from public.farmer_production_baselines b
                   where b.producteur_id = p.id and b.campaign = m.campaign and b.status <> 'CANCELLED' order by b.version desc limit 1) pb on true
cross join lateral (select
         coalesce(length(public.farmer_registry_norm_phone(p.telephone)),0) = 10 as has_phone,
         coalesce(p.sexe in ('M','F','OTHER'), false) as has_sex,
         (p.birth_year is not null or coalesce(p.age_band,'UNKNOWN') <> 'UNKNOWN') as has_age,
         p.village_id is not null as has_village,
         (p.gps_lat is not null or coalesce(pl.gps_plots,0) > 0) as has_gps,
         (coalesce(pl.area_ha,0) > 0 or pb.area_ha is not null or nullif(p.data->>'superficieHa','') is not null) as has_area,
         (pb.forecast_kg is not null or nullif(p.data->>'potentiel2027Kg','') is not null) as has_potential,
         coalesce(p.consent_status,'NOT_RECORDED') <> 'NOT_RECORDED' as consent_recorded) q;

grant select on public.aflp_producer_quality_v, public.aflp_coop_members_v to authenticated;
revoke all on public.aflp_producer_quality_v, public.aflp_coop_members_v from anon;

do $$ declare f text; begin
  foreach f in array array['public.aflp_coop_match_producers_v2(jsonb)','public.aflp_coop_enroll_producer(jsonb)',
    'public.aflp_coop_review_decide(uuid,text,text,text,jsonb)','public.aflp_coop_import_rows(uuid,text,uuid,text,integer,jsonb,boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['private.aflp_match_core(jsonb)','private.aflp_can_force_create()',
    'private.aflp_queue_candidate(uuid,text,text,jsonb,text,text,uuid,integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
