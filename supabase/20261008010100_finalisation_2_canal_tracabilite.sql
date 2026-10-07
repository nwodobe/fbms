-- Finalisation campagne 2027 · 2/3 — même canal partout et Traceability 360 complète.
--
-- Constats (audit 07/10/2026) :
--   * une réception Warehouse issue d'une livraison coopérative était enregistrée canal DIRECT (wms_create_reception
--     convertit purchase_type COOPERATIVE en DIRECT) : Procurement, Warehouse, LOT et Reports affichaient des canaux
--     différents pour la même opération ;
--   * LOT coopérative : villages = 0 (seuls les contributeurs Achat Bord Champ étaient comptés) ;
--   * Traceability 360 : transferts WMS, n° de reçu, Purchase ID, Member ID, téléphone, RT, réception, arrivage,
--     BIN et réception usine non recherchables (la recherche lisait l'ancienne table rcn_transferts).
-- Aucune donnée existante n'est modifiée (aucune réception coopérative en production à ce jour).

-- ============================================================ 1. Canal COOPERATIVE conservé à la réception WMS
-- Le type d'achat WMS reste DIRECT (règles documentaires et de pesée inchangées) ; seul le canal Procurement
-- devient COOPERATIVE quand la réception vient d'une livraison coopérative ou du Supplier lié à une coopérative.
-- Les canaux LBA et Achat Bord Champ ne sont jamais touchés.
create or replace function private.wms_reception_canal_cooperative() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if coalesce(new.procurement_channel,'') not in ('DIRECT','COOPERATIVE') then return new; end if;
  if (new.procurement_source_id is not null
        and exists (select 1 from public.aflp_coop_deliveries d where d.arrival_id = new.procurement_source_id))
     or (new.supplier_id is not null
        and exists (select 1 from public.aflp_cooperatives c where c.supplier_id = new.supplier_id)) then
    new.procurement_channel := 'COOPERATIVE';
  end if;
  return new;
end $$;
create or replace trigger trg_zz_wms_reception_canal_cooperative before insert or update of procurement_source_id, supplier_id, procurement_channel
  on public.wms_receptions for each row execute function private.wms_reception_canal_cooperative();

-- ============================================================ 2. Origine des LOT : villages des producteurs attribués
create or replace view public.aflp_lot_origin_v with (security_invoker = true) as
WITH contrib AS (
  SELECT k.wms_lot_id, a.sourcing_channel, a.cooperative_id, k.producer_id, k.village_id, k.field_qty_kg
    FROM wms_lot_procurement_contributors k LEFT JOIN achats a ON a.id = k.achat_id
), dlv AS (
  SELECT l_1.id AS wms_lot_id, ds.cooperative_id, ds.id AS delivery_id, ds.fully_traceable, ds.allocated_producers
    FROM wms_lots l_1 JOIN aflp_coop_delivery_status_v ds ON ds.reception_id_resolved = l_1.reception_id
), dlv_villages AS (
  SELECT dlv.wms_lot_id, p.village_id
    FROM dlv JOIN aflp_coop_delivery_allocations al ON al.delivery_id = dlv.delivery_id
             JOIN producteurs p ON p.id = al.producer_id
)
SELECT l.id AS lot_id, l.reception_id, l.supplier_code, l.supplier_name, l.initial_kg, l.status AS lot_status,
  r.procurement_channel, r.purchase_type,
  CASE
    WHEN (EXISTS (SELECT 1 FROM dlv WHERE dlv.wms_lot_id = l.id)) THEN 'COOPERATIVE'::text
    WHEN ((SELECT count(DISTINCT contrib.sourcing_channel) FROM contrib WHERE contrib.wms_lot_id = l.id)) > 1 THEN 'MIXTE'::text
    WHEN (EXISTS (SELECT 1 FROM contrib WHERE contrib.wms_lot_id = l.id AND contrib.sourcing_channel = 'COOPERATIVE'::text)) THEN 'COOPERATIVE'::text
    WHEN (EXISTS (SELECT 1 FROM contrib WHERE contrib.wms_lot_id = l.id)) THEN 'AFLP_DIRECT'::text
    ELSE COALESCE(r.procurement_channel, r.purchase_type, 'NON_RENSEIGNE'::text)
  END AS origin_channel,
  (SELECT string_agg(DISTINCT c.code, ', '::text) FROM aflp_cooperatives c
    WHERE c.id IN (SELECT contrib.cooperative_id FROM contrib WHERE contrib.wms_lot_id = l.id
                   UNION SELECT dlv.cooperative_id FROM dlv WHERE dlv.wms_lot_id = l.id)) AS cooperative_codes,
  ((SELECT count(DISTINCT contrib.producer_id) FROM contrib WHERE contrib.wms_lot_id = l.id))::numeric
    + COALESCE((SELECT sum(dlv.allocated_producers) FROM dlv WHERE dlv.wms_lot_id = l.id), 0::numeric) AS farmers,
  (SELECT count(DISTINCT x.village_id) FROM (
      SELECT contrib.village_id FROM contrib WHERE contrib.wms_lot_id = l.id
      UNION ALL SELECT dv.village_id FROM dlv_villages dv WHERE dv.wms_lot_id = l.id) x
    WHERE x.village_id IS NOT NULL) AS villages,
  CASE
    WHEN (EXISTS (SELECT 1 FROM dlv WHERE dlv.wms_lot_id = l.id AND NOT dlv.fully_traceable)) THEN 'ALLOCATION_A_COMPLETER'::text
    WHEN (EXISTS (SELECT 1 FROM dlv WHERE dlv.wms_lot_id = l.id)) THEN 'TRACABLE_PRODUCTEUR'::text
    WHEN (EXISTS (SELECT 1 FROM contrib WHERE contrib.wms_lot_id = l.id)) THEN 'TRACABLE_PRODUCTEUR'::text
    ELSE 'ORGANISATION_SEULEMENT'::text
  END AS traceability_level
FROM wms_lots l LEFT JOIN wms_receptions r ON r.id = l.reception_id;

-- ============================================================ 3. Traceability 360 : une seule barre pour tout identifiant
-- Les branches existantes sont conservées à l'identique ; ajout des branches FARMER, RT, COOP_MEMBER, PURCHASE,
-- PROCUREMENT_ARRIVAL, WMS_RECEPTION, WMS_BIN, WMS_TRANSFER. security_invoker : chaque utilisateur ne voit que son
-- périmètre (RLS des tables sources).
create or replace view public.operations_traceability_search_v with (security_invoker = true) as
 SELECT 'FARMER_CHAIN'::text AS entity_type, COALESCE(c.farmer_id, c.producteur_id) AS entity_id,
    concat_ws(' '::text, c.farmer_id, c.producteur_nom, c.producteur_prenoms, c.lot_code, c.shipment_code, c.vehicle_plate, c.factory_lot_id) AS search_text,
    c.achat_date AS event_date, c.achat_poids_net_kg AS qty_kg, c.origin_label, c.destination_label,
    jsonb_build_object('producteur_id', c.producteur_id, 'achat_id', c.achat_id, 'lot_code', c.lot_code, 'shipment_code', c.shipment_code, 'vehicle_plate', c.vehicle_plate, 'reception_id', c.reception_id, 'factory_lot_id', c.factory_lot_id) AS details
   FROM field_traceability_chain_v c
UNION ALL
 SELECT 'RCN_GENEALOGY'::text, (g.parent_id || '>'::text) || g.enfant_id,
    concat_ws(' '::text, g.parent_type, g.parent_id, g.enfant_type, g.enfant_id), NULL::date, g.qty_kg, NULL::text, NULL::text,
    jsonb_build_object('parent_type', g.parent_type, 'parent_id', g.parent_id, 'child_type', g.enfant_type, 'child_id', g.enfant_id, 'share_pct', g.part_pct)
   FROM rcn_v_genealogie g
UNION ALL
 SELECT 'LBA'::text, f.code, concat_ws(' '::text, f.code, f.nom, array_to_string(f.sites, ' '::text)), f.derniere_livraison, f.volume_livre_kg, NULL::text, NULL::text,
    jsonb_build_object('name', f.nom, 'status', f.statut, 'sites', f.sites, 'kor_avg', f.kor_moyen, 'moisture_avg', f.humidite_moyenne)
   FROM rcn_fournisseurs f WHERE f.code ~~ 'LBA-%'::text
UNION ALL
 SELECT 'FUNDING_CYCLE'::text, c.cycle_code, concat_ws(' '::text, c.cycle_code, c.lba_code, c.campaign, c.status), c.opened_at::date, NULL::numeric, NULL::text, NULL::text,
    jsonb_build_object('lba_code', c.lba_code, 'campaign', c.campaign, 'status', c.status, 'opened_at', c.opened_at, 'first_delivery_at', c.first_delivery_at, 'closed_at', c.closed_at)
   FROM lba_funding_cycles c
UNION ALL
 SELECT 'STOCK_TRANSFER'::text, t.id, concat_ws(' '::text, t.id, t.bin_id, t.destination, t.truck_plate, t.transporter, t.driver_name, t.seal_no),
    t.created_at::date, t.poids_envoye, t.origin_warehouse_code, t.destination_warehouse_code,
    jsonb_build_object('bin_id', t.bin_id, 'state', t.etat, 'sent_kg', t.poids_envoye, 'received_kg', t.poids_recu, 'variance_kg', t.ecart_kg, 'truck', t.truck_plate, 'seal', t.seal_no)
   FROM rcn_transferts t
UNION ALL
 SELECT 'COOPERATIVE'::text, k.code, concat_ws(' '::text, k.code, k.name, k.acronym, k.locality, k.sous_prefecture, k.cluster_code, k.registration_no),
    k.aflp_join_date, NULL::numeric, k.locality, NULL::text,
    jsonb_build_object('cooperative_id', k.id, 'name', k.name, 'status', k.aflp_status, 'cluster', k.cluster_code, 'locality', k.locality)
   FROM aflp_cooperatives k WHERE NOT k.archived AND NOT k.is_qa
UNION ALL
 SELECT 'COOP_DELIVERY'::text, d.code, concat_ws(' '::text, d.code, d.cooperative_code, d.cooperative_name, d.arrival_id, d.reception_id_resolved, d.warehouse_code),
    COALESCE(d.delivered_at::date, d.planned_date), COALESCE(d.delivered_kg, d.planned_kg), d.cooperative_name, d.warehouse_code,
    jsonb_build_object('cooperative', d.cooperative_code, 'status', d.status, 'allocation', d.allocation_status, 'allocated_kg', d.allocated_kg, 'arrival', d.arrival_id, 'reception', d.reception_id_resolved)
   FROM aflp_coop_delivery_status_v d
UNION ALL
 SELECT 'WMS_LOT'::text, o.lot_id, concat_ws(' '::text, o.lot_id, o.reception_id, o.supplier_code, o.supplier_name, o.cooperative_codes, o.origin_channel),
    NULL::date, o.initial_kg, o.supplier_name, NULL::text,
    jsonb_build_object('origin_channel', o.origin_channel, 'cooperatives', o.cooperative_codes, 'farmers', o.farmers, 'villages', o.villages, 'traceability', o.traceability_level, 'reception', o.reception_id, 'status', o.lot_status)
   FROM aflp_lot_origin_v o
UNION ALL
 SELECT 'FARMER'::text, COALESCE(p.code, p.id),
    concat_ws(' '::text, p.code, p.nom, p.prenoms, public.farmer_registry_norm_phone(p.telephone), public.farmer_registry_norm_phone(p.telephone_alt), p.village_nom,
              (SELECT string_agg(concat_ws(' ', ms.member_number, kc.code), ' ') FROM aflp_coop_memberships ms JOIN aflp_cooperatives kc ON kc.id = ms.cooperative_id
                WHERE ms.producer_id = p.id AND ms.status <> 'ENDED')),
    p.created_at::date, NULL::numeric, p.village_nom, NULL::text,
    jsonb_build_object('producteur_id', p.id, 'name', concat_ws(' ', p.nom, p.prenoms), 'village', p.village_nom, 'rt_id', p.rt_id, 'review_required', p.review_required)
   FROM producteurs p WHERE NOT p.deleted
UNION ALL
 SELECT 'RT'::text, COALESCE(r.id_rt, r.id), concat_ws(' '::text, r.id_rt, r.id, r.nom, r.village_nom, r.cluster), NULL::date, NULL::numeric, r.village_nom, NULL::text,
    jsonb_build_object('rt_id', r.id, 'name', r.nom, 'village', r.village_nom, 'cluster', r.cluster, 'status', r.statut)
   FROM rt r WHERE NOT r.deleted
UNION ALL
 SELECT 'COOP_MEMBER'::text, concat_ws(' · ', kc.code, ms.member_number),
    concat_ws(' '::text, ms.member_number, kc.code, kc.name, p.code, p.nom, p.prenoms), ms.membership_start, NULL::numeric, kc.name, NULL::text,
    jsonb_build_object('cooperative_id', kc.id, 'cooperative', kc.code, 'member_number', ms.member_number, 'producteur_id', p.id, 'farmer_id', p.code,
                       'status', ms.status, 'followup_rt_id', ms.followup_rt_id, 'section_id', ms.section_id)
   FROM aflp_coop_memberships ms JOIN aflp_cooperatives kc ON kc.id = ms.cooperative_id JOIN producteurs p ON p.id = ms.producer_id
  WHERE ms.member_number IS NOT NULL AND NOT kc.is_qa
UNION ALL
 SELECT 'PURCHASE'::text, COALESCE(NULLIF(btrim(a.numero_recu),''), a.local_id, a.id::text),
    concat_ws(' '::text, a.id::text, a.local_id, a.numero_recu, a.producteur_code, a.producteur_nom, a.rt_id, a.rt_nom, a.village_nom, a.coop_member_number,
              (SELECT kc.code FROM aflp_cooperatives kc WHERE kc.id = a.cooperative_id)),
    a.date, a.poids_net, a.village_nom, NULL::text,
    jsonb_build_object('achat_id', a.id, 'receipt', a.numero_recu, 'local_id', a.local_id, 'producteur_id', a.producteur_id, 'farmer_id', a.producteur_code,
                       'rt', a.rt_nom, 'channel', a.sourcing_channel, 'cooperative_id', a.cooperative_id, 'member_number', a.coop_member_number, 'amount', a.montant)
   FROM achats a
UNION ALL
 SELECT 'PROCUREMENT_ARRIVAL'::text, ar.id,
    concat_ws(' '::text, ar.id, ar.supplier_code, ar.reception_id, ar.payload->>'truck', ar.payload->>'camion', ar.payload->>'driver', ar.payload->>'origin'),
    ar.prevu_at::date, COALESCE(ar.expected_kg, NULLIF(ar.payload->>'expected_kg','')::numeric), ar.payload->>'origin', NULL::text,
    jsonb_build_object('supplier_code', ar.supplier_code, 'status', ar.statut, 'reception', ar.reception_id, 'truck', COALESCE(ar.payload->>'truck', ar.payload->>'camion'),
                       'channel', ar.payload->>'procurement_channel')
   FROM rcn_proc_arrivages ar
UNION ALL
 SELECT 'WMS_RECEPTION'::text, rc.id,
    concat_ws(' '::text, rc.id, rc.truck, rc.supplier_name, rc.supplier_code, rc.reference, rc.delivery_note, rc.weighbridge_ticket, rc.warehouse_receipt,
              rc.procurement_source_id, rc.lba_code, rc.lot_id, rc.driver),
    rc.arrival_at::date, COALESCE(rc.net_kg, rc.expected_kg), rc.origin, (SELECT w.code FROM wms_warehouses w WHERE w.id = rc.warehouse_id),
    jsonb_build_object('status', rc.status, 'channel', rc.procurement_channel, 'truck', rc.truck, 'supplier', rc.supplier_name, 'lot_id', rc.lot_id,
                       'source', rc.procurement_source_type, 'source_id', rc.procurement_source_id, 'net_kg', rc.net_kg, 'decision', rc.decision)
   FROM wms_receptions rc
UNION ALL
 SELECT 'WMS_BIN'::text, b.id, concat_ws(' '::text, b.id, b.stock_type, b.status, (SELECT w.code FROM wms_warehouses w WHERE w.id = b.warehouse_id)),
    b.opened_at::date, NULL::numeric, (SELECT w.code FROM wms_warehouses w WHERE w.id = b.warehouse_id), NULL::text,
    jsonb_build_object('status', b.status, 'stock_type', b.stock_type, 'capacity_kg', b.capacity_kg,
                       'lots', (SELECT string_agg(DISTINCT tl.lot_id, ', ') FROM wms_transfer_lines tl WHERE tl.source_bin_id = b.id))
   FROM wms_bins b
UNION ALL
 SELECT 'WMS_TRANSFER'::text, t.id,
    concat_ws(' '::text, t.id, t.truck_plate, t.seal_no, t.driver_name, t.transporter, t.origin_code, t.dest_code, t.weighbridge_ref, t.rc_ticket, t.load_doc_ref,
              t.request_doc_ref, t.rc_dest_id, (SELECT string_agg(concat_ws(' ', tl.lot_id, tl.source_bin_id), ' ') FROM wms_transfer_lines tl WHERE tl.transfer_id = t.id)),
    COALESCE(t.received_at, t.departed_at, t.requested_at)::date, COALESCE(t.received_qty, t.dispatched_qty, t.planned_qty), t.origin_code, t.dest_code,
    jsonb_build_object('status', t.status, 'truck', t.truck_plate, 'seal', t.seal_no, 'dest_is_factory', t.dest_is_factory, 'received_kg', t.received_qty,
                       'variance_kg', t.variance_kg, 'factory_reception', CASE WHEN t.dest_is_factory THEN COALESCE(t.rc_ticket, t.rc_dest_id) END,
                       'lots', (SELECT string_agg(DISTINCT tl.lot_id, ', ') FROM wms_transfer_lines tl WHERE tl.transfer_id = t.id),
                       'bins', (SELECT string_agg(DISTINCT tl.source_bin_id, ', ') FROM wms_transfer_lines tl WHERE tl.transfer_id = t.id))
   FROM wms_v_transfers t WHERE NOT COALESCE(t.is_test, false);

revoke execute on function private.wms_reception_canal_cooperative() from public, anon, authenticated;
grant select on public.aflp_lot_origin_v, public.operations_traceability_search_v to authenticated;
