-- =============================================================================
-- FBMS / AFLP 2027 · Rôle « Assistant Unit Head » (Assistant Chef d'Unité)
-- Date : 2026-11-03 · Statut : APPLIQUÉ EN PRODUCTION le 03/11/2026 (migration aflp_assistant_unit_head_acces), sur autorisation du Branch Manager
-- Banc : bash tests/sql/assistant-unit-head/lancer-banc.sh
-- Retour arrière : supabase/20261103120100_aflp_assistant_unit_head_acces_rollback.sql
--
-- Principe : rôle AUTONOME (valeur canonique « Assistant Unit Head »), aucune
-- modification des droits des rôles existants. Toutes les gardes ajoutées ne
-- s'activent que pour un profil ACTIF portant ce rôle.
--
-- Pourquoi des DÉCLENCHEURS en plus des politiques RLS : public.offline_sync_batch
-- et plusieurs RPC sont SECURITY DEFINER et contournent RLS. Un déclencheur
-- BEFORE s'exécute quel que soit le chemin (API directe, RPC, synchronisation
-- hors ligne). Les politiques RESTRICTIVES couvrent la LECTURE (que les
-- déclencheurs ne voient pas) et doublent les écritures directes.
--
-- Validation : trois niveaux, sur les états QUI EXISTENT DÉJÀ (aucun nouvel état).
--   · terrain      (AUH autorisé, son cluster) : village Brouillon/À corriger → Soumis ;
--                  RT Pressenti → Confirmé (jamais par son créateur) ;
--                  producteur Identifié ↔ Enrôlé.
--   · hiérarchique (Unit Head et au-dessus, inchangé) : villages À corriger,
--                  Validé Supervisor, Validé Head of Field, Approuvé BM, Rejeté ;
--                  RT Actif, Écarté ; producteur Actif, Inactif.
--   · financière   (rôles habilités, inchangé) : validation d'achat, avances,
--                  dépenses, paiements → refusés à l'AUH.
-- =============================================================================
begin;

-- --------------------------------------------------------------- 1. Le rôle
-- Ajout de la valeur, aucune valeur existante retirée.
alter table public.profils drop constraint profils_role_check;
alter table public.profils add constraint profils_role_check CHECK ((role = ANY (ARRAY[
  'Branch Manager'::text, 'Assistant Branch Manager'::text, 'Head of Field'::text, 'Procurement Officer'::text,
  'Supervisor'::text, 'Agent Recenseur'::text, 'Consultation uniquement'::text, 'General Manager'::text,
  'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'RT'::text,
  'LBA Purchase Officer'::text, 'Warehouse Manager'::text, 'Storekeeper'::text, 'QA / Lab'::text,
  'Factory User'::text, 'Finance'::text, 'Viewer / Auditor'::text, 'Finance Manager'::text,
  'Assistant Unit Head'::text])));

-- ------------------------------------------- 2. Fonctions d'appui (périmètre)
-- Profil ACTIF portant le rôle : un compte désactivé n'est plus « assistant »,
-- il ne passe donc plus aucune politique permissive (est_actif() = false).
create or replace function private.aflp_auh_actif()
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.profils p
                 where p.user_id = auth.uid() and p.actif = true and p.role = 'Assistant Unit Head')
$$;

-- Cluster canonique de l'assistant connecté (null si non assistant ou non affecté).
create or replace function private.aflp_auh_cluster()
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.farmer_registry_resolve_cluster_code(p.cluster)
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true and p.role = 'Assistant Unit Head'
  limit 1
$$;

-- Cluster canonique d'un village (colonne normalisée, puis colonnes historiques).
create or replace function private.aflp_cluster_du_village(p_village_id text)
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.farmer_registry_resolve_cluster_code(
           coalesce(nullif(btrim(v.cluster_code),''), nullif(btrim(v.cluster),''), v.data->'s1'->>'cluster'))
  from public.villages v where v.id = p_village_id
$$;

-- Village de rattachement d'un RT (lecture privilégiée, sans dépendre des politiques rt).
create or replace function private.aflp_village_du_rt(p_rt_id text)
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select r.village_id from public.rt r where r.id = p_rt_id $$;

-- Garde de lecture/écriture : vrai pour tout profil qui n'est pas assistant
-- (aucun effet sur les autres rôles) ; pour un assistant, vrai seulement si la
-- cible résout vers SON cluster. Cible sans cluster résoluble : refusée.
create or replace function private.aflp_auh_dans_perimetre(p_cluster text, p_village_id text default null)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_mien text; v_cible text;
begin
  if not private.aflp_auh_actif() then return true; end if;
  v_mien := private.aflp_auh_cluster();
  if v_mien is null then return false; end if;
  v_cible := public.farmer_registry_resolve_cluster_code(p_cluster);
  if v_cible is null and nullif(btrim(coalesce(p_village_id,'')),'') is not null then
    v_cible := private.aflp_cluster_du_village(p_village_id);
  end if;
  return v_cible is not null and v_cible = v_mien;
end $$;

revoke all on function private.aflp_auh_actif(), private.aflp_auh_cluster(),
  private.aflp_cluster_du_village(text), private.aflp_village_du_rt(text), private.aflp_auh_dans_perimetre(text, text) from public;
grant execute on function private.aflp_auh_actif(), private.aflp_auh_cluster(),
  private.aflp_cluster_du_village(text), private.aflp_village_du_rt(text), private.aflp_auh_dans_perimetre(text, text) to authenticated;

-- ------------------------------------- 3. Cohérence du compte (profils)
-- Un assistant = UN cluster actif, zone déduite du cluster, portée CLUSTER,
-- aucune permission additionnelle (permissions->zones élargirait le périmètre).
create or replace function private.profil_auh_coherence()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_code text; v_zone text;
begin
  if new.role is distinct from 'Assistant Unit Head' then return new; end if;
  select c.code, c.zone_code into v_code, v_zone
  from public.aflp_clusters c
  where c.code = public.farmer_registry_resolve_cluster_code(new.cluster) and c.active;
  if v_code is null then
    raise exception 'Assistant Unit Head : un cluster AFLP actif est obligatoire.' using errcode = '23514';
  end if;
  new.cluster := v_code;
  new.zone := v_zone;
  if coalesce(new.authority_level, 'CLUSTER') <> 'CLUSTER' then
    raise exception 'Assistant Unit Head : portée « % » refusée, seule la portée CLUSTER est admise.', new.authority_level
      using errcode = '42501';
  end if;
  new.authority_level := 'CLUSTER';
  if coalesce(new.permissions, '[]'::jsonb) not in ('[]'::jsonb, '{}'::jsonb) then
    raise exception 'Assistant Unit Head : aucune permission additionnelle n''est admise sur ce rôle.' using errcode = '42501';
  end if;
  if new.village_id is not null or new.rt_id is not null then
    raise exception 'Assistant Unit Head : rattachement à un village ou à un RT non admis (périmètre = cluster).' using errcode = '23514';
  end if;
  return new;
end $$;
-- Nom en « zzz » : s'exécute APRÈS trg_zz_profil_cluster_canonique.
drop trigger if exists trg_zzz_profil_auh_coherence on public.profils;
create trigger trg_zzz_profil_auh_coherence before insert or update on public.profils
  for each row execute function private.profil_auh_coherence();

-- ---------------------------------------- 4. Référentiel des rôles attribuables
-- Copie de la fonction de production avec UNE ligne ajoutée (ordre 5).
CREATE OR REPLACE FUNCTION public.fbms_roles_attribuables()
 RETURNS TABLE(valeur text, libelle text, portee text, cluster_requis boolean, attribuable boolean, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.est_bm() then
    raise exception 'Réservé au Branch Manager actif' using errcode = '42501';
  end if;
  return query
  with c as (
    select (regexp_matches(pg_get_constraintdef(k.oid), '''([^'']+)''::text', 'g'))[1] as v
    from pg_constraint k
    where k.conrelid = 'public.profils'::regclass and k.conname = 'profils_role_check'
  ),
  meta(v, lib, portee, clr, attr, note, ordre) as (values
    ('Branch Manager', 'Branch Manager / Responsable programme', 'GLOBAL', false, false, 'Non attribuable depuis l''écran : procédure administrateur (Supabase).', 1),
    ('General Manager', 'General Manager', 'GLOBAL', false, false, 'Rôle supérieur au Branch Manager : non attribuable par lui.', 2),
    ('Finance Manager', 'Finance Manager (rapprochement des paiements)', 'GLOBAL', false, false, 'Contrôle financier indépendant du Branch Manager : procédure administrateur.', 2),
    ('Zonal Head', 'Chef de Zone (Zonal Head)', 'GLOBAL', false, true, 'Portée terrain globale (décision du 17/09/2026). Revue des demandes ; ne mouvemente pas les sacs.', 3),
    ('Field Buying Operations Officer', 'Field Buying Operations Officer', 'GLOBAL', false, true, 'Consolidation et coordination ; lecture Sacherie globale.', 4),
    ('Unit Head', 'Chef d''Unité (Unit Head)', 'CLUSTER', true, true, 'Demandes RT, suivi des comptes RT, réceptions terrain. Cluster obligatoire.', 5),
    ('Assistant Unit Head', 'Assistant Chef d''Unité (Assistant Unit Head)', 'CLUSTER', true, true, 'Appui du Chef d''Unité : saisie, correction et validation terrain de son seul cluster. Aucune validation hiérarchique ou financière, aucune suppression. Cluster obligatoire.', 5),
    ('Storekeeper', 'Magasinier (Storekeeper)', 'CLUSTER', true, true, 'Sorties, transferts, comptages, constats physiques. Cluster obligatoire.', 6),
    ('Warehouse Manager', 'Responsable entrepôt usine (Warehouse Manager)', 'HORS_SACHERIE_AFLP', false, true, 'Module RCN TRACE / usine. Aucun accès aux emplacements AFLP.', 7)
  )
  select c.v, coalesce(m.lib, c.v), coalesce(m.portee, 'HORS_SACHERIE_AFLP'), coalesce(m.clr, false),
         coalesce(m.attr, true), m.note
  from c left join meta m on m.v = c.v
  order by coalesce(m.ordre, 100), c.v;
end
$function$;

-- ----------------------------------- 5. Lecture cloisonnée (politiques RESTRICTIVES)
-- RESTRICTIVE = combinée en ET avec toutes les politiques permissives
-- existantes : impossible de la contourner par une autre politique permissive.
-- Forme CASE : l'ordre d'évaluation est garanti et « (select …) » est calculé
-- UNE fois par requête : coût nul pour les rôles qui ne sont pas assistants.
drop policy if exists villages_auh_perimetre_sel on public.villages;
create policy villages_auh_perimetre_sel on public.villages as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(coalesce(nullif(btrim(cluster_code),''), nullif(btrim(cluster),''), data->'s1'->>'cluster'), null) else true end);

drop policy if exists rt_auh_perimetre_sel on public.rt;
create policy rt_auh_perimetre_sel on public.rt as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, village_id) else true end);

drop policy if exists achats_auh_perimetre_sel on public.achats;
create policy achats_auh_perimetre_sel on public.achats as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, village_id) else true end);

drop policy if exists avances_auh_perimetre_sel on public.avances;
create policy avances_auh_perimetre_sel on public.avances as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, private.aflp_village_du_rt(rt_id)) else true end);

drop policy if exists aflp_incidents_auh_perimetre_sel on public.aflp_incidents;
create policy aflp_incidents_auh_perimetre_sel on public.aflp_incidents as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster_code, village_id) else true end);

drop policy if exists sacs_mouvements_auh_perimetre_sel on public.sacs_mouvements;
create policy sacs_mouvements_auh_perimetre_sel on public.sacs_mouvements as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, village_id) else true end);

drop policy if exists reconciliations_auh_perimetre_sel on public.reconciliations;
create policy reconciliations_auh_perimetre_sel on public.reconciliations as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, null) else true end);

drop policy if exists depenses_mission_auh_perimetre_sel on public.depenses_mission;
create policy depenses_mission_auh_perimetre_sel on public.depenses_mission as restrictive for select to authenticated
  using (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(null, village_id) else true end);

-- ------------------------------------ 6. Écritures directes cloisonnées (RLS)
-- Villages et producteurs : déjà cloisonnés pour l'assistant en production
-- (villages_cluster_scope_unit_head_*, farmer_registry_scope_guard).
-- RT : la création n'était cloisonnée pour personne.
drop policy if exists rt_auh_perimetre_ins on public.rt;
create policy rt_auh_perimetre_ins on public.rt as restrictive for insert to authenticated
  with check (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(null, village_id) else true end);

drop policy if exists sacs_mouvements_auh_perimetre_ins on public.sacs_mouvements;
create policy sacs_mouvements_auh_perimetre_ins on public.sacs_mouvements as restrictive for insert to authenticated
  with check (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, village_id) else true end);

drop policy if exists reconciliations_auh_perimetre_ins on public.reconciliations;
create policy reconciliations_auh_perimetre_ins on public.reconciliations as restrictive for insert to authenticated
  with check (case when (select private.aflp_auh_actif()) then private.aflp_auh_dans_perimetre(cluster, null) else true end);

-- Avances : l'insertion crée une avance « Active », c'est un engagement financier.
drop policy if exists avances_auh_interdit_ins on public.avances;
create policy avances_auh_interdit_ins on public.avances as restrictive for insert to authenticated
  with check (not (select private.aflp_auh_actif()));

-- ------------------------------- 7. Gardes d'état (DÉCLENCHEURS, tous chemins)
create or replace function private.aflp_auh_garde_village()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  terrain constant text[] := array['Brouillon','Soumis'];
  modifiables constant text[] := array['Brouillon','Soumis','À corriger'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.statut,'Brouillon') <> all (terrain) then
      raise exception 'Assistant Unit Head : une fiche village se crée en Brouillon ou Soumis (statut « % » réservé à la validation hiérarchique).', new.statut
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.statut is distinct from old.statut then
    if coalesce(old.statut,'Brouillon') <> all (modifiables) then
      raise exception 'Assistant Unit Head : la fiche est au statut « % » (validation hiérarchique) ; seul le Chef d''Unité ou un supérieur peut le changer.', old.statut
        using errcode = '42501';
    end if;
    if new.statut <> all (terrain) then
      raise exception 'Assistant Unit Head : statut « % » réservé à la validation hiérarchique. Validation terrain = Soumis.', new.statut
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_zzzz_aflp_auh_garde_village on public.villages;
create trigger trg_zzzz_aflp_auh_garde_village before insert or update on public.villages
  for each row execute function private.aflp_auh_garde_village();

create or replace function private.aflp_auh_garde_rt()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare terrain constant text[] := array['Pressenti','Confirmé'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.statut,'Pressenti') <> all (terrain) then
    raise exception 'Assistant Unit Head : RT au statut « % » (décision hiérarchique) ; changement réservé au Chef d''Unité ou supérieur.', old.statut
      using errcode = '42501';
  end if;
  if coalesce(new.statut,'Pressenti') <> all (terrain) then
    raise exception 'Assistant Unit Head : statut RT « % » réservé à la validation hiérarchique.', new.statut using errcode = '42501';
  end if;
  -- La confirmation d'un RT conditionne contrat et financement : contrôle à
  -- quatre yeux. L'assistant ne confirme jamais un RT qu'il a lui-même créé.
  if new.statut = 'Confirmé' and (tg_op = 'INSERT'
       or lower(coalesce(old.created_by,'')) = lower(coalesce(public.fbms_email(),'-'))) then
    raise exception 'Assistant Unit Head : vous ne pouvez pas confirmer un RT que vous avez enregistré (contrôle à quatre yeux).'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_zzzz_aflp_auh_garde_rt on public.rt;
create trigger trg_zzzz_aflp_auh_garde_rt before insert or update on public.rt
  for each row execute function private.aflp_auh_garde_rt();

create or replace function private.aflp_auh_garde_producteur()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare terrain constant text[] := array['Identifié','Enrôlé'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.statut,'Identifié') <> all (terrain) then
    raise exception 'Assistant Unit Head : producteur au statut « % » ; changement réservé au Chef d''Unité ou supérieur.', old.statut
      using errcode = '42501';
  end if;
  if coalesce(new.statut,'Identifié') <> all (terrain) then
    raise exception 'Assistant Unit Head : statut producteur « % » hors validation terrain (Identifié, Enrôlé).', new.statut
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_zzzz_aflp_auh_garde_producteur on public.producteurs;
create trigger trg_zzzz_aflp_auh_garde_producteur before insert or update on public.producteurs
  for each row execute function private.aflp_auh_garde_producteur();

-- Achats : saisie autorisée dans SON cluster, jamais validée par l'assistant.
-- Hors ligne, la donnée n'est pas perdue : un statut validé reçu du terminal
-- est RAMENÉ à « À valider » (journalisé dans l'observation), et non rejeté.
create or replace function private.aflp_auh_garde_achat()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare non_valides constant text[] := array['À valider','À contrôler','Validation BM requise','À sécher','À trier'];
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'UPDATE' then
    if new.statut_validation is distinct from old.statut_validation
       or new.validated_by is distinct from old.validated_by or new.validated_at is distinct from old.validated_at then
      raise exception 'Assistant Unit Head : la validation d''un achat est réservée aux rôles habilités.' using errcode = '42501';
    end if;
  end if;
  if not private.aflp_auh_dans_perimetre(new.cluster, new.village_id)
     or (nullif(btrim(coalesce(new.village_id,'')),'') is not null
         and private.aflp_cluster_du_village(new.village_id) is distinct from private.aflp_auh_cluster()) then
    raise exception 'Assistant Unit Head : achat hors de votre cluster (%).', coalesce(new.cluster, new.village_id, 'cluster absent')
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.statut_validation is not null and new.statut_validation <> all (non_valides) then
      new.observation := concat_ws(' | ', nullif(new.observation,''),
        'Statut « ' || new.statut_validation || ' » reçu d''un Assistant Unit Head ramené à « À valider »');
      new.statut_validation := 'À valider';
    end if;
    new.validated_by := null;
    new.validated_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_zzzz_aflp_auh_garde_achat on public.achats;
create trigger trg_zzzz_aflp_auh_garde_achat before insert or update on public.achats
  for each row execute function private.aflp_auh_garde_achat();

create or replace function private.aflp_auh_garde_avance()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if private.aflp_auh_actif() then
    raise exception 'Assistant Unit Head : l''engagement ou la modification d''une avance est réservé aux rôles habilités.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_zzzz_aflp_auh_garde_avance on public.avances;
create trigger trg_zzzz_aflp_auh_garde_avance before insert or update or delete on public.avances
  for each row execute function private.aflp_auh_garde_avance();

-- Anomalies déclarées par RPC SECURITY DEFINER : rattachées au cluster de l'assistant.
create or replace function private.aflp_auh_garde_incident()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_mien text := private.aflp_auh_cluster();
begin
  if not private.aflp_auh_actif() then return new; end if;
  if tg_op = 'INSERT' and new.cluster_code is null and new.village_id is null then
    new.cluster_code := v_mien;
    select c.zone_code into new.zone_code from public.aflp_clusters c where c.code = v_mien;
  end if;
  if not private.aflp_auh_dans_perimetre(new.cluster_code, new.village_id) then
    raise exception 'Assistant Unit Head : anomalie hors de votre cluster.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_zzzz_aflp_auh_garde_incident on public.aflp_incidents;
create trigger trg_zzzz_aflp_auh_garde_incident before insert or update on public.aflp_incidents
  for each row execute function private.aflp_auh_garde_incident();

revoke all on function private.profil_auh_coherence(), private.aflp_auh_garde_village(), private.aflp_auh_garde_rt(),
  private.aflp_auh_garde_producteur(), private.aflp_auh_garde_achat(), private.aflp_auh_garde_avance(),
  private.aflp_auh_garde_incident() from public;

-- ------------------------------------- 8. Sacherie : lecture de son cluster
-- Copie de la fonction de production + UNE branche : l'assistant lit son
-- cluster (et peut donc préparer une demande de sacs), il ne mouvemente pas
-- physiquement les emplacements (écriture null), même avec une portée GLOBAL.
CREATE OR REPLACE FUNCTION private.sacherie_contexte()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  p public.profils%rowtype;
  v_cl text; v_lect text; v_ecr text; v_glob boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('connecte', false, 'actif', false);
  end if;
  select * into p from public.profils where user_id = auth.uid() and actif = true limit 1;
  if not found then
    return jsonb_build_object('connecte', true, 'actif', false);
  end if;
  v_cl   := private.sacherie_norm_cluster(p.cluster);
  v_glob := coalesce(p.authority_level,'') = 'GLOBAL';
  if p.role = 'Branch Manager' then
    v_lect := 'GLOBAL'; v_ecr := 'GLOBAL';
  elsif p.role = 'Zonal Head' then
    -- Decision du 17/09/2026 (migration zonal_head_global_field_access) :
    -- portee terrain globale. Le Zonal Head controle, il ne mouvemente pas.
    v_lect := case when public.portee_terrain_globale() then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := null;
  elsif p.role = 'Field Buying Operations Officer' then
    v_lect := 'GLOBAL'; v_ecr := null;
  elsif p.role in ('Unit Head', 'Storekeeper') then
    v_lect := case when v_glob then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := v_lect;
  elsif p.role = 'Assistant Unit Head' then
    -- AFLP 2027 (03/11/2026) : lecture et demandes sur SON cluster uniquement.
    v_lect := 'CLUSTER'; v_ecr := null;
  end if;
  return jsonb_build_object(
    'connecte', true, 'actif', true, 'role', p.role,
    'cluster', v_cl, 'cluster_saisi', p.cluster,
    'lecture', v_lect, 'ecriture', v_ecr);
end
$function$;

commit;

-- Contrôles post-déploiement (lecture seule) :
--   select pg_get_constraintdef(oid) from pg_constraint where conname='profils_role_check';
--   select policyname, permissive, cmd from pg_policies where policyname like '%auh%' order by 1;
--   select tgrelid::regclass, tgname from pg_trigger where tgname like '%auh%' order by 1;
