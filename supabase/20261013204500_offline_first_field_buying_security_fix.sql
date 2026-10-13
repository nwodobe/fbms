-- Offline First FIELD BUYING — durcissement search_path du helper privé.
-- Cette fonction ne lit aucune table ; pg_catalog suffit et évite un search_path mutable.

create or replace function private.offline_result_status(p_message text, p_state text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when coalesce(p_message,'') ~* 'DOUBLON|déjà|already|duplicate|correspondance|receipt.*util|reçu.*util'
      then 'NEEDS_REVIEW'
    when p_state in ('23505','40001') then 'CONFLICT'
    when p_state in ('42501','23514','22023') then 'NEEDS_REVIEW'
    else 'FAILED'
  end;
$$;
