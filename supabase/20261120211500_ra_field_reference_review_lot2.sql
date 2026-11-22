-- AFLP RA Lot 2: independent, version-specific field GPS reference evidence.
-- Non-destructive; does NOT rewrite existing geom approvals or farmer consent.
-- A device GPS claim is a field-agent statement requiring independent review.
create table if not exists public.farmer_plot_ra_field_references (
  id uuid primary key,
  geometry_id uuid not null references public.farmer_plot_geometries(id) on delete restrict,
  plot_id uuid not null references public.farmer_plots(id) on delete restrict,
  producteur_id text not null,
  zone_code text,
  kind text not null default 'BOUNDARY_MARK' check (kind = 'BOUNDARY_MARK'),
  source text not null default 'DEVICE_GPS' check (source = 'DEVICE_GPS'),
  latitude numeric not null check (latitude between 4 and 11),
  longitude numeric not null check (longitude between -9 and -2),
  accuracy_m numeric not null check (accuracy_m > 0 and accuracy_m <= 100),
  captured_at_client timestamptz not null,
  recorded_at timestamptz not null default now(),
  created_by uuid not null,
  note text,
  status text not null default 'A_VERIFIER' check (status in ('A_VERIFIER','CONFIRME','REJETE')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_comment text,
  constraint ra_ref_note_length check (char_length(coalesce(note,'')) <= 500)
);
create index if not exists idx_plot_ra_field_references_geometry
  on public.farmer_plot_ra_field_references(geometry_id, recorded_at);
create index if not exists idx_plot_ra_field_references_plot
  on public.farmer_plot_ra_field_references(plot_id, status);
alter table public.farmer_plot_ra_field_references enable row level security;
drop policy if exists ra_field_references_select on public.farmer_plot_ra_field_references;
create policy ra_field_references_select on public.farmer_plot_ra_field_references
  for select to authenticated
  using (private.farmer_registry_can_read_sensitive() and private.plot_map_peut_lire(producteur_id, zone_code));
revoke all on public.farmer_plot_ra_field_references from anon, authenticated;
grant select on public.farmer_plot_ra_field_references to authenticated;

-- Idempotent submission of an actual smartphone geolocation close to polygon boundary.
-- Device GPS cannot be cryptographically attested by the browser. Supervisor verifies each point.
create or replace function public.plot_map_ra_ref_ajouter(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, private, extensions, pg_temp as $function$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_geom_id uuid := nullif(p->>'geometry_id','')::uuid;
  v_lat numeric := nullif(p->>'latitude','')::numeric;
  v_lng numeric := nullif(p->>'longitude','')::numeric;
  v_prec numeric := nullif(p->>'accuracy_m','')::numeric;
  v_captured timestamptz := nullif(p->>'captured_at_client','')::timestamptz;
  v_note text := nullif(btrim(coalesce(p->>'note','')),'');
  v_geometry public.farmer_plot_geometries;
  v_existing public.farmer_plot_ra_field_references;
  v_point extensions.geometry;
  v_boundary_range numeric;
begin
  if auth.uid() is null or private.plot_map_classe() not in ('BM','UH','AUH') then
    raise exception 'Compte terrain actif obligatoire.' using errcode = 'PM001';
  end if;
  if v_id is null or v_geom_id is null or v_lat is null or v_lng is null
     or v_prec is null or v_captured is null then
    raise exception 'Identifiant, contour, coordonnées, précision et date GPS obligatoires.' using errcode = 'PM002';
  end if;
  select * into v_geometry from public.farmer_plot_geometries where id = v_geom_id;
  if v_geometry.id is null or v_geometry.status not in ('SOUMIS','VALIDE') then
    raise exception 'Le contour doit avoir été reçu par le serveur et soumis ou validé.' using errcode = 'PM002';
  end if;
  if not private.plot_map_peut_saisir(v_geometry.cluster_code,v_geometry.producteur_id) then
    raise exception 'Parcelle hors de votre périmètre de collecte.' using errcode = 'PM001';
  end if;
  if not private.plot_map_consentement_gps(v_geometry.producteur_id) then
    raise exception 'Consentement GPS non actif : aucune collecte autorisée.' using errcode = 'PM001';
  end if;
  if v_lat not between 4 and 11 or v_lng not between -9 and -2 then
    raise exception 'Coordonnées hors Côte d''Ivoire.' using errcode = 'PM002';
  end if;
  if v_prec <= 0 or v_prec > private.plot_map_seuil('precision_localisation_max_m',50) then
    raise exception 'Précision GPS insuffisante : rapprochez-vous de la limite du champ.' using errcode = 'PM002';
  end if;
  if v_captured > now() + interval '5 minutes' or v_captured < now() - interval '15 minutes' then
    raise exception 'Relevé GPS trop ancien ou daté dans le futur : nouvelle acquisition nécessaire.' using errcode = 'PM002';
  end if;
  if length(coalesce(v_note,'')) > 500 then raise exception 'Observation trop longue.' using errcode = 'PM002'; end if;
  select * into v_existing from public.farmer_plot_ra_field_references where id=v_id;
  if v_existing.id is not null then
    if v_existing.geometry_id=v_geom_id and v_existing.created_by=auth.uid()
       and v_existing.latitude=round(v_lat,7) and v_existing.longitude=round(v_lng,7)
       and v_existing.accuracy_m=round(v_prec,2) and v_existing.captured_at_client=v_captured then
      return jsonb_build_object('statut','ACCEPTEE','reference_id',v_id,'rejoue',true);
    end if;
    raise exception 'Référence GPS déjà utilisée pour une autre mesure.' using errcode='PM409';
  end if;
  v_point:=extensions.ST_SetSRID(extensions.ST_MakePoint(v_lng,v_lat),4326);
  v_boundary_range:=greatest(60,least(150,2*v_prec));
  if not extensions.ST_DWithin(
    extensions.ST_Boundary(v_geometry.geom)::extensions.geography,
    v_point::extensions.geography, v_boundary_range) then
    raise exception 'Relevé éloigné des limites du contour : rapprochez-vous de la bordure ou corrigez le polygone.' using errcode='PM002';
  end if;
  -- Separate marks within 5 m do not provide two independent field references.
  if exists (
    select 1 from public.farmer_plot_ra_field_references existing
    where existing.geometry_id=v_geom_id and existing.status in ('A_VERIFIER','CONFIRME')
      and extensions.ST_DWithin(
        extensions.ST_SetSRID(extensions.ST_MakePoint(existing.longitude,existing.latitude),4326)::extensions.geography,
        v_point::extensions.geography,5)
  ) then
    raise exception 'Référence GPS redondante : éloignez-vous d''au moins cinq mètres du repère précédent.' using errcode='PM002';
  end if;
  insert into public.farmer_plot_ra_field_references
    (id,geometry_id,plot_id,producteur_id,zone_code,latitude,longitude,accuracy_m,captured_at_client,created_by,note)
  values
    (v_id,v_geom_id,v_geometry.plot_id,v_geometry.producteur_id,v_geometry.zone_code,
      round(v_lat,7),round(v_lng,7),round(v_prec,2),v_captured,auth.uid(),v_note);
  perform private.plot_map_journaliser(v_geometry.plot_id,v_geom_id,'RA_REPERE_GPS_SOUMIS',
    null,jsonb_build_object('reference_id',v_id,'accuracy_m',round(v_prec,2)),
    'Point GPS collecté sur le terrain, vérification indépendante en attente');
  return jsonb_build_object('statut','ACCEPTEE','reference_id',v_id,
    'etat','A_VERIFIER','recu_serveur_le',now());
end $function$;

-- Independent supervisory confirmation; no self-approval, no direct table updates.
create or replace function public.plot_map_ra_ref_decider(
  p_reference uuid, p_decision text, p_commentaire text default null,
  p_exception boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $function$
declare
  v_ref public.farmer_plot_ra_field_references;
  v_geometry public.farmer_plot_geometries;
  v_classe text := private.plot_map_classe();
  v_newstatus text;
begin
  select * into v_ref from public.farmer_plot_ra_field_references where id=p_reference for update;
  if v_ref.id is null then raise exception 'Référence GPS inconnue.' using errcode='PM002'; end if;
  select * into v_geometry from public.farmer_plot_geometries where id=v_ref.geometry_id;
  if v_geometry.id is null or v_geometry.status not in ('SOUMIS','VALIDE') then
    raise exception 'Le contour associé n''est plus éligible à une confirmation.' using errcode='PM409';
  end if;
  if not private.plot_map_consentement_gps(v_ref.producteur_id) then
    raise exception 'Consentement GPS inactif : confirmation suspendue.' using errcode='PM001';
  end if;
  if v_classe='ZH' then
    if private.plot_map_ma_zone() is null or private.plot_map_ma_zone() is distinct from v_ref.zone_code then
      raise exception 'Référence hors de votre zone de supervision.' using errcode='PM001';
    end if;
    if coalesce(p_exception,false) then raise exception 'Exception réservée au Branch Manager.' using errcode='PM001'; end if;
  elsif v_classe='BM' then
    if not coalesce(p_exception,false) or char_length(btrim(coalesce(p_commentaire,'')))<15 then
      raise exception 'Exception BM : justification de quinze caractères minimum obligatoire.' using errcode='PM002';
    end if;
  else
    raise exception 'Confirmation réservée au Chef de Zone ou au Branch Manager en exception.' using errcode='PM001';
  end if;
  if v_ref.created_by=auth.uid() then
    raise exception 'Un agent ne confirme jamais son propre relevé.' using errcode='PM001';
  end if;
  if v_ref.status<>'A_VERIFIER' then
    raise exception 'Le repère a déjà fait l''objet d''une décision.' using errcode='PM409';
  end if;
  if p_decision not in ('CONFIRMER','REJETER') then raise exception 'Décision inconnue.' using errcode='PM002'; end if;
  if p_decision='REJETER' and char_length(btrim(coalesce(p_commentaire,'')))<8 then
    raise exception 'Motif du rejet obligatoire (huit caractères minimum).' using errcode='PM002';
  end if;
  v_newstatus:=case when p_decision='CONFIRMER' then 'CONFIRME' else 'REJETE' end;
  update public.farmer_plot_ra_field_references
  set status=v_newstatus,reviewed_by=auth.uid(),reviewed_at=now(),
      review_comment=nullif(btrim(coalesce(p_commentaire,'')),'')
  where id=v_ref.id;
  perform private.plot_map_journaliser(v_ref.plot_id,v_ref.geometry_id,'RA_REPERE_GPS_'||v_newstatus,
    jsonb_build_object('reference_id',v_ref.id,'status',v_ref.status),
    jsonb_build_object('reference_id',v_ref.id,'status',v_newstatus),p_commentaire);
  return jsonb_build_object('statut','ACCEPTEE','reference_id',v_ref.id,'decision',v_newstatus);
end $function$;

revoke all on function public.plot_map_ra_ref_ajouter(jsonb) from public, anon;
revoke all on function public.plot_map_ra_ref_decider(uuid,text,text,boolean) from public, anon;
grant execute on function public.plot_map_ra_ref_ajouter(jsonb) to authenticated;
grant execute on function public.plot_map_ra_ref_decider(uuid,text,text,boolean) to authenticated;

-- Read-only internal preparation status. Two distinct independently confirmed points
-- are ANAGROCI's internal pre-review criterion, not a Rainforest Alliance certificate.
create or replace view public.plot_map_ra_preparation_v with (security_invoker=true) as
select
  g.id as geometry_id, g.plot_id, g.status as contour_status,
  count(ref.id) filter (where ref.status='A_VERIFIER')::integer as references_en_attente,
  count(ref.id) filter (where ref.status='CONFIRME')::integer as references_confirmees,
  count(ref.id) filter (where ref.status='REJETE')::integer as references_rejetees,
  case
    when not private.plot_map_consentement_gps(g.producteur_id) then 'CONSENTEMENT_INACTIF'
    when g.status<>'VALIDE' then 'CONTOUR_PROVISOIRE'
    when g.producer_confirmation<>'CONFIRMEE_SUR_PLACE' then 'CONFIRMATION_PRODUCTEUR_A_COMPLETER'
    when exists (
      select 1 from public.farmer_plot_anomalies a
      where a.geometry_id=g.id and a.statut='OUVERTE' and a.bloquante
    ) then 'ANOMALIE_BLOQUANTE'
    when count(ref.id) filter (where ref.status='CONFIRME')<2 then 'REFERENCES_TERRAIN_A_CONFIRMER'
    else 'REVUE_DOCUMENTAIRE_RA_REQUISE'
  end as statut_preparation
from public.farmer_plot_geometries g
left join public.farmer_plot_ra_field_references ref on ref.geometry_id=g.id
group by g.id,g.plot_id,g.status,g.producer_confirmation,g.producteur_id;
revoke all on public.plot_map_ra_preparation_v from anon;
grant select on public.plot_map_ra_preparation_v to authenticated;
