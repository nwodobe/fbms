-- Banc de scénarios — à exécuter avec : psql -v phase=AVANT|APRES -f 02_banc_scenarios.sql
-- Comptes et fiches 100 % synthétiques (préfixe ZZQA). Aucune donnée réelle.
create table if not exists public.zz_resultats(phase text, id text, fonction text, role text, cluster text,
  attendu text, obtenu text, statut text, at timestamptz default clock_timestamp());

select set_config('banc.phase', :'phase', false);

do $banc$
declare
  ph text := current_setting('banc.phase');
  u_bm uuid; u_zh uuid; u_botro uuid; u_djeb uuid; u_nocl uuid; u_inact uuid; u_agent uuid; u_consult uuid;
  camp text := 'c5b19a48-de65-464a-892b-a2b2c76acdaa';
  sc record; n bigint; msg text;
begin
  -- Comptes synthétiques (créés une fois, réutilisés par les deux phases)
  if not exists (select 1 from public.profils where email like 'zzqa.%') then
    insert into auth.users(id,email) values
      ('00000000-0000-4000-8000-000000000001','zzqa.bm@example.test'),('00000000-0000-4000-8000-000000000002','zzqa.zh@example.test'),
      ('00000000-0000-4000-8000-000000000003','zzqa.uh.botro@example.test'),('00000000-0000-4000-8000-000000000004','zzqa.uh.djeb@example.test'),
      ('00000000-0000-4000-8000-000000000005','zzqa.uh.nocl@example.test'),('00000000-0000-4000-8000-000000000006','zzqa.uh.inact@example.test'),
      ('00000000-0000-4000-8000-000000000007','zzqa.agent@example.test'),('00000000-0000-4000-8000-000000000008','zzqa.consult@example.test');
    insert into public.profils(user_id,email,nom,role,actif,cluster) values
      ('00000000-0000-4000-8000-000000000001','zzqa.bm@example.test','ZZQA BM','Branch Manager',true,null),
      ('00000000-0000-4000-8000-000000000002','zzqa.zh@example.test','ZZQA ZH','Zonal Head',true,null),
      ('00000000-0000-4000-8000-000000000003','zzqa.uh.botro@example.test','ZZQA UH BOTRO','Unit Head',true,'BOTRO'),
      ('00000000-0000-4000-8000-000000000004','zzqa.uh.djeb@example.test','ZZQA UH DJEB','Unit Head',true,'DJEBONOUA'),
      ('00000000-0000-4000-8000-000000000005','zzqa.uh.nocl@example.test','ZZQA UH SANS CLUSTER','Unit Head',true,null),
      ('00000000-0000-4000-8000-000000000006','zzqa.uh.inact@example.test','ZZQA UH INACTIF','Unit Head',false,'BOTRO'),
      ('00000000-0000-4000-8000-000000000007','zzqa.agent@example.test','ZZQA AGENT','Agent Recenseur',true,null),
      ('00000000-0000-4000-8000-000000000008','zzqa.consult@example.test','ZZQA CONSULT','Consultation uniquement',true,null);
  end if;
  u_bm:='00000000-0000-4000-8000-000000000001'; u_zh:='00000000-0000-4000-8000-000000000002';
  u_botro:='00000000-0000-4000-8000-000000000003'; u_djeb:='00000000-0000-4000-8000-000000000004';
  u_nocl:='00000000-0000-4000-8000-000000000005'; u_inact:='00000000-0000-4000-8000-000000000006';
  u_agent:='00000000-0000-4000-8000-000000000007'; u_consult:='00000000-0000-4000-8000-000000000008';

  -- Référentiel de test de la phase (préfixes Farmer ID comme les 60 villages réels)
  insert into public.villages(id,village,cluster,data,farmer_code_prefix) values
    ('zzqa-'||ph||'-vbotro','ZZQA '||ph||' BOTRO','BOTRO','{"s1":{"cluster":"Botro","village":"ZZQA"}}','Q'||left(ph,2)||'BO'),
    ('zzqa-'||ph||'-vdiabo','ZZQA '||ph||' DIABO','DIABO','{"s1":{"cluster":"Diabo","village":"ZZQA"}}','Q'||left(ph,2)||'DI'),
    ('zzqa-'||ph||'-vsak','ZZQA '||ph||' SAKASSOU','SAKASSOU','{"s1":{"cluster":"Sakassou","village":"ZZQA"}}','Q'||left(ph,2)||'SA'),
    ('zzqa-'||ph||'-vdjeb','ZZQA '||ph||' DJEB','DJEBONOUA','{"s1":{"cluster":"Djébonoua","village":"ZZQA"}}','Q'||left(ph,2)||'DJ');
  insert into public.rt(id,nom,village_id,data) values ('zzqa-'||ph||'-rtbotro','ZZQA RT BOTRO','zzqa-'||ph||'-vbotro','{}');
  insert into public.producteurs(id,nom,village_id,data) values ('zzqa-'||ph||'-pdiabo','ZZQA PROD DIABO','zzqa-'||ph||'-vdiabo','{}');

  for sc in select * from (values
    ('V01','Création village propre cluster','Unit Head','BOTRO','OK',u_botro,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-v01','ZZQA %P% V01','Botro','{"s1":{"cluster":"Botro","village":"ZZQA %P% V01"}}')$q$),
    ('V02','Modification village propre cluster','Unit Head','BOTRO','OK',u_botro,
      $q$update public.villages set data = data || '{"s3":{"nbProducteurs":12}}' where id='zzqa-%P%-vbotro'$q$),
    ('V03','Consultation du village créé','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.villages where id='zzqa-%P%-v01'$q$),
    ('V04','Champ obligatoire : village sans nom','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.villages(id,cluster,data) values ('zzqa-%P%-v04b','Botro','{"s1":{"cluster":"Botro"}}')$q$),
    ('V05','Doublon de nom dans le même cluster','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-v05','ZZQA %P% V01','Botro','{"s1":{"cluster":"Botro","village":"ZZQA %P% V01"}}')$q$),
    ('V06','Création dans un autre cluster (Diabo)','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-v06','ZZQA %P% V06','Diabo','{"s1":{"cluster":"Diabo","village":"V06"}}')$q$),
    ('V07','Modification hors cluster (Diabo)','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.villages set data = data || '{"s3":{"nbProducteurs":99}}' where id='zzqa-%P%-vdiabo'$q$),
    ('V08','Changement frauduleux de cluster Botro -> Diabo','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.villages set cluster='DIABO', cluster_code='DIABO', data = jsonb_set(data,'{s1,cluster}','"Diabo"') where id='zzqa-%P%-vbotro'$q$),
    ('V09','Changement de cluster via data.s1 seul','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.villages set data = jsonb_set(data,'{s1,cluster}','"Diabo"') where id='zzqa-%P%-vbotro'$q$),
    ('V10','Rapatriement d''un village Diabo vers Botro','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.villages set cluster='BOTRO', cluster_code='BOTRO', data = jsonb_set(data,'{s1,cluster}','"Botro"') where id='zzqa-%P%-vdiabo'$q$),
    ('V11','Création sans cluster','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.villages(id,village,data) values ('zzqa-%P%-v11','ZZQA %P% V11','{"s1":{"village":"V11"}}')$q$),
    ('V12','Signaux de cluster incohérents','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.villages(id,village,cluster,cluster_code,data) values ('zzqa-%P%-v12','ZZQA %P% V12','BOTRO','BOTRO','{"s1":{"cluster":"Diabo","village":"V12"}}')$q$),
    ('V13','Suppression logique d''un village','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.villages set deleted=true where id='zzqa-%P%-vbotro'$q$),
    ('V14','Suppression physique d''un village','Unit Head','BOTRO','REFUS',u_botro,
      $q$delete from public.villages where id='zzqa-%P%-vbotro'$q$),
    ('V15','Création village (alias N''DJEBONOUA)','Unit Head','DJEBONOUA','OK',u_djeb,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-v15','ZZQA %P% V15','N''DJEBONOUA','{"s1":{"cluster":"N''DJEBONOUA","village":"V15"}}')$q$),
    ('V16','Modification village propre cluster','Unit Head','DJEBONOUA','OK',u_djeb,
      $q$update public.villages set data = data || '{"s3":{"nbProducteurs":5}}' where id='zzqa-%P%-vdjeb'$q$),
    ('V17','Modification village Sakassou','Unit Head','DJEBONOUA','REFUS',u_djeb,
      $q$update public.villages set data = data || '{"s3":{"nbProducteurs":7}}' where id='zzqa-%P%-vsak'$q$),
    ('P01','Enrôlement producteur village autorisé (+ RT)','Unit Head','BOTRO','OK',u_botro,
      $q$insert into public.producteurs(id,nom,prenoms,village_id,rt_id,data) values ('zzqa-%P%-p01','ZZQA','P01','zzqa-%P%-vbotro','zzqa-%P%-rtbotro','{}')$q$),
    ('P02','Farmer ID généré au préfixe du village','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.producteurs where id='zzqa-%P%-p01' and code like 'Q__BO-0001'$q$),
    ('P03','Rattachement village et RT corrects','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.producteurs where id='zzqa-%P%-p01' and village_id='zzqa-%P%-vbotro' and rt_id='zzqa-%P%-rtbotro'$q$),
    ('P04','Modification producteur autorisé','Unit Head','BOTRO','OK',u_botro,
      $q$update public.producteurs set telephone='07000'||translate('%P%','AVNTPRES','12345678'), data = data || '{"superficieHa":2}' where id='zzqa-%P%-p01'$q$),
    ('P05','Farmer ID conservé (tentative de modification)','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.producteurs set code='HACK-0001' where id='zzqa-%P%-p01'$q$),
    ('P06','RT d''un autre village refusé','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.producteurs(id,nom,prenoms,village_id,rt_id,data) values ('zzqa-%P%-p06','ZZQA','P06','zzqa-%P%-vdjeb','zzqa-%P%-rtbotro','{}')$q$),
    ('P07','Doublon fort (même nom, prénoms, village)','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzqa-%P%-p07','ZZQA','P01','zzqa-%P%-vbotro','{}')$q$),
    ('P08','Enrôlement dans un village hors cluster','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzqa-%P%-p08','ZZQA','P08','zzqa-%P%-vdiabo','{}')$q$),
    ('P09','Modification producteur hors cluster','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.producteurs set prenoms='PIRATE' where id='zzqa-%P%-pdiabo'$q$),
    ('P10','Changement non autorisé de village','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.producteurs set village_id='zzqa-%P%-vdiabo', rt_id=null where id='zzqa-%P%-p01'$q$),
    ('P11','Suppression physique producteur','Unit Head','BOTRO','REFUS',u_botro,
      $q$delete from public.producteurs where id='zzqa-%P%-p01'$q$),
    ('P12','Suppression logique producteur','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.producteurs set deleted=true where id='zzqa-%P%-p01'$q$),
    ('P13','Enrôlement dans le village qu''il vient de créer','Unit Head','BOTRO','OK',u_botro,
      $q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzqa-%P%-p13','ZZQA','P13','zzqa-%P%-v01','{}')$q$),
    ('P14','Hors ligne : FARMER_ENROLL hors cluster','Unit Head','BOTRO','REFUS',u_botro,
      $q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FARMER_ENROLL','payload',jsonb_build_object('row',jsonb_build_object('nom','ZZQA OFF %P%','village_id','zzqa-%P%-vdiabo'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('P15','Hors ligne : FARMER_ENROLL cluster autorisé','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FARMER_ENROLL','payload',jsonb_build_object('row',jsonb_build_object('nom','ZZQA OFFOK %P%','village_id','zzqa-%P%-vbotro'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('C01','Contournement en chaîne : rapatrier un village Diabo puis modifier son producteur','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.villages set cluster='BOTRO', cluster_code='BOTRO', data = jsonb_set(data,'{s1,cluster}','"Botro"') where id='zzqa-%P%-vdiabo'; update public.producteurs set prenoms='PIRATE' where id='zzqa-%P%-pdiabo'$q$),
    ('S01','UH sans cluster : création village','Unit Head','(aucun)','REFUS',u_nocl,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-s01','ZZQA %P% S01','Botro','{"s1":{"cluster":"Botro","village":"S01"}}')$q$),
    ('S02','UH sans cluster : enrôlement producteur','Unit Head','(aucun)','REFUS',u_nocl,
      $q$insert into public.producteurs(id,nom,prenoms,village_id,data) values ('zzqa-%P%-s02','ZZQA','S02','zzqa-%P%-vbotro','{}')$q$),
    ('S03','UH désactivé : création village','Unit Head (inactif)','BOTRO','REFUS',u_inact,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-s03','ZZQA %P% S03','Botro','{"s1":{"cluster":"Botro","village":"S03"}}')$q$),
    ('S04','UH désactivé : modification producteur','Unit Head (inactif)','BOTRO','REFUS',u_inact,
      $q$update public.producteurs set prenoms='X' where id='zzqa-%P%-p01'$q$),
    ('S05','BM : création village Diabo','Branch Manager','GLOBAL','OK',u_bm,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-s05','ZZQA %P% S05','Diabo','{"s1":{"cluster":"Diabo","village":"S05"}}')$q$),
    ('S06','BM : modification village Sakassou','Branch Manager','GLOBAL','OK',u_bm,
      $q$update public.villages set data = data || '{"s3":{"nbProducteurs":3}}' where id='zzqa-%P%-vsak'$q$),
    ('S07','BM : suppression physique village','Branch Manager','GLOBAL','OK',u_bm,
      $q$delete from public.villages where id='zzqa-%P%-s05'$q$),
    ('S08','BM : modification producteur Diabo','Branch Manager','GLOBAL','OK',u_bm,
      $q$update public.producteurs set prenoms='ZZQA BM' where id='zzqa-%P%-pdiabo'$q$),
    ('S09','Zonal Head : création village Diabo','Zonal Head','GLOBAL (rôle)','OK',u_zh,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-s09','ZZQA %P% S09','Diabo','{"s1":{"cluster":"Diabo","village":"S09"}}')$q$),
    ('S10','Zonal Head : modification producteur Diabo','Zonal Head','GLOBAL (rôle)','OK',u_zh,
      $q$update public.producteurs set prenoms='ZZQA ZH' where id='zzqa-%P%-pdiabo'$q$),
    ('S11','Zonal Head : suppression village','Zonal Head','GLOBAL (rôle)','REFUS',u_zh,
      $q$delete from public.villages where id='zzqa-%P%-s09'$q$),
    ('S12','Agent Recenseur : création village (inchangé)','Agent Recenseur','(aucun)','OK',u_agent,
      $q$insert into public.villages(id,village,cluster,data,statut) values ('zzqa-%P%-s12','ZZQA %P% S12','Diabo','{"s1":{"cluster":"Diabo","village":"S12"}}','Brouillon')$q$),
    ('S13','Consultation uniquement : création village','Consultation uniquement','(aucun)','REFUS',u_consult,
      $q$insert into public.villages(id,village,cluster,data) values ('zzqa-%P%-s13','ZZQA %P% S13','Botro','{"s1":{"cluster":"Botro","village":"S13"}}')$q$),
    ('S14','UH : modification du cluster de son profil','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.profils set cluster='DIABO' where user_id=auth.uid()$q$),
    ('S15','UH : auto-promotion Branch Manager','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.profils set role='Branch Manager' where user_id=auth.uid()$q$),
    ('S16','UH : création d''un compte utilisateur','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.profils(user_id,email,nom,role) values ('00000000-0000-4000-8000-0000000000ff','zzqa.x@example.test','X','Branch Manager')$q$),
    ('S17','Contournement : appel direct de la fonction de contrôle','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 where private.aflp_village_ecriture_dans_mon_cluster('DIABO','DIABO','{}') is not true$q$),
    ('G01','Hors ligne : GPS d''un producteur Diabo (contournement RLS)','Unit Head','BOTRO','REFUS',u_botro,
      $q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FIELD_GPS_UPDATE','payload',jsonb_build_object('row',jsonb_build_object('producteur_id','zzqa-%P%-pdiabo','gps_lat','7.1','gps_lng','-5.1'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('G02','Hors ligne : GPS d''un producteur de son cluster','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FIELD_GPS_UPDATE','payload',jsonb_build_object('row',jsonb_build_object('producteur_id','zzqa-%P%-p01','gps_lat','7.1','gps_lng','-5.1'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('G03','Hors ligne : GPS producteur Diabo par le BM','Branch Manager','GLOBAL','OK',u_bm,
      $q$select 1 from public.offline_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key',gen_random_uuid(),'client_operation_id',gen_random_uuid(),'device_id',gen_random_uuid(),'campaign_id','%C%','operation_type','FIELD_GPS_UPDATE','payload',jsonb_build_object('row',jsonb_build_object('producteur_id','zzqa-%P%-pdiabo','gps_lat','7.1','gps_lng','-5.1'))))) r where r->'results'->0->>'status'='SYNCED'$q$),
    ('G04','API directe : GPS producteur Diabo','Unit Head','BOTRO','REFUS',u_botro,
      $q$update public.producteurs set gps_lat=7.2, gps_lng=-5.2 where id='zzqa-%P%-pdiabo'$q$),
    ('G05','API directe : GPS producteur de son cluster','Unit Head','BOTRO','OK',u_botro,
      $q$update public.producteurs set gps_lat=7.3, gps_lng=-5.3 where id='zzqa-%P%-p01'$q$),
    ('F01','Chaîne : Farmer ID du nouveau village = préfixe attribué + 0001','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.producteurs p join public.villages v on v.id=p.village_id where p.id='zzqa-%P%-p13' and v.farmer_code_prefix is not null and p.code = v.farmer_code_prefix||'-0001'$q$),
    ('F02','Chaîne : producteur du nouveau village consultable','Unit Head','BOTRO','OK',u_botro,
      $q$select 1 from public.producteurs where id='zzqa-%P%-p13' and village_id='zzqa-%P%-v01'$q$),
    ('R01','Création RT dans un village Diabo','Unit Head','BOTRO','REFUS',u_botro,
      $q$insert into public.rt(id,nom,village_id,data) values ('zzqa-%P%-r01','ZZQA RT X','zzqa-%P%-vdiabo','{}')$q$),
    ('R02','Création RT dans un village de son cluster','Unit Head','BOTRO','OK',u_botro,
      $q$insert into public.rt(id,nom,village_id,data) values ('zzqa-%P%-r02','ZZQA RT Y','zzqa-%P%-vbotro','{}')$q$)
  ) as s(id,fonction,role,cluster,attendu,uid,q)
  loop
    if sc.id = 'S17' and ph = 'AVANT' then
      insert into public.zz_resultats(phase,id,fonction,role,cluster,attendu,obtenu,statut)
      values (ph,sc.id,sc.fonction,sc.role,sc.cluster,sc.attendu,'sans objet (fonction absente avant correctif)','N/A');
      continue;
    end if;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', sc.uid::text, true);
    execute 'set local role authenticated';
    n := null;
    begin
      execute replace(replace(sc.q,'%P%',ph),'%C%',camp);
      get diagnostics n = row_count;
      msg := case when n > 0 then 'OK ('||n||' ligne)' else 'REFUS (0 ligne visible/modifiée)' end;
      -- Un scénario dont l'attendu n'est pas « OK » est toujours annulé après mesure :
      -- une attaque qui réussit ne doit pas fausser les scénarios suivants.
      if sc.attendu <> 'OK' then raise exception using errcode = 'P0099', message = 'annulation banc'; end if;
    exception when others then
      if sqlstate <> 'P0099' then msg := 'REFUS ('||sqlstate||' : '||left(sqlerrm,110)||')'; end if;
    end;
    execute 'reset role';
    insert into public.zz_resultats(phase,id,fonction,role,cluster,attendu,obtenu,statut)
    values (ph,sc.id,sc.fonction,sc.role,sc.cluster,sc.attendu,msg,
      case when sc.attendu='CONSTAT' then 'CONSTAT' when split_part(msg,' ',1)=sc.attendu then 'PASS' else 'FAIL' end);
  end loop;
end
$banc$;

-- Contrôle d'intégrité : aucune fiche hors banc touchée (le banc ne contient que des ZZQA).
select phase, statut, count(*) from public.zz_resultats where phase = :'phase' group by 1,2 order by 1,2;
