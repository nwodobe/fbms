-- =====================================================================
-- AFLP FLEET · Migration 8 : journal de mission et kilométrage contrôlé par photo.
-- Rejouable. Additive : aucune table supprimée, aucune donnée réelle modifiée.
--
-- 1. Une mission = un départ et un retour avec une moto (plusieurs par jour).
--    Départ et arrivée : compteur + photo du compteur prise par la caméra de
--    l'application (jamais la galerie), heure de capture, localité, position.
-- 2. Le compteur est proposé par le téléphone (lecture gratuite hors ligne),
--    confirmé ou corrigé par l'agent : l'origine est conservée
--    (LU_CONFIRME, LU_CORRIGE, SAISI) et contrôlée par le serveur.
-- 3. Les relevés de mission sont de VRAIS relevés kilométriques (source
--    MISSION) : ils alimentent le compteur de la moto, les échéances
--    d'entretien et le carnet de suivi. Ils se corrigent par le circuit
--    existant à quatre yeux (moto_correction_demander / _decider).
-- 4. Contrôles : compteur qui recule refusé, une mission ouverte par moto et
--    par conducteur, moto immobilisée ou non mise en service refusée, permis
--    valide exigé, photo obligatoire, déposée par le conducteur, non réutilisée
--    (empreinte unique). Écarts signalés pour VÉRIFICATION, jamais sanctionnés
--    automatiquement : kilomètres hors mission, continuité du compteur, vitesse,
--    distance, horloge du téléphone, GPS absent, clôture tardive.
-- 5. Positions GPS exactes dans une table séparée, lisible uniquement par le
--    Chef de zone, le coordinateur, l'ABM et le BM ; jamais journalisée,
--    jamais lisible par la Finance ni la Direction. Les photos partagées ne
--    portent aucune coordonnée.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Paramètres (provisoires : à ajuster après les deux semaines de test)
-- ---------------------------------------------------------------------
insert into public.moto_parametres (cle, valeur, unite, description, provisoire) values
  ('mission_seuil_hors_mission_km', 5, 'km', 'Kilomètres entre l''arrivée d''une mission et le départ de la suivante au-delà desquels une vérification est demandée', true),
  ('mission_seuil_continuite_km', 100, 'km', 'Écart avec le dernier relevé connu de la moto au-delà duquel le compteur de départ est à vérifier', true),
  ('mission_vitesse_max_kmh', 90, 'km/h', 'Vitesse moyenne au-delà de laquelle une mission est signalée', true),
  ('mission_distance_max_km', 250, 'km', 'Distance d''une mission au-delà de laquelle elle est signalée', true),
  ('mission_photo_max_octets', 200000, 'octets', 'Taille maximale d''une photo de compteur', true),
  ('mission_photos_conservation_mois', 12, 'mois', 'Durée de conservation des photos de compteur avant purge documentée', true),
  ('mission_horloge_ecart_max_min', 10, 'minutes', 'Écart toléré entre l''horloge du téléphone et celle du serveur', true),
  ('mission_delai_saisie_jours', 7, 'jours', 'Ancienneté maximale d''une capture hors connexion acceptée à la synchronisation', true),
  ('mission_saisie_differee_h', 12, 'heures', 'Délai entre la capture et la réception au serveur au-delà duquel le relevé est signalé', true)
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 2. Relevés : nouvelle source MISSION
-- ---------------------------------------------------------------------
alter table public.moto_releves_km drop constraint if exists moto_releves_km_source_check;
alter table public.moto_releves_km add constraint moto_releves_km_source_check
  check (source in ('RELEVE','CONTROLE','CARBURANT','REMISE','INCIDENT','MAINTENANCE','CORRECTION','MISSION'));

-- ---------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------
create table if not exists public.moto_missions (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  conducteur_id uuid not null references public.profils(user_id),
  objet text not null check (objet in ('ACHAT_COLLECTE','SENSIBILISATION','RECENSEMENT','SUPERVISION','LIVRAISON',
                                       'GARAGE','CARBURANT','ADMINISTRATIF','AUTRE')),
  objet_detail text,
  destination text not null check (length(btrim(destination)) >= 2),
  statut text not null default 'OUVERTE' check (statut in ('OUVERTE','CLOTUREE','ANNULEE')),
  depart_releve_id uuid not null references public.moto_releves_km(id),
  depart_km numeric(10,1) not null check (depart_km >= 0),
  depart_at timestamptz not null,
  depart_recu_at timestamptz not null default now(),
  depart_origine text not null check (depart_origine in ('LU_CONFIRME','LU_CORRIGE','SAISI')),
  depart_lu_km numeric(10,1),
  depart_localite text,
  depart_gps_statut text not null check (depart_gps_statut in ('OK','IMPRECIS','ANCIEN','ABSENT')),
  depart_horloge_ecart_s integer,
  depart_client_op_id uuid not null unique,
  arrivee_releve_id uuid references public.moto_releves_km(id),
  arrivee_km numeric(10,1),
  arrivee_at timestamptz,
  arrivee_recu_at timestamptz,
  arrivee_origine text check (arrivee_origine in ('LU_CONFIRME','LU_CORRIGE','SAISI')),
  arrivee_lu_km numeric(10,1),
  arrivee_localite text,
  arrivee_gps_statut text check (arrivee_gps_statut in ('OK','IMPRECIS','ANCIEN','ABSENT')),
  arrivee_horloge_ecart_s integer,
  arrivee_client_op_id uuid unique,
  annule_par uuid,
  annule_at timestamptz,
  annule_motif text,
  created_at timestamptz not null default now(),
  check (objet <> 'AUTRE' or length(btrim(coalesce(objet_detail, ''))) >= 5),
  check (statut <> 'CLOTUREE' or (arrivee_releve_id is not null and arrivee_at is not null and arrivee_origine is not null
                                  and arrivee_gps_statut is not null and arrivee_client_op_id is not null)),
  check (statut = 'CLOTUREE' or arrivee_releve_id is null),
  check (arrivee_at is null or arrivee_at >= depart_at),
  check (arrivee_km is null or arrivee_km >= depart_km),
  check ((arrivee_km is null) = (arrivee_releve_id is null)),
  check (statut <> 'ANNULEE' or (annule_par is not null and annule_at is not null and length(btrim(coalesce(annule_motif, ''))) >= 10)),
  check (annule_par is null or annule_par <> conducteur_id),
  check ((depart_origine = 'SAISI') = (depart_lu_km is null)),
  check (arrivee_origine is null or (arrivee_origine = 'SAISI') = (arrivee_lu_km is null))
);
create unique index if not exists moto_missions_ouverte_moto_uq on public.moto_missions (moto_id) where statut = 'OUVERTE';
create unique index if not exists moto_missions_ouverte_conducteur_uq on public.moto_missions (conducteur_id) where statut = 'OUVERTE';
create index if not exists moto_missions_moto_idx on public.moto_missions (moto_id, depart_at desc);
create index if not exists moto_missions_conducteur_idx on public.moto_missions (conducteur_id, depart_at desc);
create index if not exists moto_missions_depart_releve_idx on public.moto_missions (depart_releve_id);
create index if not exists moto_missions_arrivee_releve_idx on public.moto_missions (arrivee_releve_id);

-- Photos de compteur : une empreinte et un fichier ne servent qu'UNE fois.
create table if not exists public.moto_mission_photos (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.moto_missions(id),
  moment text not null check (moment in ('DEPART','ARRIVEE')),
  chemin text not null unique,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  taille_octets integer check (taille_octets is null or taille_octets > 0),
  etag text unique,   -- empreinte calculée PAR LE STOCKAGE : un même fichier ne sert qu'une fois
  depose_par uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (mission_id, moment)
);

-- Positions exactes : séparées, jamais journalisées, lecture restreinte.
create table if not exists public.moto_mission_positions (
  mission_id uuid not null references public.moto_missions(id),
  moment text not null check (moment in ('DEPART','ARRIVEE')),
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  precision_m numeric(8,1) check (precision_m is null or precision_m >= 0),
  gps_at timestamptz,
  primary key (mission_id, moment)
);

create table if not exists public.moto_mission_anomalies (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.moto_missions(id),
  moto_id uuid not null references public.moto_motos(id),
  conducteur_id uuid not null,
  type_anomalie text not null check (type_anomalie in ('HORS_MISSION','CONTINUITE','VITESSE','DISTANCE','HORLOGE','GPS_ABSENT','CLOTURE_TARDIVE',
                                                'SAISIE_DIFFEREE_DEPART','SAISIE_DIFFEREE_ARRIVEE')),
  detail text not null,
  valeur numeric,
  seuil numeric,
  statut text not null default 'A_VERIFIER' check (statut in ('A_VERIFIER','JUSTIFIEE','NON_JUSTIFIEE')),
  traite_par uuid,
  traite_at timestamptz,
  traite_motif text,
  created_at timestamptz not null default now(),
  unique (mission_id, type_anomalie),
  check (statut = 'A_VERIFIER' or (traite_par is not null and traite_at is not null and length(btrim(coalesce(traite_motif, ''))) >= 10)),
  check (traite_par is null or traite_par <> conducteur_id)
);
create index if not exists moto_mission_anomalies_moto_idx on public.moto_mission_anomalies (moto_id, statut);

-- ---------------------------------------------------------------------
-- 4. Fonctions internes
-- ---------------------------------------------------------------------
create or replace function private.moto_mission_lecture(p_mission public.moto_missions)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select p_mission.conducteur_id = auth.uid()
      or (private.moto_classe() in ('LOGISTIQUE','ABM','BM','FINANCE','DIRECTION') and private.moto_dans_perimetre(p_mission.moto_id))
      or (private.moto_classe() = 'ZONE' and private.moto_peut_operer(p_mission.moto_id))   -- sa zone (ou sa propre moto)
$$;

create or replace function private.moto_mission_lecture_id(p_mission uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select coalesce((select private.moto_mission_lecture(m) from public.moto_missions m where m.id = p_mission), false)
$$;

-- Positions exactes : Chef de zone, coordinateur, ABM, BM. Ni l'agent, ni la Finance, ni la Direction.
create or replace function private.moto_mission_lecture_position(p_mission uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select exists (select 1 from public.moto_missions m where m.id = p_mission
                 and ((private.moto_classe() in ('LOGISTIQUE','ABM','BM') and private.moto_dans_perimetre(m.moto_id))
                      or (private.moto_classe() = 'ZONE' and private.moto_peut_operer(m.moto_id))))
$$;

create or replace function private.moto_mission_photo_lecture(p_nom text)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select private.moto_classe() in ('BM','ABM')
      or exists (select 1 from public.moto_mission_photos ph where ph.chemin = p_nom and private.moto_mission_lecture_id(ph.mission_id))
$$;

create or replace function private.moto_mission_gps_statut(p jsonb, p_prefixe text)
returns text language plpgsql immutable as $$
declare v text := upper(coalesce(p ->> (p_prefixe || 'gps_statut'), ''));
begin
  if p ->> (p_prefixe || 'latitude') is null or p ->> (p_prefixe || 'longitude') is null then return 'ABSENT'; end if;
  if v in ('OK','IMPRECIS','ANCIEN') then return v; end if;
  return 'OK';
end $$;

-- Horloge : écart (secondes) entre l'heure du téléphone au moment de l'envoi et l'heure du serveur.
create or replace function private.moto_mission_horloge(p jsonb)
returns integer language plpgsql stable as $$
begin
  if nullif(p ->> 'horloge_envoi', '') is null then return null; end if;
  return round(extract(epoch from (now() - (p ->> 'horloge_envoi')::timestamptz)))::integer;
exception when others then
  raise exception 'Horloge d''envoi invalide.' using errcode = 'P0001';
end $$;

create or replace function private.moto_mission_signaler(p_mission uuid, p_type text, p_detail text, p_valeur numeric, p_seuil numeric)
returns void language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.moto_mission_anomalies (mission_id, moto_id, conducteur_id, type_anomalie, detail, valeur, seuil)
  select m.id, m.moto_id, m.conducteur_id, p_type, p_detail, p_valeur, p_seuil from public.moto_missions m where m.id = p_mission
  on conflict (mission_id, type_anomalie) do nothing
$$;

-- Photo : chemin attendu, fichier réellement déposé par le conducteur, taille, empreinte inédite.
create or replace function private.moto_mission_photo(p_mission uuid, p_moto uuid, p_client uuid, p_moment text, p jsonb)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_chemin text := nullif(btrim(coalesce(p ->> 'photo_path', '')), '');
        v_sha text := lower(nullif(btrim(coalesce(p ->> 'photo_sha256', '')), ''));
        v_attendu text := p_moto::text || '/mission/' || p_client::text || '-photo_path.jpg';
        o jsonb; v_taille bigint; v_etag text; v_max numeric := coalesce(private.moto_param('mission_photo_max_octets'), 200000);
begin
  if v_chemin is null then perform private.moto_erreur('Photo du compteur obligatoire.'); end if;
  if v_chemin <> v_attendu then perform private.moto_erreur('Photo du compteur : chemin inattendu.'); end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then perform private.moto_erreur('Empreinte de la photo absente ou invalide.'); end if;
  select to_jsonb(s) into o from storage.objects s where s.bucket_id = 'moto-documents' and s.name = v_chemin;
  if o is null then perform private.moto_erreur('Photo du compteur introuvable sur le serveur : relancez la synchronisation.'); end if;
  if coalesce(o ->> 'owner_id', o ->> 'owner', '') <> auth.uid()::text then
    perform private.moto_refus('La photo doit être déposée par le conducteur lui-même.');
  end if;
  v_taille := nullif(o -> 'metadata' ->> 'size', '')::bigint;
  if v_taille is not null and v_taille > v_max then perform private.moto_erreur(format('Photo trop lourde (%s octets, maximum %s).', v_taille, v_max)); end if;
  if coalesce(o -> 'metadata' ->> 'mimetype', 'image/jpeg') <> 'image/jpeg' then perform private.moto_erreur('Photo du compteur : format JPEG attendu.'); end if;
  v_etag := lower(nullif(btrim(coalesce(o -> 'metadata' ->> 'eTag', ''), '" '), ''));
  if exists (select 1 from public.moto_mission_photos where sha256 = v_sha or (v_etag is not null and etag = v_etag)) then
    perform private.moto_refus('Cette photo a déjà été utilisée pour un autre relevé : reprenez une photo du compteur.');
  end if;
  -- L'empreinte SHA-256 est DÉCLARÉE par le téléphone (le serveur SQL ne lit pas le fichier) ;
  -- l'eTag est calculé par le stockage. Toute personne qui ouvre la photo recalcule le SHA-256
  -- et voit « empreinte conforme » ou « DIFFÉRENTE ».
  insert into public.moto_mission_photos (mission_id, moment, chemin, sha256, taille_octets, etag)
  values (p_mission, p_moment, v_chemin, v_sha, v_taille, v_etag);
end $$;

create or replace function private.moto_mission_position(p_mission uuid, p_moment text, p jsonb, p_prefixe text)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if p ->> (p_prefixe || 'latitude') is null or p ->> (p_prefixe || 'longitude') is null then return; end if;
  insert into public.moto_mission_positions (mission_id, moment, latitude, longitude, precision_m, gps_at)
  values (p_mission, p_moment, private.moto_num(p, p_prefixe || 'latitude'), private.moto_num(p, p_prefixe || 'longitude'),
          private.moto_num(p, p_prefixe || 'precision_m'), nullif(p ->> (p_prefixe || 'gps_at'), '')::timestamptz);
end $$;

create or replace function private.moto_mission_origine(p jsonb, p_km numeric)
returns text language plpgsql immutable as $$
declare v text := upper(coalesce(p ->> 'origine', '')); v_lu numeric := private.moto_num(p, 'lu_km');
begin
  if v not in ('LU_CONFIRME','LU_CORRIGE','SAISI') then raise exception 'Origine du relevé inconnue.' using errcode = 'P0001'; end if;
  if v = 'SAISI' and v_lu is not null then raise exception 'Relevé saisi : aucune lecture proposée ne doit être transmise.' using errcode = 'P0001'; end if;
  if v <> 'SAISI' and v_lu is null then raise exception 'Lecture proposée manquante.' using errcode = 'P0001'; end if;
  if v = 'LU_CONFIRME' and v_lu <> p_km then raise exception 'Lecture confirmée différente du compteur transmis : origine LU_CORRIGE attendue.' using errcode = 'P0001'; end if;
  if v = 'LU_CORRIGE' and v_lu = p_km then raise exception 'Lecture corrigée identique à la proposition : origine LU_CONFIRME attendue.' using errcode = 'P0001'; end if;
  return v;
end $$;

create or replace function private.moto_mission_capture(p jsonb)
returns timestamptz language plpgsql stable
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_at timestamptz;
begin
  begin v_at := nullif(p ->> 'capture_at', '')::timestamptz;
  exception when others then perform private.moto_erreur('Heure de capture invalide.'); end;
  if v_at is null then perform private.moto_erreur('Heure de capture obligatoire.'); end if;
  if v_at > now() + interval '5 minutes' then perform private.moto_erreur('Heure de capture dans le futur : vérifiez l''heure du téléphone.'); end if;
  if v_at < now() - make_interval(days => coalesce(private.moto_param('mission_delai_saisie_jours'), 7)::integer) then
    perform private.moto_erreur('Capture trop ancienne : synchronisez au plus tard dans le délai prévu.');
  end if;
  return v_at;
end $$;

-- Cohérence d'une mission après correction de l'un de ses relevés (circuit à quatre yeux).
create or replace function private.moto_mission_releve_coherence()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if new.compteur_km is distinct from old.compteur_km then
    if new.compteur_km < (select max(r.compteur_km) from public.moto_releves_km r where r.moto_id = new.moto_id and r.id <> new.id and r.date_releve <= new.date_releve) then
      raise exception 'Correction refusée : la valeur serait inférieure à un relevé antérieur de la moto (le compteur ne recule pas).' using errcode = 'P0001';
    end if;
    if new.compteur_km > (select min(r.compteur_km) from public.moto_releves_km r where r.moto_id = new.moto_id and r.id <> new.id and r.date_releve > new.date_releve) then
      raise exception 'Correction refusée : la valeur dépasserait un relevé postérieur de la moto.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.moto_missions m where m.depart_releve_id = new.id and m.arrivee_km < new.compteur_km) then
      raise exception 'Correction refusée : le compteur de départ dépasserait celui d''arrivée de la mission.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.moto_missions m where m.arrivee_releve_id = new.id and new.compteur_km < m.depart_km) then
      raise exception 'Correction refusée : le compteur d''arrivée serait inférieur à celui du départ de la mission.' using errcode = 'P0001';
    end if;
    update public.moto_missions set depart_km = new.compteur_km where depart_releve_id = new.id;
    update public.moto_missions set arrivee_km = new.compteur_km where arrivee_releve_id = new.id;
    -- Les écarts encore à vérifier de la moto sont des constats à l'heure du relevé : on le signale.
    update public.moto_mission_anomalies set detail = detail || format(' [compteur corrigé ensuite : %s → %s km ; se fier aux chiffres recalculés du tableau]', old.compteur_km, new.compteur_km)
    where statut = 'A_VERIFIER' and moto_id = new.moto_id
      and mission_id in (select id from public.moto_missions where depart_releve_id = new.id or arrivee_releve_id = new.id
                         or (moto_id = new.moto_id and depart_at >= new.date_releve));
  end if;
  return new;
end $$;
drop trigger if exists moto_releves_mission_coherence_trg on public.moto_releves_km;
create trigger moto_releves_mission_coherence_trg before update of compteur_km on public.moto_releves_km
  for each row execute function private.moto_mission_releve_coherence();

create or replace function private.moto_mission_immuable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'moto_mission_photos' and current_setting('moto.purge', true) = 'on' then return old; end if;
  raise exception 'Les photos et positions de mission ne se modifient pas.' using errcode = '42501';
end $$;
drop trigger if exists moto_mission_photos_immuable_trg on public.moto_mission_photos;
create trigger moto_mission_photos_immuable_trg before update or delete on public.moto_mission_photos
  for each row execute function private.moto_mission_immuable();
drop trigger if exists moto_mission_positions_immuable_trg on public.moto_mission_positions;
create trigger moto_mission_positions_immuable_trg before update or delete on public.moto_mission_positions
  for each row execute function private.moto_mission_immuable();

-- ---------------------------------------------------------------------
-- 5. RPC publiques
-- ---------------------------------------------------------------------
create or replace function public.moto_mission_demarrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
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
  select mi.id, mi.depart_at, private.moto_nom_profil(mi.conducteur_id) as nom into v_ouverte
  from public.moto_missions mi where mi.moto_id = v_moto and mi.statut = 'OUVERTE';
  if found then
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
  -- Pas de départ antidaté avant ce que le serveur connaît déjà de la moto ou du conducteur.
  select max(r.date_releve) into v_dern_at from public.moto_releves_km r where r.moto_id = v_moto;
  if v_dern_at is not null and v_at < v_dern_at then
    perform private.moto_erreur(format('Heure de départ (%s) antérieure au dernier relevé de la moto (%s) : vérifiez l''heure du téléphone.',
                                       to_char(v_at, 'DD/MM/YYYY HH24:MI'), to_char(v_dern_at, 'DD/MM/YYYY HH24:MI')));
  end if;
  if exists (select 1 from public.moto_missions where conducteur_id = auth.uid() and statut = 'CLOTUREE' and arrivee_at > v_at) then
    perform private.moto_erreur('Départ antérieur à la fin de votre mission précédente : deux missions ne se chevauchent pas.');
  end if;
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
  v_seuil := coalesce(private.moto_param('mission_saisie_differee_h'), 12);
  if now() - v_at > make_interval(hours => v_seuil::integer) then
    perform private.moto_mission_signaler(v_id, 'SAISIE_DIFFEREE_DEPART', format('Départ photographié le %s, reçu %s heure(s) plus tard.', to_char(v_at, 'DD/MM/YYYY HH24:MI'), round(extract(epoch from now() - v_at) / 3600)), round(extract(epoch from now() - v_at) / 3600), v_seuil);
  end if;
  v_res := jsonb_build_object('id', v_id, 'statut', 'OUVERTE', 'compteur_km', v_km,
                              'anomalies', (select coalesce(jsonb_agg(type_anomalie), '[]'::jsonb) from public.moto_mission_anomalies where mission_id = v_id));
  perform private.moto_op_enregistrer(v_client, 'MISSION_DEPART', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_mission_cloturer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_id uuid := private.moto_uuid(p, 'mission_id');
        v_km numeric := private.moto_num(p, 'compteur_km'); v_at timestamptz; v_origine text; mi public.moto_missions;
        v_dep_km numeric; v_releve uuid; v_dist numeric; v_h numeric; v_seuil numeric; v_ecart integer;
        v_gps text := private.moto_mission_gps_statut(p, ''); v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  if v_client is null then perform private.moto_erreur('Identifiant d''opération obligatoire.'); end if;
  if v_id is null then perform private.moto_erreur('Mission non précisée.'); end if;
  select * into mi from public.moto_missions where id = v_id;
  if not found then
    -- Erreur TEMPORAIRE (code hors liste des refus) : l'arrivée sera renvoyée après la synchronisation du départ.
    raise exception 'Mission introuvable : le départ n''est pas encore synchronisé.' using errcode = '55000';
  end if;
  perform private.moto_charger(mi.moto_id, true);   -- même ordre de verrous que le départ : moto, puis mission
  select * into mi from public.moto_missions where id = v_id for update;
  if mi.conducteur_id <> auth.uid() then perform private.moto_refus('Seul le conducteur qui a ouvert la mission peut la clôturer.'); end if;
  if mi.statut <> 'OUVERTE' then perform private.moto_erreur('Mission déjà clôturée ou annulée.'); end if;
  if v_km is null then perform private.moto_erreur('Compteur d''arrivée obligatoire.'); end if;
  v_at := private.moto_mission_capture(p);
  if v_at < mi.depart_at then perform private.moto_erreur('Heure d''arrivée antérieure au départ.'); end if;
  if v_at < (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = mi.moto_id) then
    perform private.moto_erreur('Heure d''arrivée antérieure au dernier relevé de la moto : vérifiez l''heure du téléphone.');
  end if;
  v_dep_km := mi.depart_km;
  if v_km < v_dep_km then
    perform private.moto_erreur(format('Compteur d''arrivée (%s km) inférieur au compteur de départ (%s km).', v_km, v_dep_km));
  end if;
  v_origine := private.moto_mission_origine(p, v_km);
  perform private.moto_motif('Fin de mission');
  perform private.moto_enregistrer_km(mi.moto_id, v_km, v_at, 'MISSION');
  select r.id into v_releve from public.moto_releves_km r
  where r.moto_id = mi.moto_id and r.source = 'MISSION' and r.date_releve = v_at and r.compteur_km = v_km
    and not exists (select 1 from public.moto_missions x where x.depart_releve_id = r.id or x.arrivee_releve_id = r.id)
  order by r.created_at desc limit 1;
  v_ecart := private.moto_mission_horloge(p);
  update public.moto_missions set statut = 'CLOTUREE', arrivee_releve_id = v_releve, arrivee_km = v_km, arrivee_at = v_at, arrivee_recu_at = now(),
         arrivee_origine = v_origine, arrivee_lu_km = private.moto_num(p, 'lu_km'),
         arrivee_localite = nullif(btrim(coalesce(p ->> 'localite', '')), ''), arrivee_gps_statut = v_gps,
         arrivee_horloge_ecart_s = v_ecart, arrivee_client_op_id = v_client
  where id = v_id;
  perform private.moto_mission_photo(v_id, mi.moto_id, v_client, 'ARRIVEE', p);
  perform private.moto_mission_position(v_id, 'ARRIVEE', p, '');
  v_dist := v_km - v_dep_km; v_h := extract(epoch from (v_at - mi.depart_at)) / 3600.0;
  v_seuil := coalesce(private.moto_param('mission_vitesse_max_kmh'), 90);
  if v_dist > 1 and (v_h <= 0 or v_dist / v_h > v_seuil) then
    perform private.moto_mission_signaler(v_id, 'VITESSE',
      format('%s km en %s minute(s) : vitesse moyenne impossible.', v_dist, round(v_h * 60)),
      case when v_h > 0 then round(v_dist / v_h, 1) end, v_seuil);
  end if;
  v_seuil := coalesce(private.moto_param('mission_distance_max_km'), 250);
  if v_dist > v_seuil then
    perform private.moto_mission_signaler(v_id, 'DISTANCE', format('%s km pour une seule mission.', v_dist), v_dist, v_seuil);
  end if;
  if v_at::date > mi.depart_at::date then
    perform private.moto_mission_signaler(v_id, 'CLOTURE_TARDIVE',
      format('Mission commencée le %s et clôturée le %s.', to_char(mi.depart_at, 'DD/MM/YYYY'), to_char(v_at, 'DD/MM/YYYY')), null, null);
  end if;
  v_seuil := coalesce(private.moto_param('mission_horloge_ecart_max_min'), 10) * 60;
  if v_ecart is not null and abs(v_ecart) > v_seuil then
    perform private.moto_mission_signaler(v_id, 'HORLOGE', format('Horloge du téléphone décalée de %s minute(s) par rapport au serveur.', round(v_ecart / 60.0)), v_ecart, v_seuil);
  end if;
  if v_gps = 'ABSENT' then
    perform private.moto_mission_signaler(v_id, 'GPS_ABSENT', 'Position non disponible à l''arrivée.', null, null);
  end if;
  v_seuil := coalesce(private.moto_param('mission_saisie_differee_h'), 12);
  if now() - v_at > make_interval(hours => v_seuil::integer) then
    perform private.moto_mission_signaler(v_id, 'SAISIE_DIFFEREE_ARRIVEE', format('Arrivée photographiée le %s, reçue %s heure(s) plus tard.', to_char(v_at, 'DD/MM/YYYY HH24:MI'), round(extract(epoch from now() - v_at) / 3600)), round(extract(epoch from now() - v_at) / 3600), v_seuil);
  end if;
  v_res := jsonb_build_object('id', v_id, 'statut', 'CLOTUREE', 'distance_km', v_dist,
                              'anomalies', (select coalesce(jsonb_agg(type_anomalie), '[]'::jsonb) from public.moto_mission_anomalies where mission_id = v_id));
  perform private.moto_op_enregistrer(v_client, 'MISSION_ARRIVEE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

-- Mission ouverte par erreur ou jamais clôturée : annulée par un responsable,
-- jamais estimée. Le relevé de départ (vrai relevé) est conservé.
create or replace function public.moto_mission_annuler(p_mission uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare mi public.moto_missions;
begin
  perform private.moto_exiger_classe(array['ZONE','LOGISTIQUE','ABM','BM']);
  select * into mi from public.moto_missions where id = p_mission;
  if not found then perform private.moto_erreur('Mission introuvable.'); end if;
  perform private.moto_charger(mi.moto_id, true);
  select * into mi from public.moto_missions where id = p_mission for update;
  if not private.moto_peut_operer(mi.moto_id) then perform private.moto_refus('Mission hors de votre périmètre.'); end if;
  if mi.conducteur_id = auth.uid() then perform private.moto_refus('Quatre yeux : le conducteur n''annule pas sa propre mission.'); end if;
  if mi.statut <> 'OUVERTE' then perform private.moto_erreur('Seule une mission ouverte peut être annulée.'); end if;
  perform private.moto_motif(p_motif, 10);
  update public.moto_missions set statut = 'ANNULEE', annule_par = auth.uid(), annule_at = now(), annule_motif = btrim(p_motif) where id = p_mission;
  return jsonb_build_object('id', p_mission, 'statut', 'ANNULEE');
end $$;

create or replace function public.moto_mission_anomalie_traiter(p_anomalie uuid, p_decision text, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_mission_anomalies; v_dec text := upper(coalesce(p_decision, ''));
begin
  perform private.moto_exiger_classe(array['ZONE','LOGISTIQUE','ABM','BM']);
  select * into a from public.moto_mission_anomalies where id = p_anomalie for update;
  if not found then perform private.moto_erreur('Écart introuvable.'); end if;
  if not private.moto_peut_operer(a.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if a.conducteur_id = auth.uid() then perform private.moto_refus('Quatre yeux : le conducteur ne vérifie pas ses propres écarts.'); end if;
  if a.statut <> 'A_VERIFIER' then perform private.moto_erreur('Écart déjà vérifié.'); end if;
  if v_dec not in ('JUSTIFIEE','NON_JUSTIFIEE') then perform private.moto_erreur('Décision inconnue.'); end if;
  perform private.moto_motif(p_motif, 10);
  update public.moto_mission_anomalies set statut = v_dec, traite_par = auth.uid(), traite_at = now(), traite_motif = btrim(p_motif)
  where id = p_anomalie;
  return jsonb_build_object('id', p_anomalie, 'statut', v_dec);
end $$;

-- Photos arrivées au terme de leur conservation : liste pour une purge documentée par le BM.
create or replace function public.moto_missions_photos_a_purger()
returns table (chemin text, moment text, mission_id uuid, depose_le timestamptz)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM']);
  return query
  select ph.chemin, ph.moment, ph.mission_id, ph.created_at from public.moto_mission_photos ph
  where ph.created_at < now() - make_interval(months => coalesce(private.moto_param('mission_photos_conservation_mois'), 12)::integer)
  order by ph.created_at;
end $$;

-- Purge documentée (BM) : après suppression des fichiers par l'API Storage, retire leurs lignes.
create or replace function public.moto_missions_photos_purger(p_chemins text[])
returns integer language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare n integer;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform set_config('moto.purge', 'on', true);
  perform private.moto_motif('Purge des photos de compteur arrivées en fin de conservation');
  delete from public.moto_mission_photos ph
  where ph.chemin = any(coalesce(p_chemins, '{}'))
    and ph.created_at < now() - make_interval(months => coalesce(private.moto_param('mission_photos_conservation_mois'), 12)::integer);
  get diagnostics n = row_count;
  perform set_config('moto.purge', 'off', true);
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Vues (sans aucune coordonnée)
-- ---------------------------------------------------------------------
create or replace view public.moto_v_missions with (security_invoker = on) as
select mi.id, mi.moto_id, mo.code as moto_code, mo.cluster_code, mo.zone_code, mi.conducteur_id,
       private.moto_nom_profil(mi.conducteur_id) as conducteur_nom, mi.objet, mi.objet_detail, mi.destination, mi.statut,
       mi.depart_at, mi.depart_km as km_depart, mi.depart_origine, mi.depart_lu_km, mi.depart_localite, mi.depart_gps_statut,
       mi.arrivee_at, mi.arrivee_km as km_arrivee, mi.arrivee_origine, mi.arrivee_lu_km, mi.arrivee_localite, mi.arrivee_gps_statut,
       mi.arrivee_km - mi.depart_km as distance_km,
       case when mi.arrivee_at is not null then round(extract(epoch from (mi.arrivee_at - mi.depart_at)) / 60) end as duree_min,
       case when mi.statut <> 'ANNULEE' then   -- une mission annulée ne compte pas : ses km le seront au départ suivant
       (select mi.depart_km - pm.arrivee_km
          from public.moto_missions pm
         where pm.moto_id = mi.moto_id and pm.statut = 'CLOTUREE' and pm.arrivee_at <= mi.depart_at and pm.id <> mi.id
         order by pm.arrivee_at desc limit 1) end as km_hors_mission_avant,
       (mi.statut = 'OUVERTE' and mi.depart_at::date < current_date) as non_cloturee_a_temps,
       (select ph.chemin from public.moto_mission_photos ph where ph.mission_id = mi.id and ph.moment = 'DEPART') as photo_depart,
       (select ph.chemin from public.moto_mission_photos ph where ph.mission_id = mi.id and ph.moment = 'ARRIVEE') as photo_arrivee,
       (select ph.sha256 from public.moto_mission_photos ph where ph.mission_id = mi.id and ph.moment = 'DEPART') as sha256_depart,
       (select ph.sha256 from public.moto_mission_photos ph where ph.mission_id = mi.id and ph.moment = 'ARRIVEE') as sha256_arrivee,
       (select count(*) from public.moto_mission_anomalies an where an.mission_id = mi.id and an.statut = 'A_VERIFIER') as ecarts_a_verifier,
       (select coalesce(jsonb_agg(an.type_anomalie order by an.type_anomalie), '[]'::jsonb) from public.moto_mission_anomalies an where an.mission_id = mi.id) as types_ecarts,
       mi.annule_motif, private.moto_nom_profil(mi.annule_par) as annule_par_nom,
       date_trunc('month', mi.depart_at)::date as mois
from public.moto_missions mi
join public.moto_motos mo on mo.id = mi.moto_id;

create or replace view public.moto_v_mission_ecarts with (security_invoker = on) as
select an.id, an.mission_id, an.moto_id, mo.code as moto_code, mo.cluster_code, an.conducteur_id,
       private.moto_nom_profil(an.conducteur_id) as conducteur_nom, an.type_anomalie, an.detail, an.valeur, an.seuil, an.statut,
       an.created_at, mi.depart_at, private.moto_nom_profil(an.traite_par) as traite_par_nom, an.traite_at, an.traite_motif
from public.moto_mission_anomalies an
join public.moto_missions mi on mi.id = an.mission_id
join public.moto_motos mo on mo.id = an.moto_id;

-- Synthèse mensuelle par agent et par moto.
create or replace view public.moto_v_missions_mois with (security_invoker = on) as
select date_trunc('month', v.depart_at)::date as mois, v.moto_id, v.moto_code, v.cluster_code, v.conducteur_id, v.conducteur_nom,
       count(*) filter (where v.statut <> 'ANNULEE') as missions,
       count(*) filter (where v.statut = 'CLOTUREE') as missions_cloturees,
       count(*) filter (where v.statut = 'OUVERTE') as missions_ouvertes,
       count(*) filter (where v.non_cloturee_a_temps) as missions_non_cloturees_a_temps,
       count(*) filter (where v.statut = 'ANNULEE') as missions_annulees,
       coalesce(sum(v.distance_km) filter (where v.statut = 'CLOTUREE'), 0) as km_mission,
       coalesce(sum(greatest(v.km_hors_mission_avant, 0)), 0) as km_hors_mission,
       coalesce(sum(v.ecarts_a_verifier), 0) as ecarts_a_verifier,
       count(*) filter (where v.depart_origine = 'LU_CORRIGE') + count(*) filter (where v.arrivee_origine = 'LU_CORRIGE') as releves_lus_corriges,
       count(*) filter (where v.depart_origine = 'SAISI') + count(*) filter (where v.arrivee_origine = 'SAISI') as releves_saisis,
       count(*) filter (where v.depart_origine = 'LU_CONFIRME') + count(*) filter (where v.arrivee_origine = 'LU_CONFIRME') as releves_lus_confirmes
from public.moto_v_missions v
group by 1, 2, 3, 4, 5, 6;

-- Coût par kilomètre de mission, par moto et par mois.
-- Carburant : justificatifs VÉRIFIÉS du mois. Entretien : factures VÉRIFIÉES du mois
-- (masquées sans lecture financière). « Non disponible » (NULL) si aucun km de mission.
create or replace view public.moto_v_missions_couts with (security_invoker = on) as
with km as (
  select date_trunc('month', v.depart_at)::date as mois, v.moto_id, v.moto_code,
         coalesce(sum(v.distance_km) filter (where v.statut = 'CLOTUREE'), 0) as km_mission,
         coalesce(sum(greatest(v.km_hors_mission_avant, 0)), 0) as km_hors_mission
  from public.moto_v_missions v group by 1, 2, 3
)
select k.mois, k.moto_id, k.moto_code, k.km_mission, k.km_hors_mission,
       coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = k.moto_id and c.justificatif_statut = 'VERIFIE'
                 and date_trunc('month', c.date_achat)::date = k.mois), 0) as cout_carburant_verifie,
       coalesce((select sum(c.litres) from public.moto_carburant c where c.moto_id = k.moto_id and c.justificatif_statut = 'VERIFIE'
                 and date_trunc('month', c.date_achat)::date = k.mois), 0) as litres_verifies,
       case when private.moto_lecture_fin_maintenance() then
         coalesce((select sum(f.montant) from public.moto_factures f where f.moto_id = k.moto_id and f.statut = 'VERIFIEE'
                   and date_trunc('month', f.date_facture)::date = k.mois), 0) end as cout_entretien_verifie,
       case when k.km_mission > 0 then round((
         coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = k.moto_id and c.justificatif_statut = 'VERIFIE'
                   and date_trunc('month', c.date_achat)::date = k.mois), 0)
         + case when private.moto_lecture_fin_maintenance() then
             coalesce((select sum(f.montant) from public.moto_factures f where f.moto_id = k.moto_id and f.statut = 'VERIFIEE'
                       and date_trunc('month', f.date_facture)::date = k.mois), 0) else 0 end) / k.km_mission, 1) end as fcfa_km_mission,
       private.moto_lecture_fin_maintenance() as entretien_inclus,
       case when k.km_mission + k.km_hors_mission > 0 then round((
         coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = k.moto_id and c.justificatif_statut = 'VERIFIE'
                   and date_trunc('month', c.date_achat)::date = k.mois), 0)
         + case when private.moto_lecture_fin_maintenance() then
             coalesce((select sum(f.montant) from public.moto_factures f where f.moto_id = k.moto_id and f.statut = 'VERIFIEE'
                       and date_trunc('month', f.date_facture)::date = k.mois), 0) else 0 end) / (k.km_mission + k.km_hors_mission), 1) end as fcfa_km_total,
       case when k.km_mission > 0 then round(
         coalesce((select sum(c.litres) from public.moto_carburant c where c.moto_id = k.moto_id and c.justificatif_statut = 'VERIFIE'
                   and date_trunc('month', c.date_achat)::date = k.mois), 0) * 100 / k.km_mission, 2) end as litres_100_km_mission
from km k;

-- ---------------------------------------------------------------------
-- 7. Sécurité : RLS, journal, droits
-- ---------------------------------------------------------------------
alter table public.moto_missions enable row level security;
alter table public.moto_mission_photos enable row level security;
alter table public.moto_mission_positions enable row level security;
alter table public.moto_mission_anomalies enable row level security;
revoke all on public.moto_missions, public.moto_mission_photos, public.moto_mission_positions, public.moto_mission_anomalies from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.moto_missions, public.moto_mission_photos, public.moto_mission_positions, public.moto_mission_anomalies from authenticated;
grant select on public.moto_missions, public.moto_mission_photos, public.moto_mission_positions, public.moto_mission_anomalies to authenticated;

drop policy if exists moto_missions_lecture on public.moto_missions;
create policy moto_missions_lecture on public.moto_missions for select to authenticated using (private.moto_mission_lecture(moto_missions));
drop policy if exists moto_mission_photos_lecture on public.moto_mission_photos;
create policy moto_mission_photos_lecture on public.moto_mission_photos for select to authenticated using (private.moto_mission_lecture_id(mission_id));
drop policy if exists moto_mission_anomalies_lecture on public.moto_mission_anomalies;
create policy moto_mission_anomalies_lecture on public.moto_mission_anomalies for select to authenticated using (private.moto_mission_lecture_id(mission_id));
drop policy if exists moto_mission_positions_lecture on public.moto_mission_positions;
create policy moto_mission_positions_lecture on public.moto_mission_positions for select to authenticated using (private.moto_mission_lecture_position(mission_id));

-- Journal : missions, photos et écarts (aucune coordonnée). Les positions ne sont JAMAIS journalisées.
do $$
declare t text;
begin
  foreach t in array array['moto_missions','moto_mission_photos','moto_mission_anomalies'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_journal_trg', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.moto_journaliser()', t || '_journal_trg', t);
  end loop;
end $$;

revoke all on public.moto_v_missions, public.moto_v_mission_ecarts, public.moto_v_missions_mois, public.moto_v_missions_couts from anon;
grant select on public.moto_v_missions, public.moto_v_mission_ecarts, public.moto_v_missions_mois, public.moto_v_missions_couts to authenticated;

-- ---------------------------------------------------------------------
-- 8. Synchronisation hors connexion : départ et arrivée de mission
--    (texte de la migration 5, deux types ajoutés)
-- ---------------------------------------------------------------------
create or replace function public.moto_sync_batch(p_operations jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare op jsonb; v_type text; v_client uuid; v_payload jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb; v_state text; v_msg text; v_prev jsonb;
begin
  if auth.uid() is null or private.moto_classe() is null then perform private.moto_refus('Accès AFLP FLEET refusé.'); end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then perform private.moto_erreur('Lot invalide.'); end if;
  if jsonb_array_length(p_operations) > 50 then perform private.moto_erreur('Lot limité à 50 opérations.'); end if;
  for op in select * from jsonb_array_elements(p_operations) loop
    v_type := upper(coalesce(op ->> 'type', ''));
    v_client := private.moto_uuid_ou_null(op ->> 'client_op_id');
    if v_client is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', op ->> 'client_op_id', 'statut', 'REJETE', 'message', 'Identifiant d''opération manquant ou invalide.'));
      continue;
    end if;
    v_payload := coalesce(op -> 'payload', '{}'::jsonb) || jsonb_build_object('client_op_id', v_client::text);
    begin
      v_prev := private.moto_op_existant(v_client);
      if v_prev is not null then
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', coalesce(v_prev ->> 'statut', 'SYNCHRONISE'),
                                                                'doublon', true, 'resultat', v_prev, 'message', v_prev ->> 'message'));
        continue;
      end if;
      v_res := case v_type
        when 'RELEVE_KM' then public.moto_releve_km(v_payload)
        when 'CONTROLE_DEPART' then public.moto_controle_depart(v_payload)
        when 'CARBURANT' then public.moto_carburant_declarer(v_payload)
        when 'INCIDENT' then public.moto_incident_declarer(v_payload)
        when 'DOTATION_CONFIRMER' then public.moto_dotation_confirmer(v_payload)
        when 'MAINTENANCE_DEMANDE' then public.moto_maintenance_demander(v_payload)
        when 'FORMATION' then public.moto_formation_enregistrer(v_payload)
        when 'INSPECTION_MENSUELLE' then public.moto_inspection_mensuelle(v_payload)
        when 'ACTION_SIGNALER' then public.moto_action_signaler(v_payload)
        when 'DEPENSE' then public.moto_depense_declarer(v_payload)
        when 'MISSION_DEPART' then public.moto_mission_demarrer(v_payload)
        when 'MISSION_ARRIVEE' then public.moto_mission_cloturer(v_payload)
        else null end;
      if v_res is null then perform private.moto_erreur('Type d''opération non synchronisable : '||v_type); end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'SYNCHRONISE', 'resultat', v_res));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state in ('P0001','42501','23514','23505','23502','23503','22P02','22003','22007','22008','22023','2201B') then
        perform private.moto_op_enregistrer(v_client, v_type, 'REJETE', jsonb_build_object('message', v_msg, 'code', v_state));
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'REJETE', 'message', v_msg, 'code', v_state));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'ERREUR_TEMPORAIRE', 'message', v_msg, 'code', v_state));
      end if;
    end;
  end loop;
  return v_out;
end $$;


-- ---------------------------------------------------------------------
-- 9. Stockage : photos de compteur (<moto>/mission/…)
--    (texte de la migration 7, catégorie « mission » ajoutée)
-- ---------------------------------------------------------------------
create or replace function private.moto_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
        v_tit uuid;
begin
  if v_classe is null then return false; end if;
  if (storage.foldername(p_nom))[1] = 'depenses' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and v_cat = auth.uid()::text;
  end if;
  if (storage.foldername(p_nom))[1] = 'finmaint' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and (storage.foldername(p_nom))[3] in ('devis','facture')
       and exists (select 1 from public.moto_motos where id = private.moto_uuid_ou_null((storage.foldername(p_nom))[2]));
  end if;
  if (storage.foldername(p_nom))[1] = 'permis' then
    v_tit := private.moto_uuid_ou_null(v_cat);
    if v_tit is null or not private.moto_chemin_permis_valide(p_nom, v_tit) or not private.moto_beneficiaire_valide(v_tit) then return false; end if;
    return v_tit = auth.uid() or v_classe in ('BM','ABM','LOGISTIQUE');
  end if;
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document','mission'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo','mission'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle','mission'); end if;
  return false;
end $$;


-- ---------------------------------------------------------------------
-- 10. Carnet de suivi : les missions y apparaissent
--     (texte de la migration 7, une branche ajoutée)
-- ---------------------------------------------------------------------
create or replace function public.moto_carnet(p_moto uuid)
returns table (date_evenement timestamptz, categorie text, evenement text, detail text, statut text,
               compteur_km numeric, montant numeric, montant_nature text, acteur text, source text, source_id uuid)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_fin boolean := private.moto_lecture_fin_maintenance();
begin
  if p_moto is null or not private.moto_dans_perimetre(p_moto) then
    perform private.moto_refus('Moto hors de votre périmètre.');
  end if;
  return query
  select * from (
    -- Parc : enregistrement, début d'utilisation déclaré, début du suivi fiable, mise en service
    select m.created_at, 'PARC'::text,
           case when m.origine = 'EN_EXPLOITATION' then 'Intégration dans AFLP FLEET' else 'Enregistrement de la moto' end,
           concat_ws(' · ', nullif(btrim(concat_ws(' ', m.marque, m.modele)), ''),
                     case when m.date_reception is not null then 'réception le ' || to_char(m.date_reception, 'DD/MM/YYYY') end,
                     case when m.situation_parc is not null then private.moto_lib(m.situation_parc) end),
           null::text, m.compteur_reception_km, null::numeric, null::text, private.moto_nom_profil(m.created_by), 'moto_motos'::text, m.id
    from public.moto_motos m where m.id = p_moto
    union all
    select m.date_debut_utilisation::timestamptz, 'PARC', 'Début d''utilisation (déclaré)', coalesce(m.historique_note, 'Historique antérieur non documenté'),
           null, null, null, null, null, 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.date_debut_utilisation is not null
    union all
    select m.date_debut_suivi::timestamptz, 'PARC', 'Début du suivi fiable', 'Les indicateurs ne remontent pas avant cette date', null, null, null, null, null, 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.date_debut_suivi is not null
    union all
    select m.mise_en_service_at, 'PARC', 'Mise en service (autorisation de circuler)', m.mise_en_service_motif, null, null, null, null,
           private.moto_nom_profil(m.mise_en_service_par), 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.mise_en_service_at is not null
    union all
    -- Affectations
    select a.created_at, 'AFFECTATION',
           case a.type_affectation when 'PREAFFECTATION' then 'Préaffectation' when 'REMISE' then 'Remise officielle' else 'Transfert' end,
           'Bénéficiaire : ' || coalesce(private.moto_nom_profil(a.beneficiaire_id), '—')
             || case when a.permis_id is not null then ' · permis vérifié (' || coalesce(a.permis_categorie, '') || ')' else '' end,
           a.statut, a.compteur_km, null, null, private.moto_nom_profil(a.cree_par), 'moto_affectations', a.id
    from public.moto_affectations a where a.moto_id = p_moto
    union all
    -- Contrôles et inspections (les contrôles avant départ n'apparaissent qu'en cas de défaut)
    select c.date_controle, 'CONTROLE',
           case c.type_controle when 'INSPECTION_INITIALE' then 'Inspection mécanique initiale'
                                when 'INSPECTION_MENSUELLE' then 'Inspection mensuelle (' || private.moto_lib(c.niveau) || ')'
                                when 'ETAT_REMISE' then 'État contradictoire avant remise'
                                when 'REMISE_EN_SERVICE' then 'Contrôle de remise en service'
                                else 'Contrôle avant départ : défaut' end,
           concat_ws(' · ', nullif(c.intervenant_nom, ''), nullif(c.garage_nom, ''), nullif(c.observations, ''), nullif(c.besoins_entretien, '')),
           coalesce(c.conformite, c.resultat), c.compteur_km, null, null, private.moto_nom_profil(c.realise_par), 'moto_controles', c.id
    from public.moto_controles c
    where c.moto_id = p_moto and c.remplace_par is null
      and (c.type_controle <> 'AVANT_DEPART' or c.anomalie_critique or c.resultat = 'INAPTE')
    union all
    -- Anomalies et actions correctives
    select ac.constat_at, 'ANOMALIE', 'Anomalie constatée (' || private.moto_lib(ac.gravite) || ')', ac.anomalie, ac.statut, null, null, null,
           private.moto_nom_profil(ac.signale_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto
    union all
    select ac.realise_at, 'ANOMALIE', 'Correction réalisée', coalesce(ac.action_prevue, ac.anomalie), ac.statut, null, null, null,
           private.moto_nom_profil(ac.realise_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto and ac.realise_at is not null
    union all
    select ac.verifie_at, 'ANOMALIE', 'Correction vérifiée', coalesce(ac.verification_note, ac.anomalie), ac.statut, null, null, null,
           private.moto_nom_profil(ac.verifie_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto and ac.verifie_at is not null
    union all
    -- Maintenance : besoin, travaux réalisés, contrôle, clôture, annulation
    select mt.demande_at, 'MAINTENANCE', 'Besoin d''entretien ou de réparation (' || private.moto_lib(mt.type_maintenance) || ')',
           mt.description, mt.statut, mt.compteur_km, null, null, private.moto_nom_profil(mt.demande_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto
    union all
    select coalesce(mt.date_realisation::timestamptz, mt.termine_at), 'MAINTENANCE', 'Travaux réalisés' || coalesce(' chez ' || g.nom, ''),
           concat_ws(' · ', (select string_agg(t.libelle, ', ' order by t.created_at) from public.moto_maintenance_travaux t
                             where t.maintenance_id = mt.id and t.statut = 'REALISE'),
                     case when mt.pieces_remplacees is not null then 'Pièces : ' || mt.pieces_remplacees end, mt.observations_travaux),
           mt.statut, null, null, null, private.moto_nom_profil(mt.termine_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt left join public.moto_garages g on g.id = mt.garage_id
    where mt.moto_id = p_moto and (mt.date_realisation is not null or mt.termine_at is not null)
    union all
    select mt.controle_at, 'MAINTENANCE', 'Contrôle des travaux', mt.controle_note, mt.controle_resultat, null, null, null,
           private.moto_nom_profil(mt.controle_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.controle_at is not null
    union all
    select mt.cloture_at, 'MAINTENANCE', 'Dossier clôturé', mt.cloture_motif, mt.statut, null, null, null,
           private.moto_nom_profil(mt.cloture_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.cloture_at is not null
    union all
    select mt.annule_at, 'MAINTENANCE', 'Dossier annulé', mt.annule_motif, mt.statut, null, null, null,
           private.moto_nom_profil(mt.annule_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.annule_at is not null
    union all
    -- Décisions du Branch Manager (lecture financière uniquement)
    select au.decide_at, 'AUTORISATION', 'Décision du Branch Manager : ' || private.moto_lib(au.statut), au.perimetre, au.statut, null,
           au.montant_autorise, 'AUTORISE', private.moto_nom_profil(au.decide_par), 'moto_autorisations', au.id
    from public.moto_autorisations au where v_fin and au.moto_id = p_moto and au.decide_at is not null
    union all
    -- Factures et paiements (lecture financière uniquement)
    select f.date_facture::timestamptz, 'FACTURE', 'Facture n° ' || f.numero_facture || coalesce(' · ' || g.nom, ''),
           coalesce(f.motif_verification, ''), f.statut, null, f.montant, 'FACTURE', private.moto_nom_profil(f.depose_par), 'moto_factures', f.id
    from public.moto_factures f left join public.moto_garages g on g.id = f.garage_id
    where v_fin and f.moto_id = p_moto
    union all
    select f.paiement_date::timestamptz, 'FACTURE', 'Paiement constaté · facture n° ' || f.numero_facture, f.paiement_reference, null, null,
           f.montant_paye, 'PAYE', private.moto_nom_profil(f.paiement_par), 'moto_factures', f.id
    from public.moto_factures f where v_fin and f.moto_id = p_moto and f.paiement_date is not null and f.montant_paye > 0
    union all
    -- Pneumatiques
    select po.pose_date::timestamptz, 'PNEU', 'Pneu monté (' || private.moto_lib(po.position) || ')',
           concat_ws(' ', pn.code, pn.marque, pn.dimensions), null, po.pose_km, null, null, private.moto_nom_profil(po.pose_par), 'moto_pneu_poses', po.id
    from public.moto_pneu_poses po left join public.moto_pneus pn on pn.id = po.pneu_id where po.moto_id = p_moto
    union all
    select po.depose_date::timestamptz, 'PNEU', 'Pneu déposé (' || private.moto_lib(po.position) || ')',
           concat_ws(' · ', concat_ws(' ', pn.code, pn.marque), po.motif_depose,
                     case when po.depose_km is not null and po.pose_km is not null then (po.depose_km - po.pose_km)::text || ' km parcourus' end),
           null, po.depose_km, null, null, private.moto_nom_profil(po.depose_par), 'moto_pneu_poses', po.id
    from public.moto_pneu_poses po left join public.moto_pneus pn on pn.id = po.pneu_id where po.moto_id = p_moto and po.depose_date is not null
    union all
    select pr.date_reparation::timestamptz, 'PNEU', 'Réparation de pneu', pr.description, null, pr.compteur_km,
           case when v_fin then pr.cout end, case when v_fin and pr.cout is not null then 'PNEU' end,
           private.moto_nom_profil(pr.saisi_par), 'moto_pneu_reparations', pr.id
    from public.moto_pneu_reparations pr where pr.moto_id = p_moto
    union all
    -- Carburant : synthèse mensuelle (le détail reste dans l'onglet Carburant)
    select max(c.date_achat), 'CARBURANT', 'Carburant · ' || to_char(date_trunc('month', c.date_achat), 'MM/YYYY'),
           count(*)::text || ' achat(s) · ' || replace(trim(to_char(sum(c.litres), 'FM999990.0')), '.', ',') || ' L'
             || case when count(*) filter (where c.justificatif_statut = 'A_VERIFIER') > 0
                     then ' · ' || count(*) filter (where c.justificatif_statut = 'A_VERIFIER') || ' justificatif(s) à vérifier' else '' end,
           null, max(c.compteur_km), sum(c.montant), 'CARBURANT', null, 'moto_carburant', null::uuid
    from public.moto_carburant c where c.moto_id = p_moto
    group by date_trunc('month', c.date_achat)
    union all
    -- Incidents
    select i.declare_at, 'INCIDENT', 'Incident : ' || private.moto_lib(i.type_incident) || ' (' || private.moto_lib(i.gravite) || ')', i.description, i.etape, i.compteur_km,
           null, null, private.moto_nom_profil(i.declare_par), 'moto_incidents', i.id
    from public.moto_incidents i where i.moto_id = p_moto
    union all
    select i.clos_at, 'INCIDENT', 'Incident clos', i.description, i.etape, null, null, null, private.moto_nom_profil(i.clos_par), 'moto_incidents', i.id
    from public.moto_incidents i where i.moto_id = p_moto and i.clos_at is not null
    union all
    -- Immobilisations
    select im.debut, 'IMMOBILISATION', 'Immobilisation', im.motif, case when im.fin is null then 'EN_COURS' else 'LEVEE' end, null, null, null,
           private.moto_nom_profil(im.ouverte_par), 'moto_immobilisations', im.id
    from public.moto_immobilisations im where im.moto_id = p_moto
    union all
    select im.fin, 'IMMOBILISATION', 'Remise en circulation', im.levee_motif, 'LEVEE', null, null, null,
           private.moto_nom_profil(im.levee_par), 'moto_immobilisations', im.id
    from public.moto_immobilisations im where im.moto_id = p_moto and im.fin is not null
    union all
    -- Missions : départ, arrivée, distance (aucune coordonnée)
    select mi.depart_at, 'MISSION',
           'Mission : ' || case mi.objet when 'ACHAT_COLLECTE' then 'achat et collecte' when 'SENSIBILISATION' then 'sensibilisation'
                              when 'RECENSEMENT' then 'recensement' when 'SUPERVISION' then 'supervision' when 'LIVRAISON' then 'livraison'
                              when 'GARAGE' then 'garage' when 'CARBURANT' then 'carburant' when 'ADMINISTRATIF' then 'administratif'
                              else coalesce(mi.objet_detail, 'autre') end || ' · ' || mi.destination,
           case mi.statut
             when 'CLOTUREE' then concat_ws(' · ', 'départ ' || mi.depart_km || ' km', 'arrivée ' || mi.arrivee_km || ' km', (mi.arrivee_km - mi.depart_km) || ' km parcourus')
             when 'ANNULEE' then 'départ ' || mi.depart_km || ' km · annulée : ' || mi.annule_motif
             else 'départ ' || mi.depart_km || ' km · en cours' end,
           mi.statut, coalesce(mi.arrivee_km, mi.depart_km), null, null, private.moto_nom_profil(mi.conducteur_id), 'moto_missions', mi.id
    from public.moto_missions mi where mi.moto_id = p_moto
    union all
    -- Documents de la moto
    select d.depose_at, 'DOCUMENT', 'Document déposé : ' || private.moto_lib(d.type_document),
           concat_ws(' · ', d.numero_reference, case when d.date_expiration is not null then 'expire le ' || to_char(d.date_expiration, 'DD/MM/YYYY') end),
           d.statut, null, null, null, private.moto_nom_profil(d.depose_par), 'moto_documents', d.id
    from public.moto_documents d where d.moto_id = p_moto
  ) e (date_evenement, categorie, evenement, detail, statut, compteur_km, montant, montant_nature, acteur, source, source_id)
  where e.date_evenement is not null
  order by e.date_evenement desc, e.categorie;
end $$;


-- ---------------------------------------------------------------------
-- 11. Corrections issues de la contre-expertise
--     moto_num : texte de la migration 2, refus de NaN et de l'infini ;
--     moto_correction_decider : texte de la migration 2, verrou moto d'abord, conducteur exclu ;
--     photos de mission lisibles seulement par qui peut lire la mission.
-- ---------------------------------------------------------------------
create or replace function private.moto_num(p jsonb, k text)
returns numeric language plpgsql immutable
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v numeric;
begin
  if nullif(btrim(coalesce(p ->> k, '')), '') is null then return null; end if;
  v := (replace(btrim(p ->> k), ',', '.'))::numeric;
  -- « NaN » et l'infini sont des nombres pour PostgreSQL : un compteur « NaN » bloquerait la moto.
  if v = 'NaN'::numeric or v > 1e12 or v < -1e12 then raise exception 'non fini'; end if;
  return v;
exception when others then
  raise exception 'Valeur numérique invalide pour « % ».', k using errcode = 'P0001';
end $$;


create or replace function public.moto_correction_decider(p_correction uuid, p_decision text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare c public.moto_corrections; v_classe text; v_type text; v_actuel text; v_moto uuid;
begin
  v_classe := private.moto_exiger_classe(array['BM','DIRECTION','FINANCE']);
  if v_classe = 'FINANCE' and not private.moto_est_finance_manager() then perform private.moto_refus('Validation réservée au Branch Manager, au General Manager ou au Finance Manager.'); end if;
  select * into c from public.moto_corrections where id = p_correction for update;
  if not found or c.statut <> 'DEMANDEE' then perform private.moto_erreur('Correction introuvable ou déjà décidée.'); end if;
  if c.demande_par = auth.uid() then perform private.moto_refus('Auto-approbation interdite : un autre responsable doit valider.'); end if;
  if upper(p_decision) not in ('APPLIQUEE','REJETEE') then perform private.moto_erreur('Décision inconnue.'); end if;
  perform private.moto_motif(coalesce(nullif(btrim(p_motif), ''), c.motif), case when upper(p_decision) = 'REJETEE' then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  if upper(p_decision) = 'APPLIQUEE' then
    -- Migration 8 : même ordre de verrous que les missions (moto d'abord) ; le conducteur ne valide
    -- pas la correction de son propre relevé.
    execute format('select moto_id from public.%I where id = $1', c.cible_table) into v_moto using c.cible_id;
    if v_moto is not null then perform private.moto_charger(v_moto, true); end if;
    if c.cible_table = 'moto_releves_km' and exists (
         select 1 from public.moto_releves_km r where r.id = c.cible_id
           and (r.saisi_par = auth.uid() or exists (select 1 from public.moto_missions m where (m.depart_releve_id = r.id or m.arrivee_releve_id = r.id) and m.conducteur_id = auth.uid()))) then
      perform private.moto_refus('Quatre yeux : vous ne validez pas la correction de votre propre relevé.');
    end if;
    v_type := private.moto_champ_corrigeable(c.cible_table, c.champ, 'BM');
    execute format('select %I::text, moto_id from public.%I where id = $1 for update', c.champ, c.cible_table) into v_actuel, v_moto using c.cible_id;
    if v_actuel is distinct from c.ancienne_valeur then
      perform private.moto_erreur('CONFLIT : la valeur a changé depuis la demande. Créez une nouvelle demande.');
    end if;
    execute format('update public.%I set %I = $1::%s where id = $2', c.cible_table, c.champ, v_type) using c.nouvelle_valeur, c.cible_id;
    if c.cible_table = 'moto_releves_km' or (c.cible_table = 'moto_carburant' and c.champ = 'compteur_km') then
      update public.moto_motos set compteur_actuel_km = (select max(compteur_km) from public.moto_releves_km where moto_id = v_moto)
      where id = v_moto;
    end if;
  end if;
  update public.moto_corrections set statut = upper(p_decision), valide_par = auth.uid(), valide_at = now(),
         decision_motif = nullif(btrim(p_motif), '') where id = p_correction;
  return jsonb_build_object('id', p_correction, 'statut', upper(p_decision));
end $$;


alter policy moto_documents_consultation on storage.objects
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1]))
               and (coalesce((storage.foldername(name))[2], '') <> 'mission' or private.moto_mission_photo_lecture(name)))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))
              or ((storage.foldername(name))[1] = 'finmaint' and private.moto_lecture_fin_maintenance())
              or ((storage.foldername(name))[1] = 'permis'
                  and private.moto_lecture_permis(private.moto_uuid_ou_null((storage.foldername(name))[2])))));



do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_classe_de','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_lecture_enveloppe','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param','moto_fenetre','moto_lecture_fin_maintenance','moto_lecture_permis',
        'moto_mission_lecture','moto_mission_lecture_id','moto_mission_lecture_position','moto_mission_photo_lecture') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
