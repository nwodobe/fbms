-- Jeu d'essai FICTIF pour la replique locale. Aucune donnee reelle.
-- Charge en superutilisateur ; l'identite JWT du BM fictif est posee pour
-- satisfaire les gardes (rcn_jute_guard, audit) comme en production.
insert into public.aflp_zones(code,label) values ('GBEKE_1','GBEKE 1'),('GBEKE_2','GBEKE 2');
insert into public.aflp_clusters(code,label,zone_code,aliases) values
 ('BOTRO','Botro','GBEKE_2','{BOTRO}'), ('DIABO','Diabo','GBEKE_2','{DIABO}'),
 ('DJEBONOUA','Djébonoua','GBEKE_1','{DJEBONOUA,N''DJEBONOUA,DJEBONOU,DJEBONOA}');

-- Comptes de test (uuid lisibles). fonction_operationnelle NULL partout,
-- comme les 3 comptes reels releves en production le 18/09/2026, sauf
-- t_fo_sans qui illustre la dualite role / fonction_operationnelle.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000b1','bm@test.invalid'),
 ('00000000-0000-0000-0000-0000000000a1','zh@test.invalid'),
 ('00000000-0000-0000-0000-0000000000f1','fboo@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','uh.botro@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c2','uh.diabo@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d1','sk.botro@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d2','sk.diabo@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d3','sk.sans.cluster@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d4','sk.inactif@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d5','sk.global@test.invalid'),
 ('00000000-0000-0000-0000-0000000000e1','supervisor@test.invalid'),
 ('00000000-0000-0000-0000-0000000000e2','fo.sans.cluster@test.invalid'),
 ('00000000-0000-0000-0000-0000000000e3','nouveau@test.invalid');
insert into public.profils(user_id,email,nom,role,actif,cluster,zone,authority_level,fonction_operationnelle,permissions) values
 ('00000000-0000-0000-0000-0000000000b1','bm@test.invalid','Test BM','Branch Manager',true,null,null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000a1','zh@test.invalid','Test Zonal Head','Zonal Head',true,null,null,'ZONE',null,'{}'),
 ('00000000-0000-0000-0000-0000000000f1','fboo@test.invalid','Test FBOO','Field Buying Operations Officer',true,null,null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000c1','uh.botro@test.invalid','Test UH Botro','Unit Head',true,'BOTRO','GBEKE_2',null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000c2','uh.diabo@test.invalid','Test UH Diabo','Unit Head',true,'Diabo','GBEKE_2',null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000d1','sk.botro@test.invalid','Test Magasinier Botro','Storekeeper',true,'Botro',null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000d2','sk.diabo@test.invalid','Test Magasinier Diabo','Storekeeper',true,'DIABO',null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000d3','sk.sans.cluster@test.invalid','Test Magasinier sans cluster','Storekeeper',true,null,null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000d4','sk.inactif@test.invalid','Test Magasinier inactif','Storekeeper',false,'BOTRO',null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000d5','sk.global@test.invalid','Test Magasinier global','Storekeeper',true,null,null,'GLOBAL',null,'[]'),
 ('00000000-0000-0000-0000-0000000000e1','supervisor@test.invalid','Test Supervisor','Supervisor',true,null,null,null,null,'[]'),
 ('00000000-0000-0000-0000-0000000000e2','fo.sans.cluster@test.invalid','Test fonction op sans cluster','Supervisor',true,null,null,null,'Warehouse Keeper','[]'),
 ('00000000-0000-0000-0000-0000000000e3','nouveau@test.invalid','Test compte a qualifier','Consultation uniquement',true,null,null,null,null,'[]');

insert into public.rt(id,data,nom,village_id,cluster,statut) values
 ('RT-TB1','{}','RT test Botro 1','V-TB1','BOTRO','Actif'),
 ('RT-TD1','{}','RT test Diabo 1','V-TD1','DIABO','Actif');
insert into public.producteurs(id,data,nom,village_id,rt_id) values ('PR-TB1','{}','Producteur test','V-TB1','RT-TB1');
insert into public.rcn_jute_settings(id) values ('DEFAULT');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
insert into public.rcn_jute_locations(code,site_code,warehouse_code,nom,type,actif,scope_type,cluster,rt_id) values
 ('AFLP-CL-BOTRO','BOTRO','CLUSTER','Cluster Botro','STOCK',true,'CLUSTER','BOTRO',null),
 ('AFLP-CL-DIABO','DIABO','CLUSTER','Cluster Diabo','STOCK',true,'CLUSTER','DIABO',null),
 ('AFLP-RT-RT-TB1','BOTRO','RT','RT test Botro 1','STOCK',true,'RT','BOTRO','RT-TB1'),
 ('AFLP-FACTORY-YAMOUSSOUKRO','GLOBAL','FACTORY','Factory test','STOCK',true,'FACTORY',null,null),
 ('JUTE-TRANSIT','GLOBAL','TRANSIT','Sacherie en transit','TRANSIT',true,'TRANSIT',null,null);
insert into public.rcn_jute_movements(id,event_key,movement_type,ledger,qty,to_location,to_state,reference,cluster)
values ('T-SI-1','T-SI-1','SOLDE_INITIAL','INTERNE',1000,'AFLP-CL-BOTRO','UTILISABLE','solde test','BOTRO'),
       ('T-SI-2','T-SI-2','SOLDE_INITIAL','INTERNE',1000,'AFLP-CL-DIABO','UTILISABLE','solde test','DIABO'),
       ('T-SI-3','T-SI-3','SOLDE_INITIAL','INTERNE',100,'AFLP-RT-RT-TB1','UTILISABLE','solde test','BOTRO');
-- Circuit legacy : entree usine -> cluster (sacs_mouvements) et cycle finance ouvert
insert into public.sacs_mouvements(local_id,type,source,destination,cluster,quantite,created_by)
values ('T-LEG-USINE-1','USINE_CLUSTER','USINE','CLUSTER','BOTRO',500,'00000000-0000-0000-0000-0000000000b1');
insert into public.avances(local_id,cluster,rt_id,montant,cycle_id,volume_finance_kg,cycle_statut)
values ('T-AV-1','BOTRO','RT-TB1',1000000,'CY-T1',8000,'OPEN');
select set_config('request.jwt.claims','', false);
