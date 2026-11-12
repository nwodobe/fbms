-- Données 100 % fictives. Aucun nom, téléphone ou montant réel.
set search_path = public, extensions;
insert into auth.users(id,email) values
 ('a0000000-0000-4000-8000-000000000001','bm@test.invalid'),
 ('a0000000-0000-4000-8000-000000000002','fin@test.invalid'),
 ('a0000000-0000-4000-8000-000000000003','uh-a@test.invalid'),
 ('a0000000-0000-4000-8000-000000000004','auh-a@test.invalid'),
 ('a0000000-0000-4000-8000-000000000005','uh-b@test.invalid'),
 ('a0000000-0000-4000-8000-000000000006','zh@test.invalid'),
 ('a0000000-0000-4000-8000-000000000007','abm@test.invalid'),
 ('a0000000-0000-4000-8000-000000000008','sup@test.invalid'),
 ('a0000000-0000-4000-8000-000000000009','qfs@test.invalid');
insert into public.profils(user_id,email,nom,role,actif,cluster) values
 ('a0000000-0000-4000-8000-000000000001','bm@test.invalid','BM FICTIF','Branch Manager',true,null),
 ('a0000000-0000-4000-8000-000000000002','fin@test.invalid','FINANCE FICTIF','Finance',true,null),
 ('a0000000-0000-4000-8000-000000000003','uh-a@test.invalid','UH A FICTIF','Unit Head',true,'CLUSTER-A'),
 ('a0000000-0000-4000-8000-000000000004','auh-a@test.invalid','AUH A FICTIF','Assistant Unit Head',true,'CLUSTER-A'),
 ('a0000000-0000-4000-8000-000000000005','uh-b@test.invalid','UH B FICTIF','Unit Head',true,'CLUSTER-B'),
 ('a0000000-0000-4000-8000-000000000006','zh@test.invalid','ZH FICTIF','Zonal Head',true,null),
 ('a0000000-0000-4000-8000-000000000007','abm@test.invalid','ABM FICTIF','Assistant Branch Manager',true,null),
 ('a0000000-0000-4000-8000-000000000008','sup@test.invalid','SUP FICTIF','Supervisor',true,null),
 ('a0000000-0000-4000-8000-000000000009','qfs@test.invalid','QFS FICTIF','QA / Lab',true,null);
-- Campagne réelle (même type/année que « 0002 » en production) et campagne de simulation distincte.
insert into public.campaigns(id,code,name,year,campaign_type,status,is_current) values
 ('c0000000-0000-4000-8000-00000000000a','0002','REELLE FICTIVE',2027,'REAL','OPEN',true),
 ('c0000000-0000-4000-8000-00000000000b','2027','SIMULATION FICTIVE',2027,'SIMULATION','OPEN',false);
insert into public.villages(id,data,village,cluster,cluster_code) values
 ('V-A1','{}','VILLAGE A1','CLUSTER-A','CLUSTER-A'),
 ('V-A2','{}','VILLAGE A2','CLUSTER-A','CLUSTER-A'),
 ('V-B1','{}','VILLAGE B1','CLUSTER-B','CLUSTER-B');
insert into public.rt(id,data,nom,village_id,village_nom,cluster,statut) values
 ('RT-A1','{}','RT A1 FICTIF','V-A1','VILLAGE A1','CLUSTER-A','Actif'),
 ('RT-A2','{}','RT A2 FICTIF','V-A2','VILLAGE A2','CLUSTER-A','Actif'),
 ('RT-B1','{}','RT B1 FICTIF','V-B1','VILLAGE B1','CLUSTER-B','Actif');
insert into public.wms_warehouses(id,site_code,code,name) values
 ('d0000000-0000-4000-8000-000000000001','BKE','WH-T1','MAGASIN TEST');
