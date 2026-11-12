-- Procurement Control Tower : indicateurs et actions limités à la campagne choisie.
--
-- Constat du 12/11/2026 : avec la campagne réelle 0002 active, le Control Tower affichait 44,7 MT et une action
-- « À soumettre » issues de la campagne « Simulation AFLP 2027 ». Les vues procurement_v_* agrègent toutes les
-- campagnes, alors que les simulations ne doivent jamais se mélanger aux chiffres d'une campagne réelle.
--
-- Correctif :
--  1. ajout d'une colonne campaign_id, en dernière position, aux vues utilisées par le Control Tower
--     (create or replace view n'autorise que l'ajout de colonnes en fin de liste : aucune colonne existante ne bouge) ;
--  2. fonction procurement_purchase_kpis_campagne(p_campaign_id) : mêmes indicateurs que procurement_v_purchase_kpis,
--     filtrés sur la campagne. La vue globale est conservée pour les autres usages.
-- Les vues restent en security_invoker : les droits RLS de l'utilisateur s'appliquent comme avant.

create or replace view public.procurement_v_supplier_purchase_register with (security_invoker = true) as
 SELECT s.id AS purchase_id,
    s.purchase_code,
    COALESCE(s.submitted_at, s.created_at, r.arrival_at) AS purchase_at,
    s.procurement_channel,
    s.purchase_type,
    s.campaign,
    r.supplier_code,
    r.supplier_name,
    r.id AS reception_id,
    r.warehouse_id,
    r.warehouse_code,
    r.warehouse_name,
    r.origin,
    r.truck,
    r.bags,
    r.net_kg AS warehouse_net_kg,
    s.refraction_mode,
    s.refraction_value,
    s.refraction_kg,
    s.refraction_reason,
    s.paid_weight_kg,
    r.sampling_kor,
    r.sampling_moisture,
    r.final_kor,
    r.final_moisture,
        CASE
            WHEN (r.final_id IS NOT NULL) THEN 'FINAL'::text
            WHEN (r.sampling_id IS NOT NULL) THEN 'SAMPLING'::text
            ELSE NULL::text
        END AS quality_source,
    s.price_ref,
    s.reference_price,
    s.negotiated_price,
    s.submitted_price,
    s.approved_price,
    COALESCE(s.approved_price, s.submitted_price, s.negotiated_price) AS effective_price,
    s.amount_submitted,
    s.amount_approved,
    s.status AS approval_status,
    s.price_exception,
    s.price_exception_pct,
    s.quality_exception,
    s.quality_exception_reason,
    s.created_by_name,
    s.submitted_by_name,
    s.approved_by_name,
    s.submitted_at,
    s.approved_at,
    s.decision_reason,
    f.bap_id,
    f.bap_status,
    f.amount_paid,
    f.outstanding_amount,
    f.payment_status,
    f.last_payment_date,
        CASE
            WHEN (r.status = 'REJECTED'::text) THEN 'REJECTED_TRUCK'::text
            WHEN (r.net_kg IS NULL) THEN 'MISSING_NET_WEIGHT'::text
            WHEN (r.final_id IS NULL) THEN 'MISSING_FINAL_QUALITY'::text
            WHEN (s.status = 'DRAFT'::text) THEN 'AWAITING_SUBMISSION'::text
            WHEN (s.status = 'CHANGES_REQUESTED'::text) THEN 'CHANGES_REQUESTED'::text
            WHEN (s.status = 'SUBMITTED'::text) THEN 'AWAITING_APPROVAL'::text
            WHEN ((s.status = 'APPROVED'::text) AND (f.bap_id IS NULL)) THEN 'APPROVED_AWAITING_BAP'::text
            WHEN ((s.status = 'APPROVED'::text) AND (f.payment_status = ANY (ARRAY['UNPAID'::text, 'PENDING'::text, 'PARTIAL'::text]))) THEN 'AWAITING_PAYMENT'::text
            ELSE NULL::text
        END AS action_required,
    s.campaign_id
   FROM ((procurement_reception_settlements s
     JOIN wms_v_receptions r ON ((r.id = s.reception_id)))
     LEFT JOIN procurement_v_purchase_finance f ON ((f.purchase_id = s.id)));

create or replace view public.procurement_v_field_purchase_summary with (security_invoker = true) as
 SELECT fs.id AS shipment_id,
    fs.shipment_code,
    fs.departed_at AS purchase_at,
    'FIELD_BUYING'::text AS procurement_channel,
    'FIELD_BUYING'::text AS purchase_type,
    fs.origin_label,
    fs.destination_label,
    fs.vehicle_plate,
    count(DISTINCT flc.achat_id) AS producer_purchase_count,
    count(DISTINCT a.producteur_id) AS producer_count,
    string_agg(DISTINCT a.cluster, ', '::text ORDER BY a.cluster) AS clusters,
    string_agg(DISTINCT a.village_nom, ', '::text ORDER BY a.village_nom) AS villages,
    sum(flc.qty_kg) AS field_weight_kg,
    sum((COALESCE(a.montant, (0)::numeric) * (flc.qty_kg / NULLIF(a.poids_net, (0)::numeric)))) AS field_purchase_value,
    r.id AS reception_id,
    r.warehouse_code,
    r.net_kg AS warehouse_net_kg,
        CASE
            WHEN (r.net_kg IS NULL) THEN NULL::numeric
            ELSE round((r.net_kg - sum(flc.qty_kg)), 3)
        END AS variance_kg,
        CASE
            WHEN ((r.net_kg IS NULL) OR (sum(flc.qty_kg) = (0)::numeric)) THEN NULL::numeric
            ELSE round((((r.net_kg - sum(flc.qty_kg)) * 100.0) / sum(flc.qty_kg)), 3)
        END AS variance_pct,
        CASE
            WHEN (r.id IS NULL) THEN 'AWAITING_WAREHOUSE_RECEPTION'::text
            WHEN (r.net_kg IS NULL) THEN 'AWAITING_WEIGHING'::text
            WHEN (abs((r.net_kg - sum(flc.qty_kg))) <= 0.001) THEN 'BALANCED'::text
            ELSE 'VARIANCE_REVIEW'::text
        END AS reconciliation_status,
    fs.campaign_id
   FROM ((((field_shipments fs
     JOIN field_shipment_lots fsl ON ((fsl.shipment_id = fs.id)))
     JOIN field_lot_contributors flc ON (((flc.lot_id = fsl.lot_id) AND (flc.status = 'ACTIVE'::text))))
     JOIN achats a ON ((a.id = flc.achat_id)))
     LEFT JOIN wms_v_receptions r ON ((r.field_shipment_id = fs.id)))
  WHERE (fs.status <> ALL (ARRAY['DRAFT'::text, 'CANCELLED'::text]))
  GROUP BY fs.id, fs.shipment_code, fs.departed_at, fs.origin_label, fs.destination_label, fs.vehicle_plate, r.id, r.warehouse_code, r.net_kg, fs.campaign_id;

create or replace view public.procurement_v_ready_supplier_receptions with (security_invoker = true) as
 SELECT r.id AS reception_id,
    r.arrival_at,
    r.procurement_channel,
    r.purchase_type,
    r.supplier_code,
    r.supplier_name,
    r.warehouse_id,
    r.warehouse_code,
    r.warehouse_name,
    r.truck,
    r.origin,
    r.net_kg,
    r.bags,
    r.sampling_kor,
    r.sampling_moisture,
    r.final_kor,
    r.final_moisture,
    r.final_id,
        CASE
            WHEN (r.status = 'REJECTED'::text) THEN 'REJECTED'::text
            WHEN ((r.net_kg IS NULL) OR (r.net_kg <= (0)::numeric)) THEN 'WAITING_WEIGHING'::text
            WHEN (r.final_id IS NULL) THEN 'WAITING_FINAL_QUALITY'::text
            WHEN (r.procurement_channel = 'FIELD_BUYING'::text) THEN 'FIELD_BUYING_RECONCILIATION'::text
            WHEN (s.id IS NULL) THEN 'READY_FOR_SETTLEMENT'::text
            ELSE s.status
        END AS purchase_readiness,
    s.id AS settlement_id,
    s.purchase_code,
    s.status AS settlement_status,
    wr.campaign_id
   FROM ((wms_v_receptions r
     LEFT JOIN procurement_reception_settlements s ON ((s.reception_id = r.id)))
     LEFT JOIN wms_receptions wr ON ((wr.id = r.id)))
  WHERE (COALESCE(r.procurement_channel, ''::text) <> 'FIELD_BUYING'::text);

create or replace view public.procurement_v_purchase_action_queue with (security_invoker = true) as
 SELECT 'READY_FOR_SETTLEMENT'::text AS action_type,
    r.reception_id AS object_id,
    r.reception_id AS reference,
    r.procurement_channel,
    r.supplier_name AS counterparty,
    r.warehouse_code,
    r.net_kg AS qty_kg,
    NULL::numeric AS amount,
    r.arrival_at AS event_at,
    r.campaign_id
   FROM procurement_v_ready_supplier_receptions r
  WHERE (r.purchase_readiness = 'READY_FOR_SETTLEMENT'::text)
UNION ALL
 SELECT COALESCE(p.action_required, 'NONE'::text) AS action_type,
    (p.purchase_id)::text AS object_id,
    p.purchase_code AS reference,
    p.procurement_channel,
    p.supplier_name AS counterparty,
    p.warehouse_code,
    p.paid_weight_kg AS qty_kg,
    COALESCE(p.amount_approved, p.amount_submitted) AS amount,
    p.purchase_at AS event_at,
    p.campaign_id
   FROM procurement_v_supplier_purchase_register p
  WHERE (p.action_required IS NOT NULL);

-- Indicateurs du Control Tower pour une campagne. Mêmes formules que procurement_v_purchase_kpis.
create or replace function public.procurement_purchase_kpis_campagne(p_campaign_id uuid)
returns table(total_commercial_weight_kg numeric, purchase_value_fcfa numeric, weighted_avg_price_per_kg numeric,
              awaiting_approval bigint, awaiting_payment bigint, exceptions bigint,
              supplier_weight_kg numeric, field_weight_kg numeric, supplier_value_fcfa numeric, field_value_fcfa numeric)
language sql stable security invoker set search_path = public as $$
  with supplier as (
    select coalesce(sum(p.paid_weight_kg), 0) as weight_kg,
           coalesce(sum(coalesce(p.amount_approved, p.amount_submitted, 0)), 0) as value_fcfa,
           count(*) filter (where p.approval_status = 'SUBMITTED') as awaiting_approval,
           count(*) filter (where p.approval_status = 'APPROVED' and p.payment_status <> 'PAID') as awaiting_payment,
           count(*) filter (where p.price_exception or p.quality_exception) as exceptions
      from public.procurement_v_supplier_purchase_register p
     where p.campaign_id = p_campaign_id
  ), field as (
    select coalesce(sum(f.field_weight_kg), 0) as weight_kg,
           coalesce(sum(f.field_purchase_value), 0) as value_fcfa,
           count(*) filter (where f.reconciliation_status = 'VARIANCE_REVIEW') as exceptions
      from public.procurement_v_field_purchase_summary f
     where f.campaign_id = p_campaign_id
  )
  select supplier.weight_kg + field.weight_kg,
         supplier.value_fcfa + field.value_fcfa,
         case when supplier.weight_kg + field.weight_kg > 0
              then round((supplier.value_fcfa + field.value_fcfa) / (supplier.weight_kg + field.weight_kg), 2) else 0 end,
         supplier.awaiting_approval, supplier.awaiting_payment, supplier.exceptions + field.exceptions,
         supplier.weight_kg, field.weight_kg, supplier.value_fcfa, field.value_fcfa
    from supplier, field
$$;

revoke execute on function public.procurement_purchase_kpis_campagne(uuid) from public, anon;
grant execute on function public.procurement_purchase_kpis_campagne(uuid) to authenticated;
