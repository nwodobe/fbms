
begin;
create or replace view public.procurement_v_purchase_kpis
with (security_invoker=true) as
with supplier as (
 select
   coalesce(sum(paid_weight_kg),0)::numeric weight_kg,
   coalesce(sum(coalesce(amount_approved,amount_submitted,0)),0)::numeric value_fcfa,
   count(*) filter(where approval_status='SUBMITTED') awaiting_approval,
   count(*) filter(where approval_status='APPROVED' and payment_status<>'PAID') awaiting_payment,
   count(*) filter(where price_exception or quality_exception) exceptions
 from public.procurement_v_supplier_purchase_register
),
field as (
 select
   coalesce(sum(field_weight_kg),0)::numeric weight_kg,
   coalesce(sum(field_purchase_value),0)::numeric value_fcfa,
   count(*) filter(where reconciliation_status='VARIANCE_REVIEW') exceptions
 from public.procurement_v_field_purchase_summary
)
select
 supplier.weight_kg+field.weight_kg total_commercial_weight_kg,
 supplier.value_fcfa+field.value_fcfa purchase_value_fcfa,
 case when supplier.weight_kg+field.weight_kg>0
      then round((supplier.value_fcfa+field.value_fcfa)/(supplier.weight_kg+field.weight_kg),2)
      else 0 end weighted_avg_price_per_kg,
 supplier.awaiting_approval,
 supplier.awaiting_payment,
 supplier.exceptions+field.exceptions exceptions,
 supplier.weight_kg supplier_weight_kg,
 field.weight_kg field_weight_kg,
 supplier.value_fcfa supplier_value_fcfa,
 field.value_fcfa field_value_fcfa
from supplier,field;

grant select on public.procurement_v_purchase_kpis to authenticated;
commit;
