-- AFLP 2027 · Coopératives · 7a — Enrôlement producteurs : schéma additif.
--
-- Principe inchangé : UN SEUL registre producteurs (public.producteurs). Ce lot
-- n'ajoute aucune base parallèle. Les tables créées ici sont :
--   * aflp_coop_import_batches     : trace de chaque import Excel (aucune ligne perdue) ;
--   * aflp_coop_enrollment_reviews : file « À vérifier / À compléter » — un candidat qui
--     n'est PAS encore un producteur (doublon possible ou dossier insuffisant) ; il ne
--     devient un producteur qu'après décision explicite ;
--   * aflp_coop_trainings / aflp_coop_training_attendance : formations réellement tenues.
-- Aucune donnée existante n'est modifiée. Aucune suppression.

begin;

-- ------------------------------------------------------------ livraisons (mode B)
alter table public.aflp_coop_deliveries add column if not exists truck text;
alter table public.aflp_coop_deliveries add column if not exists driver text;
alter table public.aflp_coop_deliveries add column if not exists transporter text;
alter table public.aflp_coop_deliveries add column if not exists origin text;

-- ------------------------------------------------------------- lots d'import Excel
create table if not exists public.aflp_coop_import_batches (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  campaign text not null default '2027',
  file_name text,
  total_rows int not null default 0,
  nouveaux int not null default 0,
  existants_associes int not null default 0,
  a_completer int not null default 0,
  doublons_a_verifier int not null default 0,
  rejetes int not null default 0,
  ignores int not null default 0,
  details jsonb not null default '[]'::jsonb,
  status text not null default 'EN_COURS' check (status in ('EN_COURS','TERMINE')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_email text default public.fbms_email(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists aflp_imp_batch_coop_idx on public.aflp_coop_import_batches(cooperative_id, created_at desc);

-- ---------------------------------------------- file « À vérifier / À compléter »
create table if not exists public.aflp_coop_enrollment_reviews (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  campaign text not null default '2027',
  batch_id uuid references public.aflp_coop_import_batches(id),
  row_index int,
  source text not null default 'FORMULAIRE' check (source in ('FORMULAIRE','IMPORT_EXCEL')),
  category text not null check (category in ('DOUBLON_A_VERIFIER','A_COMPLETER')),
  candidate jsonb not null default '{}'::jsonb,
  matches jsonb not null default '[]'::jsonb,
  top_confidence int,
  reason text,
  status text not null default 'OUVERT' check (status in ('OUVERT','RESOLU')),
  decision text check (decision is null or decision in ('ASSOCIER_EXISTANT','CREER_JUSTIFIE','ENROLE_APRES_COMPLEMENT','IGNORER')),
  decision_reason text,
  resolved_producer_id text references public.producteurs(id),
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz,
  is_qa boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_email text default public.fbms_email(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint aflp_rev_resolution check ((status = 'RESOLU') = (decision is not null))
);
create index if not exists aflp_rev_coop_idx on public.aflp_coop_enrollment_reviews(cooperative_id, status, created_at desc);
create index if not exists aflp_rev_batch_idx on public.aflp_coop_enrollment_reviews(batch_id);

-- ---------------------------------------------------------------- formations
create table if not exists public.aflp_coop_trainings (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.aflp_cooperatives(id),
  campaign text not null default '2027',
  topic text not null check (btrim(topic) <> ''),
  category text not null default 'BONNES_PRATIQUES' check (category in
    ('BONNES_PRATIQUES','QUALITE_POST_RECOLTE','SECURITE_PHYTOSANITAIRE','ENVIRONNEMENT','SOCIAL_DROITS','GOUVERNANCE_COOP','AUTRE')),
  training_date date not null check (training_date <= current_date + 1),
  trainer text,
  location text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists aflp_trn_coop_idx on public.aflp_coop_trainings(cooperative_id, training_date desc);

create table if not exists public.aflp_coop_training_attendance (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.aflp_coop_trainings(id),
  producer_id text not null references public.producteurs(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (training_id, producer_id)
);
create index if not exists aflp_trn_att_prod_idx on public.aflp_coop_training_attendance(producer_id);

-- ----------------------------------------------------------- index anti-doublon
create index if not exists producteurs_phone_alt_norm_idx on public.producteurs (public.farmer_registry_norm_phone(telephone_alt))
  where not deleted and telephone_alt is not null;
create index if not exists producteurs_fullname_norm_idx on public.producteurs
  (public.farmer_registry_norm_text(coalesce(nom,'') || ' ' || coalesce(prenoms,''))) where not deleted;
create index if not exists producteurs_code_upper_idx on public.producteurs (upper(code));

-- ------------------------------------------------------------------- triggers
create or replace trigger aflp_imp_touch before update on public.aflp_coop_import_batches
  for each row execute function private.aflp_coop_touch();
create or replace trigger aflp_rev_touch before update on public.aflp_coop_enrollment_reviews
  for each row execute function private.aflp_coop_touch();
create or replace trigger aflp_trn_touch before update on public.aflp_coop_trainings
  for each row execute function private.aflp_coop_touch();
create or replace trigger aflp_imp_nodelete before delete on public.aflp_coop_import_batches
  for each row execute function private.aflp_coop_block_delete();
create or replace trigger aflp_rev_nodelete before delete on public.aflp_coop_enrollment_reviews
  for each row execute function private.aflp_coop_block_delete();
create or replace trigger aflp_trn_nodelete before delete on public.aflp_coop_trainings
  for each row execute function private.aflp_coop_block_delete();
create or replace trigger aflp_rev_audit after insert or update on public.aflp_coop_enrollment_reviews
  for each row execute function private.aflp_coop_audit_trigger();
create or replace trigger aflp_trn_audit after insert or update on public.aflp_coop_trainings
  for each row execute function private.aflp_coop_audit_trigger();

-- ------------------------------------------------------------------------ RLS
alter table public.aflp_coop_import_batches enable row level security;
alter table public.aflp_coop_enrollment_reviews enable row level security;
alter table public.aflp_coop_trainings enable row level security;
alter table public.aflp_coop_training_attendance enable row level security;

-- Lots d'import et file de vérification : données nominatives de candidats →
-- visibles uniquement des éditeurs de la coopérative (encadrement terrain dans le
-- périmètre). Écriture exclusivement par RPC (SECURITY DEFINER contrôlées).
create policy aflp_imp_sel on public.aflp_coop_import_batches for select to authenticated
  using (private.aflp_coop_can_edit(cooperative_id));
create policy aflp_rev_sel on public.aflp_coop_enrollment_reviews for select to authenticated
  using (private.aflp_coop_can_edit(cooperative_id));

-- Formations : session lisible par quiconque lit la coopérative ; présence
-- nominative lisible seulement si le producteur est dans le périmètre.
create policy aflp_trn_sel on public.aflp_coop_trainings for select to authenticated
  using (private.aflp_coop_can_read(cooperative_id));
create policy aflp_trn_ins on public.aflp_coop_trainings for insert to authenticated
  with check (private.aflp_coop_can_edit(cooperative_id));
create policy aflp_trn_upd on public.aflp_coop_trainings for update to authenticated
  using (private.aflp_coop_can_edit(cooperative_id)) with check (private.aflp_coop_can_edit(cooperative_id));
create policy aflp_trn_att_sel on public.aflp_coop_training_attendance for select to authenticated
  using (exists (select 1 from public.aflp_coop_trainings t where t.id = training_id and private.aflp_coop_can_read(t.cooperative_id))
         and private.farmer_registry_can_access_producteur(producer_id));
create policy aflp_trn_att_ins on public.aflp_coop_training_attendance for insert to authenticated
  with check (exists (select 1 from public.aflp_coop_trainings t where t.id = training_id and private.aflp_coop_can_edit(t.cooperative_id))
              and private.farmer_registry_can_access_producteur(producer_id));

revoke all on public.aflp_coop_import_batches, public.aflp_coop_enrollment_reviews,
              public.aflp_coop_trainings, public.aflp_coop_training_attendance from anon;
revoke all on public.aflp_coop_import_batches, public.aflp_coop_enrollment_reviews,
              public.aflp_coop_trainings, public.aflp_coop_training_attendance from authenticated;
grant select on public.aflp_coop_import_batches, public.aflp_coop_enrollment_reviews to authenticated;
grant select, insert, update on public.aflp_coop_trainings to authenticated;
grant select, insert on public.aflp_coop_training_attendance to authenticated;

commit;
