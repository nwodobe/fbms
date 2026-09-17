-- ANAGROCI FBMS — AFLP 2027
-- Retrait du repli global sur périmètre non renseigné.
--
-- Constat : private.farmer_registry_can_access_village() contient une clause
-- de compatibilité qui renvoie TRUE dès que zone, cluster, village_id et
-- rt_id sont tous nuls. Un compte à autorité ZONE, CLUSTER ou VILLAGE dont le
-- périmètre n'a jamais été renseigné voit donc TOUTE la base, en lecture comme
-- en écriture. C'est l'inverse de l'intention du rôle.
--
-- Cette migration supprime la clause. Elle REFUSE de s'appliquer tant qu'un
-- compte actif à périmètre restreint n'est pas qualifié : sans ce garde-fou,
-- le retrait transformerait un accès trop large en accès nul et casserait le
-- travail de terrain sans prévenir.
--
-- Ordre d'exécution :
--   1. Administration FBMS > Gestion des utilisateurs > Périmètre
--      (renseigner zone / cluster / village pour chaque compte signalé)
--   2. exécuter ce fichier

begin;

do $guard$
declare
  n integer;
  liste text;
begin
  select count(*), string_agg(coalesce(nom, user_id::text) || ' [' || coalesce(role,'?') || ']', ', ')
    into n, liste
  from public.profils p
  where p.actif = true
    and p.zone is null and p.cluster is null
    and p.village_id is null and p.rt_id is null
    and coalesce(
          p.authority_level,
          case p.role
            when 'Branch Manager' then 'GLOBAL'
            when 'Branch Manager / Head of Programme' then 'GLOBAL'
            when 'Assistant Branch Manager' then 'GLOBAL'
            when 'Head of Field' then 'GLOBAL'
            when 'Procurement Officer' then 'GLOBAL'
            when 'Zonal Head' then 'ZONE'
            when 'Unit Head' then 'CLUSTER'
            when 'Assistant Unit Head' then 'CLUSTER'
            when 'Supervisor' then 'CLUSTER'
            when 'Warehouse Keeper' then 'CLUSTER'
            when 'RT / Field Partner' then 'VILLAGE'
            when 'Agent Recenseur' then 'VILLAGE'
            when 'Logistics Coordinator' then 'TRANSVERSE'
            when 'Finance / Controller' then 'TRANSVERSE'
            when 'Read Only / Audit' then 'TRANSVERSE'
            when 'Consultation uniquement' then 'TRANSVERSE'
            else 'TRANSVERSE'
          end
        ) in ('ZONE','CLUSTER','VILLAGE');

  if n > 0 then
    raise exception
      'Migration refusee : % compte(s) actif(s) a perimetre restreint sans perimetre renseigne (%). Renseignez-les dans Administration FBMS > Perimetre, puis relancez.',
      n, liste;
  end if;
end
$guard$;

create or replace function private.farmer_registry_can_access_village(
  target_village text,
  target_rt text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  p public.profils%rowtype;
  v_cluster text;
  v_zone text;
begin
  select * into p
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;

  if p.user_id is null then return false; end if;
  if private.farmer_registry_authority() in ('GLOBAL','TRANSVERSE') then return true; end if;

  -- Plus de repli global : un perimetre non renseigne ne donne aucun acces.
  if p.zone is null and p.cluster is null and p.village_id is null and p.rt_id is null then
    return false;
  end if;

  if p.village_id is not null then
    if target_village is distinct from p.village_id then return false; end if;
    if p.rt_id is not null and target_rt is distinct from p.rt_id then return false; end if;
    return true;
  end if;

  select coalesce(v.cluster_code, upper(btrim(v.cluster))), c.zone_code
    into v_cluster, v_zone
  from public.villages v
  left join public.aflp_clusters c on c.code = v.cluster_code
  where v.id = target_village and not v.deleted;

  if v_cluster is null then return false; end if;
  if p.cluster is not null then
    return public.farmer_registry_norm_text(p.cluster)
      = public.farmer_registry_norm_text(v_cluster);
  end if;
  if p.zone is not null then
    return public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(v_zone)
      or public.farmer_registry_norm_text(p.zone)
      = public.farmer_registry_norm_text(
          (select z.label from public.aflp_zones z where z.code = v_zone)
        );
  end if;
  return false;
end
$$;

commit;
