-- =============================================================================
-- Recette SQL de bout en bout · Enrôlement coopératives (lot 7).
-- Exécutée sur la base de production SANS TRACE : le bloc se termine par une
-- exception volontaire → ROLLBACK intégral (aucune coopérative, aucun producteur,
-- aucune livraison, aucune file QA ne subsiste). Sessions simulées par
-- request.jwt.claims + rôle authenticated : RLS et périmètres réellement appliqués.
-- Paramètres : {{BM}} Branch Manager, {{SUP}} Supervisor sans périmètre,
-- {{PRT}} producteur existant rattaché à un RT, {{POTHER}} autre producteur existant,
-- {{VRT}} village du producteur RT, {{VCL}} autre village du même cluster, {{WH}} entrepôt,
-- {{RCV}} une réception WMS existante.
-- Aucune donnée réelle n'est renvoyée : seulement des booléens et des codes QA.
-- =============================================================================
do $t$
declare
  bm uuid := '{{BM}}'; sup uuid := '{{SUP}}'; prt text := '{{PRT}}'; pother text := '{{POTHER}}';
  vrt text := '{{VRT}}'; vcl text := '{{VCL}}'; wh uuid := '{{WH}}'; rcv text := '{{RCV}}';
  res jsonb := '[]'; r jsonb; ca uuid; cb uuid; sec uuid; p1 text; p1code text; pmin text; m_rt uuid; n int; n2 int; d1 uuid; a1 uuid;
  tel_rt text; code_rt text; rt_rt text; rv uuid; rv2 uuid; bt uuid; mid uuid; k jsonb; rep jsonb; rep0 jsonb;
begin
  select telephone, code, rt_id into tel_rt, code_rt, rt_rt from public.producteurs where id = prt;

  perform set_config('request.jwt.claims', json_build_object('sub', bm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  rep0 := public.aflp_coop_report(jsonb_build_object('campaign','2027'));

  -- 1-2. coopérative A (non QA pour exercer reporting et Delivery Plan ; annulée en fin) + modification
  r := public.aflp_coop_save(jsonb_build_object('name','QA RECETTE COOP A','acronym','QARA','cluster_code','DJEBONOUA',
        'locality','QA','aflp_status','ACTIVE','payment_model','COOPERATIVE_CONSOLIDATED','target_mt',100,'declared_potential_mt',150,
        'destination_warehouse_id', wh));
  ca := (r->>'id')::uuid;
  r := public.aflp_coop_save(jsonb_build_object('id',ca,'name','QA RECETTE COOP A','row_version',(r->>'row_version')::int,'acronym','QARA2'));
  res := res || jsonb_build_array(jsonb_build_object('t','01-02 creation + modification coop','ok', r->>'acronym' = 'QARA2'));
  r := public.aflp_coop_save(jsonb_build_object('name','QA RECETTE COOP B','is_qa',true,'cluster_code','DJEBONOUA','aflp_status','ACTIVE'));
  cb := (r->>'id')::uuid;

  -- 3-6. villages, section, point de collecte, responsables (contacts, pas des RT)
  insert into public.aflp_coop_sections(cooperative_id, name) values (ca,'QA SECTION 1') returning id into sec;
  insert into public.aflp_coop_villages(cooperative_id, village_id, section_id) values (ca, vrt, sec), (ca, vcl, null);
  insert into public.aflp_coop_collection_points(cooperative_id, name, village_id, destination_warehouse_id) values (ca,'QA PC 1', vrt, wh);
  insert into public.aflp_coop_contacts(cooperative_id, role, full_name, phone) values (ca,'PRESIDENT','QA PRESIDENT','0700000101');
  res := res || jsonb_build_array(jsonb_build_object('t','03-06 villages section point responsables','ok',
     (select count(*) from public.aflp_coop_villages where cooperative_id = ca) = 2 and
     (select count(*) from public.aflp_coop_collection_points where cooperative_id = ca) = 1));

  -- 7. enrôlement complet d'un NOUVEAU producteur (registre unique)
  r := public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'campaign','2027','nom','QA KOFFI','prenoms','QA ENROLE UN',
        'sexe','F','birth_year',1990,'telephone','0700000201','telephone_alt','0500000201','preferred_language','BAOULE',
        'village_id',vrt,'section_id',sec,'member_number','QA-M-001','membership_start','2026-10-01','verified',true,'verification_method','LISTE_COOPERATIVE',
        'cashew_farmer','OUI','plantation_count',2,'total_area_ha',3.5,'forecast_kg',2100,'previous_production_kg',1800,'planting_year',2012,'tree_count',300,
        'plots', jsonb_build_array(jsonb_build_object('lat',7.70,'lng',-5.03,'accuracy_m',6,'area_ha',2,'tree_count',180,'planting_year',2012)),
        'consent', jsonb_build_object('status','GRANTED','method','VERBAL','consent_at', now())));
  p1 := r->>'producer_id'; p1code := r->>'farmer_id';
  res := res || jsonb_build_array(jsonb_build_object('t','07 enrolement nouveau producteur','ok', r->>'status' = 'ENROLE' and p1code is not null,
     'completude', r->'completeness_pct'));
  res := res || jsonb_build_array(jsonb_build_object('t','07b / 13 passport : baseline + parcelle GPS + consentement','ok',
     (select count(*) from public.farmer_production_baselines where producteur_id = p1) = 1
     and (select count(*) from public.farmer_plots where producteur_id = p1 and gps_status = 'POINT_CAPTURED') = 1
     and (select consent_status from public.producteurs where id = p1) = 'GRANTED'
     and (select passport_completion from public.producteurs where id = p1) > 0,
     'passport', (select passport_stage || ' ' || passport_completion from public.producteurs where id = p1)));
  res := res || jsonb_build_array(jsonb_build_object('t','07c qualite : 100 % des 8 elements','ok',
     (select completeness_pct from public.aflp_producer_quality_v where producer_id = p1) = 100));

  -- 7d. enrôlement minimal : rien n'est déduit
  r := public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'nom','QA MINIMAL','prenoms','QA SANS DONNEES','village_id',vcl));
  pmin := r->>'producer_id';
  res := res || jsonb_build_array(jsonb_build_object('t','07d dossier incomplet : rien de deduit','ok',
     (select consent_status from public.producteurs where id = pmin) = 'NOT_RECORDED'
     and not exists (select 1 from public.farmer_production_baselines where producteur_id = pmin)
     and not exists (select 1 from public.farmer_plots where producteur_id = pmin)
     and (select completeness_pct from public.aflp_producer_quality_v where producer_id = pmin) = 13
     and (select missing_fields @> array['TELEPHONE','SEXE','AGE','GPS','SUPERFICIE','POTENTIEL','CONSENTEMENT'] from public.aflp_producer_quality_v where producer_id = pmin)));

  -- 8-9. producteur existant rattaché à un RT : association seule
  select count(*) into n from public.producteurs where not deleted;
  r := public.aflp_coop_add_member(jsonb_build_object('cooperative_id',ca,'producer_id',prt,'member_number','QA-M-002','section_id',sec));
  m_rt := (r->'membership'->>'id')::uuid;
  select count(*) into n2 from public.producteurs where not deleted;
  res := res || jsonb_build_array(jsonb_build_object('t','08-09 producteur RT + coop sans duplication','ok',
     n = n2 and r->>'farmer_id' = code_rt and (select rt_id from public.producteurs where id = prt) is not distinct from rt_rt
     and (r->>'created')::boolean = false));
  res := res || jsonb_build_array(jsonb_build_object('t','14-15 source enrolement / affiliation actuelle','ok',
     (select enrollment_channel = 'AFLP_DIRECT' and sourcing_channel = 'COOPERATIVE' and followup_rt_id = rt_rt
        from public.aflp_producer_channel_v where producer_id = prt)
     and (select enrollment_channel = 'COOPERATIVE' from public.aflp_producer_channel_v where producer_id = p1)));
  r := public.aflp_coop_add_member(jsonb_build_object('cooperative_id',ca,'producer_id',pother));
  res := res || jsonb_build_array(jsonb_build_object('t','08b association producteur existant','ok', (r->>'created')::boolean = false));

  -- 11. anti-doublon
  begin
    perform public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'nom','QA AUTRE NOM','village_id',vcl,'telephone',tel_rt));
    res := res || jsonb_build_array(jsonb_build_object('t','11a doublon telephone bloque','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','11a doublon telephone bloque','ok', sqlerrm like 'DOUBLON_FORT%')); end;
  begin
    perform public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'nom','QA X','village_id',vcl,'farmer_id',code_rt,
      'force_reason','Motif de test de forçage QA'));
    res := res || jsonb_build_array(jsonb_build_object('t','11b Farmer ID jamais recree meme force','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','11b Farmer ID jamais recree meme force','ok', sqlerrm like 'DOUBLON_FORT%')); end;
  begin
    perform public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'nom','QA KOFFI','prenoms','QA ENROLE UN','village_id',vrt));
    res := res || jsonb_build_array(jsonb_build_object('t','11c doublon nom+village exige un motif','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','11c doublon nom+village exige un motif','ok', sqlerrm like 'DOUBLON_POSSIBLE%')); end;
  r := public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'nom','QA KOFFI','prenoms','QA ENROLE UN','village_id',vrt,'send_to_review',true));
  rv := (r->>'review_id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('t','11d doublon envoye en file A verifier','ok', r->>'status' = 'EN_VERIFICATION'
     and (select category = 'DOUBLON_A_VERIFIER' and top_confidence = 75 from public.aflp_coop_enrollment_reviews where id = rv)));
  begin
    perform public.aflp_coop_review_decide(rv, 'ASSOCIER_EXISTANT', p1, 'Même personne', null);
    res := res || jsonb_build_array(jsonb_build_object('t','11e membre deja present : association refusee','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','11e membre deja present : association refusee','ok', sqlerrm like '%déjà membre%')); end;
  r := public.aflp_coop_review_decide(rv, 'IGNORER', null, 'Doublon confirmé du producteur QA déjà membre', null);
  res := res || jsonb_build_array(jsonb_build_object('t','11f decision ignorer tracee','ok',
     (select status = 'RESOLU' and decision = 'IGNORER' and decided_by = bm from public.aflp_coop_enrollment_reviews where id = rv)));
  -- un homonyme avec motif : création autorisée, marquée doublon possible
  r := public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',cb,'nom','QA KOFFI','prenoms','QA ENROLE UN','village_id',vrt,
        'confirm_reason','Homonyme : autre personne, autre famille'));
  res := res || jsonb_build_array(jsonb_build_object('t','11g homonyme cree avec motif, marque a revoir','ok',
     (select possible_duplicate and review_required from public.producteurs where id = r->>'producer_id')));

  -- 10. import Excel (v2) : toutes les catégories, aucune ligne perdue
  r := public.aflp_coop_import_rows(ca, '2027', null, 'QA_import.xlsx', 7, jsonb_build_array(
        jsonb_build_object('idx',1,'action','CREATE','nom','QA IMPORT','prenoms','QA NOUVEAU UN','village_id',vrt,'telephone','0700000301','member_number','QA-M-101'),
        jsonb_build_object('idx',2,'action','CREATE','nom','QA IMPORT','prenoms','QA NOUVEAU DEUX','village_id',vcl,'sexe','M'),
        jsonb_build_object('idx',3,'action','CREATE','nom','QA AUTRE IDENTITE','village_id',vcl,'telephone',tel_rt),
        jsonb_build_object('idx',4,'action','CREATE','nom','QA SANS VILLAGE','prenoms','QA'),
        jsonb_build_object('idx',5,'action','LINK','producer_id',pother),
        jsonb_build_object('idx',6,'action','SKIP','reason','Ligne de total du fichier'),
        jsonb_build_object('idx',7,'action','REJECT','reason','Ligne vide')), true);
  bt := (r->>'batch_id')::uuid; k := r->'counts';
  res := res || jsonb_build_array(jsonb_build_object('t','10 import : 7 lignes, 7 statuts','ok',
     (k->>'NOUVEAU_ENROLE')::int = 2 and (k->>'DOUBLON_A_VERIFIER')::int = 1 and (k->>'A_COMPLETER')::int = 1
     and (k->>'EXISTANT_ASSOCIE')::int = 1 and (k->>'IGNORE')::int = 1 and (k->>'REJETE')::int = 1
     and jsonb_array_length(r->'details') = 7
     and (select total_rows = 7 and status = 'TERMINE' and jsonb_array_length(details) = 7 from public.aflp_coop_import_batches where id = bt),
     'counts', k));

  -- 12. compléter un dossier « À compléter » puis l'enrôler
  select id into rv2 from public.aflp_coop_enrollment_reviews where batch_id = bt and category = 'A_COMPLETER' limit 1;
  r := public.aflp_coop_review_decide(rv2, 'ENROLER', null, null, jsonb_build_object('village_id', vcl));
  res := res || jsonb_build_array(jsonb_build_object('t','12 dossier complete puis enrole','ok',
     r->>'status' = 'ENROLE' and (select decision = 'ENROLE_APRES_COMPLEMENT' from public.aflp_coop_enrollment_reviews where id = rv2)));
  select id into rv2 from public.aflp_coop_enrollment_reviews where batch_id = bt and category = 'DOUBLON_A_VERIFIER' limit 1;
  begin
    perform public.aflp_coop_review_decide(rv2, 'CREER_JUSTIFIE', null, 'court', null);
    res := res || jsonb_build_array(jsonb_build_object('t','12b creation sans motif suffisant refusee','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','12b creation sans motif suffisant refusee','ok', true)); end;

  -- transfert A → B (historisé, Farmer ID inchangé, une seule principale ouverte)
  select membership_id into mid from public.aflp_coop_members_v where producer_id = p1 and cooperative_id = ca and status <> 'ENDED';
  r := public.aflp_coop_transfer_member(mid, cb, 'Changement de coopérative QA', 'QA-B-001', null);
  res := res || jsonb_build_array(jsonb_build_object('t','T transfert coop A vers B','ok',
     (select status = 'ENDED' and membership_end is not null and member_number = 'QA-M-001' from public.aflp_coop_memberships where id = mid)
     and (select count(*) from public.aflp_coop_memberships where producer_id = p1 and campaign = '2027' and is_primary and status <> 'ENDED') = 1
     and (select code from public.producteurs where id = p1) = p1code
     and (select enrollment_channel from public.aflp_producer_channel_v where producer_id = p1) = 'COOPERATIVE'));
  r := public.aflp_coop_transfer_member((r->'nouvelle'->>'id')::uuid, ca, 'Retour en coopérative A (QA)', 'QA-M-001B', sec);

  -- 16. achat mode A d'un membre : canal + coopérative portés par l'achat
  insert into public.achats(date, village_id, producteur_id, poids_net, prix_kg, montant, created_by, campaign, rejet)
  values (current_date, vrt, p1, 850, 1, 850, bm, '2027', false) returning id into a1;
  res := res || jsonb_build_array(jsonb_build_object('t','16 achat mode A trace la cooperative','ok',
     (select sourcing_channel = 'COOPERATIVE' and cooperative_id = ca from public.achats where id = a1)));

  -- 17-20. livraison mode B : planification (camion, chauffeur), réception WMS, allocation
  r := public.aflp_coop_plan_delivery(jsonb_build_object('cooperative_id',ca,'planned_date',current_date,'planned_kg',2000,'planned_bags',25,
        'warehouse_id',wh,'section_id',sec,'truck','QA-TRUCK-01','driver','QA CHAUFFEUR','transporter','QA TRANSPORT'));
  d1 := (r->>'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('t','17/19 livraison planifiee (Delivery Plan coop)','ok',
     (select truck = 'QA-TRUCK-01' and driver = 'QA CHAUFFEUR' and warehouse_code is not null and cooperative_code like 'COOP-%'
        and allocation_status = 'ALLOCATION_A_COMPLETER' and traceability_level = 'EN_ATTENTE_RECEPTION'
        from public.aflp_coop_delivery_status_v where id = d1)));
  res := res || jsonb_build_array(jsonb_build_object('t','17b origine non saisie : jamais deduite','ok',
     (select origin is null from public.aflp_coop_delivery_status_v where id = d1)));
  r := public.aflp_coop_plan_delivery(jsonb_build_object('cooperative_id',ca,'planned_date',current_date,'planned_kg',500,'warehouse_id',wh,'origin','QA ORIGINE'));
  res := res || jsonb_build_array(jsonb_build_object('t','17c origine saisie conservee','ok',
     (select origin = 'QA ORIGINE' from public.aflp_coop_delivery_status_v where id = (r->>'id')::uuid)));
  r := public.aflp_coop_record_delivery(d1, 1980, 25, rcv, 'RECUE');
  res := res || jsonb_build_array(jsonb_build_object('t','20 reception WMS reliee, allocation a completer','ok',
     (select reception_id_resolved = rcv and traceability_level = 'ORGANISATION_SEULEMENT' from public.aflp_coop_delivery_status_v where id = d1)));
  insert into public.aflp_coop_delivery_allocations(delivery_id, producer_id, qty_kg) values (d1, p1, 1180), (d1, prt, 800);
  res := res || jsonb_build_array(jsonb_build_object('t','18 allocation complete : tracable producteur','ok',
     (select fully_traceable and traceability_level = 'TRACABLE_PRODUCTEUR' from public.aflp_coop_delivery_status_v where id = d1)));
  begin
    insert into public.aflp_coop_delivery_allocations(delivery_id, producer_id, qty_kg) values (d1, pmin, 50);
    res := res || jsonb_build_array(jsonb_build_object('t','18b sur-allocation refusee','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','18b sur-allocation refusee','ok', true)); end;

  -- 21-23. LOT / origine / Traceability 360
  res := res || jsonb_build_array(jsonb_build_object('t','21-22 LOT de la reception : origine coop + tracable producteur','ok',
     (select bool_and(o.origin_channel = 'COOPERATIVE' and o.cooperative_codes like '%' || (select code from public.aflp_cooperatives where id = ca) || '%'
             and o.traceability_level = 'TRACABLE_PRODUCTEUR' and o.farmers >= 2)
        from public.aflp_lot_origin_v o where o.reception_id = rcv),
     'lots', (select count(*) from public.aflp_lot_origin_v o where o.reception_id = rcv)));
  res := res || jsonb_build_array(jsonb_build_object('t','23 Traceability 360 trouve coop et livraison','ok',
     exists (select 1 from public.operations_traceability_search_v where entity_type = 'COOPERATIVE' and entity_id = (select code from public.aflp_cooperatives where id = ca))
     and exists (select 1 from public.operations_traceability_search_v where entity_type = 'COOP_DELIVERY' and entity_id = (select code from public.aflp_coop_deliveries where id = d1))));
  r := public.aflp_coop_chain(ca, '2027');
  res := res || jsonb_build_array(jsonb_build_object('t','23b chaine coop -> producteurs -> achats -> livraisons','ok',
     (r->'producteurs'->>'ouverts')::int >= 4 and (r->'achats_mode_a'->>'nombre')::int >= 1));

  -- 24. Reports : filtres combinés, aucun double comptage
  rep := public.aflp_coop_report(jsonb_build_object('campaign','2027'));
  res := res || jsonb_build_array(jsonb_build_object('t','24a total producteurs = direct + coop (un seul comptage)','ok',
     (rep->>'producteurs')::int = (rep->>'direct_rt')::int + (rep->>'cooperative')::int
     and (rep->>'producteurs')::int = (rep0->>'producteurs')::int + 5
     and (rep->>'cooperative')::int = (rep0->>'cooperative')::int + 7));
  rep := public.aflp_coop_report(jsonb_build_object('campaign','2027','channel','COOPERATIVE','coop',ca,'cluster','DJEBONOUA',
        'village_id',vrt,'date_from',current_date - 1,'date_to',current_date));
  res := res || jsonb_build_array(jsonb_build_object('t','24b filtres combines canal+coop+cluster+village+periode','ok',
     (rep->>'producteurs')::int = (select count(*) from public.aflp_coop_members_v where cooperative_id = ca and status <> 'ENDED' and is_primary and village_id = vrt)
     and (rep->>'achats_kg')::numeric = 850 and (rep->>'direct_rt')::int = 0, 'producteurs', rep->'producteurs'));
  rep := public.aflp_coop_report(jsonb_build_object('campaign','2027','channel','AFLP_DIRECT','village_id',vrt));
  res := res || jsonb_build_array(jsonb_build_object('t','24c canal direct exclut les membres coop','ok',
     (rep->>'cooperative')::int = 0 and (rep->>'cooperatives')::int = 0));
  rep := public.aflp_coop_report(jsonb_build_object('campaign','2027','producer',p1code));
  res := res || jsonb_build_array(jsonb_build_object('t','24d filtre producteur','ok', (rep->>'producteurs')::int = 1));
  begin
    perform public.aflp_coop_report(jsonb_build_object('date_from','2027-03-31','date_to','2027-01-01'));
    res := res || jsonb_build_array(jsonb_build_object('t','24e periode inversee refusee','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','24e periode inversee refusee','ok', true)); end;
  -- les producteurs créés dans une coopérative QA restent hors statistiques
  res := res || jsonb_build_array(jsonb_build_object('t','24f producteurs QA exclus des totaux','ok',
     (select count(*) from public.producteurs where coalesce((data->>'qa')::boolean,false)) >= 1
     and (public.aflp_channel_totals('2027', false)->>'producteurs_total')::int
       = (select count(*) from public.producteurs where not deleted and not coalesce((data->>'qa')::boolean,false))));

  -- formations (durabilité) : session + présences réelles seulement
  insert into public.aflp_coop_trainings(cooperative_id, topic, category, training_date, trainer) values (ca,'QA bonnes pratiques','BONNES_PRATIQUES', current_date, 'QA FORMATEUR') returning id into a1;
  insert into public.aflp_coop_training_attendance(training_id, producer_id) values (a1, p1), (a1, prt);
  res := res || jsonb_build_array(jsonb_build_object('t','P1 formation enregistree avec presences','ok',
     (select count(*) from public.aflp_coop_training_attendance where training_id = a1) = 2));

  -- 26. audit
  res := res || jsonb_build_array(jsonb_build_object('t','26 audit (affiliations, file, import, livraison)','ok',
     (select count(*) from public.aflp_coop_audit where cooperative_id = ca and entity = 'aflp_coop_memberships') >= 4
     and exists (select 1 from public.aflp_coop_audit where cooperative_id = ca and entity = 'aflp_coop_enrollment_reviews')
     and exists (select 1 from public.aflp_coop_audit where cooperative_id = ca and entity = 'import_producteurs')));

  -- 27. droits : Supervisor sans périmètre, utilisateur sans profil
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  begin
    perform public.aflp_coop_enroll_producer(jsonb_build_object('cooperative_id',ca,'nom','QA INTRUS','village_id',vrt));
    res := res || jsonb_build_array(jsonb_build_object('t','27a enrolement hors perimetre refuse','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','27a enrolement hors perimetre refuse','ok', true)); end;
  select count(*) into n from public.aflp_coop_enrollment_reviews where cooperative_id = ca;
  res := res || jsonb_build_array(jsonb_build_object('t','27b file A verifier invisible hors perimetre','ok', n = 0));
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.aflp_coop_match_producers_v2(jsonb_build_array(jsonb_build_object('idx',1,'telephone',tel_rt)));
    res := res || jsonb_build_array(jsonb_build_object('t','27c recherche sans profil refusee','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','27c recherche sans profil refusee','ok', true)); end;
  begin
    perform public.aflp_coop_report('{}'::jsonb);
    res := res || jsonb_build_array(jsonb_build_object('t','27d reporting sans profil refuse','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','27d reporting sans profil refuse','ok', true)); end;

  -- recherche : un producteur hors périmètre n'expose que son Farmer ID
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  select count(*) into n from public.aflp_coop_match_producers_v2(jsonb_build_array(jsonb_build_object('idx',1,'telephone',tel_rt))) x
   where not x.accessible and x.producer_id is null and x.nom = 'PRODUCTEUR HORS PÉRIMÈTRE' and x.telephone_masque is null;
  res := res || jsonb_build_array(jsonb_build_object('t','27e doublon hors perimetre signale sans identite','ok', n >= 1));

  execute 'reset role';
  raise exception 'RESULTATS_QA %', res;
end $t$;
