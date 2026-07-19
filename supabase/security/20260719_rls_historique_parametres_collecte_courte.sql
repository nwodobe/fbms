-- Migration proposee - NE PAS EXECUTER SANS VALIDATION FONCTIONNELLE
-- Objectif: corriger la table public.historique_parametres_collecte_courte dont le RLS est desactive.
-- Risque: activer RLS sans policies bloque l'acces. Ce script cree d'abord des policies explicites.

-- 1) Lecture reservee aux utilisateurs authentifies actifs
create policy if not exists historique_parametres_collecte_courte_select_authenticated
on public.historique_parametres_collecte_courte
for select
to authenticated
using (auth.uid() is not null);

-- 2) Insertion reservee aux utilisateurs authentifies actifs
-- A renforcer ensuite selon roles BM / logistique si les fonctions roles sont stabilisees.
create policy if not exists historique_parametres_collecte_courte_insert_authenticated
on public.historique_parametres_collecte_courte
for insert
to authenticated
with check (auth.uid() is not null);

-- 3) Aucune suppression directe cote client.
-- La suppression doit rester geree par une fonction controlee si necessaire.

-- 4) Activation RLS apres creation des policies.
alter table public.historique_parametres_collecte_courte enable row level security;
