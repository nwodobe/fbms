-- =============================================================================
-- Banc Assistant Unit Head · scénarios d'acceptation (mandat §9)
-- psql -v phase=APRES|REJEU -f 03_scenarios.sql
-- Chaque scénario s'exécute SOUS LE RÔLE authenticated avec le « sub » JWT du
-- compte testé : RLS, déclencheurs et fonctions SECURITY DEFINER s'appliquent
-- exactement comme pour un appel API (PostgREST) ou RPC.
-- Données 100 % synthétiques (préfixe ZZAUH / zzauh-). Aucune donnée réelle.
-- =============================================================================
create table if not exists public.zz_resultats_auh(phase text, id text, bloc text, fonction text, compte text,
  attendu text, obtenu text, statut text, at timestamptz default clock_timestamp());

select set_config('banc.phase', :'phase', false);

do $banc$
declare
  ph text := current_setting('banc.phase');
  pc text := case current_setting('banc.phase') when 'APRES' then 'AP' else 'RJ' end;
  bm uuid := '00000000-0000-4000-9000-000000000001'; abm uuid := '00000000-0000-4000-9000-000000000002';
  zh uuid := '00000000-0000-4000-9000-000000000003'; uhb uuid := '00000000-0000-4000-9000-000000000004';
  uhr uuid := '00000000-0000-4000-9000-000000000005'; a uuid := '00000000-0000-4000-9000-000000000006';
  b uuid := '00000000-0000-4000-9000-000000000007'; c uuid := '00000000-0000-4000-9000-000000000008';
  x uuid := '00000000-0000-4000-9000-000000000009';
  nouv uuid := case current_setting('banc.phase') when 'APRES' then '00000000-0000-4000-9000-00000000000a'::uuid else '00000000-0000-4000-9000-00000000000c'::uuid end;
  nouv2 uuid := case current_setting('banc.phase') when 'APRES' then '00000000-0000-4000-9000-00000000000b'::uuid else '00000000-0000-4000-9000-00000000000d'::uuid end;
  camp text := 'c5b19a48-de65-464a-892b-a2b2c76acdaa';
  lease uuid := case current_setting('banc.phase') when 'APRES' then '00000000-0000-4000-a000-0000000000a1'::uuid else '00000000-0000-4000-a000-0000000000a2'::uuid end;
  dev uuid := case current_setting('banc.phase') when 'APRES' then '00000000-0000-4000-a000-0000000000d1'::uuid else '00000000-0000-4000-a000-0000000000d2'::uuid end;
  k1 uuid := case current_setting('banc.phase') when 'APRES' then '00000000-0000-4000-a000-0000000000f1'::uuid else '00000000-0000-4000-a000-0000000000f2'::uuid end;
  sc record; n bigint; msg text; q text;
begin
  -- ---------------------------------------------- jeu d'essai de la phase
  update public.profils set cluster='BOTRO' where user_id=b;           -- E10 l'aura déplacé
  update public.profils set actif=true where user_id=x;                -- F01 l'aura désactivé
  insert into auth.users(id,email) values (nouv,'zzauh.nouveau.'||lower(ph)||'@example.test'),(nouv2,'zzauh.nouveau2.'||lower(ph)||'@example.test') on conflict do nothing;
  insert into public.villages(id,village,cluster,statut,data,farmer_code_prefix) values
    ('zzauh-'||ph||'-vbo','ZZAUH '||ph||' BOTRO','BOTRO','Brouillon','{"s1":{"cluster":"Botro","village":"ZZAUH"}}','Z'||pc||'BO'),
    ('zzauh-'||ph||'-vbocor','ZZAUH '||ph||' BOTRO COR','BOTRO','À corriger','{"s1":{"cluster":"Botro","village":"ZZAUH"}}','Z'||pc||'BC'),
    ('zzauh-'||ph||'-vbook','ZZAUH '||ph||' BOTRO OK','BOTRO','Approuvé BM','{"s1":{"cluster":"Botro","village":"ZZAUH"}}','Z'||pc||'BK'),
    ('zzauh-'||ph||'-vbosoum','ZZAUH '||ph||' BOTRO SOUMIS','BOTRO','Soumis','{"s1":{"cluster":"Botro","village":"ZZAUH"}}','Z'||pc||'BS'),
    ('zzauh-'||ph||'-vbr','ZZAUH '||ph||' BROBO','BROBO','Brouillon','{"s1":{"cluster":"Brobo","village":"ZZAUH"}}','Z'||pc||'BR'),
    ('zzauh-'||ph||'-vdi','ZZAUH '||ph||' DIABO','DIABO','Brouillon','{"s1":{"cluster":"Diabo","village":"ZZAUH"}}','Z'||pc||'DI');
  insert into public.rt(id,nom,village_id,statut,created_by,data) values
    ('zzauh-'||ph||'-rtbouh','ZZAUH RT UH','zzauh-'||ph||'-vbo','Pressenti','zzauh.uh.botro@example.test','{}'),
    ('zzauh-'||ph||'-rtboa','ZZAUH RT A','zzauh-'||ph||'-vbo','Pressenti','zzauh.auh.botro.a@example.test','{}'),
    ('zzauh-'||ph||'-rtboactif','ZZAUH RT ACTIF','zzauh-'||ph||'-vbo','Actif','zzauh.uh.botro@example.test','{}'),
    ('zzauh-'||ph||'-rtbr','ZZAUH RT BROBO','zzauh-'||ph||'-vbr','Pressenti','zzauh.uh.brobo@example.test','{}');
  insert into public.producteurs(id,nom,prenoms,village_id,statut,data) values
    ('zzauh-'||ph||'-pbo','ZZAUH','PBO','zzauh-'||ph||'-vbo','Identifié','{}'),
    ('zzauh-'||ph||'-pboactif','ZZAUH','PBOACTIF','zzauh-'||ph||'-vbo','Actif','{}'),
    ('zzauh-'||ph||'-pbr','ZZAUH','PBR','zzauh-'||ph||'-vbr','Identifié','{}');
  insert into public.achats(id,cluster,village_id,rt_id,poids_net,prix_kg,montant,created_by) values
    (gen_random_uuid(),'BOTRO','zzauh-'||ph||'-vbo','zzauh-'||ph||'-rtbouh',100,300,30000,uhb),
    (gen_random_uuid(),'BROBO','zzauh-'||ph||'-vbr','zzauh-'||ph||'-rtbr',100,300,30000,uhr);
  insert into public.avances(cluster,rt_id,montant,motif,created_by) values
    ('BOTRO','zzauh-'||ph||'-rtbouh',50000,'ZZAUH '||ph,bm),('BROBO','zzauh-'||ph||'-rtbr',50000,'ZZAUH '||ph,bm);
  insert into public.aflp_incidents(cluster_code,village_id,description,severity) values ('BROBO','zzauh-'||ph||'-vbr','ZZAUH incident Brobo','LOW');
  insert into public.sacs_mouvements(type,cluster,village_id,qty,created_by) values ('RECEPTION','BROBO','zzauh-'||ph||'-vbr',10,uhr);
  insert into public.reconciliations(cluster,statut,created_by) values ('BROBO','ZZAUH',uhr);
  insert into public.depenses_mission(village_id,montant_xof,statut_validation,created_by) values ('zzauh-'||ph||'-vbr',5000,'soumise',bm);
  insert into private.offline_device_leases(lease_token,campaign_id,rt_id,user_id,device_id,valid_until)
    values (lease,camp::uuid,'zzauh-'||ph||'-rtbouh',a,dev,now()+interval '1 day');

  for sc in select * from (values
  -- =========== Scénario 1 : Assistant Botro dans son périmètre
    ('S1-01','S1 Botro','Lire un village de son cluster','AUH Botro A','OK',a,$q$select 1 from public.villages where id='zzauh-%P%-vbo'$q$),
    ('S1-02','S1 Botro','Créer un village (Brouillon)','AUH Botro A','OK',a,$q$insert into public.villages(id,village,cluster,data) values ('zzauh-%P%-va1','ZZAUH %P% A1','Botro','{"s1":{"cluster":"Botro","village":"ZZAUH %P% A1"}}')$q$),
    ('S1-03','S1 Botro','Modifier une fiche village','AUH Botro A','OK',a,$q$update public.villages set data = data || '{"s3":{"nbProducteurs":12}}' where id='zzauh-%P%-vbo'$q$),
    ('S1-04','S1 Botro','Validation terrain : Brouillon → Soumis','AUH Botro A','OK',a,$q$update public.villages set statut='Soumis' where id='zzauh-%P%-vbo'$q$),
    ('S1-05','S1 Botro','Correction demandée : À corriger → Soumis','AUH Botro A','OK',a,$q$update public.villages set statut='Soumis' where id='zzauh-%P%-vbocor'$q$),
    ('S1-06','S1 Botro','Enregistrer un producteur','AUH Botro A','OK',a,$q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzauh-%P%-pa1','ZZAUH','PA1','zzauh-%P%-vbo','{}')$q$),
    ('S1-07','S1 Botro','Corriger un producteur','AUH Botro A','OK',a,$q$update public.producteurs set telephone='070000%PN%' where id='zzauh-%P%-pbo'$q$),
    ('S1-08','S1 Botro','Validation terrain producteur : Identifié → Enrôlé','AUH Botro A','OK',a,$q$update public.producteurs set statut='Enrôlé' where id='zzauh-%P%-pbo'$q$),
    ('S1-09','S1 Botro','Enregistrer une parcelle et sa superficie','AUH Botro A','OK',a,$q$insert into public.farmer_plots(id,producteur_id,village_id,local_name,declared_area,area_unit,status,created_by) values (gen_random_uuid(),'zzauh-%P%-pbo','zzauh-%P%-vbo','ZZAUH P1',1.5,'HA','ACTIVE',auth.uid())$q$),
    ('S1-10','S1 Botro','Consulter la parcelle','AUH Botro A','OK',a,$q$select 1 from public.farmer_plots where producteur_id='zzauh-%P%-pbo'$q$),
    ('S1-11','S1 Botro','Enregistrer un RT','AUH Botro A','OK',a,$q$insert into public.rt(id,nom,village_id,created_by,data) values ('zzauh-%P%-rta1','ZZAUH RT A1','zzauh-%P%-vbo',public.fbms_email(),'{}')$q$),
    ('S1-12','S1 Botro','Modifier un RT','AUH Botro A','OK',a,$q$update public.rt set telephone='0700000002' where id='zzauh-%P%-rtbouh'$q$),
    ('S1-13','S1 Botro','Validation terrain RT (créé par le UH) : Pressenti → Confirmé','AUH Botro A','OK',a,$q$update public.rt set statut='Confirmé' where id='zzauh-%P%-rtbouh'$q$),
    ('S1-14','S1 Botro','Saisir un achat RCN (statut À valider)','AUH Botro A','OK',a,$q$with i as (insert into public.achats(cluster,village_id,rt_id,poids_net,prix_kg,montant,created_by) values ('BOTRO','zzauh-%P%-vbo','zzauh-%P%-rtbouh',50,300,15000,auth.uid()) returning statut_validation) select 1 from i where statut_validation='À valider'$q$),
    ('S1-15','S1 Botro','Signaler une anomalie (RPC)','AUH Botro A','OK',a,$q$select 1 from public.aflp_declare_incident('{"village_id":"zzauh-%P%-vbo","description":"ZZAUH anomalie Botro","severity":"LOW","incident_type":"AUTRE"}'::jsonb)$q$),
    ('S1-16','S1 Botro','Anomalie sans localisation rattachée à son cluster','AUH Botro A','OK',a,$q$drop table if exists zz_r; create temp table zz_r as select public.aflp_declare_incident('{"description":"ZZAUH anomalie sans lieu","severity":"LOW","incident_type":"AUTRE"}'::jsonb) j; select 1 from zz_r r join public.aflp_incidents i on i.id=r.j->>'id' where i.cluster_code='BOTRO' and i.zone_code='GBEKE_2'$q$),
    ('S1-17','S1 Botro','Sacherie : lecture de son cluster, sans mouvement physique','AUH Botro A','OK',a,$q$select 1 where private.sacherie_contexte()->>'lecture'='CLUSTER' and private.sacherie_contexte()->>'cluster'='BOTRO' and private.sacherie_contexte()->>'ecriture' is null$q$),
    ('S1-18','S1 Botro','Renseigner un mouvement de sacs (historique) de son cluster','AUH Botro A','OK',a,$q$insert into public.sacs_mouvements(type,cluster,village_id,qty,created_by) values ('RECEPTION','BOTRO','zzauh-%P%-vbo',5,auth.uid())$q$),
    ('S1-19','S1 Botro','Créer une réconciliation de son cluster','AUH Botro A','OK',a,$q$insert into public.reconciliations(cluster,statut,created_by) values ('BOTRO','BROUILLON',auth.uid())$q$),
    ('S1-20','S1 Botro','Tableau de bord : compteurs limités à son cluster','AUH Botro A','OK',a,$q$select 1 where (select count(*) from public.achats where cluster<>'BOTRO')=0 and (select count(*) from public.achats where cluster='BOTRO')>0 and (select count(*) from public.villages where coalesce(cluster_code,cluster)<>'BOTRO')=0 and (select count(*) from public.avances where cluster<>'BOTRO')=0$q$),
  -- =========== Scénario 2 : hors périmètre (Brobo), API et requête directe
    ('S2-01','S2 Hors périmètre','Lire un village de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.villages where id='zzauh-%P%-vbr'$q$),
    ('S2-02','S2 Hors périmètre','Modifier un village de Brobo','AUH Botro A','REFUS',a,$q$update public.villages set data = data || '{"s3":{"nbProducteurs":99}}' where id='zzauh-%P%-vbr'$q$),
    ('S2-03','S2 Hors périmètre','Déplacer son village vers Brobo','AUH Botro A','REFUS',a,$q$update public.villages set cluster='BROBO', cluster_code='BROBO', data=jsonb_set(data,'{s1,cluster}','"Brobo"') where id='zzauh-%P%-vbo'$q$),
    ('S2-04','S2 Hors périmètre','Créer un village à Brobo','AUH Botro A','REFUS',a,$q$insert into public.villages(id,village,cluster,data) values ('zzauh-%P%-va2','ZZAUH %P% A2','Brobo','{"s1":{"cluster":"Brobo","village":"A2"}}')$q$),
    ('S2-05','S2 Hors périmètre','Lire un RT de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.rt where id='zzauh-%P%-rtbr'$q$),
    ('S2-06','S2 Hors périmètre','Modifier un RT de Brobo','AUH Botro A','REFUS',a,$q$update public.rt set telephone='0700000003' where id='zzauh-%P%-rtbr'$q$),
    ('S2-07','S2 Hors périmètre','Créer un RT dans un village de Brobo','AUH Botro A','REFUS',a,$q$insert into public.rt(id,nom,village_id,data) values ('zzauh-%P%-rta2','ZZAUH RT A2','zzauh-%P%-vbr','{}')$q$),
    ('S2-08','S2 Hors périmètre','Lire un producteur de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.producteurs where id='zzauh-%P%-pbr'$q$),
    ('S2-09','S2 Hors périmètre','Modifier un producteur de Brobo','AUH Botro A','REFUS',a,$q$update public.producteurs set prenoms='PIRATE' where id='zzauh-%P%-pbr'$q$),
    ('S2-10','S2 Hors périmètre','Enregistrer un producteur à Brobo','AUH Botro A','REFUS',a,$q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzauh-%P%-pa2','ZZAUH','PA2','zzauh-%P%-vbr','{}')$q$),
    ('S2-11','S2 Hors périmètre','Lire un achat de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.achats where cluster='BROBO'$q$),
    ('S2-12','S2 Hors périmètre','Saisir un achat à Brobo','AUH Botro A','REFUS',a,$q$insert into public.achats(cluster,village_id,poids_net,prix_kg,montant,created_by) values ('BROBO','zzauh-%P%-vbr',10,300,3000,auth.uid())$q$),
    ('S2-13','S2 Hors périmètre','Achat déclaré Botro mais village de Brobo','AUH Botro A','REFUS',a,$q$insert into public.achats(cluster,village_id,poids_net,prix_kg,montant,created_by) values ('BOTRO','zzauh-%P%-vbr',10,300,3000,auth.uid())$q$),
    ('S2-14','S2 Hors périmètre','Lire une avance de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.avances where cluster='BROBO'$q$),
    ('S2-15','S2 Hors périmètre','Lire une anomalie de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.aflp_incidents where cluster_code='BROBO'$q$),
    ('S2-16','S2 Hors périmètre','Déclarer une anomalie à Brobo (RPC privilégiée)','AUH Botro A','REFUS',a,$q$select 1 from public.aflp_declare_incident('{"cluster":"Brobo","description":"ZZAUH tentative Brobo","severity":"LOW","incident_type":"AUTRE"}'::jsonb)$q$),
    ('S2-17','S2 Hors périmètre','Lire les sacs de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.sacs_mouvements where cluster='BROBO'$q$),
    ('S2-18','S2 Hors périmètre','Lire les réconciliations de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.reconciliations where cluster='BROBO'$q$),
    ('S2-19','S2 Hors périmètre','Lire les dépenses de mission de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.depenses_mission where village_id='zzauh-%P%-vbr'$q$),
    ('S2-20','S2 Hors périmètre','Recherche par nom : aucun autre cluster ne remonte','AUH Botro A','REFUS',a,$q$select 1 from public.villages where village ilike 'ZZAUH%' and coalesce(cluster_code,cluster)<>'BOTRO'$q$),
    ('S2-21','S2 Hors périmètre','Hors ligne : enrôler un producteur à Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FARMER_ENROLL','payload',jsonb_build_object('row',jsonb_build_object('nom','ZZAUH OFF BR %P%','village_id','zzauh-%P%-vbr'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('S2-22','S2 Hors périmètre','Hors ligne : GPS d''un producteur de Brobo','AUH Botro A','REFUS',a,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FIELD_GPS_UPDATE','payload',jsonb_build_object('row',jsonb_build_object('producteur_id','zzauh-%P%-pbr','gps_lat','7.1','gps_lng','-5.1'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('S2-23','S2 Hors périmètre','Hors ligne : achat Brobo avec bail d''appareil Botro','AUH Botro A','REFUS',a,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id','%D%','campaign_id','%C%','operation_type','FIELD_PURCHASE_CREATE','created_at_client',now(),'payload',jsonb_build_object('lease_token','%L%','row',jsonb_build_object('local_id','zzauh-%P%-offbr','date',current_date,'cluster','BROBO','village_id','zzauh-%P%-vbr','rt_id','zzauh-%P%-rtbouh','poids_net',100,'prix_kg',300,'montant',30000,'weight_source','SCALE'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('S2-24','S2 Hors périmètre','Sacherie : agir sur l''emplacement de Brobo','AUH Botro A','REFUS',a,$q$select private.sacherie_exiger_cluster('BROBO', false, 'consulter Brobo')$q$),
  -- =========== Scénario 3 : séparation créateur / validateur
    ('S3-01','S3 Séparation','Confirmer un RT qu''il a lui-même enregistré','AUH Botro A','REFUS',a,$q$update public.rt set statut='Confirmé' where id='zzauh-%P%-rtboa'$q$),
    ('S3-02','S3 Séparation','Créer directement un RT « Confirmé »','AUH Botro A','REFUS',a,$q$insert into public.rt(id,nom,village_id,statut,data) values ('zzauh-%P%-rta3','ZZAUH RT A3','zzauh-%P%-vbo','Confirmé','{}')$q$),
    ('S3-03','S3 Séparation','Un autre assistant confirme ce RT (quatre yeux)','AUH Botro B','OK',b,$q$update public.rt set statut='Confirmé' where id='zzauh-%P%-rtboa'$q$),
    ('S3-04','S3 Séparation','Approuver un village (Approuvé BM)','AUH Botro A','REFUS',a,$q$update public.villages set statut='Approuvé BM' where id='zzauh-%P%-vbosoum'$q$),
    ('S3-05','S3 Séparation','Créer un village directement approuvé','AUH Botro A','REFUS',a,$q$insert into public.villages(id,village,cluster,statut,data) values ('zzauh-%P%-va4','ZZAUH %P% A4','Botro','Approuvé BM','{"s1":{"cluster":"Botro","village":"A4"}}')$q$),
    ('S3-06','S3 Séparation','Renvoyer une fiche approuvée en Brouillon','AUH Botro A','REFUS',a,$q$update public.villages set statut='Brouillon' where id='zzauh-%P%-vbook'$q$),
    ('S3-07','S3 Séparation','Rejeter une fiche (décision hiérarchique)','AUH Botro A','REFUS',a,$q$update public.villages set statut='Rejeté' where id='zzauh-%P%-vbosoum'$q$),
    ('S3-08','S3 Séparation','Passer un RT en « Actif »','AUH Botro A','REFUS',a,$q$update public.rt set statut='Actif' where id='zzauh-%P%-rtbouh'$q$),
    ('S3-09','S3 Séparation','Écarter un RT actif','AUH Botro A','REFUS',a,$q$update public.rt set statut='Écarté' where id='zzauh-%P%-rtboactif'$q$),
    ('S3-10','S3 Séparation','Passer un producteur en « Actif »','AUH Botro A','REFUS',a,$q$update public.producteurs set statut='Actif' where id='zzauh-%P%-pa1'$q$),
    ('S3-11','S3 Séparation','Désactiver un producteur actif','AUH Botro A','REFUS',a,$q$update public.producteurs set statut='Inactif' where id='zzauh-%P%-pboactif'$q$),
    ('S3-12','S3 Séparation','Auto-validation d''un achat à la saisie : neutralisée','AUH Botro A','OK',a,$q$with i as (insert into public.achats(cluster,village_id,poids_net,prix_kg,montant,statut_validation,validated_by,validated_at,created_by) values ('BOTRO','zzauh-%P%-vbo',20,300,6000,'Validé',auth.uid(),now(),auth.uid()) returning statut_validation,validated_by,validated_at,observation) select 1 from i where statut_validation='À valider' and validated_by is null and validated_at is null and observation like '%ramené%'$q$),
    ('S3-13','S3 Séparation','Valider un achat existant','AUH Botro A','REFUS',a,$q$update public.achats set statut_validation='Validé', validated_by=auth.uid() where cluster='BOTRO'$q$),
  -- =========== Scénario 4 : autorisations financières et administration
    ('S4-01','S4 Financier','Engager une avance','AUH Botro A','REFUS',a,$q$insert into public.avances(cluster,rt_id,montant,motif,created_by) values ('BOTRO','zzauh-%P%-rtbouh',10000,'ZZAUH',auth.uid())$q$),
    ('S4-02','S4 Financier','Modifier une avance de son cluster','AUH Botro A','REFUS',a,$q$update public.avances set montant=1 where cluster='BOTRO'$q$),
    ('S4-03','S4 Financier','Saisir une dépense de mission','AUH Botro A','REFUS',a,$q$insert into public.depenses_mission(village_id,montant_xof,statut_validation,created_by) values ('zzauh-%P%-vbo',1000,'soumise',auth.uid())$q$),
    ('S4-04','S4 Financier','Approuver une dépense','AUH Botro A','REFUS',a,$q$update public.depenses_mission set statut_validation='approuvee'$q$),
    ('S4-05','S4 Administration','Créer un compte utilisateur','AUH Botro A','REFUS',a,$q$insert into public.profils(user_id,email,nom,role,cluster) values ('%N2%','zzauh.pirate@example.test','PIRATE','Assistant Unit Head','BOTRO')$q$),
    ('S4-06','S4 Administration','Modifier son propre rôle','AUH Botro A','REFUS',a,$q$update public.profils set role='Unit Head' where user_id=auth.uid()$q$),
    ('S4-07','S4 Administration','Modifier son propre cluster','AUH Botro A','REFUS',a,$q$update public.profils set cluster='BROBO' where user_id=auth.uid()$q$),
    ('S4-08','S4 Administration','Lire le référentiel des rôles attribuables','AUH Botro A','REFUS',a,$q$select 1 from public.fbms_roles_attribuables()$q$),
    ('S4-09','S4 Administration','Lire les profils des autres comptes','AUH Botro A','REFUS',a,$q$select 1 from public.profils where user_id<>auth.uid()$q$),
    ('S4-10','S4 Suppression','Supprimer un village','AUH Botro A','REFUS',a,$q$delete from public.villages where id='zzauh-%P%-va1'$q$),
    ('S4-11','S4 Suppression','Supprimer logiquement un village (deleted)','AUH Botro A','REFUS',a,$q$update public.villages set deleted=true where id='zzauh-%P%-va1'$q$),
    ('S4-12','S4 Suppression','Supprimer un producteur','AUH Botro A','REFUS',a,$q$delete from public.producteurs where id='zzauh-%P%-pa1'$q$),
    ('S4-13','S4 Suppression','Supprimer logiquement un producteur','AUH Botro A','REFUS',a,$q$update public.producteurs set deleted=true where id='zzauh-%P%-pa1'$q$),
    ('S4-14','S4 Suppression','Supprimer un RT','AUH Botro A','REFUS',a,$q$delete from public.rt where id='zzauh-%P%-rta1'$q$),
    ('S4-15','S4 Suppression','Supprimer logiquement un RT','AUH Botro A','REFUS',a,$q$update public.rt set deleted=true where id='zzauh-%P%-rta1'$q$),
    ('S4-16','S4 AFLP FLEET','Aucune classe AFLP FLEET (aucun droit moto ajouté)','AUH Botro A','OK',a,$q$select 1 where private.moto_classe_de(auth.uid()) is null$q$),
    ('S4-17','S4 Sacherie','Mouvementer physiquement un emplacement de son cluster','AUH Botro A','REFUS',a,$q$select private.sacherie_exiger_cluster('BOTRO', true, 'mouvementer')$q$),
  -- =========== Scénario 5 : Branch Manager (supervision et administration)
    ('S5-01','S5 Branch Manager','Visibilité sur plusieurs clusters','BM','OK',bm,$q$select 1 where (select count(distinct cluster_code) from public.villages where id like 'zzauh-%P%-%')>=3 and (select count(*) from public.achats where cluster='BROBO')>0$q$),
    ('S5-02','S5 Branch Manager','Approuver une fiche soumise par l''assistant','BM','OK',bm,$q$update public.villages set statut='Approuvé BM' where id='zzauh-%P%-vbo'$q$),
    ('S5-03','S5 Branch Manager','Valider un achat saisi par l''assistant','BM','OK',bm,$q$update public.achats set statut_validation='Validé', validated_by=auth.uid(), validated_at=now() where created_by='00000000-0000-4000-9000-000000000006' and village_id='zzauh-%P%-vbo'$q$),
    ('S5-04','S5 Branch Manager','Le rôle est attribuable, cluster obligatoire','BM','OK',bm,$q$select 1 from public.fbms_roles_attribuables() where valeur='Assistant Unit Head' and attribuable and cluster_requis and portee='CLUSTER'$q$),
    ('S5-05','S5 Branch Manager','Créer un assistant : zone déduite du cluster','BM','OK',bm,$q$with i as (insert into public.profils(user_id,email,nom,role,actif,cluster) values ('%N1%','zzauh.nouveau.'||lower('%P%')||'@example.test','ZZAUH NOUVEAU','Assistant Unit Head',true,'Brobo') returning cluster,zone,authority_level) select 1 from i where cluster='BROBO' and zone='GBEKE_1' and authority_level='CLUSTER'$q$),
    ('S5-06','S5 Branch Manager','Créer un assistant sans cluster','BM','REFUS',bm,$q$insert into public.profils(user_id,email,nom,role,cluster) values ('%N2%','zzauh.nouveau2.'||lower('%P%')||'@example.test','ZZAUH SANS CLUSTER','Assistant Unit Head',null)$q$),
    ('S5-07','S5 Branch Manager','Créer un assistant à portée globale','BM','REFUS',bm,$q$insert into public.profils(user_id,email,nom,role,cluster,authority_level) values ('%N2%','zzauh.nouveau2.'||lower('%P%')||'@example.test','ZZAUH GLOBAL','Assistant Unit Head','BOTRO','GLOBAL')$q$),
    ('S5-08','S5 Branch Manager','Créer un assistant multi-zones (permissions)','BM','REFUS',bm,$q$insert into public.profils(user_id,email,nom,role,cluster,permissions) values ('%N2%','zzauh.nouveau2.'||lower('%P%')||'@example.test','ZZAUH MULTI','Assistant Unit Head','BOTRO','{"zones":["GBEKE_1","GBEKE_2"]}')$q$),
    ('S5-09','S5 Branch Manager','Créer un assistant sur un cluster inconnu','BM','REFUS',bm,$q$insert into public.profils(user_id,email,nom,role,cluster) values ('%N2%','zzauh.nouveau2.'||lower('%P%')||'@example.test','ZZAUH INCONNU','Assistant Unit Head','KATIOLA')$q$),
    ('S5-10','S5 Branch Manager','Changer l''affectation d''un assistant (Botro → Diabo)','BM','OK',bm,$q$update public.profils set cluster='Diabo' where user_id='00000000-0000-4000-9000-000000000007'$q$),
    ('S5-11','S5 Branch Manager','Historique du changement d''affectation conservé','BM','OK',bm,$q$select 1 from public.rcn_proc_audit_central where table_name='profils' and record_id='00000000-0000-4000-9000-000000000007' and before_data->>'cluster'='BOTRO' and after_data->>'cluster'='DIABO' and actor_id=auth.uid()$q$),
    ('S5-12','S5 Changement de cluster','Après réaffectation : ancien cluster invisible','AUH B (Diabo)','REFUS',b,$q$select 1 from public.villages where id='zzauh-%P%-vbo'$q$),
    ('S5-13','S5 Changement de cluster','Après réaffectation : nouveau cluster visible','AUH B (Diabo)','OK',b,$q$select 1 from public.villages where id='zzauh-%P%-vdi'$q$),
  -- =========== Scénario 6 : compte désactivé (session encore ouverte)
    ('S6-01','S6 Désactivation','Le BM désactive l''assistant X','BM','OK',bm,$q$update public.profils set actif=false where user_id='00000000-0000-4000-9000-000000000009'$q$),
    ('S6-02','S6 Désactivation','Session ouverte : lecture des villages','AUH X désactivé','REFUS',x,$q$select 1 from public.villages where id='zzauh-%P%-vbosoum'$q$),
    ('S6-03','S6 Désactivation','Session ouverte : création de village','AUH X désactivé','REFUS',x,$q$insert into public.villages(id,village,cluster,data) values ('zzauh-%P%-vx1','ZZAUH %P% X1','Botro','{"s1":{"cluster":"Botro","village":"X1"}}')$q$),
    ('S6-04','S6 Désactivation','Session ouverte : saisie d''achat','AUH X désactivé','REFUS',x,$q$insert into public.achats(cluster,village_id,poids_net,prix_kg,montant,created_by) values ('BOTRO','zzauh-%P%-vbo',10,300,3000,auth.uid())$q$),
    ('S6-05','S6 Désactivation','Session ouverte : modification de producteur','AUH X désactivé','REFUS',x,$q$update public.producteurs set telephone='0700000009' where id='zzauh-%P%-pbo'$q$),
    ('S6-06','S6 Désactivation','Session ouverte : synchronisation hors ligne','AUH X désactivé','REFUS',x,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FARMER_ENROLL','payload',jsonb_build_object('row',jsonb_build_object('nom','ZZAUH OFF X %P%','village_id','zzauh-%P%-vbo'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('S6-07','S6 Désactivation','Session ouverte : contexte Sacherie','AUH X désactivé','REFUS',x,$q$select 1 where coalesce((private.sacherie_contexte()->>'actif')::boolean,false)$q$),
    ('S6-08','S6 Session absente','Appel sans identité (jeton expiré ou absent)','sans sub','REFUS',null,$q$select 1 from public.villages where id='zzauh-%P%-vbosoum'$q$),
  -- =========== Scénario 7 : hors connexion
    ('S7-01','S7 Hors ligne','Enrôlement hors ligne dans son cluster','AUH Botro A','OK',a,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FARMER_ENROLL','payload',jsonb_build_object('row',jsonb_build_object('nom','ZZAUH OFF BO %P%','village_id','zzauh-%P%-vbo'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('S7-02','S7 Hors ligne','Achat hors ligne « Validé » : synchronisé, ramené à À valider','AUH Botro A','OK',a,$q$drop table if exists zz_r; create temp table zz_r as select public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key','%K1%','client_operation_id','%K1%','device_id','%D%','campaign_id','%C%','operation_type','FIELD_PURCHASE_CREATE','created_at_client',now(),'payload',jsonb_build_object('lease_token','%L%','row',jsonb_build_object('local_id','zzauh-%P%-off1','date',current_date,'cluster','BOTRO','village_id','zzauh-%P%-vbo','rt_id','zzauh-%P%-rtbouh','poids_net',100,'prix_kg',300,'montant',30000,'statut_validation','Validé','weight_source','SCALE'))))) r; select 1 from zz_r where r->'results'->0->>'status'='SYNCED' and exists (select 1 from public.achats where local_id='zzauh-%P%-off1' and statut_validation='À valider' and validated_by is null)$q$),
    ('S7-03','S7 Hors ligne','Rejeu du même lot : idempotent, aucun doublon','AUH Botro A','OK',a,$q$drop table if exists zz_r; create temp table zz_r as select public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key','%K1%','client_operation_id','%K1%','device_id','%D%','campaign_id','%C%','operation_type','FIELD_PURCHASE_CREATE','created_at_client',now(),'payload',jsonb_build_object('lease_token','%L%','row',jsonb_build_object('local_id','zzauh-%P%-off1','date',current_date,'cluster','BOTRO','village_id','zzauh-%P%-vbo','rt_id','zzauh-%P%-rtbouh','poids_net',100,'prix_kg',300,'montant',30000,'statut_validation','Validé','weight_source','SCALE'))))) r; select 1 from zz_r where r->'results'->0->>'status'='SYNCED' and (select count(*) from public.achats where local_id='zzauh-%P%-off1')=1$q$),
    ('S7-04','S7 Hors ligne','GPS hors ligne d''un producteur de son cluster','AUH Botro A','OK',a,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FIELD_GPS_UPDATE','payload',jsonb_build_object('row',jsonb_build_object('producteur_id','zzauh-%P%-pbo','gps_lat','7.1','gps_lng','-5.1'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('S7-05','S7 Hors ligne','Refus hors ligne motivé (message rendu au terminal)','AUH Botro A','OK',a,$q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id','%D%','campaign_id','%C%','operation_type','FIELD_PURCHASE_CREATE','created_at_client',now(),'payload',jsonb_build_object('lease_token','%L%','row',jsonb_build_object('local_id','zzauh-%P%-off2','date',current_date,'cluster','BROBO','village_id','zzauh-%P%-vbr','rt_id','zzauh-%P%-rtbouh','poids_net',100,'prix_kg',300,'montant',30000,'weight_source','SCALE'))))) r where r->'results'->0->>'status'<>'SYNCED' and r->'results'->0->>'message' like '%hors de votre cluster%'$q$),
  -- =========== Autres contrôles : doublons
    ('S9-01','S9 Doublons','Producteur en double (même nom, prénoms, village)','AUH Botro A','REFUS',a,$q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzauh-%P%-pa1bis','ZZAUH','PA1','zzauh-%P%-vbo','{}')$q$),
    ('S9-02','S9 Doublons','Village en double dans son cluster','AUH Botro A','REFUS',a,$q$insert into public.villages(id,village,cluster,data) values ('zzauh-%P%-va1bis','ZZAUH %P% A1','Botro','{"s1":{"cluster":"Botro","village":"ZZAUH %P% A1"}}')$q$),
  -- =========== Scénario 8 : non-régression des rôles existants
    ('S8-01','S8 Non-régression','Zonal Head : lecture Brobo et Botro','Zonal Head','OK',zh,$q$select 1 where exists(select 1 from public.villages where id='zzauh-%P%-vbr') and exists(select 1 from public.villages where id='zzauh-%P%-vbosoum')$q$),
    ('S8-02','S8 Non-régression','Zonal Head : modifier un village de Brobo','Zonal Head','OK',zh,$q$update public.villages set data = data || '{"s3":{"nbProducteurs":4}}' where id='zzauh-%P%-vbr'$q$),
    ('S8-03','S8 Non-régression','Unit Head Botro : créer un village Botro','UH Botro','OK',uhb,$q$insert into public.villages(id,village,cluster,data) values ('zzauh-%P%-vu1','ZZAUH %P% U1','Botro','{"s1":{"cluster":"Botro","village":"U1"}}')$q$),
    ('S8-04','S8 Non-régression','Unit Head Botro : approuver une fiche (comportement inchangé)','UH Botro','OK',uhb,$q$update public.villages set statut='Approuvé BM' where id='zzauh-%P%-vbosoum'$q$),
    ('S8-05','S8 Non-régression','Unit Head Botro : confirmer un RT qu''il a créé (inchangé)','UH Botro','OK',uhb,$q$update public.rt set statut='Actif' where id='zzauh-%P%-rtbouh'$q$),
    ('S8-06','S8 Non-régression','Unit Head Botro : engager une avance (inchangé)','UH Botro','OK',uhb,$q$insert into public.avances(cluster,rt_id,montant,motif,created_by) values ('BOTRO','zzauh-%P%-rtbouh',1000,'ZZAUH UH',auth.uid())$q$),
    ('S8-07','S8 Non-régression','Unit Head Botro : lecture Brobo (inchangé, non cloisonnée)','UH Botro','OK',uhb,$q$select 1 from public.villages where id='zzauh-%P%-vbr'$q$),
    ('S8-08','S8 Non-régression','Unit Head Botro : création à Brobo toujours refusée','UH Botro','REFUS',uhb,$q$insert into public.villages(id,village,cluster,data) values ('zzauh-%P%-vu2','ZZAUH %P% U2','Brobo','{"s1":{"cluster":"Brobo","village":"U2"}}')$q$),
    ('S8-09','S8 Non-régression','Unit Head : contexte Sacherie inchangé (CLUSTER/CLUSTER)','UH Botro','OK',uhb,$q$select 1 where private.sacherie_contexte()->>'lecture'='CLUSTER' and private.sacherie_contexte()->>'ecriture'='CLUSTER'$q$),
    ('S8-10','S8 Non-régression','Unit Head : classe AFLP FLEET inchangée (UNITE)','UH Botro','OK',uhb,$q$select 1 where private.moto_classe_de(auth.uid())='UNITE'$q$),
    ('S8-11','S8 Non-régression','Assistant Branch Manager : lecture et modification globale','ABM','OK',abm,$q$update public.villages set data = data || '{"s3":{"nbProducteurs":6}}' where id='zzauh-%P%-vbr'$q$),
    ('S8-12','S8 Non-régression','Branch Manager : suppression d''une fiche (inchangé)','BM','OK',bm,$q$update public.villages set deleted=true where id='zzauh-%P%-vu1'$q$),
    ('S8-13','S8 Non-régression','Assistant Brobo : symétrie, Botro invisible','AUH Brobo','REFUS',c,$q$select 1 from public.villages where id='zzauh-%P%-vbosoum'$q$),
    ('S8-14','S8 Non-régression','Assistant Brobo : son cluster visible','AUH Brobo','OK',c,$q$select 1 from public.villages where id='zzauh-%P%-vbr'$q$)
  ) as s(id,bloc,fonction,compte,attendu,uid,q)
  loop
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', coalesce(sc.uid::text,''), true);
    execute 'set local role authenticated';
    n := null;
    q := replace(replace(replace(replace(replace(replace(replace(replace(sc.q,'%P%',ph),'%C%',camp),'%L%',lease::text),'%D%',dev::text),'%K1%',k1::text),'%N1%',nouv::text),'%N2%',nouv2::text),'%PN%',case ph when 'APRES' then '0001' else '0002' end);
    begin
      execute q;
      get diagnostics n = row_count;
      msg := case when n > 0 then 'OK ('||n||' ligne)' else 'REFUS (0 ligne visible/modifiée)' end;
      if sc.attendu <> 'OK' then raise exception using errcode = 'P0099', message = 'annulation banc'; end if;
    exception when others then
      if sqlstate <> 'P0099' then msg := 'REFUS ('||sqlstate||' : '||left(sqlerrm,120)||')'; end if;
    end;
    execute 'reset role';
    insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
    values (ph,sc.id,sc.bloc,sc.fonction,sc.compte,sc.attendu,msg,
      case when split_part(msg,' ',1)=sc.attendu then 'PASS' else 'FAIL' end);
  end loop;
end
$banc$;
