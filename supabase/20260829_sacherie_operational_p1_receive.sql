-- Reception terrain des transferts Sacherie P1.
create or replace function public.sacherie_ops_receive_transfer(
  p_client_operation_id text,
  p_transfer_id text,
  p_qty integer,
  p_motif text default null,
  p_document_ref text default null,
  p_proof_url text default null
) returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid(); v_t public.rcn_jute_transfers%rowtype; v_total integer; v_event text; v_mid text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if coalesce(btrim(p_client_operation_id),'')='' then raise exception 'Idempotency key obligatoire'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'Quantite recue invalide'; end if;
  v_event:='TRANSFER-RECEIVE:'||btrim(p_client_operation_id);
  if exists(select 1 from public.rcn_jute_movements where event_key=v_event) then
    select * into v_t from public.rcn_jute_transfers where id=p_transfer_id;
    return to_jsonb(v_t);
  end if;
  select * into v_t from public.rcn_jute_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfert introuvable'; end if;
  if v_t.statut in ('CLOS','ANNULE') then raise exception 'Transfert deja cloture'; end if;
  perform public.sacherie_ct_assert_location_access(v_t.to_location,true);
  v_total:=coalesce(v_t.qty_received,0)+p_qty;
  if v_total>v_t.qty_sent then raise exception 'Reception superieure a la quantite expediee'; end if;
  if v_total<v_t.qty_sent and coalesce(btrim(p_motif),'')='' then raise exception 'Motif obligatoire pour une reception partielle'; end if;
  v_mid:='JUT-P1-'||substr(md5(v_event),1,20);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,source_type,source_id,reference,note,proof_url,movement_at,owner_type,created_by,campaign,cluster)
  values(v_mid,v_event,'TRANSFERT','INTERNE',p_qty,'JUTE-TRANSIT',v_t.to_location,'EN_TRANSIT',v_t.state,'TRANSFERT_P1_RECEIPT',v_t.id,
    coalesce(nullif(p_document_ref,''),v_t.document_ref),p_motif,p_proof_url,now(),'ANAGROCI',v_uid,'2027',
    (select cluster from public.rcn_jute_locations where code=v_t.to_location));
  update public.rcn_jute_transfers set qty_received=v_total,ecart=qty_sent-v_total,
    motif_ecart=case when v_total<qty_sent then p_motif else null end,
    statut=case when v_total<qty_sent then 'ECART' else 'CLOS' end,
    received_by=v_uid,received_at=now(),proof_url=coalesce(p_proof_url,proof_url)
  where id=v_t.id returning * into v_t;
  return to_jsonb(v_t);
exception when unique_violation then
  select * into v_t from public.rcn_jute_transfers where id=p_transfer_id;
  return to_jsonb(v_t);
end $$;

grant execute on function public.sacherie_ops_receive_transfer(text,text,integer,text,text,text) to authenticated;
