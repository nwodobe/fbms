-- FBMS / WMS · vérification du 25/09/2026 · écart 2
-- Écart de sacs au transfert : un transfert dont le poids est conforme
-- mais dont le nombre de sacs reçus diffère du nombre chargé passait
-- directement en RECONCILED, l'écart restait invisible (sauf journal).
-- Correctif :
--  * colonnes bag_gap (chargés − reçus) et traçabilité de régularisation ;
--  * Confirm Receipt : écart de sacs ≠ 0 et poids conforme -> DISCREPANCY ;
--  * nouvelle RPC wms_trf_resolve_bag_gap (droit transfer_resolve_approve,
--    motif obligatoire, séparation des tâches, idempotente) qui régularise
--    le grand livre sacherie (sacs manquants sortis du transit en perte
--    approuvée, surplus ajouté au magasin de destination) ;
--  * Clôture refusée tant qu'un écart de sacs n'est pas régularisé ;
--  * wms_v_transfers expose l'écart et sa régularisation.
-- Aucune donnée existante n'est modifiée (0 transfert en base).
alter table public.wms_transfers
  add column if not exists bag_gap integer,
  add column if not exists bag_gap_resolved_at timestamptz,
  add column if not exists bag_gap_resolved_by_name text,
  add column if not exists bag_gap_resolution_note text;

do $mig$
declare f text; v text;
  a1 text := $a$m jsonb; v_status text; v_anom text; v_lacc numeric; k int; j int;$a$;
  a2 text := $a$else v_status := 'DISCREPANCY'; v_anom := 'POSITIVE'; end if;$a$;
  a3 text := $a$reconciled_at=case when v_var = 0 then now() end, reconciled_by_name=case when v_var = 0 then 'AUTO (variance 0)' end$a$;
  a4 text := $a$'requires', case when v_var = 0 then 'CLOSE'$a$;
  a5 text := $a$case when v_var = 0 then 'Confirm Receipt — variance 0'$a$;
  c1 text := $a$select coalesce(sum(qty),0) into v_res from public.wms_v_balances where location_type='TRANSIT' and location_id=p_id;$a$;
  v1 text := $a$AS overdue
   FROM$a$;
begin
  f := pg_get_functiondef('public.wms_trf_confirm_receipt(text,jsonb,text)'::regprocedure);
  if position('v_bgap' in f) = 0 then
    if position(a1 in f)=0 or position(a2 in f)=0 or position(a3 in f)=0 or position(a4 in f)=0 or position(a5 in f)=0 then
      raise exception 'Ancres de wms_trf_confirm_receipt introuvables'; end if;
    f := replace(f, a1, a1 || ' v_bgap int;');
    f := replace(f, a2, a2 || $b$
  v_bgap := case when t.bags_loaded is not null and nullif(p->>'bags_received','') is not null then t.bags_loaded - (p->>'bags_received')::int end;
  if coalesce(v_bgap,0) <> 0 and v_var = 0 then v_status := 'DISCREPANCY'; end if;$b$);
    f := replace(f, a3, $b$reconciled_at=case when v_status = 'RECONCILED' then now() end, reconciled_by_name=case when v_status = 'RECONCILED' then 'AUTO (variance 0)' end, bag_gap=v_bgap$b$);
    f := replace(f, a4, $b$'bag_gap', v_bgap, 'requires', case when v_status = 'RECONCILED' then 'CLOSE' when v_var = 0 then 'BAG_GAP_RESOLUTION'$b$);
    f := replace(f, a5, $b$case when v_var = 0 and coalesce(v_bgap,0) <> 0 then 'Confirm Receipt — poids conforme, ÉCART DE SACS '||v_bgap||' (chargés − reçus) à régulariser' when v_var = 0 then 'Confirm Receipt — variance 0'$b$);
    execute f;
  end if;

  f := pg_get_functiondef('public.wms_trf_close(text,text,text)'::regprocedure);
  if position('bag_gap' in f) = 0 then
    if position(c1 in f) = 0 then raise exception 'Ancre de wms_trf_close introuvable'; end if;
    f := replace(f, c1, $b$if coalesce(t.bag_gap,0) <> 0 and t.bag_gap_resolved_at is null then raise exception 'Clôture refusée : écart de % sac(s) entre chargement et réception non régularisé.', t.bag_gap using errcode = '23514'; end if;
  $b$ || c1);
    execute f;
  end if;

  v := pg_get_viewdef('public.wms_v_transfers'::regclass);
  if position('bag_gap' in v) = 0 then
    if position(v1 in v) = 0 then raise exception 'Ancre de wms_v_transfers introuvable'; end if;
    execute 'create or replace view public.wms_v_transfers with (security_invoker = on) as ' ||
      replace(v, v1, $b$AS overdue,
    t.bag_gap,
    t.bag_gap_resolved_at,
    t.bag_gap_resolved_by_name,
    t.bag_gap_resolution_note
   FROM$b$);
  end if;
end $mig$;

create or replace function public.wms_trf_resolve_bag_gap(p_id text, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare c jsonb; r jsonb; t public.wms_transfers; v_before jsonb; v_out int; v_in int; v_to text; v_miss int; v_surplus int;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),''); v_reco boolean;
begin
  select * into t from public.wms_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfert % introuvable', p_id using errcode = '23503'; end if;
  c := public.wms_trf_require('transfer_resolve_approve', t.dest_warehouse_id);
  r := public.wms_trf_op_check(p_idempotency_key, p_id, 'BAG_GAP'); if r is not null then return r; end if;
  if t.received_at is null then raise exception 'Régularisation impossible avant la réception du transfert' using errcode = '23514'; end if;
  if coalesce(t.bag_gap,0) = 0 then raise exception 'Aucun écart de sacs à régulariser sur %', p_id using errcode = '23514'; end if;
  if t.bag_gap_resolved_at is not null then raise exception 'Écart de sacs déjà régularisé le %', t.bag_gap_resolved_at using errcode = '23505'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'Motif de régularisation obligatoire (5 caractères minimum)' using errcode = '23514'; end if;
  if (c->>'uid')::uuid = t.received_by then
    raise exception 'Séparation des tâches : la personne qui a confirmé la réception ne peut pas régulariser l''écart de sacs' using errcode = '42501'; end if;
  v_before := public.wms_trf_snapshot(p_id);
  select coalesce(sum(qty),0) into v_out from public.rcn_jute_movements where event_key = 'WMS-TRF:'||p_id||':OUT';
  select coalesce(sum(qty),0) into v_in from public.rcn_jute_movements where event_key = 'WMS-TRF:'||p_id||':IN';
  select 'BAG-WH-'||code into v_to from public.wms_warehouses where id = t.dest_warehouse_id;
  v_miss := greatest(v_out - v_in, 0);
  v_surplus := greatest(coalesce(t.bags_received,0) - v_out, 0);
  if v_miss > 0 and not exists (select 1 from public.rcn_jute_movements where event_key = 'WMS-TRF:'||p_id||':GAP-MISSING') then
    insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, qty, from_location, to_location, from_state, to_state,
      source_type, source_id, reference, note, owner_type, movement_at)
    values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-TRF:'||p_id||':GAP-MISSING', 'PERTE_APPROUVEE', 'INTERNE', v_miss,
      'JUTE-TRANSIT', null, 'EN_TRANSIT', null, 'WMS_TRANSFER', p_id, p_id,
      'Sacs manquants au transfert '||p_id||' · '||v_reason, 'ANAGROCI', now());
  end if;
  if v_surplus > 0 and not exists (select 1 from public.rcn_jute_movements where event_key = 'WMS-TRF:'||p_id||':GAP-SURPLUS') then
    insert into public.rcn_jute_movements(id, event_key, movement_type, ledger, qty, from_location, to_location, from_state, to_state,
      source_type, source_id, reference, note, owner_type, movement_at)
    values ('JUT-WMS-'||replace(gen_random_uuid()::text,'-',''), 'WMS-TRF:'||p_id||':GAP-SURPLUS', 'AJUSTEMENT_INVENTAIRE', 'INTERNE', v_surplus,
      null, v_to, null, 'PLEIN', 'WMS_TRANSFER', p_id, p_id,
      'Sacs reçus en surplus au transfert '||p_id||' · '||v_reason, 'ANAGROCI', now());
  end if;
  v_reco := t.status = 'DISCREPANCY' and coalesce(t.variance_kg,0) = 0;
  update public.wms_transfers set bag_gap_resolved_at = now(), bag_gap_resolved_by_name = c->>'nom', bag_gap_resolution_note = v_reason,
    status = case when v_reco then 'RECONCILED' else status end,
    reconciled_at = case when v_reco then now() else reconciled_at end,
    reconciled_by_name = case when v_reco then c->>'nom' else reconciled_by_name end
  where id = p_id;
  r := public.wms_trf_snapshot(p_id) || jsonb_build_object('bag_gap', t.bag_gap, 'bag_gap_resolved', true, 'bags_missing_written_off', v_miss, 'bags_surplus_added', v_surplus);
  insert into public.wms_transfer_ops values (p_idempotency_key, p_id, 'BAG_GAP', r, (c->>'uid')::uuid, now());
  perform public.wms_trf_audit(p_id, 'BAG_GAP', v_before, r, 'Régularisation écart de sacs ('||t.bag_gap||') : '||v_reason, c->>'nom');
  return r || jsonb_build_object('idempotent', false);
end $f$;
revoke execute on function public.wms_trf_resolve_bag_gap(text, text, text) from public, anon;
grant execute on function public.wms_trf_resolve_bag_gap(text, text, text) to authenticated, service_role;
