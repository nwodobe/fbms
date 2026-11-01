-- =====================================================================
-- AFLP FLEET — migration 9 : supports de formation (PDF) en stockage privé
--
-- Demande du Branch Manager (1er novembre 2026) : joindre à chacun des
-- quatre modules de l'espace Formation sa présentation, au format PDF,
-- dans un stockage PRIVÉ (le dépôt GitHub de l'application est public).
--
--  · espace de stockage « moto-formation » : privé, PDF uniquement, 20 Mo ;
--  · lecture : tout compte AFLP FLEET connecté (rôle reconnu) ;
--  · dépôt : Branch Manager ou Assistant Branch Manager uniquement ;
--  · un support déposé ne se modifie ni ne se supprime : un remplacement
--    est un nouveau dépôt, le plus récent est affiché, l'historique reste.
--
-- Additive, rejouable, aucune donnée réelle créée ou modifiée.
-- Retour arrière : 20261105090100_aflp_fleet_9_rollback.sql.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Espace de stockage privé
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('moto-formation', 'moto-formation', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 2. Registre des supports (historique conservé)
-- ---------------------------------------------------------------------
create table if not exists public.moto_formation_supports (
  id uuid primary key default gen_random_uuid(),
  module_code text not null
    check (module_code in ('CONTROLE_SECURITE','CARBURANT_JUSTIFICATIFS','ENTRETIEN_PREVENTIF','INCIDENTS')),
  chemin text not null unique,
  nom_fichier text not null check (length(btrim(nom_fichier)) between 3 and 200),
  taille_octets bigint not null check (taille_octets > 0),
  depose_par uuid not null default auth.uid(),
  depose_at timestamptz not null default clock_timestamp()   -- heure réelle : deux versions ne sont jamais ex aequo
);
create index if not exists moto_formation_supports_module_idx on public.moto_formation_supports (module_code, depose_at desc);

alter table public.moto_formation_supports enable row level security;
drop policy if exists moto_formation_supports_lecture on public.moto_formation_supports;
create policy moto_formation_supports_lecture on public.moto_formation_supports for select to authenticated
  using (private.moto_classe() is not null);
revoke all on public.moto_formation_supports from anon, authenticated;
grant select on public.moto_formation_supports to authenticated;

-- Immuable : aucune modification ni suppression, même par un rôle privilégié de l'application.
create or replace function private.moto_formation_support_immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'Un support de formation déposé ne se modifie pas : déposez une nouvelle version.' using errcode = '42501';
end $$;
drop trigger if exists moto_formation_supports_immuable_trg on public.moto_formation_supports;
create trigger moto_formation_supports_immuable_trg before update or delete on public.moto_formation_supports
  for each row execute function private.moto_formation_support_immuable();

-- Dernière version par module (lecture par l'application).
create or replace view public.moto_v_formation_supports with (security_invoker = on) as
select distinct on (module_code) module_code, id, chemin, nom_fichier, taille_octets, depose_at
from public.moto_formation_supports
order by module_code, depose_at desc;
grant select on public.moto_v_formation_supports to authenticated;

-- ---------------------------------------------------------------------
-- 3. Stockage : dépôt BM / ABM, lecture comptes AFLP FLEET
--    Chemin imposé : <MODULE_CODE>/<uuid>.pdf
-- ---------------------------------------------------------------------
create or replace function private.moto_formation_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if private.moto_classe() not in ('BM','ABM') then return false; end if;
  return p_nom ~ '^(CONTROLE_SECURITE|CARBURANT_JUSTIFICATIFS|ENTRETIEN_PREVENTIF|INCIDENTS)/[0-9a-f-]{36}\.pdf$';
end $$;
revoke all on function private.moto_formation_peut_deposer(text) from public, anon;
grant execute on function private.moto_formation_peut_deposer(text) to authenticated;

drop policy if exists moto_formation_depot on storage.objects;
create policy moto_formation_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'moto-formation' and private.moto_formation_peut_deposer(name));
drop policy if exists moto_formation_consultation on storage.objects;
create policy moto_formation_consultation on storage.objects for select to authenticated
  using (bucket_id = 'moto-formation' and private.moto_classe() is not null);

-- ---------------------------------------------------------------------
-- 4. Enregistrement d'un support déposé
-- ---------------------------------------------------------------------
create or replace function public.moto_formation_support_enregistrer(p_module text, p_chemin text, p_nom_fichier text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare o record; v_module text := upper(btrim(coalesce(p_module, ''))); v_id uuid;
begin
  if private.moto_classe() not in ('BM','ABM') then
    raise exception 'Seuls le Branch Manager et l''Assistant Branch Manager déposent les supports de formation.' using errcode = '42501';
  end if;
  if v_module not in ('CONTROLE_SECURITE','CARBURANT_JUSTIFICATIFS','ENTRETIEN_PREVENTIF','INCIDENTS') then
    raise exception 'Module de formation inconnu.' using errcode = 'P0001';
  end if;
  if p_chemin is null or split_part(p_chemin, '/', 1) <> v_module then
    raise exception 'Le fichier doit être déposé dans le dossier de son module.' using errcode = 'P0001';
  end if;
  select s.name, s.metadata into o from storage.objects s where s.bucket_id = 'moto-formation' and s.name = p_chemin;
  if not found then raise exception 'Fichier introuvable dans le stockage privé : déposez-le avant d''enregistrer.' using errcode = 'P0001'; end if;
  if coalesce(o.metadata ->> 'mimetype', '') <> 'application/pdf' then
    raise exception 'Seul un PDF est accepté.' using errcode = 'P0001';
  end if;
  if coalesce((o.metadata ->> 'size')::bigint, 0) <= 0 or (o.metadata ->> 'size')::bigint > 20971520 then
    raise exception 'Fichier vide ou trop lourd (20 Mo maximum).' using errcode = 'P0001';
  end if;
  insert into public.moto_formation_supports (module_code, chemin, nom_fichier, taille_octets)
  values (v_module, p_chemin, left(btrim(coalesce(nullif(p_nom_fichier, ''), 'support.pdf')), 200), (o.metadata ->> 'size')::bigint)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'module_code', v_module, 'chemin', p_chemin);
exception when unique_violation then
  raise exception 'Ce fichier est déjà enregistré.' using errcode = 'P0001';
end $$;
revoke all on function public.moto_formation_support_enregistrer(text, text, text) from public, anon;
grant execute on function public.moto_formation_support_enregistrer(text, text, text) to authenticated;

commit;
