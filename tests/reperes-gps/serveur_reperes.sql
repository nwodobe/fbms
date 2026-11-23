-- =====================================================================
-- REPÈRES GPS · banc serveur (droits, consentement, idempotence, conflit, anciens clients)
-- ---------------------------------------------------------------------
-- À exécuter UNIQUEMENT sur une base de recette (données fictives).
-- Le bloc prend l'identité des comptes de recette, déroule les scénarios, puis se
-- termine VOLONTAIREMENT par une exception : la transaction est annulée, la base
-- reste exactement dans son état initial. Les verdicts sont dans le message d'erreur
-- (une ligne par contrôle, « OK » ou « ECHEC »).
-- Comptes de recette attendus : a1 = Branch Manager, a3 = Unit Head BROBO,
-- a4 = Assistant Unit Head BROBO, a5 = Unit Head BOTRO, a7 = Unit Head inactif.
-- =====================================================================
do $banc$
declare
  res text[] := '{}';
  u_bm uuid := '00000000-0000-4000-8000-0000000000a1'; u_uh uuid := '00000000-0000-4000-8000-0000000000a3';
  u_auh uuid := '00000000-0000-4000-8000-0000000000a4'; u_autre uuid := '00000000-0000-4000-8000-0000000000a5';
  u_inactif uuid := '00000000-0000-4000-8000-0000000000a7';
  v_panel uuid := '30000000-0000-4000-8000-000000000002';
  v_plot uuid; v_prod text; v_bloc uuid; v_arbre uuid; v_arbre2 uuid;
  r jsonb; x jsonb; n integer; t text; v_avant jsonb; v_apres jsonb; v_ordre bigint;

  -- p_qui : compte ; p_ops : lot. Renvoie le premier résultat, ou {statut:'EXCEPTION', message}.
begin
  select plot_id into v_plot from public.pheno_panels where id = v_panel;
  select producteur_id into v_prod from public.farmer_plots where id = v_plot;
  select id into v_bloc from public.pheno_blocs where panel_id = v_panel order by numero limit 1;
  select id into v_arbre from public.pheno_arbres where panel_id = v_panel and statut <> 'REMPLACE' order by code limit 1;
  select id into v_arbre2 from public.pheno_arbres where panel_id = v_panel and statut <> 'REMPLACE' and id <> v_arbre order by code limit 1;
  if v_plot is null or v_bloc is null or v_arbre is null then raise exception 'Jeu de recette incomplet (panel %).', v_panel; end if;

  -- ---------- 1. sans consentement : refus, rien d'écrit ----------
  perform set_config('request.jwt.claim.sub', u_uh::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_uh, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-01', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.689512, 'longitude', -5.031245, 'origine', 'SAISIE_MANUELLE'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'REJETEE' and x->>'code' = 'GR001' and x->>'message' ~ 'accord' then 'OK' else 'ECHEC' end || ' 01 sans consentement GPS : refus GR001 (' || coalesce(x->>'statut', '?') || ')');
  execute 'reset role';
  select count(*) into n from public.geo_reperes where plot_id = v_plot;
  res := array_append(res, case when n = 0 then 'OK' else 'ECHEC' end || ' 02 refus : aucune ligne écrite');

  -- Consentement fictif accordé (recette), en tant qu'administrateur de la base.
  select coalesce(max(event_order), 0) + 1 into v_ordre from public.farmer_consents;
  insert into public.farmer_consents (producteur_id, status, scopes, consent_at, agent_id, agent_name, text_version, method, source, created_by, created_at, event_order)
  values (v_prod, 'GRANTED', '{"gps": true}'::jsonb, now(), u_uh, 'BANC RECETTE', 'banc', 'VERBAL', 'FIELD_GPS_DECISION', u_uh, now(), v_ordre);
  select jsonb_build_object('lat', latitude, 'lng', longitude, 'st', gps_status, 'prec', gps_accuracy_m, 'ver', record_version) into v_avant from public.farmer_plots where id = v_plot;

  -- ---------- 2. saisie manuelle d'une parcelle, précision inconnue ----------
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-02', 'type', 'REPERE_ENREGISTRER', 'device_id', 'REP-banc', 'created_at_client', '2026-11-23T08:00:00Z',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.689512, 'longitude', -5.031245, 'origine', 'SAISIE_MANUELLE', 'source_externe', 'GPS de poche (banc)', 'releve_le', '2026-11-20T10:30:00Z'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'ACCEPTEE' and (x->>'version_no')::int = 1 and x->>'recu_serveur_le' is not null then 'OK' else 'ECHEC' end || ' 03 saisie manuelle parcelle : acceptée v1 avec accusé (' || coalesce(x->>'statut', '?') || ' ' || coalesce(x->>'message', '') || ')');
  -- rejeu de la même clé
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-02', 'type', 'REPERE_ENREGISTRER', 'device_id', 'REP-banc', 'created_at_client', '2026-11-23T08:00:00Z',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.689512, 'longitude', -5.031245, 'origine', 'SAISIE_MANUELLE', 'source_externe', 'GPS de poche (banc)', 'releve_le', '2026-11-20T10:30:00Z'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'ACCEPTEE' and (x->>'rejoue')::boolean then 'OK' else 'ECHEC' end || ' 04 rejeu de la même clé : même accusé, marqué rejoué');
  -- même clé, autre demande
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-02', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.70, 'longitude', -5.04, 'origine', 'SAISIE_MANUELLE'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'REJETEE' and x->>'message' ~ 'déjà utilisée' then 'OK' else 'ECHEC' end || ' 05 même clé, autre contenu : refusée');
  -- même contenu, NOUVELLE clé (double saisie identique) : pas de doublon
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-02-bis', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.689512, 'longitude', -5.031245, 'origine', 'SAISIE_MANUELLE', 'source_externe', 'GPS de poche (banc)', 'releve_le', '2026-11-20T10:30:00Z'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'ACCEPTEE' and (x->>'inchange')::boolean and (x->>'version_no')::int = 1 then 'OK' else 'ECHEC' end || ' 06 seconde saisie identique : acceptée sans nouvelle version');
  execute 'reset role';
  select count(*) into n from public.geo_reperes where objet_type = 'PARCELLE' and objet_id = v_plot;
  res := array_append(res, case when n = 1 then 'OK' else 'ECHEC' end || ' 07 une seule ligne après rejeux (' || n || ')');
  select case when precision_m is null and origine = 'SAISIE_MANUELLE' and statut = 'BROUILLON' and referentiel = 'WGS84' and releve_le = '2026-11-20T10:30:00Z'
              and saisi_le_client = '2026-11-23T08:00:00Z' and created_at > saisi_le_client and created_by = u_uh and latitude = 7.689512 and longitude = -5.031245
              and plot_id = v_plot and panel_id is null and source_externe = 'GPS de poche (banc)' and consentement_ref is not null then 'OK' else 'ECHEC' end
    into t from public.geo_reperes where objet_type = 'PARCELLE' and objet_id = v_plot and actif;
  res := array_append(res, coalesce(t, 'ECHEC') || ' 08 précision inconnue = NULL, origine manuelle, brouillon, WGS84, 3 dates distinctes, auteur, consentement tracé');
  select jsonb_build_object('lat', latitude, 'lng', longitude, 'st', gps_status, 'prec', gps_accuracy_m, 'ver', record_version) into v_apres from public.farmer_plots where id = v_plot;
  res := array_append(res, case when v_avant = v_apres then 'OK' else 'ECHEC' end || ' 09 farmer_plots intact (point de référence, gps_status, précision, version) : une saisie n''est pas une capture');

  -- ---------- 3. périmètre et comptes ----------
  perform set_config('request.jwt.claim.sub', u_autre::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_autre, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(
        jsonb_build_object('idempotency_key', 'banc-03a', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.1, 'longitude', -5.1, 'origine', 'SAISIE_MANUELLE', 'version_base', 1, 'motif', 'banc')),
        jsonb_build_object('idempotency_key', 'banc-03b', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'ARBRE', 'objet_id', v_arbre, 'latitude', 7.1, 'longitude', -5.1, 'origine', 'SAISIE_MANUELLE'))));
  res := array_append(res, case when r->'resultats'->0->>'code' = 'GR001' and r->'resultats'->1->>'code' = 'GR001' then 'OK' else 'ECHEC' end || ' 10 Chef d''Unité d''un autre cluster : parcelle et arbre refusés (GR001)');
  select count(*) into n from public.geo_reperes;
  res := array_append(res, case when n = 0 then 'OK' else 'ECHEC' end || ' 11 lecture RLS : un autre cluster ne voit aucun repère (' || n || ')');
  begin
    insert into public.geo_reperes (objet_type, objet_id, plot_id, producteur_id, latitude, longitude, origine, version_no, created_by) values ('PARCELLE', v_plot, v_plot, v_prod, 7, -5, 'SAISIE_MANUELLE', 9, u_autre);
    res := array_append(res, 'ECHEC 12 écriture directe possible');
  exception when insufficient_privilege then res := array_append(res, 'OK 12 écriture directe dans la table : refusée (aucun droit d''insertion)');
  end;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', u_inactif::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_inactif, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-04', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.1, 'longitude', -5.1, 'origine', 'SAISIE_MANUELLE'))));
    res := array_append(res, 'ECHEC 13 compte inactif accepté');
  exception when sqlstate 'GR001' then res := array_append(res, 'OK 13 compte inactif : lot entier refusé (GR001)');
  end;
  execute 'reset role';

  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '{}', true);
  begin
    perform count(*) from public.geo_reperes;
    res := array_append(res, 'ECHEC 14 lecture anonyme possible');
  exception when insufficient_privilege then res := array_append(res, 'OK 14 anonyme : aucune lecture de la table');
  end;
  begin
    perform public.geo_reperes_sync_batch('[]'::jsonb);
    res := array_append(res, 'ECHEC 15 fonction ouverte à anon');
  exception when insufficient_privilege then res := array_append(res, 'OK 15 anonyme : fonction de synchronisation non exécutable');
  end;
  execute 'reset role';

  -- ---------- 4. correction, historique, conflit entre deux appareils ----------
  perform set_config('request.jwt.claim.sub', u_auh::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_auh, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-05', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.689900, 'longitude', -5.031100, 'origine', 'SAISIE_MANUELLE', 'version_base', 1))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'REJETEE' and x->>'message' ~ 'motif' then 'OK' else 'ECHEC' end || ' 16 correction sans motif : refusée');
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-06', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.689900, 'longitude', -5.031100, 'origine', 'GPS_APPAREIL', 'precision_m', 6.4, 'releve_le', '2026-11-23T08:10:00Z', 'version_base', 1, 'motif', 'Relevé refait sur le champ (banc)'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'ACCEPTEE' and (x->>'version_no')::int = 2 then 'OK' else 'ECHEC' end || ' 17 correction motivée par l''assistant (appareil B) : v2 (' || coalesce(x->>'message', '') || ')');
  execute 'reset role';
  select case when count(*) = 2 and count(*) filter (where actif) = 1
              and bool_and(case when version_no = 1 then not actif and latitude = 7.689512 and created_by = u_uh
                                else actif and latitude = 7.6899 and remplace_id is not null and motif ~ 'banc' and created_by = u_auh and precision_m = 6.4 and origine = 'GPS_APPAREIL' end)
         then 'OK' else 'ECHEC' end into t from public.geo_reperes where objet_type = 'PARCELLE' and objet_id = v_plot;
  res := array_append(res, t || ' 18 historique : ancienne valeur conservée (v1 inactive), nouvelle valeur, auteurs et motif');

  -- L'appareil A (Chef d'Unité) croit toujours être en v1 et envoie une autre correction.
  perform set_config('request.jwt.claim.sub', u_uh::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_uh, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-07', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.688000, 'longitude', -5.030000, 'origine', 'SAISIE_MANUELLE', 'version_base', 1, 'motif', 'appareil A en retard'))));
  x := r->'resultats'->0;
  res := array_append(res, case when x->>'statut' = 'CONFLIT' and x->>'code' = 'GR409' and (x->'serveur'->>'version_no')::int = 2 and (x->'serveur'->>'latitude')::numeric = 7.6899 then 'OK' else 'ECHEC' end || ' 19 modification concurrente : CONFLIT, la version du serveur est renvoyée');
  -- le conflit n'est pas mémorisé comme un succès : la même clé peut être rejouée et reste un conflit
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-07', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.688000, 'longitude', -5.030000, 'origine', 'SAISIE_MANUELLE', 'version_base', 1, 'motif', 'appareil A en retard'))));
  res := array_append(res, case when r->'resultats'->0->>'statut' = 'CONFLIT' then 'OK' else 'ECHEC' end || ' 20 conflit rejoué : toujours un conflit');
  -- l'agent A maintient sa saisie en repartant de la version du serveur
  r := public.geo_reperes_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-08', 'type', 'REPERE_ENREGISTRER',
        'payload', jsonb_build_object('objet_type', 'PARCELLE', 'objet_id', v_plot, 'latitude', 7.688000, 'longitude', -5.030000, 'origine', 'SAISIE_MANUELLE', 'version_base', 2, 'motif', 'Maintien après comparaison (banc)'))));
  res := array_append(res, case when r->'resultats'->0->>'statut' = 'ACCEPTEE' and (r->'resultats'->0->>'version_no')::int = 3 then 'OK' else 'ECHEC' end || ' 21 résolution explicite : v3, rien d''écrasé en silence');
  execute 'reset role';
  select count(*) into n from public.geo_reperes where objet_type = 'PARCELLE' and objet_id = v_plot;
  res := array_append(res, case when n = 3 then 'OK' else 'ECHEC' end || ' 22 les trois versions sont conservées (' || n || ')');

  -- ---------- 5. coordonnées incorrectes ----------
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(
    jsonb_build_object('idempotency_key', 'banc-10', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 0, 'longitude', 0, 'origine', 'SAISIE_MANUELLE')),
    jsonb_build_object('idempotency_key', 'banc-11', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 95, 'longitude', -5, 'origine', 'SAISIE_MANUELLE')),
    jsonb_build_object('idempotency_key', 'banc-12', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 7.69, 'longitude', -181, 'origine', 'SAISIE_MANUELLE')),
    jsonb_build_object('idempotency_key', 'banc-13', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 7.69, 'longitude', 5.03, 'origine', 'SAISIE_MANUELLE')),
    jsonb_build_object('idempotency_key', 'banc-14', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 7.69, 'longitude', -5.03, 'origine', 'GPS_APPAREIL')),
    jsonb_build_object('idempotency_key', 'banc-15', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 'sept', 'longitude', -5.03, 'origine', 'SAISIE_MANUELLE')),
    jsonb_build_object('idempotency_key', 'banc-16', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 7.69, 'longitude', -5.03, 'origine', 'SAISIE_MANUELLE', 'releve_le', '2099-01-01T00:00:00Z')),
    jsonb_build_object('idempotency_key', 'banc-17', 'type', 'AUTRE_CHOSE', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc)),
    jsonb_build_object('idempotency_key', 'banc-18', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', gen_random_uuid(), 'latitude', 7.69, 'longitude', -5.03, 'origine', 'SAISIE_MANUELLE'))));
  select count(*) filter (where e->>'statut' = 'REJETEE' and e->>'code' = 'GR002') into n from jsonb_array_elements(r->'resultats') e;
  res := array_append(res, case when n = 9 then 'OK' else 'ECHEC' end || ' 23 neuf saisies incorrectes (0;0, bornes, hors pays non confirmé, capture sans précision, texte, date future, type inconnu, bloc inexistant) : ' || n || '/9 refusées avec explication');
  res := array_append(res, case when r->'resultats'->3->>'message' ~ 'hors de la Côte' then 'OK' else 'ECHEC' end || ' 24 signe oublié : message explicite, aucune correction du serveur');
  execute 'reset role';
  select count(*) into n from public.geo_reperes where objet_type = 'BLOC';
  res := array_append(res, case when n = 0 then 'OK' else 'ECHEC' end || ' 25 aucune ligne écrite pour les saisies refusées');

  -- ---------- 6. bloc et arbre : rattachements, pas de position inventée ----------
  execute 'set local role authenticated';
  r := public.geo_reperes_sync_batch(jsonb_build_array(
    jsonb_build_object('idempotency_key', 'banc-20', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'BLOC', 'objet_id', v_bloc, 'latitude', 48.856613, 'longitude', 2.352222, 'origine', 'SAISIE_MANUELLE', 'confirmer_hors_zone', true)),
    jsonb_build_object('idempotency_key', 'banc-21', 'type', 'REPERE_ENREGISTRER', 'payload', jsonb_build_object('objet_type', 'ARBRE', 'objet_id', v_arbre, 'latitude', '7.6895001', 'longitude', '-5.0312002', 'origine', 'SAISIE_MANUELLE', 'precision_m', 4))));
  res := array_append(res, case when r->'resultats'->0->>'statut' = 'ACCEPTEE' and (r->'resultats'->0->>'hors_zone_attendue')::boolean and r->'resultats'->1->>'statut' = 'ACCEPTEE' then 'OK' else 'ECHEC' end || ' 26 bloc hors pays CONFIRMÉ (signalé, non corrigé) et arbre : acceptés');
  execute 'reset role';
  select case when g.panel_id = v_panel and g.plot_id = v_plot and g.bloc_id = a.bloc_id and g.latitude = 7.6895001 and g.longitude = -5.0312002 and g.precision_m = 4
              then 'OK' else 'ECHEC' end into t
    from public.geo_reperes g join public.pheno_arbres a on a.id = g.objet_id where g.objet_type = 'ARBRE' and g.objet_id = v_arbre and g.actif;
  res := array_append(res, coalesce(t, 'ECHEC') || ' 27 arbre : rattaché à SON bloc, son panel et sa parcelle (retrouvés par le serveur) ; 7 décimales et signe préservés');
  select count(*) into n from public.geo_reperes where objet_type = 'ARBRE';
  res := array_append(res, case when n = 1 then 'OK' else 'ECHEC' end || ' 28 un seul arbre a une position : aucune position copiée ou inventée pour les autres (' || n || ')');
  select case when hors_zone_attendue and latitude = 48.856613 and bloc_id = v_bloc then 'OK' else 'ECHEC' end into t from public.geo_reperes where objet_type = 'BLOC' and objet_id = v_bloc and actif;
  res := array_append(res, coalesce(t, 'ECHEC') || ' 29 bloc hors zone : valeurs conservées telles que saisies, drapeau posé');

  -- ---------- 7. ANCIEN CLIENT : il modifie les objets enrichis sans connaître les repères ----------
  select jsonb_agg(to_jsonb(g) order by g.objet_type, g.version_no) into v_avant from public.geo_reperes g;
  perform set_config('request.jwt.claim.sub', u_uh::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_uh, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- a) marquage GPS d'un arbre par l'ancien écran de l'Observatoire
  r := public.pheno_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-ancien-1', 'type', 'ARBRE_MARQUER', 'device_id', 'OBS-banc', 'created_at_client', now()::text,
        'payload', jsonb_build_object('arbre_id', v_arbre, 'latitude', 7.6891, 'longitude', -5.0311, 'precision_m', 9))));
  res := array_append(res, case when r->'resultats'->0->>'statut' = 'ACCEPTEE' then 'OK' else 'ECHEC' end || ' 30 ancien client · ARBRE_MARQUER toujours accepté (' || coalesce(r->'resultats'->0->>'message', '') || ')');
  -- b) capture du point de parcelle par l'ancien écran Parcelles
  r := public.plot_map_sync_batch(jsonb_build_array(jsonb_build_object('idempotency_key', 'banc-ancien-2', 'type', 'LOCALISER', 'device_id', 'PM-banc', 'created_at_client', now()::text,
        'payload', jsonb_build_object('plot_id', v_plot, 'latitude', 7.6892, 'longitude', -5.0312, 'precision_m', 8, 'capture_le', now()::text, 'remplacer_point_verifie', true))));
  res := array_append(res, case when r->'resultats'->0->>'statut' = 'ACCEPTEE' then 'OK' else 'ECHEC' end || ' 31 ancien client · LOCALISER toujours accepté (' || coalesce(r->'resultats'->0->>'message', '') || ')');
  -- c) fiche producteur : réécriture de la ligne entière de la parcelle (upsert de l'ancien formulaire)
  begin
    update public.farmer_plots set local_name = local_name, notes = coalesce(notes, '') where id = v_plot;
    res := array_append(res, 'OK 32 ancien client · réécriture directe de la ligne farmer_plots toujours possible');
  exception when others then res := array_append(res, 'INFO 32 réécriture directe refusée par une règle existante : ' || sqlerrm);
  end;
  execute 'reset role';
  select jsonb_agg(to_jsonb(g) order by g.objet_type, g.version_no) into v_apres from public.geo_reperes g;
  res := array_append(res, case when v_avant = v_apres then 'OK' else 'ECHEC' end || ' 33 après trois écritures d''un ancien client : coordonnées, provenance, historique et rattachements des repères STRICTEMENT identiques');
  select case when a.latitude = 7.6891 and g.latitude = 7.6895001 then 'OK' else 'ECHEC' end into t
    from public.pheno_arbres a join public.geo_reperes g on g.objet_type = 'ARBRE' and g.objet_id = a.id and g.actif where a.id = v_arbre;
  res := array_append(res, coalesce(t, 'ECHEC') || ' 34 marquage Observatoire et repère saisi coexistent sans se confondre');

  -- ---------- 8. identité de l'arbre et du panel préservée ----------
  select case when count(*) = (select count(*) from public.pheno_arbres where panel_id = v_panel) then 'OK' else 'ECHEC' end into t
    from public.pheno_arbres where panel_id = v_panel and code is not null;
  res := array_append(res, t || ' 35 aucun arbre ajouté, retiré ni renuméroté dans le panel');

  raise exception E'VERDICTS REPERES GPS (transaction annulée, base inchangée)\n%', array_to_string(res, E'\n');
end
$banc$;
