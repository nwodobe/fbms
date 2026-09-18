-- =====================================================================
-- Sacherie AFLP — correction d'un droit manquant sur sacherie_ct_location
--
-- CONSTAT (17/09/2026, decouvert par simulation de 62 operations)
--   `public.sacherie_ct_location(...)` portait l'ACL
--       postgres=X/postgres | service_role=X/postgres
--   sans aucun octroi a `authenticated`, alors que toutes les autres RPC
--   `sacherie_ct_*` / `sacherie_ops_*` en ont un.
--   Le front appelle cette fonction dans `openBagRequest` pour creer
--   l'emplacement `AFLP-RT-…` du RT au PREMIER passage. Consequence :
--   la premiere demande de sacs de chaque RT echouait en production avec
--   « permission denied for function sacherie_ct_location ».
--   Non detecte parce que `ops_bag_requests` etait vide : personne
--   n'avait encore emprunte ce chemin.
--
--   Le correctif avait ete applique directement a la base le 17/09/2026 ;
--   ce fichier le versionne pour que le depot et la production disent la
--   meme chose.
--
-- ROLLBACK : revoke execute on function public.sacherie_ct_location(
--   text,text,text,text,text,text) from authenticated;
--   (rollback deconseille : il reintroduit la panne.)
-- =====================================================================

begin;

grant execute on function public.sacherie_ct_location(text, text, text, text, text, text)
  to authenticated;

commit;
