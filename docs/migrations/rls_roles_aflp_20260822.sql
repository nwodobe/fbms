-- ============================================================================
-- ANAGROCI — Aligner les rôles reconnus par la RLS sur ceux du portail
-- ----------------------------------------------------------------------------
-- Anomalie corrigée : BUG-010 (tests/reports/05-BUGS.md, 07-SECURITY-ACCESS.md §3)
--
-- ⚠️  CE FICHIER N'EST PAS APPLIQUÉ. Il est déposé ici parce que `supabase/**`
--     est interdit à toute modification par un agent (CLAUDE.md §3). Son
--     exécution relève d'une personne, et dans cet ordre :
--       1. sur un projet Supabase de TEST (tests/load/LISEZ-MOI.md §3) ;
--       2. exécuter rls_roles_aflp_20260822_verify.sql ;
--       3. se connecter réellement avec un compte de chaque rôle ;
--       4. seulement ensuite, sur la production.
--     `SECURITE.md` le dit : modifier une couche sans l'autre casse la sécurité
--     OU casse l'accès des utilisateurs légitimes. Ici, c'est le second cas qui
--     s'est déjà produit.
--
-- ----------------------------------------------------------------------------
-- LE PROBLÈME
--
-- `shared/admin.html` propose les rôles de `shared/aflp-access.js` — quinze
-- libellés. `supabase/rls.sql` n'en connaît que six, les libellés historiques.
-- Huit rôles ouvrent donc des écrans de saisie que la base refuse d'alimenter :
--
--   Rôle attribué                        Portail ouvre        Base autorise
--   ---------------------------------    ------------------   -------------
--   Branch Manager / Head of Programme   tout + Administration   RIEN
--   Zonal Head                           Achats, Caisse, ALIS    RIEN
--   Logistics Coordinator                Achats, Caisse, ALIS    RIEN
--   Unit Head                            Achats, Caisse, ALIS    RIEN
--   Assistant Unit Head                  Achats, Caisse, ALIS    RIEN
--   Finance / Controller                 Achats, Caisse, ALIS    RIEN
--   Warehouse Keeper                     Achats, Sacs, FBMS      RIEN
--   RT / Field Partner                   Achats, Sacs, FBMS      RIEN
--
-- `supabase/20260818_farmer_registry_phase1_security.sql` connaît pourtant déjà
-- ces libellés (il s'en sert pour le périmètre zone/cluster) : c'est `rls.sql`,
-- le socle, qui n'a pas suivi.
--
-- ----------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION FAIT — ET NE FAIT PAS
--
-- ELLE FAIT : rendre à chaque rôle le droit d'écriture que le portail lui
-- promet déjà, en suivant exactement la correspondance rôle → niveau de
-- `shared/aflp-access.js:niveauPortail()` :
--     niveau bm     → Branch Manager / Head of Programme
--     niveau chef   → Zonal Head, Logistics Coordinator, Unit Head,
--                     Assistant Unit Head, Finance / Controller
--     niveau agent  → Warehouse Keeper, RT / Field Partner
--     niveau direct.→ Read Only / Audit  (aucune écriture : inchangé)
--
-- ELLE NE FAIT PAS : élargir `est_bm()` au-delà du strict équivalent du Branch
-- Manager. Le portail accorde aujourd'hui la roue crantée d'administration à
-- QUATRE rôles (Branch Manager, Assistant Branch Manager, Head of Field,
-- Procurement Officer) parce que `estBM()` teste le niveau et non le libellé,
-- alors que la base ne l'accorde qu'à « Branch Manager ». Qui doit pouvoir
-- créer un compte, changer un rôle et supprimer un achat est une DÉCISION
-- MÉTIER, pas un détail d'implémentation : elle revient au Branch Manager, et
-- `SECURITE.md` tranche aujourd'hui dans le sens le plus étroit (« Seul le
-- Branch Manager ouvre l'Administration »). Cette migration s'y tient et
-- n'ajoute que le libellé strictement équivalent.
--
-- Idempotent : `create or replace`, exécutable plusieurs fois sans effet de
-- bord. Aucune table, aucune politique n'est touchée — seulement les trois
-- fonctions d'aide sur lesquelles toutes les politiques s'appuient.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. est_bm() — ajout du seul libellé strictement équivalent au Branch Manager
-- ---------------------------------------------------------------------------
create or replace function public.est_bm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profils
    where user_id = auth.uid()
      and actif = true
      and role in ('Branch Manager', 'Branch Manager / Head of Programme')
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. peut_editer_terrain() — niveaux bm + chef + agent
--    (villages, hubs_clusters, rt, producteurs, achats, sacs)
-- ---------------------------------------------------------------------------
create or replace function public.peut_editer_terrain()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in (
    -- libellés historiques, inchangés
    'Branch Manager', 'Assistant Branch Manager', 'Head of Field',
    'Procurement Officer', 'Supervisor', 'Agent Recenseur',
    -- libellés AFLP, absents jusqu'ici
    'Branch Manager / Head of Programme',
    'Zonal Head', 'Logistics Coordinator', 'Unit Head', 'Assistant Unit Head',
    'Finance / Controller', 'Warehouse Keeper', 'RT / Field Partner'
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. peut_editer_config() — niveaux bm + chef seulement
--    (grilles et lignes tarifaires, paramètres de calcul, collecte courte)
--    Un magasinier ou un partenaire RT ne modifie pas un barème.
-- ---------------------------------------------------------------------------
create or replace function public.peut_editer_config()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mon_role() in (
    'Branch Manager', 'Assistant Branch Manager', 'Head of Field',
    'Procurement Officer', 'Supervisor',
    'Branch Manager / Head of Programme',
    'Zonal Head', 'Logistics Coordinator', 'Unit Head', 'Assistant Unit Head',
    'Finance / Controller'
  )
$$;

commit;

-- ---------------------------------------------------------------------------
-- Après exécution : lancer rls_roles_aflp_20260822_verify.sql, puis ouvrir
-- l'application avec un compte de chaque rôle et enregistrer un achat de test
-- (préfixe TEST_LOAD_). Une porte SQL verte ne prouve pas qu'un agent peut
-- travailler.
-- ---------------------------------------------------------------------------
