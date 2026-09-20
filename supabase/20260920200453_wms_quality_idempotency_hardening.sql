
alter table public.wms_quality_snapshots
  add column if not exists idempotency_key text;

create unique index if not exists wms_quality_snapshots_idempotency_uq
  on public.wms_quality_snapshots(idempotency_key)
  where idempotency_key is not null;

create or replace function public.wms_save_quality(p_reception_id text, p_type text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c jsonb; r public.wms_receptions; k jsonb; s public.wms_quality_snapshots;
  v_gk numeric; v_imm numeric; v_sp numeric;
  v_samp public.wms_quality_snapshots; v_delta numeric; v_tol numeric; v_ok boolean;
  v_id text; old_status text; v_prev text; v_key text;
begin
  if p_type not in ('SAMPLING','FINAL') then raise exception 'Type de snapshot invalide (SAMPLING | FINAL)'; end if;
  c := public.wms_require(case when p_type = 'SAMPLING' then 'sampling' else 'final_qa' end);
  v_key := nullif(btrim(coalesce(p->>'idempotency_key','')), '');
  if v_key is not null then
    select * into s from public.wms_quality_snapshots where idempotency_key = v_key limit 1;
    if s.id is not null then
      select * into r from public.wms_receptions where id = s.reception_id;
      return jsonb_build_object('snapshot', to_jsonb(s), 'reception', to_jsonb(r), 'idempotent', true);
    end if;
  end if;

  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if p_type = 'SAMPLING' and r.status not in ('ARRIVED','AWAITING_DECISION') then
    raise exception 'Sampling impossible au statut %', r.status;
  end if;
  if p_type = 'FINAL' and r.status not in ('AWAITING_FINAL_QA','QUALITY_HOLD') then
    raise exception 'Final Quality impossible au statut % (déchargement requis)', r.status;
  end if;

  v_gk := nullif(btrim(coalesce(p->>'gk_g','')),'')::numeric;
  v_imm := nullif(btrim(coalesce(p->>'imm_g','')),'')::numeric;
  v_sp := nullif(btrim(coalesce(p->>'spotted_g','')),'')::numeric;
  k := public.wms_compute_kor(v_gk, v_imm, v_sp);
  if k->>'status' <> 'OK' then
    raise exception 'KOR NOT CALCULATED : Good Kernel, Immature et Spotted sont obligatoires (un champ vide n''est pas un zéro)';
  end if;
  if v_gk < 0 or v_imm < 0 or v_sp < 0 then raise exception 'Mesures négatives interdites'; end if;

  if p_type = 'FINAL' then
    select * into v_samp from public.wms_v_quality_current where reception_id = r.id and type = 'SAMPLING';
    if v_samp.id is null then raise exception 'Aucun Sampling enregistré : Final impossible'; end if;
    v_delta := abs((k->>'korExact')::numeric - v_samp.kor_exact);
    v_tol := coalesce((public.wms_param('korTolerance')->>'value')::numeric, 1);
    v_ok := v_delta < v_tol;
  end if;

  perform pg_advisory_xact_lock(hashtext('wms_qlt_seq'));
  v_id := 'QLT-' || lpad(public.wms_next_seq('QLT')::text, 6, '0');
  select id into v_prev from public.wms_v_quality_current where reception_id = r.id and type = p_type;

  insert into public.wms_quality_snapshots(
    id, reception_id, lot_id, type, gk_g, imm_g, spotted_g, moisture_pct, nut_count,
    browns_g, voids_g, oil_g, weighted_kernel, kor_exact, kor_display, kor_factor,
    formula_version, delta_vs_sampling, within_tolerance, analyst, note, created_by, idempotency_key
  )
  values (
    v_id, r.id, r.lot_id, p_type, v_gk, v_imm, v_sp,
    nullif(btrim(coalesce(p->>'moisture_pct','')),'')::numeric,
    nullif(btrim(coalesce(p->>'nut_count','')),'')::int,
    nullif(p->>'browns_g','')::numeric, nullif(p->>'voids_g','')::numeric, nullif(p->>'oil_g','')::numeric,
    (k->>'weightedKernel')::numeric, (k->>'korExact')::numeric, (k->>'korDisplay')::numeric,
    (k->>'factor')::numeric, k->>'formulaVersion', v_delta, v_ok, c->>'nom', p->>'note',
    (c->>'uid')::uuid, v_key
  ) returning * into s;

  if v_prev is not null then
    update public.wms_quality_snapshots set superseded_by = v_id where id = v_prev;
    perform public.wms_audit(r.id, p_type||'.version', to_jsonb(v_prev), to_jsonb(v_id),
      coalesce(p->>'reason','Nouvelle version du snapshot (ancienne conservée)'));
  end if;

  old_status := r.status;
  if p_type = 'SAMPLING' then
    update public.wms_receptions
       set status = 'AWAITING_DECISION', updated_by = (c->>'uid')::uuid, updated_at = now()
     where id = r.id and status = 'ARRIVED';
  else
    if not v_ok then
      update public.wms_receptions
         set status = 'QUALITY_HOLD',
             hold_reason = format('Écart KOR %s ≥ tolérance %s', round(v_delta,2), v_tol),
             updated_by = (c->>'uid')::uuid, updated_at = now()
       where id = r.id;
    elsif r.status = 'QUALITY_HOLD' then
      update public.wms_receptions
         set status = 'AWAITING_FINAL_QA', hold_reason = null,
             updated_by = (c->>'uid')::uuid, updated_at = now()
       where id = r.id;
    end if;
  end if;

  select * into r from public.wms_receptions where id = r.id;
  perform public.wms_audit(
    r.id, p_type, jsonb_build_object('status', old_status),
    jsonb_build_object('snapshot', v_id, 'kor', s.kor_display, 'factor', s.kor_factor,
      'status', r.status, 'delta', v_delta, 'idempotency_key', v_key),
    'Saisie '||p_type
  );
  return jsonb_build_object('snapshot', to_jsonb(s), 'reception', to_jsonb(r), 'idempotent', false);
end
$function$;

