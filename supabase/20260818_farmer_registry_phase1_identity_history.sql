-- AFLP Farmer Registry Phase 1 - identity document history hardening
begin;

create or replace function public.farmer_registry_prepare_identity_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare previous_id uuid;
begin
  if new.supersedes_id is null then
    select d.id into previous_id
    from public.farmer_identity_documents d
    where d.producteur_id = new.producteur_id
      and d.status = 'ACTIVE'
    order by d.created_at desc
    limit 1;
    new.supersedes_id := previous_id;
  else
    previous_id := new.supersedes_id;
  end if;

  if previous_id is not null then
    update public.farmer_identity_documents
    set status = case when new.status = 'WITHDRAWN' then 'WITHDRAWN' else 'REPLACED' end
    where id = previous_id and status = 'ACTIVE';
  end if;

  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end
$$;

drop trigger if exists trg_farmer_registry_prepare_identity_document
  on public.farmer_identity_documents;
create trigger trg_farmer_registry_prepare_identity_document
before insert on public.farmer_identity_documents
for each row execute function public.farmer_registry_prepare_identity_document();

revoke all on function public.farmer_registry_prepare_identity_document()
from public, anon, authenticated;

commit;
