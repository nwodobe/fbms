-- Tests de la migration 9 (supports de formation) — réplique locale, données fictives, tout est annulé.
do $test$
declare
  u_bm uuid := 'f0000000-0000-4000-a000-000000000001'; u_abm uuid := 'f0000000-0000-4000-a000-000000000002';
  u_uh uuid := 'f0000000-0000-4000-a000-000000000003'; u_aud uuid := 'f0000000-0000-4000-a000-000000000007';
  c1 text := 'CONTROLE_SECURITE/' || gen_random_uuid() || '.pdf'; c2 text := 'CONTROLE_SECURITE/' || gen_random_uuid() || '.pdf';
  cx text := 'INCIDENTS/' || gen_random_uuid() || '.pdf';
  res jsonb := '[]'::jsonb; ok boolean; msg text; n int; r jsonb; v text;
begin
  insert into auth.users (id, email) values (u_bm,'t1@example.invalid'),(u_abm,'t2@example.invalid'),(u_uh,'t3@example.invalid'),(u_aud,'t7@example.invalid');
  insert into public.profils (user_id, email, nom, role, cluster, zone, fonction_operationnelle, actif) values
    (u_bm,'t1@example.invalid','TEST BM FICTIF','Branch Manager',null,null,null,true),
    (u_abm,'t2@example.invalid','TEST ABM FICTIF','Assistant Branch Manager',null,null,null,true),
    (u_uh,'t3@example.invalid','TEST UH FICTIF','Unit Head','SAKASSOU','GBEKE 1',null,true),
    (u_aud,'t7@example.invalid','TEST AUDIT FICTIF','Viewer / Auditor',null,null,null,true);

  for i in 1..12 loop
    begin
      ok := false; msg := '';
      if i = 1 then  -- BM dépose un PDF au bon chemin
        perform set_config('request.jwt.claims', json_build_object('sub', u_bm, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        insert into storage.objects (bucket_id, name, owner, metadata) values
          ('moto-formation', c1, u_bm, '{"size":1800000,"mimetype":"application/pdf"}'),
          ('moto-formation', c2, u_bm, '{"size":1700000,"mimetype":"application/pdf"}'),
          ('moto-formation', cx, u_bm, '{"size":1000,"mimetype":"image/png"}');
        ok := true; msg := 'BM : dépôt au chemin du module accepté';
      elsif i = 2 then  -- Chef d'unité ne dépose pas
        perform set_config('request.jwt.claims', json_build_object('sub', u_uh, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        begin insert into storage.objects (bucket_id, name, owner, metadata) values ('moto-formation', 'INCIDENTS/' || gen_random_uuid() || '.pdf', u_uh, '{"size":10,"mimetype":"application/pdf"}');
          msg := 'Chef d''unité : dépôt ACCEPTÉ';
        exception when others then ok := true; msg := 'Chef d''unité : dépôt refusé (' || sqlstate || ')'; end;
      elsif i = 3 then  -- BM : chemin hors module refusé
        perform set_config('request.jwt.claims', json_build_object('sub', u_bm, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        begin insert into storage.objects (bucket_id, name, owner, metadata) values ('moto-formation', 'autre/test.pdf', u_bm, '{"size":10,"mimetype":"application/pdf"}');
          msg := 'Chemin hors module ACCEPTÉ';
        exception when others then ok := true; msg := 'Chemin hors module refusé (' || sqlstate || ')'; end;
      elsif i = 4 then  -- BM enregistre le support
        perform set_config('request.jwt.claims', json_build_object('sub', u_bm, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        r := public.moto_formation_support_enregistrer('CONTROLE_SECURITE', c1, 'A_controle.pdf');
        ok := r ->> 'module_code' = 'CONTROLE_SECURITE'; msg := 'BM : support enregistré';
      elsif i = 5 then  -- Chef d'unité n'enregistre pas
        perform set_config('request.jwt.claims', json_build_object('sub', u_uh, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        begin perform public.moto_formation_support_enregistrer('CONTROLE_SECURITE', c2, 'x.pdf'); msg := 'Chef d''unité : enregistrement ACCEPTÉ';
        exception when others then ok := sqlstate = '42501'; msg := 'Chef d''unité : enregistrement refusé (' || sqlstate || ')'; end;
      elsif i = 6 then  -- fichier non PDF refusé
        perform set_config('request.jwt.claims', json_build_object('sub', u_abm, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        begin perform public.moto_formation_support_enregistrer('INCIDENTS', cx, 'x.png'); msg := 'Non-PDF ACCEPTÉ';
        exception when others then ok := sqlerrm like '%PDF%'; msg := 'Non-PDF refusé : ' || sqlerrm; end;
      elsif i = 7 then  -- fichier d'un autre module refusé
        perform set_config('request.jwt.claims', json_build_object('sub', u_abm, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        begin perform public.moto_formation_support_enregistrer('INCIDENTS', c2, 'x.pdf'); msg := 'Fichier d''un autre module ACCEPTÉ';
        exception when others then ok := true; msg := 'Fichier d''un autre module refusé : ' || sqlerrm; end;
      elsif i = 8 then  -- Chef d'unité lit le support et le fichier
        perform set_config('request.jwt.claims', json_build_object('sub', u_uh, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        select count(*) into n from public.moto_v_formation_supports;
        ok := n = 1; msg := 'Chef d''unité : supports lisibles ' || n;
        select count(*) into n from storage.objects where bucket_id = 'moto-formation' and name = c1;
        ok := ok and n = 1; msg := msg || ', fichier lisible ' || n;
      elsif i = 9 then  -- compte sans rôle AFLP FLEET : rien
        perform set_config('request.jwt.claims', json_build_object('sub', u_aud, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        select count(*) into n from public.moto_formation_supports; ok := n = 0; msg := 'Compte hors AFLP FLEET : supports ' || n;
        select count(*) into n from storage.objects where bucket_id = 'moto-formation'; ok := ok and n = 0; msg := msg || ', fichiers ' || n;
      elsif i = 10 then  -- immuable, même hors application
        begin update public.moto_formation_supports set nom_fichier = 'modifie.pdf'; msg := 'Modification ACCEPTÉE';
        exception when others then ok := true; msg := 'Modification refusée (' || sqlstate || ')'; end;
        begin delete from public.moto_formation_supports; ok := false; msg := msg || ' ; suppression ACCEPTÉE';
        exception when others then msg := msg || ' ; suppression refusée'; end;
      elsif i = 11 then  -- nouvelle version : la plus récente est affichée
        perform set_config('request.jwt.claims', json_build_object('sub', u_abm, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        perform pg_sleep(0.01);
        perform public.moto_formation_support_enregistrer('CONTROLE_SECURITE', c2, 'A_controle_v2.pdf');
        select nom_fichier into v from public.moto_v_formation_supports where module_code = 'CONTROLE_SECURITE';
        select count(*) into n from public.moto_formation_supports;
        ok := v = 'A_controle_v2.pdf' and n = 2; msg := 'Version affichée : ' || v || ', historique ' || n;
      elsif i = 12 then  -- anonyme : rien
        perform set_config('request.jwt.claims', '{}', true);
        execute 'set local role anon';
        begin select count(*) into n from public.moto_formation_supports; msg := 'Anonyme : lecture ACCEPTÉE (' || n || ')';
        exception when others then ok := true; msg := 'Anonyme : lecture refusée (' || sqlstate || ')'; end;
      end if;
      execute 'reset role';
    exception when others then
      execute 'reset role'; ok := false; msg := 'Erreur inattendue : ' || sqlerrm;
    end;
    res := res || jsonb_build_array(jsonb_build_object('test', i, 'ok', ok, 'resultat', left(msg, 160)));
  end loop;
  raise exception 'RESULTATS_ANNULES %', res;
end $test$;
