-- Simulations S1–S14 du mandat (S15 concurrence : 20_concurrence.sh).
-- Chaque appel métier est exécuté sous le rôle « authenticated » avec le JWT d'un acteur fictif :
-- RLS, privilèges et contrôles serveur réels s'appliquent. Aucune donnée réelle.
-- Un test qui lève une erreur inattendue est enregistré FAIL avec le message exact.
set search_path = public, extensions;
create schema if not exists t;
create table if not exists t.results(id text primary key, titre text, attendu text, obtenu text, statut text, preuve text);
grant usage on schema t to authenticated;

create or replace function t.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); execute 'set role authenticated'; end $$;
create or replace function t.reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); end $$;
-- Exécute une requête sous l'identité p et renvoie son résultat JSON (erreur propagée).
create or replace function t.q(p uuid, s text) returns jsonb language plpgsql as $$
declare v jsonb; begin perform t.as_user(p); execute s into v; perform t.reset(); return v; end $$;
-- Exécute et renvoie le message d'erreur (NULL si succès).
create or replace function t.err(p uuid, s text) returns text language plpgsql as $$
begin perform t.as_user(p); execute s; perform t.reset(); return null;
exception when others then return sqlerrm; end $$;
create or replace function t.up(p uuid, rt text, f text) returns text language plpgsql as $$
declare v_path text := p::text||'/'||rt||'/'||f;
begin perform t.q(p, format('insert into storage.objects(bucket_id,name,owner_id,metadata) values (''rt-sop-evidence'',%L,%L,''{"size":2048}'') returning to_jsonb(id)', v_path, p::text));
 return v_path; end $$;
create or replace function t.rec(i text, ti text, att text, obt text, ok boolean, pr text) returns void language sql as $$
 insert into t.results values (i,ti,att,obt,case when ok then 'PASS' else 'FAIL' end,pr)
 on conflict (id) do update set obtenu=excluded.obtenu, statut=excluded.statut, preuve=excluded.preuve $$;
create or replace function t.fail(i text, ti text, att text, e text) returns void language sql as $$
 insert into t.results values (i,ti,att,'ERREUR : '||e,'FAIL','exception SQL') on conflict (id) do update set obtenu=excluded.obtenu, statut='FAIL' $$;

-- Identités fictives
create or replace function t.u(r text) returns uuid language sql immutable as $$
 select case r when 'BM' then 'a0000000-0000-4000-8000-000000000001' when 'FIN' then 'a0000000-0000-4000-8000-000000000002'
  when 'UHA' then 'a0000000-0000-4000-8000-000000000003' when 'AUH' then 'a0000000-0000-4000-8000-000000000004'
  when 'UHB' then 'a0000000-0000-4000-8000-000000000005' when 'ZH' then 'a0000000-0000-4000-8000-000000000006'
  when 'ABM' then 'a0000000-0000-4000-8000-000000000007' when 'QFS' then 'a0000000-0000-4000-8000-000000000009' end::uuid $$;
create or replace function t.real() returns uuid language sql immutable as $$ select 'c0000000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function t.sim() returns uuid language sql immutable as $$ select 'c0000000-0000-4000-8000-00000000000b'::uuid $$;
grant execute on all functions in schema t to authenticated;

-- Financement Wave complet : BM → Finance → UH (RT signé) → Finance (comptabilisation)
create or replace function t.fund(p_rt text, p_amount numeric, p_camp uuid, p_tag text) returns uuid language plpgsql as $$
declare v_id uuid; v_uh uuid := case when p_rt like 'RT-B%' then t.u('UHB') else t.u('UHA') end; p1 text; p2 text;
begin
 v_id := (t.q(t.u('BM'), format('select rt_sop_request_funding(%L,%L,%s,''Plan achats fictif semaine'',''WAVE-RT-FICTIF'',%L)', p_camp, p_rt, p_amount, gen_random_uuid()))->>'id')::uuid;
 p1 := t.up(t.u('FIN'), p_rt, 'wave-'||p_tag||'.pdf');
 perform t.q(t.u('FIN'), format('select rt_sop_finance_confirm(%L,%L,%L)', v_id, 'WV-'||p_tag, p1));
 p2 := t.up(v_uh, p_rt, 'ack-'||p_tag||'.jpg');
 perform t.q(v_uh, format('select rt_sop_rt_acknowledge(%L,%L)', v_id, p2));
 perform t.q(t.u('FIN'), format('select rt_sop_post_funding(%L)', v_id));
 return v_id;
end $$;
-- Achat terrain saisi par l'UH du cluster (poids × prix = montant, contrainte de production)
create or replace function t.buy(p_rt text, p_kg numeric, p_prix numeric, p_recu text, p_camp uuid, p_local text) returns uuid language plpgsql as $$
declare v_uh uuid := case when p_rt like 'RT-B%' then t.u('UHB') else t.u('UHA') end; v_vil text := (select village_id from rt where id=p_rt);
begin
 return (t.q(v_uh, format($s$insert into achats(local_id,date,cluster,village_id,rt_id,rt_nom,poids_net,prix_kg,montant,numero_recu,recu_photo_url,campaign_id)
   values (%L,current_date,(select cluster from rt where id=%L),%L,%L,'RT FICTIF',%s,%s,%s,%L,%L,%L) returning to_jsonb(id)$s$,
   p_local,p_rt,v_vil,p_rt,p_kg,p_prix,p_kg*p_prix,p_recu,case when p_recu is null then null else 'photo-fictive.jpg' end,p_camp)))#>>'{}';
end $$;
create or replace function t.approve(p_achat uuid, p_tag text) returns jsonb language plpgsql as $$
declare v_rt text := (select rt_id from achats where id=p_achat); v_uh uuid := case when v_rt like 'RT-B%' then t.u('UHB') else t.u('UHA') end; p text;
begin p := t.up(v_uh, v_rt, 'recu-'||p_tag||'.jpg');
 return t.q(v_uh, format('select rt_sop_review_purchase(%L,''APPROVED'',''REC-%s'',''PAY-%s'',%L,null,%L)', p_achat, p_tag, p_tag, p, gen_random_uuid()));
end $$;

-- ===================== S1 · financement Wave =====================
do $$ declare b record; a1 uuid; a2 uuid; begin
 perform t.fund('RT-A1', 300000, t.real(), 's1');
 a1 := t.buy('RT-A1', 500, 400, 'R-0001', t.real(), 'loc-s1-a'); perform t.approve(a1, 's1a');
 a2 := t.buy('RT-A1', 100, 400, 'R-0002', t.real(), 'loc-s1-b');
 select * into b from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 perform t.rec('S1','Financement Wave','reste 100 000 ; attente 40 000 ; attente non déchargée',
   format('reste %s ; achats UH %s ; attente %s', b.reste_a_justifier_fcfa, b.achats_uh_fcfa, to_jsonb(b)->>'achats_en_attente_fcfa'),
   b.reste_a_justifier_fcfa=100000 and b.achats_uh_fcfa=200000 and (to_jsonb(b)->>'achats_en_attente_fcfa')::numeric=40000,
   'rt_sop_cash_balance_v');
exception when others then perform t.fail('S1','Financement Wave','reste 100 000 ; attente 40 000',sqlerrm); end $$;

-- ===================== S2 · restitution =====================
do $$ declare b record; p text; e text; begin
 p := t.up(t.u('FIN'),'RT-A1','restit-s2.pdf');
 perform t.q(t.u('FIN'), format('select rt_sop_refund(%L,''RT-A1'',10000,''WV-RESTIT-S2'',%L,%L)', t.real(), p, gen_random_uuid()));
 -- Contre-épreuve : 300 000 − 200 000 − 40 000 (attente) − 10 000 = 50 000 non engagés ; 60 000 doit être refusé.
 p := t.up(t.u('FIN'),'RT-A1','restit-s2b.pdf');
 e := t.err(t.u('FIN'), format('select rt_sop_refund(%L,''RT-A1'',60000,''WV-RESTIT-S2B'',%L,%L)', t.real(), p, gen_random_uuid()));
 select * into b from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 perform t.rec('S2','Restitution','reste 90 000 ; restitution > fonds non engagés refusée',
   format('reste %s ; restitution 60 000 : %s', b.reste_a_justifier_fcfa, coalesce(e,'ACCEPTÉE')),
   b.reste_a_justifier_fcfa=90000 and e is not null, 'rt_sop_refunds + rt_sop_cash_balance_v');
exception when others then perform t.fail('S2','Restitution','reste 90 000',sqlerrm); end $$;

-- ===================== S3 · retrait d'espèces =====================
do $$ declare b0 record; b1 record; p text; begin
 select * into b0 from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 p := t.up(t.u('UHA'),'RT-A1','retrait-s3.jpg');
 perform t.q(t.u('UHA'), format('select rt_sop_record_cash_event(%L,''RT-A1'',''WITHDRAWAL'',100000,''WV-RETRAIT-S3'',%L,null,%L)', t.real(), p, gen_random_uuid()));
 select * into b1 from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 perform t.rec('S3','Retrait espèces','transfert interne : reste et achats UH inchangés ; espèces +100 000',
   format('reste %s→%s ; achats UH %s→%s ; espèces retirées %s', b0.reste_a_justifier_fcfa, b1.reste_a_justifier_fcfa, b0.achats_uh_fcfa, b1.achats_uh_fcfa, to_jsonb(b1)->>'especes_retirees_nettes_fcfa'),
   b0.reste_a_justifier_fcfa=b1.reste_a_justifier_fcfa and b0.achats_uh_fcfa=b1.achats_uh_fcfa and (to_jsonb(b1)->>'especes_retirees_nettes_fcfa')::numeric=100000,
   'rt_sop_cash_events');
exception when others then perform t.fail('S3','Retrait espèces','transfert interne sans déchargement',sqlerrm); end $$;

-- ===================== S4 · achat sans preuve =====================
do $$ declare a uuid; e text; st text; al int; begin
 a := t.buy('RT-A1', 25, 400, null, t.real(), 'loc-s4');
 e := t.err(t.u('UHA'), format('select rt_sop_review_purchase(%L,''APPROVED'',''X'',''Y'',''inexistant'',null,%L)', a, gen_random_uuid()));
 select etat_sop into st from rt_sop_purchase_state_v where achat_id=a;
 select count(*) into al from rt_sop_alerts_v where objet=a::text and alerte='ACHAT_SANS_PREUVE';
 perform t.rec('S4','Achat sans preuve','en attente + alerte ; validation refusée',
   format('état %s ; alerte %s ; validation : %s', st, al, coalesce(e,'ACCEPTÉE')), st='EN_ATTENTE' and al=1 and e is not null, 'rt_sop_purchase_state_v + rt_sop_alerts_v');
exception when others then perform t.fail('S4','Achat sans preuve','en attente + alerte',sqlerrm); end $$;

-- ===================== S5 · stock RCN et BEV =====================
do $$ declare a uuid; lot uuid; p text; e1 text; e2 text; e3 text; c record; sh jsonb; begin
 perform t.fund('RT-A2', 150000, t.real(), 's5');
 a := t.buy('RT-A2', 300, 400, 'R-0501', t.real(), 'loc-s5');
 perform t.reset();
 insert into field_lots(lot_code,scope_type,scope_id,scope_label,status,sealed_at,campaign_id)
   values ('LOT-S5','VILLAGE','V-A2','VILLAGE A2','SEALED',now(),t.real()) returning id into lot;
 insert into field_lot_contributors(lot_id,achat_id,qty_kg) values (lot,a,300);
 p := t.up(t.u('UHA'),'RT-A2','bev-s5.pdf');
 perform t.q(t.u('UHA'), format($s$select rt_sop_register_signed_bev(%L,'RT-A2','V-A2','VILLAGE A2','WAREHOUSE','d0000000-0000-4000-8000-000000000001','MAGASIN TEST',
   'BEV-S5-0001',200,4,'AB 1234 CI','TRANSPORT FICTIF','CHAUFFEUR FICTIF',%L,now(),%L)$s$, t.real(), p, gen_random_uuid()));
 -- Contre-épreuve D9 : 150 kg de plus alors qu'il ne reste que 100 kg sous garde.
 p := t.up(t.u('UHA'),'RT-A2','bev-s5b.pdf');
 e1 := t.err(t.u('UHA'), format($s$select rt_sop_register_signed_bev(%L,'RT-A2','V-A2','VILLAGE A2','WAREHOUSE','d0000000-0000-4000-8000-000000000001','MAGASIN TEST',
   'BEV-S5-0002',150,3,'AB 1234 CI','TRANSPORT FICTIF','CHAUFFEUR FICTIF',%L,now(),%L)$s$, t.real(), p, gen_random_uuid()));
 -- Expédition par la RPC canonique, avec le code BEV.
 sh := t.q(t.u('UHA'), format($s$select procurement_field_create_shipment(jsonb_build_object('origin_type','VILLAGE','origin_id','V-A2','origin_label','VILLAGE A2',
   'destination_type','WAREHOUSE','destination_id','WH-T1','vehicle_plate','AB 1234 CI','document_ref','BEV-S5-0001','shipment_code','SHP-S5',
   'lots',jsonb_build_array(jsonb_build_object('lot_id',%L,'loaded_qty_kg',200))))$s$, lot));
 -- Contre-épreuve D1 : expédition créée en DRAFT puis passée DISPATCHED sans BEV.
 e2 := t.err(t.u('UHA'), $s$insert into field_shipments(shipment_code,origin_type,origin_id,origin_label,destination_type,destination_label,vehicle_plate,dispatched_qty_kg,status)
   values ('SHP-S5-CONTOURNEMENT','VILLAGE','V-A2','VILLAGE A2','WAREHOUSE','MAGASIN TEST','ZZ 9999 CI',100,'DRAFT')$s$);
 e3 := t.err(t.u('UHA'), $s$update field_shipments set status='DISPATCHED', departed_at=now() where shipment_code='SHP-S5-CONTOURNEMENT'$s$);
 select * into c from rt_sop_rcn_custody_v where rt_id='RT-A2' and campaign_id=t.real();
 perform t.rec('S5','Stock RCN / BEV','RT 100 kg ; transport 200 kg ; BEV excédentaire refusé ; contournement DRAFT→DISPATCHED refusé',
   format('RT %s kg ; transport %s kg ; BEV 150 kg : %s ; DRAFT : %s ; DRAFT→DISPATCHED : %s', c.stock_sous_garde_rt_kg, c.en_transport_kg,
     coalesce(e1,'ACCEPTÉ'), coalesce(e2,'créé'), coalesce(e3,'ACCEPTÉ (contournement)')),
   c.stock_sous_garde_rt_kg=100 and c.en_transport_kg=200 and e1 is not null and e3 is not null, 'rt_sop_rcn_custody_v + trigger trg_050');
exception when others then perform t.fail('S5','Stock RCN / BEV','RT 100 kg ; transport 200 kg',sqlerrm); end $$;

-- ===================== S6 · écart BEV / GRN =====================
do $$ declare s uuid; v1 text; v2 text; d numeric; adj int; inc int; begin
 perform t.reset();
 select id into s from field_shipments where shipment_code='SHP-S5';
 insert into wms_receptions(id,warehouse_id,truck,origin,field_shipment_id,campaign_id) values ('REC-S6','d0000000-0000-4000-8000-000000000001','AB1234CI','VILLAGE A2',s,t.real());
 update wms_receptions set gross_kg=215, tare_kg=20, net_kg=195, offloaded_at=now() where id='REC-S6';
 insert into wms_grns(id,reception_id,warehouse_id,status,content,issued_by,issued_at) values ('GRN-S6','REC-S6','d0000000-0000-4000-8000-000000000001','ANNULE','{}',t.u('BM'),now());
 select audit_status into v1 from rt_sop_bev_grn_v where bev_code='BEV-S5-0001';
 update wms_grns set status='EMIS' where id='GRN-S6';
 select audit_status, delta_bev_vs_received_kg into v2, d from rt_sop_bev_grn_v where bev_code='BEV-S5-0001';
 select count(*) into adj from rt_sop_cash_events where rt_id='RT-A2' and event_type='ADJUSTMENT';
 perform t.rec('S6','Écart BEV/GRN','écart −5 kg à examiner ; GRN annulé non officiel ; aucune imputation automatique',
   format('GRN annulé → %s ; GRN émis → %s, écart %s kg ; ajustements RT %s', v1, v2, d, adj),
   v1<>'GRN_VARIANCE_REVIEW' and v1<>'GRN_MATCHED' and v2='GRN_VARIANCE_REVIEW' and d=-5 and adj=0, 'rt_sop_bev_grn_v');
exception when others then perform t.fail('S6','Écart BEV/GRN','écart −5 kg à examiner',sqlerrm); end $$;

-- ===================== S7 · sacherie =====================
do $$ declare c record; s record; begin
 perform t.reset();
 insert into rcn_jute_locations(code,scope_type,cluster,rt_id,nom) values ('LOC-RT-A1','RT','CLUSTER-A','RT-A1','RT A1'),('LOC-WH','WAREHOUSE','CLUSTER-A',null,'MAG');
 insert into rcn_jute_movements(movement_type,ledger,qty,from_location,to_location,from_state,to_state,campaign_id) values
  ('DOTATION','INTERNE',100,'LOC-WH','LOC-RT-A1','UTILISABLE','UTILISABLE',t.real()),
  ('CLASSEMENT','INTERNE',25,'LOC-RT-A1','LOC-RT-A1','UTILISABLE','PLEIN',t.real()),
  ('TRANSFERT','INTERNE',15,'LOC-RT-A1','LOC-WH','PLEIN','PLEIN',t.real());
 select * into c from rt_sop_jute_card_v where rt_id='RT-A1' and campaign_id=t.real();
 select * into s from sacherie_ct_rt_stock where rt_id='RT-A1';
 perform t.rec('S7','Sacherie','75 vides ; 10 pleins ; 85 sous garde ; cohérent avec sacherie_ct_rt_stock',
   format('reçus %s, utilisés %s, pleins expédiés %s → vides %s, pleins %s, garde %s ; carte existante %s/%s',
     c.sacs_recus, c.sacs_utilises, c.sacs_pleins_expedies, c.sacs_vides_theoriques, c.sacs_pleins_theoriques, c.sacs_sous_garde_theoriques, s.vides, s.pleins),
   c.sacs_vides_theoriques=75 and c.sacs_pleins_theoriques=10 and c.sacs_sous_garde_theoriques=85 and s.vides=75 and s.pleins=10, 'rt_sop_jute_card_v vs sacherie_ct_rt_stock');
exception when others then perform t.fail('S7','Sacherie','75 vides ; 10 pleins ; 85 sous garde',sqlerrm); end $$;

-- ===================== S8 · désaccord RT =====================
do $$ declare p text; r jsonb; st text; inc text; ist text; reste numeric; begin
 select reste_a_justifier_fcfa into reste from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 p := t.up(t.u('UHA'),'RT-A1','bilan-s8.pdf');
 r := t.q(t.u('UHA'), format($s$select rt_sop_weekly_sign(%L,'RT-A1',current_date-6,current_date,
   jsonb_build_object('rcn_kg',590,'reste_a_justifier_fcfa',%s,'sacs_vides',75,'sacs_pleins',10,'pieces','R-0001,R-0002'),
   'DISAGREED','Le RT conteste 10 000 FCFA de restitution',%L,null,%L)$s$, t.real(), reste, p, gen_random_uuid()));
 select statut, incident_id, statut_anomalie into st, inc, ist from rt_sop_weekly_status_v where rt_id='RT-A1' and campaign_id=t.real() and period_start=current_date-6;
 perform t.rec('S8','Désaccord RT','non clôturé conforme ; motif conservé ; anomalie ouverte',
   format('statut %s ; anomalie %s (%s)', st, coalesce(inc,'aucune'), coalesce(ist,'—')),
   st='DESACCORD_NON_CLOTURE' and inc is not null and ist='OUVERT', 'rt_sop_weekly_status_v + aflp_incidents');
exception when others then perform t.fail('S8','Désaccord RT','anomalie ouverte',sqlerrm); end $$;

-- ===================== S9 · correction après signature =====================
do $$ declare p text; first uuid; e_upd text; e_bad text; n int; old_kept int; reste numeric; begin
 select reste_a_justifier_fcfa into reste from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 select id into first from rt_sop_weekly_signoffs where rt_id='RT-A1' and period_start=current_date-6;
 e_upd := t.err(t.u('UHA'), format('update rt_sop_weekly_signoffs set rt_decision=''AGREED'' where id=%L', first));
 p := t.up(t.u('UHA'),'RT-A1','bilan-s9.pdf');
 e_bad := t.err(t.u('UHA'), format($s$select rt_sop_weekly_sign(%L,'RT-A1',current_date-6,current_date,
   jsonb_build_object('rcn_kg',590,'reste_a_justifier_fcfa',%s,'sacs_vides',75,'sacs_pleins',10,'pieces','R-0001'),'AGREED',null,%L,null,%L)$s$, t.real(), reste, p, gen_random_uuid()));
 perform t.q(t.u('UHA'), format($s$select rt_sop_weekly_sign(%L,'RT-A1',current_date-6,current_date,
   jsonb_build_object('rcn_kg',590,'reste_a_justifier_fcfa',%s,'sacs_vides',75,'sacs_pleins',10,'pieces','R-0001,R-0002,RESTIT'),'AGREED',null,%L,%L,%L)$s$, t.real(), reste, p, first, gen_random_uuid()));
 select count(*) into n from rt_sop_weekly_signoffs where rt_id='RT-A1' and period_start=current_date-6;
 select count(*) into old_kept from rt_sop_weekly_signoffs where id=first and rt_decision='DISAGREED';
 perform t.rec('S9','Correction après signature','version initiale conservée ; correction = nouvelle version signée ; modification directe refusée',
   format('UPDATE direct : %s ; nouvelle version sans lien : %s ; versions %s ; originale intacte %s', coalesce(e_upd,'ACCEPTÉ'), coalesce(e_bad,'ACCEPTÉE'), n, old_kept),
   e_upd is not null and e_bad is not null and n=2 and old_kept=1, 'rt_sop_weekly_signoffs (supersedes_id)');
exception when others then perform t.fail('S9','Correction après signature','ancienne version conservée',sqlerrm); end $$;

-- ===================== S10 · permissions =====================
do $$ declare a uuid; p text; e_auh text; e_auh_dir text; e_uhb text; e_bm text; e_zh text; st text; inc text; begin
 select achat_id into a from rt_sop_purchase_state_v where rt_id='RT-A1' and etat_sop='EN_ATTENTE' and not preuve_incomplete limit 1;
 -- L'AUH ne peut même pas déposer de preuve (RLS storage) : on tente la RPC avec un chemin quelconque.
 p := t.u('AUH')::text||'/RT-A1/recu-auh.jpg';
 e_auh := t.err(t.u('AUH'), format('select rt_sop_review_purchase(%L,''APPROVED'',''R'',''P'',%L,null,%L)', a, p, gen_random_uuid()));
 e_auh_dir := t.err(t.u('AUH'), format('update achats set statut_validation=''Validé'' where id=%L', a));
 e_uhb := t.err(t.u('UHB'), format('select rt_sop_review_purchase(%L,''REJECTED'',null,null,null,''Hors cluster test'',%L)', a, gen_random_uuid()));
 e_bm := t.err(t.u('BM'), format('select rt_sop_finance_confirm(%L,''WV-BM'',''x'')', (select id from rt_sop_funding_requests limit 1)));
 select incident_id into inc from rt_sop_weekly_signoffs where incident_id is not null limit 1;
 e_zh := t.err(t.u('ZH'), format('select rt_sop_close_incident(%L,''Classé'',''Clôture par ZH'',''x'')', inc));
 select etat_sop into st from rt_sop_purchase_state_v where achat_id=a;
 perform t.rec('S10','Permissions serveur','AUH ne valide pas ; UH autre cluster refusé ; BM ≠ Finance ; ZH ne clôt pas',
   format('AUH RPC : %s | AUH direct : %s | UH-B : %s | BM Finance : %s | ZH clôture : %s | état achat %s',
     coalesce(left(e_auh,60),'ACCEPTÉ'), coalesce(left(e_auh_dir,60),'0 ligne/accepté'), coalesce(left(e_uhb,40),'ACCEPTÉ'), coalesce(left(e_bm,40),'ACCEPTÉ'), coalesce(left(e_zh,40),'ACCEPTÉ'), st),
   e_auh is not null and e_uhb is not null and e_bm is not null and e_zh is not null and st='EN_ATTENTE', 'rt_sop_require_role + RLS + aflp_auh_garde_achat');
exception when others then perform t.fail('S10','Permissions serveur','refus côté serveur',sqlerrm); end $$;

-- ===================== S11 · double synchronisation =====================
do $$ declare k uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; n int; e text; na int; begin
 r1 := t.q(t.u('BM'), format('select rt_sop_request_funding(%L,''RT-B1'',100000,''Plan achats fictif B1'',''WAVE-B1'',%L)', t.sim(), k));
 r2 := t.q(t.u('BM'), format('select rt_sop_request_funding(%L,''RT-B1'',100000,''Plan achats fictif B1'',''WAVE-B1'',%L)', t.sim(), k));
 select count(*) into n from rt_sop_funding_requests where idempotency_key=k;
 e := t.err(t.u('UHA'), format($s$insert into achats(local_id,date,rt_id,rt_nom,poids_net,prix_kg,montant,campaign_id) values ('loc-s1-a',current_date,'RT-A1','x',1,1,1,%L)$s$, t.real()));
 select count(*) into na from achats where local_id='loc-s1-a';
 perform t.rec('S11','Double synchronisation','une seule transaction métier',
   format('demande rejouée : replay=%s, lignes %s ; achat local_id dupliqué : %s, lignes %s', r2->>'replay', n, coalesce(left(e,50),'ACCEPTÉ'), na),
   (r2->>'replay')::boolean and n=1 and e is not null and na=1, 'idempotency_key unique + achats_local_id_key');
exception when others then perform t.fail('S11','Double synchronisation','une seule transaction',sqlerrm); end $$;

-- ===================== S12 · téléphone partagé (attribution serveur) =====================
do $$ declare e text; begin
 e := t.err(t.u('UHB'), format($s$insert into achats(local_id,date,rt_id,rt_nom,poids_net,prix_kg,montant,campaign_id,created_by)
   values ('loc-s12',current_date,'RT-A1','x',1,1,1,%L,%L)$s$, t.real(), t.u('UHA')));
 perform t.rec('S12','Téléphone partagé (serveur)','une opération de A envoyée par B est refusée',
   format('insert created_by=A sous session B : %s', coalesce(left(e,70),'ACCEPTÉ')), e ilike '%row-level security%', 'RLS achats_ins (created_by = auth.uid())');
exception when others then perform t.fail('S12','Téléphone partagé','refus',sqlerrm); end $$;

-- ===================== S13 · séparation des campagnes =====================
do $$ declare b0 numeric; b1 numeric; s numeric; begin
 select reste_a_justifier_fcfa into b0 from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 perform t.fund('RT-A1', 50000, t.sim(), 's13');
 select reste_a_justifier_fcfa into b1 from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.real();
 select reste_a_justifier_fcfa into s from rt_sop_cash_balance_v where rt_id='RT-A1' and campaign_id=t.sim();
 perform t.rec('S13','Campagnes séparées','aucune contamination de la campagne réelle',
   format('réelle %s→%s ; simulation %s', b0, b1, s), b0=b1 and s=50000, 'campaign_id dans chaque registre');
exception when others then perform t.fail('S13','Campagnes séparées','pas de contamination',sqlerrm); end $$;

-- ===================== S14 · absence de preuve Wave =====================
do $$ declare v uuid; c numeric; e_post text; e_legacy text; e_upd text; begin
 v := (t.q(t.u('BM'), format('select rt_sop_request_funding(%L,''RT-A2'',75000,''Plan sans preuve'',''WAVE-A2'',%L)', t.real(), gen_random_uuid()))->>'id')::uuid;
 e_post := t.err(t.u('FIN'), format('select rt_sop_post_funding(%L)', v));
 e_legacy := t.err(t.u('BM'), format($s$insert into avances(rt_id,rt_nom,cluster,montant,source,campaign_id) values ('RT-A2','x','CLUSTER-A',75000,'Saisie directe',%L)$s$, t.real()));
 e_upd := t.err(t.u('ABM'), $s$update avances set montant=montant*10 where rt_id='RT-A1' and sop_funding_request_id is not null$s$);
 select avances_confirmees_fcfa into c from rt_sop_cash_balance_v where rt_id='RT-A2' and campaign_id=t.real();
 perform t.rec('S14','Avance sans preuve Wave','non comptée comme reçue ; saisie directe refusée ; avance SOP non modifiable',
   format('confirmées A2 %s (150 000 attendu) ; comptabilisation : %s ; saisie directe : %s ; modif avance SOP par ABM : %s',
     c, coalesce(left(e_post,40),'ACCEPTÉE'), coalesce(left(e_legacy,40),'ACCEPTÉE'), coalesce(left(e_upd,50),'ACCEPTÉE')),
   c=150000 and e_post is not null and e_legacy is not null and e_upd is not null, 'rt_sop_post_funding + trg_050 + trg_051');
exception when others then perform t.fail('S14','Avance sans preuve Wave','non comptée',sqlerrm); end $$;

-- ===================== Complément · séparation des tâches et suspension ciblée =====================
do $$ declare v uuid; p text; e_sod text; inc jsonb; e_susp text; e_close text; ok_after text; begin
 v := (t.q(t.u('BM'), format('select rt_sop_request_funding(%L,''RT-A2'',10000,''Plan SoD fictif'',''WAVE-A2'',%L)', t.real(), gen_random_uuid()))->>'id')::uuid;
 p := t.up(t.u('FIN'),'RT-A2','wave-sod.pdf');
 perform t.q(t.u('FIN'), format('select rt_sop_finance_confirm(%L,''WV-SOD'',%L)', v, p));
 p := t.up(t.u('BM'),'RT-A2','ack-bm.jpg');
 e_sod := t.err(t.u('BM'), format('select rt_sop_rt_acknowledge(%L,%L)', v, p));
 p := t.up(t.u('ZH'),'RT-A2','inc-zh.jpg');
 inc := t.q(t.u('ZH'), format($s$select rt_sop_open_incident(%L,'RT-A2','STOCK_RCN','ELEVEE','Écart de 40 kg au comptage physique ZH',
   'Chef de Zone','Suspension des BEV',%L,array['BEV'],%L)$s$, t.real(), p, gen_random_uuid()));
 p := t.up(t.u('UHA'),'RT-A2','bev-susp.pdf');
 e_susp := t.err(t.u('UHA'), format($s$select rt_sop_register_signed_bev(%L,'RT-A2','V-A2','VILLAGE A2','FACTORY',null,'USINE','BEV-SUSP-01',10,1,'AB 1234 CI','TRANSPORT FICTIF','CHAUFFEUR FICTIF',%L,now(),%L)$s$, t.real(), p, gen_random_uuid()));
 p := t.up(t.u('BM'),'RT-A2','decision.pdf');
 e_close := t.err(t.u('BM'), format('select rt_sop_close_incident(%L,''Recomptage conforme'',''Écart expliqué par sacs mal comptés'',%L)', inc->>'incident_id', p));
 p := t.up(t.u('UHA'),'RT-A2','bev-apres.pdf');
 ok_after := t.err(t.u('UHA'), format($s$select rt_sop_register_signed_bev(%L,'RT-A2','V-A2','VILLAGE A2','FACTORY',null,'USINE','BEV-APRES-01',10,1,'AB 1234 CI','TRANSPORT FICTIF','CHAUFFEUR FICTIF',%L,now(),%L)$s$, t.real(), p, gen_random_uuid()));
 perform t.rec('S16','Séparation des tâches / suspension ciblée','BM demandeur ne peut attester ; BEV suspendu puis rétabli après décision BM',
   format('BM atteste : %s | BEV suspendu : %s | clôture BM : %s | BEV après : %s', coalesce(left(e_sod,45),'ACCEPTÉ'), coalesce(left(e_susp,45),'ACCEPTÉ'), coalesce(e_close,'OK'), coalesce(ok_after,'OK')),
   e_sod is not null and e_susp is not null and e_close is null and ok_after is null, 'rt_sop_suspensions + rt_sop_rt_acknowledge');
exception when others then perform t.fail('S16','Séparation des tâches / suspension','refus puis rétablissement',sqlerrm); end $$;

-- ===================== Complément · tableau BM =====================
do $$ declare d record; n_nv int; begin
 select * into d from rt_sop_rt_dashboard_v where rt_id='RT-A1' and campaign_id=t.real();
 select count(*) into n_nv from rt_sop_rt_dashboard_v where rt_id='RT-B1' and campaign_id=t.real() and reste_a_justifier_fcfa is null and source_financiere='NON_VERIFIE';
 perform t.rec('S17','Tableau BM par RT','chiffres = registres ; RT sans donnée « non vérifié » (pas 0)',
   format('A1 reste %s, attente %s, sacs %s/%s, bilan %s, anomalies %s ; B1 non vérifié %s', d.reste_a_justifier_fcfa, d.achats_en_attente_fcfa,
     d.sacs_vides_theoriques, d.sacs_pleins_theoriques, d.statut_dernier_bilan, d.anomalies_ouvertes, n_nv),
   d.reste_a_justifier_fcfa=90000 and d.sacs_vides_theoriques=75 and d.anomalies_ouvertes>=1 and n_nv=1, 'rt_sop_rt_dashboard_v');
exception when others then perform t.fail('S17','Tableau BM par RT','indicateurs fiables',sqlerrm); end $$;

select id, statut, titre, obtenu from t.results order by length(id), id;
