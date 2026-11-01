-- ============================================================================
-- NIVEAU 1 — Migration 03 : LOT B — cycles de financement et invariants métier
-- Date : 2026-08-14 · Dépend de : 20260814_01, 20260814_02
--
-- CE QUE CETTE MIGRATION FERME
--   P0-2  nouvelle avance possible sur un cycle non réconcilié
--   P0-4  machine d'état absente (statuts en texte libre)
--   P0-6  auto-approbation possible
--   P0-7  achat sans producteur / RT / cycle / campagne valides
--   P0-9  montant non vérifié contre poids × prix
--
-- POURQUOI UN TRIGGER ET NON UNE CLÉ ÉTRANGÈRE
--   public.achats.rt_id est de type text ; public.rt.id est de type uuid.
--   Poser une vraie clé étrangère exigerait de convertir la colonne, donc de
--   réécrire l'historique — opération destructive, interdite ici. La validation
--   référentielle est donc faite par trigger, et l'écart de typage est inscrit
--   au registre des angles morts (docs/niveau1/13_ANGLES_MORTS.md, A-02).
--
-- AVERTISSEMENT DE DÉPLOIEMENT
--   Après cette migration, une avance insérée directement dans public.avances
--   SANS cycle ouvert est REFUSÉE. C'est l'objet même du correctif P0-2. Le
--   frontend doit appeler n1_ouvrir_cycle() puis n1_enregistrer_avance().
--   Voir docs/niveau1/10_GUIDE_MIGRATION.md — livraison coordonnée obligatoire.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Machine d'état explicite et inspectable
-- ---------------------------------------------------------------------------

create table if not exists public.n1_transitions (
  entite         text not null,
  statut_source  text not null,
  statut_cible   text not null,
  roles_autorises text[] not null,
  exige_motif    boolean not null default false,
  exige_preuve   boolean not null default false,
  primary key (entite, statut_source, statut_cible)
);

insert into public.n1_transitions(entite, statut_source, statut_cible, roles_autorises, exige_motif, exige_preuve) values
  -- Cycle de financement
  ('cycle','OUVERT','RECONCILIE', array['Branch Manager','Assistant Branch Manager','Head of Field'], false, true),
  ('cycle','OUVERT','BLOQUE',     array['Branch Manager','Assistant Branch Manager','Head of Field'], true,  false),
  ('cycle','BLOQUE','OUVERT',     array['Branch Manager'],                                            true,  true),
  ('cycle','BLOQUE','RECONCILIE', array['Branch Manager'],                                            true,  true),
  ('cycle','RECONCILIE','CLOTURE',array['Branch Manager'],                                            false, false),
  ('cycle','RECONCILIE','BLOQUE', array['Branch Manager'],                                            true,  false),
  ('cycle','OUVERT','ANNULE',     array['Branch Manager'],                                            true,  true),
  -- Opération (achat, avance, mouvement)
  ('operation','BROUILLON','SOUMIS',    array['Agent Recenseur','Supervisor','Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer'], false, false),
  ('operation','SOUMIS','VALIDE',       array['Supervisor','Branch Manager','Assistant Branch Manager','Head of Field'], false, false),
  ('operation','SOUMIS','REJETE',       array['Supervisor','Branch Manager','Assistant Branch Manager','Head of Field'], true,  false),
  ('operation','VALIDE','RECONCILIE',   array['Branch Manager','Assistant Branch Manager','Head of Field'], false, false),
  ('operation','RECONCILIE','CLOTURE',  array['Branch Manager'],                                      false, false),
  ('operation','VALIDE','AJUSTE',       array['Branch Manager'],                                      true,  true),
  ('operation','CLOTURE','AJUSTE',      array['Branch Manager'],                                      true,  true),
  ('operation','SOUMIS','ANNULE',       array['Branch Manager'],                                      true,  false)
on conflict (entite, statut_source, statut_cible) do nothing;

alter table public.n1_transitions enable row level security;
drop policy if exists n1_transitions_sel on public.n1_transitions;
create policy n1_transitions_sel on public.n1_transitions for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_transitions from authenticated, anon;

create or replace function public.n1_transition_permise(
  p_entite text, p_source text, p_cible text, p_role text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.n1_transitions t
    where t.entite = p_entite and t.statut_source = p_source and t.statut_cible = p_cible
      and coalesce(p_role, public.n1_role()) = any (t.roles_autorises))
$$;

-- ---------------------------------------------------------------------------
-- 2) Cycle de financement — entité de plein droit
-- ---------------------------------------------------------------------------
-- Aujourd'hui le « cycle » n'est qu'une colonne de public.avances : une avance
-- créée avec cycle_id NULL échappe à l'index partiel qui limite à un cycle OPEN
-- par RT. C'est exactement la brèche P0-2. Le cycle devient donc une table.

create table if not exists public.n1_cycles (
  id                 uuid primary key default gen_random_uuid(),
  cycle_code         text not null,
  campagne           text not null,
  cluster            text not null,
  rt_id              text not null,
  rt_nom             text,
  statut             text not null default 'OUVERT',
  montant_autorise   numeric not null check (montant_autorise > 0),
  volume_finance_kg  numeric check (volume_finance_kg is null or volume_finance_kg >= 0),
  prix_reference_kg  numeric check (prix_reference_kg is null or prix_reference_kg > 0),
  echeance           date,
  date_ouverture     timestamptz not null default now(),
  ouvert_par         uuid not null default public.n1_uid(),
  date_reconciliation timestamptz,
  reconcilie_par     uuid,
  date_cloture       timestamptz,
  cloture_par        uuid,
  motif              text,
  created_at         timestamptz not null default now(),
  constraint n1_cycles_code_uk unique (cycle_code),
  constraint n1_cycles_statut_chk check (statut in ('OUVERT','BLOQUE','RECONCILIE','CLOTURE','ANNULE'))
);

create index if not exists n1_cycles_rt_idx on public.n1_cycles (rt_id, statut);
create index if not exists n1_cycles_camp_idx on public.n1_cycles (campagne, cluster, statut);

-- LA règle centrale, posée au niveau de la base : un seul cycle non terminé par
-- RT et par campagne. Un index unique partiel ne peut pas être contourné.
create unique index if not exists n1_cycles_un_actif_par_rt_uidx
  on public.n1_cycles (campagne, rt_id)
  where statut in ('OUVERT','BLOQUE');

create sequence if not exists public.n1_seq_cycle start 1;

-- Rattachement des écritures au cycle (additif, non destructif).
alter table public.avances add column if not exists cycle_uid uuid references public.n1_cycles(id);
alter table public.achats  add column if not exists cycle_uid uuid references public.n1_cycles(id);
create index if not exists avances_cycle_uid_idx on public.avances (cycle_uid);
create index if not exists achats_cycle_uid_idx  on public.achats (cycle_uid);

-- Statut d'opération normalisé, à côté du statut_validation historique en texte
-- libre, qui n'est pas supprimé (aucune perte de donnée).
alter table public.achats  add column if not exists n1_statut text not null default 'SOUMIS';
alter table public.avances add column if not exists n1_statut text not null default 'SOUMIS';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'achats_n1_statut_chk') then
    alter table public.achats add constraint achats_n1_statut_chk
      check (n1_statut in ('BROUILLON','SOUMIS','VALIDE','REJETE','RECONCILIE','CLOTURE','ANNULE','AJUSTE')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'avances_n1_statut_chk') then
    alter table public.avances add constraint avances_n1_statut_chk
      check (n1_statut in ('BROUILLON','SOUMIS','VALIDE','REJETE','RECONCILIE','CLOTURE','ANNULE','AJUSTE')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Exceptions : justifiées, approuvées, liées à l'opération d'origine
-- ---------------------------------------------------------------------------

create table if not exists public.n1_exceptions (
  id             uuid primary key default gen_random_uuid(),
  exception_code text not null unique,
  type_exception text not null,
  ressource      text not null,
  enregistrement text,
  cycle_uid      uuid references public.n1_cycles(id),
  rt_id          text,
  cluster        text,
  campagne       text,
  montant_concerne numeric,
  motif          text not null,
  preuve         text,
  statut         text not null default 'DEMANDEE',
  demande_par    uuid not null default public.n1_uid(),
  demande_le     timestamptz not null default now(),
  approuve_par   uuid,
  approuve_le    timestamptz,
  consomme_le    timestamptz,
  expire_le      timestamptz,
  constraint n1_exc_statut_chk check (statut in ('DEMANDEE','APPROUVEE','REFUSEE','CONSOMMEE','EXPIREE')),
  constraint n1_exc_type_chk check (type_exception in
    ('DEPASSEMENT_FINANCEMENT','DEPASSEMENT_PLAFOND','AVANCE_CYCLE_NON_RECONCILIE',
     'MODIFICATION_APRES_CLOTURE','ECART_TOLERE','SAISIE_PAPIER_TARDIVE')),
  -- Séparation des tâches : le demandeur n'approuve jamais sa propre exception.
  constraint n1_exc_pas_auto_approbation check (approuve_par is null or approuve_par <> demande_par)
);

create sequence if not exists public.n1_seq_exception start 1;
create index if not exists n1_exc_cycle_idx on public.n1_exceptions (cycle_uid, statut);
create index if not exists n1_exc_res_idx   on public.n1_exceptions (ressource, enregistrement, statut);

-- Une exception approuvée et non consommée, par ressource et par type.
create unique index if not exists n1_exc_active_uidx
  on public.n1_exceptions (type_exception, ressource, coalesce(enregistrement,'*'), coalesce(cycle_uid::text,'*'))
  where statut = 'APPROUVEE';

-- ---------------------------------------------------------------------------
-- 4) Fonctions de calcul d'exposition — la source de vérité est le serveur
-- ---------------------------------------------------------------------------

create or replace function public.n1_cycle_actif(p_rt_id text, p_campagne text default null)
returns public.n1_cycles language sql stable security definer set search_path = public as $$
  select c.* from public.n1_cycles c
  where c.rt_id = p_rt_id
    and c.campagne = coalesce(p_campagne, public.n1_param_txt('campagne_active'))
    and c.statut in ('OUVERT','BLOQUE')
  order by c.date_ouverture desc
  limit 1
$$;

-- Total réellement dépensé sur un cycle (achats non rejetés, non annulés).
create or replace function public.n1_cycle_depense(p_cycle uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.montant), 0)
  from public.achats a
  where a.cycle_uid = p_cycle
    and coalesce(a.rejet, false) = false
    and a.n1_statut <> 'ANNULE'
$$;

create or replace function public.n1_cycle_finance(p_cycle uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.montant), 0)
  from public.avances v
  where v.cycle_uid = p_cycle and v.n1_statut <> 'ANNULE'
$$;

create or replace function public.n1_cycle_disponible(p_cycle uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select public.n1_cycle_finance(p_cycle) - public.n1_cycle_depense(p_cycle)
$$;

-- Un RT est refinançable seulement si AUCUN cycle antérieur ne reste ouvert
-- ou bloqué. C'est la règle centrale du programme.
create or replace function public.n1_rt_refinancable(p_rt_id text, p_campagne text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.n1_cycles c
    where c.rt_id = p_rt_id
      and c.campagne = coalesce(p_campagne, public.n1_param_txt('campagne_active'))
      and c.statut in ('OUVERT','BLOQUE'))
$$;

-- ---------------------------------------------------------------------------
-- 5) Ouverture d'un cycle — P0-2
-- ---------------------------------------------------------------------------

create or replace function public.n1_ouvrir_cycle(
  p_rt_id text,
  p_montant_autorise numeric,
  p_volume_finance_kg numeric default null,
  p_prix_reference_kg numeric default null,
  p_echeance date default null,
  p_motif text default null,
  p_exception_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_campagne text;
  v_cluster  text;
  v_rt_nom   text;
  v_cycle    public.n1_cycles%rowtype;
  v_plafond  numeric;
  v_exc      public.n1_exceptions%rowtype;
  v_bloquant public.n1_cycles%rowtype;
begin
  if not public.peut_editer_config() then
    perform public.n1_auditer('TENTATIVE_REFUSEE','n1_cycles',null,null,
      jsonb_build_object('rt_id',p_rt_id,'montant',p_montant_autorise),
      'Rôle insuffisant','REFUSE',null,null,null,null,null,p_rt_id);
    raise exception 'Rôle insuffisant pour ouvrir un cycle de financement'
      using errcode = 'insufficient_privilege';
  end if;

  v_campagne := public.n1_param_txt('campagne_active');
  if v_campagne is null then
    raise exception 'Campagne active non définie : ouverture de cycle refusée'
      using errcode = 'restrict_violation';
  end if;
  if p_montant_autorise is null or p_montant_autorise <= 0 then
    raise exception 'Montant autorisé invalide';
  end if;

  select coalesce(r.data ->> 'cluster',''), coalesce(r.data ->> 'nom', r.village_nom)
    into v_cluster, v_rt_nom
  from public.rt r where r.id::text = p_rt_id and coalesce(r.deleted,false) = false limit 1;
  if not found then
    raise exception 'RT introuvable dans le référentiel : %', p_rt_id;
  end if;
  if btrim(coalesce(v_cluster,'')) = '' then
    raise exception 'RT sans cluster : régulariser le référentiel avant financement';
  end if;

  -- Verrou logique : deux ouvertures concurrentes pour le même RT ne peuvent
  -- pas franchir ensemble le contrôle « un seul cycle actif ».
  perform pg_advisory_xact_lock(910271, hashtext(p_rt_id));

  -- P0-2 : LA règle. Aucun refinancement sur cycle non réconcilié.
  if not public.n1_rt_refinancable(p_rt_id, v_campagne) then
    select * into v_bloquant from public.n1_cycle_actif(p_rt_id, v_campagne);

    if p_exception_id is null then
      -- v_bloquant est nécessairement renseigné ici : n1_rt_refinancable a déjà
      -- constaté l'existence d'un cycle OUVERT ou BLOQUE.
      perform public.n1_auditer('TENTATIVE_REFUSEE','n1_cycles',v_bloquant.id::text,null,
        jsonb_build_object('rt_id',p_rt_id,'montant',p_montant_autorise),
        'Cycle antérieur non réconcilié','REFUSE',null,null,null,v_campagne,v_cluster,p_rt_id);
      raise exception
        'Refinancement refusé : le cycle % du RT % est encore en statut %. Aucun cycle non réconcilié ne peut recevoir une nouvelle avance.',
        v_bloquant.cycle_code, p_rt_id, v_bloquant.statut
        using errcode = 'restrict_violation';
    end if;

    -- Voie d'exception : approuvée, non consommée, non expirée, par un tiers.
    select * into v_exc from public.n1_exceptions
    where id = p_exception_id and statut = 'APPROUVEE'
      and type_exception = 'AVANCE_CYCLE_NON_RECONCILIE'
      and (expire_le is null or expire_le > now())
    for update;
    if not found then
      raise exception 'Exception invalide, expirée ou déjà consommée';
    end if;
    if v_exc.approuve_par = public.n1_uid() then
      raise exception 'Séparation des tâches : l''approbateur de l''exception ne peut pas l''utiliser lui-même'
        using errcode = 'insufficient_privilege';
    end if;
    update public.n1_exceptions set statut = 'CONSOMMEE', consomme_le = now() where id = v_exc.id;
  end if;

  -- Plafond : absence de paramètre = refus (règle « absence = blocage »).
  v_plafond := public.n1_param_num_obligatoire('plafond_cycle_montant_max', v_campagne, v_cluster, p_rt_id);
  if p_montant_autorise > v_plafond and p_exception_id is null then
    perform public.n1_auditer('TENTATIVE_REFUSEE','n1_cycles',null,null,
      jsonb_build_object('montant',p_montant_autorise,'plafond',v_plafond),
      'Dépassement de plafond','REFUSE',null,null,null,v_campagne,v_cluster,p_rt_id);
    raise exception 'Montant % supérieur au plafond autorisé % pour ce périmètre',
      p_montant_autorise, v_plafond using errcode = 'restrict_violation';
  end if;

  insert into public.n1_cycles(
    cycle_code, campagne, cluster, rt_id, rt_nom, statut, montant_autorise,
    volume_finance_kg, prix_reference_kg, echeance, ouvert_par, motif)
  values (
    'CYC-' || public.n1_code_court(v_campagne, 8, 'NA') || '-' || public.n1_code_court(v_cluster, 3, 'GEN')
      || '-' || lpad(nextval('public.n1_seq_cycle')::text, 6, '0'),
    v_campagne, v_cluster, p_rt_id, v_rt_nom, 'OUVERT', p_montant_autorise,
    p_volume_finance_kg, p_prix_reference_kg,
    coalesce(p_echeance, (current_date + (public.n1_param_num('cycle_duree_jours', v_campagne, v_cluster, p_rt_id))::integer)),
    public.n1_uid(), p_motif)
  returning * into v_cycle;

  perform public.n1_auditer('CREATION','n1_cycles',v_cycle.id::text,null,to_jsonb(v_cycle),
    p_motif,'ACCEPTE',null,null,null,v_campagne,v_cluster,p_rt_id);

  return to_jsonb(v_cycle);
end $$;

-- ---------------------------------------------------------------------------
-- 6) Garde serveur sur les avances — aucune avance hors cycle
-- ---------------------------------------------------------------------------

create or replace function public.n1_avance_garde()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cycle   public.n1_cycles%rowtype;
  v_plafond numeric;
  v_total   numeric;
begin
  if nullif(btrim(coalesce(new.rt_id,'')),'') is null then
    raise exception 'Avance sans RT : refusée' using errcode = 'restrict_violation';
  end if;
  if new.date > current_date then
    raise exception 'Avance datée dans le futur : refusée' using errcode = 'restrict_violation';
  end if;

  -- Rattachement au cycle actif du RT.
  if new.cycle_uid is null then
    select * into v_cycle from public.n1_cycle_actif(new.rt_id, new.campagne);
    -- Une fonction SQL renvoyant un composite NULL produit UNE ligne de NULL :
    -- FOUND vaudrait vrai à tort et laisserait passer l'avance. On teste la clé.
    if v_cycle.id is null then
      raise exception
        'Aucun cycle de financement ouvert pour le RT %. Ouvrir un cycle par n1_ouvrir_cycle() — qui vérifie que le cycle précédent est réconcilié.',
        new.rt_id using errcode = 'restrict_violation';
    end if;
    new.cycle_uid := v_cycle.id;
  else
    select * into v_cycle from public.n1_cycles where id = new.cycle_uid;
    if not found then raise exception 'Cycle de financement introuvable'; end if;
  end if;

  if v_cycle.statut <> 'OUVERT' then
    raise exception 'Cycle % en statut % : aucune avance ne peut y être ajoutée',
      v_cycle.cycle_code, v_cycle.statut using errcode = 'restrict_violation';
  end if;
  if v_cycle.rt_id <> new.rt_id then
    raise exception 'RT de l''avance différent du RT du cycle' using errcode = 'restrict_violation';
  end if;

  -- Plafond par avance : absence de paramètre = refus.
  v_plafond := public.n1_param_num_obligatoire('plafond_avance_montant_max', new.campagne, v_cycle.cluster, new.rt_id);
  if new.montant > v_plafond then
    perform public.n1_auditer('TENTATIVE_REFUSEE','avances',null,null,to_jsonb(new),
      'Dépassement du plafond avance','REFUSE',null,null,null,new.campagne,v_cycle.cluster,new.rt_id);
    raise exception 'Avance % supérieure au plafond autorisé %', new.montant, v_plafond
      using errcode = 'restrict_violation';
  end if;

  -- Le total des avances d'un cycle ne dépasse jamais le montant autorisé.
  select coalesce(sum(montant),0) into v_total
  from public.avances where cycle_uid = v_cycle.id and n1_statut <> 'ANNULE';
  if v_total + new.montant > v_cycle.montant_autorise then
    raise exception
      'Total des avances (% + %) supérieur au montant autorisé du cycle % (%)',
      v_total, new.montant, v_cycle.cycle_code, v_cycle.montant_autorise
      using errcode = 'restrict_violation';
  end if;

  new.cluster := coalesce(new.cluster, v_cycle.cluster);
  return new;
end $$;

drop trigger if exists trg_n1_avance_garde on public.avances;
drop trigger if exists trg_n1_20_avance_garde on public.avances;
create trigger trg_n1_20_avance_garde
  before insert on public.avances
  for each row execute function public.n1_avance_garde();

-- ---------------------------------------------------------------------------
-- 7) Garde serveur sur les achats — invariants 1, 3, 7, 9, 10, 12
-- ---------------------------------------------------------------------------

create or replace function public.n1_achat_garde()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cycle      public.n1_cycles%rowtype;
  v_attendu    numeric;
  v_tolerance  numeric;
  v_plafond    numeric;
  v_dispo      numeric;
  v_exc_ok     boolean;
begin
  -- 7.1 Auteur, date, entité : invariant 7.
  if new.created_by is null then
    raise exception 'Achat sans auteur : refusé' using errcode = 'restrict_violation';
  end if;
  if new.date is null or new.date > current_date then
    raise exception 'Date d''achat absente ou dans le futur : refusée' using errcode = 'restrict_violation';
  end if;
  if nullif(btrim(coalesce(new.rt_id,'')),'') is null then
    raise exception 'Achat sans RT : refusé' using errcode = 'restrict_violation';
  end if;

  -- 7.2 Référentiel RT : invariant 1.
  if not exists (select 1 from public.rt r
                 where r.id::text = new.rt_id and coalesce(r.deleted,false) = false) then
    raise exception 'RT % absent du référentiel : achat refusé', new.rt_id
      using errcode = 'foreign_key_violation';
  end if;

  -- 7.3 Producteur : référencé, ou explicitement non référencé ET justifié.
  if coalesce(new.producteur_ref, true) then
    if nullif(btrim(coalesce(new.producteur_id,'')),'') is null then
      raise exception 'Achat sans producteur : refusé' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from public.producteurs p
                   where (p.id::text = new.producteur_id or p.code = new.producteur_id)
                     and coalesce(p.deleted,false) = false) then
      raise exception
        'Producteur % absent du référentiel. Pour un producteur non recensé, poser producteur_ref = false et justifier en observation.',
        new.producteur_id using errcode = 'foreign_key_violation';
    end if;
  else
    if nullif(btrim(coalesce(new.observation,'')),'') is null then
      raise exception 'Producteur non référencé : justification obligatoire en observation'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- 7.4 Cohérence physique et monétaire : invariants 9 et 12.
  if new.poids_brut is not null and new.tare is not null then
    if abs((new.poids_brut - new.tare) - new.poids_net) > 0.001 then
      raise exception 'Incohérence de pesée : poids_brut - tare (%) ≠ poids_net (%)',
        (new.poids_brut - new.tare), new.poids_net using errcode = 'restrict_violation';
    end if;
  end if;
  if new.poids_brut is not null and new.poids_net > new.poids_brut then
    raise exception 'Poids net supérieur au poids brut : refusé' using errcode = 'restrict_violation';
  end if;
  if new.humidite is not null and (new.humidite < 0 or new.humidite > 100) then
    raise exception 'Humidité hors bornes (0-100) : %', new.humidite using errcode = 'restrict_violation';
  end if;
  if new.kor is not null and (new.kor < 0 or new.kor > 100) then
    raise exception 'KOR hors bornes (0-100) : %', new.kor using errcode = 'restrict_violation';
  end if;

  -- Tolérance de montant : absence de paramètre = tolérance nulle (le plus strict).
  v_tolerance := coalesce(public.n1_param_num('tolerance_montant_fcfa', new.campagne, new.cluster, new.rt_id), 0);
  v_attendu := round(new.poids_net * new.prix_kg);
  if abs(new.montant - v_attendu) > v_tolerance then
    raise exception
      'Montant % incohérent : poids_net × prix_kg = % (tolérance %). Le montant n''est pas saisi librement.',
      new.montant, v_attendu, v_tolerance using errcode = 'restrict_violation';
  end if;

  -- 7.5 Plafond par achat : absence de paramètre = refus.
  v_plafond := public.n1_param_num_obligatoire('plafond_achat_montant_max', new.campagne, new.cluster, new.rt_id);
  if new.montant > v_plafond then
    perform public.n1_auditer('TENTATIVE_REFUSEE','achats',null,null,to_jsonb(new),
      'Dépassement du plafond achat','REFUSE',null,null,null,new.campagne,new.cluster,new.rt_id);
    raise exception 'Achat % supérieur au plafond autorisé %', new.montant, v_plafond
      using errcode = 'restrict_violation';
  end if;

  -- 7.6 Rattachement au cycle : invariant 1.
  if new.cycle_uid is null then
    select * into v_cycle from public.n1_cycle_actif(new.rt_id, new.campagne);
    if v_cycle.id is null then
      raise exception
        'Aucun cycle de financement ouvert pour le RT % : achat refusé (invariant 1).', new.rt_id
        using errcode = 'restrict_violation';
    end if;
    new.cycle_uid := v_cycle.id;
  else
    select * into v_cycle from public.n1_cycles where id = new.cycle_uid;
    if not found then raise exception 'Cycle introuvable'; end if;
  end if;
  if v_cycle.statut not in ('OUVERT','BLOQUE') then
    raise exception 'Cycle % en statut % : aucun achat ne peut y être rattaché',
      v_cycle.cycle_code, v_cycle.statut using errcode = 'restrict_violation';
  end if;
  if v_cycle.statut = 'BLOQUE' then
    raise exception 'Cycle % bloqué : achats suspendus jusqu''au déblocage par un rôle autorisé',
      v_cycle.cycle_code using errcode = 'restrict_violation';
  end if;

  -- 7.7 Invariant 3 : l'achat ne dépasse pas le financement disponible,
  -- sauf exception approuvée par un tiers et rattachée à ce cycle.
  if not coalesce(new.rejet, false) then
    v_dispo := public.n1_cycle_disponible(v_cycle.id);
    if new.montant > v_dispo then
      select exists (
        select 1 from public.n1_exceptions e
        where e.cycle_uid = v_cycle.id
          and e.type_exception = 'DEPASSEMENT_FINANCEMENT'
          and e.statut = 'APPROUVEE'
          and (e.expire_le is null or e.expire_le > now())
          and e.approuve_par is distinct from new.created_by
      ) into v_exc_ok;

      if not v_exc_ok then
        perform public.n1_auditer('TENTATIVE_REFUSEE','achats',null,null,to_jsonb(new),
          'Financement disponible insuffisant','REFUSE',null,null,null,
          new.campagne,new.cluster,new.rt_id);
        raise exception
          'Financement insuffisant sur le cycle % : disponible % FCFA, achat demandé % FCFA. Réconciliez ou faites approuver une exception.',
          v_cycle.cycle_code, v_dispo, new.montant using errcode = 'restrict_violation';
      end if;
    end if;
  end if;

  -- 7.8 Un achat sans reçu n'est jamais refinançable.
  if public.n1_normaliser_recu(new.numero_recu) is null then
    new.refinancable := false;
  end if;

  new.cluster := coalesce(new.cluster, v_cycle.cluster);
  return new;
end $$;

drop trigger if exists trg_n1_achat_garde on public.achats;
drop trigger if exists trg_n1_20_achat_garde on public.achats;
create trigger trg_n1_20_achat_garde
  before insert on public.achats
  for each row execute function public.n1_achat_garde();

-- ---------------------------------------------------------------------------
-- 8) Séparation des tâches — invariant 8
-- ---------------------------------------------------------------------------
-- Nul ne valide sa propre écriture. La règle est portée par la base, pas par
-- l'écran qui masque un bouton.

create or replace function public.n1_pas_auto_approbation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ancien text; v_nouveau text;
begin
  v_ancien  := old.n1_statut;
  v_nouveau := new.n1_statut;
  if v_ancien is not distinct from v_nouveau then return new; end if;

  if not public.n1_transition_permise('operation', v_ancien, v_nouveau) then
    perform public.n1_auditer('TENTATIVE_REFUSEE',tg_table_name,new.id::text,
      to_jsonb(old),to_jsonb(new),'Transition non autorisée pour ce rôle','REFUSE');
    raise exception 'Transition % → % non autorisée pour le rôle %',
      v_ancien, v_nouveau, coalesce(public.n1_role(),'(aucun)')
      using errcode = 'insufficient_privilege';
  end if;

  if v_nouveau in ('VALIDE','RECONCILIE','CLOTURE','AJUSTE')
     and new.created_by = public.n1_uid() then
    perform public.n1_auditer('TENTATIVE_REFUSEE',tg_table_name,new.id::text,
      to_jsonb(old),to_jsonb(new),'Auto-approbation interdite','REFUSE');
    raise exception
      'Séparation des tâches : l''auteur d''une opération ne peut pas la faire passer en %.',
      v_nouveau using errcode = 'insufficient_privilege';
  end if;

  perform public.n1_auditer('CHANGEMENT_STATUT',tg_table_name,new.id::text,
    to_jsonb(old),to_jsonb(new),null,'ACCEPTE');
  return new;
end $$;

drop trigger if exists trg_n1_pas_auto_approbation on public.achats;
drop trigger if exists trg_n1_30_statut on public.achats;
create trigger trg_n1_30_statut
  before update on public.achats
  for each row execute function public.n1_pas_auto_approbation();

drop trigger if exists trg_n1_pas_auto_approbation on public.avances;
drop trigger if exists trg_n1_30_statut on public.avances;
create trigger trg_n1_30_statut
  before update on public.avances
  for each row execute function public.n1_pas_auto_approbation();

-- ---------------------------------------------------------------------------
-- 9) Changement de rôle : jamais sans trace — invariant 9
-- ---------------------------------------------------------------------------

create or replace function public.n1_profil_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.role is distinct from new.role or old.actif is distinct from new.actif) then
    if new.user_id = public.n1_uid() then
      raise exception 'Auto-modification de rôle ou d''activation interdite'
        using errcode = 'insufficient_privilege';
    end if;
    perform public.n1_auditer('CHANGEMENT_ROLE','profils',new.user_id::text,
      jsonb_build_object('role',old.role,'actif',old.actif),
      jsonb_build_object('role',new.role,'actif',new.actif), null, 'ACCEPTE');
  elsif tg_op = 'INSERT' then
    perform public.n1_auditer('CHANGEMENT_ROLE','profils',new.user_id::text, null,
      jsonb_build_object('role',new.role,'actif',new.actif), 'Création de profil', 'ACCEPTE');
  end if;
  return new;
end $$;

drop trigger if exists trg_n1_profil_audit on public.profils;
drop trigger if exists trg_n1_20_profil_audit on public.profils;
create trigger trg_n1_20_profil_audit
  before insert or update on public.profils
  for each row execute function public.n1_profil_audit();

-- ---------------------------------------------------------------------------
-- 10) Cycle : RLS et droits
-- ---------------------------------------------------------------------------

alter table public.n1_cycles enable row level security;
drop policy if exists n1_cycles_sel on public.n1_cycles;
create policy n1_cycles_sel on public.n1_cycles for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_cycles from authenticated, anon;

alter table public.n1_exceptions enable row level security;
drop policy if exists n1_exc_sel on public.n1_exceptions;
create policy n1_exc_sel on public.n1_exceptions for select to authenticated using (public.est_actif());
revoke insert, update, delete on public.n1_exceptions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 11) Séparation réelle saisie / contrôle / approbation
-- ---------------------------------------------------------------------------
-- ⚠ MODIFICATION DE SÉCURITÉ EXISTANTE — REVUE HUMAINE OBLIGATOIRE.
--
-- Constat : aujourd'hui, achats_upd n'autorise la modification qu'au Branch
-- Manager. Un Supervisor ne peut donc RIEN valider : la « séparation des
-- tâches » est en réalité une concentration de toutes les tâches sur le BM,
-- qui reste libre de valider ses propres achats. Le contrôle des quatre yeux
-- est impossible à un seul rôle.
--
-- Correctif : les rôles de contrôle peuvent modifier une opération, mais
-- UNIQUEMENT sa colonne de statut — le trigger ci-dessous fige tout le reste.
-- Le BM conserve la modification pleine, elle-même bornée par le verrou de
-- clôture (migration 05).

create or replace function public.n1_champs_modifiables()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_libres text[] := array['n1_statut','statut_validation','validated_by','validated_at',
                           'cash_statut','stock_statut','qualite_statut','serveur_recu_le'];
  v_generees text[];
  k text;
begin
  if public.est_bm() then return new; end if;

  -- Écriture ouverte par une RPC déjà contrôlée (rapprochement papier). Le
  -- drapeau n'est posé qu'à l'intérieur de n1_papier_consommer, sur la ligne
  -- exacte concernée, et retombé aussitôt.
  if coalesce(current_setting('n1.papier_en_cours', true), '') = new.id::text then
    return new;
  end if;

  -- Les colonnes GENERATED ALWAYS ... STORED ne sont calculées qu'APRÈS les
  -- triggers BEFORE : dans NEW elles valent NULL alors qu'OLD porte la valeur
  -- stockée. Les comparer produirait un faux écart sur chaque modification.
  select coalesce(array_agg(a.attname::text), array[]::text[])
    into v_generees
  from pg_attribute a
  where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
    and a.attgenerated <> '';

  for k in select jsonb_object_keys(v_new) loop
    if not (k = any (v_libres)) and not (k = any (v_generees))
       and (v_old -> k) is distinct from (v_new -> k) then
      perform public.n1_auditer('TENTATIVE_REFUSEE', tg_table_name, new.id::text,
        v_old, v_new, 'Modification d''un champ non autorisé : ' || k, 'REFUSE');
      raise exception
        'Rôle de contrôle : seul le statut est modifiable. Le champ « % » ne peut pas être changé ici.', k
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_n1_15_champs on public.achats;
create trigger trg_n1_15_champs before update on public.achats
  for each row execute function public.n1_champs_modifiables();
drop trigger if exists trg_n1_15_champs on public.avances;
create trigger trg_n1_15_champs before update on public.avances
  for each row execute function public.n1_champs_modifiables();

create or replace function public.n1_peut_controler()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in
    ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
$$;

drop policy if exists achats_upd on public.achats;
create policy achats_upd on public.achats
  for update to authenticated
  using (public.n1_peut_controler()) with check (public.n1_peut_controler());

drop policy if exists avances_upd on public.avances;
create policy avances_upd on public.avances
  for update to authenticated
  using (public.n1_peut_controler()) with check (public.n1_peut_controler());

revoke all on function public.n1_ouvrir_cycle(text,numeric,numeric,numeric,date,text,uuid) from public;
grant execute on function public.n1_ouvrir_cycle(text,numeric,numeric,numeric,date,text,uuid) to authenticated;
grant execute on function public.n1_cycle_disponible(uuid) to authenticated;
grant execute on function public.n1_rt_refinancable(text,text) to authenticated;
grant execute on function public.n1_transition_permise(text,text,text,text) to authenticated;

commit;
