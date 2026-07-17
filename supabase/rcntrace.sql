-- ============================================================================
--  RCN TRACE — Schéma Supabase (supabase/rcntrace.sql)
--  Modules 1 & 2 · Réception, Qualité, Stock/BIN, Transfert, Calibrage
--  Modèle métier du cahier des charges consolidé v2.0 (§10 « Données communes »).
--  ----------------------------------------------------------------------------
--  Principes appliqués :
--    · Objets stables reliés par une généalogie parent-enfant (§10.3).
--    · Une valeur vide ≠ zéro (colonnes NULLABLE, pas de DEFAULT 0 sur les mesures).
--    · Aucune correction n'efface le passé : table rcn_audit + versions.
--    · Le poids physique commande le stock ; le poids main-d'œuvre est séparé.
--  À exécuter dans l'éditeur SQL Supabase. Complète les tables existantes FBMS.
--  ----------------------------------------------------------------------------
--  DEUX COUCHES :
--    A) rcn_state (§15) — magasin OPÉRATIONNEL synchronisé par l'application
--       (une ligne JSONB par agrégat : reception, lot, cycle BIN, transfert,
--       calibrage, meta). C'est ce que l'app écrit en temps réel (offline-first,
--       write-through + file d'attente). Partage multi-appareils.
--    B) rcn_* normalisées (§1–11) — modèle ANALYTIQUE / reporting cible, prêt
--       pour les tableaux de bord et exports. Alimentables par vues ou ETL à
--       partir de rcn_state.
--    rcn_audit (§11) est commun : journal append-only non modifiable.
-- ============================================================================

-- Extensions utiles
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. Référentiels configurables (§1.3, §9.3) — sans valeur industrielle inventée
-- ----------------------------------------------------------------------------
create table if not exists rcn_referentiels (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,             -- 'calibre' | 'motif_arret' | 'categorie_perte' | 'fournisseur' | 'machine'
  code        text not null,
  libelle     text,
  ordre       int  default 0,
  actif       boolean default true,
  meta        jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  unique (type, code)
);

-- ----------------------------------------------------------------------------
-- 1. Réception temporaire — REC-AAAAMMJJ-SEQ (§M1-FR-02)
-- ----------------------------------------------------------------------------
create table if not exists rcn_receptions (
  id            text primary key,        -- REC-AAAAMMJJ-SEQ
  camion        text,
  fournisseur   text,
  origine       text,
  arrivee_at    timestamptz,
  poids_annonce numeric,                 -- nullable : vide ≠ 0
  sacs_annonce  int,
  ref_doc       text,
  etat          text not null default 'ARRIVÉE_ENREGISTRÉE',
  lot_id        text,                    -- reste NULL et verrouillé jusqu'à libération
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 2. Contrôles qualité — QLT-SEQ (sampling / final / transfert) (§6, §10.2)
--    Le sampling et l'analyse finale sont DEUX enregistrements séparés.
-- ----------------------------------------------------------------------------
create table if not exists rcn_qualites (
  id                text primary key,    -- QLT-SEQ
  reception_id      text references rcn_receptions(id),
  lot_id            text,
  type              text not null,        -- 'sampling' | 'final' | 'transfert'
  gk_g              numeric,              -- Good Kernel (g)
  imm_g             numeric,              -- Immature (g)   → moitié dans KOR
  spotted_g         numeric,              -- Spotted (g)    → moitié dans KOR
  nc_count          int,                  -- Nut Count (manuel)
  humidity_pct      numeric,
  browns_g          numeric,
  voids_g           numeric,
  oil_g             numeric,
  total_defect_g    numeric,              -- Browns + Voids + Oil
  total_kernels_g   numeric,              -- GK + Immature + Spotted
  kor_exact         numeric,              -- (GK + Spotted/2 + Immature/2) × 0.17637 — non arrondi
  kor_display       numeric(6,2),         -- affichage 2 décimales
  kor_formula       text default '(GK + Spotted/2 + Immature/2) × 0.17637',
  kor_formula_version text default 'v1.0',
  ecart_kor         numeric,              -- |final − sampling| (type='final')
  conforme          boolean,              -- ecart_kor < 1
  analyste          text,
  created_at        timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 3. Décision GM (§M1-FR-05) — autorise/refuse le déchargement
-- ----------------------------------------------------------------------------
create table if not exists rcn_decisions_gm (
  id            uuid primary key default gen_random_uuid(),
  reception_id  text references rcn_receptions(id),
  autorise      boolean not null,
  commentaire   text,                    -- obligatoire si refus
  delegataire   text,                    -- délégation nominative & journalisée
  decide_par    uuid references auth.users(id),
  decide_at     timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 4. Déchargement / pesée (§M1-FR-07) — le net physique alimente le stock
-- ----------------------------------------------------------------------------
create table if not exists rcn_dechargements (
  id                 uuid primary key default gen_random_uuid(),
  reception_id       text references rcn_receptions(id),
  bordereau          text,
  ticket             text,
  sacs               int,
  poids_brut         numeric,
  poids_tare         numeric,
  poids_net          numeric,            -- commande le stock
  poids_main_doeuvre numeric,            -- conservé séparément
  prestataire        text,
  destination        text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 5. Lot officiel — RCN-AAAAMMJJ-SEQ (§M1-FR-06). L'identité d'origine.
-- ----------------------------------------------------------------------------
create table if not exists rcn_lots (
  id            text primary key,        -- RCN-AAAAMMJJ-SEQ
  reception_id  text references rcn_receptions(id),
  fournisseur   text,
  origine       text,
  kor_sampling  numeric,
  kor_final     numeric,
  ecart_kor     numeric,
  net_initial   numeric,
  stock_kg      numeric default 0,       -- solde disponible du lot
  bin_id        text,
  etat          text not null default 'LIBÉRÉ',
  created_at    timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 6. Cycles de BIN — BIN-ID/AAAAMMJJ-SEQ (§7.1). La BIN porte la position.
-- ----------------------------------------------------------------------------
create table if not exists rcn_bin_cycles (
  id                text primary key,    -- BIN-017/20260716-01
  bin_id            text not null,
  qualite_autorisee text,
  capacite_kg       numeric,
  stock_physique_kg numeric default 0,
  residu_kg         numeric,
  etat              text not null default 'OUVERT',
  opened_at         timestamptz default now(),
  closed_at         timestamptz
);

-- Contributeurs d'un cycle (composition théorique après mélange) (§7.2)
create table if not exists rcn_bin_contributeurs (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    text references rcn_bin_cycles(id),
  lot_id      text references rcn_lots(id),
  entree_kg   numeric default 0,
  sorti_kg    numeric default 0,
  unique (cycle_id, lot_id)
);

-- ----------------------------------------------------------------------------
-- 7. Mouvements — MOV-SEQ (§10.1). Entrées/sorties/séchage/triage.
-- ----------------------------------------------------------------------------
create table if not exists rcn_mouvements (
  id          text primary key,          -- MOV-SEQ
  type        text not null,             -- entree_bin | sortie_bin | sechage | triage | empilage ...
  cycle_id    text references rcn_bin_cycles(id),
  bin_id      text,
  lot_id      text,
  trf_id      text,
  qty_kg      numeric,
  perte_kg    numeric,
  document    text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 8. Transferts — TRF-SEQ (§8). Contrat de passage entre modules.
-- ----------------------------------------------------------------------------
create table if not exists rcn_transferts (
  id             text primary key,       -- TRF-SEQ
  cycle_id       text references rcn_bin_cycles(id),
  bin_id         text,
  destination    text default 'Calibrage',
  poids_envoye   numeric,
  poids_recu     numeric,
  ecart_kg       numeric,
  ecart_motif    text,
  etat           text not null default 'BROUILLON',
  val_entrepot   jsonb,                  -- {ok, at, auteur}
  val_qa         jsonb,                  -- triple validation
  val_calibrage  jsonb,
  created_at     timestamptz default now()
);

-- Contributeurs hérités par le transfert (§8.1, R-04)
create table if not exists rcn_transfert_contributeurs (
  id          uuid primary key default gen_random_uuid(),
  trf_id      text references rcn_transferts(id),
  lot_id      text references rcn_lots(id),
  part_pct    numeric,
  qty_kg      numeric,
  qualite     text
);

-- ----------------------------------------------------------------------------
-- 9. Calibrage — CAL-SEQ (§9). Hérite des contributeurs de TRF.
-- ----------------------------------------------------------------------------
create table if not exists rcn_calibrages (
  id             text primary key,       -- CAL-SEQ
  trf_id         text references rcn_transferts(id),
  machine        text,
  shift          text,
  equipe         text,
  recu_kg        numeric,
  entree_machine_kg numeric default 0,
  etat           text not null default 'PRÊT',
  started_at     timestamptz,
  ended_at       timestamptz,
  cloture_motif  text,
  created_at     timestamptz default now()
);

-- Sorties par calibre — CAL-SEQ/CALIBRE (§M2-FR-07)
create table if not exists rcn_cal_sorties (
  id          text primary key,          -- CAL-0008/W240
  cal_id      text references rcn_calibrages(id),
  calibre     text not null,
  sacs        int,
  poids_kg    numeric,
  bin_dest    text,
  created_at  timestamptz default now()
);

-- Rejets / pertes / résidus (§M2-FR-08) — catégories contrôlées
create table if not exists rcn_cal_pertes (
  id            uuid primary key default gen_random_uuid(),
  cal_id        text references rcn_calibrages(id),
  categorie     text not null,           -- rejet | poussiere | perte | rework | residu_machine
  poids_kg      numeric,
  destination   text,
  justification text,
  created_at    timestamptz default now()
);

-- Arrêts machine (§M2-FR-06)
create table if not exists rcn_cal_arrets (
  id          uuid primary key default gen_random_uuid(),
  cal_id      text references rcn_calibrages(id),
  motif       text,
  commentaire text,
  maintenance text,
  start_at    timestamptz,
  end_at      timestamptz
);

-- Alimentations machine (§M2-FR-05)
create table if not exists rcn_cal_alimentations (
  id          uuid primary key default gen_random_uuid(),
  cal_id      text references rcn_calibrages(id),
  poids_kg    numeric,
  bin_source  text,
  created_at  timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 10. Généalogie parent-enfant (§10.3) — relations stables
-- ----------------------------------------------------------------------------
create table if not exists rcn_genealogie (
  id           uuid primary key default gen_random_uuid(),
  parent_type  text not null,            -- lot | cycle | transfert | calibrage
  parent_id    text not null,
  enfant_type  text not null,
  enfant_id    text not null,
  qty_kg       numeric,
  part_pct     numeric,
  mouvement_id text,                     -- le mouvement qui a créé le lien
  created_at   timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 11. Documents — DOC-SEQ (§10.1) & Audit — AUD-SEQ (§13.1)
-- ----------------------------------------------------------------------------
create table if not exists rcn_documents (
  id          text primary key,          -- DOC-SEQ
  objet_type  text,
  objet_id    text,
  numero      text,
  url         text,
  mime        text,
  taille      int,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

create table if not exists rcn_audit (
  id          text primary key,          -- AUD-SEQ
  objet       text,
  champ       text,
  avant       jsonb,
  apres       jsonb,
  motif       text,
  approbateur text,
  auteur      text,
  role        text,
  created_at  timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 12. Row Level Security — comptes nominatifs (NFR-04) via table profils FBMS
-- ----------------------------------------------------------------------------
-- Un utilisateur authentifié et actif peut lire/écrire ; seul le Branch Manager
-- supprime (aligné sur la gouvernance FBMS). Le journal d'audit est en lecture
-- seule pour les opérateurs (§12.1) — insertion autorisée, pas de update/delete.

alter table rcn_referentiels          enable row level security;
alter table rcn_receptions            enable row level security;
alter table rcn_qualites              enable row level security;
alter table rcn_decisions_gm          enable row level security;
alter table rcn_dechargements         enable row level security;
alter table rcn_lots                  enable row level security;
alter table rcn_bin_cycles            enable row level security;
alter table rcn_bin_contributeurs     enable row level security;
alter table rcn_mouvements            enable row level security;
alter table rcn_transferts            enable row level security;
alter table rcn_transfert_contributeurs enable row level security;
alter table rcn_calibrages            enable row level security;
alter table rcn_cal_sorties           enable row level security;
alter table rcn_cal_pertes            enable row level security;
alter table rcn_cal_arrets            enable row level security;
alter table rcn_cal_alimentations     enable row level security;
alter table rcn_genealogie            enable row level security;
alter table rcn_documents             enable row level security;
alter table rcn_audit                 enable row level security;

-- Fonction utilitaire : l'utilisateur est-il un profil actif ?
create or replace function rcn_est_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profils p
    where p.user_id = auth.uid() and coalesce(p.actif, false) = true
  );
$$;

create or replace function rcn_est_bm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profils p
    where p.user_id = auth.uid() and p.role = 'Branch Manager'
  );
$$;

-- Politiques génériques (lecture + écriture pour profils actifs, suppression BM).
do $$
declare t text;
begin
  foreach t in array array[
    'rcn_referentiels','rcn_receptions','rcn_qualites','rcn_decisions_gm',
    'rcn_dechargements','rcn_lots','rcn_bin_cycles','rcn_bin_contributeurs',
    'rcn_mouvements','rcn_transferts','rcn_transfert_contributeurs','rcn_calibrages',
    'rcn_cal_sorties','rcn_cal_pertes','rcn_cal_arrets','rcn_cal_alimentations',
    'rcn_genealogie','rcn_documents'
  ]
  loop
    execute format('drop policy if exists %I_sel on %I;', t, t);
    execute format('drop policy if exists %I_ins on %I;', t, t);
    execute format('drop policy if exists %I_upd on %I;', t, t);
    execute format('drop policy if exists %I_del on %I;', t, t);
    execute format('create policy %I_sel on %I for select using (rcn_est_actif());', t, t);
    execute format('create policy %I_ins on %I for insert with check (rcn_est_actif());', t, t);
    execute format('create policy %I_upd on %I for update using (rcn_est_actif()) with check (rcn_est_actif());', t, t);
    execute format('create policy %I_del on %I for delete using (rcn_est_bm());', t, t);
  end loop;
end $$;

-- Audit : insertion par tout profil actif, lecture par tout profil actif,
-- AUCUN update/delete (journal non modifiable par les opérateurs, §12.1).
drop policy if exists rcn_audit_sel on rcn_audit;
drop policy if exists rcn_audit_ins on rcn_audit;
create policy rcn_audit_sel on rcn_audit for select using (rcn_est_actif());
create policy rcn_audit_ins on rcn_audit for insert with check (rcn_est_actif());

-- ----------------------------------------------------------------------------
-- 13. Index utiles
-- ----------------------------------------------------------------------------
create index if not exists idx_rcn_qualites_rec on rcn_qualites(reception_id);
create index if not exists idx_rcn_lots_rec on rcn_lots(reception_id);
create index if not exists idx_rcn_bincontrib_cycle on rcn_bin_contributeurs(cycle_id);
create index if not exists idx_rcn_trfcontrib_trf on rcn_transfert_contributeurs(trf_id);
create index if not exists idx_rcn_calsorties_cal on rcn_cal_sorties(cal_id);
create index if not exists idx_rcn_genea_parent on rcn_genealogie(parent_type, parent_id);
create index if not exists idx_rcn_genea_enfant on rcn_genealogie(enfant_type, enfant_id);
create index if not exists idx_rcn_audit_objet on rcn_audit(objet);

-- ----------------------------------------------------------------------------
-- 14. Amorce des référentiels (codes provisoires — à valider, §9.3)
-- ----------------------------------------------------------------------------
insert into rcn_referentiels (type, code, libelle, ordre, meta) values
  ('calibre','C1','Calibre 1 — Très gros',1,'{"bande_noix_kg":"<=180"}'),
  ('calibre','C2','Calibre 2',2,'{"bande_noix_kg":"181-190"}'),
  ('calibre','C3','Calibre 3',3,'{"bande_noix_kg":"191-200"}'),
  ('calibre','C4','Calibre 4',4,'{"bande_noix_kg":"201-210"}'),
  ('calibre','C5','Calibre 5',5,'{"bande_noix_kg":"211-220"}'),
  ('calibre','C6','Calibre 6',6,'{"bande_noix_kg":"221-230"}'),
  ('calibre','C7','Calibre 7',7,'{"bande_noix_kg":"231-240"}'),
  ('calibre','C8','Calibre 8',8,'{"bande_noix_kg":"241-250"}'),
  ('calibre','C9','Calibre 9 — Petit',9,'{"bande_noix_kg":">250"}'),
  ('categorie_perte','rejet','Rejet',1,'{}'),('categorie_perte','poussiere','Poussière',2,'{}'),
  ('categorie_perte','perte','Perte',3,'{}'),('categorie_perte','rework','Rework',4,'{}'),
  ('categorie_perte','residu_machine','Résidu machine',5,'{}'),
  ('motif_arret','maintenance','Maintenance',1,'{}'),('motif_arret','changement_calibre','Changement de calibre',2,'{}'),
  ('motif_arret','nettoyage','Nettoyage',3,'{}'),('motif_arret','panne','Panne',4,'{}'),
  ('motif_arret','manque_matiere','Manque matière',5,'{}')
on conflict (type, code) do nothing;

-- ----------------------------------------------------------------------------
-- 15. Magasin opérationnel synchronisé par l'application (offline-first)
--     Une ligne JSONB par agrégat. L'app fait un write-through à chaque
--     mutation ; hors connexion, les écritures sont mises en file et rejouées.
-- ----------------------------------------------------------------------------
create table if not exists rcn_state (
  kind        text not null,   -- 'reception' | 'lot' | 'binCycle' | 'transfer' | 'cal' | 'meta'
  id          text not null,
  payload     jsonb not null,
  updated_at  timestamptz default now(),
  updated_by  uuid references auth.users(id),
  primary key (kind, id)
);
create index if not exists idx_rcn_state_kind on rcn_state(kind);
create index if not exists idx_rcn_state_updated on rcn_state(updated_at);

alter table rcn_state enable row level security;
drop policy if exists rcn_state_sel on rcn_state;
drop policy if exists rcn_state_ins on rcn_state;
drop policy if exists rcn_state_upd on rcn_state;
drop policy if exists rcn_state_del on rcn_state;
create policy rcn_state_sel on rcn_state for select using (rcn_est_actif());
create policy rcn_state_ins on rcn_state for insert with check (rcn_est_actif());
create policy rcn_state_upd on rcn_state for update using (rcn_est_actif()) with check (rcn_est_actif());
create policy rcn_state_del on rcn_state for delete using (rcn_est_bm());

-- Fin du schéma RCN TRACE.
