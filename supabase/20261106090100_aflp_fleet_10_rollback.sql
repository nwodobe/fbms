-- =============================================================================
-- AFLP FLEET 10 — RETOUR ARRIÈRE de 20261106090000_aflp_fleet_10_aptitude_mise_en_service
-- -----------------------------------------------------------------------------
-- Restaure à l'identique (empreinte normalisée vérifiée par
-- tests/moto/verifier_rollback_10.sh) :
--   public.moto_inspection_initiale, public.moto_mettre_en_service,
--   public.moto_controle_remise_en_service,
--   private.moto_recalculer_statuts, la vue public.moto_v_flotte et ses droits.
-- Supprime : public.moto_aptitude, private.moto_defauts_bloquants, private.moto_cloturer_corrigees,
--   private.moto_points_bloquants, le paramètre points_circulation_bloquants.
--
-- Conservé volontairement : le retrait du droit anon sur
--   private.moto_formation_support_immuable() (correctif de sécurité, §8).
-- Les actions clôturées par un contrôle complet restent clôturées.
--
-- Effet sur les données : AUCUNE donnée métier supprimée ni modifiée. Les
-- contrôles enregistrés pendant la période restent tels quels (résultat
-- calculé par le serveur). Aucun statut de moto n'est recalculé par ce script.
-- La vue n'a aucune dépendance (vérifié en production le 03/11/2026) : la
-- supprimer puis la recréer est sans effet de bord ; ses droits sont rétablis.
-- Rejouable.
-- =============================================================================
begin;

CREATE OR REPLACE FUNCTION public.moto_inspection_initiale(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_chk jsonb; v_crit boolean; v_res text; v_id uuid;
        v_rapport uuid := private.moto_uuid(p, 'rapport_document_id'); m public.moto_motos; v_ref boolean;
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  m := private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if m.situation_parc = 'PREVUE' then perform private.moto_erreur('Moto non réceptionnée : enregistrez d''abord la réception.'); end if;
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null or nullif(btrim(p ->> 'garage_nom'), '') is null then
    perform private.moto_erreur('Nom du mécanicien et du garage obligatoires.');
  end if;
  if v_rapport is not null and not exists (select 1 from public.moto_documents where id = v_rapport and moto_id = v_moto and type_document = 'RAPPORT_MECANICIEN') then
    perform private.moto_erreur('Le rapport doit être un document RAPPORT_MECANICIEN de cette moto.');
  end if;
  v_ref := m.origine = 'EN_EXPLOITATION';
  if v_ref and private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('État de référence : relevé du compteur obligatoire.'); end if;
  v_chk := private.moto_items_controles('INSPECTION_INITIALE', p -> 'items');
  v_crit := (v_chk ->> 'critique')::boolean;
  v_res := case when v_crit then 'INAPTE' when upper(coalesce(p ->> 'resultat', 'INAPTE')) = 'APTE' then 'APTE' else 'INAPTE' end;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), case when v_ref then 'État technique de référence' else 'Inspection mécanique initiale' end));
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat,
                                     intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id, observations, inspecteur_externe)
  values (v_moto, 'INSPECTION_INITIALE', private.moto_num(p, 'compteur_km'), v_chk -> 'items', v_crit, v_res,
          btrim(p ->> 'intervenant_nom'), btrim(p ->> 'garage_nom'), nullif(btrim(p ->> 'avis_mecanicien'), ''), v_rapport,
          nullif(btrim(p ->> 'observations'), ''), nullif(btrim(p ->> 'inspecteur_externe'), ''))
  returning id into v_id;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos',
            case when v_ref then private.moto_param('photos_reference_min')::integer else 0 end,
            case when v_ref then array['COMPTEUR'] else '{}'::text[] end);
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'CONTROLE');
  perform private.moto_actions_depuis_items(v_moto, v_id, v_chk -> 'items');
  if v_ref and m.date_debut_suivi is null then
    update public.moto_motos set date_debut_suivi = current_date, updated_at = now() where id = v_moto;
  end if;
  if v_crit then
    perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique à l''inspection '||case when v_ref then 'de référence' else 'initiale' end, v_id);
  end if;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit, 'etat_reference', v_ref);
end $function$
;

CREATE OR REPLACE FUNCTION public.moto_mettre_en_service(p_moto uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare m public.moto_motos; a public.moto_affectations;
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
  update public.moto_motos set mise_en_service_at = now(), mise_en_service_par = auth.uid(), mise_en_service_motif = btrim(p_motif), updated_at = now()
  where id = p_moto;
  return jsonb_build_object('id', p_moto, 'mise_en_service', true);
end $function$
;

CREATE OR REPLACE FUNCTION private.moto_recalculer_statuts(p_moto uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
  -- Pas de conformité sans identifiants réels (aucun numéro fictif n'est accepté par défaut).
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
  elsif exists (select 1 from public.moto_controles c where c.moto_id = p_moto and c.type_controle = 'INSPECTION_INITIALE'
                  and c.resultat = 'APTE'
                  and c.date_controle = (select max(c2.date_controle) from public.moto_controles c2
                                         where c2.moto_id = p_moto and c2.type_controle = 'INSPECTION_INITIALE')) then
    v_tech := 'APTE';
  else
    v_tech := 'A_CONTROLER';
  end if;

  update public.moto_motos set statut_administratif = v_admin, statut_technique = v_tech, updated_at = now()
  where id = p_moto and (statut_administratif is distinct from v_admin or statut_technique is distinct from v_tech);
end $function$
;


CREATE OR REPLACE FUNCTION public.moto_controle_remise_en_service(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_chk jsonb; v_crit boolean; v_res text; v_id uuid;
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
  return jsonb_build_object('id', v_id, 'resultat', v_res);
end $function$
;


drop view if exists public.moto_v_flotte;
create view public.moto_v_flotte with (security_invoker = on) as
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
    m.mise_en_service_at IS NOT NULL AND m.statut_technique = 'APTE'::text AND m.statut_administratif = 'CONFORME'::text AND (m.statut_affectation = ANY (ARRAY['REMISE'::text, 'TRANSFEREE'::text])) AS autorisee_a_circuler,
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
          WHERE x.moto_id = m.id AND x.gravite = 'CRITIQUE'::text AND (x.statut = ANY (ARRAY['OUVERTE'::text, 'PLANIFIEE'::text, 'REALISEE'::text]))) AS actions_critiques_ouvertes
   FROM moto_motos m
     LEFT JOIN moto_affectations a ON a.moto_id = m.id AND a.statut = 'ACTIVE'::text
  WHERE m.actif;
revoke all on public.moto_v_flotte from public, anon;   -- les privilèges par défaut du schéma accorderaient anon
grant select, insert, update, delete, truncate, references, trigger on public.moto_v_flotte to authenticated, service_role;

drop function if exists public.moto_aptitude(uuid);
drop function if exists private.moto_defauts_bloquants(uuid);
drop function if exists private.moto_points_bloquants();
drop function if exists private.moto_cloturer_corrigees(uuid, uuid, jsonb, text);
select private.moto_motif('Retour arrière AFLP FLEET 10', 5);
delete from public.moto_parametres where cle = 'points_circulation_bloquants';

commit;
