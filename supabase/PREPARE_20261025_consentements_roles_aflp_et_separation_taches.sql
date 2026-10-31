-- =============================================================================
-- PRÉPARÉ, NON APPLIQUÉ · version finale v2 (25/10/2026) pour relecture technique
-- Principe validé par le Branch Manager le 25/10/2026 ; APPLICATION EN PRODUCTION
-- NON AUTORISÉE à ce stade. Ne pas exécuter sans autorisation écrite.
--
-- Tests : tests/sql/regularisation_aflp/03_droits_matrice_roles.sql
--   (21 cas autorisés / interdits, 5 rôles réels, exécutés en transaction annulée)
-- Retour arrière : section R en fin de fichier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- P0-1 · Enregistrement des consentements par les rôles terrain AFLP
-- -----------------------------------------------------------------------------
-- Constat : farmer_consents_insert exige public.peut_editer_terrain(), qui exclut
-- 'Unit Head', 'Zonal Head' et 'Assistant Unit Head'. Or ce sont ces comptes qui
-- ont réalisé 100 % des enrôlements hors ligne d'octobre 2026.
-- Correctif : aligner sur private.farmer_registry_can_capture(), déjà utilisée
-- pour parcelles, baselines et inspections (profil ACTIF obligatoire).
-- Conservé : périmètre (farmer_registry_can_access_producteur), imputation
-- (created_by = agent_id = auth.uid()), contrôles du trigger
-- farmer_registry_prepare_consent (date non future, version de texte, périmètres
-- cohérents avec GRANTED / PARTIAL).
-- Non modifié : peut_editer_terrain() (utilisée par d'autres tables).
-- Inchangé : aucune politique UPDATE ni DELETE sur farmer_consents (registre
-- immuable ; une nouvelle décision crée une nouvelle ligne).
begin;

alter policy farmer_consents_insert on public.farmer_consents
  with check (
    private.farmer_registry_can_capture()
    and created_by = auth.uid()
    and agent_id = auth.uid()
    and private.farmer_registry_can_access_producteur(producteur_id)
  );

-- -----------------------------------------------------------------------------
-- P1-1 · Séparation des tâches sur la vérification du Farmer Passport
-- -----------------------------------------------------------------------------
-- Constat : un superviseur peut enrôler, saisir, finaliser puis APPROUVER le
-- passeport (test : stage VERIFIED par son propre auteur).
-- Règle : une vérification APPROVED est refusée si le vérificateur a créé le
-- producteur, recueilli un consentement, saisi ou relevé une parcelle active,
-- saisi ou finalisé une baseline FINAL ou une inspection FINAL de ce producteur.
-- Une décision REJECTED ou REVOKED par l'auteur reste possible (elle ne valide rien).
-- Circuit de secours vérifié : Zonal Head (portée terrain globale par rôle) et
-- Branch Manager peuvent vérifier tout dossier qu'ils n'ont pas saisi.
create or replace function private.farmer_verification_separation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Opérations d'administration (service_role, migrations) : pas d'utilisateur, pas de contrôle.
  if v_uid is null or new.status is distinct from 'APPROVED' then
    return new;
  end if;
  if exists (select 1 from public.producteurs p
             where p.id = new.producteur_id and p.created_by_user_id = v_uid)
  or exists (select 1 from public.farmer_consents c
             where c.producteur_id = new.producteur_id and v_uid in (c.agent_id, c.created_by))
  or exists (select 1 from public.farmer_plots fp
             where fp.producteur_id = new.producteur_id and not fp.deleted and fp.status = 'ACTIVE'
               and v_uid in (fp.created_by, fp.gps_captured_by))
  or exists (select 1 from public.farmer_production_baselines b
             where b.producteur_id = new.producteur_id and b.status = 'FINAL'
               and v_uid in (b.captured_by, b.finalized_by, b.created_by))
  or exists (select 1 from public.farmer_sustainability_baselines b
             where b.producteur_id = new.producteur_id and b.status = 'FINAL'
               and v_uid in (b.captured_by, b.finalized_by, b.created_by))
  or exists (select 1 from public.farmer_inspections i
             where i.producteur_id = new.producteur_id and i.status = 'FINAL'
               and v_uid in (i.inspector_id, i.finalized_by, i.created_by))
  then
    raise exception 'Séparation des tâches : vous avez saisi ou finalisé une partie de ce dossier. La vérification doit être faite par un autre superviseur (Chef de Zone ou Branch Manager).'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.farmer_verification_separation_guard() from public, anon, authenticated;

drop trigger if exists trg_farmer_verification_separation on public.farmer_verifications;
create trigger trg_farmer_verification_separation
  before insert or update on public.farmer_verifications
  for each row execute function private.farmer_verification_separation_guard();

comment on function private.farmer_verification_separation_guard() is
  'AFLP 2027 : refuse une vérification APPROVED par un utilisateur ayant saisi une partie du dossier (séparation des tâches).';

commit;

-- -----------------------------------------------------------------------------
-- V · Contrôles après application (lecture seule)
-- -----------------------------------------------------------------------------
-- select with_check from pg_policies where policyname = 'farmer_consents_insert';
--   attendu : contient farmer_registry_can_capture()
-- select tgname, tgenabled from pg_trigger where tgname = 'trg_farmer_verification_separation';
--   attendu : 1 ligne, tgenabled = 'O'
-- select has_function_privilege('authenticated','private.farmer_verification_separation_guard()','execute');
--   attendu : false

-- -----------------------------------------------------------------------------
-- R · Retour arrière (exact état antérieur, vérifié le 25/10/2026)
-- -----------------------------------------------------------------------------
-- begin;
-- alter policy farmer_consents_insert on public.farmer_consents
--   with check (peut_editer_terrain() and created_by = auth.uid() and agent_id = auth.uid()
--               and private.farmer_registry_can_access_producteur(producteur_id));
-- drop trigger if exists trg_farmer_verification_separation on public.farmer_verifications;
-- drop function if exists private.farmer_verification_separation_guard();
-- commit;
-- Le retour arrière ne supprime aucune donnée : les consentements et vérifications
-- enregistrés entre-temps restent en base (registres immuables).
