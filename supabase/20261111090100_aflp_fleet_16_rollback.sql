-- =============================================================================
-- AFLP FLEET 16 : RETOUR ARRIÈRE de 20261111090000_aflp_fleet_16_permis_enregistre
-- Le permis vérifié CONFORME redevient exigé (fonctions d'origine). Les remises déjà faites
-- avec un permis en vérification restent telles quelles (permis_verifie = false). Rejouable.
-- =============================================================================
CREATE OR REPLACE FUNCTION private.moto_affectation_permis()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.moto_permis;
begin
  if new.type_affectation in ('REMISE','TRANSFERT') and new.statut = 'ACTIVE' then
    if tg_op = 'UPDATE' and new.type_affectation = old.type_affectation and new.beneficiaire_id = old.beneficiaire_id
       and new.permis_id is not distinct from old.permis_id and new.statut = old.statut then
      return new;
    end if;
    r := private.moto_permis_valide(new.beneficiaire_id, coalesce(new.date_debut, current_date));
    -- Verrou partagé : un retrait simultané du permis attend la fin de la remise (ou l'inverse).
    if r.id is not null then
      perform 1 from public.moto_permis where id = r.id and statut = 'CONFORME' for share;
      -- Le permis a changé pendant l'attente (renouvellement vérifié, retrait) : on relit une fois.
      if not found then
        r := private.moto_permis_valide(new.beneficiaire_id, coalesce(new.date_debut, current_date));
        if r.id is not null then
          perform 1 from public.moto_permis where id = r.id and statut = 'CONFORME' for share;
          if not found then r := null; end if;
        end if;
      end if;
    end if;
    if r.id is null then
      perform private.moto_erreur('Remise bloquée : le bénéficiaire n''a pas de permis enregistré, vérifié CONFORME et en cours de validité (Administration › Conducteurs et permis).');
    end if;
    new.permis_id := r.id;
    new.permis_verifie := true;
    new.permis_categorie := array_to_string(r.categories, ', ');
    new.permis_verifie_par_nom := r.verification_rh_nom;
    new.permis_verifie_at := r.verifie_at::date;
  end if;
  return new;
end $function$

;

CREATE OR REPLACE FUNCTION public.moto_mission_demarrer(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_id uuid := coalesce(private.moto_uuid(p, 'mission_id'), gen_random_uuid());
        v_km numeric := private.moto_num(p, 'compteur_km'); v_at timestamptz; v_origine text; v_objet text := upper(coalesce(p ->> 'objet', ''));
        m public.moto_motos; v_releve uuid; v_prec_km numeric; v_dern_km numeric; v_ouverte record; v_seuil numeric; v_ecart integer;
        v_gps text := private.moto_mission_gps_statut(p, ''); v_res jsonb; v_dern_at timestamptz;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  if v_client is null then perform private.moto_erreur('Identifiant d''opération obligatoire.'); end if;
  perform private.moto_exiger_terrain(v_moto);
  m := private.moto_charger(v_moto, true);   -- verrou : une seule ouverture à la fois sur cette moto
  if m.mise_en_service_at is null then perform private.moto_erreur('Moto non mise en service : mission impossible.'); end if;
  if exists (select 1 from public.moto_immobilisations where moto_id = v_moto and fin is null) then
    perform private.moto_refus('Moto immobilisée : mission impossible tant que l''immobilisation n''est pas levée.');
  end if;
  v_at := private.moto_mission_capture(p);
  -- Permis valide AUJOURD'HUI et à la date déclarée (une capture antidatée ne contourne rien).
  if private.moto_permis_valide(auth.uid(), current_date) is null or private.moto_permis_valide(auth.uid(), v_at::date) is null then
    perform private.moto_refus('Aucun permis valide et vérifié à votre nom : mission impossible.');
  end if;
  select mi.id, mi.depart_at, mi.conducteur_id, private.moto_nom_profil(mi.conducteur_id) as nom into v_ouverte
  from public.moto_missions mi where mi.moto_id = v_moto and mi.statut = 'OUVERTE';
  if found then
    if v_ouverte.conducteur_id <> auth.uid() and v_at < v_ouverte.depart_at then
      -- Mission plus ANCIENNE saisie hors connexion pendant qu'une autre est en cours : elle passera
      -- dès la clôture de celle-ci (erreur temporaire, nouvelle tentative automatique).
      raise exception 'Mission antérieure en attente : une mission plus récente est en cours sur cette moto, nouvel envoi après sa clôture.' using errcode = '55000';
    end if;
    perform private.moto_erreur(format('Une mission est déjà ouverte sur cette moto (%s, depuis le %s) : elle doit être clôturée d''abord.',
                                       coalesce(v_ouverte.nom, 'conducteur inconnu'), to_char(v_ouverte.depart_at, 'DD/MM/YYYY HH24:MI')));
  end if;
  if exists (select 1 from public.moto_missions where conducteur_id = auth.uid() and statut = 'OUVERTE') then
    perform private.moto_erreur('Vous avez déjà une mission ouverte : clôturez-la avant d''en commencer une autre.');
  end if;
  if v_objet not in ('ACHAT_COLLECTE','SENSIBILISATION','RECENSEMENT','SUPERVISION','LIVRAISON','GARAGE','CARBURANT','ADMINISTRATIF','AUTRE') then
    perform private.moto_erreur('Objet de mission inconnu.');
  end if;
  if length(btrim(coalesce(p ->> 'destination', ''))) < 2 then perform private.moto_erreur('Destination obligatoire (village ou cluster).'); end if;
  if v_km is null then perform private.moto_erreur('Compteur de départ obligatoire.'); end if;
  -- Deux missions ne se chevauchent jamais (même moto ou même conducteur) : refus.
  -- Refus seulement si le départ tombe PENDANT une mission clôturée (fin retenue : la plus tôt de
  -- l'heure déclarée et de l'heure de réception, pour ne pas pénaliser un téléphone en avance).
  if exists (select 1 from public.moto_missions where moto_id = v_moto and statut = 'CLOTUREE'
             and v_at >= depart_at and v_at < least(arrivee_at, arrivee_recu_at)) then
    perform private.moto_erreur('Départ pendant une mission déjà clôturée sur cette moto : deux missions ne se chevauchent pas.');
  end if;
  if exists (select 1 from public.moto_missions where conducteur_id = auth.uid() and statut = 'CLOTUREE'
             and v_at >= depart_at and v_at < least(arrivee_at, arrivee_recu_at)) then
    perform private.moto_erreur('Départ pendant une autre de vos missions : deux missions ne se chevauchent pas.');
  end if;
  -- Un relevé plus récent déjà reçu (synchronisation dans le désordre) : accepté, signalé plus bas.
  select max(r.date_releve) into v_dern_at from public.moto_releves_km r where r.moto_id = v_moto;
  v_origine := private.moto_mission_origine(p, v_km);
  -- Repères AVANT l'enregistrement du nouveau relevé.
  select max(r.compteur_km) into v_dern_km from public.moto_releves_km r where r.moto_id = v_moto and r.date_releve <= v_at;
  select mi.arrivee_km into v_prec_km
  from public.moto_missions mi
  where mi.moto_id = v_moto and mi.statut = 'CLOTUREE' and mi.arrivee_at <= v_at
  order by mi.arrivee_at desc limit 1;
  perform private.moto_motif('Départ de mission');
  perform private.moto_enregistrer_km(v_moto, v_km, v_at, 'MISSION');   -- refuse un compteur qui recule
  select r.id into v_releve from public.moto_releves_km r
  where r.moto_id = v_moto and r.source = 'MISSION' and r.date_releve = v_at and r.compteur_km = v_km
    and not exists (select 1 from public.moto_missions x where x.depart_releve_id = r.id or x.arrivee_releve_id = r.id)
  order by r.created_at desc limit 1;
  v_ecart := private.moto_mission_horloge(p);
  begin
    insert into public.moto_missions (id, moto_id, conducteur_id, objet, objet_detail, destination, depart_releve_id, depart_km, depart_at, depart_origine,
                                      depart_lu_km, depart_localite, depart_gps_statut, depart_horloge_ecart_s, depart_client_op_id)
    values (v_id, v_moto, auth.uid(), v_objet, nullif(btrim(coalesce(p ->> 'objet_detail', '')), ''), btrim(p ->> 'destination'), v_releve, v_km, v_at,
            v_origine, private.moto_num(p, 'lu_km'), nullif(btrim(coalesce(p ->> 'localite', '')), ''), v_gps, v_ecart, v_client);
  exception when unique_violation then
    perform private.moto_erreur('Vous avez déjà une mission ouverte (ou cet identifiant de mission existe) : clôturez-la avant d''en commencer une autre.');
  end;
  perform private.moto_mission_photo(v_id, v_moto, v_client, 'DEPART', p);
  perform private.moto_mission_position(v_id, 'DEPART', p, '');
  -- Écarts à vérifier (jamais une sanction automatique).
  v_seuil := coalesce(private.moto_param('mission_seuil_hors_mission_km'), 5);
  if v_prec_km is not null and v_km - v_prec_km > v_seuil then
    perform private.moto_mission_signaler(v_id, 'HORS_MISSION',
      format('%s km parcourus depuis la fin de la mission précédente, sans mission déclarée.', v_km - v_prec_km), v_km - v_prec_km, v_seuil);
  end if;
  v_seuil := coalesce(private.moto_param('mission_seuil_continuite_km'), 100);
  if v_dern_km is not null and v_km - v_dern_km > v_seuil then
    perform private.moto_mission_signaler(v_id, 'CONTINUITE',
      format('Compteur de départ %s km supérieur au dernier relevé connu (%s km) : vérifier la photo (autre moto ?).', v_km - v_dern_km, v_dern_km),
      v_km - v_dern_km, v_seuil);
  end if;
  v_seuil := coalesce(private.moto_param('mission_horloge_ecart_max_min'), 10) * 60;
  if v_ecart is not null and abs(v_ecart) > v_seuil then
    perform private.moto_mission_signaler(v_id, 'HORLOGE', format('Horloge du téléphone décalée de %s minute(s) par rapport au serveur.', round(v_ecart / 60.0)), v_ecart, v_seuil);
  end if;
  if v_gps = 'ABSENT' then
    perform private.moto_mission_signaler(v_id, 'GPS_ABSENT', 'Position non disponible au départ.', null, null);
  end if;
  if v_dern_at is not null and v_dern_at > v_at then
    perform private.moto_mission_signaler(v_id, 'ORDRE_RELEVES', format('Départ photographié le %s, reçu après un relevé daté du %s.', to_char(v_at, 'DD/MM/YYYY HH24:MI'), to_char(v_dern_at, 'DD/MM/YYYY HH24:MI')), null, null);
  end if;
  v_seuil := coalesce(private.moto_param('mission_saisie_differee_h'), 12);
  if now() - v_at > make_interval(hours => v_seuil::integer) then
    perform private.moto_mission_signaler(v_id, 'SAISIE_DIFFEREE_DEPART', format('Départ photographié le %s, reçu %s heure(s) plus tard.', to_char(v_at, 'DD/MM/YYYY HH24:MI'), round(extract(epoch from now() - v_at) / 3600)), round(extract(epoch from now() - v_at) / 3600), v_seuil);
  end if;
  v_res := jsonb_build_object('id', v_id, 'statut', 'OUVERTE', 'compteur_km', v_km,
                              'anomalies', (select coalesce(jsonb_agg(type_anomalie), '[]'::jsonb) from public.moto_mission_anomalies where mission_id = v_id));
  perform private.moto_op_enregistrer(v_client, 'MISSION_DEPART', 'SYNCHRONISE', v_res);
  return v_res;
end $function$

;

drop function if exists private.moto_permis_utilisable(uuid, date);
delete from public.moto_parametres where cle = 'permis_verification_obligatoire';
