-- ============================================================================
--  ASSISTANT IA AFLP — JOURNAL DES QUESTIONS, RETOURS ET CATALOGUE VERSIONNÉ
--  Fichier : docs/migrations/aflp_ia_journal_20260815.sql
--  ----------------------------------------------------------------------------
--  ⚠ CETTE MIGRATION N'A PAS ÉTÉ EXÉCUTÉE SUR LE PROJET SUPABASE.
--
--  `supabase/**` est une zone interdite à toute modification automatique
--  (CLAUDE.md §3, .github/agent-policy/auto-merge-denylist.txt), et
--  `modifying-a-hosted-supabase-project` figure parmi les actions interdites
--  d'`agent-policy.yml`. Ce fichier est donc une PROPOSITION, déposée là où les
--  propositions SQL du dépôt vivent déjà (docs/migrations/, cf.
--  sacherie_v2_mvp_20260811.sql et aflp_predictions_20260814.sql). Son exécution
--  est un geste HUMAIN, à faire dans Supabase → SQL Editor, après relecture.
--
--  Elle a en revanche été RÉELLEMENT EXÉCUTÉE sur PostgreSQL 18 (PGlite) par
--  `.github/agent-tests/aflp-ia-journal-rls.mjs`, qui rejoue les politiques RLS
--  rôle par rôle. Ce que ce banc ne prouve pas est écrit dans son en-tête.
--
--  Ordre    : APRÈS supabase/rls.sql (les fonctions est_actif / est_bm /
--             peut_editer_config en viennent).
--  Contrôle : docs/migrations/aflp_ia_journal_verify_20260815.sql
--  Rollback : docs/migrations/aflp_ia_journal_rollback_20260815.sql
--
--  ----------------------------------------------------------------- PRINCIPES
--  1. SÉPARATION. Le journal de l'assistant ne touche à AUCUNE table
--     transactionnelle. Aucune colonne n'est ajoutée à `achats`, `avances`,
--     `reconciliations` ou `sacs_mouvements`. Une question posée n'est pas un
--     fait de gestion.
--
--  2. LE CATALOGUE PUBLIÉ EST IMMUABLE. Corriger une intention publiée est
--     interdit par un DÉCLENCHEUR, pas seulement par une politique : il faut
--     ouvrir une nouvelle version. Sans cela, « la réponse d'hier » ne serait
--     plus explicable aujourd'hui, et toute mesure de compréhension deviendrait
--     incomparable dans le temps.
--
--  3. UNE QUESTION NE MODIFIE JAMAIS LE CATALOGUE. Le chemin est :
--     question → revue humaine → correction → validation → brouillon → tests →
--     publication. Chaque flèche est un acte humain nommé et daté.
--
--  4. AUTORISATION PAR `profils`, JAMAIS PAR `user_metadata`. Toutes les
--     politiques passent par les fonctions existantes du dépôt, qui lisent la
--     table `profils`. `user_metadata` est modifiable par l'utilisateur lui-même :
--     l'employer pour décider d'un droit reviendrait à laisser chacun s'attribuer
--     le rôle qu'il souhaite.
--
--  5. UN SEUL `SECURITY DEFINER`, ET IL EST ENCADRÉ. Le déclencheur d'audit du
--     §5.4 en a besoin : `aflp_ia_audit` n'ouvre aucune politique INSERT — et
--     ne doit pas en ouvrir —, or une fonction de déclencheur ordinaire
--     s'exécute avec les droits de l'utilisateur. Sans SECURITY DEFINER, toute
--     modification du catalogue échouait. Il vit dans le schéma NON EXPOSÉ
--     `aflp_ia_interne`, son `search_path` est figé, et `execute` est révoqué à
--     PUBLIC, `anon` et `authenticated`. Toutes les autres fonctions
--     d'autorisation employées ici viennent de `supabase/rls.sql`, déjà en
--     place et déjà relues.
--     La purge de rétention (§9) n'est PAS une fonction : c'est une commande
--     d'administration, exécutée depuis l'éditeur SQL. En faire une fonction
--     appelable donnerait au navigateur le moyen d'effacer les preuves.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Journal des questions
--    Une ligne par question posée à l'assistant, comprise ou non.
--    `cle_idempotence` est le pivot du mode hors ligne : la file locale rejoue
--    ses envois tant qu'elle n'a pas d'accusé de réception, et c'est cette clé
--    — et elle seule — qui empêche qu'une question compte deux fois dans les
--    métriques.
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_ia_questions (
  id                    uuid primary key default gen_random_uuid(),
  cle_idempotence       text not null unique,
  created_at            timestamptz not null default now(),
  -- Auteur. `user_id` est imposé par la politique INSERT : personne ne peut
  -- journaliser une question au nom d'un autre.
  user_id               uuid not null default auth.uid(),
  user_role             text,
  -- Question. `question_raw` est CAVIARDÉE CÔTÉ CLIENT avant envoi
  -- (shared/aflp-ia-journal.js) : suites de chiffres longues et numéros de
  -- téléphone remplacés. Le caviardage est une réduction de risque, pas une
  -- garantie : la contrainte de longueur ci-dessous en est le second garde-fou.
  question_raw          text not null check (length(question_raw) between 1 and 500),
  question_normalized   text not null check (length(question_normalized) <= 500),
  -- Compréhension
  detected_intent       text,
  detected_scope_type   text check (detected_scope_type is null
                          or detected_scope_type in ('global','zone','cluster','village','rt')),
  detected_scope_id     text,
  detected_period       text check (detected_period is null
                          or detected_period in ('day','week','campaign')),
  confidence            numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Résultat
  result_status         text not null check (result_status in (
                          'compris','partiellement_compris','clarification_demandee',
                          'non_compris','donnee_indisponible','erreur_technique','reponse_produite')),
  answer_type           text check (answer_type is null or answer_type in (
                          'chiffre','liste','texte','refus','clarification','aucune')),
  -- Résumé de la réponse, borné. On journalise ce qui a été dit, pas le détail
  -- ligne à ligne : le journal sert à mesurer la compréhension, pas à rejouer
  -- la comptabilité.
  answer_summary        text check (answer_summary is null or length(answer_summary) <= 500),
  data_reference_date   date,
  engine_version        text,
  catalog_version       text,
  -- La couche linguistique a-t-elle été sollicitée pour CETTE question ?
  language_layer_used   boolean not null default false,
  latency_ms            integer check (latency_ms is null or latency_ms >= 0),
  error_code            text,
  -- Origine : en ligne, ou rejeu d'une question posée hors connexion.
  origine               text not null default 'en_ligne'
                        check (origine in ('en_ligne','file_locale'))
);

create index if not exists aflp_ia_q_date_idx    on public.aflp_ia_questions (created_at desc);
create index if not exists aflp_ia_q_intent_idx  on public.aflp_ia_questions (detected_intent, created_at desc);
create index if not exists aflp_ia_q_statut_idx  on public.aflp_ia_questions (result_status, created_at desc);
create index if not exists aflp_ia_q_user_idx    on public.aflp_ia_questions (user_id, created_at desc);
-- Index partiel : la file de revue ne s'intéresse qu'à ce qui a échoué.
create index if not exists aflp_ia_q_arevoir_idx on public.aflp_ia_questions (created_at desc)
  where result_status in ('non_compris','partiellement_compris','clarification_demandee');

comment on table public.aflp_ia_questions is
  'Journal des questions posées à l''Assistant IA AFLP. Aucune écriture métier n''en dépend. '
  'La lecture est limitée : chacun voit ses propres questions, les rôles de supervision voient tout.';
comment on column public.aflp_ia_questions.cle_idempotence is
  'Identifiant généré par le client. Empêche qu''une question rejouée après une coupure réseau '
  'soit comptée deux fois dans les métriques.';

-- ---------------------------------------------------------------------------
-- 2. Retours et corrections
--    Deux natures dans une seule table, distinguées par `feedback_type` :
--      · le retour d'un utilisateur (« cette réponse est fausse ») ;
--      · la correction proposée par un relecteur (intention, portée, période).
--    `approval_status` porte le workflow. Une correction n'entre au catalogue
--    que validée, et jamais automatiquement.
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_ia_feedback (
  id                  uuid primary key default gen_random_uuid(),
  question_id         uuid not null references public.aflp_ia_questions(id) on delete cascade,
  created_at          timestamptz not null default now(),
  auteur_uid          uuid not null default auth.uid(),
  feedback_type       text not null check (feedback_type in (
                        'reponse_correcte','reponse_incorrecte','intention_incorrecte',
                        'portee_incorrecte','periode_incorrecte','hors_perimetre','a_entrainer')),
  correct_intent      text,
  correct_scope_type  text check (correct_scope_type is null
                        or correct_scope_type in ('global','zone','cluster','village','rt')),
  correct_scope_id    text,
  correct_period      text check (correct_period is null
                        or correct_period in ('day','week','campaign')),
  comment             text check (comment is null or length(comment) <= 1000),
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  approval_status     text not null default 'en_attente'
                      check (approval_status in ('en_attente','valide','rejete','applique')),
  -- Une validation sans relecteur nommé n'est pas une validation.
  constraint aflp_ia_fb_validation_nominative check (
    approval_status = 'en_attente'
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists aflp_ia_fb_question_idx on public.aflp_ia_feedback (question_id);
create index if not exists aflp_ia_fb_statut_idx   on public.aflp_ia_feedback (approval_status, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Catalogue versionné
--    Le catalogue de référence reste `shared/aflp-ia-catalogue.js` : c'est lui
--    qui répond hors ligne, et le mode hors ligne n'est pas une option sur ce
--    terrain. Ces tables portent le CYCLE DE VIE des versions et des
--    formulations issues de la revue humaine — ce qu'un fichier statique ne
--    peut pas porter : qui a proposé, qui a validé, quand, et sur quelle
--    version.
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_ia_catalogue_versions (
  version     text primary key check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  statut      text not null default 'brouillon'
              check (statut in ('brouillon','publie','retire')),
  notes       text,
  cree_par    uuid not null default auth.uid(),
  cree_le     timestamptz not null default now(),
  publie_par  uuid,
  publie_le   timestamptz,
  retire_le   timestamptz,
  -- Publier sans nommer qui publie rendrait l'audit décoratif.
  constraint aflp_ia_ver_publication_nominative check (
    statut <> 'publie' or (publie_par is not null and publie_le is not null)
  )
);

create table if not exists public.aflp_ia_intentions (
  id                uuid primary key default gen_random_uuid(),
  version           text not null references public.aflp_ia_catalogue_versions(version),
  code              text not null check (code ~ '^[a-z][a-z0-9_]+$'),
  nom               text not null,
  description       text not null,
  fonction          text,
  donnees_requises  text[] not null default '{}',
  portees           text[] not null default '{}',
  periodes          text[] not null default '{}',
  filtres           text[] not null default '{}',
  confiance_min     numeric not null default 0.55
                    check (confiance_min > 0 and confiance_min < 1),
  statut            text not null default 'brouillon'
                    check (statut in ('brouillon','publie','non_disponible','desactive')),
  donnee_manquante  text,
  cree_par          uuid not null default auth.uid(),
  cree_le           timestamptz not null default now(),
  unique (version, code),
  -- Une intention publiée sans fonction de calcul ne peut rien répondre.
  constraint aflp_ia_int_publiee_a_une_fonction check (
    statut <> 'publie' or (fonction is not null and length(btrim(fonction)) > 0)
  ),
  -- Une intention indisponible doit NOMMER ce qui manque, sinon le refus
  -- devient un « je ne sais pas » sans valeur pour celui qui le lit.
  constraint aflp_ia_int_indispo_nomme_la_donnee check (
    statut <> 'non_disponible' or (donnee_manquante is not null and length(btrim(donnee_manquante)) > 0)
  )
);

create table if not exists public.aflp_ia_formulations (
  id               uuid primary key default gen_random_uuid(),
  version          text not null references public.aflp_ia_catalogue_versions(version),
  code_intention   text not null,
  texte            text not null check (length(btrim(texte)) between 3 and 300),
  -- Forme normalisée : minuscules, sans accent ni ponctuation. C'est elle qui
  -- porte l'unicité — sinon « Combien de RT à Béoumi ? » et « combien de rt a
  -- beoumi » entreraient deux fois et fausseraient le poids du corpus.
  texte_normalise  text not null,
  origine          text not null default 'catalogue'
                   check (origine in ('catalogue','question_validee','correction_manuelle')),
  actif            boolean not null default true,
  motif_desactivation text,
  question_source  uuid references public.aflp_ia_questions(id) on delete set null,
  cree_par         uuid not null default auth.uid(),
  cree_le          timestamptz not null default now(),
  unique (version, texte_normalise)
);

create index if not exists aflp_ia_form_intent_idx on public.aflp_ia_formulations (version, code_intention);

-- ---------------------------------------------------------------------------
-- 4. Audit des modifications du catalogue — append-only
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_ia_audit (
  id           uuid primary key default gen_random_uuid(),
  table_cible  text not null,
  ligne_id     uuid,
  operation    text not null check (operation in ('INSERT','UPDATE','DELETE')),
  avant        jsonb,
  apres        jsonb,
  auteur_uid   uuid default auth.uid(),
  cree_le      timestamptz not null default now()
);
create index if not exists aflp_ia_audit_cible_idx on public.aflp_ia_audit (table_cible, cree_le desc);

-- ---------------------------------------------------------------------------
-- 5. Déclencheurs
-- ---------------------------------------------------------------------------

-- 5.1 Immutabilité du journal des questions.
--     Au niveau du DÉCLENCHEUR et non de la seule RLS : la RLS ne s'applique ni
--     au propriétaire de la table ni à `service_role`. Le déclencheur, si.
--     Une mesure de compréhension calculée sur un journal réécriturable ne
--     mesure rien.
create or replace function public.aflp_ia_questions_immuables()
returns trigger language plpgsql as $$
begin
  raise exception
    'aflp_ia_questions est en écriture unique. Opération % refusée : une question '
    'posée ne se réécrit pas. Corrigez-la par une ligne de aflp_ia_feedback.', tg_op;
end;
$$;

drop trigger if exists aflp_ia_q_no_update on public.aflp_ia_questions;
create trigger aflp_ia_q_no_update
  before update on public.aflp_ia_questions
  for each row execute function public.aflp_ia_questions_immuables();

-- 5.2 Un catalogue PUBLIÉ ne se modifie pas.
--     C'est la règle qui force le versionnement. Sans elle, « corriger une
--     formulation » et « publier une nouvelle version » deviendraient le même
--     geste, et la version journalisée avec chaque question ne voudrait plus
--     rien dire.
create or replace function public.aflp_ia_catalogue_fige()
returns trigger language plpgsql as $$
declare
  v_statut text;
  v_version text;
begin
  v_version := coalesce(old.version, new.version);
  select statut into v_statut from public.aflp_ia_catalogue_versions where version = v_version;
  if v_statut = 'publie' then
    raise exception
      'La version % du catalogue est publiée : ni ses intentions ni ses formulations '
      'ne peuvent être modifiées. Ouvrez une nouvelle version en brouillon.', v_version;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists aflp_ia_int_fige  on public.aflp_ia_intentions;
drop trigger if exists aflp_ia_form_fige on public.aflp_ia_formulations;
create trigger aflp_ia_int_fige
  before update or delete on public.aflp_ia_intentions
  for each row execute function public.aflp_ia_catalogue_fige();
create trigger aflp_ia_form_fige
  before update or delete on public.aflp_ia_formulations
  for each row execute function public.aflp_ia_catalogue_fige();

-- 5.3 Une version publiée ne redevient pas brouillon.
--     On ne « dépublie » pas : on retire, et l'on publie une version suivante.
--     Revenir en arrière ferait exister deux catalogues différents portant le
--     même numéro de version.
create or replace function public.aflp_ia_version_transition()
returns trigger language plpgsql as $$
begin
  if old.statut = 'publie' and new.statut = 'brouillon' then
    raise exception
      'Une version publiée ne peut pas redevenir un brouillon. Retirez-la (statut « retire ») '
      'et publiez une version suivante.';
  end if;
  if old.statut = 'retire' and new.statut <> 'retire' then
    raise exception 'Une version retirée ne peut pas être réactivée.';
  end if;
  if new.statut = 'publie' and old.statut <> 'publie' then
    new.publie_le := coalesce(new.publie_le, now());
    new.publie_par := coalesce(new.publie_par, auth.uid());
  end if;
  if new.statut = 'retire' and old.statut <> 'retire' then
    new.retire_le := coalesce(new.retire_le, now());
  end if;
  return new;
end;
$$;

drop trigger if exists aflp_ia_ver_transition on public.aflp_ia_catalogue_versions;
create trigger aflp_ia_ver_transition
  before update on public.aflp_ia_catalogue_versions
  for each row execute function public.aflp_ia_version_transition();

-- 5.4 Audit automatique du catalogue.
--
--     LE SEUL `SECURITY DEFINER` DE CETTE MIGRATION, et sa justification.
--
--     Une fonction de déclencheur ordinaire s'exécute avec les droits de
--     l'UTILISATEUR qui a déclenché l'écriture, pas avec ceux du propriétaire de
--     la fonction. Comme `aflp_ia_audit` n'ouvre aucune politique INSERT — et ne
--     doit surtout pas en ouvrir, sans quoi n'importe qui fabriquerait des
--     lignes d'audit —, la version simple échouait :
--       « new row violates row-level security policy for table "aflp_ia_audit" »
--     et rendait toute modification du catalogue impossible.
--
--     Ce défaut n'était PAS visible à la lecture. Il a été trouvé en exécutant
--     la migration puis en tentant réellement l'insertion
--     (.github/agent-tests/aflp-ia-journal-rls.mjs).
--
--     Les quatre précautions demandées sont appliquées :
--       · la fonction vit dans un schéma NON EXPOSÉ par PostgREST
--         (`aflp_ia_interne` n'est pas dans `Exposed schemas`) ;
--       · `execute` est révoqué à PUBLIC, `anon` et `authenticated` — personne
--         ne peut l'appeler directement ; un déclencheur, lui, n'a pas besoin
--         de ce droit pour s'exécuter ;
--       · `search_path` est figé, ce qui interdit le détournement par un
--         schéma temporaire ;
--       · elle n'écrit QUE dans `aflp_ia_audit`, et y écrit `auth.uid()` :
--         elle ne peut donc rien falsifier d'autre que l'horodatage.
create schema if not exists aflp_ia_interne;
revoke all on schema aflp_ia_interne from public;

create or replace function aflp_ia_interne.auditer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.aflp_ia_audit (table_cible, ligne_id, operation, avant, apres, auteur_uid)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

revoke all on function aflp_ia_interne.auditer() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function aflp_ia_interne.auditer() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function aflp_ia_interne.auditer() from authenticated';
  end if;
end
$$;

-- L'ancienne fonction, si une première version a été appliquée : on la retire
-- pour qu'il n'en reste qu'une seule, à l'endroit voulu.
drop function if exists public.aflp_ia_auditer() cascade;

drop trigger if exists aflp_ia_int_audit  on public.aflp_ia_intentions;
drop trigger if exists aflp_ia_form_audit on public.aflp_ia_formulations;
create trigger aflp_ia_int_audit
  after insert or update or delete on public.aflp_ia_intentions
  for each row execute function aflp_ia_interne.auditer();
create trigger aflp_ia_form_audit
  after insert or update or delete on public.aflp_ia_formulations
  for each row execute function aflp_ia_interne.auditer();

-- 5.5 L'audit ne se réécrit pas.
create or replace function public.aflp_ia_audit_immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'aflp_ia_audit est en écriture unique : opération % refusée.', tg_op;
end;
$$;
drop trigger if exists aflp_ia_audit_no_update on public.aflp_ia_audit;
create trigger aflp_ia_audit_no_update
  before update or delete on public.aflp_ia_audit
  for each row execute function public.aflp_ia_audit_immuable();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--    Aucune politique n'est ouverte à `TO authenticated` sans prédicat : être
--    connecté n'est pas une autorisation. Toutes les politiques UPDATE portent
--    `USING` ET `WITH CHECK` — sans le second, un relecteur pourrait modifier
--    une ligne qu'il a le droit de voir vers un état qu'il n'a pas le droit
--    d'écrire.
-- ---------------------------------------------------------------------------
alter table public.aflp_ia_questions          enable row level security;
alter table public.aflp_ia_feedback           enable row level security;
alter table public.aflp_ia_catalogue_versions enable row level security;
alter table public.aflp_ia_intentions         enable row level security;
alter table public.aflp_ia_formulations       enable row level security;
alter table public.aflp_ia_audit              enable row level security;

-- 6.1 Journal des questions.
drop policy if exists aflp_ia_q_sel_self    on public.aflp_ia_questions;
drop policy if exists aflp_ia_q_sel_revue   on public.aflp_ia_questions;
drop policy if exists aflp_ia_q_ins         on public.aflp_ia_questions;
-- Chacun lit ses propres questions…
create policy aflp_ia_q_sel_self on public.aflp_ia_questions
  for select to authenticated
  using (public.est_actif() and user_id = auth.uid());
-- …les rôles de supervision lisent tout le journal.
create policy aflp_ia_q_sel_revue on public.aflp_ia_questions
  for select to authenticated
  using (public.peut_editer_config());
-- On journalise pour soi et seulement pour soi.
create policy aflp_ia_q_ins on public.aflp_ia_questions
  for insert to authenticated
  with check (public.est_actif() and user_id = auth.uid());
-- Aucune politique UPDATE ni DELETE : le journal est en lecture seule après
-- écriture, y compris pour son auteur.

-- 6.2 Retours.
drop policy if exists aflp_ia_fb_sel_self  on public.aflp_ia_feedback;
drop policy if exists aflp_ia_fb_sel_revue on public.aflp_ia_feedback;
drop policy if exists aflp_ia_fb_ins       on public.aflp_ia_feedback;
drop policy if exists aflp_ia_fb_upd       on public.aflp_ia_feedback;
create policy aflp_ia_fb_sel_self on public.aflp_ia_feedback
  for select to authenticated
  using (public.est_actif() and auteur_uid = auth.uid());
create policy aflp_ia_fb_sel_revue on public.aflp_ia_feedback
  for select to authenticated
  using (public.peut_editer_config());
-- Tout profil actif peut signaler une réponse fausse : c'est le seul moyen de
-- savoir qu'elle l'était. Mais il ne peut le faire qu'en son nom, et il ne peut
-- pas valider lui-même son signalement.
create policy aflp_ia_fb_ins on public.aflp_ia_feedback
  for insert to authenticated
  with check (
    public.est_actif()
    and auteur_uid = auth.uid()
    and approval_status = 'en_attente'
    and reviewed_by is null
  );
-- La validation est un acte de supervision, et le validateur se nomme.
create policy aflp_ia_fb_upd on public.aflp_ia_feedback
  for update to authenticated
  using (public.peut_editer_config())
  with check (public.peut_editer_config() and reviewed_by = auth.uid());

-- 6.3 Versions du catalogue.
drop policy if exists aflp_ia_ver_sel on public.aflp_ia_catalogue_versions;
drop policy if exists aflp_ia_ver_ins on public.aflp_ia_catalogue_versions;
drop policy if exists aflp_ia_ver_upd on public.aflp_ia_catalogue_versions;
create policy aflp_ia_ver_sel on public.aflp_ia_catalogue_versions
  for select to authenticated using (public.est_actif());
-- Ouvrir un brouillon : supervision. Une version naît toujours en brouillon.
create policy aflp_ia_ver_ins on public.aflp_ia_catalogue_versions
  for insert to authenticated
  with check (public.peut_editer_config() and statut = 'brouillon' and cree_par = auth.uid());
-- PUBLIER : le Branch Manager, et lui seul.
create policy aflp_ia_ver_upd on public.aflp_ia_catalogue_versions
  for update to authenticated
  using (public.est_bm()) with check (public.est_bm());

-- 6.4 Intentions et formulations.
drop policy if exists aflp_ia_int_sel on public.aflp_ia_intentions;
drop policy if exists aflp_ia_int_ins on public.aflp_ia_intentions;
drop policy if exists aflp_ia_int_upd on public.aflp_ia_intentions;
drop policy if exists aflp_ia_int_del on public.aflp_ia_intentions;
create policy aflp_ia_int_sel on public.aflp_ia_intentions
  for select to authenticated using (public.est_actif());
create policy aflp_ia_int_ins on public.aflp_ia_intentions
  for insert to authenticated
  with check (public.peut_editer_config() and cree_par = auth.uid());
create policy aflp_ia_int_upd on public.aflp_ia_intentions
  for update to authenticated
  using (public.peut_editer_config()) with check (public.peut_editer_config());
create policy aflp_ia_int_del on public.aflp_ia_intentions
  for delete to authenticated using (public.est_bm());

drop policy if exists aflp_ia_form_sel on public.aflp_ia_formulations;
drop policy if exists aflp_ia_form_ins on public.aflp_ia_formulations;
drop policy if exists aflp_ia_form_upd on public.aflp_ia_formulations;
drop policy if exists aflp_ia_form_del on public.aflp_ia_formulations;
create policy aflp_ia_form_sel on public.aflp_ia_formulations
  for select to authenticated using (public.est_actif());
create policy aflp_ia_form_ins on public.aflp_ia_formulations
  for insert to authenticated
  with check (public.peut_editer_config() and cree_par = auth.uid());
create policy aflp_ia_form_upd on public.aflp_ia_formulations
  for update to authenticated
  using (public.peut_editer_config()) with check (public.peut_editer_config());
create policy aflp_ia_form_del on public.aflp_ia_formulations
  for delete to authenticated using (public.est_bm());

-- 6.5 Audit : lecture de supervision, écriture par déclencheur uniquement.
drop policy if exists aflp_ia_audit_sel on public.aflp_ia_audit;
create policy aflp_ia_audit_sel on public.aflp_ia_audit
  for select to authenticated using (public.peut_editer_config());
-- AUCUNE politique INSERT, et c'est volontaire : si les utilisateurs pouvaient
-- écrire dans l'audit, celui-ci ne prouverait plus rien. Les lignes n'arrivent
-- que par `aflp_ia_interne.auditer()` (§5.4), qui est `security definer` pour
-- cette raison précise et pour aucune autre.

-- ---------------------------------------------------------------------------
-- 7. Droits explicites
--    Le pré-contrôle du 14/08/2026 sur la base réelle a montré que `DELETE` et
--    `TRUNCATE` étaient accordés à `anon` et `authenticated` sur les tables
--    sensibles. Ce n'est pas exploitable via PostgREST, mais on ne construit
--    pas une table de journal en comptant là-dessus.
-- ---------------------------------------------------------------------------
revoke all on public.aflp_ia_questions          from anon;
revoke all on public.aflp_ia_feedback           from anon;
revoke all on public.aflp_ia_catalogue_versions from anon;
revoke all on public.aflp_ia_intentions         from anon;
revoke all on public.aflp_ia_formulations       from anon;
revoke all on public.aflp_ia_audit              from anon;

-- `alter default privileges … grant all on tables to authenticated` existe sur
-- ce projet : une table neuve naît donc avec TOUS les privilèges accordés. Les
-- politiques RLS suffisent à filtrer les lignes, mais un privilège non révoqué
-- se combine mal avec une politique ajoutée par erreur plus tard. On retire
-- donc explicitement ce qu'aucune politique n'autorise.
revoke update, delete, truncate on public.aflp_ia_questions from authenticated;
revoke update, delete, truncate on public.aflp_ia_audit from authenticated;
revoke insert on public.aflp_ia_audit from authenticated;
revoke delete on public.aflp_ia_feedback from authenticated;
revoke truncate on public.aflp_ia_feedback           from authenticated;
revoke truncate on public.aflp_ia_intentions         from authenticated;
revoke truncate on public.aflp_ia_formulations       from authenticated;
revoke truncate on public.aflp_ia_catalogue_versions from authenticated;

grant select, insert on public.aflp_ia_questions to authenticated;
grant select, insert, update on public.aflp_ia_feedback to authenticated;
grant select, insert, update, delete on public.aflp_ia_intentions to authenticated;
grant select, insert, update, delete on public.aflp_ia_formulations to authenticated;
grant select, insert, update on public.aflp_ia_catalogue_versions to authenticated;
grant select on public.aflp_ia_audit to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Vue de métriques
--    `security_invoker = true` : la vue s'exécute avec les droits de celui qui
--    l'interroge, donc la RLS de `aflp_ia_questions` s'applique. Sans cette
--    option, une vue est évaluée avec les droits de son propriétaire et
--    devient un contournement propre de la RLS — c'est le piège classique.
--    Conséquence VOULUE : un utilisateur ordinaire ne voit dans cette vue que
--    l'agrégat de SES questions ; les rôles de supervision voient tout.
-- ---------------------------------------------------------------------------
drop view if exists public.aflp_ia_metriques;
create view public.aflp_ia_metriques
with (security_invoker = true) as
select
  date_trunc('day', created_at)::date              as jour,
  catalog_version,
  detected_intent,
  detected_scope_type,
  count(*)                                          as questions,
  count(*) filter (where result_status in ('compris','reponse_produite'))   as comprises,
  count(*) filter (where result_status = 'partiellement_compris')           as partiellement,
  count(*) filter (where result_status = 'clarification_demandee')          as clarifications,
  count(*) filter (where result_status = 'non_compris')                     as non_comprises,
  count(*) filter (where result_status = 'donnee_indisponible')             as donnees_indisponibles,
  count(*) filter (where result_status = 'erreur_technique')                as erreurs,
  count(*) filter (where language_layer_used)                               as via_couche_linguistique,
  round(avg(latency_ms)::numeric, 1)                                        as latence_moyenne_ms,
  round(avg(confidence)::numeric, 3)                                        as confiance_moyenne
from public.aflp_ia_questions
group by 1, 2, 3, 4;

comment on view public.aflp_ia_metriques is
  'Métriques de compréhension de l''Assistant IA AFLP. security_invoker : la RLS de '
  'aflp_ia_questions s''applique, un utilisateur ordinaire n''y voit que ses propres questions. '
  'L''EXACTITUDE ne figure pas ici : elle ne se déduit pas du journal, elle exige une revue '
  'humaine (table aflp_ia_feedback).';

-- ---------------------------------------------------------------------------
-- 9. Rétention
--    Durée configurable, portée par `parametres_calcul` si la table existe.
--    La purge n'est PAS une fonction ouverte au navigateur : c'est une commande
--    d'administration, exécutée depuis l'éditeur SQL ou par une tâche
--    planifiée. En faire une fonction appelable depuis PostgREST reviendrait à
--    donner à un navigateur le moyen d'effacer les preuves.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.parametres_calcul') is not null then
    insert into public.parametres_calcul (cle, valeur)
    values ('aflp_ia_retention_jours', '180')
    on conflict (cle) do nothing;
  end if;
end
$$;

-- Commande de purge, à exécuter manuellement (voir docs/aflp_ia_langue_apprentissage_20260815.md) :
--
--   delete from public.aflp_ia_questions
--   where created_at < now() - (
--     coalesce((select valeur from public.parametres_calcul where cle = 'aflp_ia_retention_jours'),
--              '180')::int * interval '1 day');
--
-- Les retours (`aflp_ia_feedback`) suivent par `on delete cascade`. L'audit du
-- catalogue n'est JAMAIS purgé : il porte la traçabilité des décisions.

-- ---------------------------------------------------------------------------
-- 10. Amorçage — version 1.0.0, publiée
--     Elle décrit le catalogue livré dans shared/aflp-ia-catalogue.js. Les
--     lignes d'intentions sont insérées par l'interface d'administration ou par
--     le script d'import documenté ; on n'en duplique pas ici trente, au risque
--     qu'elles divergent du fichier dès la première correction.
-- ---------------------------------------------------------------------------
insert into public.aflp_ia_catalogue_versions (version, statut, notes, cree_par, publie_par, publie_le)
values ('1.0.0', 'publie',
  'Catalogue initial de 30 intentions, livré avec shared/aflp-ia-catalogue.js. '
  'Référence de comparaison pour toutes les versions suivantes.',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000', now())
on conflict (version) do nothing;

-- ============================================================================
--  APRÈS EXÉCUTION — lancer docs/migrations/aflp_ia_journal_verify_20260815.sql
-- ============================================================================
