-- Multi-campagnes · 2/3 — rattachement des données de campagne et verrou des campagnes clôturées.
--
-- Principe : chaque table « de campagne » reçoit une colonne campaign_id (UUID, nullable, additive). Un déclencheur
-- unique (private.campaign_stamp) :
--   · à la création, rattache la ligne à sa campagne : campaign_id fourni (cas d'une saisie hors ligne qui a mémorisé
--     sa campagne), sinon campagne de la ligne parente (ex. lot → réception), sinon code texte historique connu,
--     sinon campagne courante ; aucune campagne → refus ;
--   · refuse toute écriture dans une campagne clôturée ou archivée (lecture seule), et les nouvelles opérations dans
--     une campagne en clôture ; une opération ne change jamais de campagne ;
--   · maintient la colonne texte historique (campaign = code) pour les écrans et fonctions existants.
-- Les tables permanentes (producteurs, RT, villages, coopératives, fournisseurs, entrepôts, utilisateurs) ne sont
-- pas concernées.
--
-- Types de tables (registre private.campaign_scoped_tables) :
--   CONFIG          paramétrage de campagne : modifiable de DRAFT à CLOSING ;
--   TRANSACTION     opérations : création en OPEN seulement, correction en OPEN ou CLOSING ;
--   RECONCILIATION  rapprochements, qualité, mouvements : création et correction en OPEN ou CLOSING ;
--   STOCK           lots physiques : création en OPEN ou CLOSING ; le statut physique reste modifiable après
--                   clôture (un stock reporté peut sortir pendant la campagne suivante) ; suppression interdite ;
--   CHILD           lignes filles sans campaign_id, rattachées par leur parent (utilisé par la suppression des
--                   simulations uniquement).

create table if not exists private.campaign_scoped_tables (
  table_name    text primary key,
  kind          text not null check (kind in ('CONFIG','TRANSACTION','RECONCILIATION','STOCK','CHILD')),
  legacy_column text,
  parent_table  text,
  parent_column text,
  purge_rank    int not null,
  predicate     text not null,
  label_fr      text not null
);
revoke all on private.campaign_scoped_tables from public, anon, authenticated;

insert into private.campaign_scoped_tables (table_name, kind, legacy_column, parent_table, parent_column, purge_rank, predicate, label_fr) values
-- Lignes filles : supprimées en premier, via leur parent
('rcn_proc_paiements','CHILD',null,null,null,10,'bon_payer_id in (select b.id from public.rcn_proc_bons_payer b join public.procurement_reception_settlements s on s.id = b.purchase_settlement_id where s.campaign_id = $1)','Paiements de bons à payer'),
('rcn_proc_bons_payer','CHILD',null,null,null,11,'purchase_settlement_id in (select id from public.procurement_reception_settlements where campaign_id = $1)','Bons à payer'),
('aflp_coop_delivery_allocations','CHILD',null,null,null,20,'delivery_id in (select id from public.aflp_coop_deliveries where campaign_id = $1) or membership_id in (select id from public.aflp_coop_memberships where campaign_id = $1)','Allocations producteurs des livraisons coop'),
('aflp_coop_training_attendance','CHILD',null,null,null,21,'training_id in (select id from public.aflp_coop_trainings where campaign_id = $1)','Présences aux formations coop'),
('aflp_bag_cluster_allocations','CHILD',null,null,null,22,'envelope_id in (select id from public.aflp_bag_envelopes where campaign_id = $1)','Allocations de sacs par cluster'),
('field_lot_contributors','CHILD',null,null,null,23,'achat_id in (select id from public.achats where campaign_id = $1) or lot_id in (select id from public.field_lots where campaign_id = $1)','Contributions des achats aux lots terrain'),
('field_purchase_sources','CHILD',null,null,null,24,'achat_id in (select id from public.achats where campaign_id = $1)','Parcelles sources des achats'),
('field_rcn_bags','CHILD',null,null,null,25,'achat_id in (select id from public.achats where campaign_id = $1) or sacherie_movement_id in (select id from public.sacs_mouvements where campaign_id = $1) or lot_id in (select id from public.field_lots where campaign_id = $1)','Sacs RCN terrain'),
('field_shipment_lots','CHILD',null,null,null,26,'shipment_id in (select id from public.field_shipments where campaign_id = $1) or lot_id in (select id from public.field_lots where campaign_id = $1)','Lots des expéditions terrain'),
('field_stock_movements','CHILD',null,null,null,27,'lot_id in (select id from public.field_lots where campaign_id = $1) or shipment_id in (select id from public.field_shipments where campaign_id = $1)','Mouvements de stock terrain'),
('wms_lot_procurement_contributors','CHILD',null,null,null,28,'achat_id in (select id from public.achats where campaign_id = $1) or wms_lot_id in (select id from public.wms_lots where campaign_id = $1)','Contributions des achats aux LOT'),
('wms_movement_lots','CHILD',null,null,null,29,'movement_id in (select id from public.wms_movements where campaign_id = $1) or lot_id in (select id from public.wms_lots where campaign_id = $1)','Lignes LOT des mouvements Warehouse'),
('wms_transfer_lines','CHILD',null,null,null,30,'transfer_id in (select id from public.wms_transfers where campaign_id = $1) or lot_id in (select id from public.wms_lots where campaign_id = $1)','Lignes des transferts'),
('wms_transfer_resolutions','CHILD',null,null,null,31,'transfer_id in (select id from public.wms_transfers where campaign_id = $1) or movement_id in (select id from public.wms_movements where campaign_id = $1)','Résolutions d''écart des transferts'),
('wms_transfer_ops','CHILD',null,null,null,32,'transfer_id in (select id from public.wms_transfers where campaign_id = $1)','Journal d''idempotence des transferts'),
('wms_grns','CHILD',null,null,null,33,'reception_id in (select id from public.wms_receptions where campaign_id = $1) or lot_id in (select id from public.wms_lots where campaign_id = $1)','GRN'),
('wms_reception_documents','CHILD',null,null,null,34,'reception_id in (select id from public.wms_receptions where campaign_id = $1)','Documents de réception'),
('ops_bag_releases','CHILD',null,null,null,35,'request_id in (select id from public.ops_bag_requests where campaign_id = $1) or jute_movement_id in (select id from public.rcn_jute_movements where campaign_id = $1)','Sorties de sacs'),
('procurement_arrival_changes','CHILD',null,null,null,36,'arrival_id in (select id from public.rcn_proc_arrivages where campaign_id = $1)','Historique des arrivées planifiées'),
('farmer_sustainability_answers','CHILD',null,null,null,37,'baseline_id in (select id from public.farmer_sustainability_baselines where campaign_id = $1)','Réponses Sustainability'),
('lba_funding_cycle_deliveries','CHILD',null,null,null,38,'arrival_id in (select id from public.rcn_proc_arrivages where campaign_id = $1) or cycle_id in (select id from public.lba_funding_cycles where campaign_id = $1)','Livraisons des cycles de financement LBA'),
('lba_funding_cycle_financings','CHILD',null,null,null,39,'cycle_id in (select id from public.lba_funding_cycles where campaign_id = $1)','Financements des cycles LBA'),
('aflp_campaign_controls_history','CHILD',null,null,null,40,'campaign = (select code from public.campaigns where id = $1)','Historique des règles de campagne'),
-- Tables de campagne (campaign_id), dans l'ordre des dépendances
('wms_quality_derogations','RECONCILIATION',null,'wms_lots','lot_id',50,'campaign_id = $1','Dérogations qualité'),
('wms_quality_snapshots','RECONCILIATION',null,'wms_receptions','reception_id',51,'campaign_id = $1','Contrôles qualité Warehouse'),
('wms_inventory_counts','RECONCILIATION',null,null,null,52,'campaign_id = $1','Inventaires Warehouse'),
('wms_dryings','RECONCILIATION',null,null,null,53,'campaign_id = $1','Séchages / tri'),
('procurement_rejection_cases','RECONCILIATION',null,'wms_receptions','reception_id',54,'campaign_id = $1','Dossiers de rejet'),
('procurement_reception_settlements','RECONCILIATION','campaign','wms_receptions','reception_id',55,'campaign_id = $1','Règlements Procurement'),
('aflp_coop_deliveries','TRANSACTION','campaign',null,null,56,'campaign_id = $1','Livraisons coopératives'),
('field_shipments','TRANSACTION',null,null,null,57,'campaign_id = $1','Expéditions terrain'),
('achats','TRANSACTION','campaign',null,null,58,'campaign_id = $1','Achats bord champ'),
('sacs_mouvements','TRANSACTION',null,null,null,59,'campaign_id = $1','Mouvements de sacherie'),
('field_lots','TRANSACTION',null,null,null,60,'campaign_id = $1','Lots terrain'),
('wms_transfers','TRANSACTION',null,null,null,61,'campaign_id = $1','Transferts de stock'),
('wms_movements','RECONCILIATION',null,null,null,62,'campaign_id = $1','Mouvements Warehouse'),
('wms_lots','STOCK',null,'wms_receptions','reception_id',63,'campaign_id = $1','LOT'),
('wms_receptions','TRANSACTION',null,null,null,64,'campaign_id = $1','Réceptions Warehouse'),
('lba_funding_cycles','TRANSACTION','campaign',null,null,65,'campaign_id = $1','Cycles de financement LBA'),
('rcn_proc_arrivages','TRANSACTION',null,null,null,66,'campaign_id = $1','Arrivées Procurement'),
('aflp_coop_enrollment_reviews','TRANSACTION','campaign',null,null,67,'campaign_id = $1','Revues d''enrôlement coop'),
('aflp_coop_import_batches','TRANSACTION','campaign',null,null,68,'campaign_id = $1','Imports Excel coop'),
('aflp_coop_trainings','TRANSACTION','campaign',null,null,69,'campaign_id = $1','Formations coop'),
('aflp_coop_memberships','TRANSACTION','campaign',null,null,70,'campaign_id = $1','Affiliations coopérative de la campagne'),
('aflp_coop_campaigns','CONFIG','campaign',null,null,71,'campaign_id = $1','Paramètres annuels des coopératives'),
('aflp_incidents','TRANSACTION','campaign',null,null,72,'campaign_id = $1','Incidents AFLP'),
('aflp_bag_envelopes','CONFIG','campaign',null,null,73,'campaign_id = $1','Enveloppes de sacs'),
('aflp_program_targets','CONFIG','campaign',null,null,74,'campaign_id = $1','Objectifs programme'),
('procurement_campaign_rules','CONFIG','campaign',null,null,75,'campaign_id = $1','Règles prix / qualité'),
('aflp_campaign_controls','CONFIG','campaign',null,null,76,'campaign_id = $1','Règles de contrôle de campagne'),
('ops_bag_requests','TRANSACTION','campaign',null,null,77,'campaign_id = $1','Demandes de sacs'),
('bag_movement_requests','TRANSACTION',null,null,null,78,'campaign_id = $1','Demandes de mouvement de sacs'),
('rcn_jute_movements','TRANSACTION','campaign',null,null,79,'campaign_id = $1','Mouvements de sacs jute'),
('rcn_jute_purchases','TRANSACTION',null,null,null,80,'campaign_id = $1','Achats de sacs jute'),
('rcn_jute_transfers','TRANSACTION',null,null,null,81,'campaign_id = $1','Transferts de sacs jute'),
('rcn_jute_inventories','RECONCILIATION',null,null,null,82,'campaign_id = $1','Inventaires de sacs jute'),
('rcn_jute_reconciliations','RECONCILIATION','campaign',null,null,83,'campaign_id = $1','Rapprochements de sacs jute'),
('rcn_jute_loss_requests','RECONCILIATION',null,null,null,84,'campaign_id = $1','Déclarations de pertes de sacs'),
('rcn_jute_repairs','RECONCILIATION',null,null,null,85,'campaign_id = $1','Réparations de sacs'),
('farmer_production_baselines','TRANSACTION','campaign',null,null,86,'campaign_id = $1','Potentiels de production de la campagne'),
('farmer_sustainability_baselines','TRANSACTION','campaign',null,null,87,'campaign_id = $1','Diagnostics Sustainability de la campagne'),
('avances','TRANSACTION',null,null,null,90,'campaign_id = $1','Avances RT')
on conflict (table_name) do update set kind = excluded.kind, legacy_column = excluded.legacy_column,
  parent_table = excluded.parent_table, parent_column = excluded.parent_column, purge_rank = excluded.purge_rank,
  predicate = excluded.predicate, label_fr = excluded.label_fr;

-- Déclencheur unique de rattachement et de verrou
create or replace function private.campaign_stamp() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  v_kind   text := tg_argv[0];
  v_legacy text := nullif(tg_argv[1], '');
  v_ptab   text := nullif(tg_argv[2], '');
  v_pcol   text := nullif(tg_argv[3], '');
  v_row    jsonb;
  v_code   text;
  v_id     uuid;
  c        public.campaigns;
  v_old    public.campaigns;
begin
  if private.campaign_purge_active() then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    select * into v_old from public.campaigns where id = old.campaign_id;
    if v_old.status in ('CLOSED','ARCHIVED') then
      raise exception 'Campagne % % : lecture seule. Suppression impossible.', v_old.code, lower(private.campaign_status_fr(v_old.status))
        using errcode = '42501';
    end if;
    if v_kind = 'STOCK' then
      raise exception 'Un LOT ne se supprime pas : utilisez un mouvement compensatoire.' using errcode = '42501';
    end if;
    return old;
  end if;

  v_row := to_jsonb(new);

  if tg_op = 'UPDATE' then
    if old.campaign_id is not null and new.campaign_id is distinct from old.campaign_id then
      raise exception 'Une opération ne change pas de campagne.' using errcode = '42501';
    end if;
    if old.campaign_id is null then
      -- Ligne historique non rattachée (« à classifier ») : jamais rattachée silencieusement par une mise à jour.
      return new;
    end if;
    select * into c from public.campaigns where id = old.campaign_id;
    if c.status in ('CLOSED','ARCHIVED') and v_kind <> 'STOCK' then
      raise exception 'Campagne % clôturée : lecture seule. Une réouverture exceptionnelle par le General Manager est nécessaire pour corriger cette donnée.', c.code
        using errcode = '42501';
    end if;
    if v_kind = 'TRANSACTION' and c.status not in ('OPEN','CLOSING') then
      raise exception 'Campagne % non ouverte (%) : opération non modifiable.', c.code, private.campaign_status_fr(c.status) using errcode = '42501';
    end if;
    if v_legacy is not null and (v_row->>v_legacy) is distinct from c.code then
      new := jsonb_populate_record(new, jsonb_build_object(v_legacy, c.code));
    end if;
    return new;
  end if;

  -- INSERT : résolution de la campagne
  v_id := new.campaign_id;
  if v_id is null and v_ptab is not null and (v_row->>v_pcol) is not null then
    execute format('select campaign_id from public.%I where id::text = $1', v_ptab) into v_id using v_row->>v_pcol;
  end if;
  if v_id is null and v_legacy is not null then
    v_code := nullif(btrim(v_row->>v_legacy), '');
    if v_code is not null then v_id := private.campaign_by_code(v_code); end if;
  end if;
  if v_id is null then v_id := private.campaign_current_id(); end if;
  if v_id is null then
    raise exception 'Aucune campagne courante : ouvrez une campagne dans Administration → Campagnes avant d''enregistrer une opération.'
      using errcode = '23514';
  end if;

  select * into c from public.campaigns where id = v_id;
  if not found then raise exception 'Campagne inconnue.' using errcode = '23503'; end if;

  if v_kind = 'CONFIG' and c.status in ('CLOSED','ARCHIVED') then
    raise exception 'Campagne % % : paramétrage en lecture seule.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  elsif v_kind = 'TRANSACTION' and c.status <> 'OPEN' then
    raise exception 'Campagne % % : aucune nouvelle opération ne peut y être enregistrée.%', c.code, lower(private.campaign_status_fr(c.status)),
      case when c.status in ('CLOSING','CLOSED','ARCHIVED') and c.id is distinct from private.campaign_current_id()
           then ' Si cette opération a été saisie hors ligne pendant cette campagne, elle doit être traitée par le management (elle n''est pas rattachée automatiquement à la campagne en cours).'
           else '' end
      using errcode = '42501';
  elsif v_kind in ('RECONCILIATION','STOCK') and c.status not in ('OPEN','CLOSING') then
    raise exception 'Campagne % % : aucun rapprochement ne peut y être enregistré.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  end if;

  new.campaign_id := c.id;
  if v_legacy is not null and (v_row->>v_legacy) is distinct from c.code then
    new := jsonb_populate_record(new, jsonb_build_object(v_legacy, c.code));
  end if;
  return new;
end $$;

create or replace function private.campaign_status_fr(p text) returns text
language sql immutable set search_path = public, private as $$
  select case p when 'DRAFT' then 'Brouillon' when 'PLANNING' then 'En préparation' when 'READY' then 'Prête'
    when 'OPEN' then 'Ouverte' when 'CLOSING' then 'En clôture' when 'CLOSED' then 'Clôturée' when 'ARCHIVED' then 'Archivée' else p end $$;

-- Colonnes, index, rattachement des données existantes et déclencheurs
do $do$
declare r record; v_sim uuid := (select id from public.campaigns where code = '2027'); v_n bigint;
begin
  for r in select * from private.campaign_scoped_tables where kind <> 'CHILD' order by purge_rank loop
    execute format('alter table public.%I add column if not exists campaign_id uuid references public.campaigns(id)', r.table_name);
    execute format('create index if not exists %I on public.%I (campaign_id)', r.table_name || '_campaign_idx', r.table_name);
    -- Rattachement : lignes sans code historique ou portant le code 2027 → campagne SIMULATION 2027.
    -- Les lignes portant un autre code (ex. 2026) restent non rattachées : « à classifier ».
    -- Les déclencheurs métier existants (audit, gardes) sont suspendus le temps de cette seule mise à jour technique
    -- (aucun déclencheur n'était désactivé avant la migration ; tous sont réactivés juste après).
    execute format('alter table public.%I disable trigger user', r.table_name);
    if r.legacy_column is not null then
      execute format('update public.%I set campaign_id = $1 where campaign_id is null and (%I is null or btrim(%I) in ('''', ''2027''))',
                     r.table_name, r.legacy_column, r.legacy_column) using v_sim;
    else
      execute format('update public.%I set campaign_id = $1 where campaign_id is null', r.table_name) using v_sim;
    end if;
    execute format('alter table public.%I enable trigger user', r.table_name);
    execute format('create or replace trigger trg_000_campaign_stamp before insert or update or delete on public.%I '
                   || 'for each row execute function private.campaign_stamp(%L, %L, %L, %L)',
                   r.table_name, r.kind, coalesce(r.legacy_column, ''), coalesce(r.parent_table, ''), coalesce(r.parent_column, ''));
  end loop;
end $do$;

-- Les valeurs par défaut « 2027 » codées en dur disparaissent : la campagne vient du contexte.
alter table public.aflp_coop_campaigns          alter column campaign set default null;
alter table public.aflp_coop_deliveries         alter column campaign set default null;
alter table public.aflp_coop_enrollment_reviews alter column campaign set default null;
alter table public.aflp_coop_import_batches     alter column campaign set default null;
alter table public.aflp_coop_memberships        alter column campaign set default null;
alter table public.aflp_coop_trainings          alter column campaign set default null;
alter table public.aflp_incidents               alter column campaign set default null;

-- Index combinés utiles aux écrans filtrés par campagne (achats par producteur / RT, livraisons par coop)
create index if not exists achats_campaign_producteur_idx on public.achats (campaign_id, producteur_id);
create index if not exists achats_campaign_rt_date_idx on public.achats (campaign_id, rt_id, date);
create index if not exists aflp_coop_memberships_campaign_coop_idx on public.aflp_coop_memberships (campaign_id, cooperative_id);
create index if not exists aflp_coop_deliveries_campaign_coop_idx on public.aflp_coop_deliveries (campaign_id, cooperative_id, status);
create index if not exists wms_receptions_campaign_wh_idx on public.wms_receptions (campaign_id, warehouse_id, status);
create index if not exists wms_transfers_campaign_status_idx on public.wms_transfers (campaign_id, status);

-- Suppression contrôlée des simulations : les gardes de suppression existantes laissent passer la seule fonction
-- de purge (indicateur de transaction posé par public.campaign_purge, valable uniquement pour une campagne non REAL).
do $g$
declare f regprocedure; d text;
begin
  foreach f in array array['private.aflp_coop_block_delete()'::regprocedure, 'public.sacherie_guard_mouvement_delete()'::regprocedure,
                           'public.wms_trf_guard_child()'::regprocedure, 'public.wms_trf_guard_header()'::regprocedure,
                           'public.wms_trf_guard_ops()'::regprocedure] loop
    d := pg_get_functiondef(f);
    if position('campaign_purge_active' in d) = 0 then
      d := regexp_replace(d, '\mbegin\M', 'begin
  if tg_op = ''DELETE'' and private.campaign_purge_active() then return old; end if;', 'i');
      execute d;
    end if;
  end loop;
end $g$;


-- Contrôle de caisse par campagne. Avant : avances et achats de toutes les années étaient additionnés ; en 2028, les
-- achats 2027 auraient été déduits des avances 2028 et auraient bloqué tous les achats. Chaque campagne repart à zéro.
create or replace function public.fb_prevent_achat_over_advance() returns trigger
language plpgsql set search_path = public as $$
declare
  k text;
  total_avance numeric := 0;
  total_achat numeric := 0;
  disponible numeric := 0;
begin
  k := public.fb_rt_key(new.rt_id, new.rt_nom);
  if k is null then
    return new;
  end if;
  select coalesce(sum(a.montant),0) into total_avance
  from public.avances a
  where public.fb_rt_key(a.rt_id, a.rt_nom) = k
    and coalesce(a.statut,'Active') <> 'Annulee'
    and a.campaign_id is not distinct from new.campaign_id;
  select coalesce(sum(x.montant),0) into total_achat
  from public.achats x
  where public.fb_rt_key(x.rt_id, x.rt_nom) = k
    and x.id is distinct from new.id
    and x.campaign_id is not distinct from new.campaign_id
    and not coalesce(nullif(btrim(coalesce(new.local_id,'')),'') is not null and x.local_id = new.local_id, false);
  disponible := total_avance - total_achat;
  if coalesce(new.montant,0) > disponible then
    raise exception 'Avance RT insuffisante pour la campagne en cours. Disponible: %, achat: %', disponible, new.montant
      using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.aflp_achat_controle_mode_a() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare v_follow text; v_rt public.rt; k text; v_avance numeric; v_achat numeric; v_dispo numeric;
begin
  if new.sourcing_channel is distinct from 'COOPERATIVE' then return new; end if;
  if tg_op = 'UPDATE' and new.rt_id is not distinct from old.rt_id and new.rt_nom is not distinct from old.rt_nom
     and new.montant is not distinct from old.montant and new.cooperative_id is not distinct from old.cooperative_id then
    return new;
  end if;
  if not private.aflp_campaign_control_enabled(new.campaign, 'COOP_MODE_A_RT_REQUIRED') then return new; end if;

  if nullif(btrim(coalesce(new.rt_id,'')),'') is null then
    select ms.followup_rt_id into v_follow from public.aflp_coop_memberships ms where ms.id = new.coop_membership_id;
    if v_follow is not null then new.rt_id := v_follow; new.rt_nom := null; end if;
  end if;
  if nullif(btrim(coalesce(new.rt_id,'')),'') is null then
    raise exception 'Un RT de suivi est requis pour un achat individuel d''un membre de coopérative afin d''assurer le contrôle de caisse.'
      using errcode = '23514', hint = 'Renseignez le RT de suivi du membre (fiche coopérative → Producteurs) ou choisissez le RT au moment de l''achat.';
  end if;
  select * into v_rt from public.rt where id = new.rt_id;
  if v_rt.id is null or coalesce(v_rt.deleted, false) then
    raise exception 'Le RT de suivi % est inactif ou introuvable : achat coopérative refusé.', new.rt_id using errcode = '23514';
  end if;
  new.rt_nom := coalesce(nullif(new.rt_nom,''), v_rt.nom);
  if auth.uid() is not null and not private.farmer_registry_can_access_village(v_rt.village_id, v_rt.id) then
    raise exception 'Le RT de suivi % est hors de votre périmètre : achat refusé.', coalesce(v_rt.id_rt, v_rt.id) using errcode = '42501';
  end if;

  -- Contrôle de caisse : même règle que fb_prevent_achat_over_advance, limitée à la campagne de l'achat.
  k := public.fb_rt_key(new.rt_id, new.rt_nom);
  select coalesce(sum(a.montant),0) into v_avance from public.avances a
   where public.fb_rt_key(a.rt_id, a.rt_nom) = k and coalesce(a.statut,'Active') <> 'Annulee'
     and a.campaign_id is not distinct from new.campaign_id;
  select coalesce(sum(x.montant),0) into v_achat from public.achats x
   where public.fb_rt_key(x.rt_id, x.rt_nom) = k and x.id is distinct from new.id
     and x.campaign_id is not distinct from new.campaign_id
     and not coalesce(nullif(btrim(coalesce(new.local_id,'')),'') is not null and x.local_id = new.local_id, false);
  v_dispo := v_avance - v_achat;
  if coalesce(new.montant,0) > v_dispo then
    raise exception 'Avance RT insuffisante. Disponible: %, achat: %', v_dispo, new.montant using errcode = '23514';
  end if;
  return new;
end $$;

revoke execute on function private.aflp_achat_controle_mode_a() from public, anon, authenticated;

revoke execute on function private.campaign_stamp(), private.campaign_status_fr(text) from public, anon, authenticated;
