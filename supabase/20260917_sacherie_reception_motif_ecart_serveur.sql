-- ANAGROCI FBMS - Sacherie AFLP
-- Confirmation de reception : le motif d'ecart devient une regle SERVEUR.
-- APPLIQUEE en base le 2026-09-17 (migration sacherie_reception_motif_ecart_serveur).
--
-- Constat d'audit : ops_bag_requests porte deja les garde-fous quantitatifs
--   CHECK (received_qty <= released_qty)
--   CHECK (released_qty <= coalesce(approved_qty, requested_qty))
--   CHECK (approved_qty <= requested_qty)
-- et ops_bag_request_guard() controle role et separation des taches sur chaque
-- transition de statut. En revanche une mise a jour de received_qty SANS
-- changement de statut traversait le guard sans controle : n'importe lequel
-- des 9 roles de la policy UPDATE pouvait confirmer une reception, et un
-- ecart libere/recu pouvait etre enregistre sans aucune justification.
-- Le motif n'existait que dans le formulaire du navigateur.
--
-- Aucune table creee, aucun registre physique touche.
-- Le corps complet de la fonction est celui applique en base : voir la
-- migration Supabase du meme nom pour le texte integral.

alter table public.ops_bag_requests
  add column if not exists receipt_gap_reason text;

comment on column public.ops_bag_requests.receipt_gap_reason is
  'Justification obligatoire lorsqu''une confirmation de reception laisse recu < libere.';

-- ops_bag_request_guard() : bloc ajoute avant `new.updated_at := now()`,
-- le reste de la fonction est conserve a l'identique.
--
--   if new.received_qty is distinct from old.received_qty then
--     if new.received_qty < old.received_qty then
--       raise exception 'Une reception confirmee ne peut pas etre diminuee';
--     end if;
--     if not private.ops_has_role(array['Unit Head','Field Buying Operations Officer',
--                                       'Branch Manager','Administrateur']) then
--       raise exception 'Confirmation de reception reservee au terrain destinataire';
--     end if;
--     if new.received_qty < new.released_qty
--        and coalesce(btrim(new.receipt_gap_reason),'') = '' then
--       raise exception 'Ecart de reception : motif obligatoire';
--     end if;
--   end if;
