-- =====================================================================
-- FBMS / WMS — P0-02 / P1-10 (complément UI) : vue LOT enrichie
-- Contre-vérification du 25/09/2026.
--
-- Constat : wms_v_lots a été créée avant l'ajout des colonnes de
-- blocage/dérogation sur wms_lots (hold_reason, status_changed_*,
-- derogation_id). L'écran LOT lit wms_v_lots : motif de HOLD et
-- dérogation BM/QA n'y apparaissaient donc jamais (échec silencieux).
--
-- Correctif (non destructif) : mêmes colonnes, dans le même ordre, plus
-- 4 colonnes ajoutées en fin de vue. security_invoker conservé (RLS de
-- wms_lots appliquée à l'appelant). Aucune donnée modifiée.
-- =====================================================================
create or replace view public.wms_v_lots with (security_invoker = true) as
 SELECT l.id,
    l.reception_id,
    l.warehouse_id,
    l.truck,
    l.supplier_name,
    l.supplier_code,
    l.origin,
    l.initial_kg,
    l.initial_bags,
    l.kor_sampling,
    l.kor_final,
    l.moisture_final,
    l.nut_count_final,
    l.status,
    l.created_by,
    l.created_by_name,
    l.created_at,
    w.code AS warehouse_code,
    r.status AS reception_status,
    COALESCE(( SELECT sum(v.qty) AS sum
           FROM wms_v_balances v
          WHERE v.lot_id = l.id AND v.location_type = 'STAGING'::text), 0::numeric) AS staging_kg,
    COALESCE(( SELECT sum(v.qty) AS sum
           FROM wms_v_balances v
          WHERE v.lot_id = l.id AND v.location_type = 'BIN'::text), 0::numeric) AS bin_kg,
    COALESCE(( SELECT sum(v.qty) AS sum
           FROM wms_v_balances v
          WHERE v.lot_id = l.id AND v.location_type = 'DRYING'::text), 0::numeric) AS drying_kg,
    COALESCE(( SELECT sum(v.qty) AS sum
           FROM wms_v_balances v
          WHERE v.lot_id = l.id AND v.location_type = 'TRANSIT'::text), 0::numeric) AS transit_kg,
    COALESCE(( SELECT sum(v.qty) AS sum
           FROM wms_v_balances v
          WHERE v.lot_id = l.id AND (v.location_type = ANY (ARRAY['STAGING'::text, 'BIN'::text, 'DRYING'::text, 'TRANSIT'::text]))), 0::numeric) AS current_kg,
    ( SELECT count(*) AS count
           FROM wms_v_balances v
          WHERE v.lot_id = l.id AND v.location_type = 'BIN'::text AND v.qty > 0.0005) AS bin_count,
    l.hold_reason,
    l.status_changed_at,
    l.status_changed_by,
    l.derogation_id
   FROM wms_lots l
     JOIN wms_warehouses w ON w.id = l.warehouse_id
     LEFT JOIN wms_receptions r ON r.id = l.reception_id;

comment on view public.wms_v_lots is 'LOT Warehouse avec soldes par emplacement, statut qualité (QUARANTINE/HOLD/REQUIRES_DECISION/REJECTED/RELEASED...), motif de blocage et dérogation tracée.';
