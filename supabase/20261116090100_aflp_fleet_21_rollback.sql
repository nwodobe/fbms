-- AFLP FLEET 21 : retour arrière.
-- Retire le signalement PHOTO_IMPORTEE de moto_mission_photo (bloc balisé) et le type de la liste.
-- Refuse si des écarts PHOTO_IMPORTEE existent : on ne supprime jamais un écart enregistré.
do $$
declare v text; n text;
begin
  if exists (select 1 from public.moto_mission_anomalies where type_anomalie = 'PHOTO_IMPORTEE') then
    raise exception 'AFLP FLEET 21 rollback : des écarts PHOTO_IMPORTEE existent, retour arrière refusé (aucune suppression d''écart).';
  end if;
  v := pg_get_functiondef('private.moto_mission_photo(uuid, uuid, uuid, text, jsonb)'::regprocedure);
  if position('AFLP FLEET 21 début' in v) > 0 then
    n := regexp_replace(v, '\n  -- AFLP FLEET 21 début.*-- AFLP FLEET 21 fin', '');
    if n = v or position('PHOTO_IMPORTEE' in n) > 0 then raise exception 'AFLP FLEET 21 rollback : bloc balisé introuvable'; end if;
    execute n;
  end if;
end $$;
alter table public.moto_mission_anomalies drop constraint if exists moto_mission_anomalies_type_anomalie_check;
alter table public.moto_mission_anomalies add constraint moto_mission_anomalies_type_anomalie_check
  check (type_anomalie in ('HORS_MISSION','CONTINUITE','VITESSE','DISTANCE','HORLOGE','GPS_ABSENT','CLOTURE_TARDIVE',
                           'SAISIE_DIFFEREE_DEPART','SAISIE_DIFFEREE_ARRIVEE','ORDRE_RELEVES','EMPREINTE_DIFFERENTE','PHOTO_ATYPIQUE','CHEVAUCHEMENT'));
