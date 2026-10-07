-- Audit campagne 2027 · 1/4 — intégrité du rattachement Livraison coopérative ↔ Réception Warehouse.
--
-- Constat (simulation en transaction annulée, 07/10/2026) : aflp_coop_record_delivery acceptait
-- n'importe quel numéro de réception Warehouse, y compris une réception LBA d'un autre fournisseur.
-- Effet : le LOT de cette réception prenait l'origine « COOPERATIVE » dans aflp_lot_origin_v,
-- et le poids livré de la coopérative pouvait être saisi sans rapport avec le pont-bascule.
-- C'est une falsification possible de la traçabilité (P0).
--
-- Règles ajoutées (aucune donnée existante modifiée — aucune livraison n'existe en production) :
--   1. poids livré > 0 pour une livraison reçue ;
--   2. une réception ne peut être rattachée qu'à UNE livraison coopérative ;
--   3. si la livraison vient d'un arrivage Procurement déjà réceptionné, la réception doit être celle-là ;
--   4. la réception doit provenir de l'arrivage de la livraison OU du Supplier lié à la coopérative ;
--      une réception LBA ou Achat Bord Champ est toujours refusée ;
--   5. le poids livré doit correspondre au poids net de la réception (tolérance 0,5 % ou 1 kg) ;
--      si le poids net est connu et le poids n'est pas saisi, le poids net est repris.
-- Messages en langage métier, sans détail technique.

create or replace function public.aflp_coop_record_delivery(p_delivery uuid, p_delivered_kg numeric, p_bags integer,
  p_reception_id text default null, p_status text default 'RECUE')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d public.aflp_coop_deliveries; c public.aflp_cooperatives; v_rcv text; v_arr_rcv text; r public.wms_receptions;
        v_kg numeric := p_delivered_kg; v_status text := coalesce(nullif(p_status,''),'RECUE'); v_tol numeric;
begin
  select * into d from public.aflp_coop_deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Livraison introuvable'; end if;
  perform private.aflp_require_edit(d.cooperative_id);
  if v_status not in ('PLANIFIEE','EN_ROUTE','RECUE','ANNULEE') then
    raise exception 'Statut de livraison inconnu : %', v_status;
  end if;
  select * into c from public.aflp_cooperatives where id = d.cooperative_id;
  select reception_id into v_arr_rcv from public.rcn_proc_arrivages where id = d.arrival_id;
  v_rcv := coalesce(nullif(btrim(p_reception_id),''), v_arr_rcv);

  if v_rcv is not null then
    select * into r from public.wms_receptions where id = v_rcv;
    if r.id is null then raise exception 'Réception Warehouse % introuvable', v_rcv; end if;
    if exists (select 1 from public.aflp_coop_deliveries x where x.wms_reception_id = v_rcv and x.id <> d.id) then
      raise exception 'La réception % est déjà rattachée à une autre livraison coopérative.', v_rcv;
    end if;
    if v_arr_rcv is not null and v_arr_rcv <> v_rcv then
      raise exception 'Cette livraison a déjà été réceptionnée sous le n° % (arrivage %). Utilisez ce numéro.', v_arr_rcv, d.arrival_id;
    end if;
    if upper(coalesce(r.procurement_channel,'')) in ('LBA','FIELD_BUYING') or r.field_shipment_id is not null or r.lba_code is not null then
      raise exception 'La réception % appartient au canal % : elle ne peut pas être enregistrée comme livraison de la coopérative.', v_rcv, case when r.field_shipment_id is not null or upper(coalesce(r.procurement_channel,'')) = 'FIELD_BUYING' then 'Achat Bord Champ' else 'LBA' end;
    end if;
    if not ( (d.arrival_id is not null and r.procurement_source_id = d.arrival_id)
             or (c.supplier_id is not null and r.supplier_id = c.supplier_id) ) then
      raise exception 'La réception % ne provient ni de l''arrivage de cette livraison ni du fournisseur lié à la coopérative %.', v_rcv, c.code;
    end if;
    if r.net_kg is not null then
      if v_kg is null then v_kg := r.net_kg; end if;
      v_tol := greatest(1, r.net_kg * 0.005);
      if abs(v_kg - r.net_kg) > v_tol then
        raise exception 'Poids livré % kg différent du poids net de la réception % (% kg). Saisissez le poids du pont-bascule.', v_kg, v_rcv, r.net_kg;
      end if;
    end if;
  end if;

  if v_status = 'RECUE' and coalesce(v_kg,0) <= 0 then
    raise exception 'Le poids livré doit être supérieur à 0 kg.';
  end if;
  if coalesce(p_bags,0) < 0 then raise exception 'Le nombre de sacs ne peut pas être négatif.'; end if;

  update public.aflp_coop_deliveries set delivered_kg = v_kg, delivered_bags = p_bags,
    delivered_at = coalesce(delivered_at, now()), wms_reception_id = v_rcv, status = v_status
   where id = p_delivery returning * into d;
  return to_jsonb(d);
end $$;

-- create or replace conserve les droits existants (EXECUTE authenticated, pas anon).

-- Défense en profondeur : une réception Warehouse ne peut être portée que par une seule livraison coopérative.
create unique index if not exists aflp_coop_deliveries_reception_uidx
  on public.aflp_coop_deliveries (wms_reception_id) where wms_reception_id is not null;
