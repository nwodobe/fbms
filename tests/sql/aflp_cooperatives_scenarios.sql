-- =============================================================================
-- Recette SQL · AFLP Coopératives (exécutée sur la base de production SANS
-- trace : tout le bloc se termine par une exception volontaire, donc ROLLBACK
-- intégral — aucune coopérative, aucun producteur, aucun achat QA ne subsiste).
-- Les sessions utilisateurs sont simulées par request.jwt.claims + rôle
-- authenticated : la RLS et les fonctions de périmètre s'appliquent réellement.
-- Paramètres : :bm (Branch Manager), :zh (Zonal Head), :sup (Supervisor sans
-- périmètre), deux villages AFLP, un producteur existant avec téléphone.
-- Le résultat est renvoyé dans le message de l'exception finale (JSON).
-- =============================================================================
do $t$
declare
  bm uuid := '{{BM}}'; zh uuid := '{{ZH}}'; sup uuid := '{{SUP}}';
  v1 text := '{{V1}}'; v2 text := '{{V2}}'; wh uuid := '{{WH}}';
  p_exist text := '{{PEXIST}}';
  res jsonb := '[]'; r jsonb; c1 uuid; c2 uuid; p1 text; m1 uuid; m2 uuid; d1 uuid; n int; ok boolean; tel_exist text; code_exist text; a1 uuid;
  begin
  select telephone, code into tel_exist, code_exist from public.producteurs where id = p_exist;

  -- ---------------------------------------------------------- session BM
  perform set_config('request.jwt.claims', json_build_object('sub', bm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. création coopérative (statut ACTIVE par direction, target, président)
  r := public.aflp_coop_save(jsonb_build_object('name','QA COOP BROBO','acronym','QACB','is_qa',true,'cluster_code','BROBO',
        'locality','Brobo','declared_members',500,'declared_potential_mt',700,'target_mt',300,'aflp_status','ACTIVE',
        'payment_model','INDIVIDUAL_FARMER','president_name','QA PRESIDENT UN','president_phone','0700000001'));
  c1 := (r->>'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('t','01 creation coop','ok', r->>'code' like 'QA-COOP-%', 'code', r->>'code'));

  -- 2. modification (row_version)
  r := public.aflp_coop_save(jsonb_build_object('id',c1,'name','QA COOP BROBO','acronym','QACB2','cluster_code','BROBO','row_version',(r->>'row_version')::int,'target_mt',320));
  res := res || jsonb_build_array(jsonb_build_object('t','02 modification','ok', r->>'acronym' = 'QACB2' and (r->>'row_version')::int = 2));
  begin
    perform public.aflp_coop_save(jsonb_build_object('id',c1,'name','QA COOP BROBO','row_version',1));
    res := res || jsonb_build_array(jsonb_build_object('t','02b conflit version','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','02b conflit version refuse','ok', true)); end;

  -- 3. coopérative sans président / sans téléphone : acceptée (données NON COLLECTEES)
  r := public.aflp_coop_save(jsonb_build_object('name','QA COOP SAKASSOU','is_qa',true,'cluster_code','SAKASSOU','payment_model','COOPERATIVE_CONSOLIDATED'));
  c2 := (r->>'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('t','03 coop sans president ni telephone','ok', c2 is not null and
        not exists (select 1 from public.aflp_coop_contacts where cooperative_id = c2)));
  begin
    perform public.aflp_coop_save(jsonb_build_object('name','qa coop  brobo','is_qa',true));
    res := res || jsonb_build_array(jsonb_build_object('t','03b doublon nom coop','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','03b doublon nom coop refuse','ok', true)); end;

  -- 4. responsables (non RT), 5. village, 6. section, point de collecte
  insert into public.aflp_coop_contacts(cooperative_id, role, full_name) values (c1,'MAGASINIER','QA MAGASINIER');
  insert into public.aflp_coop_sections(cooperative_id, name) values (c1,'Section QA 1') returning id into a1;
  insert into public.aflp_coop_villages(cooperative_id, village_id, section_id, declared_producers) values (c1, v1, a1, 95);
  insert into public.aflp_coop_villages(cooperative_id, village_id, declared_producers) values (c1, v2, 70);
  insert into public.aflp_coop_villages(cooperative_id, village_name) values (c1, 'QA LOCALITE HORS REFERENTIEL');
  insert into public.aflp_coop_collection_points(cooperative_id, name, village_id, destination_warehouse_id) values (c1,'PC QA', v1, wh);
  res := res || jsonb_build_array(jsonb_build_object('t','04-06 contacts villages sections','ok',
     (select count(*) from public.aflp_coop_villages where cooperative_id = c1) = 3
     and not exists (select 1 from public.rt where nom = 'QA MAGASINIER')));
  begin
    insert into public.aflp_coop_villages(cooperative_id) values (c1);
    res := res || jsonb_build_array(jsonb_build_object('t','06b village absent','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','06b village absent refuse','ok', true)); end;

  -- 7. ajout producteur nouveau
  r := public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c1,'nom','QA PRODUCTEUR','prenoms','UN','village_id',v1,
        'member_number','QA-0001','section_id',a1,'potentiel_kg',2500,'superficie_ha',3,'sexe','F','birth_year',1995));
  p1 := r->>'producer_id'; m1 := (r->'membership'->>'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('t','07 nouveau producteur via coop','ok', (r->>'created')::boolean
        and (r->'membership'->>'is_primary')::boolean and r->>'farmer_id' is not null, 'farmer_id', r->>'farmer_id'));

  -- 9/10. doublons téléphone et Farmer ID
  begin
    perform public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c1,'nom','QA AUTRE NOM','village_id',v1,'telephone',tel_exist));
    res := res || jsonb_build_array(jsonb_build_object('t','09 doublon telephone','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','09 doublon telephone bloque','ok', sqlerrm like 'DOUBLON_POSSIBLE%')); end;
  select count(*) into n from public.aflp_coop_match_producers(jsonb_build_array(jsonb_build_object('idx',1,'farmer_id',code_exist)));
  res := res || jsonb_build_array(jsonb_build_object('t','10 detection Farmer ID','ok', n >= 1));

  -- 8/13. associer producteur existant (déjà RT) : 16 producteur RT + coop
  r := public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c1,'producer_id',p_exist,'member_number','QA-0002'));
  m2 := (r->'membership'->>'id')::uuid;
  res := res || jsonb_build_array(jsonb_build_object('t','08/13/16 association existant (RT conserve)','ok',
        not (r->>'created')::boolean and (select rt_id from public.producteurs where id = p_exist) is not null
        and (select code from public.producteurs where id = p_exist) = code_exist));
  begin
    perform public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c1,'producer_id',p_exist));
    res := res || jsonb_build_array(jsonb_build_object('t','08b double association','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','08b double association refusee','ok', true)); end;
  begin
    perform public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c1,'nom','QA X','village_id',v1,'member_number','qa-0001 '));
    res := res || jsonb_build_array(jsonb_build_object('t','08c numero membre en double','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','08c numero membre en double refuse','ok', true)); end;

  -- multi-affiliation : seconde coop, affiliation non principale
  r := public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c2,'producer_id',p1));
  res := res || jsonb_build_array(jsonb_build_object('t','A1 multi-coop : 2e affiliation secondaire','ok', not (r->'membership'->>'is_primary')::boolean));
  begin
    perform public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c2,'producer_id',p_exist,'is_primary',true));
    res := res || jsonb_build_array(jsonb_build_object('t','A2 deux principales','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','A2 deux principales refusees','ok', true)); end;

  -- 18/19 calculs potentiel/target sans double comptage
  select count(*) into n from public.aflp_coop_dashboard('2027') d where d.cooperative_id = c1 and d.producers_registered = 2
     and d.farmer_potential_kg = 2500 and d.farmer_potential_missing >= 0 and d.declared_potential_mt = 700 and d.target_mt = 320
     and d.villages_covered = 3 and d.women = 1;
  res := res || jsonb_build_array(jsonb_build_object('t','18/19 potentiel declare vs calcule, target','ok', n = 1));
  r := public.aflp_channel_totals('2027', true);
  res := res || jsonb_build_array(jsonb_build_object('t','A3 totaux canal sans double comptage','ok',
        (r->>'producteurs_total')::int = (r->>'direct_rt')::int + (r->>'cooperatives')::int, 'totaux', r));

  -- 14/15 changement de coop historisé
  r := public.aflp_coop_transfer_member(m2, c2, 'QA test transfert', 'QA-T-01');
  res := res || jsonb_build_array(jsonb_build_object('t','14/15 changement coop historise','ok',
        (select status from public.aflp_coop_memberships where id = m2) = 'ENDED'
        and (select count(*) from public.aflp_coop_memberships where producer_id = p_exist) = 2
        and (r->'nouvelle'->>'is_primary')::boolean));

  -- 20. achat mode A : canal auto COOPERATIVE (coop QA exclue de l'auto-détection -> on force explicitement)
  insert into public.achats(date, village_id, producteur_id, poids_net, prix_kg, montant, created_by, campaign, cooperative_id, rejet)
  values (current_date, v1, p1, 1000, 1, 1000, bm, '2027', c1, false) returning id into a1;
  res := res || jsonb_build_array(jsonb_build_object('t','20 achat mode A trace canal + membre','ok',
        (select sourcing_channel = 'COOPERATIVE' and coop_member_number = 'QA-0001' from public.achats where id = a1)));
  insert into public.achats(date, village_id, producteur_id, poids_net, prix_kg, montant, created_by, campaign, rejet)
  values (current_date, v1, p1, 10, 1, 10, bm, '2027', false) returning id into a1;
  res := res || jsonb_build_array(jsonb_build_object('t','20b coop QA jamais auto-affectee','ok',
        (select sourcing_channel from public.achats where id = a1) = 'AFLP_DIRECT'));

  -- coopérative suspendue : achat au titre de la coop refusé
  perform public.aflp_coop_set_status(c1, 'SUSPENDUE', 'QA test suspension');
  begin
    insert into public.achats(date, village_id, producteur_id, poids_net, created_by, campaign, cooperative_id, rejet)
    values (current_date, v1, p1, 5, bm, '2027', c1, false);
    res := res || jsonb_build_array(jsonb_build_object('t','E1 achat coop suspendue','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','E1 achat coop suspendue refuse','ok', true)); end;
  perform public.aflp_coop_set_status(c1, 'ACTIVE', null);

  -- 21. livraison consolidée sans répartition
  update public.aflp_coop_campaigns set destination_warehouse_id = wh where cooperative_id = c2;
  perform public.aflp_coop_set_status(c2, 'ACTIVE', null);
  r := public.aflp_coop_plan_delivery(jsonb_build_object('cooperative_id',c2,'planned_kg',20000,'planned_date',current_date + 3));
  d1 := (r->>'id')::uuid;
  perform public.aflp_coop_record_delivery(d1, 20000, 250, null, 'RECUE');
  res := res || jsonb_build_array(jsonb_build_object('t','21 livraison sans repartition = A COMPLETER, non tracable','ok',
        (select allocation_status = 'ALLOCATION_A_COMPLETER' and not fully_traceable from public.aflp_coop_delivery_status_v where id = d1)));
  insert into public.aflp_coop_delivery_allocations(delivery_id, producer_id, qty_kg) values (d1, p1, 12000);
  begin
    insert into public.aflp_coop_delivery_allocations(delivery_id, producer_id, qty_kg) values (d1, p_exist, 9000);
    res := res || jsonb_build_array(jsonb_build_object('t','21b sur-allocation','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','21b sur-allocation refusee','ok', true)); end;
  insert into public.aflp_coop_delivery_allocations(delivery_id, producer_id, qty_kg) values (d1, p_exist, 8000);
  res := res || jsonb_build_array(jsonb_build_object('t','21c allocation complete = TRACABLE','ok',
        (select fully_traceable from public.aflp_coop_delivery_status_v where id = d1)));
  begin
    insert into public.aflp_coop_delivery_allocations(delivery_id, producer_id, qty_kg) values (d1, (select id from public.producteurs where not deleted and id not in (p1,p_exist) limit 1), 1);
    res := res || jsonb_build_array(jsonb_build_object('t','21d allocation non-membre','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','21d allocation non-membre refusee','ok', true)); end;

  -- 24. Traceability 360 : coopérative QA exclue de la recherche publique, chaîne JSON lisible
  r := public.aflp_coop_chain(c2);
  res := res || jsonb_build_array(jsonb_build_object('t','24 chaine coop (livraisons)','ok', jsonb_array_length(r->'livraisons') = 1));

  -- 12. import partiellement invalide (ligne sans village, ligne doublon, ligne valide, ligne ignorée)
  r := public.aflp_coop_import_commit(c1, '2027', jsonb_build_array(
        jsonb_build_object('idx',1,'action','CREATE','nom','QA IMPORT UN','village_id',v1),
        jsonb_build_object('idx',2,'action','CREATE','nom','QA IMPORT DEUX'),
        jsonb_build_object('idx',3,'action','CREATE','nom','QA IMPORT TROIS','village_id',v1,'telephone',tel_exist),
        jsonb_build_object('idx',4,'action','SKIP'),
        jsonb_build_object('idx',5,'action','LINK','producer_id',p1)));
  res := res || jsonb_build_array(jsonb_build_object('t','11/12 import partiel : aucune ligne perdue','ok',
        (r->>'lignes')::int = 5 and jsonb_array_length(r->'details') = 5 and (r->>'importes')::int = 1 and (r->>'rejetes')::int = 3
        and (r->>'ignores')::int = 1, 'synthese', r - 'details'));

  -- import 500+ (performance)
  r := public.aflp_coop_import_commit(c2, '2027', (select jsonb_agg(jsonb_build_object('idx',g,'action','CREATE','nom','QA MASSE '||g,
         'prenoms','P'||g,'village_id',v2,'member_number','QA-M-'||g)) from generate_series(1,520) g));
  res := res || jsonb_build_array(jsonb_build_object('t','A4 import 520 lignes','ok', (r->>'importes')::int = 520, 'synthese', r - 'details'));

  -- archivage + suppression physique impossible
  r := public.aflp_coop_archive(c2, 'QA archivage');
  res := res || jsonb_build_array(jsonb_build_object('t','A5 archivage conserve l''historique','ok', (r->>'archived')::boolean
        and (select count(*) from public.aflp_coop_memberships where cooperative_id = c2) > 500));
  -- E2 : aucune politique DELETE + trigger de blocage (la commande destructive elle-même
  -- n'est pas jouée ici : l'outil d'exécution exige une confirmation humaine).
  res := res || jsonb_build_array(jsonb_build_object('t','E2 suppression physique impossible','ok',
        not exists (select 1 from pg_policies where tablename like 'aflp_coop%' and tablename <> 'aflp_coop_delivery_allocations' and cmd in ('DELETE','ALL'))
        and exists (select 1 from pg_trigger where tgname = 'trg_aflp_no_delete' and tgrelid = 'public.aflp_cooperatives'::regclass)));

  -- audit
  res := res || jsonb_build_array(jsonb_build_object('t','A6 audit alimente','ok',
        (select count(*) from public.aflp_coop_audit where cooperative_id = c1) > 5));

  -- ---------------------------------------------------- 30. permissions
  perform set_config('request.jwt.claims', json_build_object('sub', zh, 'role', 'authenticated')::text, true);
  begin
    perform public.aflp_coop_set_status(c1, 'APPROUVEE', null);
    res := res || jsonb_build_array(jsonb_build_object('t','P1 Zonal Head approuve','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','P1 approbation reservee direction','ok', true)); end;
  select count(*) into n from public.aflp_cooperatives where id = c1;
  res := res || jsonb_build_array(jsonb_build_object('t','P2 Zonal Head lit (portee globale)','ok', n = 1));

  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  select count(*) into n from public.aflp_cooperatives where id = c1;
  res := res || jsonb_build_array(jsonb_build_object('t','P3 Supervisor sans perimetre ne voit pas','ok', n = 0));
  begin
    perform public.aflp_coop_add_member(jsonb_build_object('cooperative_id',c1,'nom','QA INTRUS','village_id',v1));
    res := res || jsonb_build_array(jsonb_build_object('t','P4 ecriture hors perimetre','ok', false));
  exception when others then res := res || jsonb_build_array(jsonb_build_object('t','P4 ecriture hors perimetre refusee','ok', true)); end;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into n from public.aflp_cooperatives;
  res := res || jsonb_build_array(jsonb_build_object('t','P5 utilisateur sans profil : rien','ok', n = 0));

  execute 'reset role';
  raise exception 'RESULTATS_QA %', res;
end $t$;
