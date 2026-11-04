-- =============================================================================
-- AFLP FLEET 12 : autorisation de circuler par le Branch Manager OU l'ABM
-- -----------------------------------------------------------------------------
-- Décision du Branch Manager (04/11/2026) : « l'autorisation de circuler peut
-- être faite par moi ou l'Assistant Branch Manager ».
--
-- Avant : BM seul, et jamais la personne qui a enregistré la remise.
-- Après : BM ou ABM. Si l'auteur de la remise autorise lui-même, c'est
--         accepté et tracé (motif préfixé « Auto-autorisation : auteur de la
--         remise »), sur le modèle de l'auto-validation des documents (11).
-- Inchangé : remise enregistrée obligatoire, documents CONFORMES (selon le
--         paramètre documents_obligatoires), aptitude technique APTE, aucun
--         défaut de sécurité ouvert, motif obligatoire, journal.
-- STATUT : APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreintes identiques à la réplique).
-- Rejouable. Retour arrière : 20261107090300_aflp_fleet_12_rollback.sql
-- =============================================================================

create or replace function public.moto_mettre_en_service(p_moto uuid, p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare m public.moto_motos; a public.moto_affectations; v_def text[]; v_auto boolean; v_motif text;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  perform private.moto_motif(p_motif, 5);
  perform private.moto_recalculer_statuts(p_moto);
  m := private.moto_charger(p_moto, true);
  if m.mise_en_service_at is not null then perform private.moto_erreur('Moto déjà en service.'); end if;
  select * into a from public.moto_affectations where moto_id = p_moto and statut = 'ACTIVE' and type_affectation in ('REMISE','TRANSFERT');
  if not found then perform private.moto_erreur('Mise en service impossible : aucune remise enregistrée.'); end if;
  if m.statut_administratif <> 'CONFORME' then perform private.moto_erreur('Mise en service bloquée : documents '||m.statut_administratif||'.'); end if;
  if m.statut_technique <> 'APTE' then perform private.moto_erreur('Mise en service bloquée : état technique '||m.statut_technique||'.'); end if;
  v_def := private.moto_defauts_bloquants(p_moto);
  if cardinality(v_def) > 0 then
    perform private.moto_erreur('Mise en service bloquée : défaut affectant la sécurité de circulation non corrigé et vérifié ('||array_to_string(v_def, ' ; ')||').');
  end if;
  v_auto := a.cree_par = auth.uid();
  v_motif := case when v_auto then 'Auto-autorisation : auteur de la remise. ' else '' end || btrim(p_motif);
  update public.moto_motos set mise_en_service_at = now(), mise_en_service_par = auth.uid(), mise_en_service_motif = v_motif, updated_at = now()
  where id = p_moto;
  return jsonb_build_object('id', p_moto, 'mise_en_service', true, 'auto_autorisation', v_auto);
end $function$;

-- Libellé de l'exigence affichée par moto_aptitude (texte seulement).
do $$
declare v text := pg_get_functiondef('public.moto_aptitude(uuid)'::regprocedure);
begin
  if position('Autorisation de circulation par le Branch Manager (autre personne que celle qui a remis la moto)' in v) > 0 then
    execute replace(v, 'Autorisation de circulation par le Branch Manager (autre personne que celle qui a remis la moto)',
                       'Autorisation de circulation par le Branch Manager ou l''''Assistant Branch Manager');
  end if;
end $$;
