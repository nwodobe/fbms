
create or replace function public.procurement_approve_purchase(p_purchase_id uuid,p_approved_price numeric default null,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare c jsonb;s public.procurement_reception_settlements;r public.wms_v_receptions;v_price numeric;v_bap text;before_row jsonb;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['GM','General Manager','Coordination','Administrateur']) then
   raise exception 'Approbation réservée au General Management';
 end if;
 select * into s from public.procurement_reception_settlements where id=p_purchase_id for update;
 if s.id is null then raise exception 'Purchase introuvable'; end if;
 if s.status<>'SUBMITTED' then raise exception 'Purchase doit être SUBMITTED'; end if;
 if s.created_by=(c->>'uid')::uuid or s.submitted_by=(c->>'uid')::uuid then
   raise exception 'Séparation des tâches : préparateur/soumissionnaire et approbateur doivent être différents';
 end if;
 select * into r from public.wms_v_receptions where id=s.reception_id;
 if r.status='REJECTED' then raise exception 'Camion REJECTED'; end if;
 if r.final_id is null then raise exception 'Final Quality requise'; end if;

 v_price:=coalesce(p_approved_price,s.submitted_price);
 if v_price is null or v_price<=0 then raise exception 'Approved Price requis et > 0'; end if;
 if (s.price_exception or s.quality_exception)
    and nullif(btrim(coalesce(p_reason,'')),'') is null then
   raise exception 'Exception prix/qualité : commentaire GM obligatoire';
 end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then p_reason:='Approved'; end if;

 before_row:=to_jsonb(s);
 perform set_config('app.procurement_state_transition','on',true);
 update public.procurement_reception_settlements set
   approved_price=v_price,price_per_kg=v_price,
   amount_approved=round(paid_weight_kg*v_price,2),amount_payable=round(paid_weight_kg*v_price,2),
   status='APPROVED',approved_by=(c->>'uid')::uuid,approved_by_name=c->>'nom',approved_at=now(),
   decision_reason=p_reason,updated_by=(c->>'uid')::uuid
 where id=s.id returning * into s;

 v_bap:='BAP-'||s.purchase_code;
 insert into public.rcn_proc_bons_payer(
   id,purchase_validation_id,purchase_settlement_id,reception_id,supplier_code,supplier_name,
   montant_approuve,statut,commentaire,prepared_by
 ) values(
   v_bap,null,s.id,s.reception_id,s.supplier_code,r.supplier_name,
   s.amount_approved,'BROUILLON','Auto-generated from approved canonical Purchase',(c->>'uid')::uuid
 )
 on conflict do nothing;

 update public.rcn_proc_bons_payer set
   montant_approuve=s.amount_approved,updated_at=now()
 where purchase_settlement_id=s.id and statut in ('BROUILLON','A_CORRIGER');

 select id into v_bap from public.rcn_proc_bons_payer where purchase_settlement_id=s.id;
 if v_bap is null then raise exception 'Échec de création idempotente du Bon à Payer'; end if;

 perform public.wms_audit(s.reception_id,'procurement.purchase.approve',before_row,to_jsonb(s),p_reason);
 return to_jsonb(s)||jsonb_build_object('bap_id',v_bap);
end $$;

revoke all on function public.procurement_approve_purchase(uuid,numeric,text) from public,anon;
grant execute on function public.procurement_approve_purchase(uuid,numeric,text) to authenticated;
