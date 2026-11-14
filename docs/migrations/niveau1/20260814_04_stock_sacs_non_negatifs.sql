-- ============================================================================
-- NIVEAU 1 — Migration 04 : LOT B (suite) — soldes physiques non négatifs
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 03
--
-- CE QUE CETTE MIGRATION FERME
--   P0-3  stock RCN et solde de sacs négatifs possibles
--
-- POURQUOI UN SOLDE MATÉRIALISÉ ET NON UNE SOMME À LA VOLÉE
--   Aujourd'hui le solde d'un RT est une somme calculée à la lecture. On ne peut
--   pas poser de contrainte sur une somme : deux transactions concurrentes
--   lisent chacune un solde suffisant, et toutes deux passent. Le solde devient
--   donc une COLONNE, portant un CHECK (quantite >= 0), mise à jour dans la même
--   transaction que le mouvement. Le verrou de ligne pris par
--   « insert … on conflict do update » sérialise les concurrents : la deuxième
--   transaction relit le solde déjà décrémenté et échoue. C'est PostgreSQL qui
--   arbitre, pas l'ordre d'arrivée des requêtes.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Soldes physiques
-- ---------------------------------------------------------------------------

create table if not exists public.n1_soldes (
  id           uuid primary key default gen_random_uuid(),
  campagne     text not null,
  article      text not null,          -- SACS_VIDES | SACS_PLEINS | RCN_KG
  entite_type  text not null,          -- ANAGROCI | CLUSTER | RT | PRODUCTEUR | HUB | USINE | PERTE
  entite_ref   text not null,
  cluster      text,
  quantite     numeric not null default 0,
  maj_le       timestamptz not null default now(),
  constraint n1_soldes_uk unique (campagne, article, entite_type, entite_ref),
  constraint n1_soldes_article_chk check (article in ('SACS_VIDES','SACS_PLEINS','RCN_KG')),
  constraint n1_soldes_entite_chk check (entite_type in
    ('ANAGROCI','CLUSTER','RT','PRODUCTEUR','HUB','USINE','PERTE')),
  -- LA contrainte P0-3. Elle ne peut pas être contournée par une lecture périmée.
  constraint n1_soldes_non_negatif_chk check (quantite >= 0)
);

create index if not exists n1_soldes_ent_idx on public.n1_soldes (entite_type, entite_ref, article);
create index if not exists n1_soldes_cluster_idx on public.n1_soldes (cluster, article);

alter table public.n1_soldes enable row level security;
drop policy if exists n1_soldes_sel on public.n1_soldes;
create policy n1_soldes_sel on public.n1_soldes for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_soldes from authenticated, anon;

-- Entités NON comptées : elles ne détiennent pas un stock que le programme
-- suit, et leur solde n'a donc pas à rester positif.
--   · ANAGROCI est la source amont des sacs : son parc n'est pas tenu ici ;
--   · PERTE et USINE sont des puits : ce qui y entre sort du périmètre suivi ;
--   · PRODUCTEUR est la source du RCN — il produit la marchandise, il ne
--     détient pas un stock RCN décompté. En revanche ses SACS sont bel et bien
--     suivis : c'est tout l'objet du registre de sacherie. La règle dépend donc
--     de l'article, pas seulement du type d'entité.
create or replace function public.n1_entite_illimitee(p_article text, p_type text)
returns boolean language sql immutable as $$
  select case
    when coalesce(upper(p_type),'') in ('ANAGROCI','PERTE','USINE') then true
    when coalesce(upper(p_article),'') = 'RCN_KG'
     and coalesce(upper(p_type),'') = 'PRODUCTEUR' then true
    else false
  end
$$;

create or replace function public.n1_appliquer_solde(
  p_campagne text, p_article text, p_entite_type text, p_entite_ref text,
  p_cluster text, p_delta numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_solde numeric;
begin
  if p_entite_type is null or nullif(btrim(coalesce(p_entite_ref,'')),'') is null then
    return null;                    -- rien à mouvementer : entité non identifiée
  end if;
  if p_delta = 0 then return null; end if;

  -- Le filtrage doit précéder l'écriture : la contrainte CHECK est évaluée à
  -- l'insertion. Corriger la ligne après coup arriverait trop tard — la
  -- première version de cette fonction échouait dès la dotation initiale.
  if p_delta < 0 and public.n1_entite_illimitee(p_article, p_entite_type) then
    return null;
  end if;

  -- Pourquoi deux instructions et non un seul INSERT … ON CONFLICT DO UPDATE :
  -- PostgreSQL évalue les contraintes CHECK sur la ligne PROPOSÉE à l'insertion,
  -- AVANT de détecter le conflit et de basculer sur la branche UPDATE. Un delta
  -- négatif produisait donc une ligne candidate à quantité négative, rejetée par
  -- n1_soldes_non_negatif_chk même quand le solde réel était largement suffisant.
  -- On crée donc d'abord la ligne à zéro (toujours valide), puis on l'incrémente.
  -- L'UPDATE prend un verrou de ligne : deux transactions concurrentes sur le
  -- même solde sont sérialisées, et la seconde relit le solde déjà décrémenté.
  insert into public.n1_soldes(campagne, article, entite_type, entite_ref, cluster, quantite)
  values (p_campagne, p_article, upper(p_entite_type), p_entite_ref, p_cluster, 0)
  on conflict (campagne, article, entite_type, entite_ref) do nothing;

  update public.n1_soldes
     set quantite = quantite + p_delta,
         maj_le   = now(),
         cluster  = coalesce(cluster, p_cluster)
   where campagne = p_campagne and article = p_article
     and entite_type = upper(p_entite_type) and entite_ref = p_entite_ref
  returning quantite into v_solde;

  return v_solde;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Mouvements de sacs → soldes
-- ---------------------------------------------------------------------------
-- La colonne bag_state (Sacherie V2) distingue sacs vides et sacs pleins ;
-- à défaut, on retient SACS_VIDES, cas très majoritaire d'une dotation.

create or replace function public.n1_sacs_soldes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_article text;
  v_src_ref text;
  v_dst_ref text;
  v_solde numeric;
begin
  v_article := case when upper(coalesce(new.bag_state,'')) = 'FULL' then 'SACS_PLEINS' else 'SACS_VIDES' end;

  -- Référence de l'entité selon son type : un RT est identifié par rt_id, un
  -- producteur par producteur_id, un cluster par son nom.
  v_src_ref := case upper(coalesce(new.source,''))
                 when 'RT' then new.rt_id when 'PRODUCTEUR' then new.producteur_id
                 when 'CLUSTER' then new.cluster when 'HUB' then new.cluster
                 else upper(coalesce(new.source,'')) end;
  v_dst_ref := case upper(coalesce(new.destination,''))
                 when 'RT' then new.rt_id when 'PRODUCTEUR' then new.producteur_id
                 when 'CLUSTER' then new.cluster when 'HUB' then new.cluster
                 else upper(coalesce(new.destination,'')) end;

  if nullif(btrim(coalesce(new.source,'')),'') is null
     and nullif(btrim(coalesce(new.destination,'')),'') is null then
    raise exception 'Mouvement de sacs sans origine ni destination : refusé'
      using errcode = 'restrict_violation';
  end if;

  -- Une entité suivie doit être identifiée, sinon le mouvement sort
  -- silencieusement du décompte : les sacs « disparaîtraient » sans qu'aucun
  -- solde ne bouge. On refuse plutôt que de perdre la trace.
  if upper(coalesce(new.source,'')) in ('RT','PRODUCTEUR')
     and nullif(btrim(coalesce(v_src_ref,'')),'') is null then
    raise exception 'Origine « % » sans identifiant : mouvement de sacs refusé', upper(new.source)
      using errcode = 'restrict_violation';
  end if;
  if upper(coalesce(new.destination,'')) in ('RT','PRODUCTEUR')
     and nullif(btrim(coalesce(v_dst_ref,'')),'') is null then
    raise exception 'Destination « % » sans identifiant : mouvement de sacs refusé', upper(new.destination)
      using errcode = 'restrict_violation';
  end if;

  if new.source is not null then
    v_solde := public.n1_appliquer_solde(new.campagne, v_article, new.source, v_src_ref,
                                         new.cluster, -new.quantite);
    if v_solde is not null and v_solde < 0 then
      raise exception
        'Solde de sacs insuffisant : % « % » ne détient pas % sac(s). Solde après opération : %.',
        upper(new.source), v_src_ref, new.quantite, v_solde
        using errcode = 'check_violation';
    end if;
  end if;

  if new.destination is not null then
    perform public.n1_appliquer_solde(new.campagne, v_article, new.destination, v_dst_ref,
                                      new.cluster, new.quantite);
  end if;

  return new;
end $$;

drop trigger if exists trg_n1_50_sacs_soldes on public.sacs_mouvements;
create trigger trg_n1_50_sacs_soldes
  after insert on public.sacs_mouvements
  for each row execute function public.n1_sacs_soldes();

-- ---------------------------------------------------------------------------
-- 3) Stock RCN — registre de mouvements et soldes en kg
-- ---------------------------------------------------------------------------

create table if not exists public.n1_stock_mouvements (
  id             uuid primary key default gen_random_uuid(),
  local_id       text unique,
  cle_idempotence text,
  mouvement_code text,
  campagne       text not null,
  date           date not null default current_date,
  type           text not null,   -- ENTREE_ACHAT | TRANSFERT | EVACUATION | RECEPTION_USINE | PERTE | AJUSTEMENT
  source_type    text,
  source_ref     text,
  destination_type text,
  destination_ref  text,
  cluster        text,
  rt_id          text,
  lot_id         uuid,
  achat_id       uuid references public.achats(id),
  poids_kg       numeric not null check (poids_kg > 0),
  motif          text,
  correction_de  uuid references public.n1_stock_mouvements(id),
  n1_statut      text not null default 'SOUMIS',
  terminal_id    text,
  created_by     uuid not null default public.n1_uid(),
  created_at     timestamptz not null default now(),
  serveur_recu_le timestamptz not null default now(),
  constraint n1_stock_type_chk check (type in
    ('ENTREE_ACHAT','TRANSFERT','EVACUATION','RECEPTION_USINE','PERTE','AJUSTEMENT'))
);

create sequence if not exists public.n1_seq_stock start 1;
create unique index if not exists n1_stock_cle_idem_uidx
  on public.n1_stock_mouvements (cle_idempotence) where cle_idempotence is not null;
create unique index if not exists n1_stock_code_uidx
  on public.n1_stock_mouvements (mouvement_code) where mouvement_code is not null;
create unique index if not exists n1_stock_achat_uidx
  on public.n1_stock_mouvements (achat_id) where achat_id is not null and type = 'ENTREE_ACHAT';
create index if not exists n1_stock_rt_idx on public.n1_stock_mouvements (rt_id, date);
create index if not exists n1_stock_lot_idx on public.n1_stock_mouvements (lot_id);

create or replace function public.n1_stock_soldes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_solde numeric;
begin
  if new.source_type is not null then
    v_solde := public.n1_appliquer_solde(new.campagne, 'RCN_KG', new.source_type, new.source_ref,
                                         new.cluster, -new.poids_kg);
    if v_solde is not null and v_solde < 0 then
      raise exception
        'Stock RCN insuffisant : % « % » ne détient pas % kg. Solde après opération : % kg.',
        upper(new.source_type), new.source_ref, new.poids_kg, v_solde
        using errcode = 'check_violation';
    end if;
  end if;
  if new.destination_type is not null then
    perform public.n1_appliquer_solde(new.campagne, 'RCN_KG', new.destination_type,
                                      new.destination_ref, new.cluster, new.poids_kg);
  end if;
  return new;
end $$;

drop trigger if exists trg_n1_50_stock_soldes on public.n1_stock_mouvements;
create trigger trg_n1_50_stock_soldes
  after insert on public.n1_stock_mouvements
  for each row execute function public.n1_stock_soldes();

-- Identité du mouvement de stock (campagne, clé, code) : même règle qu'ailleurs.
create or replace function public.n1_stock_identite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(new.campagne,'')),'') is null then
    new.campagne := public.n1_param_txt('campagne_active');
    if new.campagne is null then
      raise exception 'Campagne active non définie : mouvement de stock refusé'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if nullif(btrim(coalesce(new.cle_idempotence,'')),'') is null then
    new.cle_idempotence := nullif(btrim(coalesce(new.local_id,'')),'');
  end if;
  if new.mouvement_code is null then
    new.mouvement_code := 'STK-' || public.n1_code_court(new.campagne, 8, 'NA') || '-'
      || public.n1_code_court(new.cluster, 3, 'GEN') || '-'
      || lpad(nextval('public.n1_seq_stock')::text, 6, '0');
  end if;
  if new.source_type is null and new.destination_type is null then
    raise exception 'Mouvement de stock sans origine ni destination : refusé'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_n1_10_stock_identite on public.n1_stock_mouvements;
create trigger trg_n1_10_stock_identite before insert on public.n1_stock_mouvements
  for each row execute function public.n1_stock_identite();

drop trigger if exists trg_n1_90_audit on public.n1_stock_mouvements;
create trigger trg_n1_90_audit after insert or update or delete on public.n1_stock_mouvements
  for each row execute function public.n1_audit_trigger();

-- ---------------------------------------------------------------------------
-- 4) L'achat alimente le stock RCN du RT — dans la MÊME transaction
-- ---------------------------------------------------------------------------
-- Invariant 13 : les écritures liées ne peuvent pas diverger. Un achat qui
-- réussit sans entrée de stock, ou l'inverse, produirait un écart permanent.

create or replace function public.n1_achat_alimente_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.rejet, false) then return new; end if;

  insert into public.n1_stock_mouvements(
    local_id, cle_idempotence, campagne, date, type,
    source_type, source_ref, destination_type, destination_ref,
    cluster, rt_id, achat_id, poids_kg, motif, created_by, terminal_id)
  values (
    'STK-' || new.local_id, 'STK-' || new.cle_idempotence, new.campagne, new.date, 'ENTREE_ACHAT',
    'PRODUCTEUR', coalesce(new.producteur_id, 'NON_REFERENCE'), 'RT', new.rt_id,
    new.cluster, new.rt_id, new.id, new.poids_net,
    'Entrée automatique liée à l''achat ' || coalesce(new.achat_code, new.id::text),
    new.created_by, new.terminal_id)
  -- L'index d'idempotence est PARTIEL : ON CONFLICT ne peut le viser qu'en
  -- répétant son prédicat, sinon PostgreSQL répond « no unique or exclusion
  -- constraint matching the ON CONFLICT specification ».
  on conflict (cle_idempotence) where cle_idempotence is not null do nothing;

  return new;
end $$;

drop trigger if exists trg_n1_60_achat_stock on public.achats;
create trigger trg_n1_60_achat_stock
  after insert on public.achats
  for each row execute function public.n1_achat_alimente_stock();

-- ---------------------------------------------------------------------------
-- 5) Lots, évacuations et réceptions usine
-- ---------------------------------------------------------------------------

create table if not exists public.n1_lots (
  id            uuid primary key default gen_random_uuid(),
  lot_code      text not null unique,
  campagne      text not null,
  cluster       text not null,
  rt_id         text,
  poids_kg      numeric not null check (poids_kg > 0),
  nb_sacs       integer check (nb_sacs is null or nb_sacs > 0),
  humidite      numeric check (humidite is null or (humidite >= 0 and humidite <= 100)),
  kor           numeric check (kor is null or (kor >= 0 and kor <= 100)),
  statut        text not null default 'CONSTITUE',
  constitue_le  timestamptz not null default now(),
  constitue_par uuid not null default public.n1_uid(),
  created_at    timestamptz not null default now(),
  constraint n1_lots_statut_chk check (statut in ('CONSTITUE','EVACUE','RECU','ECART','ANNULE'))
);
create sequence if not exists public.n1_seq_lot start 1;
create index if not exists n1_lots_statut_idx on public.n1_lots (campagne, statut);

create table if not exists public.n1_evacuations (
  id              uuid primary key default gen_random_uuid(),
  evacuation_code text not null unique,
  campagne        text not null,
  cluster         text not null,
  lot_id          uuid not null references public.n1_lots(id),
  transporteur    text,
  immatriculation text,
  poids_depart_kg numeric not null check (poids_depart_kg > 0),
  date_depart     timestamptz not null default now(),
  expedie_par     uuid not null default public.n1_uid(),
  statut          text not null default 'EN_ROUTE',
  created_at      timestamptz not null default now(),
  constraint n1_evac_statut_chk check (statut in ('EN_ROUTE','RECUE','ECART','ANNULEE'))
);
create sequence if not exists public.n1_seq_evacuation start 1;
create unique index if not exists n1_evac_lot_uidx
  on public.n1_evacuations (lot_id) where statut <> 'ANNULEE';

create table if not exists public.n1_receptions_usine (
  id              uuid primary key default gen_random_uuid(),
  reception_code  text not null unique,
  campagne        text not null,
  evacuation_id   uuid not null references public.n1_evacuations(id),
  lot_id          uuid not null references public.n1_lots(id),
  poids_recu_kg   numeric not null check (poids_recu_kg >= 0),
  humidite        numeric check (humidite is null or (humidite >= 0 and humidite <= 100)),
  kor             numeric check (kor is null or (kor >= 0 and kor <= 100)),
  date_reception  timestamptz not null default now(),
  recu_par        uuid not null default public.n1_uid(),
  ecart_kg        numeric,
  statut          text not null default 'ENREGISTREE',
  created_at      timestamptz not null default now(),
  constraint n1_recep_statut_chk check (statut in ('ENREGISTREE','CONFORME','ECART','CONTESTEE'))
);
create sequence if not exists public.n1_seq_reception start 1;
-- Une évacuation ne peut être réceptionnée qu'une fois.
create unique index if not exists n1_recep_evac_uidx on public.n1_receptions_usine (evacuation_id);

-- Invariant : aucune réception usine sans évacuation correspondante. Le simple
-- fait que evacuation_id soit NOT NULL et référencé le garantit structurellement.
create or replace function public.n1_reception_garde()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_evac public.n1_evacuations%rowtype;
begin
  select * into v_evac from public.n1_evacuations where id = new.evacuation_id for update;
  if not found then
    raise exception 'Réception usine sans évacuation correspondante : refusée'
      using errcode = 'foreign_key_violation';
  end if;
  if v_evac.statut = 'ANNULEE' then
    raise exception 'Évacuation annulée : réception refusée' using errcode = 'restrict_violation';
  end if;
  if new.lot_id <> v_evac.lot_id then
    raise exception 'Lot de la réception différent du lot évacué' using errcode = 'restrict_violation';
  end if;

  new.campagne := coalesce(new.campagne, v_evac.campagne);
  new.ecart_kg := new.poids_recu_kg - v_evac.poids_depart_kg;
  if new.reception_code is null then
    new.reception_code := 'REC-' || public.n1_code_court(new.campagne, 8, 'NA') || '-'
      || lpad(nextval('public.n1_seq_reception')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_n1_10_reception on public.n1_receptions_usine;
create trigger trg_n1_10_reception before insert on public.n1_receptions_usine
  for each row execute function public.n1_reception_garde();

do $$
declare t text;
begin
  foreach t in array array['n1_lots','n1_evacuations','n1_receptions_usine','n1_stock_mouvements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.est_actif())', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.peut_editer_terrain())',
      t||'_ins', t);
    execute format('revoke update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

commit;
