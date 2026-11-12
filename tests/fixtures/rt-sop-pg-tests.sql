\set ON_ERROR_STOP on
-- Isolated PostgreSQL service; all people, RT codes and sums are fictitious.
grant usage on schema public,auth,storage,private,extensions to authenticated;
grant select on public.rt,public.profils,public.campaigns,public.achats,public.avances, public.field_shipments,public.wms_receptions,public.wms_grns to authenticated;
grant insert on public.achats,public.avances,public.field_shipments to authenticated;
grant update on public.field_shipments to authenticated;

insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('rt-sop-evidence','22222222-2222-4222-8222-222222222222/RT-FICTIF-01/finance.pdf','22222222-2222-4222-8222-222222222222','{"size":900}'),
 ('rt-sop-evidence','33333333-3333-4333-8333-333333333333/RT-FICTIF-01/rt-ack.png','33333333-3333-4333-8333-333333333333','{"size":800}'),
 ('rt-sop-evidence','33333333-3333-4333-8333-333333333333/RT-FICTIF-01/achat.png','33333333-3333-4333-8333-333333333333','{"size":800}'),
 ('rt-sop-evidence','22222222-2222-4222-8222-222222222222/RT-FICTIF-01/refund.pdf','22222222-2222-4222-8222-222222222222','{"size":600}'),
 ('rt-sop-evidence','33333333-3333-4333-8333-333333333333/RT-FICTIF-01/week.png','33333333-3333-4333-8333-333333333333','{"size":900}'),
 ('rt-sop-evidence','33333333-3333-4333-8333-333333333333/RT-FICTIF-01/bev.png','33333333-3333-4333-8333-333333333333','{"size":900}');

-- BM may request, but must not be allowed to confirm a Finance transfer.
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.rt_sop_request_funding('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','RT-FICTIF-01',
 300000,'Achat prévisionnel fictif', 'WAVE-DEDICATED-TEST','10000000-0000-4000-8000-000000000001');
do $$
begin
 if (select count(*) from public.avances)>0 then
   raise exception 'Test FAIL: une demande non confirmee est creditee';
 end if;
 begin
  perform public.rt_sop_finance_confirm(
    (select id from public.rt_sop_funding_requests limit 1),'WAVE-PAY-001',
    '22222222-2222-4222-8222-222222222222/RT-FICTIF-01/finance.pdf');
  raise exception 'Test FAIL: BM has Finance privilege';
 exception when insufficient_privilege then null;
 end;
end $$;

set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.rt_sop_finance_confirm(
 (select id from public.rt_sop_funding_requests limit 1),'WAVE-PAY-001',
 '22222222-2222-4222-8222-222222222222/RT-FICTIF-01/finance.pdf');

set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.rt_sop_rt_acknowledge(
 (select id from public.rt_sop_funding_requests limit 1),
 '33333333-3333-4333-8333-333333333333/RT-FICTIF-01/rt-ack.png');

set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.rt_sop_post_funding((select id from public.rt_sop_funding_requests limit 1));
select public.rt_sop_post_funding((select id from public.rt_sop_funding_requests limit 1));
do $$ begin
 if (select count(*) from public.avances)<>1 then
   raise exception 'Test FAIL: double credit'; end if;
end $$;

-- The real 2027 credit guard refuses legacy unconfirmed advances.
do $$
begin
 begin
  insert into public.avances(date,rt_id,rt_nom,source,montant,statut,campaign_id)
   values(current_date,'RT-FICTIF-01','RT FICTIF','Finance',20000,'Active',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  raise exception 'Test FAIL: legacy credit bypass allowed';
 exception when check_violation then null;
 when raise_exception then
   if sqlerrm not like '%AFLP 2027:%' then raise; end if;
 end;
end $$;

-- Existing 2027 SIMULATION is not governed by real campaign controls.
insert into public.avances(date,rt_id,rt_nom,source,montant,statut,campaign_id)
values(current_date,'RT-FICTIF-01','RT FICTIF','Finance',5000,'Active',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Field purchases (including pending) reserve confirmed cash; never exceed 300000.
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into public.achats(id,campaign_id,rt_id,numero_recu,montant,rejet,statut_validation)
 values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'RT-FICTIF-01','REC-FIC-001',200000,false,'À valider');
insert into public.achats(id,campaign_id,rt_id,numero_recu,montant,rejet,statut_validation)
 values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'RT-FICTIF-01','REC-FIC-002',40000,false,'À valider');

do $$
begin
 begin
   insert into public.achats(id,campaign_id,rt_id,numero_recu,montant,rejet,statut_validation)
    values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'RT-FICTIF-01','REC-FIC-003',70000,false,'À valider');
   raise exception 'Test FAIL: 310000 spent against 300000 confirmed';
 exception when raise_exception then
   if sqlerrm not like '%achats et restitutions%' then raise; end if;
 end;
end $$;

select public.rt_sop_review_purchase('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
 'APPROVED','REC-FIC-001','PAY-001','33333333-3333-4333-8333-333333333333/RT-FICTIF-01/achat.png',
 null,'10000000-0000-4000-8000-000000000002');

do $$ declare v numeric;begin
 select reste_a_justifier_fcfa into v from public.rt_sop_cash_balance_v
 where rt_id='RT-FICTIF-01' and campaign_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if v<>100000 then raise exception 'Test FAIL: expected 100000, got %',v; end if;
end $$;

set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.rt_sop_refund('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','RT-FICTIF-01',10000,
 'RETURN-TEST-001','22222222-2222-4222-8222-222222222222/RT-FICTIF-01/refund.pdf',
 '10000000-0000-4000-8000-000000000003');

do $$ declare v numeric;begin
 select reste_a_justifier_fcfa into v from public.rt_sop_cash_balance_v
 where rt_id='RT-FICTIF-01' and campaign_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if v<>90000 then raise exception 'Test FAIL: expected 90000, got %',v; end if;
end $$;

set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.rt_sop_weekly_sign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','RT-FICTIF-01',
 current_date-6,current_date,
 '{"rcn_kg":100,"reste_a_justifier_fcfa":90000,"sacs_vides":75,"sacs_pleins":10,"pieces":"BEV-TEST-001 / REC-FIC-001"}',
 'RESERVED','Écart de sacs à contrôler',
 '33333333-3333-4333-8333-333333333333/RT-FICTIF-01/week.png',null,
 '10000000-0000-4000-8000-000000000004');
do $$ begin
 if (select count(*) from public.rt_sop_weekly_signoffs where rt_decision='RESERVED')<>1
   then raise exception 'Test FAIL: RT reservation absent'; end if;
end $$;

select public.rt_sop_register_signed_bev('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'RT-FICTIF-01','V-FICTIF','VILLAGE FICTIF','FACTORY',null,'Usine test',
 'BEV-TEST-001',200,3,'AB-1234','TRANSPORTEUR TEST','CHAUFFEUR TEST',
 '33333333-3333-4333-8333-333333333333/RT-FICTIF-01/bev.png',
 now(),'10000000-0000-4000-8000-000000000005');

do $$
begin
 begin
  insert into public.field_shipments(campaign_id,origin_type,origin_id,origin_label,
   destination_type,destination_label,vehicle_plate,driver_name,dispatched_qty_kg,status,document_ref)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','VILLAGE','V-FICTIF','VILLAGE FICTIF',
    'FACTORY','Usine test','AB-1234','CHAUFFEUR TEST',200,'DISPATCHED',null);
  raise exception 'Test FAIL: dispatch without BEV';
 exception when check_violation then null;
 end;
end $$;

insert into public.field_shipments(id,campaign_id,origin_type,origin_id,origin_label,
 destination_type,destination_label,vehicle_plate,driver_name,dispatched_qty_kg,status,document_ref,shipment_code)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','VILLAGE','V-FICTIF','VILLAGE FICTIF',
 'FACTORY','Usine test','AB-1234','CHAUFFEUR TEST',200,'DISPATCHED','BEV-TEST-001','SHP-FIC-001');

do $$
begin
 if (select count(*) from public.field_shipments where sop_bev_id is not null)<>1
   then raise exception 'Test FAIL: BEV not linked to shipment'; end if;
 begin
   update public.field_shipments set status='RECEIVED'
    where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
   raise exception 'Test FAIL: received shipment without GRN';
 exception when raise_exception then
   if sqlerrm not like '%GRN officiel manquant%' then raise; end if;
 end;
end $$;

reset role;
insert into public.wms_receptions(id,field_shipment_id,net_kg,weighbridge_ticket,created_at)
 values('R-FIC-001','cccccccc-cccc-4ccc-8ccc-cccccccccccc',195,'PESAGE-FICTIF-001',now());
insert into public.wms_grns(id,reception_id,status,issued_by,issued_at)
 values('GRN-FIC-001','R-FIC-001','ISSUED','33333333-3333-4333-8333-333333333333',now());
set role authenticated;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
update public.field_shipments set status='RECEIVED' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ declare v text; d numeric; begin
 select audit_status,delta_bev_vs_received_kg into v,d from public.rt_sop_bev_grn_v
 where bev_code='BEV-TEST-001';
 if v<>'GRN_VARIANCE_REVIEW' or d<>-5 then
    raise exception 'Test FAIL: expected GRN_VARIANCE_REVIEW -5kg; got % %',v,d; end if;
end $$;
reset role;
select 'PASS: Wave / purchases / signed weekly / BEV / GRN / permissions' as status;
