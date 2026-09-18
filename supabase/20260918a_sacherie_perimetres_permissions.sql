-- =====================================================================
-- ANAGROCI FBMS — Sacherie AFLP — Lot 1 : permissions et périmètres
-- Fichier : supabase/20260918a_sacherie_perimetres_permissions.sql
-- Branche : fix/sacherie-identity-access-hardening
--
-- STATUT : NON APPLIQUEE EN PRODUCTION. Testee sur replique locale
--          (tests/sql/executer_tests.sh).
--
-- PRINCIPE : une seule regle serveur fait autorite pour les droits Sacherie :
--   profils.role (+ profils.actif) pour ce que l'utilisateur PEUT FAIRE,
--   profils.cluster / authority_level / portee_terrain_globale() pour OU.
--   profils.fonction_operationnelle devient purement informative : elle
--   n'accorde plus aucun droit (colonne conservee, aucune suppression).
--
-- CE QUE LA MIGRATION NE FAIT PAS : aucune modification de compte reel,
--   aucun mouvement de stock, aucune ecriture dans rcn_jute_movements,
--   aucune transition FULLY_RELEASED -> RECEIVED -> CLOSED, aucun plafond
--   d'enveloppe, aucune cloture de campagne.
--
-- RETOUR ARRIERE : voir 20260918z_sacherie_lot1_rollback_complet.sql
--   et docs/sacherie_lot1_identite_acces_20260918.md (§ deploiement).
-- =====================================================================

-- ORDRE : 1/3 (aucune dépendance)
begin;


-- ---------------------------------------------------------------------
-- 1. Normalisation d'un cluster vers le code du referentiel aflp_clusters
--    ('Botro', 'BOTRO', 'N''DJEBONOUA', 'Djébonoua' -> code unique).
--    NULL si la valeur est vide ou inconnue : une valeur inconnue n'est
--    JAMAIS interpretee comme « tous les clusters ».
-- ---------------------------------------------------------------------
create or replace function private.sacherie_norm_cluster(p_valeur text)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
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
$fn$;

-- ---------------------------------------------------------------------
-- 2. Contexte d'habilitation Sacherie de l'utilisateur authentifie.
--    Source unique : identite JWT (auth.uid()) -> profils ACTIF -> role.
--    Aucune donnee transmise par le navigateur n'intervient.
--
--    lecture / ecriture : 'GLOBAL' | 'CLUSTER' | NULL (aucun droit)
--      Branch Manager                  : GLOBAL / GLOBAL
--      Zonal Head                      : GLOBAL (portee_terrain_globale) / NULL
--      Field Buying Operations Officer : GLOBAL / NULL          [A VALIDER]
--      Unit Head, Storekeeper          : CLUSTER / CLUSTER
--                                        (GLOBAL si authority_level='GLOBAL'
--                                         pose explicitement par le BM)
--      tout autre role                 : NULL / NULL
-- ---------------------------------------------------------------------
create or replace function private.sacherie_contexte()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  p public.profils%rowtype;
  v_cl text; v_lect text; v_ecr text; v_glob boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('connecte', false, 'actif', false);
  end if;
  select * into p from public.profils where user_id = auth.uid() and actif = true limit 1;
  if not found then
    return jsonb_build_object('connecte', true, 'actif', false);
  end if;
  v_cl   := private.sacherie_norm_cluster(p.cluster);
  v_glob := coalesce(p.authority_level,'') = 'GLOBAL';
  if p.role = 'Branch Manager' then
    v_lect := 'GLOBAL'; v_ecr := 'GLOBAL';
  elsif p.role = 'Zonal Head' then
    -- Decision du 17/09/2026 (migration zonal_head_global_field_access) :
    -- portee terrain globale. Le Zonal Head controle, il ne mouvemente pas.
    v_lect := case when public.portee_terrain_globale() then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := null;
  elsif p.role = 'Field Buying Operations Officer' then
    v_lect := 'GLOBAL'; v_ecr := null;
  elsif p.role in ('Unit Head', 'Storekeeper') then
    v_lect := case when v_glob then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := v_lect;
  end if;
  return jsonb_build_object(
    'connecte', true, 'actif', true, 'role', p.role,
    'cluster', v_cl, 'cluster_saisi', p.cluster,
    'lecture', v_lect, 'ecriture', v_ecr);
end
$fn$;

-- ---------------------------------------------------------------------
-- 3. Controle de perimetre avec messages de configuration explicites.
-- ---------------------------------------------------------------------
create or replace function private.sacherie_exiger_cluster(p_cluster text, p_ecriture boolean, p_action text)
returns void
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  c jsonb := private.sacherie_contexte();
  v_portee text;
  v_cible text;
begin
  if not coalesce((c->>'connecte')::boolean, false) then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if not coalesce((c->>'actif')::boolean, false) then
    raise exception 'Compte désactivé ou sans profil actif : action refusée' using errcode = '42501';
  end if;
  v_portee := c->>(case when p_ecriture then 'ecriture' else 'lecture' end);
  if v_portee is null then
    if p_ecriture and c->>'role' = 'Zonal Head' then
      raise exception 'Le Zonal Head contrôle mais ne mouvemente pas physiquement les sacs' using errcode = '42501';
    end if;
    raise exception 'Accès refusé : le rôle « % » ne permet pas de %', c->>'role', p_action using errcode = '42501';
  end if;
  if v_portee = 'GLOBAL' then return; end if;
  if c->>'cluster' is null then
    raise exception 'Affectation manquante : aucun cluster valide n''est rattaché à ce compte (rôle « % », valeur saisie « % »). Le Branch Manager doit compléter l''affectation dans Comptes et rôles.',
      c->>'role', coalesce(c->>'cluster_saisi','vide')
      using errcode = '42501', hint = 'FBMS_AFFECTATION_MANQUANTE';
  end if;
  v_cible := private.sacherie_norm_cluster(p_cluster);
  if v_cible is null then
    raise exception 'Localisation hors périmètre cluster : cible sans cluster AFLP (« % »), réservée aux comptes à portée globale', coalesce(p_cluster,'aucun')
      using errcode = '42501';
  end if;
  if v_cible <> c->>'cluster' then
    raise exception 'Localisation hors périmètre cluster : % n''est pas votre cluster (%)', v_cible, c->>'cluster'
      using errcode = '42501';
  end if;
end
$fn$;

-- Lecture sans exception (pour les policies RLS). p_null_ok : une ligne
-- sans cluster (emplacement technique) est-elle lisible par un compte CLUSTER ?
create or replace function private.sacherie_peut_lire_cluster(p_cluster text, p_null_ok boolean default false)
returns boolean
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare c jsonb := private.sacherie_contexte();
begin
  if c->>'lecture' = 'GLOBAL' then return true; end if;
  if c->>'lecture' = 'CLUSTER' and c->>'cluster' is not null then
    if p_cluster is null or btrim(p_cluster) = '' then return p_null_ok; end if;
    return private.sacherie_norm_cluster(p_cluster) = c->>'cluster';
  end if;
  return false;
end
$fn$;

create or replace function private.sacherie_peut_lire_emplacement(p_code text)
returns boolean
language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
  select coalesce((select private.sacherie_peut_lire_cluster(l.cluster, false)
                   from public.rcn_jute_locations l where l.code = p_code), false)
$fn$;

-- Portee de lecture des RPC de consultation : 'GLOBAL' ou code cluster.
create or replace function private.sacherie_portee_lecture()
returns text
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare c jsonb := private.sacherie_contexte();
begin
  perform private.sacherie_exiger_cluster(null, false, 'consulter la Sacherie')
  where c->>'lecture' is null or not coalesce((c->>'actif')::boolean,false)
     or (c->>'lecture' = 'CLUSTER' and c->>'cluster' is null);
  return case when c->>'lecture' = 'GLOBAL' then 'GLOBAL' else c->>'cluster' end;
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. Point de decision unique pour les emplacements physiques.
--    Meme signature qu'avant : tous les appelants existants en beneficient.
-- ---------------------------------------------------------------------
create or replace function public.sacherie_ct_assert_location_access(p_location text, p_write boolean default false)
returns void
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  c jsonb;
  l public.rcn_jute_locations%rowtype;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  c := private.sacherie_contexte();
  if not coalesce((c->>'actif')::boolean, false) then
    raise exception 'Profil actif requis : compte désactivé ou sans profil' using errcode = '42501';
  end if;
  select * into l from public.rcn_jute_locations where code = p_location and actif = true;
  if not found then raise exception 'Localisation inconnue'; end if;
  -- Lecture d'un emplacement technique (transit, usine) : tout compte ayant
  -- un droit de lecture Sacherie. L'ecriture reste soumise au perimetre.
  if not p_write and l.cluster is null and c->>'lecture' is not null then return; end if;
  perform private.sacherie_exiger_cluster(
    l.cluster, p_write,
    case when p_write then 'mouvementer des sacs sur cet emplacement' else 'consulter cet emplacement' end);
end
$fn$;

-- ---------------------------------------------------------------------
-- 5. Convergence des helpers historiques vers profils.role
-- ---------------------------------------------------------------------
create or replace function private.ops_has_role(allowed text[])
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  -- fonction_operationnelle n'accorde plus de droit : seul le role fait foi.
  select (select auth.uid()) is not null and exists (
    select 1 from public.profils p
    where p.user_id = (select auth.uid())
      and p.actif = true
      and p.role = any(allowed)
  );
$fn$;

create or replace function public.peut_demander_sacherie()
returns boolean
language sql stable security definer
set search_path to 'public'
as $fn$
  select public.est_bm() or exists(
    select 1 from public.profils p
    where p.user_id = auth.uid() and p.actif = true and p.role = 'Unit Head')
$fn$;

create or replace function public.peut_executer_sacherie(p_cluster text)
returns boolean
language sql stable security definer
set search_path to 'public', 'private'
as $fn$
  select public.est_bm() or exists(
    select 1 from public.profils p
    where p.user_id = auth.uid() and p.actif = true and p.role = 'Storekeeper'
      and (coalesce(p.authority_level,'') = 'GLOBAL'
           or (private.sacherie_norm_cluster(p.cluster) is not null
               and private.sacherie_norm_cluster(p.cluster) = private.sacherie_norm_cluster(p_cluster))))
$fn$;

create or replace function public.sacherie_peut_lire_demande(p_cluster text, p_zone text, p_requested_by uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'private'
as $fn$
  select public.est_bm()
      or p_requested_by = auth.uid()
      or private.sacherie_peut_lire_cluster(p_cluster, false)
$fn$;

-- Perimetre de lecture des RPC inventaires_dus / search_movements (deployees
-- en production le 18/09, versionnees sur une autre branche). Contrat
-- inchange : { bm: portee globale, autorise, cluster }. La cle 'cluster'
-- renvoie l'orthographe du registre des emplacements pour que leurs
-- comparaisons upper(...) restent justes (ex. N'DJEBONOUA).
create or replace function private.sacherie_ct_perimetre()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare c jsonb := private.sacherie_contexte(); v_reg text;
begin
  if c->>'lecture' = 'GLOBAL' then
    return jsonb_build_object('bm', true, 'autorise', true, 'cluster', null);
  end if;
  if c->>'lecture' = 'CLUSTER' and c->>'cluster' is not null then
    select l.cluster into v_reg from public.rcn_jute_locations l
     where l.scope_type = 'CLUSTER' and private.sacherie_norm_cluster(l.cluster) = c->>'cluster'
     order by l.created_at limit 1;
    return jsonb_build_object('bm', false, 'autorise', true, 'cluster', coalesce(v_reg, c->>'cluster'));
  end if;
  -- Aucun droit, ou affectation manquante : rien n'est visible.
  return jsonb_build_object('bm', false, 'autorise', false, 'cluster', null);
end
$fn$;

-- ---------------------------------------------------------------------
-- 6. RPC de consultation : perimetre explicite (plus de « cluster NULL =
--    tout voir »). Un compte sans droit Sacherie ou sans affectation recoit
--    un message de configuration au lieu d'une vue globale.
-- ---------------------------------------------------------------------
create or replace function public.sacherie_ct_locations()
returns table(code text, nom text, scope_type text, cluster text, rt_id text, producteur_id text)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare v_portee text;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  v_portee := private.sacherie_portee_lecture();
  return query
    select l.code, l.nom, l.scope_type, l.cluster, l.rt_id, l.producteur_id
    from public.rcn_jute_locations l
    where l.actif = true
      and (v_portee = 'GLOBAL' or l.cluster is null or private.sacherie_norm_cluster(l.cluster) = v_portee)
    order by l.cluster, l.scope_type, l.nom;
end
$fn$;

create or replace function public.sacherie_ct_pertes()
returns table(id text, location_code text, state text, qty integer, motif text, proof_url text, statut text, submitted_at timestamp with time zone, decided_at timestamp with time zone, commentaire_decision text, cluster text, rt_id text, location_name text)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare v_portee text;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  v_portee := private.sacherie_portee_lecture();
  return query
    select x.id, x.location_code, x.state, x.qty, x.motif, x.proof_url, x.statut, x.submitted_at, x.decided_at,
           x.commentaire_decision, l.cluster, l.rt_id, l.nom
    from public.rcn_jute_loss_requests x
    left join public.rcn_jute_locations l on l.code = x.location_code
    where x.ledger = 'INTERNE'
      and (v_portee = 'GLOBAL' or private.sacherie_norm_cluster(l.cluster) = v_portee)
    order by x.submitted_at desc;
end
$fn$;

create or replace function public.sacherie_ct_snapshot()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid(); c jsonb; v_portee text; v_is_global boolean;
  v_global jsonb; v_clusters jsonb; v_rts jsonb; v_moves jsonb; v_alerts jsonb; v_requests jsonb; v_inv jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  c := private.sacherie_contexte();
  v_portee := private.sacherie_portee_lecture();
  v_is_global := v_portee = 'GLOBAL';
  select to_jsonb(g) into v_global from public.sacherie_ct_global_stock g;
  -- Agregat programme : expose comme avant a tout compte ayant un droit de
  -- lecture Sacherie (aucune donnee par emplacement).
  if v_global is null then
    v_global := jsonb_build_object('total',0,'vides',0,'pleins',0,'transit',0,'dechires',0,'a_reparer',0,'repares',0,'rebut',0);
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.cluster),'[]'::jsonb) into v_clusters from (
    select cs.*, i.physical_stock, i.theoretical_inventory, i.inventory_gap, i.last_inventory,
           case when coalesce(i.inventory_gap,0)<>0 then 'CRITIQUE' when cs.stock_cluster_vide<20 then 'ATTENTION' else 'NORMAL' end status
    from public.sacherie_ct_cluster_stock cs
    left join (
      select l.cluster, sum(i.counted_qty)::integer physical_stock, sum(i.theoretical_qty)::integer theoretical_inventory,
             sum(i.difference_qty)::integer inventory_gap, max(i.counted_at) last_inventory
      from public.sacherie_ct_latest_inventory i join public.rcn_jute_locations l on l.code = i.location_code
      where l.scope_type = 'CLUSTER' group by l.cluster
    ) i using (cluster)
    where v_is_global or private.sacherie_norm_cluster(cs.cluster) = v_portee
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.cluster, x.rt_nom),'[]'::jsonb) into v_rts from (
    select r.*,
      coalesce((select sum(a.volume_finance_kg) from public.avances a where a.rt_id=r.rt_id and a.cycle_statut='OPEN'),0) volume_finance_kg_open,
      coalesce((select sum(a.volume_finance_kg) from public.avances a where a.rt_id=r.rt_id and a.cycle_statut='OPEN'),0) volume_finance_restant_estime_kg,
      case when r.dechires>0 or r.rebut>0 then 'ATTENTION' when r.total_sous_responsabilite<0 then 'CRITIQUE' else 'NORMAL' end risk_level
    from public.sacherie_ct_rt_stock r
    where v_is_global or private.sacherie_norm_cluster(r.cluster) = v_portee
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.movement_at desc),'[]'::jsonb) into v_moves from (
    select m.id, m.event_key, m.movement_type, m.qty, m.from_location, m.to_location, m.from_state, m.to_state, m.cluster,
           m.rt_id, m.producteur_id, m.reference, m.note, m.proof_url, m.movement_at, m.source_type, m.source_id
    from public.rcn_jute_movements m
    where m.ledger = 'INTERNE' and (v_is_global or private.sacherie_norm_cluster(m.cluster) = v_portee)
    order by m.movement_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) into v_requests from (
    select id, request_code, cluster, rt_id, rt_nom, cycle_id, requested_qty, approved_qty, status, requested_at, approved_at, expires_at, closed_at
    from public.bag_movement_requests
    where v_is_global or private.sacherie_norm_cluster(cluster) = v_portee
    order by requested_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.counted_at desc),'[]'::jsonb) into v_inv from (
    select i.*, l.cluster, l.scope_type, l.rt_id
    from public.sacherie_ct_latest_inventory i join public.rcn_jute_locations l on l.code = i.location_code
    where v_is_global or private.sacherie_norm_cluster(l.cluster) = v_portee
    order by i.counted_at desc limit 100
  ) x;
  with a as (
    select 'DECHIRES'::text code, 'ATTENTION'::text severity, cs.cluster, cs.dechires::numeric value, cs.dechires||' sac(s) déchiré(s) à traiter' message
      from public.sacherie_ct_cluster_stock cs where cs.dechires>0 and (v_is_global or private.sacherie_norm_cluster(cs.cluster) = v_portee)
    union all
    select 'INVENTORY_GAP','CRITIQUE',l.cluster,abs(i.difference_qty),'Écart inventaire de '||i.difference_qty||' sac(s)'
      from public.sacherie_ct_latest_inventory i join public.rcn_jute_locations l on l.code=i.location_code
      where i.difference_qty<>0 and (v_is_global or private.sacherie_norm_cluster(l.cluster) = v_portee)
    union all
    select 'APPROVAL_EXPIRED','ATTENTION',r.cluster,coalesce(r.approved_qty,r.requested_qty),'Approval expiré non clôturé : '||r.request_code
      from public.bag_movement_requests r
      where r.status='APPROVED' and r.expires_at<now() and r.closed_at is null and (v_is_global or private.sacherie_norm_cluster(r.cluster) = v_portee)
    union all
    select 'NEGATIVE_STOCK','CRITIQUE',l.cluster,abs(s.qty),'Stock théorique négatif : '||l.nom||' / '||s.state
      from public.rcn_jute_v_stock s join public.rcn_jute_locations l on l.code=s.location_code
      where s.qty<0 and (v_is_global or private.sacherie_norm_cluster(l.cluster) = v_portee)
  ) select coalesce(jsonb_agg(to_jsonb(a) order by case severity when 'CRITIQUE' then 1 else 2 end, cluster),'[]'::jsonb) into v_alerts from a;
  return jsonb_build_object('generated_at', now(),
    'scope', jsonb_build_object('role', c->>'role', 'cluster', case when v_is_global then null else v_portee end, 'global', v_is_global),
    'global', v_global, 'clusters', v_clusters, 'rts', v_rts, 'movements', v_moves,
    'requests', v_requests, 'inventories', v_inv, 'alerts', v_alerts);
end
$fn$;

-- ---------------------------------------------------------------------
-- 7. Pertes : declarant != decideur ; compte inactif refuse.
--    Avant : `if v_role<>'Branch Manager'` avec v_role NULL (compte sans
--    profil actif) ne levait RIEN -> decision possible sans profil actif.
-- ---------------------------------------------------------------------
create or replace function public.sacherie_ct_decider_perte(p_id text, p_approve boolean, p_comment text default null::text)
returns text
language plpgsql security definer
set search_path to 'public'
as $fn$
declare x public.rcn_jute_loss_requests%rowtype; v_uid uuid:=auth.uid(); v_role text; v_available integer:=0; v_mid text; l public.rcn_jute_locations%rowtype;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  select role into v_role from public.profils where user_id=v_uid and actif=true limit 1;
  if v_role is distinct from 'Branch Manager' then raise exception 'Décision perte réservée au Branch Manager (compte actif)' using errcode='42501'; end if;
  select * into x from public.rcn_jute_loss_requests where id=p_id for update;
  if not found then raise exception 'Déclaration de perte introuvable'; end if;
  if x.statut<>'SOUMIS' then raise exception 'Déclaration déjà décidée'; end if;
  if x.submitted_by = v_uid then
    raise exception 'Séparation des tâches : le déclarant d''une perte ne peut pas la décider' using errcode='42501';
  end if;
  if not p_approve then
    update public.rcn_jute_loss_requests set statut='REFUSE',decided_by=v_uid,decided_at=now(),commentaire_decision=p_comment where id=p_id;
    return 'REFUSE';
  end if;
  select coalesce(qty,0) into v_available from public.rcn_jute_v_stock where location_code=x.location_code and state=x.state;
  if x.qty>coalesce(v_available,0) then raise exception 'Stock insuffisant pour approuver cette perte'; end if;
  select * into l from public.rcn_jute_locations where code=x.location_code; v_mid:='JUT-LOSS-'||substr(md5(p_id),1,16);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,from_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,cluster,rt_id,producteur_id)
  values(v_mid,'LOSS:'||p_id,'PERTE_APPROUVEE','INTERNE',x.qty,x.location_code,x.state,'AFLP_PERTE',p_id,p_id,x.motif,x.proof_url,now(),'ANAGROCI',v_uid,l.cluster,l.rt_id,l.producteur_id);
  update public.rcn_jute_loss_requests set statut='APPROUVE',decided_by=v_uid,decided_at=now(),commentaire_decision=p_comment where id=p_id;
  return v_mid;
end
$fn$;

-- ---------------------------------------------------------------------
-- 8. Transferts : expedition = droit d'ecriture sur l'ORIGINE seulement ;
--    la destination doit exister et etre active. La reception reste
--    soumise au droit d'ecriture sur la DESTINATION
--    (sacherie_ops_receive_transfer, inchangee).
-- ---------------------------------------------------------------------
create or replace function public.sacherie_ops_create_transfer(p_client_operation_id text, p_from_location text, p_to_location text, p_state text, p_qty integer, p_vehicle text, p_driver text, p_document_ref text, p_proof_url text default null::text, p_note text default null::text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid:=auth.uid(); v_id text; v_event text; v_available integer:=0; v_existing public.rcn_jute_transfers%rowtype; v_from public.rcn_jute_locations%rowtype; v_to public.rcn_jute_locations%rowtype;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite invalide'; end if;
  if coalesce(btrim(p_document_ref),'')='' then raise exception 'Reference document obligatoire'; end if;
  v_id:='JTR-P1-'||substr(md5(p_client_operation_id),1,20);
  select * into v_existing from public.rcn_jute_transfers where id=v_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  select * into v_from from public.rcn_jute_locations where code=p_from_location and actif=true; if not found then raise exception 'Origine inconnue'; end if;
  select * into v_to from public.rcn_jute_locations where code=p_to_location and actif=true; if not found then raise exception 'Destination inconnue'; end if;
  if p_from_location=p_to_location then raise exception 'Origine et destination identiques'; end if;
  if p_to_location = 'JUTE-TRANSIT' then raise exception 'Destination invalide : le transit est géré automatiquement'; end if;
  perform public.sacherie_ct_assert_location_access(p_from_location,true);
  select coalesce(sum(qty),0)::integer into v_available from public.rcn_jute_v_stock where location_code=p_from_location and state=p_state;
  if v_available<p_qty then raise exception 'Stock insuffisant pour transfert. Disponible: %',v_available; end if;
  insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type)
  values('JUTE-TRANSIT','GLOBAL','TRANSIT','Sacherie en transit','TRANSIT',true,'TRANSIT') on conflict(code) do update set actif=true;
  insert into public.rcn_jute_transfers(id,from_location,to_location,state,qty_sent,qty_received,vehicle,driver,document_ref,statut,sent_by,sent_at,proof_url)
  values(v_id,p_from_location,p_to_location,p_state,p_qty,0,nullif(p_vehicle,''),nullif(p_driver,''),p_document_ref,'EXPEDIE',v_uid,now(),p_proof_url) returning * into v_existing;
  v_event:='TRANSFER-SEND:'||v_id;
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster)
  values('JUT-'||substr(md5(v_event),1,20),v_event,'TRANSFERT','INTERNE',p_qty,p_from_location,'JUTE-TRANSIT',p_state,'EN_TRANSIT','TRANSFERT',v_id,p_document_ref,p_note,p_proof_url,now(),'ANAGROCI',v_uid,'2027',coalesce(v_from.cluster,v_to.cluster));
  return to_jsonb(v_existing);
end
$fn$;

-- ---------------------------------------------------------------------
-- 9. Emplacement RT pour une demande : RPC CONTROLEE remplacant l'appel
--    direct a sacherie_ct_location (GRANT du 18/09 07:10 retire plus bas).
--    sacherie_ct_location n'effectuait AUCUN controle (ni auth, ni role,
--    ni perimetre) et reactivait / renommait tout emplacement existant.
-- ---------------------------------------------------------------------
create or replace function public.sacherie_ct_location_rt(p_rt_id text)
returns text
language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare v_rt public.rt%rowtype; v_cl text;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if not private.ops_has_role(array['General Manager','Branch Manager','Procurement Officer','LBA Purchase Officer','Field Buying Operations Officer','Zonal Head','Unit Head']) then
    raise exception 'Droit insuffisant pour préparer une demande de sacs' using errcode='42501';
  end if;
  select * into v_rt from public.rt where id = p_rt_id and coalesce(deleted,false) = false limit 1;
  if not found then raise exception 'RT introuvable dans le référentiel'; end if;
  v_cl := coalesce(nullif(btrim(v_rt.cluster),''), nullif(btrim(v_rt.data->>'cluster'),''));
  if v_cl is null or private.sacherie_norm_cluster(v_cl) is null then
    raise exception 'RT sans cluster AFLP valide : régulariser le référentiel';
  end if;
  if (private.sacherie_contexte()->>'lecture') is not null then
    perform private.sacherie_exiger_cluster(v_cl, false, 'préparer une demande pour ce RT');
  end if;
  return public.sacherie_ct_location('RT', v_cl, v_rt.id, v_rt.nom, null, null);
end
$fn$;

-- ---------------------------------------------------------------------
-- 10. Garde du circuit ops_bag_requests
--     Ajouts (le reste est la version de production du 17/09) :
--      a) creation AFLP : perimetre du demandeur (compte a portee cluster),
--         coherence cluster / RT / emplacements source et destination ;
--      b) champs d'autorisation figes apres creation (cluster, RT,
--         emplacements, campagne, codes) : plus de detournement d'une
--         demande approuvee vers un autre magasin ou un autre RT ;
--      c) approved_qty / approved_by / expires_at modifiables UNIQUEMENT
--         lors de la decision d'approbation ; reviewed_* lors de la revue ;
--      d) released_qty et statuts *_RELEASED : uniquement via la sortie
--         officielle ops_release_bags (marqueur de transaction) ;
--      e) auto-revue interdite (initiateur != reviseur) ;
--      f) reception : perimetre cluster du confirmant ;
--      g) request_code attribue par le serveur s'il est absent (le
--         formulaire ne l'envoie pas : creation impossible en production).
--     Roles morts retires des listes ('Warehouse Keeper', 'Assistant Unit
--     Head', 'Administrateur' : absents de profils_role_check).
-- ---------------------------------------------------------------------
create sequence if not exists public.ops_bag_request_seq;
revoke all on sequence public.ops_bag_request_seq from public, anon, authenticated;

create or replace function public.ops_bag_request_guard()
returns trigger
language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_sortie_officielle boolean := coalesce(current_setting('fbms.ops_release_bags', true), '') = 'on';
  v_src public.rcn_jute_locations%rowtype;
  v_dst public.rcn_jute_locations%rowtype;
  v_rt_cluster text;
  v_approbation boolean;
  v_revue boolean;
begin
  if v_uid is null then return new; end if;

  if tg_op = 'INSERT' then
    new.requested_by:=v_uid; new.requested_at:=coalesce(new.requested_at,now()); new.status:='REQUESTED';
    new.approved_qty:=null; new.released_qty:=0; new.received_qty:=0;
    new.reviewed_by:=null; new.reviewed_at:=null; new.approved_by:=null; new.approved_at:=null;
    new.expires_at:=null;
    -- Le formulaire « Nouvelle demande » n'envoie pas request_code (NOT NULL,
    -- sans defaut) : toute creation echouait en production. Code attribue
    -- par le serveur lorsqu'il est absent.
    if coalesce(btrim(new.request_code),'') = '' then
      new.request_code := new.channel||'-'||to_char(now(),'YYYY')||'-'||public.sacherie_code_cluster(coalesce(new.cluster,new.lba_code))
                          ||'-'||lpad(nextval('public.ops_bag_request_seq')::text,6,'0');
    end if;
    if new.channel = 'AFLP' then
      if private.sacherie_norm_cluster(new.cluster) is null then
        raise exception 'Cluster « % » inconnu du référentiel AFLP', coalesce(new.cluster,'vide') using errcode='23514';
      end if;
      if (private.sacherie_contexte()->>'lecture') is not null then
        perform private.sacherie_exiger_cluster(new.cluster, false, 'créer une demande de sacs pour ce cluster');
      end if;
      select coalesce(nullif(btrim(r.cluster),''), nullif(btrim(r.data->>'cluster'),'')) into v_rt_cluster
        from public.rt r where r.id = new.rt_id and coalesce(r.deleted,false) = false;
      if not found or private.sacherie_norm_cluster(v_rt_cluster) is distinct from private.sacherie_norm_cluster(new.cluster) then
        raise exception 'RT introuvable ou hors du cluster de la demande' using errcode='23514';
      end if;
      select * into v_src from public.rcn_jute_locations where code = new.source_location_code and actif = true;
      if not found or coalesce(v_src.scope_type,'') <> 'CLUSTER'
         or private.sacherie_norm_cluster(v_src.cluster) is distinct from private.sacherie_norm_cluster(new.cluster) then
        raise exception 'Emplacement source incohérent : il doit être le magasin du cluster de la demande' using errcode='23514';
      end if;
      select * into v_dst from public.rcn_jute_locations where code = new.destination_location_code and actif = true;
      if not found or coalesce(v_dst.scope_type,'') <> 'RT' or v_dst.rt_id is distinct from new.rt_id then
        raise exception 'Emplacement destination incohérent : il doit être le compte sacs du RT demandé' using errcode='23514';
      end if;
    end if;
    return new;
  end if;

  if old.channel<>new.channel or old.requested_by<>new.requested_by or old.requested_qty<>new.requested_qty then
    raise exception 'Identité de la demande non modifiable après création';
  end if;
  if (old.cluster, old.rt_id, old.lba_code, old.source_location_code, old.destination_location_code,
      old.campaign, old.client_request_id, old.request_code, old.requested_at)
     is distinct from
     (new.cluster, new.rt_id, new.lba_code, new.source_location_code, new.destination_location_code,
      new.campaign, new.client_request_id, new.request_code, new.requested_at) then
    raise exception 'Périmètre de la demande non modifiable après création (cluster, RT, emplacements, campagne)' using errcode='42501';
  end if;

  v_approbation := old.status is distinct from new.status and new.status in ('GM_APPROVED','BM_APPROVED');
  v_revue       := old.status is distinct from new.status and new.status = 'REVIEWED';
  if not v_approbation and (new.approved_qty is distinct from old.approved_qty
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.expires_at is distinct from old.expires_at) then
    raise exception 'Approbation non modifiable en dehors de la décision d''approbation' using errcode='42501';
  end if;
  if not v_revue and (new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'Revue non modifiable en dehors de la décision de revue' using errcode='42501';
  end if;
  if new.released_qty is distinct from old.released_qty and not v_sortie_officielle then
    raise exception 'Quantité libérée modifiable uniquement par la sortie officielle (ops_release_bags)' using errcode='42501';
  end if;

  if old.status is distinct from new.status then
    if new.status in ('REJECTED','CANCELLED') then
      if not private.ops_has_role(array['General Manager','Branch Manager','Procurement Officer','LBA Purchase Officer','Field Buying Operations Officer','Zonal Head']) then raise exception 'Droit insuffisant pour clôturer la demande'; end if;
    elsif old.channel='LBA' and old.status='REQUESTED' and new.status='REVIEWED' then
      if not private.ops_has_role(array['Procurement Officer','LBA Purchase Officer','Branch Manager']) then raise exception 'Review LBA réservé au Procurement'; end if;
      new.reviewed_by:=v_uid; new.reviewed_at:=now();
    elsif old.channel='LBA' and old.status='REVIEWED' and new.status='GM_APPROVED' then
      if not private.ops_has_role(array['General Manager']) then raise exception 'Seul le General Manager peut approuver les sacs LBA'; end if;
      if v_uid=old.requested_by then raise exception 'Séparation des tâches : l’initiateur ne peut pas approuver sa propre demande'; end if;
      if new.approved_qty is null or new.approved_qty<=0 or new.approved_qty>old.requested_qty then raise exception 'Quantité approuvée invalide'; end if;
      new.approved_by:=v_uid; new.approved_at:=now();
    elsif old.channel='AFLP' and old.status='REQUESTED' and new.status='REVIEWED' then
      if not private.ops_has_role(array['Zonal Head','Branch Manager']) then raise exception 'Review AFLP réservé au Zonal Head'; end if;
      if v_uid=old.requested_by then raise exception 'Séparation des tâches : l’initiateur ne peut pas revoir sa propre demande' using errcode='42501'; end if;
      new.reviewed_by:=v_uid; new.reviewed_at:=now();
    elsif old.channel='AFLP' and old.status='REVIEWED' and new.status='CONSOLIDATED' then
      if not private.ops_has_role(array['Field Buying Operations Officer','Branch Manager']) then raise exception 'Consolidation AFLP réservée au Field Buying Operations Officer'; end if;
    elsif old.channel='AFLP' and old.status='CONSOLIDATED' and new.status='BM_APPROVED' then
      if not private.ops_has_role(array['Branch Manager']) then raise exception 'Seul le Branch Manager peut approuver Cluster vers RT'; end if;
      if v_uid=old.requested_by then raise exception 'Séparation des tâches : l’initiateur ne peut pas approuver sa propre demande'; end if;
      if new.approved_qty is null or new.approved_qty<=0 or new.approved_qty>old.requested_qty then raise exception 'Quantité approuvée invalide'; end if;
      new.approved_by:=v_uid; new.approved_at:=now();
    elsif new.status in ('PARTIALLY_RELEASED','FULLY_RELEASED') then
      if not v_sortie_officielle then raise exception 'Sortie physique : passer par la sortie officielle (ops_release_bags)' using errcode='42501'; end if;
      if not private.ops_has_role(array['Warehouse Manager','Storekeeper','Procurement Officer','Branch Manager']) then raise exception 'Sortie physique réservée au magasin'; end if;
    elsif new.status='EXPIRED' then
      if new.expires_at is null or new.expires_at>=now() then raise exception 'Approval non expiré'; end if;
    else raise exception 'Transition sacherie non autorisée: % vers %',old.status,new.status;
    end if;
  end if;

  if new.received_qty is distinct from old.received_qty then
    if new.received_qty < old.received_qty then
      raise exception 'Une reception confirmee ne peut pas etre diminuee (% vers %)', old.received_qty, new.received_qty;
    end if;
    if not private.ops_has_role(array['Unit Head','Field Buying Operations Officer','Branch Manager']) then
      raise exception 'Confirmation de reception reservee au terrain destinataire';
    end if;
    if new.channel = 'AFLP' then
      perform private.sacherie_exiger_cluster(new.cluster, false, 'confirmer une réception pour ce cluster');
    end if;
    if new.received_qty < new.released_qty
       and coalesce(btrim(new.receipt_gap_reason),'') = '' then
      raise exception 'Ecart de reception (% recus sur % liberes) : motif obligatoire', new.received_qty, new.released_qty;
    end if;
  end if;

  new.updated_at:=now(); return new;
end
$fn$;

-- ---------------------------------------------------------------------
-- 11. Sortie officielle : perimetre du magasinier sur l'emplacement
--     SOURCE ; marqueur de transaction pour la garde ; approbateur !=
--     executant conserve.
-- ---------------------------------------------------------------------
create or replace function public.ops_release_bags(p_request_id uuid, p_client_release_id text, p_source_location text, p_destination_location text, p_qty integer, p_proof_url text default null::text, p_note text default null::text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req public.ops_bag_requests%rowtype;
  v_existing public.ops_bag_releases%rowtype;
  v_available integer;
  v_move_id text;
  v_release public.ops_bag_releases%rowtype;
  v_new_total integer;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not private.ops_has_role(array['Branch Manager','Warehouse Manager','Storekeeper','Procurement Officer']) then
    raise exception 'Droit insuffisant pour libérer les sacs' using errcode='42501';
  end if;
  if p_client_release_id is null or btrim(p_client_release_id)='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantité de sacs invalide'; end if;
  select * into v_existing from public.ops_bag_releases where client_release_id=p_client_release_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  select * into v_req from public.ops_bag_requests where id=p_request_id for update;
  if not found then raise exception 'Demande de sacs introuvable'; end if;
  if v_req.approved_by = v_uid then raise exception 'Séparation des tâches : approbateur et exécutant doivent être différents' using errcode='42501'; end if;
  if v_req.status not in ('GM_APPROVED','BM_APPROVED','READY_FOR_RELEASE','PARTIALLY_RELEASED') then raise exception 'Approval valide requis avant la sortie physique'; end if;
  if v_req.expires_at is not null and v_req.expires_at < now() then
    raise exception 'Approval expiré';
  end if;
  if p_source_location is distinct from v_req.source_location_code or p_destination_location is distinct from v_req.destination_location_code then
    raise exception 'Source/destination différentes de l’autorisation';
  end if;
  -- Magasinier : ecriture sur l'emplacement SOURCE de son cluster uniquement.
  if public.mon_role() = 'Storekeeper' then
    perform public.sacherie_ct_assert_location_access(p_source_location, true);
  end if;
  if v_req.approved_qty is null then raise exception 'Quantité approuvée absente'; end if;
  if v_req.released_qty + p_qty > v_req.approved_qty then raise exception 'Sortie supérieure à l’autorisation restante'; end if;
  perform pg_advisory_xact_lock(42070,hashtext(p_source_location));
  select coalesce(sum(qty),0)::integer into v_available from public.rcn_jute_v_stock where location_code=p_source_location and state='UTILISABLE';
  if v_available < p_qty then raise exception 'Stock utilisable insuffisant (disponible : %)', v_available; end if;
  v_move_id := 'JUT-OPS-'||replace(gen_random_uuid()::text,'-','');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,supplier_code,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,created_by,owner_type,campaign,cluster,rt_id)
  values(v_move_id,'OPS-BAG-RELEASE:'||p_client_release_id,'TRANSFERT','INTERNE',v_req.lba_code,p_qty,p_source_location,p_destination_location,'UTILISABLE','UTILISABLE','OPS_BAG_REQUEST',v_req.id::text,v_req.request_code,p_note,p_proof_url,now(),v_uid,'ANAGROCI',v_req.campaign,v_req.cluster,v_req.rt_id);
  insert into public.ops_bag_releases(client_release_id,request_id,qty,source_location_code,destination_location_code,jute_movement_id,released_by,proof_url,notes)
  values(p_client_release_id,v_req.id,p_qty,p_source_location,p_destination_location,v_move_id,v_uid,p_proof_url,p_note)
  returning * into v_release;
  v_new_total:=v_req.released_qty+p_qty;
  perform set_config('fbms.ops_release_bags', 'on', true);
  update public.ops_bag_requests
     set released_qty=v_new_total,
         status=case when v_new_total < approved_qty then 'PARTIALLY_RELEASED' else 'FULLY_RELEASED' end,
         updated_at=now()
   where id=v_req.id;
  perform set_config('fbms.ops_release_bags', 'off', true);
  return to_jsonb(v_release);
exception when unique_violation then
  select * into v_existing from public.ops_bag_releases where client_release_id=p_client_release_id limit 1;
  if found then return to_jsonb(v_existing); end if;
  raise;
end
$fn$;

-- ---------------------------------------------------------------------
-- 12. Circuit legacy V2 (bag_movement_requests -> DOTATION_RT) :
--     role au lieu de fonction_operationnelle, perimetre normalise,
--     separation des taches demandeur/approbateur/executant.
-- ---------------------------------------------------------------------
create or replace function public.sacherie_creer_demande(p_client_request_id text, p_rt_id text, p_cycle_id text, p_stock_rcn_kg numeric, p_requested_qty integer)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_calc jsonb; v_rt_nom text; v_cluster text; v_zone text; v_req public.bag_movement_requests%rowtype; v_code text;
begin
  if not public.peut_demander_sacherie() then raise exception 'Droit insuffisant pour créer une demande' using errcode='42501'; end if;
  if p_client_request_id is null or btrim(p_client_request_id)='' then raise exception 'Identifiant client de demande obligatoire'; end if;
  if p_requested_qty is null or p_requested_qty<=0 then raise exception 'Quantité invalide'; end if;
  select * into v_req from public.bag_movement_requests where client_request_id=p_client_request_id and requested_by=auth.uid() limit 1;
  if found then return to_jsonb(v_req); end if;
  select coalesce(nullif(btrim(r.nom),''), nullif(btrim(r.data->>'nom'),''), nullif(btrim(r.data->>'rt'),''), r.village_nom), coalesce(nullif(btrim(r.cluster),''), nullif(btrim(r.data->>'cluster'),''), ''), coalesce(nullif(btrim(r.data->>'zone'),''), '') into v_rt_nom,v_cluster,v_zone from public.rt r where r.id::text=p_rt_id and coalesce(r.deleted,false)=false limit 1;
  if not found then raise exception 'RT introuvable dans le référentiel'; end if; if v_cluster='' then raise exception 'RT sans cluster : régulariser le référentiel'; end if;
  if not public.est_bm() then
    perform private.sacherie_exiger_cluster(v_cluster, false, 'demander des sacs pour ce RT');
  end if;
  v_calc:=public.sacherie_calculer_plafond(p_rt_id,p_cycle_id,p_stock_rcn_kg);
  if p_requested_qty>(v_calc->>'max_new_available')::integer then raise exception 'Quantité demandée supérieure au plafond disponible'; end if;
  v_code:='REQ-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_cluster)||'-'||lpad(nextval('public.bag_request_seq')::text,6,'0');
  insert into public.bag_movement_requests(client_request_id,request_code,cluster,zone,rt_id,rt_nom,cycle_id,stock_rcn_kg_verified,stock_checked_by,stock_checked_at,stock_source,volume_finance_kg,volume_achete_cycle_kg,volume_finance_restant_kg,bags_already_held,reserved_approved_bags,system_max_bags,max_new_bags,max_new_available,cluster_stock_at_request,requested_qty,status,requested_by,requested_at) values (p_client_request_id,v_code,v_cluster,v_zone,p_rt_id,v_rt_nom,p_cycle_id,p_stock_rcn_kg,auth.uid(),now(),'PHYSICAL_COUNT',(v_calc->>'volume_finance_kg')::numeric,(v_calc->>'volume_achete_cycle_kg')::numeric,(v_calc->>'volume_finance_restant_kg')::numeric,(v_calc->>'bags_already_held')::integer,(v_calc->>'reserved_approved_bags')::integer,(v_calc->>'system_max_bags')::integer,(v_calc->>'max_new_bags')::integer,(v_calc->>'max_new_available')::integer,(v_calc->>'cluster_stock')::integer,p_requested_qty,'PENDING_BM',auth.uid(),now()) returning * into v_req;
  return to_jsonb(v_req);
exception when unique_violation then select * into v_req from public.bag_movement_requests where client_request_id=p_client_request_id and requested_by=auth.uid() limit 1; if found then return to_jsonb(v_req); end if; raise;
end
$fn$;

create or replace function public.sacherie_decider_demande(p_request_id uuid, p_action text, p_approved_qty integer default null::integer, p_comment text default null::text)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $fn$
declare v_req public.bag_movement_requests%rowtype; v_calc jsonb; v_qty integer; v_other_reserved integer; v_available integer;
begin
  if not public.est_bm() then raise exception 'Seul le Branch Manager peut approuver' using errcode='42501'; end if;
  select * into v_req from public.bag_movement_requests where id=p_request_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if v_req.status not in ('PENDING_BM','HOLD') then raise exception 'Demande déjà traitée'; end if;
  if upper(p_action)='APPROVE' and v_req.requested_by = auth.uid() then
    raise exception 'Séparation des tâches : l’initiateur ne peut pas approuver sa propre demande' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(42027,hashtext(v_req.rt_id));
  if upper(p_action)='APPROVE' then
    v_calc:=public.sacherie_calculer_plafond(v_req.rt_id,v_req.cycle_id,v_req.stock_rcn_kg_verified);
    v_other_reserved:=public.sacherie_reservations_rt(v_req.rt_id,v_req.id);
    v_available:=greatest((v_calc->>'max_new_bags')::integer-v_other_reserved,0);
    v_qty:=coalesce(p_approved_qty,v_req.requested_qty);
    if v_qty<=0 or v_qty>v_req.requested_qty or v_qty>v_available then raise exception 'Quantité approuvée invalide ou supérieure au plafond disponible'; end if;
    update public.bag_movement_requests set status='APPROVED',approved_qty=v_qty,approved_by=auth.uid(),approved_at=now(),expires_at=now()+interval '24 hours',approval_comment=p_comment,volume_finance_kg=(v_calc->>'volume_finance_kg')::numeric,volume_achete_cycle_kg=(v_calc->>'volume_achete_cycle_kg')::numeric,volume_finance_restant_kg=(v_calc->>'volume_finance_restant_kg')::numeric,bags_already_held=(v_calc->>'bags_already_held')::integer,reserved_approved_bags=v_other_reserved,system_max_bags=(v_calc->>'system_max_bags')::integer,max_new_bags=(v_calc->>'max_new_bags')::integer,max_new_available=v_available where id=p_request_id returning * into v_req;
  elsif upper(p_action)='HOLD' then
    if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Motif HOLD obligatoire'; end if;
    update public.bag_movement_requests set status='HOLD',approval_comment=p_comment where id=p_request_id returning * into v_req;
  elsif upper(p_action)='REJECT' then
    if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Motif de rejet obligatoire'; end if;
    update public.bag_movement_requests set status='REJECTED',approval_comment=p_comment,closed_at=now() where id=p_request_id returning * into v_req;
  else raise exception 'Action inconnue'; end if;
  return to_jsonb(v_req);
end
$fn$;

create or replace function public.sacherie_executer_demande(p_request_id uuid, p_executed_qty integer, p_bag_state text default 'EMPTY'::text, p_lot_id text default null::text)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $fn$
declare v_req public.bag_movement_requests%rowtype; v_mov public.sacs_mouvements%rowtype; v_code text; v_cluster_stock integer;
begin
  if p_executed_qty is null or p_executed_qty<=0 then raise exception 'Quantité exécutée invalide'; end if;
  select * into v_req from public.bag_movement_requests where id=p_request_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not public.peut_executer_sacherie(v_req.cluster) then raise exception 'Seul le magasinier (Storekeeper) du cluster peut remettre les sacs' using errcode='42501'; end if;
  if v_req.approved_by = auth.uid() then raise exception 'Séparation des tâches : approbateur et exécutant doivent être différents' using errcode='42501'; end if;
  if v_req.status<>'APPROVED' then raise exception 'Approval BM requis'; end if;
  if v_req.expires_at is null or v_req.expires_at<now() then raise exception 'Approval expiré'; end if;
  if p_executed_qty>v_req.approved_qty then raise exception 'Quantité exécutée supérieure à la quantité approuvée'; end if;
  if upper(coalesce(p_bag_state,'EMPTY'))<>'EMPTY' then raise exception 'La dotation RT doit être EMPTY'; end if;
  if exists(select 1 from public.sacs_mouvements where request_id=p_request_id) then raise exception 'Approval déjà utilisé'; end if;
  perform pg_advisory_xact_lock(42027,hashtext(v_req.rt_id));
  perform pg_advisory_xact_lock(42028,hashtext(upper(v_req.cluster)));
  v_cluster_stock:=public.sacherie_stock_cluster(v_req.cluster);
  if v_cluster_stock<p_executed_qty then raise exception 'Stock sacs cluster insuffisant'; end if;
  v_code:='BAG-'||to_char(current_date,'YYYY')||'-'||public.sacherie_code_cluster(v_req.cluster)||'-'||lpad(nextval('public.bag_movement_seq')::text,6,'0');
  insert into public.sacs_mouvements(local_id,date,type,source,destination,cluster,rt_id,rt_nom,quantite,observation,created_by,created_by_nom,created_at,request_id,bag_movement_code,approved_qty,executed_qty,bag_state,lot_id,business_status,issued_by,issued_at)
  values(gen_random_uuid()::text,current_date,'DOTATION_RT','CLUSTER','RT',v_req.cluster,v_req.rt_id,v_req.rt_nom,p_executed_qty,'Execution Sacherie V2 '||v_req.request_code,auth.uid(),null,now(),v_req.id,v_code,v_req.approved_qty,p_executed_qty,'EMPTY',null,case when p_executed_qty<v_req.approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,auth.uid(),now()) returning * into v_mov;
  update public.bag_movement_requests set status=case when p_executed_qty<approved_qty then 'PARTIALLY_EXECUTED' else 'EXECUTED' end,closed_at=now() where id=v_req.id;
  return to_jsonb(v_mov);
end
$fn$;

-- ---------------------------------------------------------------------
-- 16. Droits d'execution
-- ---------------------------------------------------------------------
-- Helper interne : plus appelable depuis le navigateur (retire le GRANT
-- applique le 18/09 07:10:44). Les RPC SECURITY DEFINER l'appellent en
-- tant que proprietaire.
revoke execute on function public.sacherie_ct_location(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.sacherie_ct_location_rt(text) from public, anon;
grant execute on function public.sacherie_ct_location_rt(text) to authenticated;
-- Helpers prives : aucun acces direct, sauf les deux predicats de lecture
-- utilises par les policies RLS (ils ne revelent qu'un booleen sur l'appelant).
revoke all on function private.sacherie_norm_cluster(text) from public, anon, authenticated;
revoke all on function private.sacherie_contexte() from public, anon, authenticated;
revoke all on function private.sacherie_exiger_cluster(text,boolean,text) from public, anon, authenticated;
revoke all on function private.sacherie_portee_lecture() from public, anon, authenticated;
revoke all on function public.sacherie_ct_assert_location_access(text,boolean) from public, anon, authenticated;
revoke all on function private.sacherie_ct_perimetre() from public, anon, authenticated;
-- RPC sacherie_ops_* : ouvertes a PUBLIC (donc anon) en production. Le corps
-- exige auth.uid(), mais le catalogue doit dire la meme chose que le code.
revoke execute on function public.sacherie_ops_create_transfer(text,text,text,text,integer,text,text,text,text,text) from public, anon;
revoke execute on function public.sacherie_ops_receive_transfer(text,text,integer,text,text,text) from public, anon;
revoke execute on function public.sacherie_ops_network_move(text,text,text,text,text,integer,text,text,text) from public, anon;
revoke execute on function public.sacherie_ops_ensure_locations() from public, anon;
revoke execute on function public.sacherie_ops_resolve_cluster_location(text) from public, anon, authenticated;
grant execute on function public.sacherie_ops_create_transfer(text,text,text,text,integer,text,text,text,text,text) to authenticated;
grant execute on function public.sacherie_ops_receive_transfer(text,text,integer,text,text,text) to authenticated;
grant execute on function public.sacherie_ops_network_move(text,text,text,text,text,integer,text,text,text) to authenticated;
grant execute on function public.sacherie_ops_ensure_locations() to authenticated;
-- Fonctions redefinies : droits explicites (CREATE OR REPLACE conserve l'ACL,
-- on la reaffirme pour ne dependre d'aucun etat anterieur).
revoke all on function public.ops_release_bags(uuid,text,text,text,integer,text,text) from public, anon;
grant execute on function public.ops_release_bags(uuid,text,text,text,integer,text,text) to authenticated;
revoke all on function public.ops_bag_request_guard() from public, anon, authenticated;

commit;
