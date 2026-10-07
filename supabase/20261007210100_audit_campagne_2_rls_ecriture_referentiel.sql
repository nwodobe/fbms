-- Audit campagne 2027 · 2/4 — écriture du référentiel terrain réservée aux rôles terrain.
--
-- Constat (simulation RLS en transaction annulée, 07/10/2026, sessions simulées par request.jwt.claims) :
-- les politiques historiques villages_write / rt_write / prod_write (FOR ALL, condition « rôle ≠
-- Consultation uniquement ») laissaient créer et modifier des villages et créer des RT à TOUS les autres
-- rôles : Viewer / Auditor, Warehouse Manager, Storekeeper, Finance, Factory User, QA / Lab,
-- LBA Purchase Officer, RT. Avec un niveau d'autorité GLOBAL, ces mêmes rôles pouvaient aussi créer
-- des producteurs. Un compte « lecture seule » pouvait donc modifier le référentiel AFLP.
--
-- Correctif strictement additif (aucun DROP) : politiques RESTRICTIVES (elles s'ajoutent aux politiques existantes, rien n'est
-- supprimé). L'écriture exige un rôle terrain : peut_editer_terrain() (BM, ABM, Head of Field,
-- Procurement Officer, Supervisor, Agent Recenseur, Chef d'équipe) OU peut_modifier_rt_producteur()
-- (ajoute Zonal Head, Unit Head, Assistant Unit Head, Administrateur).
-- Les fonctions SECURITY DEFINER (enrôlement coopérative, import…) ne sont pas concernées
-- (propriétaire postgres, BYPASSRLS). La lecture n'est pas modifiée.

create or replace function public.peut_ecrire_referentiel_terrain()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.peut_editer_terrain(), false) or coalesce(public.peut_modifier_rt_producteur(), false)
$$;
-- Fonction de lecture du rôle de l'appelant uniquement (aucune donnée exposée).

create policy villages_ecriture_roles_terrain_ins on public.villages as restrictive for insert to authenticated
  with check (public.peut_ecrire_referentiel_terrain());
create policy villages_ecriture_roles_terrain_upd on public.villages as restrictive for update to authenticated
  using (public.peut_ecrire_referentiel_terrain()) with check (public.peut_ecrire_referentiel_terrain());

create policy rt_ecriture_roles_terrain_ins on public.rt as restrictive for insert to authenticated
  with check (public.peut_ecrire_referentiel_terrain());

create policy producteurs_ecriture_roles_terrain_ins on public.producteurs as restrictive for insert to authenticated
  with check (public.peut_ecrire_referentiel_terrain());
