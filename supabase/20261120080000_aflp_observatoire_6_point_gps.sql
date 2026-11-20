-- =====================================================================
-- OBSERVATOIRE AGRONOMIQUE AFLP 2027 · migration 6 : point GPS reconnu après vérification
-- ---------------------------------------------------------------------
-- Mandat du Branch Manager du 19/11/2026 (« Opération FBMS Cartographie 2026 », § 4.3).
-- Anomalie corrigée : une parcelle dont le point GPS a été VÉRIFIÉ par la supervision
-- (gps_status = 'GPS_VERIFIED') était déclarée « sans position GPS » et sortait de la
-- liste des champs installables. Un point vérifié est au moins aussi fiable qu'un
-- point capturé : il localise la parcelle.
-- Ce que la correction ne fait PAS : elle n'assimile pas un point à une superficie,
-- ne touche à aucune autre exigence (cluster, producteur identifié, nom et prénoms,
-- nombre d'arbres, champ actif) et ne modifie aucune donnée.
-- Seules deux expressions changent (comparaison stricte → liste des deux statuts) ;
-- signatures, droits et sécurité inchangés (create or replace).
-- RETOUR ARRIÈRE : 20261120080100_aflp_observatoire_6_rollback.sql (définitions de la migration 5).
-- REJOUABLE : oui.
-- =====================================================================
begin;

create or replace function private.pheno_parcelle_manques(p_plot uuid) returns text[]
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select coalesce(array_remove(array[
    case when v.id is null or public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')) is null
         then 'village rattaché à un cluster AFLP' end,
    case when pr.id is null or coalesce(btrim(pr.code), '') = '' or coalesce(pr.possible_duplicate, false)
         then 'producteur identifié (code unique, sans doublon signalé)' end,
    case when pr.id is null or coalesce(btrim(pr.nom), '') = '' or coalesce(btrim(pr.prenoms), '') = ''
         then 'nom et prénoms du producteur' end,
    case when fp.latitude is null or fp.longitude is null or fp.gps_status not in ('POINT_CAPTURED', 'GPS_VERIFIED')
         then 'position GPS relevée sur le champ' end,
    case when coalesce(fp.tree_count, 0) <= 0 then 'nombre d''arbres du champ' end,
    case when coalesce(fp.status, '') <> 'ACTIVE' or fp.deleted then 'champ actif dans le registre' end
  ], null), '{}')
  from public.farmer_plots fp
  left join public.villages v on v.id = fp.village_id
  left join public.producteurs pr on pr.id = fp.producteur_id and not coalesce(pr.deleted, false)
  where fp.id = p_plot
$$;

create or replace function public.pheno_parcelles_disponibles(p_campaign uuid) returns table (
  plot_id uuid, producteur_id text, producteur_nom text, producteur_code text, village_id text, village_nom text,
  cluster_code text, parcelle_nom text, arbres_declares integer, deja_installee boolean,
  producteur_prenoms text, gps_releve boolean, eligible boolean, manques text[])
language sql stable security definer set search_path to 'public', 'private', 'pg_temp' as $$
  select fp.id, fp.producteur_id, pr.nom, pr.code, fp.village_id, v.village,
    public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')) as cl,
    fp.local_name, fp.tree_count,
    exists (select 1 from public.pheno_panels pp where pp.campaign_id = p_campaign and pp.plot_id = fp.id),
    pr.prenoms, (fp.latitude is not null and fp.longitude is not null and fp.gps_status in ('POINT_CAPTURED', 'GPS_VERIFIED')),
    cardinality(private.pheno_parcelle_manques(fp.id)) = 0, private.pheno_parcelle_manques(fp.id)
  from public.farmer_plots fp
  join public.villages v on v.id = fp.village_id
  join public.producteurs pr on pr.id = fp.producteur_id
  where not fp.deleted and coalesce(fp.status, 'ACTIVE') = 'ACTIVE' and not coalesce(pr.deleted, false)
    and private.pheno_peut_collecter(public.aflp_cluster_code(coalesce(nullif(btrim(v.cluster_code), ''), nullif(btrim(v.cluster), ''), v.data->'s1'->>'cluster')))
  order by pr.nom, pr.prenoms, fp.local_name
$$;

commit;
