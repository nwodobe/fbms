-- Audit campagne 2027 · 4/4 — l'expédition terrain passe « reçue » quand le Warehouse la décharge.
--
-- Constat (simulation de bout en bout en transaction annulée) : après réception WMS, déchargement,
-- création du LOT et libération, l'expédition restait DISPATCHED, le lot terrain IN_TRANSIT et le
-- mouvement de stock terrain DISPATCHED. Field Buying montrait donc du stock « en transit » pour
-- toujours : stock terrain impossible à réconcilier.
-- Correctif : dès que la réception WMS liée à l'expédition reçoit son poids net (déchargement), on
-- clôt la partie terrain : mouvements RECEIVED (poids reçu réparti au prorata du chargé, écart motivé),
-- poids reçu et heure d'arrivée sur l'expédition, lots terrain RECEIVED. Aucune donnée existante n'est
-- modifiée (aucune réception WMS liée à une expédition terrain n'existe à ce jour).

create or replace function private.field_shipment_on_wms_offload()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_sent numeric;
begin
  if new.field_shipment_id is null or new.net_kg is null or old.net_kg is not null then
    return new;
  end if;
  select coalesce(sum(qty_sent_kg),0) into v_sent
    from public.field_stock_movements where shipment_id = new.field_shipment_id and status = 'DISPATCHED';
  if v_sent > 0 then
    update public.field_stock_movements m
       set qty_received_kg = round(m.qty_sent_kg * new.net_kg / v_sent, 3),
           status = 'RECEIVED',
           received_at = coalesce(new.offloaded_at, now()),
           variance_reason = case when abs(new.net_kg - v_sent) > 0.01
                                  then coalesce(m.variance_reason, 'Écart pont-bascule réception Warehouse ' || new.id)
                                  else m.variance_reason end
     where m.shipment_id = new.field_shipment_id and m.status = 'DISPATCHED';
  end if;
  -- Le statut de l'expédition reste DISPATCHED : la contrainte historique field_shipments_check1 réserve
  -- RECEIVED aux réceptions de l'ancien module (rcn_receptions). On renseigne le poids reçu et l'heure
  -- d'arrivée ; l'écran Évacuations affiche « Reçue Warehouse » dès que wms_reception_id + poids reçu existent.
  update public.field_shipments
     set received_qty_kg = new.net_kg, arrived_at = coalesce(arrived_at, new.arrival_at, now())
   where id = new.field_shipment_id and status in ('DISPATCHED','LOADING');
  update public.field_lots l set status = 'RECEIVED'
   where l.status = 'IN_TRANSIT'
     and l.id in (select sl.lot_id from public.field_shipment_lots sl where sl.shipment_id = new.field_shipment_id);
  return new;
end $$;

create or replace trigger trg_field_shipment_on_wms_offload
  after update of net_kg on public.wms_receptions
  for each row execute function private.field_shipment_on_wms_offload();
