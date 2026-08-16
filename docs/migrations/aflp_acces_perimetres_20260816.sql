-- ============================================================================
-- ANAGROCI FBMS — ACCÈS AFLP 2027 : rôles, périmètres, autorité
-- Fichier : docs/migrations/aflp_acces_perimetres_20260816.sql
-- ----------------------------------------------------------------------------
-- CE SCRIPT N'A PAS ÉTÉ EXÉCUTÉ. Il est fourni pour relecture puis application
-- manuelle par le Branch Manager (agent-policy.yml interdit toute modification
-- automatique de supabase/**).
--
-- Propriétés :
--   · ADDITIF — aucune colonne, table, ligne ou politique n'est supprimée ;
--   · IDEMPOTENT — réexécutable sans effet de bord ;
--   · SANS RUPTURE — un compte dont le rôle reste « Supervisor » continue de
--     se connecter exactement comme avant. Aucun rôle n'est converti ici.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. RÉFÉRENTIEL ZONE -> CLUSTER
--    Seule donnée réellement nouvelle : le rattachement d'un cluster à une
--    zone. Les villages, RT et producteurs restent le référentiel maître ;
--    on ne recopie aucune de leurs données ici.
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_zones (
  code        text primary key,
  libelle     text not null,
  region      text,
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.aflp_clusters (
  code        text primary key,
  libelle     text not null,
  zone_code   text not null references public.aflp_zones(code) on update cascade,
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.aflp_zones (code, libelle, region) values
  ('GBEKE_1', 'GBEKE 1', 'Gbêkê'),
  ('GBEKE_2', 'GBEKE 2', 'Gbêkê')
on conflict (code) do nothing;

insert into public.aflp_clusters (code, libelle, zone_code) values
  ('DJEBONOUA', 'Djébonoua', 'GBEKE_1'),
  ('BROBO',     'Brobo',     'GBEKE_1'),
  ('SAKASSOU',  'Sakassou',  'GBEKE_1'),
  ('BEOUMI',    'Béoumi',    'GBEKE_2'),
  ('BOTRO',     'Botro',     'GBEKE_2'),
  ('DIABO',     'Diabo',     'GBEKE_2')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. PÉRIMÈTRE SUR LES PROFILS
--    profils.role reste inchangé (texte libre, mêmes valeurs qu'aujourd'hui).
--    On ajoute autour de lui le périmètre et le niveau d'autorité.
-- ---------------------------------------------------------------------------
alter table public.profils add column if not exists zone            text references public.aflp_zones(code)    on update cascade;
alter table public.profils add column if not exists cluster         text references public.aflp_clusters(code) on update cascade;
alter table public.profils add column if not exists village_id      text;
alter table public.profils add column if not exists rt_id           text;
alter table public.profils add column if not exists authority_level text;
alter table public.profils add column if not exists permissions     jsonb not null default '[]'::jsonb;
alter table public.profils add column if not exists telephone       text;
alter table public.profils add column if not exists derniere_connexion timestamptz;

-- Cohérence : jamais « zone = GBEKE 1 » avec « cluster = DIABO ».
alter table public.profils drop constraint if exists profils_zone_cluster_coherents;
alter table public.profils add  constraint profils_zone_cluster_coherents check (
  cluster is null
  or zone is null
  or zone = (select c.zone_code from public.aflp_clusters c where c.code = public.profils.cluster)
) not valid;   -- not valid : les lignes existantes ne sont pas rejetées.

alter table public.profils drop constraint if exists profils_authority_level_valide;
alter table public.profils add  constraint profils_authority_level_valide check (
  authority_level is null
  or authority_level in ('GLOBAL','ZONE','CLUSTER','VILLAGE','TRANSVERSE')
);

-- ---------------------------------------------------------------------------
-- 3. FONCTIONS DE PÉRIMÈTRE (utilisables dans n'importe quelle politique RLS)
--    Elles répondent à : QUI ? PEUT FAIRE QUOI ? OÙ ? À QUEL NIVEAU ?
-- ---------------------------------------------------------------------------
create or replace function public.aflp_authority()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    p.authority_level,
    case p.role
      when 'Branch Manager'                      then 'GLOBAL'
      when 'Branch Manager / Head of Programme'  then 'GLOBAL'
      when 'Assistant Branch Manager'            then 'GLOBAL'
      when 'Head of Field'                       then 'GLOBAL'
      when 'Procurement Officer'                 then 'GLOBAL'
      when 'Zonal Head'                          then 'ZONE'
      when 'Unit Head'                           then 'CLUSTER'
      when 'Assistant Unit Head'                 then 'CLUSTER'
      when 'Warehouse Keeper'                    then 'CLUSTER'
      when 'Supervisor'                          then 'CLUSTER'
      when 'RT / Field Partner'                  then 'VILLAGE'
      when 'Agent Recenseur'                     then 'VILLAGE'
      when 'Logistics Coordinator'               then 'TRANSVERSE'
      when 'Finance / Controller'                then 'TRANSVERSE'
      when 'Read Only / Audit'                   then 'TRANSVERSE'
      when 'Consultation uniquement'             then 'TRANSVERSE'
      else 'VILLAGE'
    end)
  from public.profils p
  where p.user_id = auth.uid() and p.actif = true
  limit 1;
$$;

-- Liste des clusters qu'un compte peut voir. NULL = tous (GLOBAL / TRANSVERSE).
create or replace function public.aflp_clusters_autorises()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.aflp_authority() in ('GLOBAL','TRANSVERSE') then null
    when public.aflp_authority() = 'ZONE' then (
      select array_agg(c.code) from public.aflp_clusters c
      join public.profils p on p.user_id = auth.uid()
      where c.zone_code = p.zone)
    else (select array[p.cluster] from public.profils p where p.user_id = auth.uid() and p.cluster is not null)
  end;
$$;

create or replace function public.aflp_dans_perimetre(cluster_cible text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.aflp_clusters_autorises() is null then true
    when cluster_cible is null then false
    else cluster_cible = any(public.aflp_clusters_autorises())
  end;
$$;

commit;

-- ============================================================================
-- 4. OPTIONNEL — APPLIQUER LE PÉRIMÈTRE AUX DONNÉES (à valider avant exécution)
-- ----------------------------------------------------------------------------
-- Les politiques RLS actuelles ne connaissent pas le cluster d'un village :
-- il vit dans data->'s1'->>'cluster' (texte saisi). Pour opposer réellement le
-- périmètre côté serveur — et pas seulement dans l'application — il faut une
-- colonne normalisée sur villages, alimentée par trigger, puis une politique.
--
-- À exécuter SÉPARÉMENT, après relecture, et après avoir vérifié qu'aucun
-- cluster de fiche ne reste orphelin (l'écran Administration les signale).
--
--   alter table public.villages add column if not exists cluster_code text
--     references public.aflp_clusters(code) on update cascade;
--
--   create or replace function public.villages_set_cluster_code()
--   returns trigger language plpgsql as $$
--   begin
--     select c.code into new.cluster_code from public.aflp_clusters c
--      where upper(translate(c.libelle,'éèêëàâîïôöûüç','eeeeaaiioouuc'))
--          = upper(translate(coalesce(new.data->'s1'->>'cluster',''),'éèêëàâîïôöûüç','eeeeaaiioouuc'));
--     return new;
--   end $$;
--
--   drop trigger if exists trg_villages_cluster_code on public.villages;
--   create trigger trg_villages_cluster_code before insert or update on public.villages
--     for each row execute function public.villages_set_cluster_code();
--
--   update public.villages set data = data;  -- rejoue le trigger sur l'existant
--
--   drop policy if exists villages_perimetre_ecriture on public.villages;
--   create policy villages_perimetre_ecriture on public.villages
--     for update using (public.aflp_dans_perimetre(cluster_code));
--
-- ============================================================================
-- 5. CONTRÔLES APRÈS APPLICATION
-- ============================================================================
-- select count(*) as zones from public.aflp_zones;                    -- attendu 2
-- select count(*) as clusters from public.aflp_clusters;              -- attendu 6
-- select code, zone_code from public.aflp_clusters order by zone_code, code;
-- select column_name from information_schema.columns
--   where table_name = 'profils' and column_name in
--     ('zone','cluster','village_id','rt_id','authority_level','permissions');
-- select email, role, zone, cluster, authority_level from public.profils order by role;
-- select public.aflp_authority(), public.aflp_clusters_autorises();   -- avec une session réelle

-- ============================================================================
-- 6. RETOUR ARRIÈRE (uniquement sur demande explicite du Branch Manager)
-- ============================================================================
-- begin;
--   alter table public.profils drop constraint if exists profils_zone_cluster_coherents;
--   alter table public.profils drop constraint if exists profils_authority_level_valide;
--   -- Les colonnes de périmètre ne sont PAS supprimées : elles contiennent
--   -- désormais du travail d'administration. Les retirer ferait perdre les
--   -- affectations zone / cluster / village saisies depuis la migration.
--   drop function if exists public.aflp_dans_perimetre(text);
--   drop function if exists public.aflp_clusters_autorises();
--   drop function if exists public.aflp_authority();
-- commit;
