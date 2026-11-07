-- Phase ROLLBACK : après 20261103120100_..._rollback.sql
do $$
declare msg text; n bigint;
begin
  select count(*) into n from public.profils where role='Assistant Unit Head' and actif;
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-01','Retour arrière','Comptes assistants actifs après retour arrière','—','0',n::text, case when n=0 then 'PASS' else 'FAIL' end);
  select count(*) into n from public.profils where role='Assistant Unit Head';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-02','Retour arrière','Comptes assistants conservés (aucune suppression)','—','>0',n::text, case when n>0 then 'PASS' else 'FAIL' end);
  select count(*) into n from pg_policies where policyname like '%auh%';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-03','Retour arrière','Politiques AUH restantes','—','0',n::text, case when n=0 then 'PASS' else 'FAIL' end);
  select count(*) into n from pg_trigger where tgname like '%auh%';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-04','Retour arrière','Déclencheurs AUH restants','—','0',n::text, case when n=0 then 'PASS' else 'FAIL' end);
  select count(*) into n from public.villages where id like 'zzauh-APRES-%';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-05','Retour arrière','Fiches créées pendant la phase APRES conservées','—','>0',n::text, case when n>0 then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-9000-000000000001',true);
  execute 'set local role authenticated';
  begin
    insert into public.profils(user_id,email,nom,role,cluster) values ('00000000-0000-4000-9000-0000000000a9','zzauh.auh.avant@example.test','ZZAUH','Assistant Unit Head','BOTRO');
    msg := 'OK'; raise exception using errcode='P0099', message='annulation';
  exception when others then if sqlstate<>'P0099' then msg := 'REFUS ('||sqlstate||')'; end if; end;
  execute 'reset role';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-06','Retour arrière','Nouvelle attribution du rôle impossible','BM','REFUS',msg, case when split_part(msg,' ',1)='REFUS' then 'PASS' else 'FAIL' end);
  select md5(pg_get_functiondef('private.sacherie_contexte()'::regprocedure)) into msg;
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-07','Retour arrière','sacherie_contexte() identique à la production','—','db963564…',msg, case when msg='db963564faf99ee917e467f23255ba21' then 'PASS' else 'FAIL' end);
  select md5(pg_get_functiondef('public.fbms_roles_attribuables()'::regprocedure)) into msg;
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('ROLLBACK','R-08','Retour arrière','fbms_roles_attribuables() identique à la production','—','2c84274a…',msg, case when msg='2c84274ad94547ee24380b3ee6937dcd' then 'PASS' else 'FAIL' end);
end $$;
