-- Rollback logique Sacherie V2 MVP
-- ATTENTION : volontairement non destructif. Ne supprime aucune colonne ni table.
-- Objectif : neutraliser les gardes et RPC V2 en cas de probleme, tout en gardant les donnees.

begin;

-- Desactive les triggers V2 sans toucher aux donnees.
drop trigger if exists trg_sacherie_guard_mouvement on public.sacs_mouvements;
drop trigger if exists trg_sacherie_assign_cycle_achat on public.achats;

-- Supprime uniquement les fonctions V2. Les colonnes/tables restent pour permettre une reprise.
drop function if exists public.sacherie_executer_demande(uuid,integer,text,text);
drop function if exists public.sacherie_decider_demande(uuid,text,integer,text);
drop function if exists public.sacherie_creer_demande(text,text,numeric,integer);
drop function if exists public.sacherie_configurer_cycle(uuid,text,numeric,numeric);
drop function if exists public.sacherie_calculer_plafond(text,text,numeric);
drop function if exists public.sacherie_guard_mouvement();
drop function if exists public.sacherie_assign_cycle_achat();
drop function if exists public.peut_executer_sacherie();
drop function if exists public.peut_demander_sacherie();
drop function if exists public.sacherie_code_cluster(text);

-- Retablit la policy d'insertion V1 du registre sacs.
drop policy if exists sacs_ins on public.sacs_mouvements;
create policy sacs_ins on public.sacs_mouvements for insert to authenticated
with check (public.est_actif() and created_by = auth.uid());

commit;

-- Les objets suivants restent volontairement presents :
-- bag_movement_requests, colonnes V2, cycle_id, volume_finance_kg, prix_reference_kg.
-- Cette strategie evite toute perte de donnees et permet une correction puis reactivation.
