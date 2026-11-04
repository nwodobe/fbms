-- =============================================================================
-- AFLP FLEET 12 : RETOUR ARRIÈRE de 20261107090200_aflp_fleet_12_autorisation_bm_abm
-- Restaure moto_mettre_en_service (BM seul, séparation remise / autorisation)
-- et le libellé d'origine dans moto_aptitude. Aucune moto n'est modifiée :
-- les mises en service déjà accordées restent. Rejouable.
-- =============================================================================
begin;
CREATE OR REPLACE FUNCTION public.moto_mettre_en_service(p_moto uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
end $function$
;

do $$
declare v text := pg_get_functiondef('public.moto_aptitude(uuid)'::regprocedure);
begin
  if position('Autorisation de circulation par le Branch Manager ou l''''Assistant Branch Manager' in v) > 0 then
    execute replace(v, 'Autorisation de circulation par le Branch Manager ou l''''Assistant Branch Manager',
                       'Autorisation de circulation par le Branch Manager (autre personne que celle qui a remis la moto)');
  end if;
end $$;
commit;
