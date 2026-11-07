-- Phase AVANT : état de production, migration NON appliquée. Constats du mandat §2.
create table if not exists public.zz_resultats_auh(phase text, id text, bloc text, fonction text, compte text,
  attendu text, obtenu text, statut text, at timestamptz default clock_timestamp());
insert into auth.users(id,email) values ('00000000-0000-4000-9000-0000000000a0','zzauh.bm.avant@example.test'),
  ('00000000-0000-4000-9000-0000000000a9','zzauh.auh.avant@example.test') on conflict do nothing;
insert into public.profils(user_id,email,nom,role,actif) values
  ('00000000-0000-4000-9000-0000000000a0','zzauh.bm.avant@example.test','ZZAUH BM AVANT','Branch Manager',true) on conflict do nothing;
do $$
declare msg text; n bigint;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-9000-0000000000a0',true);
  execute 'set local role authenticated';
  begin
    insert into public.profils(user_id,email,nom,role,cluster) values ('00000000-0000-4000-9000-0000000000a9','zzauh.auh.avant@example.test','ZZAUH AUH AVANT','Assistant Unit Head','BOTRO');
    msg := 'OK'; raise exception using errcode='P0099', message='annulation';
  exception when others then if sqlstate<>'P0099' then msg := 'REFUS ('||sqlstate||' : '||left(sqlerrm,120)||')'; end if; end;
  execute 'reset role';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('AVANT','A-01','Constat','Le BM crée un compte Assistant Unit Head','BM','CONSTAT',msg,'CONSTAT');
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-9000-0000000000a0',true);
  execute 'set local role authenticated';
  select count(*) into n from public.fbms_roles_attribuables() where valeur='Assistant Unit Head';
  execute 'reset role';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('AVANT','A-02','Constat','Rôle proposé par fbms_roles_attribuables()','BM','CONSTAT',n||' ligne','CONSTAT');
  select count(*) into n from pg_policies where tablename in ('villages','rt') and cmd='SELECT' and permissive='RESTRICTIVE';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('AVANT','A-03','Constat','Politiques RESTRICTIVES de lecture sur villages et rt','—','CONSTAT',n||' politique','CONSTAT');
  select count(*) into n from pg_policies where tablename='rt' and cmd='INSERT' and qual is null and with_check ~ 'cluster|village_dans|access_village';
  insert into public.zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut)
  values ('AVANT','A-04','Constat','Cloisonnement géographique de la création de RT','—','CONSTAT',n||' politique','CONSTAT');
end $$;
