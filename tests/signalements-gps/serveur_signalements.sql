-- =====================================================================
-- SIGNALEMENTS GPS · banc serveur (droits, motif, unicité, point intact, résolution)
-- ---------------------------------------------------------------------
-- À exécuter UNIQUEMENT sur une base de recette (données fictives).
-- Le bloc prend l'identité des comptes de recette, déroule les scénarios, puis se
-- termine VOLONTAIREMENT par une exception : la transaction est annulée, la base
-- reste exactement dans son état initial. Les verdicts sont dans le message d'erreur
-- (une ligne par contrôle, « OK » ou « ECHEC »).
-- Comptes de recette : a1 = Branch Manager, a3 = Unit Head BROBO, a4 = Assistant
-- Unit Head BROBO, a5 = Unit Head BOTRO, a7 = Unit Head inactif. La recette n'a pas
-- de Chef de Zone : le compte a8 (sans profil) le devient le temps du banc.
-- =====================================================================
do $banc$
declare
  res text[] := '{}';
  u_bm uuid := '00000000-0000-4000-8000-0000000000a1'; u_uh uuid := '00000000-0000-4000-8000-0000000000a3';
  u_auh uuid := '00000000-0000-4000-8000-0000000000a4'; u_autre uuid := '00000000-0000-4000-8000-0000000000a5';
  u_inactif uuid := '00000000-0000-4000-8000-0000000000a7'; u_zh uuid := '00000000-0000-4000-8000-0000000000a8';
  v_plot uuid; v_plot_vide uuid; v_lat numeric; v_lng numeric; v_avant jsonb; v_apres jsonb; v_rep public.geo_reperes; v_rep_avant jsonb;
  v_sig uuid; v_sig2 uuid; v_sig3 uuid; r jsonb; n integer; t text; v_anom integer;

  -- Appel d'une fonction sous une identité ; l'exception est rendue sous forme {erreur, code}.
begin
  select fp.id, fp.latitude, fp.longitude into v_plot, v_lat, v_lng from public.farmer_plots fp cross join lateral private.plot_map_contexte(fp.id) cx
   where not fp.deleted and fp.latitude is not null and cx.cluster_code = 'BROBO' and fp.id not in (select plot_id from public.geo_reperes) order by fp.id limit 1;
  select fp.id into v_plot_vide from public.farmer_plots fp cross join lateral private.plot_map_contexte(fp.id) cx
   where not fp.deleted and fp.latitude is null and cx.cluster_code = 'BROBO' order by fp.id limit 1;
  select g.* into v_rep from public.geo_reperes g cross join lateral private.plot_map_contexte(g.plot_id) cx where g.actif and cx.cluster_code = 'BROBO' order by g.created_at limit 1;
  if v_plot is null or v_plot_vide is null then raise exception 'Jeu de recette incomplet.'; end if;
  select count(*) into v_anom from public.farmer_plot_anomalies;
  select jsonb_build_object('lat', latitude, 'lng', longitude, 'st', gps_status, 'prec', gps_accuracy_m, 'le', gps_captured_at, 'ver', record_version) into v_avant from public.farmer_plots where id = v_plot;
  insert into public.profils (user_id, email, nom, role, zone, actif) values (u_zh, 'chef-zone-banc@recette.invalid', 'CHEF DE ZONE BANC', 'Zonal Head', 'GBEKE 1', true);

  -- ---------- 0. privilèges ----------
  res := array_append(res, case when not has_function_privilege('anon', 'public.geo_signalement_creer(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.geo_signalement_resoudre(uuid,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.geo_signalement_repondre(uuid,text)', 'execute')
      and not has_table_privilege('anon', 'public.geo_signalements', 'select') and not has_table_privilege('anon', 'public.geo_signalements_v', 'select')
      and not has_table_privilege('authenticated', 'public.geo_signalements', 'insert') and not has_table_privilege('authenticated', 'public.geo_signalements', 'update')
      and not has_table_privilege('authenticated', 'public.geo_signalements_evenements', 'insert') and not has_table_privilege('authenticated', 'public.geo_signalements_evenements', 'delete')
      then 'OK' else 'ECHEC' end || ' 00 anon : aucun droit ; connectés : lecture seule, aucune écriture directe');

  -- ---------- 1. Chef d'Unité : ne signale pas ----------
  perform set_config('request.jwt.claim.sub', u_uh::text, true);
  execute 'set local role authenticated';
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif_code', 'CAPTURE_HORS_CHAMP', 'motif', 'Point pris au village, pas au champ'));
        t := 'ECHEC'; exception when others then t := case when sqlstate = 'GS001' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 01 Chef d''Unité : signalement refusé (GS001)');
  execute 'reset role';

  -- ---------- 2. Branch Manager : contrôles du motif et du point vu ----------
  perform set_config('request.jwt.claim.sub', u_bm::text, true);
  execute 'set local role authenticated';
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif_code', 'CAPTURE_HORS_CHAMP', 'motif', 'court'));
        t := 'ECHEC'; exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 02 motif trop court : refus GS002');
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif', 'Point pris au village, pas au champ'));
        t := 'ECHEC'; exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 03 motif non choisi : refus GS002');
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif_code', 'CAPTURE_HORS_CHAMP', 'motif', 'Point pris au village, pas au champ',
          'point_latitude', v_lat + 0.01, 'point_longitude', v_lng));
        t := 'ECHEC'; exception when others then t := case when sqlstate = 'GS409' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 04 point vu à l''écran différent du serveur : refus GS409');
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot_vide, 'motif_code', 'AUTRE', 'motif', 'Aucun point mais on essaie'));
        t := 'ECHEC'; exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 05 parcelle sans point : rien à signaler (GS002)');

  r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif_code', 'CAPTURE_HORS_CHAMP',
         'motif', '  Point « capturé sur le champ » pris au village, champ à environ 4 km  ', 'point_latitude', v_lat, 'point_longitude', v_lng));
  v_sig := (r->>'signalement_id')::uuid;
  res := array_append(res, case when r->>'statut' = 'OUVERT' and v_sig is not null then 'OK' else 'ECHEC' end || ' 06 Branch Manager : signalement ouvert sans contour (' || coalesce(r->>'statut', '?') || ', distance village ' || coalesce(r->>'distance_village_m', 'inconnue') || ' m)');
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif_code', 'PRECISION_DOUTEUSE', 'motif', 'Deuxième signalement du même point'));
        t := 'ECHEC'; exception when others then t := case when sqlstate = 'GS409' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 07 second signalement ouvert du même point : refus GS409');
  execute 'reset role';

  select jsonb_build_object('lat', latitude, 'lng', longitude, 'st', gps_status, 'prec', gps_accuracy_m, 'le', gps_captured_at, 'ver', record_version) into v_apres from public.farmer_plots where id = v_plot;
  res := array_append(res, case when v_avant = v_apres then 'OK' else 'ECHEC' end || ' 08 farmer_plots intact (coordonnées, statut GPS, précision, date, version) : signaler ne modifie pas');
  select case when s.point_latitude = round(v_lat, 7) and s.point_longitude = round(v_lng, 7) and s.point_etat = v_avant->>'st' and s.motif = 'Point « capturé sur le champ » pris au village, champ à environ 4 km'
              and s.signale_par = u_bm and s.signale_role = 'BM' and s.cluster_code = 'BROBO' and s.zone_code = 'GBEKE_1' and s.statut = 'OUVERT' and s.repere_id is null then 'OK' else 'ECHEC' end
    into t from public.geo_signalements s where s.id = v_sig;
  res := array_append(res, coalesce(t, 'ECHEC') || ' 09 copie du point, motif épuré, auteur, rôle, cluster, zone, état OUVERT');
  select count(*) into n from public.geo_signalements_evenements where signalement_id = v_sig and action = 'SIGNALER';
  res := array_append(res, case when n = 1 then 'OK' else 'ECHEC' end || ' 10 journal : un événement SIGNALER');

  -- ---------- 3. lecture (RLS) ----------
  perform set_config('request.jwt.claim.sub', u_uh::text, true); execute 'set local role authenticated';
  select count(*) into n from public.geo_signalements_v where id = v_sig and statut = 'OUVERT'; execute 'reset role';
  res := array_append(res, case when n = 1 then 'OK' else 'ECHEC' end || ' 11 Chef d''Unité BROBO voit le signalement ouvert');
  perform set_config('request.jwt.claim.sub', u_auh::text, true); execute 'set local role authenticated';
  select count(*) into n from public.geo_signalements where id = v_sig; execute 'reset role';
  res := array_append(res, case when n = 1 then 'OK' else 'ECHEC' end || ' 12 assistant BROBO le voit aussi');
  perform set_config('request.jwt.claim.sub', u_autre::text, true); execute 'set local role authenticated';
  select count(*) into n from public.geo_signalements where id = v_sig; execute 'reset role';
  res := array_append(res, case when n = 0 then 'OK' else 'ECHEC' end || ' 13 Chef d''Unité d''un autre cluster : ne le voit pas (' || n || ')');
  perform set_config('request.jwt.claim.sub', u_inactif::text, true); execute 'set local role authenticated';
  select count(*) into n from public.geo_signalements where id = v_sig; execute 'reset role';
  res := array_append(res, case when n = 0 then 'OK' else 'ECHEC' end || ' 14 compte inactif : ne le voit pas');

  -- ---------- 4. réponse du Chef d'Unité ----------
  perform set_config('request.jwt.claim.sub', u_uh::text, true); execute 'set local role authenticated';
  begin r := public.geo_signalement_resoudre(v_sig, 'POINT_CONFIRME', 'Je confirme mon propre point'); t := 'ECHEC';
  exception when others then t := case when sqlstate = 'GS001' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 15 Chef d''Unité : ne peut pas résoudre (GS001)');
  begin r := public.geo_signalement_repondre(v_sig, 'ok'); t := 'ECHEC';
  exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 16 réponse trop courte : refus GS002');
  r := public.geo_signalement_repondre(v_sig, 'Agent envoyé sur le champ demain pour reprendre le point');
  res := array_append(res, case when r->>'statut' = 'OUVERT' then 'OK' else 'ECHEC' end || ' 17 Chef d''Unité répond, le signalement reste ouvert');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_autre::text, true); execute 'set local role authenticated';
  begin r := public.geo_signalement_repondre(v_sig, 'Réponse d''un autre cluster'); t := 'ECHEC';
  exception when others then t := case when sqlstate in ('GS001', 'GS002') then 'OK' else 'ECHEC ' || sqlstate end; end;
  execute 'reset role';
  res := array_append(res, t || ' 18 Chef d''Unité d''un autre cluster : réponse refusée');
  perform set_config('request.jwt.claim.sub', u_inactif::text, true); execute 'set local role authenticated';
  begin r := public.geo_signalement_repondre(v_sig, 'Réponse d''un compte inactif'); t := 'ECHEC';
  exception when others then t := case when sqlstate = 'GS001' then 'OK' else 'ECHEC ' || sqlstate end; end;
  execute 'reset role';
  res := array_append(res, t || ' 19 compte inactif : réponse refusée');

  -- ---------- 5. résolution ----------
  perform set_config('request.jwt.claim.sub', u_bm::text, true); execute 'set local role authenticated';
  begin r := public.geo_signalement_resoudre(v_sig, 'POINT_CORRIGE', 'Point repris sur le champ'); t := 'ECHEC';
  exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 20 « Point corrigé » alors que le point n''a pas changé : refus GS002');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_bm::text, true);   -- garde des habilitations : seul le BM modifie un profil
  update public.profils set zone = 'GBEKE 2' where user_id = u_zh;
  perform set_config('request.jwt.claim.sub', u_zh::text, true); execute 'set local role authenticated';
  select count(*) into n from public.geo_signalements where id = v_sig;
  begin r := public.geo_signalement_resoudre(v_sig, 'POINT_CONFIRME', 'Chef de Zone d''une autre zone'); t := 'ECHEC';
  exception when others then t := case when sqlstate in ('GS001', 'GS002') then 'OK' else 'ECHEC ' || sqlstate end; end;
  execute 'reset role';
  res := array_append(res, case when n = 0 then t else 'ECHEC' end || ' 21 Chef de Zone d''une autre zone : ne voit ni ne résout (' || n || ')');
  perform set_config('request.jwt.claim.sub', u_bm::text, true);
  update public.profils set zone = 'GBEKE 1' where user_id = u_zh;
  perform set_config('request.jwt.claim.sub', u_zh::text, true); execute 'set local role authenticated';
  select count(*) into n from public.geo_signalements where id = v_sig;
  begin r := public.geo_signalement_resoudre(v_sig, 'POINT_CONFIRME', 'trop'); t := 'ECHEC';
  exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, case when n = 1 then t else 'ECHEC' end || ' 22 Chef de Zone de la zone voit ; résolution non motivée refusée');
  r := public.geo_signalement_resoudre(v_sig, 'POINT_CONFIRME', 'Contrôle sur place : le point est bien sur le champ');
  res := array_append(res, case when r->>'statut' = 'CLASSE' then 'OK' else 'ECHEC' end || ' 23 Chef de Zone : point confirmé, signalement classé');
  begin r := public.geo_signalement_resoudre(v_sig, 'SANS_SUITE', 'Deuxième résolution du même signalement'); t := 'ECHEC';
  exception when others then t := case when sqlstate = 'GS409' then 'OK' else 'ECHEC ' || sqlstate end; end;
  res := array_append(res, t || ' 24 seconde résolution : refus GS409');
  begin r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'POINT_PARCELLE', 'plot_id', v_plot, 'motif_code', 'POSITION_INCOHERENTE', 'motif', 'Nouveau doute du Chef de Zone sur ce point'));
        v_sig2 := (r->>'signalement_id')::uuid; t := case when r->>'statut' = 'OUVERT' then 'OK' else 'ECHEC' end;
  exception when others then t := 'ECHEC ' || sqlstate || ' ' || sqlerrm; end;
  res := array_append(res, t || ' 25 Chef de Zone : nouveau signalement possible une fois le précédent clos');
  execute 'reset role';
  select case when resolu_par = u_zh and resolu_role = 'ZH' and resolution_code = 'POINT_CONFIRME' and resolution_motif is not null and resolu_le is not null then 'OK' else 'ECHEC' end
    into t from public.geo_signalements where id = v_sig;
  select count(*) into n from public.geo_signalements_evenements where signalement_id = v_sig;
  res := array_append(res, case when n = 3 then t else 'ECHEC' end || ' 26 résolution tracée (auteur, rôle, motif, date) ; journal à 3 événements (' || n || ')');

  -- Le point est repris sur le champ (simulé en administrateur de la base de recette).
  update public.farmer_plots set latitude = round(v_lat + 0.03, 7) where id = v_plot;
  perform set_config('request.jwt.claim.sub', u_zh::text, true); execute 'set local role authenticated';
  r := public.geo_signalement_resoudre(v_sig2, 'POINT_CORRIGE', 'Point repris sur le champ par l''agent, à 4 km du village');
  execute 'reset role';
  res := array_append(res, case when r->>'statut' = 'RESOLU' then 'OK' else 'ECHEC' end || ' 27 point réellement changé : « Point corrigé » accepté, signalement résolu');

  -- ---------- 6. repère GPS ----------
  if v_rep.id is null then
    res := array_append(res, 'ECHEC 28-31 aucun repère actif BROBO en recette : scénario repère non joué');
  else
    select to_jsonb(g) into v_rep_avant from public.geo_reperes g where g.id = v_rep.id;
    perform set_config('request.jwt.claim.sub', u_bm::text, true); execute 'set local role authenticated';
    r := public.geo_signalement_creer(jsonb_build_object('cible_type', 'REPERE', 'repere_id', v_rep.id, 'motif_code', 'POSITION_INCOHERENTE', 'motif', 'Repère éloigné du contour annoncé',
           'point_latitude', v_rep.latitude, 'point_longitude', v_rep.longitude));
    v_sig3 := (r->>'signalement_id')::uuid;
    execute 'reset role';
    select case when cible_type = 'REPERE' and repere_id = v_rep.id and repere_objet_type = v_rep.objet_type and repere_objet_id = v_rep.objet_id and plot_id = v_rep.plot_id
                 and point_latitude = v_rep.latitude and point_etat = v_rep.origine then 'OK' else 'ECHEC' end into t from public.geo_signalements where id = v_sig3;
    res := array_append(res, coalesce(t, 'ECHEC') || ' 28 repère signalé : rattachement et copie du repère');
    res := array_append(res, case when (select to_jsonb(g) from public.geo_reperes g where g.id = v_rep.id) = v_rep_avant then 'OK' else 'ECHEC' end || ' 29 repère intact (ni actif, ni statut, ni coordonnées modifiés)');
    perform set_config('request.jwt.claim.sub', u_bm::text, true); execute 'set local role authenticated';
    begin r := public.geo_signalement_resoudre(v_sig3, 'POINT_CORRIGE', 'Prétendue correction du repère'); t := 'ECHEC';
    exception when others then t := case when sqlstate = 'GS002' then 'OK' else 'ECHEC ' || sqlstate end; end;
    res := array_append(res, t || ' 30 repère sans nouvelle version : « Point corrigé » refusé');
    r := public.geo_signalement_resoudre(v_sig3, 'SANS_SUITE', 'Repère vérifié sur la carte, écart expliqué');
    res := array_append(res, case when r->>'statut' = 'CLASSE' then 'OK' else 'ECHEC' end || ' 31 classement sans suite motivé');
    execute 'reset role';
  end if;

  -- ---------- 7. aucun effet de bord ----------
  select count(*) into n from public.farmer_plot_anomalies;
  res := array_append(res, case when n = v_anom then 'OK' else 'ECHEC' end || ' 32 farmer_plot_anomalies inchangée (' || n || ')');
  perform set_config('request.jwt.claim.sub', u_auh::text, true); execute 'set local role authenticated';
  begin insert into public.geo_signalements (cible_type, plot_id, producteur_id, point_latitude, point_longitude, motif_code, motif, signale_par, signale_role)
        values ('POINT_PARCELLE', v_plot, 'x', 7, -5, 'AUTRE', 'Écriture directe interdite', u_auh, 'AUH'); t := 'ECHEC';
  exception when insufficient_privilege then t := 'OK'; when others then t := 'ECHEC ' || sqlstate; end;
  res := array_append(res, t || ' 33 écriture directe dans la table refusée (droits)');
  begin update public.geo_signalements set statut = 'CLASSE' where id = v_sig2; t := 'ECHEC';
  exception when insufficient_privilege then t := 'OK'; when others then t := 'ECHEC ' || sqlstate; end;
  execute 'reset role';
  res := array_append(res, t || ' 34 modification directe refusée (droits)');

  raise exception E'BANC SIGNALEMENTS GPS (transaction annulée)\n%', array_to_string(res, E'\n');
end $banc$;
