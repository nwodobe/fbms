-- =====================================================================
-- Sacherie AFLP — durcissement du registre historique sacs_mouvements
-- Migration versionnee. Ne modifie aucune migration deja deployee.
--
-- CONSTAT D'AUDIT (18/09/2026, verifie en base, pas dans la doc) :
--   * la policy `sacs_mouvements_ins` documentee en P0 le 11/08/2026
--     N'EXISTE PLUS. Une seule policy permissive INSERT subsiste,
--     `sacs_ins`, dont le WITH CHECK exclut deja `DOTATION_RT`.
--   * un trigger BEFORE INSERT (`trg_sacherie_guard_mouvement`) exige en
--     plus une `bag_movement_requests` APPROVED, non expiree et non
--     consommee. L'INSERT direct est donc bien refuse aujourd'hui.
--   * EN REVANCHE la porte UPDATE est ouverte : `sacs_mouvements_upd`
--     autorise les roles de `peut_editer_config()` (Branch Manager,
--     Assistant Branch Manager, Head of Field, Procurement Officer,
--     Supervisor) a requalifier n'importe quel mouvement en
--     `DOTATION_RT` et a modifier sa quantite. Le trigger de garde ne
--     couvre que l'INSERT, et le pont vers le registre canonique
--     (`trg_sacherie_ct_bridge`, AFTER INSERT) ne rejoue jamais un
--     UPDATE : la table historique et `rcn_jute_movements` divergent
--     silencieusement.
--
-- CORRECTIF
--   1. policies RESTRICTIVE : combinees en AND, elles rendent la regle
--      insensible a l'ajout futur d'une policy permissive trop large.
--      C'est la reponse durable au probleme "PostgreSQL combine les
--      policies permissives par OR".
--   2. trigger BEFORE UPDATE : un mouvement est immuable dans ses
--      dimensions comptables. Une correction se fait par contre-
--      mouvement (la colonne `correction_of` existe deja), jamais par
--      reecriture. La divergence avec le registre canonique devient
--      structurellement impossible.
--
-- ROLLBACK : voir le bloc en fin de fichier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. INSERT : interdiction structurelle de DOTATION_RT en ecriture directe
-- ---------------------------------------------------------------------
-- RESTRICTIVE + `to public` : s'applique a tout role non BYPASSRLS.
-- `postgres` et `service_role` portent BYPASSRLS : les RPC SECURITY
-- DEFINER (sacherie_executer_demande) continuent de fonctionner.
drop policy if exists sacs_mouvements_dotation_insert_guard on public.sacs_mouvements;
create policy sacs_mouvements_dotation_insert_guard
  on public.sacs_mouvements
  as restrictive
  for insert
  to public
  with check (type is distinct from 'DOTATION_RT');

-- ---------------------------------------------------------------------
-- 2. DELETE : refus explicite et permanent
-- ---------------------------------------------------------------------
-- Aujourd'hui aucune policy DELETE n'existe, donc la suppression est
-- refusee "par absence" : elle ne leve aucune erreur et supprime zero
-- ligne. La policy restrictive rend le refus explicite et resistant a
-- l'ajout futur d'une policy permissive DELETE.
drop policy if exists sacs_mouvements_delete_guard on public.sacs_mouvements;
create policy sacs_mouvements_delete_guard
  on public.sacs_mouvements
  as restrictive
  for delete
  to public
  using (false);

-- ---------------------------------------------------------------------
-- 3. UPDATE : immuabilite comptable
-- ---------------------------------------------------------------------
-- Une policy RLS ne peut pas comparer OLD et NEW : un WITH CHECK
-- `type <> 'DOTATION_RT'` bloquerait aussi l'annotation legitime d'une
-- dotation existante. Le controle appartient donc a un trigger.
create or replace function public.sacherie_guard_mouvement_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_fige text[] := array[
    'local_id','date','type','source','destination','cluster',
    'rt_id','rt_nom','producteur_id','producteur_nom','quantite',
    'created_by','created_at','request_id','bag_movement_code',
    'approved_qty','executed_qty','bag_state'
  ];
  v_col text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  -- Requalification en dotation : interdite sans ambiguite, meme si la
  -- boucle ci-dessous devait un jour etre assouplie.
  if new.type = 'DOTATION_RT' and old.type is distinct from 'DOTATION_RT' then
    raise exception 'Requalification en DOTATION_RT interdite : une dotation RT se cree uniquement par le workflow approuve (sacherie_executer_demande)'
      using errcode = '42501';
  end if;

  foreach v_col in array v_fige loop
    if v_old -> v_col is distinct from v_new -> v_col then
      raise exception 'Colonne % non modifiable sur un mouvement enregistre. Passer par un contre-mouvement (correction_of).', v_col
        using errcode = '42501';
    end if;
  end loop;

  return new;
end
$fn$;

revoke all on function public.sacherie_guard_mouvement_update() from public, anon, authenticated;

drop trigger if exists trg_sacherie_guard_mouvement_update on public.sacs_mouvements;
create trigger trg_sacherie_guard_mouvement_update
  before update on public.sacs_mouvements
  for each row execute function public.sacherie_guard_mouvement_update();

comment on function public.sacherie_guard_mouvement_update() is
  'Sacherie AFLP : un mouvement de sacs est immuable dans ses dimensions comptables (type, sens, acteurs, quantite, approval). Garantit que le registre canonique rcn_jute_movements ne peut pas diverger de sacs_mouvements, le pont etant AFTER INSERT uniquement.';

-- ---------------------------------------------------------------------
-- 4. DELETE : filet de securite pour les chemins qui contournent la RLS
-- ---------------------------------------------------------------------
-- VERIFIE EN BASE : pour un role `authenticated`, la policy restrictive
-- ci-dessus filtre la ligne AVANT que le trigger ne s'execute. La
-- suppression ne leve donc aucune erreur, elle porte simplement sur zero
-- ligne, et la ligne reste intacte. Ce trigger n'est PAS le refus visible
-- par le terrain : il couvre les chemins qui ne passent pas par la RLS
-- (fonction SECURITY DEFINER, role BYPASSRLS, tache de maintenance), ou
-- une suppression silencieuse serait, elle, reellement destructrice.
create or replace function public.sacherie_guard_mouvement_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  raise exception 'Suppression interdite : un mouvement de sacs enregistre est definitif. Passer par un contre-mouvement (correction_of).'
    using errcode = '42501';
end
$fn$;

revoke all on function public.sacherie_guard_mouvement_delete() from public, anon, authenticated;

drop trigger if exists trg_sacherie_guard_mouvement_delete on public.sacs_mouvements;
create trigger trg_sacherie_guard_mouvement_delete
  before delete on public.sacs_mouvements
  for each row execute function public.sacherie_guard_mouvement_delete();

commit;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- begin;
--   drop trigger if exists trg_sacherie_guard_mouvement_delete on public.sacs_mouvements;
--   drop function if exists public.sacherie_guard_mouvement_delete();
--   drop trigger if exists trg_sacherie_guard_mouvement_update on public.sacs_mouvements;
--   drop function if exists public.sacherie_guard_mouvement_update();
--   drop policy if exists sacs_mouvements_delete_guard on public.sacs_mouvements;
--   drop policy if exists sacs_mouvements_dotation_insert_guard on public.sacs_mouvements;
-- commit;
-- Effet du rollback : retour exact a l'etat du 17/09/2026. Aucune donnee
-- n'est touchee par cette migration ni par son annulation.
