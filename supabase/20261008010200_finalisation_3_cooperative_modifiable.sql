-- Finalisation campagne 2027 · 3/3 — coopérative modifiable en sécurité.
--
-- Besoin (Branch Manager) : créer, consulter, MODIFIER, compléter, corriger, archiver une coopérative et sa structure
-- (villages, sections, points de collecte, responsables, affiliations) sans appeler le développeur.
-- Les écritures passent par la RLS existante (aflp_coop_can_edit) et sont journalisées par trg_aflp_audit
-- (avant / après, auteur, date). Cette migration ajoute les garde-fous qui manquaient :
--   1. code coopérative (COOP-NNN) immuable : plus aucune modification possible par l'API ;
--   2. verrou optimiste : une écriture qui porte une row_version périmée est refusée avec un message clair ;
--   3. responsables : dates de début et de fin de fonction ;
--   4. affiliation : la section doit appartenir à la coopérative, le RT de suivi doit être actif.
-- Aucune donnée existante n'est modifiée. Aucune suppression physique n'est ouverte (pas de politique DELETE).

-- 1 + 2. Code immuable et verrou optimiste
create or replace function private.aflp_coop_verrou_modification() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.code is distinct from old.code then
    raise exception 'Le code coopérative % ne se modifie pas : il est référencé par les producteurs, achats, livraisons, LOT et rapports.', old.code
      using errcode = '42501';
  end if;
  if new.row_version is distinct from old.row_version then
    raise exception 'Cette fiche a été modifiée par un autre utilisateur. Rechargez les données avant d''enregistrer.'
      using errcode = '40001';
  end if;
  return new;
end $$;
-- Nom choisi pour s'exécuter AVANT trg_aflp_touch (qui incrémente row_version).
create or replace trigger trg_aflp_coop_verrou before update on public.aflp_cooperatives
  for each row execute function private.aflp_coop_verrou_modification();

-- 3. Responsables : période de fonction
alter table public.aflp_coop_contacts add column if not exists start_date date;
alter table public.aflp_coop_contacts add column if not exists end_date date;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'aflp_coop_contacts_periode_chk') then
    alter table public.aflp_coop_contacts add constraint aflp_coop_contacts_periode_chk
      check (end_date is null or start_date is null or end_date >= start_date);
  end if;
end $c$;

-- 4. Affiliation cohérente
create or replace function private.aflp_mbr_coherence() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.section_id is not null and (tg_op = 'INSERT' or new.section_id is distinct from old.section_id) then
    if not exists (select 1 from public.aflp_coop_sections s where s.id = new.section_id and s.cooperative_id = new.cooperative_id) then
      raise exception 'Cette section n''appartient pas à la coopérative du membre.' using errcode = '23514';
    end if;
  end if;
  if new.followup_rt_id is not null and (tg_op = 'INSERT' or new.followup_rt_id is distinct from old.followup_rt_id) then
    if not exists (select 1 from public.rt r where r.id = new.followup_rt_id and not coalesce(r.deleted, false)) then
      raise exception 'Le RT de suivi choisi est inactif ou introuvable.' using errcode = '23514';
    end if;
  end if;
  if new.member_number is not null then new.member_number := nullif(upper(btrim(new.member_number)), ''); end if;
  return new;
end $$;
create or replace trigger trg_aflp_mbr_coherence before insert or update on public.aflp_coop_memberships
  for each row execute function private.aflp_mbr_coherence();

revoke execute on function private.aflp_coop_verrou_modification() from public, anon, authenticated;
revoke execute on function private.aflp_mbr_coherence() from public, anon, authenticated;
