-- =============================================================================
-- AFLP FLEET 13 : RETOUR ARRIÈRE de 20261108090000_aflp_fleet_13_remise_sans_pv
-- Le PV redevient obligatoire (fonction d'origine), libellé d'origine dans
-- moto_aptitude, paramètre supprimé. Les remises déjà enregistrées sans PV
-- restent telles quelles. Rejouable.
-- =============================================================================
begin;
CREATE OR REPLACE FUNCTION private.moto_controle_remise(p_moto uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_pv uuid := private.moto_uuid(p, 'pv_document_id'); v_req text; v_eq jsonb := coalesce(p -> 'equipements', '{}'::jsonb);
begin
  if not exists (select 1 from public.moto_documents where id = v_pv and moto_id = p_moto and type_document = 'PV_REMISE' and statut = 'CONFORME') then
    perform private.moto_erreur('Procès-verbal signé, numérisé et vérifié CONFORME obligatoire.');
  end if;
  -- Permis : vérifié par le déclencheur moto_affectations_permis_trg (permis enregistré, CONFORME, non expiré).
  for v_req in select jsonb_array_elements_text(valeur_json) from public.moto_parametres where cle = 'equipements_obligatoires' loop
    if coalesce((v_eq ->> v_req)::boolean, false) is not true then
      perform private.moto_erreur(format('Équipement de sécurité manquant : %s.', v_req));
    end if;
  end loop;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur à la remise obligatoire.'); end if;
end $function$
;

do $$
declare v text := pg_get_functiondef('public.moto_aptitude(uuid)'::regprocedure);
begin
  if position('État contradictoire accepté par le bénéficiaire, puis remise' in v) > 0
     and position('PV signé vérifié' in v) = 0 then
    execute replace(v, 'État contradictoire accepté par le bénéficiaire, puis remise',
                       'État contradictoire accepté par le bénéficiaire, PV signé vérifié, puis remise');
  end if;
end $$;
select private.moto_motif('Retour arrière AFLP FLEET 13', 5);
delete from public.moto_parametres where cle = 'pv_remise_obligatoire';
commit;
