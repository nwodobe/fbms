-- AFLP / FBMS — suivi des mises à jour des téléphones (tableau du Branch Manager).
-- ============================================================================================
-- STATUT : PROPOSÉE, NON APPLIQUÉE. À relire par un humain (label human-review) et à appliquer
-- uniquement sur autorisation explicite du Branch Manager. Rien dans l'application ne dépend de
-- cette migration pour fonctionner : sans elle, le signalement s'arrête sans bruit et l'écran
-- « Mises à jour des téléphones » affiche « Suivi non activé ».
--
-- Ce que fait cette migration (purement additive) :
--   * une table public.app_installations : UNE ligne par installation de l'APK, tenue à jour par
--     le téléphone lui-même via la RPC public.ota_installation_signaler ;
--   * aucune écriture directe possible depuis un client (ni insert, ni update, ni delete) ;
--   * lecture réservée au Branch Manager et à son assistant (RLS) ;
--   * une vue public.ota_installations_v (security_invoker) pour l'écran de suivi.
-- Ce qu'elle ne fait pas : elle ne modifie aucune table existante, aucune politique existante,
-- aucune donnée producteur, parcelle ou consentement.
--
-- Données collectées, au strict nécessaire :
--   * identifiant d'installation = UUID tiré au hasard par l'application (ni IMEI, ni numéro de
--     série, ni identifiant Android, ni identifiant publicitaire) ;
--   * versions (APK, Web active, dernière version vue), dates de vérification et d'activation,
--     dernière erreur du mécanisme de mise à jour, nombre d'opérations locales en attente ;
--   * compte, rôle et cluster RELUS dans public.profils (jamais crus sur la parole du téléphone).
--   Aucune position, aucun modèle d'appareil, aucun numéro de téléphone, aucune donnée métier.
-- Retour arrière : 20261122090100_ota_suivi_installations_rollback.sql
-- ============================================================================================

create table if not exists public.app_installations (
  installation_id      uuid primary key,
  app_id               text not null,
  user_id              uuid not null,
  compte_nom           text,
  role                 text,
  cluster              text,
  zone                 text,
  native_version_name  text,
  native_version_code  integer,
  android_release      text,
  updates_enabled      boolean,
  channel              text,
  web_active_sequence  bigint,
  web_active_version   text,
  web_active_origin    text,
  ota_latest_sequence  bigint,
  ota_latest_version   text,
  ota_pending_sequence bigint,
  deferred_reason      text,
  phase                text,
  last_check_at        timestamptz,
  last_activation_at   timestamptz,
  last_error           text,
  queue_open           integer,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  signalements         integer not null default 1,
  constraint app_installations_origin_chk check (web_active_origin is null or web_active_origin in ('OTA', 'APK')),
  constraint app_installations_app_chk check (app_id = 'ci.anagroci.fieldbuying')
);
comment on table public.app_installations is
  'Une ligne par installation de l''APK FBMS, écrite uniquement par public.ota_installation_signaler. Identifiant aléatoire, sans lien avec le matériel.';
create index if not exists app_installations_last_seen_idx on public.app_installations (last_seen_at desc);

alter table public.app_installations enable row level security;
revoke all on public.app_installations from anon, authenticated;
grant select on public.app_installations to authenticated;

drop policy if exists app_installations_select_pilotage on public.app_installations;
create policy app_installations_select_pilotage on public.app_installations
  for select to authenticated
  using (public.est_actif()
         and public.mon_role() in ('Branch Manager', 'Branch Manager / Head of Programme', 'Assistant Branch Manager'));
-- Aucune politique insert / update / delete : toute écriture passe par la RPC ci-dessous.

create or replace function public.ota_installation_signaler(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_profil record;
  v_maintenant timestamptz := now();
  v_check timestamptz; v_activation timestamptz;
begin
  if auth.uid() is null then raise exception 'Accès refusé.' using errcode = '42501'; end if;
  select pr.nom, pr.role, pr.cluster, pr.zone into v_profil
    from public.profils pr where pr.user_id = auth.uid() and pr.actif = true limit 1;
  if not found then raise exception 'Compte inactif ou inconnu.' using errcode = '42501'; end if;
  begin v_id := (p->>'installation_id')::uuid; exception when others then v_id := null; end;
  if v_id is null then raise exception 'Identifiant d''installation illisible.' using errcode = '22023'; end if;
  if coalesce(p->>'app_id', '') <> 'ci.anagroci.fieldbuying' then
    raise exception 'Application non suivie.' using errcode = '22023'; end if;
  -- Dates du téléphone : gardées seulement si lisibles et pas dans le futur (horloge déréglée).
  begin v_check := nullif(p->>'last_check_at', '')::timestamptz; exception when others then v_check := null; end;
  begin v_activation := nullif(p->>'last_activation_at', '')::timestamptz; exception when others then v_activation := null; end;
  if v_check > v_maintenant + interval '10 minutes' then v_check := null; end if;
  if v_activation > v_maintenant + interval '10 minutes' then v_activation := null; end if;

  insert into public.app_installations as t (
    installation_id, app_id, user_id, compte_nom, role, cluster, zone,
    native_version_name, native_version_code, android_release, updates_enabled, channel,
    web_active_sequence, web_active_version, web_active_origin,
    ota_latest_sequence, ota_latest_version, ota_pending_sequence, deferred_reason,
    phase, last_check_at, last_activation_at, last_error, queue_open, first_seen_at, last_seen_at, signalements)
  values (
    v_id, 'ci.anagroci.fieldbuying', auth.uid(), left(v_profil.nom, 120), v_profil.role, v_profil.cluster, v_profil.zone,
    left(p->>'native_version_name', 40),
    case when (p->>'native_version_code') ~ '^\d{1,9}$' then (p->>'native_version_code')::integer end,
    left(p->>'android_release', 20),
    case when p->>'updates_enabled' in ('true', 'false') then (p->>'updates_enabled')::boolean end,
    left(p->>'channel', 40),
    case when (p->>'web_active_sequence') ~ '^\d{1,15}$' then (p->>'web_active_sequence')::bigint end,
    left(p->>'web_active_version', 60),
    case when p->>'web_active_origin' in ('OTA', 'APK') then p->>'web_active_origin' end,
    case when (p->>'ota_latest_sequence') ~ '^\d{1,15}$' then (p->>'ota_latest_sequence')::bigint end,
    left(p->>'ota_latest_version', 60),
    case when (p->>'ota_pending_sequence') ~ '^\d{1,15}$' then (p->>'ota_pending_sequence')::bigint end,
    left(p->>'deferred_reason', 300),
    left(p->>'phase', 30), v_check, v_activation, left(p->>'last_error', 300),
    case when (p->>'queue_open') ~ '^\d{1,7}$' then (p->>'queue_open')::integer end,
    v_maintenant, v_maintenant, 1)
  on conflict (installation_id) do update set
    user_id = excluded.user_id, compte_nom = excluded.compte_nom, role = excluded.role,
    cluster = excluded.cluster, zone = excluded.zone,
    native_version_name = excluded.native_version_name, native_version_code = excluded.native_version_code,
    android_release = excluded.android_release, updates_enabled = excluded.updates_enabled, channel = excluded.channel,
    web_active_sequence = excluded.web_active_sequence, web_active_version = excluded.web_active_version,
    web_active_origin = excluded.web_active_origin,
    ota_latest_sequence = excluded.ota_latest_sequence, ota_latest_version = excluded.ota_latest_version,
    ota_pending_sequence = excluded.ota_pending_sequence, deferred_reason = excluded.deferred_reason,
    phase = excluded.phase, last_check_at = excluded.last_check_at,
    -- une activation déjà constatée n'est jamais effacée par un signalement qui ne la mentionne plus
    last_activation_at = coalesce(excluded.last_activation_at, t.last_activation_at),
    last_error = excluded.last_error, queue_open = excluded.queue_open,
    last_seen_at = v_maintenant, signalements = t.signalements + 1;
  return jsonb_build_object('statut', 'RECU', 'recu_serveur_le', v_maintenant);
end $$;
revoke all on function public.ota_installation_signaler(jsonb) from public, anon;
grant execute on function public.ota_installation_signaler(jsonb) to authenticated;

create or replace view public.ota_installations_v with (security_invoker = true) as
  select installation_id, compte_nom, role, cluster, zone, native_version_name, native_version_code, android_release,
         updates_enabled, channel, web_active_sequence, web_active_version, web_active_origin,
         ota_latest_sequence, ota_latest_version, ota_pending_sequence, deferred_reason, phase,
         last_check_at, last_activation_at, last_error, queue_open, first_seen_at, last_seen_at, signalements
    from public.app_installations;
revoke all on public.ota_installations_v from anon;
grant select on public.ota_installations_v to authenticated;
