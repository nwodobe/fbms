-- =====================================================================
-- FBMS · Correctifs audit Procurement & Warehouse du 24/09/2026
-- Lot 6 : GRN officiel (P1-08), checklist documentaire CCA (P1-09),
--         gouvernance des paramètres (P1-13)
-- Lot 5 (serveur) : lignes de mouvements par Lot pour l'historique et le
--         journal (P1-06)
-- Migration NON destructive.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Journal des mouvements : une ligne par Lot et par mouvement (P1-06)
-- ---------------------------------------------------------------------
create or replace view public.wms_v_movement_lines with (security_invoker = true) as
select ml.movement_id, ml.lot_id, ml.qty_out, ml.qty_in,
       m.type, m.status, m.posted_at, m.warehouse_id, w.code as warehouse_code,
       m.source_type, m.source_id, m.dest_type, m.dest_id,
       case when m.dest_type = 'BIN' then m.dest_id when m.source_type = 'BIN' then m.source_id end as bin_id,
       m.reference_type, m.reference_id, m.reason, m.approved_by, m.process_loss_kg, m.variance_kg,
       m.truck, m.supplier_name, m.created_by_name, m.created_role
from public.wms_movement_lots ml
join public.wms_movements m on m.id = ml.movement_id
left join public.wms_warehouses w on w.id = m.warehouse_id;
grant select on public.wms_v_movement_lines to authenticated;
revoke all on public.wms_v_movement_lines from anon;

-- ---------------------------------------------------------------------
-- 1 bis. Correction de la matrice de rôles v2 (migration 20260924233935) :
--    l'action grn_generate a été enregistrée vide (priorité des opérateurs
--    -> / || en SQL). Elle est recalculée : offload ∪ decision ∪ lot_release.
-- ---------------------------------------------------------------------
update public.wms_parameters
   set value = jsonb_set(value, '{grn_generate}',
         (select jsonb_agg(distinct x) from jsonb_array_elements((value->'offload') || (value->'decision') || (value->'lot_release')) x))
 where key = 'roleMatrix' and value ? 'quality_derogation'
   and (value->'grn_generate' is null or jsonb_typeof(value->'grn_generate') <> 'array');

-- ---------------------------------------------------------------------
-- 2. GRN officiel numéroté (P1-08) : GRN-BKE002-2026-0001
-- ---------------------------------------------------------------------
create table if not exists public.wms_grns (
  id text primary key,
  reception_id text not null unique references public.wms_receptions(id),
  warehouse_id uuid not null references public.wms_warehouses(id),
  lot_id text references public.wms_lots(id),
  status text not null default 'EMIS' check (status in ('EMIS','ANNULE')),
  content jsonb not null,
  issued_by uuid,
  issued_by_name text,
  issued_role text,
  issued_at timestamptz not null default now()
);
alter table public.wms_grns enable row level security;
drop policy if exists wms_grns_sel on public.wms_grns;
create policy wms_grns_sel on public.wms_grns for select to authenticated using ((select public.rcn_est_actif()));
revoke insert, update, delete, truncate on public.wms_grns from anon, authenticated;
grant select on public.wms_grns to authenticated;
drop trigger if exists trg_wms_scope_grns on public.wms_grns;
create trigger trg_wms_scope_grns before insert on public.wms_grns
  for each row execute function private.wms_enforce_warehouse_scope();

-- ---------------------------------------------------------------------
-- 3. Documents de réception CCA (P1-09)
--    La liste des documents OBLIGATOIRES par canal est une décision métier :
--    elle est livrée vide (A_VALIDER) et se valide par le Branch Manager.
-- ---------------------------------------------------------------------
create table if not exists public.wms_document_types (
  code text primary key,
  label text not null,
  sort_order int not null default 100,
  mandatory_channels text[] not null default '{}',
  governance_status text not null default 'A_VALIDER' check (governance_status in ('A_VALIDER','VALIDE','ARCHIVE')),
  validated_by uuid,
  validated_by_name text,
  validated_at timestamptz,
  validation_reason text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.wms_document_types enable row level security;
drop policy if exists wms_document_types_sel on public.wms_document_types;
create policy wms_document_types_sel on public.wms_document_types for select to authenticated using ((select public.rcn_est_actif()));
revoke insert, update, delete, truncate on public.wms_document_types from anon, authenticated;
grant select on public.wms_document_types to authenticated;

insert into public.wms_document_types(code, label, sort_order) values
  ('CCAK','CCAK',10),
  ('BORDEREAU','Bordereau',20),
  ('LAISSEZ_PASSER','Laissez-passer',30),
  ('CONNAISSEMENT','Connaissement',40),
  ('FICHE_FOURNISSEUR','Fiche fournisseur',50),
  ('TICKET_PESEE','Ticket de pesée',60),
  ('AUTRE','Autre document',99)
on conflict (code) do nothing;

create table if not exists public.wms_reception_documents (
  id bigserial primary key,
  reception_id text not null references public.wms_receptions(id),
  doc_type text not null references public.wms_document_types(code),
  status text not null check (status in ('PRESENT','ABSENT','NON_CONFORME')),
  reference text,
  file_path text,
  note text,
  recorded_by uuid,
  recorded_by_name text,
  recorded_role text,
  recorded_at timestamptz not null default now(),
  unique (reception_id, doc_type)
);
alter table public.wms_reception_documents enable row level security;
drop policy if exists wms_reception_documents_sel on public.wms_reception_documents;
create policy wms_reception_documents_sel on public.wms_reception_documents for select to authenticated using ((select public.rcn_est_actif()));
revoke insert, update, delete, truncate on public.wms_reception_documents from anon, authenticated;
grant select on public.wms_reception_documents to authenticated;

alter table public.wms_receptions add column if not exists doc_derogation_by uuid;
alter table public.wms_receptions add column if not exists doc_derogation_by_name text;
alter table public.wms_receptions add column if not exists doc_derogation_at timestamptz;
alter table public.wms_receptions add column if not exists doc_derogation_reason text;

create or replace view public.wms_v_reception_documents_status with (security_invoker = true) as
with req as (
  select r.id as reception_id, t.code, t.label, t.governance_status,
         (t.active and (t.mandatory_channels @> array['*'] or (r.procurement_channel is not null and t.mandatory_channels @> array[r.procurement_channel]))) as mandatory,
         d.status as doc_status, d.reference, d.file_path, d.recorded_at, d.recorded_by_name
  from public.wms_receptions r
  cross join public.wms_document_types t
  left join public.wms_reception_documents d on d.reception_id = r.id and d.doc_type = t.code
  where t.active
)
select r.id as reception_id, r.procurement_channel,
  coalesce((select jsonb_agg(jsonb_build_object('code',q.code,'label',q.label,'mandatory',q.mandatory,'status',coalesce(q.doc_status,'NON_SAISI'),
            'reference',q.reference,'file_path',q.file_path,'recorded_at',q.recorded_at,'recorded_by',q.recorded_by_name) order by t.sort_order)
            from req q join public.wms_document_types t on t.code = q.code where q.reception_id = r.id), '[]'::jsonb) as documents,
  coalesce((select array_agg(q.code) from req q where q.reception_id = r.id and q.mandatory and coalesce(q.doc_status,'NON_SAISI') in ('NON_SAISI','ABSENT')), '{}') as missing_mandatory,
  coalesce((select array_agg(q.code) from req q where q.reception_id = r.id and q.mandatory and q.doc_status = 'NON_CONFORME'), '{}') as non_conforming_mandatory,
  exists (select 1 from req q where q.reception_id = r.id and q.mandatory) as has_mandatory_rules,
  not exists (select 1 from public.wms_document_types t where t.active and t.governance_status <> 'VALIDE') as matrix_validated,
  r.doc_derogation_by_name, r.doc_derogation_at, r.doc_derogation_reason,
  case
    when r.doc_derogation_at is not null then 'DEROGATION_BM'
    when exists (select 1 from req q where q.reception_id = r.id and q.mandatory and q.doc_status = 'NON_CONFORME') then 'REJETE'
    when exists (select 1 from req q where q.reception_id = r.id and q.mandatory and coalesce(q.doc_status,'NON_SAISI') in ('NON_SAISI','ABSENT')) then 'INCOMPLET'
    else 'COMPLET'
  end as doc_status
from public.wms_receptions r;
grant select on public.wms_v_reception_documents_status to authenticated;
revoke all on public.wms_v_reception_documents_status from anon;

create or replace function public.wms_record_reception_document(p_reception_id text, p_doc_type text, p_status text,
                                                                p_reference text default null, p_file_path text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions; d public.wms_reception_documents; v_status text := upper(btrim(coalesce(p_status,''))); v_msg text; v_before jsonb;
begin
  c := public.wms_require('document_record');
  select * into r from public.wms_receptions where id = p_reception_id;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  v_msg := private.wms_scope_violation(r.warehouse_id);
  if v_msg is not null then raise exception '%', v_msg using errcode = '42501'; end if;
  if not exists (select 1 from public.wms_document_types where code = p_doc_type and active) then raise exception 'Type de document inconnu : %', p_doc_type; end if;
  if v_status not in ('PRESENT','ABSENT','NON_CONFORME') then raise exception 'Statut document invalide (PRESENT, ABSENT, NON_CONFORME)'; end if;
  if v_status = 'PRESENT' and coalesce(btrim(p_reference),'') = '' and coalesce(btrim(p_file_path),'') = '' then
    raise exception 'Document présent : référence ou pièce jointe obligatoire';
  end if;
  if v_status = 'NON_CONFORME' and coalesce(btrim(p_note),'') = '' then raise exception 'Document non conforme : motif obligatoire'; end if;
  if p_file_path is not null and p_file_path not like 'wms-reception-docs/%' and p_file_path not like r.id||'/%' then
    raise exception 'Chemin de pièce jointe invalide';
  end if;
  select to_jsonb(x) into v_before from public.wms_reception_documents x where reception_id = r.id and doc_type = p_doc_type;
  insert into public.wms_reception_documents(reception_id, doc_type, status, reference, file_path, note, recorded_by, recorded_by_name, recorded_role, recorded_at)
  values (r.id, p_doc_type, v_status, nullif(btrim(p_reference),''), nullif(btrim(p_file_path),''), nullif(btrim(p_note),''), (c->>'uid')::uuid, c->>'nom', c->>'role', now())
  on conflict (reception_id, doc_type) do update set status = excluded.status, reference = excluded.reference,
     file_path = coalesce(excluded.file_path, public.wms_reception_documents.file_path), note = excluded.note,
     recorded_by = excluded.recorded_by, recorded_by_name = excluded.recorded_by_name, recorded_role = excluded.recorded_role, recorded_at = now()
  returning * into d;
  perform public.wms_audit(r.id, 'document.'||lower(p_doc_type), v_before, to_jsonb(d), coalesce(p_note, 'Document '||v_status));
  return to_jsonb(d);
end $function$;
revoke all on function public.wms_record_reception_document(text,text,text,text,text,text) from public, anon;
grant execute on function public.wms_record_reception_document(text,text,text,text,text,text) to authenticated;

create or replace function public.wms_document_derogation(p_reception_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions;
begin
  c := public.wms_require('document_derogation');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif de dérogation obligatoire'; end if;
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status not in ('ARRIVED','AWAITING_DECISION') then raise exception 'Dérogation documentaire possible uniquement avant la décision (statut %)', r.status; end if;
  update public.wms_receptions set doc_derogation_by = (c->>'uid')::uuid, doc_derogation_by_name = c->>'nom', doc_derogation_at = now(),
         doc_derogation_reason = p_reason, updated_by = (c->>'uid')::uuid, updated_at = now()
   where id = r.id returning * into r;
  perform public.wms_audit(r.id, 'document.derogation', null, jsonb_build_object('by', c->>'nom', 'role', c->>'role'), p_reason, c->>'nom');
  return (select to_jsonb(v) from public.wms_v_reception_documents_status v where v.reception_id = r.id);
end $function$;
revoke all on function public.wms_document_derogation(text,text) from public, anon;
grant execute on function public.wms_document_derogation(text,text) to authenticated;

create or replace function public.wms_set_document_requirement(p_doc_type text, p_mandatory_channels text[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; t public.wms_document_types; v_before jsonb; ch text;
begin
  c := public.wms_require('parameter_set');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif obligatoire (décision métier)'; end if;
  select * into t from public.wms_document_types where code = p_doc_type for update;
  if t.code is null then raise exception 'Type de document inconnu'; end if;
  foreach ch in array coalesce(p_mandatory_channels,'{}') loop
    if ch <> '*' and not exists (select 1 from public.procurement_channels where code = ch) then raise exception 'Canal inconnu : %', ch; end if;
  end loop;
  v_before := to_jsonb(t);
  update public.wms_document_types set mandatory_channels = coalesce(p_mandatory_channels,'{}'), governance_status = 'VALIDE',
         validated_by = (c->>'uid')::uuid, validated_by_name = c->>'nom', validated_at = now(), validation_reason = p_reason, updated_at = now()
   where code = p_doc_type returning * into t;
  perform public.wms_audit('DOCTYPE:'||p_doc_type, 'mandatory_channels', v_before, to_jsonb(t), p_reason, c->>'nom');
  return to_jsonb(t);
end $function$;
revoke all on function public.wms_set_document_requirement(text,text[],text) from public, anon;
grant execute on function public.wms_set_document_requirement(text,text[],text) to authenticated;

-- Décision d'arrivée : acceptation bloquée si un document obligatoire manque
-- ou n'est pas conforme (sauf dérogation BM tracée). Le refus reste possible.
create or replace function public.wms_decide_reception(p_id text, p_accept boolean, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions; old text; v_doc text; v_missing text[]; v_bad text[];
begin
  c := public.wms_require('decision');
  select * into r from public.wms_receptions where id = p_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.status <> 'AWAITING_DECISION' then raise exception 'Décision impossible : statut % (le Sampling doit être saisi)', r.status; end if;
  if not p_accept and coalesce(btrim(p_comment),'') = '' then raise exception 'Motif obligatoire en cas de refus'; end if;
  if p_accept then
    select doc_status, missing_mandatory, non_conforming_mandatory into v_doc, v_missing, v_bad
      from public.wms_v_reception_documents_status where reception_id = p_id;
    if v_doc in ('INCOMPLET','REJETE') then
      raise exception 'Acceptation bloquée : documents obligatoires manquants (%) ou non conformes (%). Compléter la checklist ou obtenir une dérogation BM.',
        coalesce(array_to_string(v_missing, ', '),'-'), coalesce(array_to_string(v_bad, ', '),'-') using errcode = '42501';
    end if;
  end if;
  if not p_accept and r.rejection_reason_code is null then
    update public.wms_receptions set rejection_reason_code = 'OTHER' where id = p_id returning * into r;
  end if;
  old := r.status;
  update public.wms_receptions set status = case when p_accept then 'ACCEPTED_WAITING_OFFLOAD' else 'REJECTED' end,
    decision = case when p_accept then 'ACCEPTED' else 'REJECTED' end, decision_comment = p_comment,
    decided_by = (c->>'uid')::uuid, decided_by_name = c->>'nom', decided_at = now(), updated_by = (c->>'uid')::uuid, updated_at = now()
  where id = p_id returning * into r;
  perform public.wms_audit(r.id, 'decision', to_jsonb(old), to_jsonb(r.status), coalesce(p_comment, case when p_accept then 'Camion accepté' else 'Camion refusé' end), c->>'nom');
  return to_jsonb(r);
end $function$;

-- Stockage des pièces justificatives (privé)
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('wms-reception-docs','wms-reception-docs',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists wms_reception_docs_insert on storage.objects;
create policy wms_reception_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'wms-reception-docs' and (select public.wms_can('document_record'))
              and exists (select 1 from public.wms_receptions r where r.id = (storage.foldername(name))[1]));
drop policy if exists wms_reception_docs_read on storage.objects;
create policy wms_reception_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'wms-reception-docs' and (select public.rcn_est_actif()));

-- ---------------------------------------------------------------------
-- 4. GRN : génération idempotente
-- ---------------------------------------------------------------------
create or replace function public.wms_generate_grn(p_reception_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; r public.wms_receptions; g public.wms_grns; w public.wms_warehouses; l public.wms_lots; s public.wms_quality_snapshots; f public.wms_quality_snapshots;
        v_code text; v_year text; v_id text; v_docs jsonb; v_drg jsonb;
begin
  c := public.wms_require('grn_generate');
  select * into g from public.wms_grns where reception_id = p_reception_id;
  if g.id is not null then return to_jsonb(g) || jsonb_build_object('idempotent', true); end if;
  select * into r from public.wms_receptions where id = p_reception_id for update;
  if r.id is null then raise exception 'Réception introuvable'; end if;
  if r.net_kg is null or r.offloaded_at is null then raise exception 'GRN impossible : la réception n''est pas déchargée / pesée'; end if;
  select * into w from public.wms_warehouses where id = r.warehouse_id;
  select * into l from public.wms_lots where id = r.lot_id;
  select * into s from public.wms_v_quality_current where reception_id = r.id and type = 'SAMPLING';
  select * into f from public.wms_v_quality_current where reception_id = r.id and type = 'FINAL';
  select documents into v_docs from public.wms_v_reception_documents_status where reception_id = r.id;
  select to_jsonb(d) into v_drg from public.wms_quality_derogations d where d.lot_id = r.lot_id order by created_at desc limit 1;
  v_code := replace(w.code, '-', '');
  v_year := to_char(coalesce(r.offloaded_at, now()) at time zone 'UTC', 'YYYY');
  perform pg_advisory_xact_lock(hashtext('wms_grn_seq:'||v_code||':'||v_year));
  v_id := 'GRN-'||v_code||'-'||v_year||'-'||lpad(public.wms_next_seq('GRN:'||v_code||':'||v_year)::text, 4, '0');
  insert into public.wms_grns(id, reception_id, warehouse_id, lot_id, content, issued_by, issued_by_name, issued_role)
  values (v_id, r.id, r.warehouse_id, r.lot_id, jsonb_build_object(
      'grn', v_id, 'warehouse', jsonb_build_object('code', w.code, 'name', w.name, 'site', w.site_code),
      'reception', jsonb_build_object('id', r.id, 'arrival_at', r.arrival_at, 'truck', r.truck, 'driver', r.driver, 'transporter', r.transporter,
         'channel', r.procurement_channel, 'purchase_type', r.purchase_type, 'source', r.procurement_source_type, 'source_id', r.procurement_source_id,
         'reference', r.reference, 'expected_kg', r.expected_kg, 'expected_bags', r.expected_bags, 'status_at_issue', r.status,
         'decision', r.decision, 'decided_by', r.decided_by_name, 'decided_at', r.decided_at, 'decision_comment', r.decision_comment),
      'supplier', jsonb_build_object('code', r.supplier_code, 'name', r.supplier_name, 'lba_code', r.lba_code, 'origin', r.origin),
      'weighing', jsonb_build_object('gross_kg', r.gross_kg, 'tare_kg', r.tare_kg, 'net_kg', r.net_kg, 'weighbridge_ticket', r.weighbridge_ticket,
         'offload_start', r.offload_start, 'offload_end', r.offload_end, 'offloaded_at', r.offloaded_at),
      'bags', jsonb_build_object('total', r.bags, 'good', r.bags_good, 'wet', r.bags_wet, 'torn', r.bags_torn, 'reconditioned', r.bags_recond),
      'documents', jsonb_build_object('delivery_note', r.delivery_note, 'warehouse_receipt', r.warehouse_receipt, 'checklist', coalesce(v_docs,'[]'::jsonb),
         'derogation_bm', case when r.doc_derogation_at is not null then jsonb_build_object('by', r.doc_derogation_by_name, 'at', r.doc_derogation_at, 'reason', r.doc_derogation_reason) end),
      'lot', case when l.id is not null then jsonb_build_object('id', l.id, 'status_at_issue', l.status, 'initial_kg', l.initial_kg, 'initial_bags', l.initial_bags) end,
      'quality', jsonb_build_object('sampling_kor', s.kor_display, 'sampling_moisture', s.moisture_pct, 'sampling_nut_count', s.nut_count,
         'final_kor', f.kor_display, 'final_moisture', f.moisture_pct, 'final_nut_count', f.nut_count, 'kor_delta', f.delta_vs_sampling,
         'within_tolerance', f.within_tolerance, 'kor_factor', coalesce(f.kor_factor, s.kor_factor), 'formula', coalesce(f.formula_version, s.formula_version)),
      'quality_derogation', v_drg,
      'issued', jsonb_build_object('by', c->>'nom', 'role', c->>'role', 'at', now())
    ), (c->>'uid')::uuid, c->>'nom', c->>'role')
  returning * into g;
  perform public.wms_audit(r.id, 'grn', null, jsonb_build_object('grn', v_id, 'lot', r.lot_id, 'net_kg', r.net_kg), 'Émission du GRN officiel', c->>'nom');
  return to_jsonb(g) || jsonb_build_object('idempotent', false);
end $function$;
revoke all on function public.wms_generate_grn(text) from public, anon;
grant execute on function public.wms_generate_grn(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Gouvernance des paramètres (P1-13)
--    BROUILLON (à valider) → VALIDE (décision métier tracée) → ARCHIVE.
--    Une version VALIDE prime sur une version plus récente encore en brouillon.
-- ---------------------------------------------------------------------
alter table public.wms_parameters add column if not exists governance_status text not null default 'BROUILLON';
alter table public.wms_parameters drop constraint if exists wms_parameters_governance_status_check;
alter table public.wms_parameters add constraint wms_parameters_governance_status_check
  check (governance_status in ('BROUILLON','VALIDE','ARCHIVE'));
alter table public.wms_parameters add column if not exists validated_by uuid;
alter table public.wms_parameters add column if not exists validated_by_name text;
alter table public.wms_parameters add column if not exists validated_at timestamptz;
alter table public.wms_parameters add column if not exists validation_reason text;

-- La matrice de rôles v1 est remplacée par la v2 : elle est archivée (conservée).
update public.wms_parameters p set governance_status = 'ARCHIVE'
 where p.key = 'roleMatrix' and p.governance_status = 'BROUILLON'
   and p.version < (select max(version) from public.wms_parameters q where q.key = 'roleMatrix');

create or replace function public.wms_param(p_key text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select value from public.wms_parameters
  where key = p_key and active and effective_from <= now() and governance_status <> 'ARCHIVE'
  order by (governance_status = 'VALIDE') desc, effective_from desc, version desc limit 1;
$function$;

do $$
declare d text; anchor text := 'values (p_key, p_value, coalesce(v_ver,0)+1, c->>''nom'', p_reason, (c->>''uid'')::uuid)';
begin
  select pg_get_functiondef('public.wms_set_parameter(text,jsonb,text)'::regprocedure) into d;
  if position(anchor in d) > 0 then
    d := replace(d, anchor, 'values (p_key, p_value, coalesce(v_ver,0)+1, null, p_reason, (c->>''uid'')::uuid)');
    execute d;
  end if;
end $$;

create or replace function public.wms_validate_parameter(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; p public.wms_parameters;
begin
  c := public.wms_require('parameter_set');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motif de validation obligatoire (référence de la décision métier)'; end if;
  select * into p from public.wms_parameters where id = p_id for update;
  if p.id is null then raise exception 'Paramètre introuvable'; end if;
  if p.governance_status = 'VALIDE' then return to_jsonb(p) || jsonb_build_object('idempotent', true); end if;
  if p.governance_status = 'ARCHIVE' then raise exception 'Version archivée : proposer une nouvelle version'; end if;
  if p.created_by is not null and p.created_by = (c->>'uid')::uuid then
    raise exception 'Séparation des tâches : l''auteur d''une version ne peut pas la valider' using errcode = '42501';
  end if;
  update public.wms_parameters set governance_status = 'VALIDE', validated_by = (c->>'uid')::uuid, validated_by_name = c->>'nom',
         validated_at = now(), validation_reason = p_reason
   where id = p.id returning * into p;
  update public.wms_parameters set governance_status = 'ARCHIVE'
   where key = p.key and id <> p.id and governance_status in ('VALIDE','BROUILLON') and version < p.version;
  perform public.wms_audit('PARAM:'||p.key, 'governance', null, jsonb_build_object('version', p.version, 'status', 'VALIDE'), p_reason, c->>'nom');
  return to_jsonb(p) || jsonb_build_object('idempotent', false);
end $function$;
revoke all on function public.wms_validate_parameter(uuid,text) from public, anon;
grant execute on function public.wms_validate_parameter(uuid,text) to authenticated;

create or replace view public.wms_v_parameters_governance with (security_invoker = true) as
select p.id, p.key, p.version, p.value, p.effective_from, p.active, p.governance_status,
       p.reason, p.created_at, p.created_by, pr.nom as created_by_name,
       p.validated_by_name, p.validated_at, p.validation_reason,
       (p.value->>'status') = 'A_VALIDER' as value_flagged_a_valider,
       (p.value is not distinct from public.wms_param(p.key)
        and p.id = (select q.id from public.wms_parameters q
                     where q.key = p.key and q.active and q.effective_from <= now() and q.governance_status <> 'ARCHIVE'
                     order by (q.governance_status = 'VALIDE') desc, q.effective_from desc, q.version desc limit 1)) as is_current
from public.wms_parameters p
left join public.profils pr on pr.user_id = p.created_by;
grant select on public.wms_v_parameters_governance to authenticated;
revoke all on public.wms_v_parameters_governance from anon;
