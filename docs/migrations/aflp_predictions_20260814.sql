-- ============================================================================
--  AFLP — NIVEAU 3 : STOCKAGE DES PRÉDICTIONS
--  Fichier : docs/migrations/aflp_predictions_20260814.sql
--  ----------------------------------------------------------------------------
--  ⚠ CETTE MIGRATION N'A PAS ÉTÉ EXÉCUTÉE.
--
--  `supabase/**` est une zone interdite à toute modification automatique
--  (CLAUDE.md §3, .github/agent-policy/auto-merge-denylist.txt). Ce fichier est
--  donc une PROPOSITION, déposée là où les propositions SQL du dépôt vivent
--  déjà (docs/migrations/, cf. sacherie_v2_mvp_20260811.sql). Son exécution est
--  un geste humain, à faire dans Supabase → SQL Editor, après relecture.
--
--  Ordre : APRÈS supabase/rls.sql, supabase/achats.sql et supabase/cash.sql.
--  Rollback : docs/migrations/aflp_predictions_rollback_20260814.sql
--  Contrôle : docs/migrations/aflp_predictions_verify_20260814.sql
--
--  ----------------------------------------------------------------- PRINCIPES
--  1. SÉPARATION. Les prédictions ne vivent JAMAIS dans une table
--     transactionnelle. Aucune colonne n'est ajoutée à `achats`, `avances`,
--     `reconciliations` ou `sacs_mouvements`. Une prédiction n'est pas un fait.
--
--  2. MOINDRE PRIVILÈGE. Le rôle technique `aflp_model` lit ce dont les modèles
--     ont besoin et écrit dans son seul périmètre. Les REVOKE explicites du §6
--     ne sont pas décoratifs : ils sont la partie du dispositif qui reste vraie
--     si quelqu'un se trompe plus tard en accordant un droit trop large.
--
--  3. IMMUTABILITÉ. Une prédiction enregistrée ne se modifie pas. Seule la
--     REVUE HUMAINE peut être complétée, et seulement par un humain identifié,
--     via une table distincte en append-only. Réécrire une prédiction après
--     coup rendrait toute mesure d'erreur sans valeur.
--
--  4. INTERRUPTEUR D'ARRÊT. `aflp_model_registry.actif` coupe un modèle sans
--     rien arrêter d'autre. FBMS n'a aucune dépendance à ces tables.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Registre des modèles — et interrupteur d'arrêt
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_model_registry (
  cle                text primary key,          -- 'volumes' | 'fonds' | 'scorecardRt' | 'signaux' | 'evacuations' | 'qualite'
  nom                text not null,
  version_modele     text not null,
  version_variables  text not null,
  -- NOT_READY | SHADOW_ONLY | DECISION_SUPPORT
  statut             text not null default 'NOT_READY'
                     check (statut in ('NOT_READY','SHADOW_ONLY','DECISION_SUPPORT')),
  -- Interrupteur d'arrêt. `false` = le modèle ne produit plus rien.
  -- Aucune opération FBMS ne dépend de cette colonne.
  actif              boolean not null default true,
  motif_desactivation text,
  -- Validations nominatives exigées avant DECISION_SUPPORT. Un JSON vide
  -- signifie « aucune validation » : la contrainte ci-dessous l'interdit alors.
  validations        jsonb not null default '{}'::jsonb,
  model_card         text,                      -- chemin du document dans docs/
  derniere_revue     date,
  prochaine_revue    date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- La règle de gouvernance, portée par la base et non par l'application :
  -- pas de validations nominatives, pas d'aide à la décision. Un modèle ne
  -- peut donc pas être promu par un simple UPDATE distrait.
  constraint aflp_registry_promotion_validee check (
    statut <> 'DECISION_SUPPORT'
    or (validations ? 'branchManager' and jsonb_typeof(validations->'branchManager') = 'string')
  )
);

comment on table public.aflp_model_registry is
  'Registre des modèles prédictifs AFLP. La colonne `actif` est l''interrupteur d''arrêt : '
  'la passer à false désactive le modèle sans interrompre aucune opération FBMS.';

-- ---------------------------------------------------------------------------
-- 2. Prédictions — modèle commun à tous les cas d'usage
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_predictions (
  prediction_id          text primary key,      -- déterministe : <dataset>-<cas>-<rang>
  cas_usage              text not null
                         check (cas_usage in ('volumes','fonds','scorecardRt','signaux','evacuations','qualite')),
  -- Entité concernée
  entite_type            text not null,          -- programme | zone | cluster | village | rt | signal
  entite                 text not null,
  entite_nom             text,
  village                text,
  cluster                text,
  rt                     text,
  campagne               text not null default 'AFLP 2027',
  -- Horizon et dates
  horizon_jours          integer not null default 0 check (horizon_jours >= 0),
  date_calcul            date not null,
  periode_debut          date,
  periode_fin            date,
  -- Valeurs. NULLABLE volontairement : une valeur vide n'est PAS un zéro.
  valeur_prevue          numeric,
  borne_basse            numeric,
  borne_haute            numeric,
  niveau_confiance       numeric check (niveau_confiance is null or (niveau_confiance > 0 and niveau_confiance < 1)),
  confiance              text check (confiance is null or confiance in ('bonne','moyenne','faible','nulle')),
  -- Versions — sans elles, une prédiction n'est pas rejouable
  version_modele         text not null,
  version_variables      text not null,
  version_dataset        text not null,
  date_reference_donnees date,
  statut_modele          text not null
                         check (statut_modele in ('NOT_READY','SHADOW_ONLY','DECISION_SUPPORT','DESACTIVE')),
  methode                text,
  explications           jsonb,                 -- facteurs, métriques, comparaison aux baselines
  indicateur_derive      numeric,
  -- Revue humaine — le seul bloc que la couche prédictive laisse vide
  statut_revue_humaine   text not null default 'NON_REVUE'
                         check (statut_revue_humaine in ('NON_REVUE','EN_COURS','REVUE')),
  utilisateur_consultation text,
  decision_humaine       text,
  motif_decision         text,
  created_at             timestamptz not null default now(),
  -- Cohérence élémentaire : un intervalle inversé est une erreur de calcul,
  -- pas une donnée à conserver.
  constraint aflp_pred_intervalle_ordonne check (
    borne_basse is null or borne_haute is null or borne_basse <= borne_haute
  ),
  constraint aflp_pred_periode_ordonnee check (
    periode_debut is null or periode_fin is null or periode_debut <= periode_fin
  ),
  -- Une prédiction ne peut pas porter sur l'avenir de données qu'elle n'a pas
  -- vues : la période prévue commence APRÈS la date de calcul.
  constraint aflp_pred_pas_de_fuite check (
    periode_debut is null or horizon_jours = 0 or periode_debut > date_calcul
  )
);

create index if not exists aflp_pred_cas_idx     on public.aflp_predictions (cas_usage, date_calcul desc);
create index if not exists aflp_pred_entite_idx  on public.aflp_predictions (entite_type, entite);
create index if not exists aflp_pred_dataset_idx on public.aflp_predictions (version_dataset);
create index if not exists aflp_pred_revue_idx   on public.aflp_predictions (statut_revue_humaine)
  where statut_revue_humaine <> 'REVUE';

comment on table public.aflp_predictions is
  'Prédictions AFLP. Séparée de toute table transactionnelle : une prédiction n''est pas un fait. '
  'Aucun UPDATE n''est autorisé (voir le déclencheur §4) — une prédiction réécrite après coup rend '
  'toute mesure d''erreur sans valeur.';

-- ---------------------------------------------------------------------------
-- 3. Revues humaines — append-only, nominatives
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_prediction_reviews (
  id             uuid primary key default gen_random_uuid(),
  prediction_id  text not null references public.aflp_predictions(prediction_id),
  -- Verbes de PROCESSUS uniquement. Aucun verbe d'exécution : la couche
  -- prédictive ne peut pas être l'origine d'un acte métier.
  suite          text not null check (suite in (
                   'PRIS_CONNAISSANCE','TRANSMIS_FINANCE','TRANSMIS_LOGISTICS',
                   'TRANSMIS_QUALITY','VERIFICATION_TERRAIN','DONNEE_CONTESTEE','ECARTE')),
  motif          text not null check (length(btrim(motif)) >= 5),
  decideur_uid   uuid not null default auth.uid(),
  decideur_nom   text not null check (length(btrim(decideur_nom)) >= 2),
  -- Retour métier sur le signal : c'est CE champ qui permettra un jour de
  -- mesurer le taux de faux positifs. Sans lui, il restera inconnu.
  signal_confirme boolean,
  created_at     timestamptz not null default now()
);
create index if not exists aflp_review_pred_idx on public.aflp_prediction_reviews (prediction_id);

-- ---------------------------------------------------------------------------
-- 4. Immutabilité des prédictions
--    Interdire UPDATE et DELETE au niveau du DÉCLENCHEUR, pas seulement de la
--    RLS : la RLS ne s'applique pas au propriétaire de la table ni au rôle
--    `service_role`. Le déclencheur, lui, s'applique à tout le monde.
-- ---------------------------------------------------------------------------
create or replace function public.aflp_predictions_immuables()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'aflp_predictions est en écriture unique (append-only). Opération % refusée sur %. '
    'Une prédiction se corrige en en écrivant une nouvelle, jamais en réécrivant l''ancienne.',
    tg_op, tg_table_name;
end;
$$;

drop trigger if exists aflp_predictions_no_update on public.aflp_predictions;
create trigger aflp_predictions_no_update
  before update or delete on public.aflp_predictions
  for each row execute function public.aflp_predictions_immuables();

drop trigger if exists aflp_reviews_no_update on public.aflp_prediction_reviews;
create trigger aflp_reviews_no_update
  before update or delete on public.aflp_prediction_reviews
  for each row execute function public.aflp_predictions_immuables();

-- ---------------------------------------------------------------------------
-- 5. Métriques et dérive — l'historique sans lequel il n'y a pas de suivi
-- ---------------------------------------------------------------------------
create table if not exists public.aflp_model_metrics (
  id                uuid primary key default gen_random_uuid(),
  cle_modele        text not null references public.aflp_model_registry(cle),
  cas_usage         text not null,
  date_calcul       date not null,
  version_modele    text not null,
  version_dataset   text not null,
  horizon_jours     integer,
  entite_type       text,
  methode           text,
  -- Métriques. `baseline_*` n'est pas optionnel dans l'esprit du dispositif :
  -- une métrique sans baseline ne dit rien. La contrainte l'impose.
  mae               numeric,
  rmse              numeric,
  wape              numeric,
  biais             numeric,
  couverture_intervalle numeric,
  plis              integer,
  baseline_methode  text not null,
  baseline_wape     numeric,
  faux_positifs     integer,
  vrais_positifs    integer,
  created_at        timestamptz not null default now(),
  constraint aflp_metrics_baseline_presente check (
    baseline_methode is not null and length(btrim(baseline_methode)) > 0
  )
);
create index if not exists aflp_metrics_modele_idx on public.aflp_model_metrics (cle_modele, date_calcul desc);

create table if not exists public.aflp_model_drift (
  id               uuid primary key default gen_random_uuid(),
  cle_modele       text not null references public.aflp_model_registry(cle),
  date_calcul      date not null,
  fenetre_jours    integer not null,
  mediane_recente  numeric,
  mediane_reference numeric,
  ratio            numeric,
  seuil            numeric not null,
  en_derive        boolean not null,
  action_recommandee text,
  created_at       timestamptz not null default now()
);
create index if not exists aflp_drift_modele_idx on public.aflp_model_drift (cle_modele, date_calcul desc);

-- ---------------------------------------------------------------------------
-- 6. Rôle technique des modèles — moindre privilège, imposé par des REVOKE
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aflp_model') then
    -- NOLOGIN : ce rôle ne se connecte pas directement. Il est endossé par la
    -- fonction Edge de calcul (SET ROLE), qui porte seule le secret.
    create role aflp_model nologin;
  end if;
end
$$;

-- Lecture : strictement les tables sources nécessaires aux six cas d'usage.
grant usage on schema public to aflp_model;
grant select on public.achats            to aflp_model;
grant select on public.avances           to aflp_model;
grant select on public.reconciliations   to aflp_model;
grant select on public.sacs_mouvements   to aflp_model;
do $$
begin
  if to_regclass('public.villages') is not null then execute 'grant select on public.villages to aflp_model'; end if;
  if to_regclass('public.rt') is not null then execute 'grant select on public.rt to aflp_model'; end if;
  if to_regclass('public.parametres_calcul') is not null then execute 'grant select on public.parametres_calcul to aflp_model'; end if;
end
$$;

-- Écriture : uniquement le périmètre prédictif, et uniquement en INSERT.
grant insert, select on public.aflp_predictions  to aflp_model;
grant insert, select on public.aflp_model_metrics to aflp_model;
grant insert, select on public.aflp_model_drift   to aflp_model;
grant select           on public.aflp_model_registry to aflp_model;

-- ---- Les interdits, écrits noir sur blanc -------------------------------
-- Ces REVOKE sont redondants avec les GRANT ci-dessus dans une base neuve.
-- Ils sont là pour la base RÉELLE, où quelqu'un a pu, un jour, accorder un
-- droit plus large « juste pour un test ». C'est cette ligne-là qui protège.
revoke insert, update, delete, truncate on public.achats          from aflp_model;
revoke insert, update, delete, truncate on public.avances         from aflp_model;
revoke insert, update, delete, truncate on public.reconciliations from aflp_model;
revoke insert, update, delete, truncate on public.sacs_mouvements from aflp_model;
revoke all on public.aflp_prediction_reviews from aflp_model;   -- la revue est humaine
revoke insert, update, delete on public.aflp_model_registry from aflp_model; -- un modèle ne se promeut pas lui-même
do $$
begin
  if to_regclass('public.profils') is not null then
    execute 'revoke all on public.profils from aflp_model';      -- aucun droit sur les rôles
  end if;
  if to_regclass('public.grilles_tarifaires') is not null then
    execute 'revoke insert, update, delete on public.grilles_tarifaires from aflp_model';
  end if;
  if to_regclass('public.lignes_tarifaires') is not null then
    execute 'revoke insert, update, delete on public.lignes_tarifaires from aflp_model';
  end if;
  if to_regclass('public.parametres_calcul') is not null then
    execute 'revoke insert, update, delete on public.parametres_calcul from aflp_model'; -- ni plafond, ni seuil
  end if;
end
$$;

-- Aucun droit futur accordé par défaut : une table créée plus tard dans
-- `public` ne devient pas lisible par le modèle par simple effet de bord.
alter default privileges in schema public revoke all on tables from aflp_model;

-- ---------------------------------------------------------------------------
-- 7. RLS — lecture par les profils autorisés, écriture par le seul rôle modèle
--    (les fonctions est_actif/est_bm/peut_editer_config viennent de supabase/rls.sql)
-- ---------------------------------------------------------------------------
alter table public.aflp_predictions        enable row level security;
alter table public.aflp_prediction_reviews enable row level security;
alter table public.aflp_model_registry     enable row level security;
alter table public.aflp_model_metrics      enable row level security;
alter table public.aflp_model_drift        enable row level security;

-- Forcer la RLS y compris pour le propriétaire de la table : sans FORCE, le
-- rôle propriétaire contourne toutes les politiques ci-dessous.
alter table public.aflp_predictions        force row level security;
alter table public.aflp_prediction_reviews force row level security;
alter table public.aflp_model_registry     force row level security;

drop policy if exists aflp_pred_sel on public.aflp_predictions;
drop policy if exists aflp_pred_ins on public.aflp_predictions;
drop policy if exists aflp_pred_ins_modele on public.aflp_predictions;
create policy aflp_pred_sel on public.aflp_predictions
  for select to authenticated using (public.est_actif());

-- Aucune politique INSERT pour `authenticated` : un utilisateur connecté ne
-- fabrique pas de prédiction depuis son navigateur.
--
-- En revanche il en faut une pour `aflp_model`. `FORCE ROW LEVEL SECURITY`
-- s'applique à TOUS les rôles hormis le superutilisateur — y compris à celui
-- qui a reçu le GRANT INSERT. Sans cette politique, le GRANT est lettre morte
-- et le pipeline batch ne peut rien écrire.
-- Ce défaut n'apparaît PAS à la lecture du script : il n'a été trouvé qu'en
-- exécutant la migration puis en tentant réellement l'insertion.
create policy aflp_pred_ins_modele on public.aflp_predictions
  for insert to aflp_model with check (true);

drop policy if exists aflp_review_sel on public.aflp_prediction_reviews;
drop policy if exists aflp_review_ins on public.aflp_prediction_reviews;
create policy aflp_review_sel on public.aflp_prediction_reviews
  for select to authenticated using (public.est_actif());
create policy aflp_review_ins on public.aflp_prediction_reviews
  for insert to authenticated
  with check (public.peut_editer_config() and decideur_uid = auth.uid());

drop policy if exists aflp_reg_sel on public.aflp_model_registry;
drop policy if exists aflp_reg_upd on public.aflp_model_registry;
create policy aflp_reg_sel on public.aflp_model_registry
  for select to authenticated using (public.est_actif());
-- Seul le Branch Manager actionne l'interrupteur d'arrêt ou promeut un modèle.
create policy aflp_reg_upd on public.aflp_model_registry
  for update to authenticated using (public.est_bm()) with check (public.est_bm());

drop policy if exists aflp_metrics_sel on public.aflp_model_metrics;
drop policy if exists aflp_metrics_ins_modele on public.aflp_model_metrics;
create policy aflp_metrics_sel on public.aflp_model_metrics
  for select to authenticated using (public.est_actif());
create policy aflp_metrics_ins_modele on public.aflp_model_metrics
  for insert to aflp_model with check (true);

drop policy if exists aflp_drift_sel on public.aflp_model_drift;
drop policy if exists aflp_drift_ins_modele on public.aflp_model_drift;
create policy aflp_drift_sel on public.aflp_model_drift
  for select to authenticated using (public.est_actif());
create policy aflp_drift_ins_modele on public.aflp_model_drift
  for insert to aflp_model with check (true);

-- ---------------------------------------------------------------------------
-- 8. Amorçage du registre — tous les modèles à NOT_READY
--    C'est le seul état honnête tant que la porte du Niveau 1 n'est pas
--    franchie. Les faire naître en SHADOW_ONLY reviendrait à préjuger de
--    l'audit de maturité.
-- ---------------------------------------------------------------------------
insert into public.aflp_model_registry
  (cle, nom, version_modele, version_variables, statut, actif, model_card, prochaine_revue)
values
  ('volumes',     'Prévision des volumes par village', '3.0.0', 'vars-1.0.0', 'NOT_READY', true,
   'docs/aflp_ia_predictif_niveau3_model_cards_20260814.md', current_date + 30),
  ('fonds',       'Estimation du besoin de fonds',     '3.0.0', 'vars-1.0.0', 'NOT_READY', true,
   'docs/aflp_ia_predictif_niveau3_model_cards_20260814.md', current_date + 30),
  ('scorecardRt', 'Scorecard des équipes RT',          '3.0.0', 'vars-1.0.0', 'NOT_READY', true,
   'docs/aflp_ia_predictif_niveau3_model_cards_20260814.md', current_date + 30),
  ('signaux',     'Comportements inhabituels',         '3.0.0', 'vars-1.0.0', 'NOT_READY', true,
   'docs/aflp_ia_predictif_niveau3_model_cards_20260814.md', current_date + 30),
  ('evacuations', 'Prévision des évacuations',         '3.0.0', 'vars-1.0.0', 'NOT_READY', true,
   'docs/aflp_ia_predictif_niveau3_model_cards_20260814.md', current_date + 30),
  ('qualite',     'Écarts de qualité',                 '3.0.0', 'vars-1.0.0', 'NOT_READY', true,
   'docs/aflp_ia_predictif_niveau3_model_cards_20260814.md', current_date + 30)
on conflict (cle) do nothing;

-- ============================================================================
--  APRÈS EXÉCUTION — lancer docs/migrations/aflp_predictions_verify_20260814.sql
-- ============================================================================
