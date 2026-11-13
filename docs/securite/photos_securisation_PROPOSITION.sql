-- =====================================================================
-- PROPOSITION (NON APPLIQUÉE) : sécurisation du bucket existant « photos »
-- Correctif SÉPARÉ de l'Observatoire, à valider à part par le Branch Manager.
-- Ne pas appliquer sans livrer en même temps le front compatible (URL signées) :
--   fbms/index.html (RemotePhotos.upload : getPublicUrl ; 42 villages stockent
--   une URL publique dans villages.data) et operations/field-buying.js
--   (villagePhotoUrl construit l'URL publique).
-- Principe : la photo suit EXACTEMENT les droits de la fiche village (dossier = id du village) :
--   lecture = compte actif (comme villages_sel : la fiche, qui contient déjà l'URL, est lisible par tout compte actif) ;
--   dépôt / remplacement = mêmes conditions que la modification d'un village (rôle autre que « Consultation uniquement »,
--   peut_ecrire_referentiel_terrain, cluster du Unit Head / Assistant Unit Head) ;
--   suppression = Branch Manager seul. Restreindre davantage la lecture serait une décision métier distincte.
-- =====================================================================
begin;
update storage.buckets
   set public = false,
       file_size_limit = 10485760,                        -- 10 Mo, à ajuster après mesure des photos réelles
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'photos';

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_update on storage.objects;
drop policy if exists photos_delete on storage.objects;

create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.est_actif()
         and exists (select 1 from public.villages v where v.id = (storage.foldername(name))[1]));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.est_actif() and exists (select 1 from public.villages v
                      where v.id = (storage.foldername(name))[1]
                        and public.fbms_role() is not null and public.fbms_role() <> 'Consultation uniquement' and public.peut_ecrire_referentiel_terrain()
                        and private.aflp_village_ecriture_dans_mon_cluster(v.cluster_code, v.cluster, v.data)));
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.est_actif() and exists (select 1 from public.villages v
                      where v.id = (storage.foldername(name))[1]
                        and public.fbms_role() is not null and public.fbms_role() <> 'Consultation uniquement' and public.peut_ecrire_referentiel_terrain()
                        and private.aflp_village_ecriture_dans_mon_cluster(v.cluster_code, v.cluster, v.data)))
  with check (bucket_id = 'photos' and public.est_actif() and exists (select 1 from public.villages v
                      where v.id = (storage.foldername(name))[1]
                        and public.fbms_role() is not null and public.fbms_role() <> 'Consultation uniquement' and public.peut_ecrire_referentiel_terrain()
                        and private.aflp_village_ecriture_dans_mon_cluster(v.cluster_code, v.cluster, v.data)));
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.est_bm());
commit;

-- RETOUR ARRIÈRE (texte d'origine, production au 13/11/2026) :
-- begin;
-- update storage.buckets set public = true, file_size_limit = null, allowed_mime_types = null where id = 'photos';
-- drop policy photos_read on storage.objects; drop policy photos_insert on storage.objects;
-- drop policy photos_update on storage.objects; drop policy photos_delete on storage.objects;
-- create policy photos_read   on storage.objects for select to authenticated using (bucket_id = 'photos');
-- create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos');
-- create policy photos_update on storage.objects for update to authenticated using (bucket_id = 'photos');
-- create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos');
-- commit;
