-- =============================================================================
-- AFLP FLEET 13 : remise sans procès-verbal obligatoire
-- -----------------------------------------------------------------------------
-- Décision du Branch Manager (04/11/2026) : « pour l'enregistrement de la
-- remise, pas besoin du PV ».
--
-- Nouveau paramètre pv_remise_obligatoire (0 = facultatif, 1 = obligatoire),
-- modifiable par le BM (moto_parametre_modifier, journalisé) : la règle se
-- rétablit sans code.
-- Si un PV est fourni, il doit toujours être un PV_REMISE CONFORME de la moto.
-- Inchangé : préaffectation, état contradictoire accepté par le bénéficiaire,
-- permis du bénéficiaire vérifié, équipements de sécurité, compteur,
-- documents conformes et aptitude APTE. Concerne la remise et le transfert.
-- STATUT : APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreintes identiques à la réplique).
-- Rejouable. Retour arrière : 20261108090100_aflp_fleet_13_rollback.sql
-- =============================================================================

insert into public.moto_parametres (cle, valeur, description, provisoire)
values ('pv_remise_obligatoire', 0,
        'Procès-verbal de remise signé et vérifié exigé à la remise et au transfert (1 = oui, 0 = facultatif).', true)
on conflict (cle) do nothing;

create or replace function private.moto_controle_remise(p_moto uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_pv uuid := private.moto_uuid(p, 'pv_document_id'); v_req text; v_eq jsonb := coalesce(p -> 'equipements', '{}'::jsonb);
begin
  if v_pv is not null then
    if not exists (select 1 from public.moto_documents where id = v_pv and moto_id = p_moto and type_document = 'PV_REMISE' and statut = 'CONFORME') then
      perform private.moto_erreur('Le procès-verbal choisi doit être un PV de remise de cette moto, vérifié CONFORME.');
    end if;
  elsif coalesce(private.moto_param('pv_remise_obligatoire'), 0) >= 1 then
    perform private.moto_erreur('Procès-verbal signé, numérisé et vérifié CONFORME obligatoire.');
  end if;
  for v_req in select jsonb_array_elements_text(valeur_json) from public.moto_parametres where cle = 'equipements_obligatoires' loop
    if coalesce((v_eq ->> v_req)::boolean, false) is not true then
      perform private.moto_erreur(format('Équipement de sécurité manquant : %s.', v_req));
    end if;
  end loop;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur à la remise obligatoire.'); end if;
end $function$;

do $$
declare v text := pg_get_functiondef('public.moto_aptitude(uuid)'::regprocedure);
begin
  if position('État contradictoire accepté par le bénéficiaire, PV signé vérifié, puis remise' in v) > 0 then
    execute replace(v, 'État contradictoire accepté par le bénéficiaire, PV signé vérifié, puis remise',
                       'État contradictoire accepté par le bénéficiaire, puis remise');
  end if;
end $$;
