-- =====================================================================
-- AFLP FLEET — retour arrière de la migration 9 (supports de formation)
-- Refusé tant qu'un support est enregistré ou qu'un fichier est stocké :
-- on ne supprime jamais un support déposé par ce script. Rejouable.
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.moto_formation_supports') is not null
     and exists (select 1 from public.moto_formation_supports) then
    raise exception 'Retour arrière refusé : des supports de formation sont enregistrés.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'moto-formation') then
    raise exception 'Retour arrière refusé : des fichiers sont présents dans le stockage moto-formation.';
  end if;
end $$;

drop function if exists public.moto_formation_support_enregistrer(text, text, text);
drop policy if exists moto_formation_depot on storage.objects;
drop policy if exists moto_formation_consultation on storage.objects;
drop function if exists private.moto_formation_peut_deposer(text);
drop view if exists public.moto_v_formation_supports;
drop table if exists public.moto_formation_supports;
drop function if exists private.moto_formation_support_immuable();
delete from storage.buckets where id = 'moto-formation';
commit;
