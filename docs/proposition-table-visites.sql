-- ============================================================================
-- PROPOSITION — table `visites` (module Tournées Terrain)
-- ----------------------------------------------------------------------------
-- CE FICHIER N'EST PAS UNE MIGRATION. Il n'est ni appliqué, ni référencé par
-- `supabase/`. Il est posé dans `docs/` parce que `supabase/**` est interdit à
-- toute modification automatique (CLAUDE.md §3) : le schéma et les politiques
-- RLS sont la vraie serrure de FBMS, pas le portail JavaScript.
--
-- Pour l'appliquer : relire, déplacer sous `supabase/visites.sql`, puis exécuter
-- dans l'éditeur SQL Supabase. Tant que ce n'est pas fait, la page
-- `terrain/tournees.html` fonctionne en file locale et affiche « Table absente ».
--
-- Auteur du besoin : Branch Manager / Head of Field — suivi des tournées agents.
-- Date de rédaction : 2026-08-10
-- ============================================================================

create table if not exists public.visites (
  id            uuid primary key default gen_random_uuid(),
  -- Identifiant produit par l'appareil AVANT tout envoi : c'est lui qui rend la
  -- synchronisation idempotente quand le réseau coupe entre l'envoi et la
  -- réponse. Même rôle que `local_id` dans `achats` et `sacs_mouvements`.
  local_id      text not null unique,

  date          date not null,
  objet         text not null,

  cluster       text,
  village_id    uuid references public.villages (id),
  village_nom   text not null,
  rt_nom        text,

  -- Position relevée sur place. Facultative : un agent sans signal doit
  -- pouvoir enregistrer sa visite, sinon il ne l'enregistre pas du tout.
  latitude      double precision,
  longitude     double precision,
  precision_m   integer,

  observation   text,

  agent_nom     text,
  agent_role    text,
  -- Auteur réel de la ligne, côté serveur : `agent_nom` vient du client et ne
  -- prouve rien. C'est `auteur` qui sert aux politiques RLS.
  auteur        uuid not null default auth.uid() references auth.users (id),

  created_at    timestamptz not null default now(),
  deleted       boolean not null default false,

  constraint visites_latitude_valide  check (latitude  is null or latitude  between -90  and 90),
  constraint visites_longitude_valide check (longitude is null or longitude between -180 and 180),
  constraint visites_precision_valide check (precision_m is null or precision_m >= 0),
  -- Une visite datée du futur est une faute de saisie, pas une donnée.
  constraint visites_date_non_future  check (date <= (now() at time zone 'UTC')::date)
);

comment on table public.visites is
  'Visites terrain des agents : village, objet, position relevée, observation. Alimente terrain/tournees.html.';

-- Index calés sur les trois lectures réelles de la page : la période, la
-- couverture par cluster, l''activité par agent.
create index if not exists visites_date_idx    on public.visites (date desc) where deleted = false;
create index if not exists visites_cluster_idx on public.visites (cluster)   where deleted = false;
create index if not exists visites_agent_idx   on public.visites (auteur)    where deleted = false;

-- ---------------------------------------------------------------------------
-- Politiques RLS
-- ---------------------------------------------------------------------------
-- Rappel de posture (SECURITE.md) : la clé publique Supabase est visible dans
-- les pages. Le contrôle d''accès de `shared/auth-gate.js` n''est qu''un confort
-- d''affichage. Ce qui protège réellement la donnée, c''est ce qui suit.
--
-- À ALIGNER AVANT APPLICATION sur `supabase/rls.sql` : la fonction qui lit le
-- rôle du profil y porte peut-être déjà un nom. Ne pas en créer une seconde.

alter table public.visites enable row level security;

-- Lecture : tout profil actif de la plateforme. Une tournée n''est pas une
-- donnée confidentielle entre collègues du même dispositif ; la masquer
-- empêcherait justement le pilotage que la page doit rendre possible.
create policy visites_lecture on public.visites
  for select
  using (
    exists (
      select 1 from public.profils p
      where p.user_id = auth.uid() and p.actif
    )
  );

-- Écriture : tout profil actif, MAIS uniquement en son propre nom. Un agent ne
-- peut pas déclarer une tournée au nom d''un autre — sans quoi le suivi
-- d''activité par agent ne vaut rien.
create policy visites_insertion on public.visites
  for insert
  with check (
    auteur = auth.uid()
    and exists (
      select 1 from public.profils p
      where p.user_id = auth.uid() and p.actif
        and p.role <> 'Consultation uniquement'
    )
  );

-- Correction : l''auteur peut rectifier sa propre visite. Personne d''autre.
create policy visites_correction on public.visites
  for update
  using (auteur = auth.uid())
  with check (auteur = auth.uid());

-- Suppression : réservée au Branch Manager, comme pour les achats (voir la
-- correction #144). On ne supprime pas physiquement : on marque `deleted`.
create policy visites_suppression on public.visites
  for delete
  using (
    exists (
      select 1 from public.profils p
      where p.user_id = auth.uid() and p.actif and p.role = 'Branch Manager'
    )
  );

-- ---------------------------------------------------------------------------
-- Vérifications à faire APRÈS application (aucune n''est automatique)
-- ---------------------------------------------------------------------------
--  1. `select * from public.visites;` depuis un compte « Consultation
--     uniquement » : doit renvoyer les lignes, et refuser l''insertion.
--  2. Insertion avec `auteur` forcé à l''identifiant d''un autre utilisateur :
--     doit être refusée par `visites_insertion`.
--  3. Insertion en double du même `local_id` : doit être absorbée par la
--     contrainte d''unicité, pas produire deux visites.
--  4. Insertion d''une visite datée de demain : doit être refusée par
--     `visites_date_non_future`.
