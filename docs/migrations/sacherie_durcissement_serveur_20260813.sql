-- ============================================================================
-- ANAGROCI — Sacherie AFLP : durcissement serveur après audit des 34 simulations
-- ----------------------------------------------------------------------------
-- CE FICHIER N'EST PAS EXÉCUTÉ AUTOMATIQUEMENT.
--
-- `supabase/**` est interdit aux agents (CLAUDE.md §3). Cette migration est
-- donc déposée dans l'emplacement documentaire, à exécuter à la main dans
-- Supabase → SQL Editor, APRÈS relecture, par le Branch Manager.
--
-- Principe : le frontend prévient, le serveur décide. Les corrections livrées
-- dans la PR rendent les opérations fautives difficiles à déclencher depuis
-- l'interface ; elles ne les rendent pas impossibles pour qui appelle la RPC
-- directement. Seules les règles ci-dessous ferment réellement la porte.
--
-- PRÉCAUTION DE LECTURE : les corps de fonction ci-dessous sont donnés à titre
-- de RÈGLES À INSÉRER, pas de remplacement intégral. Les fonctions
-- `sacherie_ct_*` ne sont pas versionnées dans ce dépôt : leur code réel n'a
-- pas pu être lu. Reprenez le corps existant et ajoutez-y les contrôles.
-- Ne remplacez aucune fonction sans avoir comparé avec la version en base.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. C2 — un écart d'inventaire non expliqué doit être refusé
-- ----------------------------------------------------------------------------
-- Constat : `sacherie_ct_inventorier` accepte un comptage physique très
-- inférieur au théorique sans motif. L'interface exige désormais une
-- confirmation explicite, mais elle ignore le stock théorique : elle ne peut
-- pas savoir qu'il y a écart. Le serveur, lui, le calcule.
--
-- À insérer dans `sacherie_ct_inventorier`, après le calcul de `v_difference`
-- et AVANT toute écriture :
--
--   if v_difference <> 0
--      and (p_reason is null or btrim(p_reason) = '') then
--     raise exception
--       'Un motif est obligatoire lorsqu''il existe un écart entre le stock physique et le stock théorique (écart : % sac(s)).',
--       v_difference
--       using errcode = 'check_violation';
--   end if;
--
-- Et le statut du comptage doit rester HOLD tant que l'écart n'est pas résolu :
--
--   v_status := case when v_difference = 0 then 'NORMAL' else 'HOLD' end;
--
-- Aucun ajustement automatique du stock canonique ne doit être fait ici.

-- ----------------------------------------------------------------------------
-- 2. C1 / M2 — la quantité comptée doit être un entier explicite
-- ----------------------------------------------------------------------------
-- `p_counted` doit être rejeté s'il est NULL ou non entier. Un zéro reste
-- légitime : c'est un comptage à zéro, pas une absence de saisie. C'est
-- précisément la distinction que le frontend perdait.
--
--   if p_counted is null then
--     raise exception 'Quantité physique obligatoire.' using errcode = 'check_violation';
--   end if;
--   if p_counted <> trunc(p_counted) then
--     raise exception 'La quantité de sacs doit être un nombre entier.' using errcode = 'check_violation';
--   end if;
--   if p_counted < 0 then
--     raise exception 'La quantité comptée ne peut pas être négative.' using errcode = 'check_violation';
--   end if;
--
-- Même contrôle sur `p_qty` dans `sacherie_ct_traiter_etat` et
-- `sacherie_ct_declarer_perte`, avec `p_qty > 0` obligatoire.

-- ----------------------------------------------------------------------------
-- 3. M1 — table des transitions d'état, côté serveur
-- ----------------------------------------------------------------------------
-- Le frontend ne propose plus que les transitions autorisées. Le serveur doit
-- porter la même table, sinon un appel direct contourne la règle.

create table if not exists public.sacherie_transitions_autorisees (
  from_state text not null,
  to_state   text not null,
  primary key (from_state, to_state)
);

insert into public.sacherie_transitions_autorisees (from_state, to_state) values
  ('DECHIRE',   'A_REPARER'),
  ('DECHIRE',   'REFORME'),
  ('A_REPARER', 'REPARE'),
  ('A_REPARER', 'REFORME'),
  ('REPARE',    'UTILISABLE')
on conflict do nothing;

-- À insérer dans `sacherie_ct_traiter_etat` :
--
--   if p_from_state = p_to_state then
--     raise exception 'L''état d''arrivée doit être différent de l''état de départ.'
--       using errcode = 'check_violation';
--   end if;
--   if not exists (select 1 from public.sacherie_transitions_autorisees
--                  where from_state = p_from_state and to_state = p_to_state) then
--     raise exception 'Transition interdite : % vers %.', p_from_state, p_to_state
--       using errcode = 'check_violation';
--   end if;

-- ----------------------------------------------------------------------------
-- 4. M3 — aucun stock négatif, quel que soit l'appelant
-- ----------------------------------------------------------------------------
-- Contrôle à insérer dans `sacherie_ct_traiter_etat` et
-- `sacherie_ct_declarer_perte`, avant écriture :
--
--   if p_qty > v_stock_disponible then
--     raise exception 'Quantité supérieure au stock disponible : % sac(s).', v_stock_disponible
--       using errcode = 'check_violation';
--   end if;
--
-- `v_stock_disponible` = solde canonique de la localisation dans l'état de
-- départ, calculé depuis `rcn_jute_movements`. Ne pas se fier à une valeur
-- transmise par le client.

-- ----------------------------------------------------------------------------
-- 5. M5 — aucune nouvelle dotation RT hors du workflow SOP-006
-- ----------------------------------------------------------------------------
-- CONSTAT À VÉRIFIER AVANT D'APPLIQUER : le module historique
-- `terrain/sacs.html` insère toujours dans `sacs_mouvements` un mouvement de
-- type `DOTATION_RT`, sans demande ni approbation, et la politique RLS
-- `sacs_ins` autorise cette insertion à tout profil actif. Si un pont projette
-- `sacs_mouvements` vers le registre canonique, cette voie est un contournement
-- ACTIF du workflow. Si le pont est inactif, c'est une voie morte — mais elle
-- restera une porte ouverte le jour où le pont sera activé.
--
-- Vérification préalable, à exécuter et à lire AVANT toute décision :
--
--   select tgname, tgenabled, pg_get_triggerdef(oid)
--   from pg_trigger
--   where tgrelid = 'public.sacs_mouvements'::regclass and not tgisinternal;
--
--   select count(*) filter (where type = 'DOTATION_RT') as dotations_legacy,
--          max(created_at) as derniere
--   from public.sacs_mouvements;
--
-- Si le pont existe, ajouter au trigger de projection (ou à la fonction du
-- pont) le refus des dotations nouvelles non rattachées à une demande :
--
--   if new.type = 'DOTATION_RT'
--      and new.created_at > timestamptz '2026-08-13'
--      and not exists (select 1 from public.bag_movement_requests r
--                      where r.id = new.request_id and r.status in ('APPROVED','PARTIALLY_EXECUTED','EXECUTED')) then
--     raise exception 'Dotation RT interdite hors du workflow SOP-006 : créez une demande et faites-la approuver.'
--       using errcode = 'check_violation';
--   end if;
--
-- LA DATE EST ESSENTIELLE. Les 555 sacs déjà sous responsabilité RT sont des
-- données historiques antérieures au workflow. Elles ne doivent être ni
-- effacées, ni réécrites, ni bloquées rétroactivement. Le refus ne porte que
-- sur les mouvements créés après la bascule.

-- ----------------------------------------------------------------------------
-- 6. C3 — exposer la disponibilité en cluster dans le snapshot
-- ----------------------------------------------------------------------------
-- Le frontend calcule aujourd'hui « Disponibles en Cluster » comme la somme du
-- champ canonique `stock_cluster_vide`, moins les manques constatés au dernier
-- comptage et non régularisés. C'est explicable et vérifiable, mais cela reste
-- une agrégation faite dans le navigateur.
--
-- Cible : que `sacherie_ct_snapshot` renvoie le chiffre, pour qu'il n'existe
-- qu'une seule définition :
--
--   'available_cluster', (
--     select coalesce(sum(stock_cluster_vide), 0) - coalesce(sum(gap_negatif_ouvert), 0)
--     from <vue des clusters>
--   )
--
-- Tant que ce champ n'existe pas, le frontend continue de l'agréger et
-- l'affiche avec sa décomposition. Le jour où le champ arrive, l'interface doit
-- le préférer à son propre calcul.

-- ----------------------------------------------------------------------------
-- 7. M4 — pièces justificatives
-- ----------------------------------------------------------------------------
-- Le frontend refuse désormais tout ce qui n'est pas JPG, PNG ou PDF, contrôle
-- le type MIME et la taille. Le paramètre `p_proof` reste une chaîne JSON
-- contenant une Data URL : ce n'est pas un stockage de preuve acceptable à
-- terme (volumétrie, absence de contrôle serveur du contenu).
--
-- P1 restant, hors de cette PR : bucket Supabase Storage privé `bag-evidence`,
-- upload signé, et remplacement de `p_proof` par un couple
-- (document_url, document_hash). Tant que ce chantier n'est pas fait, aucune
-- pièce justificative ne doit être considérée comme une preuve opposable.

-- ============================================================================
-- VÉRIFICATION APRÈS APPLICATION
--   select from_state, to_state from public.sacherie_transitions_autorisees order by 1,2;
--   -- puis rejouer la matrice de recette du frontend :
--   --   node .github/agent-tests/sacherie-validations.mjs
-- ============================================================================
