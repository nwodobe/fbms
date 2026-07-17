-- ============================================================================
--  RCN TRACE — ETL & BI (supabase/rcntrace_etl.sql)
--  ----------------------------------------------------------------------------
--  Déplie le magasin opérationnel rcn_state (agrégats JSONB écrits par l'app)
--  vers le modèle analytique normalisé (§10), puis expose des vues BI qui
--  répondent aux indicateurs de maîtrise du métier (§14).
--
--    A) rcn_v_*        : vues « source » — dépliage JSONB → colonnes (live).
--    B) rcn_etl_refresh(): matérialise les rcn_v_* dans les tables physiques
--                          rcn_* (truncate + insert, ordre FK-safe).
--    C) rcn_bi_*       : vues d'indicateurs (délais, stock, rendement, écarts,
--                          pertes, bilan) — toujours fraîches depuis rcn_state.
--
--  À exécuter APRÈS rcntrace.sql (tables + fonctions rcn_est_actif/rcn_est_bm).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. VUES SOURCE — dépliage de rcn_state
-- ----------------------------------------------------------------------------

-- Réceptions ----------------------------------------------------------------
create or replace view rcn_v_receptions as
select
  p->>'id'                          as id,
  p->>'camion'                      as camion,
  p->>'fournisseur'                 as fournisseur,
  p->>'origine'                     as origine,
  (p->>'arriveeAt')::timestamptz    as arrivee_at,
  (p->>'poidsAnnonce')::numeric     as poids_annonce,
  (p->>'sacsAnnonce')::int          as sacs_annonce,
  p->>'refDoc'                      as ref_doc,
  p->>'etat'                        as etat,
  p->>'lotId'                       as lot_id,
  (p->>'createdAt')::timestamptz    as created_at
from (select payload p from rcn_state where kind = 'reception') r;

-- Contrôles qualité (sampling + analyse finale, deux enregistrements) --------
create or replace view rcn_v_qualites as
with r as (select payload p from rcn_state where kind = 'reception')
select
  (p->'sampling'->>'id')                     as id,
  (p->>'id')                                 as reception_id,
  (p->>'lotId')                              as lot_id,
  'sampling'                                 as type,
  (p->'sampling'->>'gk')::numeric            as gk_g,
  (p->'sampling'->>'imm')::numeric           as imm_g,
  (p->'sampling'->>'spotted')::numeric       as spotted_g,
  (p->'sampling'->>'nc')::int                as nc_count,
  (p->'sampling'->>'humidity')::numeric      as humidity_pct,
  (p->'sampling'->>'browns')::numeric        as browns_g,
  (p->'sampling'->>'voids')::numeric         as voids_g,
  (p->'sampling'->>'oil')::numeric           as oil_g,
  (p->'sampling'->>'totalDefect')::numeric   as total_defect_g,
  (p->'sampling'->>'totalKernels')::numeric  as total_kernels_g,
  (p->'sampling'->>'kor')::numeric           as kor_exact,
  (p->'sampling'->>'korDisplay')::numeric    as kor_display,
  (p->'sampling'->>'formula')                as kor_formula,
  (p->'sampling'->>'formulaVersion')         as kor_formula_version,
  null::numeric                              as ecart_kor,
  null::boolean                              as conforme,
  (p->'sampling'->>'analyste')               as analyste,
  (p->'sampling'->>'at')::timestamptz        as created_at
from r where coalesce(p->'sampling','null'::jsonb) <> 'null'::jsonb
union all
select
  (p->'finale'->>'id'), (p->>'id'), (p->>'lotId'), 'final',
  (p->'finale'->>'gk')::numeric, (p->'finale'->>'imm')::numeric, (p->'finale'->>'spotted')::numeric,
  (p->'finale'->>'nc')::int, (p->'finale'->>'humidity')::numeric,
  (p->'finale'->>'browns')::numeric, (p->'finale'->>'voids')::numeric, (p->'finale'->>'oil')::numeric,
  (p->'finale'->>'totalDefect')::numeric, (p->'finale'->>'totalKernels')::numeric,
  (p->'finale'->>'kor')::numeric, (p->'finale'->>'korDisplay')::numeric,
  (p->'finale'->>'formula'), (p->'finale'->>'formulaVersion'),
  (p->'finale'->>'ecart')::numeric, (p->'finale'->>'conforme')::boolean,
  (p->'finale'->>'analyste'), (p->'finale'->>'at')::timestamptz
from r where coalesce(p->'finale','null'::jsonb) <> 'null'::jsonb;

-- Décisions GM --------------------------------------------------------------
create or replace view rcn_v_decisions_gm as
select
  p->>'id'                              as reception_id,
  (p->'gm'->>'autorise')::boolean       as autorise,
  (p->'gm'->>'commentaire')             as commentaire,
  (p->'gm'->>'delegataire')             as delegataire,
  (p->'gm'->>'at')::timestamptz         as decide_at
from (select payload p from rcn_state where kind = 'reception') r
where coalesce(p->'gm','null'::jsonb) <> 'null'::jsonb;

-- Déchargements -------------------------------------------------------------
create or replace view rcn_v_dechargements as
select
  p->>'id'                                    as reception_id,
  (p->'dechargement'->>'bordereau')           as bordereau,
  (p->'dechargement'->>'ticket')              as ticket,
  (p->'dechargement'->>'sacs')::int           as sacs,
  (p->'dechargement'->>'brut')::numeric       as poids_brut,
  (p->'dechargement'->>'tare')::numeric       as poids_tare,
  (p->'dechargement'->>'net')::numeric        as poids_net,
  (p->'dechargement'->>'poidsMainDoeuvre')::numeric as poids_main_doeuvre,
  (p->'dechargement'->>'prestataire')         as prestataire,
  (p->'dechargement'->>'destination')         as destination,
  (p->'dechargement'->>'at')::timestamptz     as created_at
from (select payload p from rcn_state where kind = 'reception') r
where coalesce(p->'dechargement','null'::jsonb) <> 'null'::jsonb;

-- Lots officiels ------------------------------------------------------------
create or replace view rcn_v_lots as
select
  p->>'id'                          as id,
  p->>'recId'                       as reception_id,
  p->>'fournisseur'                 as fournisseur,
  p->>'origine'                     as origine,
  (p->>'korSampling')::numeric      as kor_sampling,
  (p->>'korFinal')::numeric         as kor_final,
  (p->>'ecart')::numeric            as ecart_kor,
  (p->>'netInitial')::numeric       as net_initial,
  (p->>'stock')::numeric            as stock_kg,
  p->>'binId'                       as bin_id,
  p->>'etat'                        as etat,
  (p->>'createdAt')::timestamptz    as created_at
from (select payload p from rcn_state where kind = 'lot') r;

-- Cycles de BIN (stock physique recalculé depuis les contributeurs) ----------
create or replace view rcn_v_bin_cycles as
select
  p->>'id'                          as id,
  p->>'binId'                       as bin_id,
  p->>'qualiteAutorisee'            as qualite_autorisee,
  (p->>'capaciteKg')::numeric       as capacite_kg,
  coalesce((select sum((c->>'entree')::numeric - (c->>'sorti')::numeric)
            from jsonb_array_elements(coalesce(p->'contributors','[]'::jsonb)) c), 0) as stock_physique_kg,
  (p->>'residuKg')::numeric         as residu_kg,
  p->>'etat'                        as etat,
  (p->>'openedAt')::timestamptz     as opened_at,
  (p->>'closedAt')::timestamptz     as closed_at
from (select payload p from rcn_state where kind = 'binCycle') r;

-- Contributeurs de BIN ------------------------------------------------------
create or replace view rcn_v_bin_contributeurs as
select
  p->>'id'                          as cycle_id,
  c->>'lotId'                       as lot_id,
  (c->>'entree')::numeric           as entree_kg,
  (c->>'sorti')::numeric            as sorti_kg
from (select payload p from rcn_state where kind = 'binCycle') r
cross join lateral jsonb_array_elements(coalesce(p->'contributors','[]'::jsonb)) c;

-- Transferts ----------------------------------------------------------------
create or replace view rcn_v_transferts as
select
  p->>'id'                          as id,
  p->>'cycleId'                     as cycle_id,
  p->>'binId'                       as bin_id,
  p->>'destination'                 as destination,
  (p->>'poidsEnvoye')::numeric      as poids_envoye,
  (p->>'poidsRecu')::numeric        as poids_recu,
  (p->>'ecart')::numeric            as ecart_kg,
  p->>'ecartMotif'                  as ecart_motif,
  p->>'etat'                        as etat,
  p->'validations'->'entrepot'      as val_entrepot,
  p->'validations'->'qa'            as val_qa,
  p->'validations'->'calibrage'     as val_calibrage,
  (p->>'createdAt')::timestamptz    as created_at
from (select payload p from rcn_state where kind = 'transfer') r;

-- Contributeurs du transfert ------------------------------------------------
create or replace view rcn_v_transfert_contributeurs as
select
  p->>'id'                          as trf_id,
  c->>'lotId'                       as lot_id,
  (c->>'share')::numeric            as part_pct,
  (c->>'qty')::numeric              as qty_kg,
  c->>'qualite'                     as qualite
from (select payload p from rcn_state where kind = 'transfer') r
cross join lateral jsonb_array_elements(coalesce(p->'contributors','[]'::jsonb)) c;

-- Calibrages ----------------------------------------------------------------
create or replace view rcn_v_calibrages as
select
  p->>'id'                          as id,
  p->>'trfId'                       as trf_id,
  p->>'machine'                     as machine,
  p->>'shift'                       as shift,
  p->>'equipe'                      as equipe,
  (p->>'recu')::numeric             as recu_kg,
  (p->>'entreeMachine')::numeric    as entree_machine_kg,
  p->>'etat'                        as etat,
  (p->>'startedAt')::timestamptz    as started_at,
  (p->>'endedAt')::timestamptz      as ended_at,
  p->>'clotureMotif'                as cloture_motif,
  (p->>'createdAt')::timestamptz    as created_at
from (select payload p from rcn_state where kind = 'cal') r;

-- Sorties par calibre -------------------------------------------------------
create or replace view rcn_v_cal_sorties as
select
  o->>'id'                          as id,
  p->>'id'                          as cal_id,
  o->>'calibre'                     as calibre,
  (o->>'sacs')::int                 as sacs,
  (o->>'poids')::numeric            as poids_kg,
  o->>'binDest'                     as bin_dest,
  (o->>'at')::timestamptz           as created_at
from (select payload p from rcn_state where kind = 'cal') r
cross join lateral jsonb_array_elements(coalesce(p->'outputs','[]'::jsonb)) o;

-- Rejets / pertes / résidus -------------------------------------------------
create or replace view rcn_v_cal_pertes as
select
  p->>'id'                          as cal_id,
  l->>'code'                        as categorie,
  (l->>'poids')::numeric            as poids_kg,
  l->>'destination'                 as destination,
  l->>'justification'               as justification,
  (l->>'at')::timestamptz           as created_at
from (select payload p from rcn_state where kind = 'cal') r
cross join lateral jsonb_array_elements(coalesce(p->'losses','[]'::jsonb)) l;

-- Arrêts machine ------------------------------------------------------------
create or replace view rcn_v_cal_arrets as
select
  p->>'id'                          as cal_id,
  s->>'motif'                       as motif,
  s->>'commentaire'                 as commentaire,
  s->>'maintenance'                 as maintenance,
  (s->>'startAt')::timestamptz      as start_at,
  (s->>'endAt')::timestamptz        as end_at
from (select payload p from rcn_state where kind = 'cal') r
cross join lateral jsonb_array_elements(coalesce(p->'stops','[]'::jsonb)) s;

-- Alimentations machine -----------------------------------------------------
create or replace view rcn_v_cal_alimentations as
select
  p->>'id'                          as cal_id,
  (f->>'qty')::numeric              as poids_kg,
  f->>'binSource'                   as bin_source,
  (f->>'at')::timestamptz           as created_at
from (select payload p from rcn_state where kind = 'cal') r
cross join lateral jsonb_array_elements(coalesce(p->'feeds','[]'::jsonb)) f;

-- Mouvements (issus du singleton meta) --------------------------------------
create or replace view rcn_v_mouvements as
select
  m->>'id'                          as id,
  m->>'type'                        as type,
  m->>'cycleId'                     as cycle_id,
  m->>'binId'                       as bin_id,
  m->>'lotId'                       as lot_id,
  m->>'trfId'                       as trf_id,
  (m->>'qty')::numeric              as qty_kg,
  (m->>'at')::timestamptz           as created_at
from (select payload p from rcn_state where kind = 'meta') r
cross join lateral jsonb_array_elements(coalesce(p->'movements','[]'::jsonb)) m;

-- Généalogie (chaîne lot → BIN/TRF → CAL → sortie) --------------------------
create or replace view rcn_v_genealogie as
-- lot → BIN / TRF (enfants matière du lot)
select 'lot' as parent_type, p->>'id' as parent_id,
       case when ch->>'type' = 'bin' then 'binCycle' else 'transfer' end as enfant_type,
       ch->>'ref' as enfant_id, (ch->>'qty')::numeric as qty_kg, null::numeric as part_pct
from (select payload p from rcn_state where kind = 'lot') r
cross join lateral jsonb_array_elements(coalesce(p->'children','[]'::jsonb)) ch
union all
-- transfert → calibrage
select 'transfer', p->>'trfId', 'calibrage', p->>'id', (p->>'recu')::numeric, null::numeric
from (select payload p from rcn_state where kind = 'cal') r
union all
-- calibrage → sortie calibrée
select 'calibrage', p->>'id', 'sortie', o->>'id', (o->>'poids')::numeric, null::numeric
from (select payload p from rcn_state where kind = 'cal') r
cross join lateral jsonb_array_elements(coalesce(p->'outputs','[]'::jsonb)) o;

-- ----------------------------------------------------------------------------
-- B. ETL — matérialise les vues source dans les tables normalisées
--    Full refresh idempotent (truncate + insert, ordre FK-safe). Réservé aux
--    profils actifs. Filtre les orphelins pour ne jamais violer les FK.
-- ----------------------------------------------------------------------------
create or replace function rcn_etl_refresh() returns text
language plpgsql security definer set search_path = public as $$
declare n_rec int; n_lot int; n_cal int;
begin
  if not rcn_est_actif() then raise exception 'Accès refusé : profil non actif.'; end if;

  truncate table
    rcn_genealogie, rcn_mouvements, rcn_cal_alimentations, rcn_cal_arrets,
    rcn_cal_pertes, rcn_cal_sorties, rcn_calibrages, rcn_transfert_contributeurs,
    rcn_transferts, rcn_bin_contributeurs, rcn_bin_cycles, rcn_lots,
    rcn_dechargements, rcn_decisions_gm, rcn_qualites, rcn_receptions
    restart identity;

  insert into rcn_receptions (id,camion,fournisseur,origine,arrivee_at,poids_annonce,sacs_annonce,ref_doc,etat,lot_id,created_at)
    select id,camion,fournisseur,origine,arrivee_at,poids_annonce,sacs_annonce,ref_doc,etat,lot_id,created_at from rcn_v_receptions;

  insert into rcn_qualites (id,reception_id,lot_id,type,gk_g,imm_g,spotted_g,nc_count,humidity_pct,browns_g,voids_g,oil_g,total_defect_g,total_kernels_g,kor_exact,kor_display,kor_formula,kor_formula_version,ecart_kor,conforme,analyste,created_at)
    select id,reception_id,lot_id,type,gk_g,imm_g,spotted_g,nc_count,humidity_pct,browns_g,voids_g,oil_g,total_defect_g,total_kernels_g,kor_exact,kor_display,kor_formula,kor_formula_version,ecart_kor,conforme,analyste,created_at
    from rcn_v_qualites where id is not null;

  insert into rcn_decisions_gm (reception_id,autorise,commentaire,delegataire,decide_at)
    select reception_id,autorise,commentaire,delegataire,decide_at from rcn_v_decisions_gm;

  insert into rcn_dechargements (reception_id,bordereau,ticket,sacs,poids_brut,poids_tare,poids_net,poids_main_doeuvre,prestataire,destination,created_at)
    select reception_id,bordereau,ticket,sacs,poids_brut,poids_tare,poids_net,poids_main_doeuvre,prestataire,destination,created_at from rcn_v_dechargements;

  insert into rcn_lots (id,reception_id,fournisseur,origine,kor_sampling,kor_final,ecart_kor,net_initial,stock_kg,bin_id,etat,created_at)
    select id,reception_id,fournisseur,origine,kor_sampling,kor_final,ecart_kor,net_initial,stock_kg,bin_id,etat,created_at from rcn_v_lots;

  insert into rcn_bin_cycles (id,bin_id,qualite_autorisee,capacite_kg,stock_physique_kg,residu_kg,etat,opened_at,closed_at)
    select id,bin_id,qualite_autorisee,capacite_kg,stock_physique_kg,residu_kg,etat,opened_at,closed_at from rcn_v_bin_cycles;

  insert into rcn_bin_contributeurs (cycle_id,lot_id,entree_kg,sorti_kg)
    select v.cycle_id,v.lot_id,v.entree_kg,v.sorti_kg from rcn_v_bin_contributeurs v
    where v.cycle_id in (select id from rcn_bin_cycles) and v.lot_id in (select id from rcn_lots);

  insert into rcn_transferts (id,cycle_id,bin_id,destination,poids_envoye,poids_recu,ecart_kg,ecart_motif,etat,val_entrepot,val_qa,val_calibrage,created_at)
    select id, case when cycle_id in (select id from rcn_bin_cycles) then cycle_id end,
           bin_id,destination,poids_envoye,poids_recu,ecart_kg,ecart_motif,etat,val_entrepot,val_qa,val_calibrage,created_at
    from rcn_v_transferts;

  insert into rcn_transfert_contributeurs (trf_id,lot_id,part_pct,qty_kg,qualite)
    select v.trf_id, case when v.lot_id in (select id from rcn_lots) then v.lot_id end, v.part_pct,v.qty_kg,v.qualite
    from rcn_v_transfert_contributeurs v where v.trf_id in (select id from rcn_transferts);

  insert into rcn_calibrages (id,trf_id,machine,shift,equipe,recu_kg,entree_machine_kg,etat,started_at,ended_at,cloture_motif,created_at)
    select id, case when trf_id in (select id from rcn_transferts) then trf_id end,
           machine,shift,equipe,recu_kg,entree_machine_kg,etat,started_at,ended_at,cloture_motif,created_at
    from rcn_v_calibrages;

  insert into rcn_cal_sorties (id,cal_id,calibre,sacs,poids_kg,bin_dest,created_at)
    select id,cal_id,calibre,sacs,poids_kg,bin_dest,created_at from rcn_v_cal_sorties where cal_id in (select id from rcn_calibrages);

  insert into rcn_cal_pertes (cal_id,categorie,poids_kg,destination,justification,created_at)
    select cal_id,categorie,poids_kg,destination,justification,created_at from rcn_v_cal_pertes where cal_id in (select id from rcn_calibrages);

  insert into rcn_cal_arrets (cal_id,motif,commentaire,maintenance,start_at,end_at)
    select cal_id,motif,commentaire,maintenance,start_at,end_at from rcn_v_cal_arrets where cal_id in (select id from rcn_calibrages);

  insert into rcn_cal_alimentations (cal_id,poids_kg,bin_source,created_at)
    select cal_id,poids_kg,bin_source,created_at from rcn_v_cal_alimentations where cal_id in (select id from rcn_calibrages);

  insert into rcn_mouvements (id,type,cycle_id,bin_id,lot_id,trf_id,qty_kg,created_at)
    select id,type, case when cycle_id in (select id from rcn_bin_cycles) then cycle_id end,
           bin_id,lot_id,trf_id,qty_kg,created_at
    from rcn_v_mouvements where id is not null;

  insert into rcn_genealogie (parent_type,parent_id,enfant_type,enfant_id,qty_kg,part_pct)
    select parent_type,parent_id,enfant_type,enfant_id,qty_kg,part_pct from rcn_v_genealogie;

  select count(*) into n_rec from rcn_receptions;
  select count(*) into n_lot from rcn_lots;
  select count(*) into n_cal from rcn_calibrages;
  return 'RCN ETL OK — ' || n_rec || ' réceptions · ' || n_lot || ' lots · ' || n_cal || ' calibrages matérialisés le ' || now()::text;
end $$;

revoke all on function rcn_etl_refresh() from anon;

-- ----------------------------------------------------------------------------
-- C. VUES BI — indicateurs de maîtrise du métier (§14.2), toujours fraîches
-- ----------------------------------------------------------------------------

-- Cohérence des KOR sampling / final ---------------------------------------
create or replace view rcn_bi_kor as
select r.id as reception_id, r.fournisseur, r.etat,
       s.kor_display as kor_sampling, f.kor_display as kor_final,
       f.ecart_kor, f.conforme
from rcn_v_receptions r
left join rcn_v_qualites s on s.reception_id = r.id and s.type = 'sampling'
left join rcn_v_qualites f on f.reception_id = r.id and f.type = 'final';

-- Délais du parcours (en minutes) ------------------------------------------
create or replace view rcn_bi_delais as
select
  p->>'id' as reception_id, p->>'fournisseur' as fournisseur,
  round(extract(epoch from ((p->'sampling'->>'at')::timestamptz - (p->>'arriveeAt')::timestamptz))/60)::int      as delai_arrivee_sampling_min,
  round(extract(epoch from ((p->'gm'->>'at')::timestamptz - (p->'sampling'->>'at')::timestamptz))/60)::int         as delai_sampling_gm_min,
  round(extract(epoch from ((p->'finale'->>'at')::timestamptz - (p->'dechargement'->>'at')::timestamptz))/60)::int as delai_decharge_liberation_min
from (select payload p from rcn_state where kind = 'reception') r;

-- Âge et occupation du stock par BIN ---------------------------------------
create or replace view rcn_bi_stock_bin as
select c.id as cycle_id, c.bin_id, c.etat, c.stock_physique_kg, c.capacite_kg,
       case when c.capacite_kg > 0 then round(c.stock_physique_kg / c.capacite_kg * 100, 1) end as taux_remplissage_pct,
       (select count(*) from rcn_v_bin_contributeurs bc where bc.cycle_id = c.id) as nb_contributeurs,
       round(extract(epoch from (now() - c.opened_at))/3600, 1) as age_heures
from rcn_v_bin_cycles c;

-- Écart de chaque transfert (envoyé vs reçu) -------------------------------
create or replace view rcn_bi_ecart_transfert as
select id as trf_id, bin_id, poids_envoye, poids_recu, ecart_kg, etat, ecart_motif
from rcn_v_transferts;

-- Rendement par calibre (part du reçu) -------------------------------------
create or replace view rcn_bi_rendement_calibre as
select s.cal_id, s.calibre, s.poids_kg,
       c.recu_kg,
       case when c.recu_kg > 0 then round(s.poids_kg / c.recu_kg * 100, 2) end as pct_du_recu
from rcn_v_cal_sorties s
join rcn_v_calibrages c on c.id = s.cal_id;

-- Rendement global par calibre (tous CAL confondus) ------------------------
create or replace view rcn_bi_rendement_calibre_global as
select calibre, sum(poids_kg) as poids_total_kg, count(distinct cal_id) as nb_operations
from rcn_v_cal_sorties group by calibre order by calibre;

-- Pertes et résidus par catégorie ------------------------------------------
create or replace view rcn_bi_pertes as
select categorie, sum(poids_kg) as poids_total_kg, count(distinct cal_id) as nb_operations
from rcn_v_cal_pertes group by categorie order by categorie;

-- Bilan matière par opération de calibrage (reçu = sorties + pertes + résidu)
create or replace view rcn_bi_bilan_cal as
select
  c.id as cal_id, c.machine, c.shift, c.etat, c.recu_kg,
  coalesce((select sum(poids_kg) from rcn_v_cal_sorties s where s.cal_id = c.id), 0) as sorties_kg,
  coalesce((select sum(poids_kg) from rcn_v_cal_pertes  l where l.cal_id = c.id and l.categorie <> 'residu_machine'), 0) as pertes_kg,
  coalesce((select sum(poids_kg) from rcn_v_cal_pertes  l where l.cal_id = c.id and l.categorie =  'residu_machine'), 0) as residu_kg,
  c.recu_kg
    - coalesce((select sum(poids_kg) from rcn_v_cal_sorties s where s.cal_id = c.id), 0)
    - coalesce((select sum(poids_kg) from rcn_v_cal_pertes  l where l.cal_id = c.id), 0) as ecart_kg
from rcn_v_calibrages c;

-- ----------------------------------------------------------------------------
-- D. SÉCURITÉ — vues en security_invoker : la RLS de rcn_state s'applique à
--    travers chaque vue (sinon une vue s'exécute avec les droits du
--    propriétaire et contournerait la RLS). Reporting « live » = choix retenu :
--    toujours frais, zéro maintenance ; rcn_etl_refresh() reste à la demande.
-- ----------------------------------------------------------------------------
do $$
declare v text;
begin
  foreach v in array array[
    'rcn_v_receptions','rcn_v_qualites','rcn_v_decisions_gm','rcn_v_dechargements',
    'rcn_v_lots','rcn_v_bin_cycles','rcn_v_bin_contributeurs','rcn_v_transferts',
    'rcn_v_transfert_contributeurs','rcn_v_calibrages','rcn_v_cal_sorties','rcn_v_cal_pertes',
    'rcn_v_cal_arrets','rcn_v_cal_alimentations','rcn_v_mouvements','rcn_v_genealogie',
    'rcn_bi_kor','rcn_bi_delais','rcn_bi_stock_bin','rcn_bi_ecart_transfert',
    'rcn_bi_rendement_calibre','rcn_bi_rendement_calibre_global','rcn_bi_pertes','rcn_bi_bilan_cal'
  ]
  loop
    execute format('alter view %I set (security_invoker = on);', v);
  end loop;
end $$;

-- Fin ETL & BI RCN TRACE.
