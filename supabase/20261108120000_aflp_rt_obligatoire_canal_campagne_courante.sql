-- =============================================================================
-- AFLP · 08/11/2026 · RT obligatoire et canal sur la campagne courante
-- Demandé et autorisé explicitement par le Branch Manager (mise en production).
--
-- 1. Garde-fou serveur : un producteur en canal direct ne peut plus être créé
--    sans RT, ni perdre son RT, quel que soit le chemin d'écriture (écran, APK
--    hors ligne, ancien module, API). Exemptés : producteurs de coopérative,
--    fiches QA, fiches supprimées. Les fiches historiques déjà sans RT restent
--    modifiables (le contrôle ne vise que la création et le détachement).
--
-- 2. Vue aflp_producer_channel_v : elle lisait la campagne « 2027 » en dur
--    (campagne de simulation). Les affiliations réelles sont sur la campagne
--    courante (« 0002 »), d'où des colonnes Coop Code / Coopérative principale
--    vides à l'export et dans la liste Producteurs. La vue suit désormais la
--    campagne marquée is_current, avec repli sur « 2027 » si aucune ne l'est.
--    Mêmes colonnes, même ordre : aucun écran consommateur n'est cassé.
-- =============================================================================

-- ------------------------------------------------------------- 1. garde-fou RT
create or replace function private.aflp_producteur_rt_obligatoire()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := coalesce(new.data->>'source', '');
  v_coop   boolean;
begin
  if coalesce(new.deleted, false) or coalesce(new.is_qa, false) then
    return new;
  end if;
  if new.rt_id is not null and btrim(new.rt_id) <> '' then
    return new;
  end if;

  -- Upsert d'une fiche existante : le contrôle de mise à jour s'applique.
  if tg_op = 'INSERT' and exists (select 1 from public.producteurs x where x.id = new.id) then
    return new;
  end if;
  -- Mise à jour : seul le détachement d'un RT existant est refusé.
  if tg_op = 'UPDATE' and (old.rt_id is null or btrim(old.rt_id) = '') then
    return new;
  end if;

  -- Producteur de coopérative : suivi par la coopérative, pas par un RT.
  v_coop := v_source ilike '%COOP%'
    or exists (select 1 from public.aflp_producer_enrollment e
               where e.producer_id = new.id and e.enrollment_channel = 'COOPERATIVE')
    or exists (select 1 from public.aflp_coop_memberships m
               where m.producer_id = new.id and m.status <> 'ENDED' and m.membership_end is null);
  if v_coop then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'RT obligatoire : un producteur en canal direct doit être rattaché à un RT de son village.',
    hint    = 'Choisissez le RT référent dans la fiche producteur. Si le village n''a pas encore de RT, créez-le d''abord.';
end;
$$;

revoke all on function private.aflp_producteur_rt_obligatoire() from public;

drop trigger if exists trg_farmer_registry_rt_obligatoire on public.producteurs;
create trigger trg_farmer_registry_rt_obligatoire
  before insert or update of rt_id, deleted on public.producteurs
  for each row execute function private.aflp_producteur_rt_obligatoire();

comment on function private.aflp_producteur_rt_obligatoire() is
  'AFLP 08/11/2026 : refuse la création ou le détachement d''un producteur direct sans RT. Exempte coopératives, QA et fiches supprimées.';

-- ------------------------------------- 2. canal sur la campagne courante
create or replace view public.aflp_producer_channel_v with (security_invoker = true) as
select p.id as producer_id, p.code as farmer_id, p.nom, p.prenoms, p.village_id, p.village_nom, p.rt_id,
       camp.code as campaign,
       case when pm.id is not null then 'COOPERATIVE' else 'AFLP_DIRECT' end as sourcing_channel,
       pm.cooperative_id as primary_cooperative_id, c.code as primary_cooperative_code, c.name as primary_cooperative_name,
       pm.member_number, pm.section_id, s.name as section_name, pm.verified as membership_verified,
       coalesce(pm.followup_rt_id, p.rt_id) as followup_rt_id,
       coalesce(e.enrollment_channel, case when p.rt_id is not null then 'AFLP_DIRECT' else 'NON_RENSEIGNE' end) as enrollment_channel,
       e.enrolled_cooperative_id,
       (select count(*) from public.aflp_coop_memberships m2 where m2.producer_id = p.id and m2.campaign = camp.code and m2.status <> 'ENDED') as open_memberships,
       (select count(*) from public.aflp_coop_memberships m3 where m3.producer_id = p.id) as membership_history
from public.producteurs p
cross join (
  select coalesce(
    (select k.code from public.campaigns k where k.is_current and not coalesce(k.is_qa, false) order by k.opened_at desc nulls last limit 1),
    '2027') as code
) camp
left join public.aflp_coop_memberships pm on pm.producer_id = p.id and pm.campaign = camp.code and pm.is_primary and pm.status <> 'ENDED'
left join public.aflp_cooperatives c on c.id = pm.cooperative_id
left join public.aflp_coop_sections s on s.id = pm.section_id
left join public.aflp_producer_enrollment e on e.producer_id = p.id
where not p.deleted;

comment on view public.aflp_producer_channel_v is
  'Canal AFLP de chaque producteur sur la campagne courante (campaigns.is_current, repli 2027) : COOPERATIVE si affiliation principale ouverte, sinon AFLP_DIRECT. Corrigé le 08/11/2026 (campagne 2027 en dur).';
