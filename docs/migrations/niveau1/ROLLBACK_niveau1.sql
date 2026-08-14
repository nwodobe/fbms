-- ============================================================================
-- NIVEAU 1 — RETOUR ARRIÈRE
-- ----------------------------------------------------------------------------
-- Rétablit le comportement d'avant les migrations 01 à 09.
--
-- CE QUE CE SCRIPT FAIT
--   · supprime les triggers et fonctions du Niveau 1 ;
--   · supprime les contraintes et index ajoutés ;
--   · rétablit les politiques RLS d'origine (achats_upd, avances_upd) ;
--   · CONSERVE toutes les tables et toutes les données créées.
--
-- CE QUE CE SCRIPT NE FAIT PAS, ET NE FERA JAMAIS
--   · supprimer une table ou une donnée métier ;
--   · supprimer le journal d'audit ;
--   · supprimer les colonnes ajoutées aux tables existantes.
--
-- POURQUOI GARDER LES COLONNES ET LES TABLES
--   Un DROP COLUMN détruit irréversiblement des données déjà écrites — clés
--   d'idempotence, codes métier, rattachements de cycle, références papier.
--   Le retour arrière doit rendre le système AU PIRE aussi permissif qu'avant,
--   jamais plus destructeur. Les colonnes orphelines sont inertes : elles ne
--   gênent aucun code antérieur, qui ne les connaît pas.
--
-- Un nettoyage définitif des colonnes est possible plus tard, sur décision
-- écrite, après export et sauvegarde vérifiée. Il n'est pas fourni ici :
-- ce script est une roue de secours, pas une démolition.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Triggers
-- ---------------------------------------------------------------------------
do $$
declare t text; g text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements',
                           'n1_stock_mouvements','profils','n1_receptions_usine'] loop
    if to_regclass('public.'||t) is not null then
      foreach g in array array['trg_n1_05_verrou_cloture','trg_n1_10_identite',
                               'trg_n1_10_identite_immuable','trg_n1_10_stock_identite',
                               'trg_n1_10_reception','trg_n1_15_champs','trg_n1_20_achat_garde',
                               'trg_n1_20_avance_garde','trg_n1_20_profil_audit','trg_n1_30_statut',
                               'trg_n1_50_sacs_soldes','trg_n1_50_stock_soldes',
                               'trg_n1_60_achat_stock','trg_n1_90_audit'] loop
        execute format('drop trigger if exists %I on public.%I', g, t);
      end loop;
    end if;
  end loop;
end $$;

-- Le journal d'audit reste protégé jusqu'au bout : ses triggers d'immuabilité
-- ne sont retirés qu'en dernier, et seulement pour permettre une éventuelle
-- migration ultérieure de la table. Les lignes, elles, ne sont pas touchées.
drop trigger if exists trg_n1_audit_immuable       on public.n1_audit;
drop trigger if exists trg_n1_audit_immuable_trunc on public.n1_audit;

-- ---------------------------------------------------------------------------
-- 2) Contraintes ajoutées aux tables existantes
-- ---------------------------------------------------------------------------
do $$
declare t text; c text;
begin
  foreach t in array array['achats','avances','reconciliations','sacs_mouvements'] loop
    if to_regclass('public.'||t) is not null then
      foreach c in array array['_local_id_requis_chk','_cle_idem_requise_chk','_source_saisie_chk'] loop
        execute format('alter table public.%I drop constraint if exists %I', t, t||c);
      end loop;
    end if;
  end loop;
  alter table public.achats  drop constraint if exists achats_n1_statut_chk;
  alter table public.avances drop constraint if exists avances_n1_statut_chk;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Index d'unicité ajoutés
-- ---------------------------------------------------------------------------
drop index if exists public.achats_recu_campagne_rt_uidx;
drop index if exists public.achats_cle_idem_uidx;
drop index if exists public.avances_cle_idem_uidx;
drop index if exists public.reconciliations_cle_idem_uidx;
drop index if exists public.sacs_mouvements_cle_idem_uidx;
drop index if exists public.achats_code_uidx;
drop index if exists public.avances_code_uidx;
drop index if exists public.reconciliations_code_uidx;
drop index if exists public.sacs_mouvements_code_uidx;
drop index if exists public.achats_papier_uidx;

-- ---------------------------------------------------------------------------
-- 4) Politiques RLS : rétablissement exact de l'état d'origine
-- ---------------------------------------------------------------------------
-- Ce bloc REPRODUIT supabase/achats.sql:85 et supabase/cash.sql:62. Toute
-- divergence ici rendrait le retour arrière plus permissif que l'état initial.
drop policy if exists achats_upd on public.achats;
create policy achats_upd on public.achats
  for update to authenticated using (public.est_bm()) with check (public.est_bm());

drop policy if exists avances_upd on public.avances;
create policy avances_upd on public.avances
  for update to authenticated using (public.est_bm()) with check (public.est_bm());

-- ---------------------------------------------------------------------------
-- 5) Fonctions du Niveau 1
-- ---------------------------------------------------------------------------
-- Supprimées par nom + signature, sans toucher aux fonctions préexistantes
-- (est_bm, est_actif, peut_editer_*, sacherie_*).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'n1\_%'
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop view if exists public.n1_vue_cycles;
drop view if exists public.n1_vue_anomalies;
drop view if exists public.n1_vue_registre_papier;

-- ---------------------------------------------------------------------------
-- 6) Droits
-- ---------------------------------------------------------------------------
-- Les REVOKE posés par le Niveau 1 sont levés pour revenir aux droits initiaux
-- accordés par Supabase au rôle `authenticated`. La RLS reste la serrure.
do $$
declare t text;
begin
  foreach t in array array['n1_parametres','n1_cycles','n1_exceptions','n1_transitions',
                           'n1_ajustements','n1_soldes','n1_stock_mouvements','n1_lots',
                           'n1_evacuations','n1_receptions_usine','n1_reconciliation_lignes',
                           'n1_anomalies','n1_anomalies_historique','n1_sync_operations',
                           'n1_sync_conflits','n1_papier_series','n1_papier_numeros'] loop
    if to_regclass('public.'||t) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

commit;

-- ============================================================================
-- APRÈS RETOUR ARRIÈRE — VÉRIFICATIONS OBLIGATOIRES
--
--   -- 1. Plus aucun trigger Niveau 1
--   select tgname, relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where tgname like 'trg_n1%' and not tgisinternal;
--
--   -- 2. Politiques d'origine rétablies
--   select tablename, policyname, qual from pg_policies
--   where schemaname='public' and tablename in ('achats','avances') and cmd='UPDATE';
--
--   -- 3. Aucune donnée perdue : comparer aux comptages relevés AVANT migration
--   select 'achats' t, count(*) from public.achats
--   union all select 'avances', count(*) from public.avances
--   union all select 'sacs_mouvements', count(*) from public.sacs_mouvements
--   union all select 'n1_audit', count(*) from public.n1_audit;
--
-- ⚠ CONSÉQUENCE DIRECTE ET ASSUMÉE DU RETOUR ARRIÈRE
--   Les neuf verrous P0 retombent immédiatement : reçu dupliqué de nouveau
--   possible, refinancement d'un cycle non réconcilié de nouveau possible,
--   solde négatif de nouveau possible, opération clôturée de nouveau modifiable.
--   Un retour arrière n'est donc jamais une position d'attente : c'est une
--   mesure d'urgence, à assortir d'une suspension des opérations financières.
-- ============================================================================
