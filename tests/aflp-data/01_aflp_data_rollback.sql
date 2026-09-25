-- =====================================================================
-- FBMS · AFLP DATA · 26/09/2026 · TEST NON DESTRUCTIF
-- Jeu de données fictif (transaction annulée) : 2 villages, 1 RT, 2 producteurs,
-- 1 avance, 2 achats, 1 réconciliation, sacherie (cluster, RT, producteur),
-- 1 lot terrain, 1 évacuation vers WH-BROBO, réception WMS, incidents.
-- Scénarios :
--   T1  export vide (périmètre sans donnée : en-têtes seules)
--   T2  export avec données fictives (16 sources)
--   T3  contrôle cash RT          T4  contrôle sacs jute
--   T5  contrôle stock terrain    T6  contrôle évacuation (chargé / reçu)
--   T7  performance RT            T8  performance village / cluster
--   T9  incidents (déclaration, clôture, droits)
--   T10 traçabilité producteur → village → RT → achat → évacuation
--   S1  sécurité : anon refusé, audit réservé au BM, encadrement visible
-- Se termine TOUJOURS par raise exception 'SIMULATION_RESULT %' :
-- tout est annulé. NE JAMAIS retirer cette dernière instruction.
-- Comptes fictifs (@audit.invalid) annulés avec la transaction.
-- Note : la base refuse déjà un producteur rattaché à un village inconnu
-- (« Village producteur invalide ») ; le contrôle C8 reste un filet de sécurité.
-- =====================================================================
do $t$
declare log jsonb := '[]'::jsonb; r jsonb; n bigint; m bigint; v numeric; w numeric; a1 numeric; a2 numeric; a3 numeric; t text; ok boolean;
  sfx text := upper(substr(md5(random()::text), 1, 6));
  u_bm uuid := gen_random_uuid(); u_uh uuid := gen_random_uuid(); u_cons uuid := gen_random_uuid();
  u_sk uuid := gen_random_uuid(); u_qa uuid := gen_random_uuid();
  vil text; vil2 text; rt1 text; p1 text; p2 text; h1 uuid; h2 uuid; lot uuid; shp uuid; rec text; inc text;
  cl_loc text; rt_loc text; pr_loc text;
  wh uuid := (select id from public.wms_warehouses where code = 'WH-BROBO');
  d1 date := current_date - 10; d2 date := current_date - 3;
  pv jsonb; pr jsonb; pc jsonb;
begin
  vil := 'v_aflp_t_' || lower(sfx); vil2 := vil || '_b'; rt1 := 'rt_aflp_t_' || lower(sfx);
  p1 := 'p_aflp_t_' || lower(sfx); p2 := p1 || '_b';
  cl_loc := 'AFLP-CL-TEST-' || sfx; rt_loc := 'AFLP-RT-TEST-' || sfx; pr_loc := 'AFLP-PR-TEST-' || sfx;
  pv := jsonb_build_object('village', vil); pr := jsonb_build_object('rt', rt1);

  -- ---------------------------------------------------------------- jeu fictif
  insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,instance_id)
  select v.id,'aflp-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','authenticated','authenticated','{}','{}',now(),now(),'00000000-0000-0000-0000-000000000000'
  from (values (u_bm,'bm'),(u_uh,'uh'),(u_cons,'co'),(u_sk,'sk'),(u_qa,'qa')) v(id,k);
  insert into public.profils(user_id,email,nom,role,actif,cluster,zone,warehouse_code,site_code)
  select v.id,'aflp-'||v.k||'-'||left(v.id::text,8)||'@audit.invalid','SIM '||v.ro,v.ro,true,v.cl,v.zo,v.w,v.s
  from (values (u_bm,'bm','Branch Manager',null,null,null,null),(u_uh,'uh','Unit Head','BROBO','GBEKE 1',null,null),
               (u_cons,'co','Consultation uniquement',null,null,null,null),(u_sk,'sk','Storekeeper',null,null,'WH-BROBO','BROBO'),
               (u_qa,'qa','QA / Lab',null,null,null,null)) v(id,k,ro,cl,zo,w,s);
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);

  insert into public.villages(id,village,cluster,cluster_code,departement,gps_lat,gps_lng,statut,farmer_code_prefix,data) values
   (vil,'VILLAGE TEST AFLP '||sfx,'BROBO','BROBO','Dept test',7.5,-5.0,'Approuvé BM','T'||sfx,
    jsonb_build_object('s1',jsonb_build_object('village','VILLAGE TEST AFLP '||sfx,'dateVisite',current_date::text,'sousPrefecture','SP test','distanceHub',12,'enqueteur','SIM Enquêteur'),
      's3',jsonb_build_object('nbProducteurs',50,'potentielMT',100,'potentielSecuriseMT',40),
      's5',jsonb_build_object('typeAcces','Piste','noteRoute',6,'camion10T',true,'camion30T',false),
      's8',jsonb_build_object('pasConflitFoncier',true,'pasConflitCommunautaire',true),'s9',jsonb_build_object('risqueConcurrentiel20',17))),
   (vil2,'VILLAGE TEST AFLP B '||sfx,'BROBO','BROBO','Dept test',null,null,'Brouillon',null,'{}'::jsonb);
  insert into public.rt(id,id_rt,nom,telephone,village_id,village_nom,statut,cluster,data)
  values (rt1,'RT-TEST-'||sfx,'SIM RT '||sfx,'0000000000',vil,'VILLAGE TEST AFLP '||sfx,'Confirmé','BROBO',
          jsonb_build_object('compteWave',true,'perf',jsonb_build_object('tonnageEngage',2)));
  insert into public.producteurs(id,nom,prenoms,telephone,village_id,village_nom,rt_id,statut,data)
  values (p1,'SIM PRODUCTEUR','UN '||sfx,'0000000001',vil,'VILLAGE TEST AFLP '||sfx,rt1,'Enrôlé',
          jsonb_build_object('engagementKg',1500,'potentiel2027Kg',2000,'superficieHa',3,'paiementMode','Wave'));
  begin
    insert into public.producteurs(id,code,nom,prenoms,village_id,rt_id,statut,data)
    values (p2,'Z'||sfx||'-0001','SIM PRODUCTEUR','SANS VILLAGE '||sfx,'village_inexistant_'||lower(sfx),rt1,'Enrôlé','{}'::jsonb);
  exception when others then p2 := null; log := log || jsonb_build_object('s','Préparation producteur sans village','info',SQLERRM); end;
  insert into public.avances(date,cluster,rt_id,rt_nom,source,montant,motif,statut,created_by,created_by_nom)
  values (d1,'BROBO',rt1,'SIM RT '||sfx,'Finance',1000000,'Avance test','Active',u_bm,'SIM Branch Manager');
  insert into public.achats(local_id,date,cluster,village_id,village_nom,rt_id,rt_nom,producteur_id,producteur_nom,poids_brut,poids_net,prix_kg,montant,
    mode_paiement,numero_recu,nb_sacs,humidite,kor,rejet,created_by,created_by_nom,recu_photo_url,qualite_statut,statut_validation,stock_statut,cash_statut)
  values ('ACH-T1-'||sfx,d1,'BROBO',vil,'VILLAGE TEST AFLP '||sfx,rt1,'SIM RT '||sfx,p1,'SIM PRODUCTEUR UN',1000,1000,450,450000,'Wave','RC-T1-'||sfx,12,9.5,48,false,u_bm,'SIM Acheteur','preuve-test.jpg','À sécher','À contrôler','Stock libéré','Non réconcilié')
  returning id into h1;
  insert into public.achats(local_id,date,cluster,village_id,village_nom,rt_id,rt_nom,producteur_id,producteur_nom,poids_brut,poids_net,prix_kg,montant,
    mode_paiement,numero_recu,nb_sacs,rejet,created_by,created_by_nom,qualite_statut,statut_validation,cash_statut)
  values ('ACH-T2-'||sfx,d1 + 1,'BROBO',vil,'VILLAGE TEST AFLP '||sfx,rt1,'SIM RT '||sfx,null,'SIM ANONYME',500,500,450,225000,'Cash','RC-T2-'||sfx,6,false,u_bm,'SIM Acheteur',null,'À contrôler','Non réconcilié')
  returning id into h2;
  insert into public.reconciliations(date,cluster,rt_id,rt_nom,cash_restant,valeur_stock,total_avance,total_paye,ecart,statut,created_by,created_by_nom)
  values (d2,'BROBO',rt1,'SIM RT '||sfx,320000,0,1000000,675000,-5000,'Écart',u_bm,'SIM Branch Manager');

  insert into public.rcn_jute_locations(code,nom,type,actif,scope_type,cluster,rt_id,producteur_id,actor_type,actor_code) values
   (cl_loc,'Cluster test '||sfx,'STOCK',true,'CLUSTER','BROBO',null,null,'CLUSTER','BROBO'),
   (rt_loc,'RT test '||sfx,'STOCK',true,'RT','BROBO',rt1,null,'RT',rt1),
   (pr_loc,'Producteur test '||sfx,'STOCK',true,'PRODUCTEUR','BROBO',rt1,p1,'PRODUCTEUR',p1);
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,reference,note,owner_type,movement_at,cluster,rt_id,producteur_id,campaign) values
   ('JUT-AF-1-'||sfx,'AF-1-'||sfx,'ACHAT','INTERNE',500,null,cl_loc,null,'UTILISABLE','AFLP-TEST','Test AFLP (rollback)','ANAGROCI',now()-interval '45 day','BROBO',null,null,'2027');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,reference,note,owner_type,movement_at,cluster,rt_id,producteur_id,campaign) values
   ('JUT-AF-2-'||sfx,'AF-2-'||sfx,'TRANSFERT','INTERNE',100,cl_loc,rt_loc,'UTILISABLE','UTILISABLE','AFLP-TEST','Dotation RT','ANAGROCI',now()-interval '44 day','BROBO',rt1,null,'2027');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,reference,note,owner_type,movement_at,cluster,rt_id,producteur_id,campaign) values
   ('JUT-AF-3-'||sfx,'AF-3-'||sfx,'TRANSFERT','INTERNE',40,rt_loc,pr_loc,'UTILISABLE','UTILISABLE','AFLP-TEST','Remise producteur','ANAGROCI',now()-interval '43 day','BROBO',rt1,p1,'2027');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,reference,note,owner_type,movement_at,cluster,rt_id,producteur_id,campaign) values
   ('JUT-AF-4-'||sfx,'AF-4-'||sfx,'RETOUR','INTERNE',30,pr_loc,rt_loc,'UTILISABLE','PLEIN','AFLP-TEST','Retour plein','ANAGROCI',now()-interval '42 day','BROBO',rt1,p1,'2027');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,reference,note,owner_type,movement_at,cluster,rt_id,producteur_id,campaign) values
   ('JUT-AF-5-'||sfx,'AF-5-'||sfx,'CLASSEMENT','INTERNE',5,rt_loc,rt_loc,'UTILISABLE','DECHIRE','AFLP-TEST','Sacs déchirés','ANAGROCI',now()-interval '41 day','BROBO',rt1,null,'2027');
  insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,from_location,to_location,from_state,to_state,reference,note,owner_type,movement_at,cluster,rt_id,producteur_id,campaign) values
   ('JUT-AF-6-'||sfx,'AF-6-'||sfx,'REFORME','INTERNE',3,rt_loc,'JUTE-REBUT','DECHIRE','REFORME','AFLP-TEST','Réforme','ANAGROCI',now()-interval '41 day','BROBO',rt1,null,'2027');

  -- Lot terrain + évacuation (RPC de l'écran Procurement / Evacuations)
  begin
    r := public.procurement_field_create_lot(jsonb_build_object('scope_type','VILLAGE','scope_id',vil,'scope_label','VILLAGE TEST AFLP '||sfx,
         'purchases',jsonb_build_array(jsonb_build_object('achat_id',h1,'qty_kg',1000,'bag_count',12))));
    lot := coalesce((r->>'id')::uuid, (r->'lot'->>'id')::uuid);
    r := public.procurement_field_create_shipment(jsonb_build_object('origin_type','VILLAGE','origin_id',vil,'origin_label','VILLAGE TEST AFLP '||sfx,
         'destination_type','WAREHOUSE','destination_id',wh::text,'destination_label','WH-BROBO','vehicle_plate','TEST '||sfx,'driver_name','SIM Chauffeur',
         'departed_at',(now()-interval '2 day')::text,'lots',jsonb_build_array(jsonb_build_object('lot_id',lot,'loaded_qty_kg',600))));
    shp := coalesce((r->>'id')::uuid, (r->'shipment'->>'id')::uuid);
    log := log || jsonb_build_object('s','Préparation lot + évacuation (RPC)','ok',lot is not null and shp is not null,'lot',lot is not null,'shipment',shp is not null);
  exception when others then log := log || jsonb_build_object('s','Préparation lot + évacuation (RPC)','ok',false,'err',SQLERRM); end;

  -- Sécurité : l'accès anonyme aux vues AFLP est refusé
  begin
    execute 'set local role anon';
    perform count(*) from public.aflp_v_daily_purchases;
    execute 'reset role';
    log := log || jsonb_build_object('s','S1a anon lit aflp_v_daily_purchases','ok',false);
  exception when others then execute 'reset role'; log := log || jsonb_build_object('s','S1a anon refusé sur les vues AFLP','ok',true,'refus',left(SQLERRM,80)); end;

  -- Lecture en tant que Branch Manager (RLS réelle)
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  execute 'set local role authenticated';

  -- T1 export vide : périmètre sans donnée
  begin
    pc := jsonb_build_object('village','village_sans_donnee');
    select (select count(*) from public.aflp_v_villages where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_daily_purchases where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_missions where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_cash_advances where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_jute_bags_ledger where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_field_stock where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_evacuations where village_ids @> array['village_sans_donnee'])
         + (select count(*) from public.aflp_v_quality_traceability where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_v_incidents where village_id = 'village_sans_donnee')
         + (select count(*) from public.aflp_rpt_producers(pc)) + (select count(*) from public.aflp_rpt_field_teams(pc))
         + (select count(*) from public.aflp_rpt_zones_clusters(pc)) into n;
    select count(*) into m from public.aflp_rpt_overview(pc);
    select count(*) filter (where statut in ('OK','SANS DONNÉES')) into v from public.aflp_rpt_controls(pc);
    log := log || jsonb_build_object('s','T1 Export vide : 0 ligne de données, 24 KPI, 16 contrôles sans alerte','ok',n = 0 and m = 24 and v = 16,'lignes',n,'kpi',m,'controles_ok',v);
  exception when others then log := log || jsonb_build_object('s','T1 Export vide','ok',false,'err',SQLERRM); end;

  -- T2 export avec données fictives : chaque onglet voit le jeu de test
  begin
    r := jsonb_build_object(
      'villages',(select count(*) from public.aflp_v_villages where village_id in (vil, vil2)),
      'producers',(select count(*) from public.aflp_rpt_producers(pv)),
      'teams',(select count(*) from public.aflp_rpt_field_teams(pr)),
      'missions',(select count(*) from public.aflp_v_missions where village_id = vil),
      'purchases',(select count(*) from public.aflp_v_daily_purchases where village_id = vil),
      'cash',(select count(*) from public.aflp_v_cash_advances where rt_id = rt1),
      'jute',(select count(*) from public.aflp_v_jute_bags_ledger where location_code in (cl_loc, rt_loc, pr_loc)),
      'stock',(select count(*) from public.aflp_v_field_stock where village_id = vil),
      'evac',(select count(*) from public.aflp_v_evacuations where village_ids @> array[vil]),
      'relay',(select count(*) from public.aflp_rpt_warehouse_relay('{"cluster":"BROBO"}'::jsonb)),
      'quality',(select count(*) from public.aflp_v_quality_traceability where village_id = vil),
      'incidents',(select count(*) from public.aflp_v_incidents where village_id = vil),
      'zones',(select count(*) from public.aflp_rpt_zones_clusters(jsonb_build_object('cluster','BROBO'))),
      'overview',(select count(*) from public.aflp_rpt_overview(pv)),
      'performance',(select count(*) from public.aflp_rpt_performance(pv)),
      'audit',(select count(*) from public.aflp_v_audit_log));
    ok := (r->>'villages')::int = 2 and (r->>'producers')::int = 1 and (r->>'teams')::int = 1 and (r->>'missions')::int = 1 and (r->>'purchases')::int = 2
      and (r->>'cash')::int = 4 and (r->>'jute')::int = 9 and (r->>'stock')::int >= 2 and (r->>'evac')::int = 1 and (r->>'relay')::int >= 1
      and (r->>'quality')::int >= 2 and (r->>'zones')::int = 1 and (r->>'overview')::int = 24 and (r->>'performance')::int > 17 and (r->>'audit')::int > 0;
    log := log || jsonb_build_object('s','T2 Export avec données fictives (16 sources)','ok',ok,'lignes',r);
  exception when others then log := log || jsonb_build_object('s','T2 Export fictif','ok',false,'err',SQLERRM); end;

  -- T3 contrôle cash RT
  begin
    select count(*) filter (where opening_advance + amount_received - amount_paid - amount_returned <> current_balance) into n
      from public.aflp_v_cash_advances where rt_id = rt1;
    select current_balance into v from public.aflp_v_cash_advances where rt_id = rt1 order by date desc, ord desc limit 1;
    select difference into w from public.aflp_v_cash_advances where rt_id = rt1 and transaction_type = 'Réconciliation caisse';
    select anomalies into m from public.aflp_rpt_controls(pr) where code = 'CASH_RT';
    ok := n = 0 and v = 325000 and w = -5000 and m = 1;
    select anomalies into m from public.aflp_rpt_controls(pr) where code = 'AVANCE_NON_JUSTIFIEE';
    log := log || jsonb_build_object('s','T3 Cash : Opening + Received − Paid − Returned = Current ; solde 325 000 ; écart caisse −5 000 détecté','ok',ok and m = 1,
      'lignes_en_erreur',n,'solde',v,'ecart_reconciliation',w,'avance_non_justifiee',m);
  exception when others then log := log || jsonb_build_object('s','T3 Cash','ok',false,'err',SQLERRM); end;

  -- T4 contrôle sacs jute
  begin
    select count(*) into n from public.aflp_v_jute_bags_ledger where location_code in (cl_loc, rt_loc, pr_loc)
      and bags_opening_stock + bags_received + bags_returned_full + bags_returned_empty + bags_transferred_in
          - bags_issued_to_producers - damaged_unusable - bags_transferred_out <> closing_balance;
    select jsonb_object_agg(location_code, closing_balance) into r from (
      select distinct on (location_code) location_code, closing_balance from public.aflp_v_jute_bags_ledger
      where location_code in (cl_loc, rt_loc, pr_loc) order by location_code, movement_date desc, movement_id desc) z;
    select count(*) into m from (
      select l.location_code from (select distinct on (location_code) location_code, closing_balance from public.aflp_v_jute_bags_ledger
        where location_code in (cl_loc, rt_loc, pr_loc) order by location_code, movement_date desc, movement_id desc) l
      left join (select location_code, sum(qty) filter (where state <> 'REFORME') q from public.rcn_jute_v_stock group by 1) s using (location_code)
      where l.closing_balance <> coalesce(s.q, 0)) z;
    select sum(bags_issued_to_producers), sum(bags_returned_full), sum(damaged_repairable), sum(damaged_unusable) into v, w, a1, a2
      from public.aflp_v_jute_bags_ledger where location_code in (cl_loc, rt_loc, pr_loc);
    ok := n = 0 and m = 0 and (r->>cl_loc)::int = 400 and (r->>rt_loc)::int = 87 and (r->>pr_loc)::int = 10 and v = 40 and w = 30;
    select anomalies into n from public.aflp_rpt_controls(pr) where code = 'SACS_SANS_RETOUR';
    log := log || jsonb_build_object('s','T4 Sacs jute : équation vérifiée, soldes 400 / 87 / 10 = stock sacherie, sacs chez producteur > 30 j détectés','ok',ok and n = 1,
      'soldes',r,'ecarts_stock_sacherie',m,'remis_producteurs',v,'retours_pleins',w,'sacs_sans_retour',n);
  exception when others then log := log || jsonb_build_object('s','T4 Sacs jute','ok',false,'err',SQLERRM); end;

  -- T5 contrôle stock terrain
  begin
    select count(*) into n from public.aflp_v_field_stock where village_id = vil
      and round(opening_stock_kg + purchases_kg + returns_kg - evacuated_kg - loss_adjustment_kg - closing_stock_kg, 3) <> 0;
    select closing_stock_kg into v from public.aflp_v_field_stock where village_id = vil order by date desc limit 1;
    select sum(purchases_kg), sum(evacuated_kg) into w, a1 from public.aflp_v_field_stock where village_id = vil;
    select anomalies into m from public.aflp_rpt_controls(pv) where code = 'STOCK_VILLAGE';
    log := log || jsonb_build_object('s','T5 Stock terrain : 1 500 achetés − 600 évacués = 900 kg, équation vérifiée chaque jour','ok',n = 0 and v = 900 and w = 1500 and m = 0,
      'lignes_en_erreur',n,'cloture',v,'achats',w,'anomalies_stock_village',m);
  exception when others then log := log || jsonb_build_object('s','T5 Stock terrain','ok',false,'err',SQLERRM); end;

  -- T6 contrôle évacuation : en route > 24 h, puis réception WMS à 590 kg
  begin
    select count(*) into n from public.aflp_v_incidents where incident_id like 'AUTO-TRANSIT-%' and village_id = vil;
    log := log || jsonb_build_object('s','T6a Évacuation en route > 24 h : incident automatique','ok',n = 1,'incidents',n);
  exception when others then log := log || jsonb_build_object('s','T6a Évacuation en route','ok',false,'err',SQLERRM); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_create_reception(jsonb_build_object('purchase_type','FIELD_BUYING','procurement_source_type','FIELD_SHIPMENT','procurement_source_id',shp::text,
         'warehouse_id',wh,'arrival_at',now()::text,'delivery_note_present',true,'delivery_note','BL-AFLP-'||sfx),'AFLP-TEST-REC-'||sfx);
    rec := r->>'id';
    perform set_config('request.jwt.claims',json_build_object('sub',u_qa,'role','authenticated')::text,true);
    r := public.wms_save_quality(rec,'SAMPLING',jsonb_build_object('gk_g',280,'imm_g',20,'spotted_g',10,'moisture_pct',9.2,'nut_count',190,'idempotency_key','AFLP-Q-'||sfx));
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    r := public.wms_decide_reception(rec,true,'Conforme (test AFLP)');
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.wms_record_offload(rec, jsonb_build_object('gross_kg',8590,'tare_kg',8000,'net_kg',590,'bags',7,'bags_good',7,'bags_wet',0,'bags_torn',0,
         'weighbridge_ticket','PB-AFLP-'||sfx,'warehouse_receipt','GRN-AFLP-'||sfx,'offload_start',now()::text,'offload_end',(now()+interval '30 minute')::text));
    log := log || jsonb_build_object('s','T6b Réception WMS de l’évacuation au relais WH-BROBO','ok',rec is not null,'statut',r->>'status');
  exception when others then
    log := log || jsonb_build_object('s','T6b Réception WMS de l’évacuation','ok',false,'err',left(SQLERRM,160));
  end;
  perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
  begin
    select qty_loaded_kg, qty_received_kg, difference_kg into v, w, a1 from public.aflp_v_evacuations where village_ids @> array[vil];
    select anomalies into m from public.aflp_rpt_controls(jsonb_build_object('cluster','BROBO')) where code = 'ECART_CHARGE_RECU';
    select count(*) into n from public.aflp_v_incidents where incident_id like 'AUTO-EVAC-%' and village_id = vil;
    select received_from_field_kg into w from public.aflp_rpt_warehouse_relay(jsonb_build_object('cluster','BROBO')) where warehouse_code = 'WH-BROBO';
    log := log || jsonb_build_object('s','T6c Écart chargé 600 / reçu 590 détecté (contrôle + incident), relais WH-BROBO crédité','ok',v = 600 and a1 = -10 and m >= 1 and n = 1 and w >= 590,
      'charge',v,'ecart',a1,'anomalies_charge_recu',m,'incident_auto',n,'recu_relais',w);
  exception when others then log := log || jsonb_build_object('s','T6c Écart chargé / reçu','ok',false,'err',SQLERRM); end;

  -- T7 performance RT
  begin
    select purchased_kg, target_kg, achievement_pct, cash_balance, bags_balance into v, w, a1, a2, a3
      from public.aflp_rpt_field_teams(pr) where role like 'RT%';
    select indicateur into t from public.aflp_rpt_performance(pv) where section = 'TOP 10 RT' and rang = 1;
    log := log || jsonb_build_object('s','T7 Performance RT : 1 500 kg / objectif 2 000 kg = 75 %, solde cash 325 000, sacs 87, 1er du top 10','ok',
      v = 1500 and w = 2000 and a1 = 75 and a2 = 325000 and a3 = 87 and t = 'SIM RT '||sfx,
      'achete',v,'objectif',w,'realisation_pct',a1,'solde_cash',a2,'solde_sacs',a3,'top1',t);
  exception when others then log := log || jsonb_build_object('s','T7 Performance RT','ok',false,'err',SQLERRM); end;

  -- T8 performance village et cluster
  begin
    select valeur into v from public.aflp_rpt_performance(pv) where section = 'TOP 10 VILLAGES' and rang = 1;
    select purchased_mt, evacuated_mt into w, a1 from public.aflp_rpt_zones_clusters(jsonb_build_object('cluster','BROBO','from',(current_date - 30)::text));
    select anomalies into n from public.aflp_rpt_controls(jsonb_build_object('cluster','BROBO')) where code = 'VILLAGE_SANS_ACHAT';
    select count(*) into m from public.aflp_v_village_dim where cluster_code = 'BROBO'
      and village_id not in (select village_id from public.aflp_v_daily_purchases where not rejet and village_id is not null);
    log := log || jsonb_build_object('s','T8 Performance village : 1 500 kg au top, cluster Brobo 1,5 MT achetées / 0,6 MT évacuées, villages sans achat comptés','ok',
      v = 1500 and w >= 1.5 and a1 >= 0.6 and n = m,'village_top',v,'cluster_achete_mt',w,'cluster_evacue_mt',a1,'villages_sans_achat',n);
  exception when others then log := log || jsonb_build_object('s','T8 Performance village','ok',false,'err',SQLERRM); end;

  -- T9 incidents : déclaration, clôture, droits
  begin
    r := public.aflp_declare_incident(jsonb_build_object('incident_type','MANQUE_SACS','risk_category','OPERATIONNEL','severity','ELEVEE',
         'village_id',vil,'rt_id',rt1,'description','Manque de sacs au village test (rollback)','responsible_person','SIM Chef'));
    inc := r->>'id';
    select cluster_code into t from public.aflp_incidents where id = inc;
    log := log || jsonb_build_object('s','T9a Déclaration incident (BM), cluster déduit du village','ok',inc is not null and t = 'BROBO','id',inc is not null,'cluster',t);
  exception when others then log := log || jsonb_build_object('s','T9a Déclaration incident','ok',false,'err',SQLERRM); end;
  begin
    r := public.aflp_update_incident(inc,'CLOS',null);
    log := log || jsonb_build_object('s','T9b Clôture sans note','ok',false,'constat','ACCEPTÉE (anomalie)');
  exception when others then log := log || jsonb_build_object('s','T9b Clôture sans note refusée','ok',true,'refus',left(SQLERRM,80)); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_sk,'role','authenticated')::text,true);
    r := public.aflp_update_incident(inc,'EN_COURS','x');
    log := log || jsonb_build_object('s','T9c Storekeeper modifie un incident','ok',false,'constat','ACCEPTÉ (anomalie)');
  exception when others then log := log || jsonb_build_object('s','T9c Storekeeper refusé sur le suivi incident','ok',true,'refus',left(SQLERRM,80)); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_cons,'role','authenticated')::text,true);
    r := public.aflp_declare_incident(jsonb_build_object('incident_type','AUTRE','severity','FAIBLE','description','Tentative consultation'));
    log := log || jsonb_build_object('s','T9d Consultation déclare un incident','ok',false,'constat','ACCEPTÉ (anomalie)');
  exception when others then log := log || jsonb_build_object('s','T9d Profil Consultation refusé en déclaration','ok',true,'refus',left(SQLERRM,80)); end;
  begin
    execute 'reset role';
    execute 'set local role anon';
    r := public.aflp_declare_incident(jsonb_build_object('incident_type','AUTRE','severity','FAIBLE','description','Tentative anonyme'));
    execute 'reset role'; execute 'set local role authenticated';
    log := log || jsonb_build_object('s','T9e anon déclare un incident','ok',false,'constat','ACCEPTÉ (anomalie)');
  exception when others then execute 'reset role'; execute 'set local role authenticated';
    log := log || jsonb_build_object('s','T9e anon refusé en déclaration','ok',true,'refus',left(SQLERRM,80)); end;
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_uh,'role','authenticated')::text,true);
    r := public.aflp_update_incident(inc,'EN_COURS','Prise en charge');
    r := public.aflp_update_incident(inc,'CLOS','Sacs livrés au village');
    select count(*) into n from public.aflp_v_incidents where incident_id = inc and status_code = 'CLOS' and closing_date = current_date;
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    select count(*) into m from public.aflp_v_audit_log where action in ('aflp_incident_declared','aflp_incident_status') and object_id = inc;
    log := log || jsonb_build_object('s','T9f Chef d’Unité : en cours puis clos avec note, visible Clos, tracé dans l’audit','ok',n = 1 and m = 3,'clos',n,'audit',m);
  exception when others then log := log || jsonb_build_object('s','T9f Suivi incident','ok',false,'err',SQLERRM); end;

  -- T10 traçabilité producteur → village → RT → achat → évacuation
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
    select producer_linked || village_linked || rt_linked into t from public.aflp_v_quality_traceability where quality_id = 'QA-ACH-T1-'||sfx;
    select anomalies, valeur into n, v from public.aflp_rpt_controls(pv) where code = 'TRACABILITE_CHAINE';
    select total_sold_kg into w from public.aflp_rpt_producers(jsonb_build_object('producer',p1));
    select count(*) into m from public.aflp_v_evacuations where village_ids @> array[vil] and producer_ids @> array[p1] and rt_ids @> array[rt1];
    select anomalies into a1 from public.aflp_rpt_controls(pv) where code = 'ACHATS_SANS_PRODUCTEUR';
    log := log || jsonb_build_object('s','T10 Chaîne producteur → village → RT → achat → évacuation (1 achat complet évacué, 1 achat sans producteur signalé)','ok',
      t = 'OuiOuiOui' and n = 1 and v = 1 and w = 1000 and m = 1 and a1 = 1,
      'liens_achat1',t,'achats_incomplets',n,'achats_evacues',v,'vendu_producteur',w,'evacuation_rattachee',m,'achats_sans_producteur',a1);
  exception when others then log := log || jsonb_build_object('s','T10 Traçabilité','ok',false,'err',SQLERRM); end;

  -- S1 sécurité complémentaire
  begin
    perform set_config('request.jwt.claims',json_build_object('sub',u_uh,'role','authenticated')::text,true);
    select count(*) into n from public.aflp_v_audit_log;
    select unit_head into t from public.aflp_v_cluster_staff where cluster_code = 'BROBO';
    select count(*) into m from public.aflp_rpt_controls(pv);
    log := log || jsonb_build_object('s','S1b Chef d’Unité : audit masqué, encadrement visible, contrôles calculés','ok',n = 0 and t like '%SIM Unit Head%' and m = 16,
      'audit',n,'chef_unite_visible',t like '%SIM Unit Head%','controles',m);
  exception when others then log := log || jsonb_build_object('s','S1b Chef d’Unité','ok',false,'err',SQLERRM); end;
  begin
    if p2 is not null then
      perform set_config('request.jwt.claims',json_build_object('sub',u_bm,'role','authenticated')::text,true);
      select anomalies into n from public.aflp_rpt_controls(pr) where code = 'PRODUCTEURS_SANS_VILLAGE';
      log := log || jsonb_build_object('s','C8 Producteur rattaché à un village inconnu détecté','ok',n >= 1,'anomalies',n);
    end if;
  exception when others then log := log || jsonb_build_object('s','C8 Producteurs sans village','ok',false,'err',SQLERRM); end;

  execute 'reset role';
  raise exception 'SIMULATION_RESULT %', log::text;
end $t$;
