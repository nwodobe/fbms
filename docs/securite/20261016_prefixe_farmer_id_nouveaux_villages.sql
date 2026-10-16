-- =============================================================================
-- FBMS · Préfixe Farmer ID automatique pour les NOUVEAUX villages
-- Date : 2026-10-16 · Statut : PRÉPARÉ ET TESTÉ EN LOCAL, NON APPLIQUÉ EN PRODUCTION
--
-- Constat : public.farmer_registry_set_code() exige villages.farmer_code_prefix.
-- Ce préfixe n'a été attribué qu'une fois, par 20260818_farmer_registry_phase1_consolidated.sql.
-- Tout village créé depuis (par n'importe quel rôle) n'en reçoit pas : l'enrôlement d'un
-- producteur y échoue avec « Préfixe Farmer ID absent pour le village sélectionné ».
--
-- Règle : IDENTIQUE à la migration du 18/08 — 4 premiers caractères normalisés du nom
-- (complétés par X), suffixe 02, 03… en cas de collision. Le Farmer ID étant immuable,
-- cette règle de nommage est une décision métier : validation humaine requise avant
-- application. N'agit qu'à l'INSERT et seulement si le préfixe est vide.
-- =============================================================================
create or replace function private.village_attribuer_prefixe_farmer_id()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $$
declare
  v_base text;
  v_candidat text;
  i int := 1;
begin
  if nullif(btrim(coalesce(new.farmer_code_prefix, '')), '') is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('fbms.villages.farmer_code_prefix'));
  v_base := left(public.farmer_registry_norm_text(coalesce(new.village, new.data -> 's1' ->> 'village', new.id)) || 'XXXX', 4);
  v_candidat := v_base;
  while exists (select 1 from public.villages v where v.farmer_code_prefix = v_candidat) loop
    i := i + 1;
    if i > 99 then
      raise exception 'Préfixe Farmer ID : plus de 99 villages commencent par %.', v_base;
    end if;
    v_candidat := v_base || lpad(i::text, 2, '0');
  end loop;
  new.farmer_code_prefix := v_candidat;
  return new;
end
$$;
revoke all on function private.village_attribuer_prefixe_farmer_id() from public;

drop trigger if exists trg_farmer_registry_village_code_prefix on public.villages;
create trigger trg_farmer_registry_village_code_prefix
  before insert on public.villages
  for each row execute function private.village_attribuer_prefixe_farmer_id();

-- RETOUR ARRIÈRE :
--   drop trigger if exists trg_farmer_registry_village_code_prefix on public.villages;
--   drop function if exists private.village_attribuer_prefixe_farmer_id();
