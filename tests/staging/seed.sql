-- Synthetic FBMS data for local ephemeral staging only.
\set ON_ERROR_STOP on

-- Fixed UUIDs make tests deterministic.
insert into public.profils(user_id,email,nom,role,actif,fonction_operationnelle,cluster,zone,authority_level)
values
('00000000-0000-0000-0000-000000000001','test_bm@fbms.local','TEST Branch Manager','Branch Manager',true,'Branch Manager',null,null,'GLOBAL'),
('00000000-0000-0000-0000-000000000002','test_sup_a@fbms.local','TEST Supervisor A','Supervisor',true,'Unit Head','TEST_CLUSTER_A','TEST_ZONE_A','CLUSTER'),
('00000000-0000-0000-0000-000000000003','test_agent_a@fbms.local','TEST Agent A','Agent Recenseur',true,null,'TEST_CLUSTER_A','TEST_ZONE_A','VILLAGE'),
('00000000-0000-0000-0000-000000000004','test_agent_b@fbms.local','TEST Agent B','Agent Recenseur',true,null,'TEST_CLUSTER_B','TEST_ZONE_B','VILLAGE'),
('00000000-0000-0000-0000-000000000005','test_inactive@fbms.local','TEST Inactive','Agent Recenseur',false,null,'TEST_CLUSTER_A','TEST_ZONE_A','VILLAGE')
on conflict (user_id) do update set role=excluded.role,actif=excluded.actif,cluster=excluded.cluster,zone=excluded.zone;

insert into public.villages(id,data,village,region,departement,score,statut,cluster,gps_lat,gps_lng,created_by)
values
('TEST_VILLAGE_A1','{"s1":{"cluster":"TEST_CLUSTER_A"}}','TEST Village A1','TEST_REGION','TEST_DEPT',90,'Approuvé BM','TEST_CLUSTER_A',7.690,-5.030,'test_seed'),
('TEST_VILLAGE_A2','{"s1":{"cluster":"TEST_CLUSTER_A"}}','TEST Village A2','TEST_REGION','TEST_DEPT',85,'Approuvé BM','TEST_CLUSTER_A',7.700,-5.040,'test_seed'),
('TEST_VILLAGE_B1','{"s1":{"cluster":"TEST_CLUSTER_B"}}','TEST Village B1','TEST_REGION','TEST_DEPT',80,'Approuvé BM','TEST_CLUSTER_B',7.710,-5.050,'test_seed')
on conflict (id) do nothing;

insert into public.rt(id,data,nom,telephone,village_id,village_nom,statut,score,cluster,id_rt,created_by)
values
('TEST_RT_A1','{}','TEST RT A1','0700000001','TEST_VILLAGE_A1','TEST Village A1','Actif',90,'TEST_CLUSTER_A','RT-TA1-01','test_seed'),
('TEST_RT_A2','{}','TEST RT A2','0700000002','TEST_VILLAGE_A2','TEST Village A2','Actif',85,'TEST_CLUSTER_A','RT-TA2-01','test_seed'),
('TEST_RT_B1','{}','TEST RT B1','0700000003','TEST_VILLAGE_B1','TEST Village B1','Actif',80,'TEST_CLUSTER_B','RT-TB1-01','test_seed')
on conflict (id) do nothing;

update public.profils set village_id='TEST_VILLAGE_A1',rt_id='TEST_RT_A1' where user_id='00000000-0000-0000-0000-000000000003';
update public.profils set village_id='TEST_VILLAGE_B1',rt_id='TEST_RT_B1' where user_id='00000000-0000-0000-0000-000000000004';

insert into public.equipes(id,nom,chef_user_id,cluster,statut)
values
('10000000-0000-0000-0000-000000000001','TEST Equipe A','00000000-0000-0000-0000-000000000002','TEST_CLUSTER_A','active'),
('10000000-0000-0000-0000-000000000002','TEST Equipe B',null,'TEST_CLUSTER_B','active')
on conflict (id) do nothing;

insert into public.missions(id,equipe_id,date_debut,date_fin,budget_alloue_xof,objectif_enrolements,statut,approuve_par,approuve_le,created_by)
values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',current_date,current_date+7,500000,100,'approuvee','00000000-0000-0000-0000-000000000001',now(),'00000000-0000-0000-0000-000000000001'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',current_date,current_date+7,400000,80,'approuvee','00000000-0000-0000-0000-000000000001',now(),'00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.mission_villages(id,mission_id,village_id,ordre,objectif_enrolements)
values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A1',1,50),
('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A2',2,50),
('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','TEST_VILLAGE_B1',1,80)
on conflict (id) do nothing;

insert into public.producteurs(id,data,code,nom,telephone,village_id,village_nom,rt_id,statut,mission_id,gps_lat,gps_lng,created_by,created_by_user_id)
values
('TEST_PRODUCTEUR_A1','{"source":"TEST"}','TEST-PROD-A1','TEST Producteur A1','0701000001','TEST_VILLAGE_A1','TEST Village A1','TEST_RT_A1','Enrôlé','20000000-0000-0000-0000-000000000001',7.691,-5.031,'test_agent_a@fbms.local','00000000-0000-0000-0000-000000000003'),
('TEST_PRODUCTEUR_B1','{"source":"TEST"}','TEST-PROD-B1','TEST Producteur B1','0701000002','TEST_VILLAGE_B1','TEST Village B1','TEST_RT_B1','Enrôlé','20000000-0000-0000-0000-000000000002',7.711,-5.051,'test_agent_b@fbms.local','00000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

insert into public.avances(id,local_id,date,cluster,rt_id,rt_nom,source,montant,motif,statut,cycle_id,volume_finance_kg,prix_reference_kg,cycle_statut,created_by,created_by_nom)
values
('40000000-0000-0000-0000-000000000001','TEST_ADV_A1',current_date,'TEST_CLUSTER_A','TEST_RT_A1','TEST RT A1','Finance',500000,'TEST financement','Active','TEST_CYCLE_A1',1000,500,'OPEN','00000000-0000-0000-0000-000000000001','TEST BM')
on conflict (id) do nothing;

insert into public.achats(id,local_id,date,cluster,village_id,village_nom,rt_id,rt_nom,producteur_id,producteur_nom,poids_brut,tare,poids_net,prix_kg,montant,mode_paiement,numero_recu,nb_sacs,humidite,kor,commission_rt,bonus_diff,cycle_id,created_by,created_by_nom)
values
('50000000-0000-0000-0000-000000000001','TEST_ACHAT_A1',current_date,'TEST_CLUSTER_A','TEST_VILLAGE_A1','TEST Village A1','TEST_RT_A1','TEST RT A1','TEST_PRODUCTEUR_A1','TEST Producteur A1',105,5,100,500,50000,'WAVE','TEST-REC-001',1,8.5,48,1000,500,'TEST_CYCLE_A1','00000000-0000-0000-0000-000000000003','TEST Agent A')
on conflict (id) do nothing;

insert into public.sacs_mouvements(id,local_id,date,type,source,destination,cluster,village_id,village_nom,rt_id,rt_nom,quantite,observation,bag_movement_code,business_status,created_by,created_by_nom)
values
('60000000-0000-0000-0000-000000000001','TEST_SAC_A1',current_date,'RECEPTION','ANAGROCI','CLUSTER','TEST_CLUSTER_A','TEST_VILLAGE_A1','TEST Village A1','TEST_RT_A1','TEST RT A1',20,'TEST stock initial','TEST-BAG-001','EXECUTED','00000000-0000-0000-0000-000000000001','TEST BM')
on conflict (id) do nothing;

insert into public.preuves(id,entite_type,entite_id,type_preuve,storage_path,horodatage_client,sha256,created_by)
values
('70000000-0000-0000-0000-000000000001','producteur','TEST_PRODUCTEUR_A1','photo','TEST/producer-a1.jpg',now(),'TEST_SHA_A1','00000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.sessions_formation(id,mission_id,village_id,theme,date_session,participants_hommes,participants_femmes,attestant_nom,attestant_qualite,created_by)
values
('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A1','TEST Formation',current_date,10,5,'TEST Chef','chef_village','00000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.depenses_mission(id,mission_id,village_id,code_gl,libelle,montant_xof,preuve_id,created_by)
values
('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A1','6241','TEST CARBURANT',25000,'70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.checkins(id,mission_id,village_id,type,gps_lat,gps_lng,gps_precision_m,horodatage_client,user_id)
values
('a0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A1','in',7.691,-5.031,8,now(),'00000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

select 'FBMS_STAGING_SEED_READY' as status;
