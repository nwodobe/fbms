-- ============================================================================
-- ANAGROCI — Ajout des RT candidats : YOMIEN KOUADIOKRO & AGBAKRO
-- ----------------------------------------------------------------------------
-- À exécuter dans Supabase → SQL Editor. Insère les RT au format attendu par
-- l'app (id "rt_...", data JSON complet), rattachés au village par nom.
-- Idempotent : n'insère pas si un RT avec le même téléphone existe déjà.
-- ============================================================================
with vill as (
  select id as vid,
         coalesce(nullif(village,''), data->'s1'->>'village')  as vnom,
         coalesce(nullif(cluster,''), data->'s1'->>'cluster')  as vcluster,
         upper(regexp_replace(coalesce(nullif(village,''), data->'s1'->>'village',''),'[^a-zA-Z0-9]','','g')) as vkey
  from public.villages where deleted = false
),
src(vkey, vlabel, nom, telephone, activite, instruction, reputation, smart, banque, wave) as (
  values
   ('YOMIENKOUADIOKRO','YOMIEN KOUADIOKRO','N''GORAN KONAN DIEUDONNÉ','0170418242','PRODUCTEUR','Primaire','Excellente', true,  false, true),
   ('YOMIENKOUADIOKRO','YOMIEN KOUADIOKRO','KOUAKOU LOUKOU ANICET',   '0172975255','PRODUCTEUR','Primaire','Bonne',      false, false, false),
   ('AGBAKRO',         'AGBAKRO',          'KOFFI KOUADIO',           '0757123632','PRODUCTEUR','Primaire','Bonne',      false, false, false)
),
prep as (
  select ('rt_'||(extract(epoch from clock_timestamp())*1000)::bigint||'_'||(1000+floor(random()*9000))::int) as rid,
         s.*, v.vid, v.vnom, v.vcluster
  from src s left join vill v on v.vkey = s.vkey
)
insert into public.rt (id, nom, telephone, village_nom, cluster, statut, score, deleted, data)
select p.rid, p.nom, p.telephone, coalesce(p.vnom, p.vlabel), p.vcluster, 'Pressenti', 50, false,
  jsonb_strip_nulls(jsonb_build_object(
    'id', p.rid, 'nom', p.nom, 'telephone', p.telephone,
    'activite', p.activite, 'instruction', p.instruction, 'reputation', p.reputation,
    'smartphone', p.smart, 'compteBancaire', p.banque, 'compteWave', p.wave,
    'villageId', p.vid::text, 'villageNom', coalesce(p.vnom, p.vlabel), 'cluster', p.vcluster,
    'statut', 'Pressenti', 'score', 50
  ))
from prep p
where not exists (
  select 1 from public.rt x where x.deleted = false
    and regexp_replace(coalesce(x.telephone, x.data->>'telephone',''),'[^0-9]','','g')
      = regexp_replace(p.telephone,'[^0-9]','','g')
);

-- Vérification :
-- select nom, telephone, village_nom, cluster, statut from public.rt
-- where telephone in ('0170418242','0172975255','0757123632');
-- ============================================================================
