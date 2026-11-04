-- =============================================================================
-- AFLP FLEET 15 : RETOUR ARRIÈRE de 20261110090000_aflp_fleet_15_remise_sans_etat
-- L'état contradictoire accepté redevient obligatoire (fonctions d'origine).
-- Les remises déjà faites sans état restent telles quelles. Rejouable.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.moto_remettre(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); m public.moto_motos; a public.moto_affectations; v_id uuid; v_etat uuid;
begin
  -- Le coordinateur logistique peut réaliser la remise physique (tenue des affectations) ;
  -- l'autorisation de circuler reste au Branch Manager (moto_mettre_en_service).
  perform private.moto_exiger_classe(array['ABM','BM','LOGISTIQUE']);
  perform private.moto_recalculer_statuts(v_moto);
  m := private.moto_charger(v_moto, true);
  select * into a from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation = 'PREAFFECTATION';
  if not found then perform private.moto_erreur('Aucune préaffectation active : le Branch Manager doit d''abord préaffecter la moto.'); end if;
  if a.beneficiaire_id = auth.uid() then perform private.moto_refus('Séparation des tâches : le bénéficiaire n''enregistre pas sa propre remise.'); end if;
  if m.statut_administratif <> 'CONFORME' then perform private.moto_erreur('Remise bloquée : documents administratifs non conformes ('||m.statut_administratif||').'); end if;
  if m.statut_technique <> 'APTE' then perform private.moto_erreur('Remise bloquée : état technique '||m.statut_technique||'.'); end if;
  perform private.moto_controle_remise(v_moto, p);
  v_etat := private.moto_etat_remise_valide(v_moto, a.beneficiaire_id);
  if v_etat is null then
    perform private.moto_erreur('Remise bloquée : état contradictoire avant remise absent, non accepté par le bénéficiaire, contesté ou trop ancien.');
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif', 'Remise officielle au bureau de Bouaké'));
  update public.moto_affectations set statut = 'CLOTUREE', date_fin = current_date, cloture_par = auth.uid(), cloture_at = now() where id = a.id;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, compteur_km, pv_document_id,
         permis_verifie, permis_categorie, permis_verifie_par_nom, permis_verifie_at, equipements, motif, etat_remise_id)
  values (v_moto, a.beneficiaire_id, a.cluster_code, 'REMISE', private.moto_num(p, 'compteur_km'), private.moto_uuid(p, 'pv_document_id'),
          true, btrim(p ->> 'permis_categorie'), btrim(p ->> 'permis_verifie_par_nom'),
          coalesce(nullif(p ->> 'permis_verifie_at', '')::date, current_date), p -> 'equipements', nullif(btrim(p ->> 'motif'), ''), v_etat)
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'REMISE');
  update public.moto_documents set affectation_id = v_id where id = private.moto_uuid(p, 'pv_document_id');
  update public.moto_motos set statut_affectation = 'REMISE', updated_at = now() where id = v_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'REMISE', 'etat_remise_id', v_etat,
    'note', 'Remise enregistrée. L''autorisation de circulation (mise en service) reste une décision distincte du Branch Manager.');
end $function$

;

CREATE OR REPLACE FUNCTION public.moto_transferer(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_benef uuid := private.moto_uuid(p, 'beneficiaire_id');
        b public.profils; v_cluster text; a public.moto_affectations; v_id uuid; v_etat uuid; m public.moto_motos;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p ->> 'motif', 5);
  m := private.moto_charger(v_moto, true);
  select * into a from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation in ('REMISE','TRANSFERT');
  if not found then perform private.moto_erreur('Transfert impossible : la moto n''a pas été remise.'); end if;
  select * into b from public.profils where user_id = v_benef and actif;
  if not found or not private.moto_beneficiaire_valide(v_benef) then perform private.moto_erreur('Nouveau bénéficiaire invalide.'); end if;
  if v_benef = a.beneficiaire_id then perform private.moto_erreur('Le nouveau bénéficiaire est déjà affectataire.'); end if;
  v_cluster := public.aflp_cluster_code(b.cluster);
  if private.moto_classe_de(v_benef) = 'UNITE' and v_cluster is null then perform private.moto_erreur('Cluster du nouveau bénéficiaire non renseigné.'); end if;
  perform private.moto_controle_remise(v_moto, p);
  v_etat := private.moto_etat_remise_valide(v_moto, v_benef);
  if v_etat is null then perform private.moto_erreur('Transfert bloqué : état contradictoire avec le nouveau bénéficiaire absent, non accepté ou trop ancien.'); end if;
  update public.moto_affectations set statut = 'CLOTUREE', date_fin = current_date, cloture_par = auth.uid(), cloture_at = now() where id = a.id;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, compteur_km, pv_document_id,
         permis_verifie, permis_categorie, permis_verifie_par_nom, permis_verifie_at, equipements, motif, etat_remise_id)
  values (v_moto, v_benef, coalesce(v_cluster, m.cluster_code), 'TRANSFERT', private.moto_num(p, 'compteur_km'), private.moto_uuid(p, 'pv_document_id'),
          true, btrim(p ->> 'permis_categorie'), btrim(p ->> 'permis_verifie_par_nom'),
          coalesce(nullif(p ->> 'permis_verifie_at', '')::date, current_date), p -> 'equipements', btrim(p ->> 'motif'), v_etat)
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'REMISE');
  update public.moto_motos set statut_affectation = 'TRANSFEREE', cluster_code = coalesce(v_cluster, cluster_code),
         zone_code = coalesce((select zone_code from public.aflp_clusters where code = v_cluster), zone_code), updated_at = now()
  where id = v_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'TRANSFEREE');
end $function$

;

CREATE OR REPLACE FUNCTION public.moto_aptitude(p_moto uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
              'libelle', 'État contradictoire accepté par le bénéficiaire, puis remise');
  end if;
  v_circ := m.mise_en_service_at is not null and m.statut_technique = 'APTE' and m.statut_administratif = 'CONFORME'
            and v_aff in ('REMISE','TRANSFEREE') and cardinality(v_def) = 0;
  if m.mise_en_service_at is null then
    v_ex := v_ex || jsonb_build_object('domaine', 'CIRCULATION', 'code', 'AUTORISER', 'action', 'mise_en_service',
              'libelle', 'Autorisation de circulation par le Branch Manager ou l''Assistant Branch Manager');
  end if;
  return jsonb_build_object('moto_id', p_moto, 'aptitude', v_apt, 'statut_technique', m.statut_technique,
           'derniere_evaluation', case when v_last.id is null then null else jsonb_build_object('type', v_last.type_controle,
               'date', v_last.date_controle, 'resultat', v_last.resultat, 'intervenant', v_last.intervenant_nom) end,
           'reserves', v_reserves, 'defauts_bloquants', to_jsonb(v_def), 'statut_administratif', m.statut_administratif,
           'documents', v_docs, 'statut_affectation', v_aff, 'mise_en_service_at', m.mise_en_service_at,
           'autorisee_a_circuler', v_circ, 'exigences', v_ex,
           'points_bloquants', to_jsonb(v_bloq));
end $function$

;

drop function if exists private.moto_etat_remise_requis(uuid, uuid, text);
delete from public.moto_parametres where cle = 'etat_remise_obligatoire';
