-- FIELD BUYING — référentiels LIGHT et préservation des médias hérités.
--
-- DÉJÀ APPLIQUÉ sur le projet live jmbdgpdthzpszfnddwzi le 2026-08-29.
-- Ce fichier reproduit l'état vérifié en base (vues, triggers, droits) pour
-- que le dépôt reste la référence ; il est idempotent (create or replace).
--
-- Problème mesuré en production : base() dans operations/field-buying.js
-- chargeait rt.data et villages.data en entier, soit ~21 Mo d'images base64
-- héritées de l'ancien recensement (villages 10 833 Ko / 12,9 s ;
-- rt 11 020 Ko / 18,8 s), retardant l'affichage de toutes les rubriques
-- d'environ 16 s. Ces images ne sont lues par aucune rubrique : le moteur
-- sert photos et pièces depuis le bucket privé terrain-preuves via la table
-- preuves.
--
-- Après bascule sur les vues : villages 123 Ko / 1,3 s ; rt 261 Ko / 2,8 s.
-- Mêmes nombres de lignes, zéro divergence de contenu hors clés d'images.
--
-- La table _fb_media_backup_20260829 (RLS active, droits révoqués pour anon
-- et authenticated) est la sauvegarde préalable des images : NE PAS Y TOUCHER.

-- 1) Vue RT sans les images base64 (photo, pieceRecto, pieceVerso).
--    security_invoker : la RLS de la table rt s'applique au lecteur.
create or replace view public.rt_light_v
with (security_invoker = true) as
select
  id, id_rt, nom, telephone, village_id, village_nom,
  cluster, statut, score, deleted,
  data - 'photo' - 'pieceRecto' - 'pieceVerso' as data
from public.rt r;

-- 2) Vue Villages sans les images des candidats RT (s7.candidats[].photo /
--    pieceRecto / pieceVerso), le reste de data inchangé (galerie comprise).
create or replace view public.villages_light_v
with (security_invoker = true) as
select
  id, village, region, departement, cluster, cluster_code,
  statut, score, gps_lat, gps_lng, farmer_code_prefix, deleted,
  case
    when data ? 's7' and jsonb_typeof(data -> 's7' -> 'candidats') = 'array'
    then jsonb_set(
      data, '{s7,candidats}',
      coalesce(
        (select jsonb_agg(cd.c - 'photo' - 'pieceRecto' - 'pieceVerso' order by cd.ord)
           from jsonb_array_elements(v.data -> 's7' -> 'candidats')
                with ordinality cd(c, ord)),
        '[]'::jsonb))
    else data
  end as data
from public.villages v;

grant select on public.rt_light_v to anon, authenticated;
grant select on public.villages_light_v to anon, authenticated;
-- Nota : les privilèges par défaut du schéma public de Supabase accordent
-- aussi les autres droits sur les vues ; security_invoker renvoie toute
-- écriture sur la RLS des tables sous-jacentes, l'exposition est inchangée.

-- 3) Préservation des médias RT à la mise à jour de data.
--    Les formulaires d'édition reconstruisent data sans les images héritées
--    et les effaçaient donc à chaque modification (bug de perte de données
--    préexistant, indépendant de l'optimisation). Contrat : clé absente =
--    conservée depuis l'ancienne valeur ; clé présente à null = suppression
--    explicite voulue par l'appelant.
create or replace function public.fb_preserve_media_rt()
returns trigger
language plpgsql
as $$
declare k text;
begin
  if NEW.data is null or OLD.data is null then return NEW; end if;
  foreach k in array array['photo', 'pieceRecto', 'pieceVerso'] loop
    if not (NEW.data ? k) and (OLD.data ? k) then
      NEW.data := jsonb_set(NEW.data, array[k], OLD.data -> k, true);
    end if;
  end loop;
  return NEW;
end $$;

drop trigger if exists trg_fb_preserve_media_rt on public.rt;
create trigger trg_fb_preserve_media_rt
before update of data on public.rt
for each row execute function public.fb_preserve_media_rt();

-- 4) Préservation des médias des candidats RT du village. Appariement des
--    candidats par nom (insensible casse/espaces) puis par position.
create or replace function public.fb_preserve_media_villages()
returns trigger
language plpgsql
as $$
declare
  new_c jsonb; old_c jsonb; merged jsonb := '[]'::jsonb;
  item jsonb; src jsonb; nom_new text; i int := 0; k text;
begin
  if NEW.data is null or OLD.data is null then return NEW; end if;
  new_c := NEW.data #> '{s7,candidats}';
  old_c := OLD.data #> '{s7,candidats}';
  if jsonb_typeof(new_c) <> 'array' or jsonb_typeof(old_c) <> 'array' then return NEW; end if;

  for item in select e.value from jsonb_array_elements(new_c) e loop
    nom_new := lower(btrim(coalesce(item ->> 'nom', '')));
    src := null;
    if nom_new <> '' then
      select o.value into src from jsonb_array_elements(old_c) o
       where lower(btrim(coalesce(o.value ->> 'nom', ''))) = nom_new limit 1;
    end if;
    if src is null then src := old_c -> i; end if;
    if src is not null and jsonb_typeof(src) = 'object' then
      foreach k in array array['photo', 'pieceRecto', 'pieceVerso'] loop
        if not (item ? k) and (src ? k) then
          item := jsonb_set(item, array[k], src -> k, true);
        end if;
      end loop;
    end if;
    merged := merged || jsonb_build_array(item);
    i := i + 1;
  end loop;

  NEW.data := jsonb_set(NEW.data, '{s7,candidats}', merged, true);
  return NEW;
end $$;

drop trigger if exists trg_fb_preserve_media_villages on public.villages;
create trigger trg_fb_preserve_media_villages
before update of data on public.villages
for each row execute function public.fb_preserve_media_villages();
