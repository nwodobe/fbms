-- Multi-campagnes · 3/3 — cycle de vie : créer, copier la configuration, préparer et ouvrir, clôturer (contrôles,
-- réserves, instantané figé), réouverture exceptionnelle, archivage, export et suppression contrôlée des simulations.
--
-- Droits (rôle lu dans profils via mon_role) :
--   créer, paramétrer, ouvrir, passer en clôture, clôturer, archiver, supprimer une simulation : Branch Manager, General Manager ;
--   périmètre et objectifs : Branch Manager, Assistant Branch Manager, General Manager ;
--   réouverture exceptionnelle : General Manager seul ;
--   consultation des contrôles, de l'analyse de suppression et des exports : direction (BM, ABM, GM, Zonal Head, Finance, Auditeur).
-- Une campagne REAL n'est jamais supprimée (archivage uniquement).

create or replace function private.campaign_require(p_roles text[]) returns text
language plpgsql stable security definer set search_path = public, private as $$
declare v text := private.campaign_role();
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not (v = any (p_roles)) then
    raise exception 'Action réservée à : %.', array_to_string(p_roles, ', ') using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function private.campaign_get(p_id uuid) returns public.campaigns
language plpgsql stable security definer set search_path = public, private as $$
declare c public.campaigns;
begin
  select * into c from public.campaigns where id = p_id;
  if not found then raise exception 'Campagne introuvable.' using errcode = 'P0002'; end if;
  return c;
end $$;

create or replace function private.campaign_type_fr(p text) returns text
language sql immutable set search_path = public, private as $$
  select case p when 'REAL' then 'REELLE' when 'DEMO' then 'DEMO' when 'SIMULATION' then 'SIMULATION'
    when 'TRAINING' then 'FORMATION' when 'QA' then 'QA' else p end $$;

-- Copie de configuration (jamais de transaction : ni achat, avance, livraison, stock, LOT, transfert, réception,
-- qualité ou performance)
create or replace function private.campaign_copy_config(p_src uuid, p_dst uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.campaigns := private.campaign_get(p_src); d public.campaigns := private.campaign_get(p_dst);
        n_part int; n_tgt int; n_coop int; n_rule int; n_ctrl int; n_prog int;
begin
  insert into public.campaign_participants (campaign_id, kind, ref_id, ref_label, parent_ref, role, meta, active, created_by)
  select p_dst, kind, ref_id, ref_label, parent_ref, role, meta, active, auth.uid()
  from public.campaign_participants where campaign_id = p_src and active
  on conflict (campaign_id, kind, ref_id) do nothing;
  get diagnostics n_part = row_count;

  -- Structure des objectifs conservée, valeurs remises à zéro (à saisir pour la nouvelle campagne)
  insert into public.campaign_targets (campaign_id, level, ref_id, ref_label, target_mt, updated_by)
  select p_dst, level, ref_id, ref_label, null, auth.uid() from public.campaign_targets where campaign_id = p_src
  on conflict (campaign_id, level, ref_id) do nothing;
  get diagnostics n_tgt = row_count;

  -- Coopératives participantes : modèle d'achat, responsables, RT référent, entrepôt. Potentiel, objectif et volume
  -- sécurisé repartent de zéro.
  insert into public.aflp_coop_campaigns (cooperative_id, campaign, campaign_id, payment_model, zone_head_name, unit_head_name,
                                          referent_rt_id, destination_warehouse_id, notes, created_by)
  select cc.cooperative_id, d.code, p_dst, cc.payment_model, cc.zone_head_name, cc.unit_head_name, cc.referent_rt_id,
         cc.destination_warehouse_id, 'Copié de la campagne ' || s.code, auth.uid()
  from public.aflp_coop_campaigns cc join public.aflp_cooperatives c on c.id = cc.cooperative_id and not coalesce(c.archived, false)
  where cc.campaign_id = p_src
  on conflict (cooperative_id, campaign) do nothing;
  get diagnostics n_coop = row_count;

  insert into public.procurement_campaign_rules (campaign, campaign_id, channel_code, zone_code, status, effective_from, price_per_kg,
                                                 min_kor, max_moisture_pct, rt_commission_per_kg, source, reason)
  select d.code, p_dst, r.channel_code, r.zone_code, 'ACTIVE', coalesce(d.start_date, make_date(d.year, 1, 1)), r.price_per_kg,
         r.min_kor, r.max_moisture_pct, r.rt_commission_per_kg, 'COPY_' || s.code,
         'Copié de la campagne ' || s.code || ' : à valider avant ouverture.'
  from public.procurement_campaign_rules r where r.campaign_id = p_src and r.status = 'ACTIVE';
  get diagnostics n_rule = row_count;

  insert into public.aflp_campaign_controls (campaign, campaign_id, control_code, enabled, nature, description, decision_note)
  select d.code, p_dst, control_code, enabled, nature, description, 'Copié de la campagne ' || s.code
  from public.aflp_campaign_controls where campaign_id = p_src
  on conflict do nothing;
  get diagnostics n_ctrl = row_count;

  insert into public.aflp_program_targets (campaign, campaign_id, scope_type, scope_code, target_mt, source, note, created_by)
  select d.code, p_dst, scope_type, scope_code, 0, 'COPY_' || s.code, 'Structure copiée, objectif à saisir', auth.uid()
  from public.aflp_program_targets where campaign_id = p_src
  on conflict do nothing;
  get diagnostics n_prog = row_count;

  update public.campaigns set config = s.config || coalesce(config, '{}'::jsonb), copied_from = p_src where id = p_dst;

  return jsonb_build_object('participants', n_part, 'targets', n_tgt, 'cooperatives', n_coop, 'price_rules', n_rule,
                            'controls', n_ctrl, 'program_targets', n_prog);
end $$;

create or replace function public.campaign_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_code text := upper(btrim(coalesce(p->>'code',''))); v_copy jsonb; c public.campaigns;
        v_src uuid := nullif(p->>'copy_from','')::uuid;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if v_code = '' then raise exception 'Code de campagne obligatoire (ex. 2028, RCN-2028).' using errcode = '23514'; end if;
  if exists (select 1 from public.campaigns where code = v_code) then
    raise exception 'Le code de campagne % existe déjà.', v_code using errcode = '23505';
  end if;
  insert into public.campaigns (code, name, year, campaign_type, status, start_date, planned_end_date, currency, country, season,
                                description, config, created_by)
  values (v_code, btrim(coalesce(p->>'name','')), (p->>'year')::int, coalesce(nullif(p->>'campaign_type',''),'REAL'),
          case when nullif(p->>'start_date','') is not null and nullif(p->>'planned_end_date','') is not null then 'PLANNING' else 'DRAFT' end,
          nullif(p->>'start_date','')::date, nullif(p->>'planned_end_date','')::date, coalesce(nullif(p->>'currency',''),'XOF'),
          coalesce(nullif(p->>'country',''),'CI'), nullif(btrim(coalesce(p->>'season','')),''), nullif(btrim(coalesce(p->>'description','')),''),
          coalesce(p->'config','{}'::jsonb), auth.uid())
  returning id into v_id;
  if v_src is not null then v_copy := private.campaign_copy_config(v_src, v_id); end if;
  select * into c from public.campaigns where id = v_id;
  perform private.campaign_log(v_id, 'CAMPAIGN_CREATED', nullif(btrim(coalesce(p->>'reason','')),''), null, to_jsonb(c),
                               case when v_copy is null then null else jsonb_build_object('copied_from', v_src, 'copied', v_copy) end);
  return v_id;
end $$;

create or replace function public.campaign_update(p_id uuid, p jsonb, p_row_version int) returns public.campaigns
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.row_version <> p_row_version then
    raise exception 'Cette fiche a été modifiée par un autre utilisateur. Rechargez les données avant d''enregistrer.' using errcode = '40001';
  end if;
  if c.status in ('CLOSED','ARCHIVED') then
    raise exception 'Campagne % % : lecture seule.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  end if;
  if p ? 'campaign_type' and p->>'campaign_type' is distinct from c.campaign_type and c.status not in ('DRAFT','PLANNING','READY') then
    raise exception 'Le type d''une campagne ne change plus après son ouverture.' using errcode = '42501';
  end if;
  update public.campaigns set
    name             = coalesce(nullif(btrim(p->>'name'),''), name),
    campaign_type    = coalesce(nullif(p->>'campaign_type',''), campaign_type),
    start_date       = case when p ? 'start_date' then nullif(p->>'start_date','')::date else start_date end,
    planned_end_date = case when p ? 'planned_end_date' then nullif(p->>'planned_end_date','')::date else planned_end_date end,
    season           = case when p ? 'season' then nullif(btrim(p->>'season'),'') else season end,
    description      = case when p ? 'description' then nullif(btrim(p->>'description'),'') else description end,
    currency         = coalesce(nullif(p->>'currency',''), currency),
    country          = coalesce(nullif(p->>'country',''), country),
    config           = case when p ? 'config' then config || (p->'config') else config end,
    status           = case when status = 'DRAFT' and coalesce(case when p ? 'start_date' then nullif(p->>'start_date','')::date else start_date end, null) is not null
                                 and coalesce(case when p ? 'planned_end_date' then nullif(p->>'planned_end_date','')::date else planned_end_date end, null) is not null
                            then 'PLANNING' else status end
  where id = p_id returning * into n;
  perform private.campaign_log(p_id, 'CAMPAIGN_CONFIG_UPDATED', nullif(btrim(coalesce(p->>'reason','')),''), to_jsonb(c), to_jsonb(n));
  return n;
end $$;

create or replace function public.campaign_participants_set(p_id uuid, p_kind text, p_items jsonb, p_replace boolean default true)
returns int language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n int;
begin
  perform private.campaign_require(array['Branch Manager','Assistant Branch Manager','General Manager']);
  if c.status in ('CLOSED','ARCHIVED') then
    raise exception 'Campagne % % : périmètre en lecture seule.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  end if;
  -- Remplacement par désactivation (l'historique du périmètre reste lisible)
  if p_replace then update public.campaign_participants set active = false where campaign_id = p_id and kind = upper(p_kind); end if;
  insert into public.campaign_participants (campaign_id, kind, ref_id, ref_label, parent_ref, role, meta, created_by)
  select p_id, upper(p_kind), btrim(x->>'ref_id'), nullif(x->>'ref_label',''), nullif(x->>'parent_ref',''), nullif(x->>'role',''),
         coalesce(x->'meta','{}'::jsonb), auth.uid()
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x where nullif(btrim(x->>'ref_id'),'') is not null
  on conflict (campaign_id, kind, ref_id) do update set ref_label = excluded.ref_label, parent_ref = excluded.parent_ref,
    role = excluded.role, meta = excluded.meta, active = true;
  get diagnostics n = row_count;
  perform private.campaign_log(p_id, 'CAMPAIGN_CONFIG_UPDATED', null, null, null, jsonb_build_object('participants', upper(p_kind), 'count', n));
  return n;
end $$;

create or replace function public.campaign_targets_set(p_id uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n int;
begin
  perform private.campaign_require(array['Branch Manager','Assistant Branch Manager','General Manager']);
  if c.status in ('CLOSED','ARCHIVED') then
    raise exception 'Campagne % % : objectifs en lecture seule.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  end if;
  insert into public.campaign_targets (campaign_id, level, ref_id, ref_label, target_mt, updated_by)
  select p_id, upper(x->>'level'), coalesce(btrim(x->>'ref_id'),''), nullif(x->>'ref_label',''), nullif(x->>'target_mt','')::numeric, auth.uid()
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
  on conflict (campaign_id, level, ref_id) do update set target_mt = excluded.target_mt, ref_label = excluded.ref_label,
    updated_at = now(), updated_by = auth.uid();
  get diagnostics n = row_count;
  perform private.campaign_log(p_id, 'CAMPAIGN_CONFIG_UPDATED', null, null, null, jsonb_build_object('targets', n));
  return n;
end $$;

-- Préparer l'ouverture : liste de contrôle. Pour une campagne REAL, les éléments marqués bloquants doivent être faits.
create or replace function public.campaign_open_checklist(p_id uuid)
returns table (code text, label text, ok boolean, blocking boolean, detail text)
language plpgsql stable security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); r boolean := c.campaign_type = 'REAL';
        v_other text; n_zone int; n_vil int; n_rt int; n_wh int; n_coop int; n_sup int; n_users int; v_rule record; v_target numeric;
        cnt jsonb;
begin
  select jsonb_object_agg(kind, n) into cnt from (select kind, count(*) n from public.campaign_participants where campaign_id = p_id and active group by kind) s;
  cnt := coalesce(cnt, '{}'::jsonb);
  n_zone := coalesce((cnt->>'ZONE')::int,0) + coalesce((cnt->>'CLUSTER')::int,0);
  n_vil := coalesce((cnt->>'VILLAGE')::int,0); n_rt := coalesce((cnt->>'RT')::int,0); n_wh := coalesce((cnt->>'WAREHOUSE')::int,0);
  n_coop := coalesce((cnt->>'COOPERATIVE')::int,0) + (select count(*) from public.aflp_coop_campaigns where campaign_id = p_id)::int;
  n_sup := coalesce((cnt->>'LBA')::int,0) + coalesce((cnt->>'SUPPLIER')::int,0);
  select count(*) into n_users from public.profils where coalesce(actif, true);
  select * into v_rule from public.procurement_campaign_rules where campaign_id = p_id and status = 'ACTIVE' and channel_code = 'FIELD_BUYING'
    order by effective_from desc limit 1;
  select target_mt into v_target from public.campaign_targets where campaign_id = p_id and level = 'CAMPAIGN' and ref_id = '';
  select x.code into v_other from public.campaigns x where x.campaign_type = 'REAL' and x.status = 'OPEN' and x.id <> p_id limit 1;

  return query values
    ('IDENTITY', 'Campagne créée (nom, année, dates)', c.start_date is not null and c.planned_end_date is not null, true,
       coalesce(to_char(c.start_date,'DD/MM/YYYY'),'?') || ' → ' || coalesce(to_char(c.planned_end_date,'DD/MM/YYYY'),'?')),
    ('ZONES', 'Zones / clusters définis', n_zone > 0, r, n_zone || ' zone(s) / cluster(s)'),
    ('VILLAGES', 'Villages définis', n_vil > 0, r, n_vil || ' village(s)'),
    ('RT', 'RT affectés', n_rt > 0, r, n_rt || ' RT'),
    ('WAREHOUSES', 'Warehouses définis', n_wh > 0, r, n_wh || ' entrepôt(s)'),
    ('PRICE', 'Prix configuré (Field Buying)', coalesce(v_rule.price_per_kg, 0) > 0, true, -- sans prix, le moteur Procurement refuse tout achat
       case when v_rule.id is null then 'Aucune règle de prix active' else v_rule.price_per_kg || ' XOF/kg' end),
    ('QUALITY', 'Règles qualité (KOR, humidité)', v_rule.min_kor is not null and v_rule.max_moisture_pct is not null, r,
       case when v_rule.id is null then 'Aucune règle active' else 'KOR min ' || coalesce(v_rule.min_kor::text,'?') || ' · humidité max ' || coalesce(v_rule.max_moisture_pct::text,'?') || ' %' end),
    ('TARGETS', 'Objectif campagne configuré', coalesce(v_target, 0) > 0, r, coalesce(v_target::text || ' MT', 'Non saisi')),
    ('PURCHASE_RULES', 'Règles d''achat configurées', exists (select 1 from public.aflp_campaign_controls where campaign_id = p_id) or v_rule.id is not null, false,
       (select count(*) from public.aflp_campaign_controls where campaign_id = p_id) || ' règle(s) de contrôle'),
    ('SACHERIE', 'Sacherie configurée', (c.config ? 'sacherie') or exists (select 1 from public.aflp_bag_envelopes where campaign_id = p_id), false,
       case when c.config ? 'sacherie' then 'Paramètres saisis' else 'À compléter si des sacs sont distribués' end),
    ('USERS', 'Utilisateurs actifs', n_users > 0, false, n_users || ' compte(s) actif(s)'),
    ('SUPPLIERS', 'LBA / fournisseurs', n_sup > 0, false, n_sup || ' partenaire(s)'),
    ('COOPERATIVES', 'Coopératives', n_coop > 0, false, n_coop || ' coopérative(s)'),
    ('SINGLE_REAL', 'Une seule campagne REAL ouverte', not r or v_other is null, true,
       case when r and v_other is not null then 'Campagne ' || v_other || ' encore ouverte : passez-la en clôture avant.' else 'OK' end);
end $$;

create or replace function public.campaign_open(p_id uuid, p_confirm text) returns public.campaigns
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns; v_missing text; v_check jsonb;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.status not in ('DRAFT','PLANNING','READY') then
    raise exception 'Campagne % % : ouverture impossible.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  end if;
  if upper(btrim(coalesce(p_confirm,''))) <> 'OUVRIR ' || c.code then
    raise exception 'Confirmation invalide : saisissez « OUVRIR % ».', c.code using errcode = '22023';
  end if;
  select string_agg(label, ', '), (select jsonb_agg(to_jsonb(k)) from public.campaign_open_checklist(p_id) k)
    into v_missing, v_check from public.campaign_open_checklist(p_id) x where x.blocking and not x.ok;
  if v_missing is not null then
    raise exception 'Campagne % à compléter avant ouverture : %.', c.code, v_missing using errcode = '23514';
  end if;
  if c.campaign_type = 'REAL' then update public.campaigns set is_current = false where is_current and id <> p_id; end if;
  update public.campaigns set status = 'OPEN', opened_at = now(), opened_by = auth.uid(),
    is_current = case when campaign_type = 'REAL' or not exists (select 1 from public.campaigns z where z.is_current and z.id <> p_id) then true else is_current end
  where id = p_id returning * into n;
  perform private.campaign_log(p_id, 'CAMPAIGN_OPENED', null, to_jsonb(c), to_jsonb(n),
    jsonb_build_object('checklist', (select jsonb_agg(to_jsonb(k)) from public.campaign_open_checklist(p_id) k)));
  return n;
end $$;

-- Campagne courante = campagne par défaut des écritures. Quand une campagne REAL est ouverte, elle seule peut l'être :
-- un RT ne peut pas enregistrer par erreur dans une simulation (les simulations s'utilisent par sélection explicite).
create or replace function public.campaign_set_current(p_id uuid) returns public.campaigns
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns; v_real text;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.status <> 'OPEN' then raise exception 'Seule une campagne ouverte peut devenir la campagne courante.' using errcode = '42501'; end if;
  select code into v_real from public.campaigns where campaign_type = 'REAL' and status = 'OPEN' and id <> p_id limit 1;
  if c.campaign_type <> 'REAL' and v_real is not null then
    raise exception 'La campagne réelle % est ouverte : elle reste la campagne courante. Une simulation s''utilise en la sélectionnant dans l''en-tête.', v_real
      using errcode = '42501';
  end if;
  update public.campaigns set is_current = false where is_current and id <> p_id;
  update public.campaigns set is_current = true where id = p_id returning * into n;
  perform private.campaign_log(p_id, 'CAMPAIGN_CURRENT_SET', null, null, null);
  return n;
end $$;

-- Contrôles de clôture : BLOQUANT empêche la clôture ; RÉSERVE autorise une clôture avec réserve motivée.
create or replace function public.campaign_close_checklist(p_id uuid)
returns table (domain text, code text, label text, n bigint, severity text, link text)
language plpgsql stable security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id);
begin
  return query
  select * from (values
    ('FIELD BUYING','ACHATS_A_VALIDER','Achats en attente de validation',
      (select count(*) from public.achats a where a.campaign_id = p_id and not coalesce(a.rejet,false)
         and coalesce(a.statut_validation,'') not ilike 'valid%' and coalesce(a.statut_validation,'') not ilike 'rejet%'),
      'BLOQUANT','field-buying.html#achats'),
    ('FIELD BUYING','STOCK_TERRAIN','Stock terrain non évacué (achats au stock non libéré)',
      (select count(*) from public.achats a where a.campaign_id = p_id and not coalesce(a.rejet,false) and coalesce(a.stock_statut,'') ilike '%non lib%'),
      'BLOQUANT','field-buying.html#achats'),
    ('FIELD BUYING','CASH_NON_RECONCILIE','Achats non réconciliés en caisse',
      (select count(*) from public.achats a where a.campaign_id = p_id and not coalesce(a.rejet,false) and coalesce(a.cash_statut,'') ilike '%non r%'),
      'RÉSERVE','field-buying.html#caisse'),
    ('FIELD BUYING','EXPEDITIONS_TERRAIN','Expéditions terrain en cours',
      (select count(*) from public.field_shipments s where s.campaign_id = p_id and s.status in ('LOADING','DISPATCHED')),
      'BLOQUANT','field-buying.html#hubs'),
    ('AVANCES','AVANCES_OUVERTES','Avances RT encore ouvertes',
      (select count(*) from public.avances v where v.campaign_id = p_id and coalesce(v.statut,'') ilike 'activ%'),
      'BLOQUANT','field-buying.html#caisse'),
    ('SACHERIE','DEMANDES_SACS','Demandes de sacs non clôturées',
      (select count(*) from public.ops_bag_requests r where r.campaign_id = p_id and r.status not in ('RECEIVED','CLOSED','REJECTED','CANCELLED','EXPIRED')),
      'RÉSERVE','field-buying.html#sacherie'),
    ('SACHERIE','SACS_A_RAPPROCHER','Rapprochements de sacs à compléter',
      (select count(*) from public.rcn_jute_reconciliations j where j.campaign_id = p_id and j.status in ('A_COMPLETER','A_RAPPROCHER')),
      'RÉSERVE','field-buying.html#sacherie'),
    ('SACHERIE','TRANSFERTS_SACS','Transferts de sacs non clos',
      (select count(*) from public.rcn_jute_transfers t where t.campaign_id = p_id and coalesce(t.statut,'') not in ('CLOS','ANNULE')),
      'RÉSERVE','field-buying.html#sacherie'),
    ('PROCUREMENT','REGLEMENTS_A_APPROUVER','Achats Procurement en attente d''approbation',
      (select count(*) from public.procurement_reception_settlements s where s.campaign_id = p_id and s.status in ('DRAFT','SUBMITTED','CHANGES_REQUESTED')),
      'BLOQUANT','procurement.html#purchases'),
    ('PROCUREMENT','PAIEMENTS_EN_ATTENTE','Paiements en attente',
      (select count(*) from public.procurement_reception_settlements s where s.campaign_id = p_id and s.status = 'APPROVED' and s.payment_status <> 'PAID'),
      'BLOQUANT','procurement.html#purchases'),
    ('PROCUREMENT','REJETS_OUVERTS','Dossiers de rejet ouverts',
      (select count(*) from public.procurement_rejection_cases x where x.campaign_id = p_id and x.status = 'OPEN'),
      'BLOQUANT','procurement.html#inbound'),
    ('PROCUREMENT','CYCLES_LBA','Cycles de financement LBA ouverts',
      (select count(*) from public.lba_funding_cycles l where l.campaign_id = p_id and l.status in ('OPEN','ON_HOLD')),
      'BLOQUANT','procurement.html#suppliers'),
    ('PROCUREMENT','ARRIVEES_NON_RECUES','Arrivées planifiées non reçues',
      (select count(*) from public.rcn_proc_arrivages a where a.campaign_id = p_id and a.reception_id is null and a.cancelled_at is null),
      'RÉSERVE','procurement.html#inbound'),
    ('COOPÉRATIVES','LIVRAISONS_NON_RECUES','Livraisons coop planifiées non reçues',
      (select count(*) from public.aflp_coop_deliveries d where d.campaign_id = p_id and d.status in ('PLANIFIEE','EN_ROUTE')),
      'BLOQUANT','field-buying.html#cooperatives'),
    ('COOPÉRATIVES','ALLOCATIONS_INCOMPLETES','Livraisons reçues sans allocation producteurs',
      (select count(*) from public.aflp_coop_deliveries d where d.campaign_id = p_id and d.status = 'RECUE'
         and not exists (select 1 from public.aflp_coop_delivery_allocations x where x.delivery_id = d.id)),
      'RÉSERVE','field-buying.html#cooperatives'),
    ('WAREHOUSE','RECEPTIONS_OUVERTES','Camions / réceptions non clôturés',
      (select count(*) from public.wms_receptions w where w.campaign_id = p_id and w.status in ('ARRIVED','AWAITING_DECISION','ACCEPTED_WAITING_OFFLOAD')),
      'BLOQUANT','warehouse.html#receptions'),
    ('QUALITY','QUALITE_FINALE','Réceptions sans qualité finale ou en HOLD qualité',
      (select count(*) from public.wms_receptions w where w.campaign_id = p_id and w.status in ('AWAITING_FINAL_QA','QUALITY_HOLD')),
      'BLOQUANT','warehouse.html#quality'),
    ('QUALITY','LOT_HOLD','LOT en HOLD / quarantaine / décision',
      (select count(*) from public.wms_lots l where l.campaign_id = p_id and l.status in ('QUARANTINE','HOLD','REQUIRES_DECISION')),
      'BLOQUANT','warehouse.html#lots'),
    ('WAREHOUSE','INVENTAIRE','Inventaires non rapprochés',
      (select count(*) from public.wms_inventory_counts i where i.campaign_id = p_id and i.status = 'REVIEW_REQUIRED'),
      'BLOQUANT','warehouse.html#inventory'),
    ('WAREHOUSE','STOCK_REPORTE','Stock disponible reporté sur la campagne suivante',
      (select count(*) from public.wms_lots l where l.campaign_id = p_id and l.status = 'RELEASED'),
      'RÉSERVE','warehouse.html#stock'),
    ('TRANSFER','TRANSFERTS_EN_COURS','Transferts ouverts ou en transit',
      (select count(*) from public.wms_transfers t where t.campaign_id = p_id and t.status in ('REQUESTED','APPROVED','READY_TO_LOAD','LOADED','IN_TRANSIT')),
      'BLOQUANT','stock-transfer.html'),
    ('FACTORY','RECEPTION_NON_CONFIRMEE','Transferts arrivés non réconciliés (écart ou réception non confirmée)',
      (select count(*) from public.wms_transfers t where t.campaign_id = p_id and t.status in ('ARRIVED','DISCREPANCY','RESOLUTION_PENDING')),
      'BLOQUANT','stock-transfer.html'),
    ('TRACEABILITY','ORIGINE_INCONNUE','Achats sans producteur identifié',
      (select count(*) from public.achats a where a.campaign_id = p_id and not coalesce(a.rejet,false) and a.producteur_id is null),
      'RÉSERVE','traceability.html')
  ) v(domain, code, label, n, severity, link);
end $$;

create or replace function public.campaign_start_closing(p_id uuid, p_reason text default null) returns public.campaigns
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.status <> 'OPEN' then raise exception 'Seule une campagne ouverte peut passer en clôture.' using errcode = '42501'; end if;
  update public.campaigns set status = 'CLOSING', closing_started_at = now(), closing_started_by = auth.uid() where id = p_id returning * into n;
  perform private.campaign_log(p_id, 'CAMPAIGN_CLOSING_STARTED', p_reason, to_jsonb(c), to_jsonb(n),
    jsonb_build_object('checklist', (select jsonb_agg(to_jsonb(k)) from public.campaign_close_checklist(p_id) k where k.n > 0)));
  return n;
end $$;

-- Instantané final : chiffres figés de la campagne (les référentiels peuvent évoluer ensuite sans le modifier)
create or replace function private.campaign_snapshot_payload(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with a as (select * from public.achats where campaign_id = p_id and not coalesce(rejet,false))
  select jsonb_build_object(
    'campaign', (select to_jsonb(c) - 'config' from public.campaigns c where c.id = p_id),
    'generated_at', now(),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('level', level, 'ref', ref_id, 'label', ref_label, 'target_mt', target_mt)), '[]') from public.campaign_targets where campaign_id = p_id),
    'field_buying', (select jsonb_build_object('achats', count(*), 'producteurs_actifs', count(distinct producteur_id), 'kg_net', coalesce(sum(poids_net),0),
                       'montant_xof', coalesce(sum(montant),0), 'prix_moyen_xof_kg', case when sum(poids_net) > 0 then round(sum(montant)/sum(poids_net),2) end,
                       'kor_moyen', round(avg(kor),2), 'humidite_moyenne', round(avg(humidite),2)) from a),
    'par_canal', (select coalesce(jsonb_object_agg(coalesce(sourcing_channel,'NON_RENSEIGNE'), kg), '{}') from (select sourcing_channel, sum(poids_net) kg from a group by 1) s),
    'par_rt', (select coalesce(jsonb_agg(jsonb_build_object('rt_id', rt_id, 'rt', rt_nom, 'kg', kg, 'achats', n) order by kg desc), '[]')
               from (select rt_id, max(rt_nom) rt_nom, sum(poids_net) kg, count(*) n from a group by rt_id) s),
    'par_cooperative', (select coalesce(jsonb_agg(jsonb_build_object('cooperative_id', cooperative_id, 'kg', kg, 'achats', n)), '[]')
               from (select cooperative_id, sum(poids_net) kg, count(*) n from a where cooperative_id is not null group by 1) s),
    'cooperatives', (select coalesce(jsonb_agg(jsonb_build_object('cooperative_id', cc.cooperative_id, 'code', co.code, 'nom', co.name, 'target_mt', cc.target_mt,
                       'potentiel_mt', cc.declared_potential_mt, 'securise_mt', cc.secured_volume_mt,
                       'livre_kg', (select coalesce(sum(delivered_kg),0) from public.aflp_coop_deliveries d where d.campaign_id = p_id and d.cooperative_id = cc.cooperative_id and d.status = 'RECUE'),
                       'membres', (select count(*) from public.aflp_coop_memberships m where m.campaign_id = p_id and m.cooperative_id = cc.cooperative_id and m.status <> 'ENDED'))), '[]')
                     from public.aflp_coop_campaigns cc join public.aflp_cooperatives co on co.id = cc.cooperative_id where cc.campaign_id = p_id),
    'avances', (select jsonb_build_object('nombre', count(*), 'montant_xof', coalesce(sum(montant),0)) from public.avances where campaign_id = p_id),
    'sacherie', (select coalesce(jsonb_object_agg(type, q), '{}') from (select type, sum(quantite) q from public.sacs_mouvements where campaign_id = p_id group by 1) s),
    'warehouse', (select jsonb_build_object('receptions', count(*), 'net_kg', coalesce(sum(net_kg),0),
                     'par_canal', (select coalesce(jsonb_object_agg(coalesce(procurement_channel,'NON_RENSEIGNE'), kg), '{}') from (select procurement_channel, sum(net_kg) kg from public.wms_receptions where campaign_id = p_id group by 1) s))
                  from public.wms_receptions where campaign_id = p_id),
    'lots', (select jsonb_build_object('lots', count(*), 'kg_initial', coalesce(sum(initial_kg),0), 'kor_final_moyen', round(avg(kor_final),2),
                 'humidite_finale_moyenne', round(avg(moisture_final),2), 'stock_reporte_lots', count(*) filter (where status = 'RELEASED')) from public.wms_lots where campaign_id = p_id),
    'transferts', (select jsonb_build_object('transferts', count(*), 'expedie_kg', coalesce(sum(dispatched_qty),0), 'recu_kg', coalesce(sum(received_qty),0),
                 'ecart_kg', coalesce(sum(variance_kg),0)) from public.wms_transfers where campaign_id = p_id),
    'procurement', (select jsonb_build_object('reglements', count(*), 'montant_approuve_xof', coalesce(sum(amount_approved),0)) from public.procurement_reception_settlements where campaign_id = p_id),
    'sustainability', (select jsonb_build_object('diagnostics', count(*)) from public.farmer_sustainability_baselines where campaign_id = p_id),
    'exceptions', (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.campaign_close_checklist(p_id) k where k.n > 0)
  ) $$;

create or replace function public.campaign_close(p_id uuid, p_confirm text, p_reason text default null, p_with_reserves boolean default false)
returns public.campaigns language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns; v_block bigint; v_res bigint; v_list jsonb; v_snap uuid; v_next uuid;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.status <> 'CLOSING' then raise exception 'Passez d''abord la campagne en clôture (« Préparer la clôture »).' using errcode = '42501'; end if;
  if upper(btrim(coalesce(p_confirm,''))) <> 'CLOTURER ' || c.code then
    raise exception 'Confirmation invalide : saisissez « CLOTURER % ».', c.code using errcode = '22023';
  end if;
  select coalesce(sum(k.n) filter (where k.severity = 'BLOQUANT'),0), coalesce(sum(k.n) filter (where k.severity = 'RÉSERVE'),0),
         jsonb_agg(to_jsonb(k)) filter (where k.n > 0)
    into v_block, v_res, v_list from public.campaign_close_checklist(p_id) k;
  if v_block > 0 then
    raise exception '% anomalie(s) bloquante(s) empêchent la clôture de la campagne %.', v_block, c.code using errcode = '23514';
  end if;
  if v_res > 0 and not coalesce(p_with_reserves,false) then
    raise exception '% réserve(s) restent ouvertes : clôture avec réserve requise (management, motif obligatoire).', v_res using errcode = '23514';
  end if;
  if v_res > 0 and length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'Motif obligatoire (10 caractères minimum) pour une clôture avec réserve.' using errcode = '23514';
  end if;
  insert into public.campaign_snapshots (campaign_id, kind, payload, created_by)
  values (p_id, 'FINAL', private.campaign_snapshot_payload(p_id), auth.uid()) returning id into v_snap;
  update public.campaigns set status = 'CLOSED', closed_at = now(), closed_by = auth.uid(), actual_end_date = coalesce(actual_end_date, current_date),
    closed_with_reserves = v_res > 0, is_current = false where id = p_id returning * into n;
  if c.is_current then
    select id into v_next from public.campaigns where status = 'OPEN' order by (campaign_type = 'REAL') desc, opened_at desc limit 1;
    if v_next is not null then update public.campaigns set is_current = true where id = v_next; end if;
  end if;
  perform private.campaign_log(p_id, 'CAMPAIGN_CLOSED', p_reason, to_jsonb(c), to_jsonb(n),
    jsonb_build_object('snapshot_id', v_snap, 'reserves', coalesce(v_list,'[]'::jsonb), 'new_current', v_next));
  return n;
end $$;

create or replace function public.campaign_reopen(p_id uuid, p_reason text, p_confirm text) returns public.campaigns
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns;
begin
  perform private.campaign_require(array['General Manager']);
  if c.status <> 'CLOSED' then raise exception 'Seule une campagne clôturée peut être rouverte.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason,''))) < 15 then raise exception 'Motif obligatoire (15 caractères minimum).' using errcode = '23514'; end if;
  if upper(btrim(coalesce(p_confirm,''))) <> 'ROUVRIR ' || c.code then
    raise exception 'Confirmation invalide : saisissez « ROUVRIR % ».', c.code using errcode = '22023';
  end if;
  -- Réouverture en clôture : corrections et rapprochements possibles, aucun nouvel achat.
  update public.campaigns set status = 'CLOSING', reopened_count = reopened_count + 1, closed_at = null, closed_by = null
  where id = p_id returning * into n;
  perform private.campaign_log(p_id, 'CAMPAIGN_REOPENED', p_reason, to_jsonb(c), to_jsonb(n));
  return n;
end $$;

create or replace function public.campaign_archive(p_id uuid, p_reason text default null) returns public.campaigns
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); n public.campaigns;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.status <> 'CLOSED' then raise exception 'Seule une campagne clôturée peut être archivée.' using errcode = '42501'; end if;
  update public.campaigns set status = 'ARCHIVED', archived_at = now(), archived_by = auth.uid() where id = p_id returning * into n;
  perform private.campaign_log(p_id, 'CAMPAIGN_ARCHIVED', p_reason, to_jsonb(c), to_jsonb(n));
  return n;
end $$;

-- Analyse de suppression : ne supprime rien, compte tout.
create or replace function public.campaign_purge_preview(p_id uuid)
returns table (object text, table_name text, n bigint, action text)
language plpgsql stable security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); r record; v bigint; v_act text;
begin
  perform private.campaign_require(array['Branch Manager','Assistant Branch Manager','General Manager','Zonal Head','Finance','Viewer / Auditor']);
  v_act := case when c.campaign_type = 'REAL' then 'INTERDIT (campagne réelle)' else 'SUPPRIMER' end;
  for r in select * from private.campaign_scoped_tables order by purge_rank loop
    execute format('select count(*) from public.%I where %s', r.table_name, r.predicate) into v using p_id;
    if v > 0 then object := r.label_fr; table_name := r.table_name; n := v; action := v_act; return next; end if;
  end loop;
  for object, table_name, n in values
    ('Périmètre et organisation de la campagne', 'campaign_participants', (select count(*) from public.campaign_participants x where x.campaign_id = p_id)),
    ('Objectifs de la campagne', 'campaign_targets', (select count(*) from public.campaign_targets x where x.campaign_id = p_id)),
    ('Producteurs de la campagne (affectations annuelles)', 'producer_campaigns', (select count(*) from public.producer_campaigns x where x.campaign_id = p_id)),
    ('Instantanés de clôture', 'campaign_snapshots', (select count(*) from public.campaign_snapshots x where x.campaign_id = p_id))
  loop if n > 0 then action := v_act; return next; end if; end loop;
  object := 'Producteurs QA créés pour cette campagne (is_qa)'; table_name := 'producteurs';
  n := (select count(*) from public.producteurs p where p.is_qa and p.qa_campaign_id = p_id);
  action := case when c.campaign_type = 'REAL' then 'CONSERVER' else 'SUPPRIMER SI L''OPTION EST COCHÉE' end; if n > 0 then return next; end if;
  object := 'Coopératives QA créées pour cette campagne (is_qa)'; table_name := 'aflp_cooperatives';
  n := (select count(*) from public.aflp_cooperatives x where x.is_qa and x.qa_campaign_id = p_id); if n > 0 then return next; end if;
  for object, table_name, n in values
    ('Farmer Registry (producteurs permanents)', 'producteurs', (select count(*) from public.producteurs p where not (p.is_qa and p.qa_campaign_id is not distinct from p_id))),
    ('Villages', 'villages', (select count(*) from public.villages)),
    ('RT', 'rt', (select count(*) from public.rt)),
    ('Coopératives permanentes', 'aflp_cooperatives', (select count(*) from public.aflp_cooperatives x where not (x.is_qa and x.qa_campaign_id is not distinct from p_id))),
    ('Fournisseurs / LBA', 'procurement_suppliers', (select count(*) from public.procurement_suppliers)),
    ('Warehouses', 'wms_warehouses', (select count(*) from public.wms_warehouses)),
    ('Utilisateurs', 'profils', (select count(*) from public.profils))
  loop action := 'CONSERVER'; return next; end loop;
end $$;

create or replace function public.campaign_export(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); r record; v jsonb; out jsonb := '{}'::jsonb;
begin
  perform private.campaign_require(array['Branch Manager','Assistant Branch Manager','General Manager','Finance','Viewer / Auditor']);
  for r in select * from private.campaign_scoped_tables order by purge_rank desc loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where %s', r.table_name, r.predicate) into v using p_id;
    if jsonb_array_length(v) > 0 then out := out || jsonb_build_object(r.table_name, v); end if;
  end loop;
  out := out || jsonb_build_object(
    'campaign_participants', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.campaign_participants x where x.campaign_id = p_id),
    'campaign_targets', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.campaign_targets x where x.campaign_id = p_id),
    'producer_campaigns', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.producer_campaigns x where x.campaign_id = p_id),
    'campaign_snapshots', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.campaign_snapshots x where x.campaign_id = p_id),
    'campaign_events', (select coalesce(jsonb_agg(to_jsonb(x) order by x.at),'[]') from public.campaign_events x where x.campaign_id = p_id));
  if c.campaign_type <> 'REAL' then perform private.campaign_log(p_id, 'SIMULATION_EXPORTED', null, null, null); end if;
  return jsonb_build_object('campaign', to_jsonb(c), 'generated_at', now(), 'source', 'ANAGROCI Operations', 'tables', out);
end $$;

-- Tableau de bord : une ligne par campagne avec les indicateurs principaux (jamais mélangés entre campagnes)
create or replace function public.campaign_dashboard() returns table (
  id uuid, code text, name text, campaign_type text, status text, year int, is_current boolean, start_date date, planned_end_date date,
  closed_at timestamptz, closed_with_reserves boolean, target_mt numeric, achats bigint, achats_kg numeric, producteurs bigint,
  coop_membres bigint, livraisons_coop bigint, receptions bigint, recu_kg numeric, stock_lots bigint, transferts bigint, factory_recu_kg numeric,
  avances_xof numeric, row_version int)
language sql stable security definer set search_path = public, private as $$
  select c.id, c.code, c.name, c.campaign_type, c.status, c.year, c.is_current, c.start_date, c.planned_end_date, c.closed_at, c.closed_with_reserves,
    (select target_mt from public.campaign_targets t where t.campaign_id = c.id and t.level = 'CAMPAIGN' and t.ref_id = ''),
    (select count(*) from public.achats a where a.campaign_id = c.id and not coalesce(a.rejet,false)),
    (select coalesce(sum(poids_net),0) from public.achats a where a.campaign_id = c.id and not coalesce(a.rejet,false)),
    (select count(distinct producteur_id) from public.achats a where a.campaign_id = c.id and not coalesce(a.rejet,false)),
    (select count(*) from public.aflp_coop_memberships m where m.campaign_id = c.id and m.status <> 'ENDED'),
    (select count(*) from public.aflp_coop_deliveries d where d.campaign_id = c.id),
    (select count(*) from public.wms_receptions w where w.campaign_id = c.id),
    (select coalesce(sum(net_kg),0) from public.wms_receptions w where w.campaign_id = c.id and w.status not in ('REJECTED')),
    (select count(*) from public.wms_lots l where l.campaign_id = c.id and l.status not in ('EXHAUSTED','CLOSED','REJECTED')),
    (select count(*) from public.wms_transfers t where t.campaign_id = c.id),
    (select coalesce(sum(received_qty),0) from public.wms_transfers t where t.campaign_id = c.id and t.status in ('RECONCILED','CLOSED')),
    (select coalesce(sum(montant),0) from public.avances v where v.campaign_id = c.id),
    c.row_version
  from public.campaigns c
  where auth.uid() is not null
  order by (c.status in ('OPEN','CLOSING')) desc, c.year desc, c.code $$;

-- Historique d'un producteur par campagne (Traceability 360) : une ligne par campagne, jamais mélangée
create or replace function public.campaign_farmer_history(p_producer text) returns table (
  campaign_id uuid, code text, name text, campaign_type text, status text, channel text, rt_id text, rt_nom text, village_nom text,
  cooperative_code text, member_number text, achats bigint, kg numeric, potentiel_kg numeric)
language sql stable security definer set search_path = public, private as $$
  with p as (select id from public.producteurs where id = p_producer or code = p_producer limit 1),
  camps as (
    select a.campaign_id from public.achats a, p where a.producteur_id = p.id and a.campaign_id is not null
    union select m.campaign_id from public.aflp_coop_memberships m, p where m.producer_id = p.id and m.campaign_id is not null
    union select pc.campaign_id from public.producer_campaigns pc, p where pc.producer_id = p.id
    union select b.campaign_id from public.farmer_production_baselines b, p where b.producteur_id = p.id and b.campaign_id is not null)
  select c.id, c.code, c.name, c.campaign_type, c.status,
    coalesce(pc.channel, (select max(a.sourcing_channel) from public.achats a, p where a.producteur_id = p.id and a.campaign_id = c.id),
             case when m.id is not null then 'COOPERATIVE' end),
    coalesce(pc.rt_id, (select a.rt_id from public.achats a, p where a.producteur_id = p.id and a.campaign_id = c.id order by a.date desc limit 1), m.followup_rt_id),
    (select a.rt_nom from public.achats a, p where a.producteur_id = p.id and a.campaign_id = c.id order by a.date desc limit 1),
    (select a.village_nom from public.achats a, p where a.producteur_id = p.id and a.campaign_id = c.id order by a.date desc limit 1),
    co.code, m.member_number,
    (select count(*) from public.achats a, p where a.producteur_id = p.id and a.campaign_id = c.id and not coalesce(a.rejet,false)),
    (select coalesce(sum(a.poids_net),0) from public.achats a, p where a.producteur_id = p.id and a.campaign_id = c.id and not coalesce(a.rejet,false)),
    coalesce(pc.potential_kg, (select b.forecast_kg from public.farmer_production_baselines b, p where b.producteur_id = p.id and b.campaign_id = c.id order by b.version desc limit 1))
  from camps x join public.campaigns c on c.id = x.campaign_id
  left join public.producer_campaigns pc on pc.campaign_id = c.id and pc.producer_id = (select id from p)
  left join lateral (select * from public.aflp_coop_memberships mm where mm.producer_id = (select id from p) and mm.campaign_id = c.id
                     order by mm.is_primary desc, mm.created_at desc limit 1) m on true
  left join public.aflp_cooperatives co on co.id = coalesce(pc.cooperative_id, m.cooperative_id)
  where auth.uid() is not null
  order by c.year desc, c.code $$;

-- Affectation annuelle du producteur tenue à jour par les achats et les affiliations (une ligne par campagne)
create or replace function private.producer_campaign_touch() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.campaign_id is null then return new; end if;
  if tg_table_name = 'achats' and new.producteur_id is not null then
    insert into public.producer_campaigns (campaign_id, producer_id, channel, rt_id, village_id, cooperative_id, membership_id, section_id)
    values (new.campaign_id, new.producteur_id,
            case when new.sourcing_channel in ('AFLP_DIRECT','COOPERATIVE','NO_COOP','LBA','DIRECT_SUPPLIER') then new.sourcing_channel end,
            new.rt_id, new.village_id, new.cooperative_id, new.coop_membership_id, new.coop_section_id)
    on conflict (campaign_id, producer_id) do update set
      rt_id = coalesce(excluded.rt_id, producer_campaigns.rt_id), village_id = coalesce(excluded.village_id, producer_campaigns.village_id),
      channel = coalesce(producer_campaigns.channel, excluded.channel), cooperative_id = coalesce(producer_campaigns.cooperative_id, excluded.cooperative_id),
      updated_at = now();
  elsif tg_table_name = 'aflp_coop_memberships' and new.is_primary and new.status <> 'ENDED' then
    insert into public.producer_campaigns (campaign_id, producer_id, channel, rt_id, cooperative_id, membership_id, section_id)
    values (new.campaign_id, new.producer_id, 'COOPERATIVE', new.followup_rt_id, new.cooperative_id, new.id, new.section_id)
    on conflict (campaign_id, producer_id) do update set channel = 'COOPERATIVE', cooperative_id = excluded.cooperative_id,
      membership_id = excluded.membership_id, section_id = excluded.section_id, rt_id = coalesce(excluded.rt_id, producer_campaigns.rt_id), updated_at = now();
  end if;
  return new;
exception when others then
  return new; -- l'affectation annuelle est une vue de synthèse : elle ne bloque jamais une opération
end $$;
create or replace trigger trg_zzz_producer_campaign_touch after insert or update on public.achats
  for each row execute function private.producer_campaign_touch();
create or replace trigger trg_zzz_producer_campaign_touch after insert or update on public.aflp_coop_memberships
  for each row execute function private.producer_campaign_touch();

-- Rattrapage des affectations annuelles de la campagne de simulation à partir des données existantes
insert into public.producer_campaigns (campaign_id, producer_id, channel, rt_id, village_id, cooperative_id, membership_id, section_id)
select distinct on (m.campaign_id, m.producer_id) m.campaign_id, m.producer_id, 'COOPERATIVE', m.followup_rt_id, null, m.cooperative_id, m.id, m.section_id
from public.aflp_coop_memberships m where m.campaign_id is not null and m.is_primary and m.status <> 'ENDED'
on conflict (campaign_id, producer_id) do nothing;
insert into public.producer_campaigns (campaign_id, producer_id, channel, rt_id, village_id, cooperative_id)
select distinct on (a.campaign_id, a.producteur_id) a.campaign_id, a.producteur_id,
       case when a.sourcing_channel in ('AFLP_DIRECT','COOPERATIVE','NO_COOP','LBA','DIRECT_SUPPLIER') then a.sourcing_channel end,
       a.rt_id, a.village_id, a.cooperative_id
from public.achats a where a.campaign_id is not null and a.producteur_id is not null
order by a.campaign_id, a.producteur_id, a.date desc
on conflict (campaign_id, producer_id) do nothing;

-- Droits
revoke execute on function private.campaign_require(text[]), private.campaign_get(uuid), private.campaign_type_fr(text),
  private.campaign_copy_config(uuid, uuid), private.campaign_snapshot_payload(uuid), private.producer_campaign_touch()
  from public, anon, authenticated;
revoke execute on function public.campaign_create(jsonb), public.campaign_update(uuid, jsonb, int),
  public.campaign_participants_set(uuid, text, jsonb, boolean), public.campaign_targets_set(uuid, jsonb),
  public.campaign_open_checklist(uuid), public.campaign_open(uuid, text), public.campaign_set_current(uuid),
  public.campaign_close_checklist(uuid), public.campaign_start_closing(uuid, text), public.campaign_close(uuid, text, text, boolean),
  public.campaign_reopen(uuid, text, text), public.campaign_archive(uuid, text), public.campaign_purge_preview(uuid),
  public.campaign_export(uuid), public.campaign_dashboard(),
  public.campaign_farmer_history(text) from public, anon;
grant execute on function public.campaign_create(jsonb), public.campaign_update(uuid, jsonb, int),
  public.campaign_participants_set(uuid, text, jsonb, boolean), public.campaign_targets_set(uuid, jsonb),
  public.campaign_open_checklist(uuid), public.campaign_open(uuid, text), public.campaign_set_current(uuid),
  public.campaign_close_checklist(uuid), public.campaign_start_closing(uuid, text), public.campaign_close(uuid, text, text, boolean),
  public.campaign_reopen(uuid, text, text), public.campaign_archive(uuid, text), public.campaign_purge_preview(uuid),
  public.campaign_export(uuid), public.campaign_dashboard(),
  public.campaign_farmer_history(text) to authenticated;
