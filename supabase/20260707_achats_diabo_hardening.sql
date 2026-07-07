-- ============================================================================
-- ANAGROCI - DIABO / Achats Terrain hardening
-- Date: 2026-07-07
-- ----------------------------------------------------------------------------
-- Migration non destructive a relire puis executer dans Supabase SQL Editor.
-- Objectifs :
--   1. aligner public.achats.village_id avec public.villages.id (text),
--   2. garantir les colonnes metier attendues par le module Achats Terrain,
--   3. normaliser uniquement les espaces evidents du cluster DIABO,
--   4. produire un rapport des donnees DIABO encore incompletes.
-- ============================================================================

begin;

-- public.villages.id, public.rt.village_id et public.producteurs.village_id sont text.
-- public.achats.village_id doit donc etre text pour conserver la tracabilite village.
alter table public.achats
  alter column village_id type text using village_id::text;

alter table public.achats add column if not exists rt_id text;
alter table public.achats add column if not exists producteur_id text;
alter table public.achats add column if not exists producteur_ref boolean default true;
alter table public.achats add column if not exists recu_photo_url text;
alter table public.achats add column if not exists qualite_statut text default 'A controler';
alter table public.achats add column if not exists statut_validation text default 'A valider';
alter table public.achats add column if not exists validated_by text;
alter table public.achats add column if not exists validated_at timestamptz;
alter table public.achats add column if not exists stock_statut text default 'Entree RT';
alter table public.achats add column if not exists cash_statut text default 'Non reconcilie';
alter table public.achats add column if not exists kor numeric;

create index if not exists achats_date_idx on public.achats (date);
create index if not exists achats_village_idx on public.achats (village_id);
create index if not exists achats_rt_idx on public.achats (rt_nom);

-- Normalisation non destructive : seulement trim du cluster deja identifie comme DIABO.
update public.villages
set data = jsonb_set(data, '{s1,cluster}', to_jsonb(btrim(data #>> '{s1,cluster}')), false),
    updated_at = now()
where deleted = false
  and data #>> '{s1,cluster}' is not null
  and upper(btrim(data #>> '{s1,cluster}')) = 'DIABO'
  and data #>> '{s1,cluster}' <> btrim(data #>> '{s1,cluster}');

commit;

-- Rapport post-migration : villages DIABO encore incomplets.
select
  v.id,
  coalesce(v.village, v.data #>> '{s1,village}') as village,
  v.data #>> '{s1,cluster}' as cluster,
  v.statut,
  coalesce((v.data #>> '{s3,potentielSecuriseMT}')::numeric, 0) as potentiel_securise_mt,
  coalesce((v.data #>> '{s3,potentielMT}')::numeric, 0) as potentiel_total_mt,
  coalesce(rt.cnt, 0) as rt_rattaches,
  coalesce(prod.cnt, 0) as producteurs_references,
  case when coalesce(rt.cnt, 0) = 0 then 'RT manquant' else null end as anomalie_rt,
  case when coalesce(prod.cnt, 0) = 0 then 'Producteurs manquants' else null end as anomalie_producteurs
from public.villages v
left join (
  select village_id, count(*) as cnt
  from public.rt
  where deleted = false
  group by village_id
) rt on rt.village_id = v.id
left join (
  select village_id, count(*) as cnt
  from public.producteurs
  where deleted = false
  group by village_id
) prod on prod.village_id = v.id
where v.deleted = false
  and upper(btrim(coalesce(v.data #>> '{s1,cluster}', ''))) = 'DIABO'
order by
  case upper(coalesce(v.village, v.data #>> '{s1,village}'))
    when 'YOMIEN KOUADIOKRO' then 1
    when 'AGBAKRO' then 2
    when 'ADIEKRO' then 3
    when 'KOUASSI-GOLIKRO' then 4
    else 9
  end,
  village;
