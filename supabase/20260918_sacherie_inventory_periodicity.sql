-- =====================================================================
-- Sacherie AFLP — inventaires periodiques bases sur la DATE du dernier
-- comptage, et non sur l'existence d'un comptage.
--
-- CONSTAT D'AUDIT (18/09/2026)
--   `operations/field-buying.js` calcule le KPI « Inventaires a faire »
--   par `nombre de locations actives - nombre de lignes d'inventaire`.
--   Cette approximation compte 43 au lieu de 44 des qu'un seul
--   emplacement a ete inventorie une fois, il y a six mois.
--
-- PRINCIPE RETENU
--   Une frequence unique, configurable, stockee dans la table de
--   parametres sacherie DEJA EXISTANTE (`rcn_jute_settings`).
--   Les seuils ne sont pas codes independamment : ils derivent de la
--   frequence f.
--       jours < f          -> A JOUR
--       f <= jours < 2f    -> A FAIRE
--       jours >= 2f        -> EN RETARD
--   Avec f = 7 : 0-6 A JOUR, 7-13 A FAIRE, 14+ EN RETARD.
--
--   Une frequence par type d'emplacement est PREVUE mais VIDE au
--   deploiement : aucune valeur metier differenciee n'est inventee.
--   Tant que la table d'override est vide, la frequence globale
--   s'applique partout.
--
-- ROLLBACK : voir le bloc en fin de fichier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Parametre central : reutilisation de la table de settings existante
-- ---------------------------------------------------------------------
alter table public.rcn_jute_settings
  add column if not exists inventory_frequency_days integer not null default 7;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rcn_jute_settings_inventory_frequency_chk') then
    alter table public.rcn_jute_settings
      add constraint rcn_jute_settings_inventory_frequency_chk
      check (inventory_frequency_days between 1 and 90);
  end if;
end $$;

comment on column public.rcn_jute_settings.inventory_frequency_days is
  'Sacherie AFLP : frequence d''inventaire en jours. Les seuils A FAIRE (f) et EN RETARD (2f) en derivent. Modifiable par le Branch Manager.';

-- ---------------------------------------------------------------------
-- 2. Override optionnel par type d'emplacement (vide au deploiement)
-- ---------------------------------------------------------------------
create table if not exists public.rcn_jute_inventory_frequencies (
  scope_type      text primary key,
  frequency_days  integer not null check (frequency_days between 1 and 90),
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

comment on table public.rcn_jute_inventory_frequencies is
  'Sacherie AFLP : frequence d''inventaire specifique a un type d''emplacement (CLUSTER, RT, HUB, PRODUCTEUR, TRANSIT...). Table volontairement vide au deploiement : sans ligne, la frequence globale de rcn_jute_settings s''applique. Aucune valeur metier differenciee ne doit y etre ajoutee sans validation du Branch Manager.';

alter table public.rcn_jute_inventory_frequencies enable row level security;

drop policy if exists rcn_jute_inventory_frequencies_read on public.rcn_jute_inventory_frequencies;
create policy rcn_jute_inventory_frequencies_read
  on public.rcn_jute_inventory_frequencies for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists rcn_jute_inventory_frequencies_write on public.rcn_jute_inventory_frequencies;
create policy rcn_jute_inventory_frequencies_write
  on public.rcn_jute_inventory_frequencies for all to authenticated
  using ((select public.est_bm())) with check ((select public.est_bm()));

-- ---------------------------------------------------------------------
-- 3. Perimetre de lecture : une seule definition, partagee
-- ---------------------------------------------------------------------
-- Reproduit A L'IDENTIQUE la regle de lecture de
-- `public.sacherie_ct_assert_location_access(p_location, false)`.
-- Aucun elargissement de droit n'est introduit par cette migration.
create or replace function private.sacherie_ct_perimetre()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce(
    (select jsonb_build_object(
       'bm',       p.role = 'Branch Manager',
       'autorise', p.role = 'Branch Manager'
                   or coalesce(p.fonction_operationnelle,'') in
                      ('Zonal Head','Unit Head','Assistant Unit Head','Warehouse Keeper','Logistics Coordinator'),
       'cluster',  p.cluster)
     from public.profils p
     where p.user_id = (select auth.uid()) and p.actif = true
     limit 1),
    jsonb_build_object('bm', false, 'autorise', false, 'cluster', null));
$fn$;

comment on function private.sacherie_ct_perimetre() is
  'Sacherie AFLP : perimetre de LECTURE de l''utilisateur courant, strictement identique a sacherie_ct_assert_location_access(..., false). Ne jamais elargir ici sans migration dediee.';

-- ---------------------------------------------------------------------
-- 4. Etat d'inventaire de chaque emplacement actif
-- ---------------------------------------------------------------------
-- `p_pertinents_seulement` : par defaut la fonction ne remonte que les
-- emplacements A ENJEU, c'est-a-dire ceux qui portent du stock, ceux qui
-- ont deja ete comptes au moins une fois, et ceux qui portent un HOLD.
-- Sans ce filtre la liste contient les 20 emplacements d'acteurs LBA a
-- zero sac, qui noieraient le signal sans jamais rien exiger du terrain.
-- Ce n'est pas une regle metier inventee : c'est le perimetre de ce qui
-- est comptable. Passer `false` pour obtenir les emplacements actifs.
create or replace function public.sacherie_ct_inventaires_dus(
  p_scope text default null,
  p_code  text default null,
  p_pertinents_seulement boolean default true
)
returns table (
  location_code      text,
  nom                text,
  scope_type         text,
  cluster            text,
  dernier_inventaire timestamptz,
  jours_ecoules      integer,
  frequence_jours    integer,
  prochaine_echeance date,
  statut             text,
  ecart_dernier      integer,
  hold               boolean,
  stock_utilisable   integer
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_per      jsonb := private.sacherie_ct_perimetre();
  v_freq_g   integer;
  v_cluster  text := nullif(v_per->>'cluster','');
  v_bm       boolean := coalesce((v_per->>'bm')::boolean,false);
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise'; end if;
  if not coalesce((v_per->>'autorise')::boolean,false) then
    -- Pas de fuite d'information : ensemble vide, pas d'erreur bavarde.
    return;
  end if;

  select s.inventory_frequency_days into v_freq_g
  from public.rcn_jute_settings s where s.id = 'DEFAULT' limit 1;
  v_freq_g := coalesce(v_freq_g, 7);

  return query
  with loc as (
    select l.code, l.nom, coalesce(l.scope_type, l.type) as scope_type, l.cluster
    from public.rcn_jute_locations l
    where l.actif = true
      and (p_scope is null or upper(coalesce(l.scope_type, l.type)) = upper(p_scope))
      and (p_code  is null or l.code = p_code)
      and (v_bm or v_cluster is null or l.cluster is null
           or upper(l.cluster) = upper(v_cluster))
  ),
  -- Reutilise la vue existante : aucun second moteur d'inventaire.
  inv as (
    select i.location_code,
           max(i.counted_at) as dernier,
           bool_or(i.reconciliation_status = 'HOLD') as hold
    from public.sacherie_ct_latest_inventory i
    group by i.location_code
  ),
  dernier_detail as (
    select distinct on (i.location_code)
           i.location_code,
           coalesce(i.difference_qty, i.counted_qty - i.theoretical_qty) as ecart
    from public.sacherie_ct_latest_inventory i
    order by i.location_code, i.counted_at desc, i.id desc
  ),
  stock as (
    select v.location_code, sum(v.qty)::integer as qty
    from public.rcn_jute_v_stock v
    where v.state = 'UTILISABLE'
    group by v.location_code
  ),
  base as (
    select loc.code, loc.nom, loc.scope_type, loc.cluster,
           inv.dernier,
           coalesce(f.frequency_days, v_freq_g) as freq,
           coalesce(inv.hold,false) as hold,
           d.ecart,
           coalesce(stock.qty,0) as stock_utilisable
    from loc
    left join inv on inv.location_code = loc.code
    left join dernier_detail d on d.location_code = loc.code
    left join stock on stock.location_code = loc.code
    left join public.rcn_jute_inventory_frequencies f
      on upper(f.scope_type) = upper(loc.scope_type)
  )
  select b.code,
         b.nom,
         b.scope_type,
         b.cluster,
         b.dernier,
         case when b.dernier is null then null
              else floor(extract(epoch from (now() - b.dernier)) / 86400)::integer end,
         b.freq,
         case when b.dernier is null then null
              else (b.dernier + make_interval(days => b.freq))::date end,
         case
           when b.dernier is null then 'JAMAIS_INVENTORIE'
           when extract(epoch from (now() - b.dernier)) / 86400 <  b.freq       then 'A_JOUR'
           when extract(epoch from (now() - b.dernier)) / 86400 <  b.freq * 2   then 'A_FAIRE'
           else 'EN_RETARD'
         end,
         b.ecart,
         b.hold,
         b.stock_utilisable
  from base b
  where p_pertinents_seulement is not true
     or b.stock_utilisable <> 0
     or b.dernier is not null
     or b.hold
  order by
    case
      when b.dernier is null then 1
      when extract(epoch from (now() - b.dernier)) / 86400 >= b.freq * 2 then 0
      when extract(epoch from (now() - b.dernier)) / 86400 >= b.freq then 2
      else 3
    end,
    b.dernier nulls first,
    b.code;
end
$fn$;

comment on function public.sacherie_ct_inventaires_dus(text, text, boolean) is
  'Sacherie AFLP : pour chaque emplacement actif du perimetre de l''utilisateur, date du dernier comptage, anciennete, frequence applicable, prochaine echeance, statut (JAMAIS_INVENTORIE / A_JOUR / A_FAIRE / EN_RETARD), ecart du dernier comptage et presence d''un HOLD. Repond a la question : quels emplacements doivent etre inventories aujourd''hui ?';

-- Le defaut PostgreSQL accorde EXECUTE a public ; on le retire puis on
-- donne explicitement, pour que le droit soit lisible dans le catalogue.
revoke all on function public.sacherie_ct_inventaires_dus(text, text, boolean) from public;
grant execute on function public.sacherie_ct_inventaires_dus(text, text, boolean) to authenticated;

revoke all on function private.sacherie_ct_perimetre() from public, anon, authenticated;

commit;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- begin;
--   drop function if exists public.sacherie_ct_inventaires_dus(text, text, boolean);
--   drop function if exists private.sacherie_ct_perimetre();
--   drop table if exists public.rcn_jute_inventory_frequencies;
--   alter table public.rcn_jute_settings drop constraint if exists rcn_jute_settings_inventory_frequency_chk;
--   alter table public.rcn_jute_settings drop column if exists inventory_frequency_days;
-- commit;
-- Effet du rollback : le KPI redevient l'approximation historique.
-- Aucun mouvement ni inventaire n'est touche.
