-- FIELD BUYING 360 — stockage privé des pièces d'identité RT.
-- Portrait RT et galerie Village continuent d'utiliser le bucket photos existant.
-- Les pièces CNI ne doivent jamais avoir d'URL publique permanente.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'field-buying-sensitive',
  'field-buying-sensitive',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

-- Un agent autorisé à éditer le terrain peut CAPTURER sa pièce, dans son dossier uid.
drop policy if exists field_buying_sensitive_insert on storage.objects;
create policy field_buying_sensitive_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'field-buying-sensitive'
  and peut_editer_terrain()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Lecture des CNI : Branch Manager / Administrateur uniquement.
drop policy if exists field_buying_sensitive_select on storage.objects;
create policy field_buying_sensitive_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'field-buying-sensitive'
  and (est_bm() or fbms_role() = 'Administrateur')
);

-- Suppression physique réservée au même périmètre sensible.
drop policy if exists field_buying_sensitive_delete on storage.objects;
create policy field_buying_sensitive_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'field-buying-sensitive'
  and (est_bm() or fbms_role() = 'Administrateur')
);

-- farmer_buying_documents est déjà le registre document canonique.
-- On ajoute une barrière restrictive pour les métadonnées CNI RT.
drop policy if exists field_buying_documents_sensitive_select on public.farmer_buying_documents;
create policy field_buying_documents_sensitive_select
on public.farmer_buying_documents
as restrictive
for select
to authenticated
using (
  objet_type not like 'RT:ID_%'
  or est_bm()
  or fbms_role() = 'Administrateur'
);

comment on policy field_buying_sensitive_select on storage.objects is
'Pièces identité RT FIELD BUYING: lecture privée BM/Admin via signed URLs.';
