-- =============================================================================
-- Matrice de droits · consentements et vérification du Farmer Passport
-- Exécute le correctif PREPARE_20261025_… DANS une transaction puis l'annule :
-- aucune donnée ni règle n'est persistée (RAISE final).
-- Remplacer les identifiants <…> par ceux des comptes réels de la base de test.
-- Résultat attendu (observé le 25/10/2026) : voir docs/regularisation_aflp_20261025/07_*.md
-- =============================================================================
do $do$
declare
  bm   uuid := '<UUID_BRANCH_MANAGER>';
  uhdj uuid := '<UUID_UNIT_HEAD_DJEBONOUA>';
  uhbo uuid := '<UUID_UNIT_HEAD_BOTRO>';
  zh1  uuid := '<UUID_ZONAL_HEAD_1>';
  zh2  uuid := '<UUID_ZONAL_HEAD_2>';
  sup  uuid := '<UUID_SUPERVISOR>';
  nop  uuid := gen_random_uuid();                 -- compte sans profil
  vdj  text := '<VILLAGE_DJEBONOUA>';
  vbo  text := '<VILLAGE_BOTRO>';
  log text := ''; p_dj text; p_bo text; p_zh text; p_bo2 text;
begin
  -- Aides (fonctions temporaires, détruites avec la transaction)
  execute $f$
  create function pg_temp.as_user(u uuid) returns void language plpgsql as $g$
  begin
    perform set_config('role','postgres',true);
    perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
    perform set_config('role','authenticated',true);
  end $g$;
  create function pg_temp.as_admin() returns void language plpgsql as $g$
  begin perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true); end $g$;
  create function pg_temp.try_consent(u uuid, pid text, agent uuid, st text default 'PARTIAL', fut boolean default false) returns text language plpgsql as $g$
  begin
    perform pg_temp.as_user(u);
    insert into public.farmer_consents(producteur_id,status,scopes,consent_at,text_version,method,source,agent_id,created_by)
    values (pid, case when st='GRANTED_COMPLET' then 'GRANTED' else st end,
            case when st='PARTIAL' then '{"identity":true,"agriculture":true}'::jsonb
                 when st='GRANTED_COMPLET' then '{"identity":true,"agriculture":true,"gps":true,"photos":true,"training":true,"inspections":true,"transactions":true}'::jsonb
                 else '{"identity":true}'::jsonb end,
            case when fut then now()+interval '5 day' else now() end,'AFLP-DATA-CONSENT-2026.1','VERBAL','QA_MATRICE',agent,u);
    perform pg_temp.as_admin(); return 'AUTORISÉ';
  exception when others then perform pg_temp.as_admin(); return 'REFUSÉ';
  end $g$;
  create function pg_temp.try_verif(u uuid, pid text, st text default 'APPROVED') returns text language plpgsql as $g$
  declare m text;
  begin
    perform pg_temp.as_user(u);
    insert into public.farmer_verifications(producteur_id,status,verification_method,checks)
    values (pid, st, 'SUPERVISOR_REVIEW','{"identity_checked":true,"plot_checked":true,"baseline_checked":true}');
    perform pg_temp.as_admin(); return 'AUTORISÉ';
  exception when others then m := sqlerrm; perform pg_temp.as_admin();
    return 'REFUSÉ (' || case when m like 'Séparation%' then 'séparation des tâches' when m like '%row-level%' then 'RLS/périmètre' else left(m,60) end || ')';
  end $g$;
  create function pg_temp.mk(u uuid, vid text) returns text language plpgsql as $g$
  declare pid text := 'qa-mat-'||substr(md5(random()::text),1,10); pl uuid; pb uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); rt text;
  begin
    select rt_id into rt from public.producteurs where village_id=vid and rt_id is not null limit 1;
    perform pg_temp.as_user(u);
    insert into public.producteurs(id,nom,prenoms,sexe,birth_year,telephone,village_id,rt_id,statut,is_qa,data)
    values (pid,'QA MATRICE','TEST '||upper(substr(md5(pid),1,6)),'F',1985,'07'||lpad((floor(random()*1e8))::bigint::text,8,'0'),vid,rt,'Identifié',true,jsonb_build_object('id',pid,'source','QA_MATRICE'));
    insert into public.farmer_consents(producteur_id,status,scopes,consent_at,text_version,method,source)
    values (pid,'GRANTED','{"identity":true,"agriculture":true,"gps":true,"photos":true,"training":true,"inspections":true,"transactions":true}',now(),'AFLP-DATA-CONSENT-2026.1','VERBAL','QA_MATRICE');
    insert into public.farmer_plots(producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,gps_accuracy_m,gps_captured_at,gps_status,area_source,evidence_level,status)
    values (pid,vid,'QA',1.2,'HA',7.6,-5.0,8,now(),'POINT_CAPTURED','DECLARED','DECLARED','ACTIVE') returning id into pl;
    insert into public.farmer_production_baselines(id,producteur_id,campaign,productive_area_ha,previous_production_kg,forecast_kg,productive_tree_count,data_source,evidence_level,status)
    values (pb,pid,'2027',1.2,500,600,120,'FIELD_DECLARATION','DECLARED','DRAFT');
    perform public.farmer_finalize_production_baseline(pb);
    insert into public.farmer_sustainability_baselines(id,producteur_id,plot_id,campaign,catalog_version,status,inspection_date)
    values (sb,pid,pl,'2027','AFLP-SUST-2026.2','DRAFT',current_date);
    insert into public.farmer_sustainability_answers(baseline_id,question_code,catalog_version,answer,evidence_level)
    select sb,q.question_code,q.catalog_version,(select a from unnest(array['YES','NO','NOT_APPLICABLE','PARTIAL']) a where not (a = any(coalesce(q.risk_trigger_answers,'{}'))) limit 1),'DECLARED'
    from public.sustainability_question_catalog q where q.catalog_version='AFLP-SUST-2026.2' and q.active;
    perform public.farmer_finalize_sustainability_baseline(sb);
    perform pg_temp.as_admin();
    return pid;
  end $g$;
  $f$;

  -- Producteurs existants (lecture seule) pour les tests de consentement
  select id into p_dj from public.producteurs where village_id=vdj and not deleted limit 1;
  select id into p_bo from public.producteurs where village_id=vbo and not deleted limit 1;

  -- AVANT correctif : comportement actuel de production
  log := log || 'C0 [avant correctif] Unit Head consentement dans son périmètre : ' || pg_temp.try_consent(uhdj,p_dj,uhdj) || E'\n';

  -- Application du correctif DANS la transaction
  execute 'alter policy farmer_consents_insert on public.farmer_consents with check (private.farmer_registry_can_capture() and created_by = auth.uid() and agent_id = auth.uid() and private.farmer_registry_can_access_producteur(producteur_id))';
  execute $f$
  create or replace function private.farmer_verification_separation_guard() returns trigger language plpgsql security definer set search_path = public, private as $g$
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null or new.status is distinct from 'APPROVED' then return new; end if;
    if exists (select 1 from public.producteurs p where p.id = new.producteur_id and p.created_by_user_id = v_uid)
    or exists (select 1 from public.farmer_consents c where c.producteur_id = new.producteur_id and v_uid in (c.agent_id, c.created_by))
    or exists (select 1 from public.farmer_plots fp where fp.producteur_id = new.producteur_id and not fp.deleted and fp.status = 'ACTIVE' and v_uid in (fp.created_by, fp.gps_captured_by))
    or exists (select 1 from public.farmer_production_baselines b where b.producteur_id = new.producteur_id and b.status = 'FINAL' and v_uid in (b.captured_by, b.finalized_by, b.created_by))
    or exists (select 1 from public.farmer_sustainability_baselines b where b.producteur_id = new.producteur_id and b.status = 'FINAL' and v_uid in (b.captured_by, b.finalized_by, b.created_by))
    or exists (select 1 from public.farmer_inspections i where i.producteur_id = new.producteur_id and i.status = 'FINAL' and v_uid in (i.inspector_id, i.finalized_by, i.created_by))
    then raise exception 'Séparation des tâches : vérification par un autre superviseur requise.' using errcode = '42501'; end if;
    return new;
  end $g$;
  $f$;
  execute 'create trigger trg_farmer_verification_separation before insert or update on public.farmer_verifications for each row execute function private.farmer_verification_separation_guard()';

  -- Consentements
  log := log || 'C1 Unit Head, producteur de son cluster : ' || pg_temp.try_consent(uhdj,p_dj,uhdj) || E'\n';
  log := log || 'C2 Unit Head, producteur d''un autre cluster : ' || pg_temp.try_consent(uhdj,p_bo,uhdj) || E'\n';
  log := log || 'C3 Unit Head, consentement imputé à un autre agent : ' || pg_temp.try_consent(uhdj,p_dj,zh1) || E'\n';
  log := log || 'C4 Zonal Head, tout cluster : ' || pg_temp.try_consent(zh1,p_bo,zh1) || E'\n';
  log := log || 'C5 Branch Manager : ' || pg_temp.try_consent(bm,p_bo,bm) || E'\n';
  log := log || 'C6 Supervisor (profil sans cluster ni zone) : ' || pg_temp.try_consent(sup,p_dj,sup) || E'\n';
  log := log || 'C7 Compte sans profil : ' || pg_temp.try_consent(nop,p_dj,nop) || E'\n';
  update public.profils set actif=false where user_id=uhdj;
  log := log || 'C8 Unit Head désactivé : ' || pg_temp.try_consent(uhdj,p_dj,uhdj) || E'\n';
  update public.profils set actif=true where user_id=uhdj;
  log := log || 'C9 GRANTED sans tous les périmètres : ' || pg_temp.try_consent(uhdj,p_dj,uhdj,'GRANTED') || E'\n';
  log := log || 'C10 Date de consentement future : ' || pg_temp.try_consent(uhdj,p_dj,uhdj,'PARTIAL',true) || E'\n';

  -- Vérifications
  p_dj := pg_temp.mk(uhdj, vdj);                  -- dossier complet saisi par le Unit Head Djebonoua
  log := log || 'V1 Auteur (Unit Head) approuve son dossier : ' || pg_temp.try_verif(uhdj,p_dj) || E'\n';
  log := log || 'V2 Auteur rejette son dossier (REJECTED) : ' || pg_temp.try_verif(uhdj,p_dj,'REJECTED') || E'\n';
  log := log || 'V3 Unit Head d''un autre cluster approuve : ' || pg_temp.try_verif(uhbo,p_dj) || E'\n';
  log := log || 'V4 Zonal Head approuve le dossier du Unit Head : ' || pg_temp.try_verif(zh1,p_dj) || E'\n';
  p_zh := pg_temp.mk(zh1, vbo);                   -- dossier saisi par un Zonal Head
  log := log || 'V5 Zonal Head auteur approuve son dossier : ' || pg_temp.try_verif(zh1,p_zh) || E'\n';
  log := log || 'V6 Second Zonal Head approuve : ' || pg_temp.try_verif(zh2,p_zh) || E'\n';
  p_bo2 := pg_temp.mk(uhbo, vbo);
  perform pg_temp.try_consent(bm,p_bo2,bm,'GRANTED_COMPLET'); -- le Branch Manager recueille un consentement (complet, pour ne pas dégrader le passeport)
  log := log || 'V7 Branch Manager ayant recueilli un consentement approuve : ' || pg_temp.try_verif(bm,p_bo2) || E'\n';
  log := log || 'V8 Second Zonal Head approuve ce même dossier : ' || pg_temp.try_verif(zh2,p_bo2) || E'\n';
  log := log || 'V9 Branch Manager non impliqué approuve le dossier du Zonal Head : ' || pg_temp.try_verif(bm,p_zh) || E'\n';

  raise exception E'MATRICE (transaction annulée)\n%', log;
end $do$;
