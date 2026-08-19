-- Rollback logique Sacherie V2 MVP
-- ATTENTION : volontairement NON DESTRUCTIF.
-- Ne supprime ni table, ni colonne, ni donnée métier.
-- Objectif : neutraliser les gardes/RPC V2 et restaurer l'insertion V1.

begin;

-- 1) Désactiver les triggers V2.
drop trigger if exists trg_sacherie_guard_mouvement on public.sacs_mouvements;
drop trigger if exists trg_sacherie_assign_cycle_achat on public.achats;

-- 2) Désactiver les policies V2 qui dépendent des helpers avant de supprimer les fonctions.
drop policy if exists bag_req_sel on public.bag_movement_requests;
drop policy if exists bag_req_ins on public.bag_movement_requests;
drop policy if exists bag_req_upd on public.bag_movement_requests;
drop policy if exists bag_req_del on public.bag_movement_requests;

-- 3) Restaurer la policy d'insertion V1 du registre sacs.
drop policy if exists sacs_ins on public.sacs_mouvements;
create policy sacs_ins on public.sacs_mouvements for insert to authenticated
with check (public.est_actif() and created_by = auth.uid());

-- 4) Retirer les fonctions/RPC V2. Les données restent en place.
drop function if exists public.sacherie_executer_demande(uuid,integer,text,text);
drop function if exists public.sacherie_decider_demande(uuid,text,integer,text);
drop function if exists public.sacherie_creer_demande(text,text,text,numeric,integer);
drop function if exists public.sacherie_creer_demande(text,text,numeric,integer);
drop function if exists public.sacherie_cloturer_cycle(text);
drop function if exists public.sacherie_configurer_cycle(uuid,text,numeric,numeric);
drop function if exists public.sacherie_calculer_plafond(text,text,numeric);
drop function if exists public.sacherie_guard_mouvement();
drop function if exists public.sacherie_assign_cycle_achat();
drop function if exists public.sacherie_reservations_rt(text,uuid);
drop function if exists public.sacherie_stock_cluster(text);
drop function if exists public.sacherie_sacs_sous_responsabilite_rt(text);
drop function if exists public.sacherie_peut_lire_demande(text,text,uuid);
drop function if exists public.peut_executer_sacherie(text);
drop function if exists public.peut_executer_sacherie();
drop function if exists public.peut_demander_sacherie();
drop function if exists public.sacherie_mon_contexte();
drop function if exists public.sacherie_code_cluster(text);

commit;

-- Restent volontairement présents pour éviter toute perte :
--   bag_movement_requests et ses données (sans policies d'usage V2)
--   colonnes profils fonction_operationnelle / cluster / zone
--   colonnes avances cycle_id / volume_finance_kg / prix_reference_kg / cycle_statut
--   achats.cycle_id
--   colonnes V2 de sacs_mouvements
--   index et contraintes additives.
--
-- En rollback, l'interface Sacherie V2 ne doit plus être utilisée.
