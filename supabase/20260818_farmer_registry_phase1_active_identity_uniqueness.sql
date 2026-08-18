-- ANAGROCI FBMS - AFLP Farmer Registry Phase 1
-- Allow historical reuse of a document number while enforcing one active
-- identity document per producer.
-- Applied on 2026-08-18 as farmer_registry_phase1_07_active_identity_uniqueness.

begin;

drop index if exists public.farmer_identity_documents_value_uidx;

create index if not exists farmer_identity_documents_value_idx
  on public.farmer_identity_documents (producteur_id, document_number)
  where nullif(btrim(document_number),'') is not null;

create unique index if not exists farmer_identity_documents_one_active_uidx
  on public.farmer_identity_documents (producteur_id)
  where status = 'ACTIVE';

commit;
