-- =============================================================================
-- AFLP FLEET 10 — Aptitude technique et parcours de mise en service
-- -----------------------------------------------------------------------------
-- STATUT : APPLIQUÉ EN PRODUCTION le 03/11/2026 sur demande du Branch Manager
-- (« corrige les défauts et adoucis le module »), migrations Supabase
-- aflp_fleet_10_aptitude_mise_en_service et aflp_fleet_10b_formation_search_path.
-- Empreintes des 8 fonctions identiques à la réplique testée ; 0 statut changé.
-- L'écran (moto/*.js) reste à publier par la fusion de la PR #286.
--
-- Objet : rendre le parcours « moto apte » plus simple SANS baisser la sécurité.
--   1. Le résultat de l'évaluation est CALCULÉ par le serveur (plus de
--      conclusion manuelle « Apte » saisie par l'utilisateur) :
--        - point critique en défaut           -> INAPTE + immobilisation (inchangé)
--        - point bloquant pour la circulation -> INAPTE (nouveau : avant, le
--          client pouvait conclure APTE malgré un éclairage ou un klaxon HS)
--        - avis défavorable du mécanicien     -> INAPTE
--        - autres défauts, chacun justifié     -> APTE (affiché « Apte avec réserves »)
--   2. Le garage devient facultatif ; le nom du mécanicien qualifié reste
--      obligatoire (c'est lui qui atteste le contrôle physique).
--   3. Après réparation, un contrôle de remise en service APTE (contre-visite,
--      indépendante de l'utilisateur de la moto) rend la moto apte sans
--      refaire l'inspection initiale complète. Une inspection initiale reste
--      exigée au moins une fois (état de référence, photos, compteur).
--      Le contrôle de remise en service recalcule désormais le statut et
--      immobilise la moto sur un point critique, comme l'inspection.
--   4. Tout défaut affectant la sécurité de circulation, ouvert et non vérifié,
--      bloque la mise en service et retire « autorisée à circuler » dans la vue
--      flotte, même s'il n'est pas « critique » au catalogue.
--   4b. Un contrôle complet ultérieur (contre-visite ou nouvelle évaluation)
--      qui constate un point corrigé clôture l'action correspondante, sauf
--      action critique, utilisateur de la moto ou auteur de la réparation.
--   5. Nouvelle lecture public.moto_aptitude(moto) : la liste courte des
--      exigences restantes, calculée par le serveur (fin de l'écart entre les
--      conditions affichées par l'écran et celles vérifiées par le serveur).
--
-- Ce que la migration NE fait PAS :
--   - aucune table, aucun statut, aucune colonne de table nouvelle ;
--   - aucune modification de statut d'une moto existante (aucun recalcul
--     n'est lancé ; simulation sur la production du 03/11/2026 : 0 changement) ;
--   - aucune réécriture des contrôles déjà enregistrés ;
--   - aucun bouton « Forcer apte » : aucune voie ne rend une moto apte sans
--     contrôle physique attesté par un intervenant nommé ;
--   - aucun droit RLS modifié.
--
-- Rejouable (create or replace / on conflict do nothing).
-- Retour arrière : 20261106090100_aflp_fleet_10_rollback.sql
-- =============================================================================

-- 1. Paramètre : points non critiques qui bloquent néanmoins la circulation ---
--    Provisoire : décision métier à confirmer par le Branch Manager
--    (modifiable par public.moto_parametre_modifier, journalisé).
insert into public.moto_parametres (cle, valeur_json, description, provisoire)
values ('points_circulation_bloquants',
        '["ECLAIRAGE","KLAXON","RETROVISEURS","CHAINE","NUMEROS","TRANSMISSION"]'::jsonb,
        'Points de contrôle non critiques dont le défaut bloque la circulation tant qu''il n''est pas corrigé et vérifié. Les points critiques du catalogue bloquent toujours.',
        true)
on conflict (cle) do nothing;

-- 2. Fonctions d'aide ---------------------------------------------------------
create or replace function private.moto_points_bloquants()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((select array(select upper(btrim(x)) from jsonb_array_elements_text(valeur_json) x)
                     from public.moto_parametres where cle = 'points_circulation_bloquants'), '{}'::text[])
$function$;

-- Défauts ouverts (non clôturés après vérification) qui empêchent de circuler.
create or replace function private.moto_defauts_bloquants(p_moto uuid)
 returns text[]
 language sql
 stable security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
  select coalesce(array_agg(a.anomalie order by a.constat_at), '{}'::text[])
    from public.moto_actions_correctives a
   where a.moto_id = p_moto
     and a.statut in ('OUVERTE','PLANIFIEE','REALISEE')
     and (a.gravite = 'CRITIQUE' or upper(coalesce(a.point_code, '')) = any(private.moto_points_bloquants()))
$function$;

revoke all on function private.moto_points_bloquants() from public, anon;
revoke all on function private.moto_defauts_bloquants(uuid) from public, anon;
grant execute on function private.moto_defauts_bloquants(uuid) to authenticated;   -- appelée par la vue moto_v_flotte (security_invoker)
grant execute on function private.moto_points_bloquants() to authenticated;

-- 2b. Clôture des défauts constatés corrigés par un contrôle complet --------
--     Assouplissement (03/11/2026, demande du Branch Manager) : quand un
--     contrôle complet ultérieur (contre-visite ou nouvelle évaluation)
--     constate CONFORME un point qui avait une action corrective ouverte, cette
--     action est clôturée, la vérification étant ce contrôle physique attesté.
--     Garde-fous : jamais une action CRITIQUE (circuit de l'immobilisation
--     inchangé) ; jamais par l'utilisateur de la moto ; jamais par la personne
--     qui a déclaré la réparation (séparation des tâches) ; uniquement les
--     défauts constatés avant ce contrôle.
create or replace function private.moto_cloturer_corrigees(p_moto uuid, p_controle uuid, p_items jsonb, p_libelle text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_n integer := 0; v_ctrl public.moto_controles;
begin
  if auth.uid() is null or private.moto_affectataire(p_moto) is not distinct from auth.uid() then return 0; end if;
  select * into v_ctrl from public.moto_controles where id = p_controle;
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_actions_correctives a
     set statut = 'CLOTUREE', verifie_par = auth.uid(), verifie_at = now(),
         realise_at = coalesce(a.realise_at, v_ctrl.date_controle::date),   -- correction constatée au plus tard ce jour-là
         verification_note = left('Constaté corrigé au contrôle « '||p_libelle||' » du '||to_char(v_ctrl.date_controle, 'DD/MM/YYYY')
                                  ||coalesce(' par '||v_ctrl.intervenant_nom, '')||'.', 500)
   where a.moto_id = p_moto and a.statut in ('OUVERTE','PLANIFIEE','REALISEE') and a.gravite <> 'CRITIQUE'
     and a.realise_par is distinct from auth.uid() and a.constat_at < v_ctrl.created_at
     and exists (select 1 from jsonb_array_elements(p_items) e where (e ->> 'ok')::boolean and upper(e ->> 'code') = upper(a.point_code));
  get diagnostics v_n = row_count;
  return v_n;
end $function$;
revoke all on function private.moto_cloturer_corrigees(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- 3. Inspection initiale / état de référence : résultat calculé ---------------
create or replace function public.moto_inspection_initiale(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_chk jsonb; v_crit boolean; v_res text; v_id uuid;
        v_rapport uuid := private.moto_uuid(p, 'rapport_document_id'); m public.moto_motos; v_ref boolean;
        v_bloq text[] := private.moto_points_bloquants(); v_bloquants text[] := '{}'; v_reserves text[] := '{}';
        v_sans_justif text[] := '{}'; v_defav boolean; v_clot integer := 0; v_obs text := nullif(btrim(coalesce(p ->> 'observations', '')), ''); it jsonb;
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  m := private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if m.situation_parc = 'PREVUE' then perform private.moto_erreur('Moto non réceptionnée : enregistrez d''abord la réception.'); end if;
  -- Le mécanicien nommé atteste le contrôle physique : jamais facultatif. Le garage l'est.
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null then
    perform private.moto_erreur('Nom du mécanicien qualifié obligatoire : il atteste le contrôle physique.');
  end if;
  if v_rapport is not null and not exists (select 1 from public.moto_documents where id = v_rapport and moto_id = v_moto and type_document = 'RAPPORT_MECANICIEN') then
    perform private.moto_erreur('Le rapport doit être un document RAPPORT_MECANICIEN de cette moto.');
  end if;
  v_ref := m.origine = 'EN_EXPLOITATION';
  if v_ref and private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('État de référence : relevé du compteur obligatoire.'); end if;
  v_chk := private.moto_items_controles('INSPECTION_INITIALE', p -> 'items');
  v_crit := (v_chk ->> 'critique')::boolean;
  -- Classement des défauts non critiques : bloquant pour la circulation ou réserve.
  for it in select * from jsonb_array_elements(v_chk -> 'items') loop
    if not (it ->> 'ok')::boolean and not (it ->> 'critique')::boolean then
      if upper(it ->> 'code') = any(v_bloq) then
        v_bloquants := v_bloquants || (it ->> 'libelle');
      else
        v_reserves := v_reserves || (it ->> 'libelle');
        if nullif(it ->> 'observation', '') is null and coalesce(length(v_obs), 0) < 10 then
          v_sans_justif := v_sans_justif || (it ->> 'libelle');
        end if;
      end if;
    end if;
  end loop;
  -- Avis défavorable du mécanicien : explicite (nouvel écran) ou conclusion INAPTE d'un ancien écran encore en cache.
  v_defav := coalesce(p ->> 'avis_defavorable', 'false') = 'true' or upper(coalesce(p ->> 'resultat', '')) = 'INAPTE';
  if coalesce(p ->> 'avis_defavorable', 'false') = 'true' and nullif(btrim(p ->> 'avis_mecanicien'), '') is null then
    perform private.moto_erreur('Avis défavorable : précisez l''avis du mécanicien.');
  end if;
  if not v_crit and cardinality(v_bloquants) = 0 and not v_defav and cardinality(v_sans_justif) > 0 then
    perform private.moto_erreur('Réserve non justifiée : décrivez le défaut constaté pour '||array_to_string(v_sans_justif, ', ')||'.');
  end if;
  -- Le résultat est calculé ici ; la valeur « APTE » envoyée par un client n'est jamais reprise.
  v_res := case when v_crit or cardinality(v_bloquants) > 0 or v_defav then 'INAPTE' else 'APTE' end;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), case when v_ref then 'État technique de référence' else 'Inspection mécanique initiale' end));
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat,
                                     intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id, observations, inspecteur_externe)
  values (v_moto, 'INSPECTION_INITIALE', private.moto_num(p, 'compteur_km'), v_chk -> 'items', v_crit, v_res,
          btrim(p ->> 'intervenant_nom'), nullif(btrim(p ->> 'garage_nom'), ''), nullif(btrim(p ->> 'avis_mecanicien'), ''), v_rapport,
          v_obs, nullif(btrim(p ->> 'inspecteur_externe'), ''))
  returning id into v_id;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos',
            case when v_ref then private.moto_param('photos_reference_min')::integer else 0 end,
            case when v_ref then array['COMPTEUR'] else '{}'::text[] end);
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'CONTROLE');
  perform private.moto_actions_depuis_items(v_moto, v_id, v_chk -> 'items');
  v_clot := private.moto_cloturer_corrigees(v_moto, v_id, v_chk -> 'items', case when v_ref then 'état de référence' else 'évaluation d''aptitude' end);
  if v_ref and m.date_debut_suivi is null then
    update public.moto_motos set date_debut_suivi = current_date, updated_at = now() where id = v_moto;
  end if;
  if v_crit then
    perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique à l''inspection '||case when v_ref then 'de référence' else 'initiale' end, v_id);
  end if;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit, 'etat_reference', v_ref,
           'aptitude', case when v_crit then 'INAPTE_IMMOBILISEE' when v_res = 'INAPTE' then 'INAPTE'
                            when cardinality(v_reserves) > 0 then 'APTE_RESERVES' else 'APTE' end,
           'defauts_bloquants', to_jsonb(v_bloquants), 'reserves', to_jsonb(v_reserves), 'avis_defavorable', v_defav,
           'actions_cloturees', v_clot);
end $function$;

-- 4. Statut technique : la contre-visite APTE après réparation compte --------
--    APTE si une inspection initiale existe ET si le contrôle complet le plus
--    récent (inspection initiale ou contrôle de remise en service, même
--    catalogue de points) est APTE, et sans immobilisation ouverte.
create or replace function private.moto_recalculer_statuts(p_moto uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_req text[];
  v_type text;
  v_doc record;
  v_tous_conformes boolean := true;
  v_non_conforme boolean := false;
  v_en_verif boolean := false;
  v_admin text;
  v_tech text;
  m public.moto_motos;
begin
  select * into m from public.moto_motos where id = p_moto;
  select array(select jsonb_array_elements_text(valeur_json)) into v_req from public.moto_parametres where cle = 'documents_obligatoires';
  foreach v_type in array coalesce(v_req, array['CARTE_GRISE','PLAQUE','ASSURANCE']) loop
    select * into v_doc from public.moto_documents
     where moto_id = p_moto and type_document = v_type and statut <> 'REMPLACE'
     order by depose_at desc limit 1;
    if not found then v_tous_conformes := false; continue; end if;
    if v_doc.statut = 'NON_CONFORME' or (v_doc.statut = 'CONFORME' and v_doc.date_expiration is not null and v_doc.date_expiration < current_date) then
      v_non_conforme := true; v_tous_conformes := false;
    elsif v_doc.statut = 'EN_VERIFICATION' then
      v_en_verif := true; v_tous_conformes := false;
    end if;
  end loop;
  if v_tous_conformes and (nullif(btrim(coalesce(m.numero_chassis, '')), '') is null
                           or nullif(btrim(coalesce(m.immatriculation, '')), '') is null) then
    v_tous_conformes := false; v_en_verif := true;
  end if;
  v_admin := case when v_non_conforme then 'NON_CONFORME' when v_tous_conformes then 'CONFORME'
                  when v_en_verif or exists (select 1 from public.moto_documents where moto_id = p_moto and type_document = any(v_req)) then 'EN_VERIFICATION'
                  else 'EN_ATTENTE' end;
  if exists (select 1 from public.moto_immobilisations where moto_id = p_moto and fin is null) then
    v_tech := case when exists (select 1 from public.moto_maintenances where moto_id = p_moto and statut = 'EN_COURS')
                   then 'EN_REPARATION' else 'IMMOBILISEE' end;
  elsif exists (select 1 from public.moto_controles c where c.moto_id = p_moto and c.type_controle = 'INSPECTION_INITIALE')
        and coalesce((select c.resultat = 'APTE' from public.moto_controles c
                       where c.moto_id = p_moto and c.type_controle in ('INSPECTION_INITIALE','REMISE_EN_SERVICE')
                       order by c.date_controle desc, c.created_at desc limit 1), false) then
    v_tech := 'APTE';
  else
    v_tech := 'A_CONTROLER';
  end if;
  update public.moto_motos set statut_administratif = v_admin, statut_technique = v_tech, updated_at = now()
  where id = p_moto and (statut_administratif is distinct from v_admin or statut_technique is distinct from v_tech);
end $function$;

-- 4b. Contre-visite (contrôle de remise en service) ---------------------------
--     Inchangé : intervenant nommé, indépendance vis-à-vis de l'utilisateur,
--     tous les points du catalogue, APTE seulement sans aucun défaut.
--     Ajouts : le statut technique est recalculé (règle 4 ci-dessus), les
--     défauts deviennent des actions correctives, un point critique en défaut
--     immobilise la moto, comme à l'inspection, et les points constatés
--     corrigés clôturent leur action (2b).
create or replace function public.moto_controle_remise_en_service(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_chk jsonb; v_crit boolean; v_res text; v_id uuid; v_clot integer;
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM','LOGISTIQUE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(v_moto, 'le contrôle de remise en service');
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null then perform private.moto_erreur('Nom de l''intervenant obligatoire.'); end if;
  v_chk := private.moto_items_controles('REMISE_EN_SERVICE', p -> 'items');
  v_crit := (v_chk ->> 'critique')::boolean;
  v_res := case when (v_chk ->> 'defauts')::integer > 0 then 'INAPTE' else 'APTE' end;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat, intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id)
  values (v_moto, 'REMISE_EN_SERVICE', private.moto_num(p, 'compteur_km'), v_chk -> 'items', v_crit, v_res, btrim(p ->> 'intervenant_nom'),
          nullif(btrim(p ->> 'garage_nom'), ''), nullif(btrim(p ->> 'avis_mecanicien'), ''), private.moto_uuid(p, 'rapport_document_id'))
  returning id into v_id;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos', 0, '{}');
  perform private.moto_actions_depuis_items(v_moto, v_id, v_chk -> 'items');   -- défauts constatés : suivis comme à l'inspection
  v_clot := private.moto_cloturer_corrigees(v_moto, v_id, v_chk -> 'items', 'contre-visite');
  if v_crit then
    perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique au contrôle de remise en service', v_id);
  end if;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit, 'actions_cloturees', v_clot);
end $function$;

-- 5. Mise en service : refus si un défaut de sécurité reste ouvert -----------
create or replace function public.moto_mettre_en_service(p_moto uuid, p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare m public.moto_motos; a public.moto_affectations; v_def text[];
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 5);
  perform private.moto_recalculer_statuts(p_moto);
  m := private.moto_charger(p_moto, true);
  if m.mise_en_service_at is not null then perform private.moto_erreur('Moto déjà en service.'); end if;
  select * into a from public.moto_affectations where moto_id = p_moto and statut = 'ACTIVE' and type_affectation in ('REMISE','TRANSFERT');
  if not found then perform private.moto_erreur('Mise en service impossible : aucune remise enregistrée.'); end if;
  if a.cree_par = auth.uid() then perform private.moto_refus('Séparation des tâches : la personne qui a enregistré la remise ne peut pas autoriser la circulation.'); end if;
  if m.statut_administratif <> 'CONFORME' then perform private.moto_erreur('Mise en service bloquée : documents '||m.statut_administratif||'.'); end if;
  if m.statut_technique <> 'APTE' then perform private.moto_erreur('Mise en service bloquée : état technique '||m.statut_technique||'.'); end if;
  v_def := private.moto_defauts_bloquants(p_moto);
  if cardinality(v_def) > 0 then
    perform private.moto_erreur('Mise en service bloquée : défaut affectant la sécurité de circulation non corrigé et vérifié ('||array_to_string(v_def, ' ; ')||').');
  end if;
  update public.moto_motos set mise_en_service_at = now(), mise_en_service_par = auth.uid(), mise_en_service_motif = btrim(p_motif), updated_at = now()
  where id = p_moto;
  return jsonb_build_object('id', p_moto, 'mise_en_service', true);
end $function$;

-- 6. Vue flotte : « autorisée à circuler » tient compte des défauts ouverts ---
create or replace view public.moto_v_flotte with (security_invoker = on) as
 SELECT m.id,
    m.code,
    m.qr_token,
    m.marque,
    m.modele,
    m.annee,
    m.couleur,
    m.numero_chassis,
    m.numero_moteur,
    m.immatriculation,
    m.date_reception,
    m.cluster_code,
    m.zone_code,
    m.statut_administratif,
    m.statut_affectation,
    m.statut_technique,
    m.mise_en_service_at,
    m.compteur_actuel_km,
    m.row_version,
    m.observations,
    a.id AS affectation_id,
    a.beneficiaire_id,
    private.moto_nom_profil(a.beneficiaire_id) AS beneficiaire_nom,
    a.type_affectation,
    m.mise_en_service_at IS NOT NULL AND m.statut_technique = 'APTE'::text AND m.statut_administratif = 'CONFORME'::text
      AND (m.statut_affectation = ANY (ARRAY['REMISE'::text, 'TRANSFEREE'::text]))
      AND cardinality(private.moto_defauts_bloquants(m.id)) = 0 AS autorisee_a_circuler,
    ( SELECT count(*) AS count
           FROM moto_incidents i
          WHERE i.moto_id = m.id AND i.etape <> 'CLOS'::text) AS incidents_ouverts,
    ( SELECT count(*) AS count
           FROM moto_immobilisations im
          WHERE im.moto_id = m.id AND im.fin IS NULL) AS immobilisations_ouvertes,
    ( SELECT max(r.date_releve) AS max
           FROM moto_releves_km r
          WHERE r.moto_id = m.id) AS dernier_releve_at,
    m.situation_parc,
    m.origine,
    m.photo_path,
    m.fournisseur,
    m.date_acquisition,
    m.date_debut_utilisation,
    m.date_debut_suivi,
    m.historique_note,
    m.compteur_reception_km,
    m.beneficiaire_prevu_id,
    COALESCE(private.moto_nom_profil(m.beneficiaire_prevu_id), m.beneficiaire_prevu_libelle) AS beneficiaire_prevu_nom,
    private.moto_classe_de(a.beneficiaire_id) AS beneficiaire_classe,
    m.situation_parc = 'RECEPTIONNEE'::text AND (m.marque IS NULL OR m.modele IS NULL OR m.numero_chassis IS NULL OR m.immatriculation IS NULL OR m.photo_path IS NULL OR m.statut_administratif <> 'CONFORME'::text OR m.origine = 'NEUVE'::text AND m.date_reception IS NULL) AS dossier_incomplet,
    ( SELECT count(*) AS count
           FROM moto_actions_correctives x
          WHERE x.moto_id = m.id AND (x.statut = ANY (ARRAY['OUVERTE'::text, 'PLANIFIEE'::text, 'REALISEE'::text]))) AS actions_ouvertes,
    ( SELECT count(*) AS count
           FROM moto_actions_correctives x
          WHERE x.moto_id = m.id AND x.gravite = 'CRITIQUE'::text AND (x.statut = ANY (ARRAY['OUVERTE'::text, 'PLANIFIEE'::text, 'REALISEE'::text]))) AS actions_critiques_ouvertes,
    cardinality(private.moto_defauts_bloquants(m.id)) AS defauts_bloquants_ouverts
   FROM moto_motos m
     LEFT JOIN moto_affectations a ON a.moto_id = m.id AND a.statut = 'ACTIVE'::text
  WHERE m.actif;

-- 7. Lecture : où en est la moto, et que reste-t-il à faire ? ----------------
create or replace function public.moto_aptitude(p_moto uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare m public.moto_motos; v_last public.moto_controles; v_insp boolean; v_def text[]; v_bloq text[] := private.moto_points_bloquants();
        v_apt text; v_reserves jsonb := '[]'::jsonb; v_ex jsonb := '[]'::jsonb; v_docs jsonb := '[]'::jsonb; v_req text[];
        v_type text; v_doc record; v_etat text; v_aff text; v_circ boolean;
begin
  if private.moto_classe() is null then perform private.moto_refus('Accès réservé aux utilisateurs AFLP FLEET.'); end if;
  m := private.moto_charger(p_moto, false);
  if not private.moto_dans_perimetre(p_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  v_insp := exists (select 1 from public.moto_controles where moto_id = p_moto and type_controle = 'INSPECTION_INITIALE');
  select * into v_last from public.moto_controles where moto_id = p_moto and type_controle in ('INSPECTION_INITIALE','REMISE_EN_SERVICE')
   order by date_controle desc, created_at desc limit 1;
  v_def := private.moto_defauts_bloquants(p_moto);
  if v_last.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('point', e ->> 'libelle', 'observation', e ->> 'observation')), '[]'::jsonb) into v_reserves
      from jsonb_array_elements(v_last.items) e
     where not (e ->> 'ok')::boolean and not (e ->> 'critique')::boolean and not (upper(e ->> 'code') = any(v_bloq));
  end if;
  v_apt := case when m.statut_technique in ('IMMOBILISEE','EN_REPARATION') then 'INAPTE_IMMOBILISEE'
                when m.statut_technique = 'APTE' and jsonb_array_length(v_reserves) > 0 then 'APTE_RESERVES'
                when m.statut_technique = 'APTE' then 'APTE'
                when v_last.id is not null and v_last.resultat = 'INAPTE' then 'INAPTE'
                else 'A_CONTROLER' end;
  -- Technique
  if v_apt = 'A_CONTROLER' and not v_insp then
    v_ex := v_ex || jsonb_build_object('domaine', 'TECHNIQUE', 'code', 'EVALUER', 'action', 'aptitude',
              'libelle', case when m.origine = 'EN_EXPLOITATION' then 'Faire évaluer l''aptitude par un mécanicien qualifié (compteur et photos de référence)'
                              else 'Faire évaluer l''aptitude par un mécanicien qualifié' end);
  elsif v_apt = 'A_CONTROLER' then
    v_ex := v_ex || jsonb_build_object('domaine', 'TECHNIQUE', 'code', 'CONTRE_VISITE', 'action', 'controle_remise',
              'libelle', 'Passer la contre-visite (contrôle de remise en service) par une personne autre que l''utilisateur');
  elsif v_apt = 'INAPTE' then
    v_ex := v_ex || jsonb_build_object('domaine', 'TECHNIQUE', 'code', 'CONTRE_VISITE', 'action', 'controle_remise',
              'libelle', 'Faire réparer, puis passer la contre-visite (contrôle de remise en service)');
  elsif v_apt = 'INAPTE_IMMOBILISEE' then
    v_ex := v_ex || jsonb_build_object('domaine', 'TECHNIQUE', 'code', 'IMMOBILISATION', 'action', 'controle_remise',
              'libelle', 'Moto immobilisée : réparer, contre-visite APTE, puis levée de l''immobilisation par un autre responsable');
  end if;
  if cardinality(v_def) > 0 then
    v_ex := v_ex || (select jsonb_agg(jsonb_build_object('domaine', 'TECHNIQUE', 'code', 'DEFAUT', 'action', 'anomalies',
                       'libelle', 'Corriger puis faire vérifier : '||x)) from unnest(v_def) x);
  end if;
  -- Administratif
  select array(select jsonb_array_elements_text(valeur_json)) into v_req from public.moto_parametres where cle = 'documents_obligatoires';
  foreach v_type in array coalesce(v_req, array['CARTE_GRISE','PLAQUE','ASSURANCE']) loop
    select * into v_doc from public.moto_documents where moto_id = p_moto and type_document = v_type and statut <> 'REMPLACE' order by depose_at desc limit 1;
    v_etat := case when not found then 'MANQUANT'
                   when v_doc.statut = 'CONFORME' and v_doc.date_expiration is not null and v_doc.date_expiration < current_date then 'EXPIRE'
                   else v_doc.statut end;
    v_docs := v_docs || jsonb_build_object('type', v_type, 'etat', v_etat);
    if v_etat <> 'CONFORME' then
      v_ex := v_ex || jsonb_build_object('domaine', 'ADMINISTRATIF', 'code', 'DOC_'||v_etat, 'type_document', v_type,
                'action', case when v_etat = 'EN_VERIFICATION' then 'documents' else 'document' end,
                'libelle', case v_etat when 'MANQUANT' then 'Déposer : ' when 'EN_VERIFICATION' then 'Faire vérifier par un autre responsable : '
                                       else 'Remplacer (non conforme ou expiré) : ' end || private.moto_lib(v_type));
    end if;
  end loop;
  if nullif(btrim(coalesce(m.numero_chassis, '')), '') is null or nullif(btrim(coalesce(m.immatriculation, '')), '') is null then
    v_ex := v_ex || jsonb_build_object('domaine', 'ADMINISTRATIF', 'code', 'IDENTITE', 'action', 'identite',
              'libelle', 'Recopier le n° de châssis et l''immatriculation depuis la carte grise');
  end if;
  -- Affectation et circulation
  v_aff := m.statut_affectation;
  if v_aff = 'NON_AFFECTEE' then
    v_ex := v_ex || jsonb_build_object('domaine', 'AFFECTATION', 'code', 'PREAFFECTER', 'action', 'preaffecter', 'libelle', 'Préaffecter la moto (Branch Manager)');
  elsif v_aff = 'PREAFFECTEE' then
    v_ex := v_ex || jsonb_build_object('domaine', 'AFFECTATION', 'code', 'REMISE', 'action', 'etat_remise',
              'libelle', 'État contradictoire accepté par le bénéficiaire, PV signé vérifié, puis remise');
  end if;
  v_circ := m.mise_en_service_at is not null and m.statut_technique = 'APTE' and m.statut_administratif = 'CONFORME'
            and v_aff in ('REMISE','TRANSFEREE') and cardinality(v_def) = 0;
  if m.mise_en_service_at is null then
    v_ex := v_ex || jsonb_build_object('domaine', 'CIRCULATION', 'code', 'AUTORISER', 'action', 'mise_en_service',
              'libelle', 'Autorisation de circulation par le Branch Manager (autre personne que celle qui a remis la moto)');
  end if;
  return jsonb_build_object('moto_id', p_moto, 'aptitude', v_apt, 'statut_technique', m.statut_technique,
           'derniere_evaluation', case when v_last.id is null then null else jsonb_build_object('type', v_last.type_controle,
               'date', v_last.date_controle, 'resultat', v_last.resultat, 'intervenant', v_last.intervenant_nom) end,
           'reserves', v_reserves, 'defauts_bloquants', to_jsonb(v_def), 'statut_administratif', m.statut_administratif,
           'documents', v_docs, 'statut_affectation', v_aff, 'mise_en_service_at', m.mise_en_service_at,
           'autorisee_a_circuler', v_circ, 'exigences', v_ex,
           'points_bloquants', to_jsonb(v_bloq));
end $function$;

revoke all on function public.moto_aptitude(uuid) from public, anon;
grant execute on function public.moto_aptitude(uuid) to authenticated;

-- 8. Correction d'un défaut préexistant (migration 9) -------------------------
--    private.moto_formation_support_immuable() est une fonction de déclencheur
--    exécutable par PUBLIC, donc par anon (constaté en production le
--    03/11/2026). Le déclencheur continue de fonctionner sans ce droit.
--    Conservé volontairement par le retour arrière (correctif de sécurité).
revoke all on function private.moto_formation_support_immuable() from public, anon;
--    Même fonction : search_path non fixé (alerte de sécurité Supabase). Son
--    corps ne référence aucun objet : on le fixe à pg_temp.
alter function private.moto_formation_support_immuable() set search_path to 'pg_temp';
