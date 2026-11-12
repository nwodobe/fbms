-- Sondes ciblées D1 (contournement BEV) et D2 (GRN annulé) : à exécuter sur la PR #311 seule.
-- Résultat attendu AVANT correction : contournement accepté, GRN ANNULE traité comme officiel.
set search_path = public, extensions;
do $$ declare e text; st text; lot uuid; p text; s uuid; begin
 perform t.fund('RT-B1', 400000, t.real(), 'sonde');
 perform t.buy('RT-B1', 250, 400, 'R-SONDE', t.real(), 'loc-sonde');
 e := t.err(t.u('UHB'), $s$insert into field_shipments(shipment_code,origin_type,origin_id,origin_label,destination_type,destination_label,vehicle_plate,dispatched_qty_kg,status,campaign_id)
   values ('SHP-SONDE-D1','VILLAGE','V-B1','VILLAGE B1','FACTORY','USINE','ZZ 9999 CI',100,'DRAFT','c0000000-0000-4000-8000-00000000000a')$s$);
 e := coalesce(e, t.err(t.u('UHB'), $s$update field_shipments set status='DISPATCHED', departed_at=now() where shipment_code='SHP-SONDE-D1'$s$));
 select status into st from field_shipments where shipment_code='SHP-SONDE-D1';
 raise notice 'D1 · expédition village sans BEV, statut final = % ; erreur = %', st, coalesce(e,'aucune');
 -- D2 : BEV + expédition + réception 100 kg + GRN ANNULE
 p := t.up(t.u('UHB'),'RT-B1','bev-sonde.pdf');
 perform t.q(t.u('UHB'), format($s$select rt_sop_register_signed_bev(%L,'RT-B1','V-B1','VILLAGE B1','FACTORY',null,'USINE','BEV-SONDE-D2',100,2,'CD 5678 CI','TRANSPORT FICTIF','CHAUFFEUR FICTIF',%L,now(),%L)$s$, t.real(), p, gen_random_uuid()));
 perform t.q(t.u('UHB'), $s$insert into field_shipments(shipment_code,origin_type,origin_id,origin_label,destination_type,destination_label,vehicle_plate,dispatched_qty_kg,status,departed_at,document_ref,campaign_id)
   values ('SHP-SONDE-D2','VILLAGE','V-B1','VILLAGE B1','FACTORY','USINE','CD 5678 CI',100,'DISPATCHED',now(),'BEV-SONDE-D2','c0000000-0000-4000-8000-00000000000a') returning to_jsonb(id)$s$);
 perform t.reset();
 select id into s from field_shipments where shipment_code='SHP-SONDE-D2';
 insert into wms_receptions(id,warehouse_id,truck,origin,field_shipment_id,campaign_id,gross_kg,tare_kg,net_kg) values ('REC-SONDE','d0000000-0000-4000-8000-000000000001','CD5678CI','V-B1',s,t.real(),120,20,100);
 insert into wms_grns(id,reception_id,warehouse_id,status,content,issued_by) values ('GRN-SONDE','REC-SONDE','d0000000-0000-4000-8000-000000000001','ANNULE','{}',t.u('BM'));
 select audit_status into st from rt_sop_bev_grn_v where bev_code='BEV-SONDE-D2';
 raise notice 'D2 · GRN au statut ANNULE, audit_status = %', st;
 e := null;
 begin update field_shipments set status='RECEIVED', arrived_at=now(), reception_id='REC-SONDE' where id=s; exception when others then e:=sqlerrm; end;
 raise notice 'D2 · clôture RECEIVED avec GRN annulé : %', coalesce(e,'ACCEPTÉE');
end $$;
-- D14 : modification par le BM d'un achat déjà validé par l'UH.
do $$ declare a uuid; e text; r0 numeric; r1 numeric; begin
 select achat_id into a from rt_sop_purchase_reviews where decision='APPROVED' limit 1;
 select reste_a_justifier_fcfa into r0 from rt_sop_cash_balance_v v join achats x on x.rt_id=v.rt_id and x.campaign_id=v.campaign_id where x.id=a;
 e := t.err(t.u('BM'), format('update achats set montant=montant/2, poids_net=poids_net/2 where id=%L', a));
 select reste_a_justifier_fcfa into r1 from rt_sop_cash_balance_v v join achats x on x.rt_id=v.rt_id and x.campaign_id=v.campaign_id where x.id=a;
 raise notice 'D14 · achat validé modifié par le BM : % ; reste à justifier % → %', coalesce(e,'ACCEPTÉ'), r0, r1;
end $$;
