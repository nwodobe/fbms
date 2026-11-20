-- =============================================================================
-- Banc Assistant Unit Head · couche d'écarts appliquée APRÈS la reproduction
-- tests/sql/unit-head/00_reproduction_production.sql (relevé du 16/10/2026)
-- et les trois migrations Unit Head appliquées en production le 16/10/2026.
--
-- Objet : réaligner le banc sur la production relevée le 03/11/2026 (projet
-- jmbdgpdthzpszfnddwzi, lecture seule). Chaque fonction ci-dessous est une copie
-- textuelle de pg_get_functiondef en production ; l'empreinte md5 est vérifiée
-- par lancer-banc.sh (fichier empreintes_production_20261103.txt).
-- Aucune donnée de production n'est copiée.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.aflp_village_ecriture_dans_mon_cluster(p_cluster_code text, p_cluster text, p_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_role text;
  v_mon_cluster text;
  v_signal text;
  v_code text;
  v_nb int := 0;
begin
  select role, cluster into v_role, v_mon_cluster
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;
  if v_role is null or v_role not in ('Unit Head', 'Assistant Unit Head') then
    return true;
  end if;
  v_mon_cluster := public.farmer_registry_resolve_cluster_code(v_mon_cluster);
  if v_mon_cluster is null then
    return false;
  end if;
  foreach v_signal in array array[p_cluster_code, p_cluster, p_data -> 's1' ->> 'cluster'] loop
    if nullif(btrim(coalesce(v_signal, '')), '') is null then
      continue;
    end if;
    v_code := public.farmer_registry_resolve_cluster_code(v_signal);
    if v_code is null or v_code <> v_mon_cluster then
      return false;
    end if;
    v_nb := v_nb + 1;
  end loop;
  return v_nb > 0;
end
$function$;

CREATE OR REPLACE FUNCTION private.farmer_registry_can_access_village(target_village text, target_rt text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  p public.profils%rowtype;
  v_cluster text;
  v_zone text;
  v_has_multi_zone boolean := false;
begin
  select * into p
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1;

  if p.user_id is null then return false; end if;
  if private.farmer_registry_authority() = 'GLOBAL' then return true; end if;

  -- Portee terrain globale par role (Zonal Head). Dynamique : vaut pour toute
  -- zone existante ou creee ulterieurement, sans liste a maintenir.
  if public.portee_terrain_globale() then return true; end if;

  select coalesce(v.cluster_code, upper(btrim(v.cluster))), c.zone_code
    into v_cluster, v_zone
  from public.villages v
  left join public.aflp_clusters c on c.code = v.cluster_code
  where v.id = target_village and not v.deleted;

  if v_cluster is null then return false; end if;

  -- Multi-zone explicite : permissions = {"zones":["GBEKE_1","GBEKE_2"]}
  if jsonb_typeof(p.permissions) = 'object'
     and jsonb_typeof(p.permissions->'zones') = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(p.permissions->'zones') z
      where public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(v_zone)
         or public.farmer_registry_norm_text(z)
            = public.farmer_registry_norm_text(
                (select label from public.aflp_zones where code = v_zone)
              )
    ) into v_has_multi_zone;
    if v_has_multi_zone then return true; end if;
  end if;

  if p.village_id is not null then
    if target_village is distinct from p.village_id then return false; end if;
    if p.rt_id is not null and target_rt is distinct from p.rt_id then return false; end if;
    return true;
  end if;

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

  -- Plus d'acces large implicite si aucun perimetre n'est configure.
  return false;
end
$function$;

CREATE OR REPLACE FUNCTION private.farmer_registry_can_access_producteur(pid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists (
    select 1
    from public.producteurs p
    where p.id = pid
      and private.farmer_registry_can_access_village(p.village_id, p.rt_id)
  )
$function$;

CREATE OR REPLACE FUNCTION private.farmer_registry_can_capture()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists(
    select 1 from public.profils p
    where p.user_id=auth.uid() and p.actif=true
      and p.role in (
        'Branch Manager','Branch Manager / Head of Programme','Assistant Branch Manager',
        'Head of Field','Procurement Officer','Zonal Head','Unit Head',
        'Assistant Unit Head','Supervisor','Agent Recenseur',
        'Chef d''equipe','Chef d''équipe'
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.farmer_registry_can_supervise()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists(
    select 1 from public.profils p
    where p.user_id=auth.uid() and p.actif=true
      and p.role in (
        'Branch Manager','Branch Manager / Head of Programme','Assistant Branch Manager',
        'Head of Field','Procurement Officer','Zonal Head','Unit Head','Supervisor','Admin','Administrateur'
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.farmer_registry_can_read_sensitive()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.farmer_registry_can_capture() or private.farmer_registry_can_supervise()
$function$;

CREATE OR REPLACE FUNCTION public.peut_modifier_rt_producteur()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.mon_role() in (
    'Branch Manager',
    'Assistant Branch Manager',
    'Head of Field',
    'Procurement Officer',
    'Zonal Head',
    'Unit Head',
    'Assistant Unit Head',
    'Supervisor',
    'Agent Recenseur',
    'Chef d''equipe',
    'Chef d''équipe',
    'Administrateur'
  )
$function$;

CREATE OR REPLACE FUNCTION private.farmer_controle_doublon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_tel text; v_idn text; v_nn text; v_hit record; v_justif boolean;
begin
  if coalesce(new.deleted, false) then return new; end if;
  if tg_op = 'UPDATE' and new.telephone is not distinct from old.telephone and new.nom is not distinct from old.nom
     and new.prenoms is not distinct from old.prenoms and new.village_id is not distinct from old.village_id
     and old.deleted is not distinct from new.deleted then
    return new;
  end if;
  v_tel := nullif(public.farmer_registry_norm_phone(new.telephone), '');
  if v_tel is not null and length(v_tel) < 8 then v_tel := null; end if;
  v_idn := nullif(public.farmer_registry_norm_text(coalesce(new.nom,'') || ' ' || coalesce(new.prenoms,'')), '');
  v_nn  := nullif(public.farmer_registry_norm_text(new.nom), '');
  v_justif := coalesce(new.possible_duplicate, false) and length(btrim(coalesce(new.review_reason,''))) >= 10;

  if v_tel is not null and v_idn is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: ce producteur existe déjà (Farmer ID %, même téléphone et même identité). Ouvrez la fiche existante au lieu d''en créer une nouvelle.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      if auth.uid() is not null and not private.aflp_can_force_create() then
        raise exception 'DOUBLON_FORT: création malgré un doublon fort réservée à la supervision (Supervisor, Unit Head, Zonal Head, direction).'
          using errcode = '42501';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;

  if v_idn is not null and nullif(btrim(coalesce(new.prenoms,'')),'') is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: un producteur de même nom et prénoms existe déjà dans ce village (Farmer ID %). Vérifiez la fiche existante ; une création exceptionnelle exige une justification.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;

  if v_tel is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
     limit 1;
    if v_hit.id is not null then
      new.possible_duplicate := true; new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : téléphone partagé avec le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (téléphone familial possible).');
      return new;
    end if;
  end if;

  if v_nn is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id and p.nom is not null
       and public.farmer_registry_norm_text(p.nom) = v_nn
       and (nullif(btrim(coalesce(new.prenoms,'')),'') is null or nullif(btrim(coalesce(p.prenoms,'')),'') is null)
     limit 1;
    if v_hit.id is not null then
      new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : même nom dans le même village que le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (indice faible).');
    end if;
  end if;
  return new;
end $function$;

-- --------------------------------------------------------------- RT (triggers)
CREATE OR REPLACE FUNCTION public.fbms_slug3(txt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select left(
    regexp_replace(
      translate(upper(coalesce(txt,'')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸÆŒ', 'AAAAAACEEEEIIIINOOOOOUUUUYYAO'),
      '[^A-Z0-9]+', '', 'g'
    ) || 'XXX',
    3
  )
$function$;

alter table public.rt add column if not exists score integer;

CREATE OR REPLACE FUNCTION public.set_rt_cluster_and_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  base_code text;
  next_num integer;
  vvillage text;
  vcluster text;
  vdeleted boolean;
begin
  if coalesce(new.deleted,false)=false then
    if new.village_id is null or trim(new.village_id)='' then
      raise exception 'RT actif invalide: village_id obligatoire.';
    end if;

    select trim(coalesce(v.village, v.data->'s1'->>'village')),
           upper(trim(coalesce(nullif(trim(v.cluster),''), nullif(trim(v.data->'s1'->>'cluster'),'')))),
           coalesce(v.deleted,false)
      into vvillage, vcluster, vdeleted
    from public.villages v
    where v.id=new.village_id;

    if vvillage is null then
      raise exception 'RT actif invalide: village_id % introuvable.', new.village_id;
    end if;
    if vdeleted then
      raise exception 'RT actif invalide: le village % est supprime.', new.village_id;
    end if;
    if vcluster is null or vcluster='' then
      raise exception 'RT actif invalide: cluster absent sur le village %.', new.village_id;
    end if;

    new.village_nom := vvillage;
    new.cluster := vcluster;
  elsif new.cluster is not null then
    new.cluster := upper(trim(new.cluster));
  end if;

  if new.id_rt is null or trim(new.id_rt)='' then
    base_code := 'RT-' || public.fbms_slug3(coalesce(new.village_nom,'VIL')) || '-';
    select coalesce(max((regexp_match(id_rt,'[0-9]+$'))[1]::int),0)+1
      into next_num
    from public.rt
    where id_rt like base_code || '%';
    new.id_rt := base_code || lpad(next_num::text,2,'0');
  end if;

  new.data := jsonb_strip_nulls(
    coalesce(new.data,'{}'::jsonb) || jsonb_build_object(
      'id', new.id,
      'idRt', new.id_rt,
      'nom', new.nom,
      'telephone', new.telephone,
      'villageId', new.village_id,
      'villageNom', new.village_nom,
      'cluster', new.cluster,
      'statut', new.statut,
      'score', new.score,
      'deleted', new.deleted
    )
  );
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_set_rt_cluster_and_code on public.rt;
create trigger trg_set_rt_cluster_and_code before insert or update on public.rt
  for each row execute function public.set_rt_cluster_and_code();
drop trigger if exists trg_suppr_rt on public.rt;
create trigger trg_suppr_rt before update on public.rt
  for each row execute function public.fbms_controler_suppression();
alter table public.rt add constraint rt_statut_check
  check (statut = any (array['Pressenti'::text, 'Confirmé'::text, 'Actif'::text, 'Écarté'::text]));
alter table public.villages drop constraint if exists villages_statut_check;
alter table public.villages add constraint villages_statut_check
  check (statut = any (array['Brouillon'::text, 'Soumis'::text, 'À corriger'::text, 'Validé Supervisor'::text, 'Validé Head of Field'::text, 'Approuvé BM'::text, 'Rejeté'::text]));
alter table public.producteurs drop constraint if exists producteurs_statut_check;
alter table public.producteurs add constraint producteurs_statut_check
  check (statut = any (array['Identifié'::text, 'Enrôlé'::text, 'Actif'::text, 'Inactif'::text]));

-- ------------------------------------------------------- farmer_plots (RLS prod)
alter table public.farmer_plots add column if not exists created_by uuid default auth.uid();
alter table public.farmer_plots enable row level security;
drop policy if exists farmer_plots_insert on public.farmer_plots;
drop policy if exists farmer_plots_select on public.farmer_plots;
drop policy if exists farmer_plots_update on public.farmer_plots;
create policy farmer_plots_insert on public.farmer_plots for insert to authenticated
  with check (private.farmer_registry_can_capture() AND (created_by = auth.uid()) AND private.farmer_registry_can_access_producteur(producteur_id));
create policy farmer_plots_select on public.farmer_plots for select to authenticated
  using (est_actif() AND private.farmer_registry_can_read_sensitive() AND private.farmer_registry_can_access_producteur(producteur_id));
create policy farmer_plots_update on public.farmer_plots for update to authenticated
  using (private.farmer_registry_can_capture() AND private.farmer_registry_can_access_producteur(producteur_id))
  with check (private.farmer_registry_can_capture() AND private.farmer_registry_can_access_producteur(producteur_id));
grant select, insert, update on public.farmer_plots to authenticated;
