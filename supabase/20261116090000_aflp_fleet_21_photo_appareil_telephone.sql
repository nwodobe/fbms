-- =============================================================================
-- AFLP FLEET 21 : photo du compteur prise avec l'appareil photo du téléphone
-- Décision du Branch Manager du 05/11/2026 : certains téléphones exigent un réglage pour la
-- caméra intégrée ; l'agent peut utiliser l'appareil photo habituel du téléphone.
-- Arbitrage retenu : « accepter, mais signaler ».
--
-- Ce qui change :
--   - nouveau type d'écart PHOTO_IMPORTEE (liste des types de moto_mission_anomalies) ;
--   - private.moto_mission_photo : si le téléphone déclare photo_source = 'APPAREIL', la mission
--     reçoit l'écart « Photo prise hors caméra de l'application » (à vérifier, jamais une sanction),
--     avec l'heure du fichier et son âge en minutes (une photo de la galerie se voit à son âge).
--
-- Ce qui ne change pas : photo obligatoire, déposée par le conducteur, JPEG, taille maximale,
-- empreinte inédite (une photo ne sert qu'une fois), compteur qui ne recule pas, GPS facultatif.
-- Aucune table ni aucun statut ajoutés. Rejouable. Retour arrière : 20261116090100_aflp_fleet_21_rollback.sql
-- =============================================================================

alter table public.moto_mission_anomalies drop constraint if exists moto_mission_anomalies_type_anomalie_check;
alter table public.moto_mission_anomalies add constraint moto_mission_anomalies_type_anomalie_check
  check (type_anomalie in ('HORS_MISSION','CONTINUITE','VITESSE','DISTANCE','HORLOGE','GPS_ABSENT','CLOTURE_TARDIVE',
                           'SAISIE_DIFFEREE_DEPART','SAISIE_DIFFEREE_ARRIVEE','ORDRE_RELEVES','EMPREINTE_DIFFERENTE','PHOTO_ATYPIQUE','CHEVAUCHEMENT',
                           'PHOTO_IMPORTEE'));

do $$
declare v text; n text;
begin
  v := pg_get_functiondef('private.moto_mission_photo(uuid, uuid, uuid, text, jsonb)'::regprocedure);
  if position('PHOTO_IMPORTEE' in v) = 0 then
    n := replace(v, $a$taille inhabituelle pour l''application, regardez-la.', lower(p_moment), v_taille), v_taille, null);
  end if;$a$, $b$taille inhabituelle pour l''application, regardez-la.', lower(p_moment), v_taille), v_taille, null);
  end if;
  -- AFLP FLEET 21 début : photo prise avec l'appareil photo du téléphone (elle peut venir de la galerie).
  if upper(coalesce(p ->> 'photo_source', '')) = 'APPAREIL' then
    declare v_fichier timestamptz; v_age numeric; v_txt text;
    begin
      begin v_fichier := nullif(p ->> 'photo_fichier_at', '')::timestamptz; exception when others then v_fichier := null; end;
      begin v_age := round(extract(epoch from (nullif(p ->> 'capture_at', '')::timestamptz - v_fichier)) / 60.0, 1); exception when others then v_age := null; end;
      v_txt := format('Photo du compteur (%s) prise avec l''appareil photo du téléphone, hors caméra de l''application : elle peut venir de la galerie. %s',
                      lower(p_moment),
                      case when v_fichier is null then 'Heure du fichier inconnue.'
                           else format('Fichier daté du %s (Abidjan), %s min avant l''envoi.', to_char(v_fichier at time zone 'Africa/Abidjan', 'DD/MM/YYYY HH24:MI'), coalesce(v_age::text, '?')) end);
      if exists (select 1 from public.moto_mission_anomalies where mission_id = p_mission and type_anomalie = 'PHOTO_IMPORTEE') then
        update public.moto_mission_anomalies set detail = detail || ' | ' || v_txt
        where mission_id = p_mission and type_anomalie = 'PHOTO_IMPORTEE' and statut = 'A_VERIFIER';
      else
        perform private.moto_mission_signaler(p_mission, 'PHOTO_IMPORTEE', v_txt, v_age, null);
      end if;
    end;
  end if;
  -- AFLP FLEET 21 fin$b$);
    if n = v or position('PHOTO_IMPORTEE' in n) = 0 then
      raise exception 'AFLP FLEET 21 : texte attendu introuvable dans moto_mission_photo';
    end if;
    execute n;
  end if;
end $$;
