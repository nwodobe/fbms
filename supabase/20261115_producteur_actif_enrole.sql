-- Decision du Branch Manager du 15/11/2026 : tout producteur actif est Enrole.
-- La regle est portee par la base, quel que soit le chemin d'ecriture (formulaire web, APK hors ligne,
-- offline_sync_batch, enrolement cooperative) : un telephone resynchronise ne peut plus remettre « Identifie ».
alter table public.producteurs alter column statut set default 'Enrôlé';

create or replace function private.fbms_producteur_actif_enrole()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not coalesce(new.deleted, false) and coalesce(new.operational_status, 'ACTIVE') = 'ACTIVE' then
    new.statut := 'Enrôlé';
    if new.data is null or jsonb_typeof(new.data) = 'object' then
      new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{statut}', '"Enrôlé"'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_farmer_registry_statut_enrole on public.producteurs;
create trigger trg_farmer_registry_statut_enrole
  before insert or update on public.producteurs
  for each row execute function private.fbms_producteur_actif_enrole();

comment on function private.fbms_producteur_actif_enrole() is
  'Decision du 15/11/2026 : producteur non supprime et ACTIVE => statut Enrôlé (colonne et data.statut).';
