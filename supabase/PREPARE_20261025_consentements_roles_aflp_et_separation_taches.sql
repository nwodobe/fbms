-- =============================================================================
-- PRÉPARÉ, NON APPLIQUÉ · modification sensible des droits d'accès
-- Autorisation spécifique du Branch Manager requise avant application.
-- Testé le 25/10/2026 dans une transaction annulée (voir rapport, tests C-E2E-2 et C-SEP).
-- =============================================================================

-- P0-1 · Les rôles terrain AFLP ne peuvent pas enregistrer un consentement.
-- Constat : la politique farmer_consents_insert exige public.peut_editer_terrain(),
-- qui exclut 'Unit Head', 'Zonal Head' et 'Assistant Unit Head' : exactement les
-- comptes qui ont réalisé 100 % des 166 enrôlements hors ligne d'octobre 2026.
-- Correctif : aligner la politique sur private.farmer_registry_can_capture(),
-- déjà utilisée pour les parcelles, baselines et inspections. Le périmètre
-- (farmer_registry_can_access_producteur) et l'imputation (created_by / agent_id
-- = auth.uid()) sont conservés. peut_editer_terrain() n'est PAS modifiée (elle sert ailleurs).
begin;
alter policy farmer_consents_insert on public.farmer_consents
  with check (
    private.farmer_registry_can_capture()
    and created_by = auth.uid()
    and agent_id = auth.uid()
    and private.farmer_registry_can_access_producteur(producteur_id)
  );
commit;
-- Retour arrière P0-1 :
-- alter policy farmer_consents_insert on public.farmer_consents
--   with check (peut_editer_terrain() and created_by = auth.uid() and agent_id = auth.uid()
--               and private.farmer_registry_can_access_producteur(producteur_id));


-- P1-1 · Séparation des tâches sur la vérification du Farmer Passport.
-- Constat (test C-SEP) : un Unit Head peut enrôler, saisir les baselines,
-- finaliser, puis APPROUVER lui-même le passeport (stage VERIFIED).
-- Correctif : refuser une vérification APPROVED par l'auteur de l'enrôlement
-- ou d'une baseline / inspection finalisée du même producteur.
begin;
create or replace function private.farmer_verification_separation_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid := auth.uid();
begin
  if new.status <> 'APPROVED' or v_uid is null then return new; end if;
  if exists (select 1 from public.producteurs p where p.id = new.producteur_id and p.created_by_user_id = v_uid)
     or exists (select 1 from public.farmer_sustainability_baselines b where b.producteur_id = new.producteur_id and b.status = 'FINAL' and v_uid in (b.captured_by, b.finalized_by, b.created_by))
     or exists (select 1 from public.farmer_production_baselines b where b.producteur_id = new.producteur_id and b.status = 'FINAL' and v_uid in (b.captured_by, b.finalized_by, b.created_by))
     or exists (select 1 from public.farmer_inspections i where i.producteur_id = new.producteur_id and i.status = 'FINAL' and v_uid in (i.inspector_id, i.finalized_by, i.created_by))
  then
    raise exception 'Séparation des tâches : vous avez saisi ou finalisé ce dossier ; la vérification doit être faite par un autre superviseur.';
  end if;
  return new;
end $$;
revoke all on function private.farmer_verification_separation_guard() from public, anon, authenticated;
drop trigger if exists trg_farmer_verification_separation on public.farmer_verifications;
create trigger trg_farmer_verification_separation before insert on public.farmer_verifications
  for each row execute function private.farmer_verification_separation_guard();
commit;
-- Retour arrière P1-1 :
-- drop trigger if exists trg_farmer_verification_separation on public.farmer_verifications;
-- drop function if exists private.farmer_verification_separation_guard();
