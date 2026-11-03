-- =============================================================================
-- RETOUR ARRIÈRE de 20261103120000_aflp_assistant_unit_head_acces.sql
-- Sans perte de données : aucune fiche, aucun achat, aucun compte n'est supprimé.
--
-- Comptes « Assistant Unit Head » éventuellement créés entre-temps :
--   ils sont DÉSACTIVÉS (actif = false, journalisé par trg_profils_journal), puis
--   la contrainte d'origine est rétablie en NOT VALID : les lignes existantes
--   sont conservées, aucune nouvelle attribution du rôle n'est possible.
--   Le Branch Manager réaffecte ensuite ces comptes (autre rôle) s'il le souhaite.
-- Testé sur le banc : phase ROLLBACK de tests/sql/assistant-unit-head/lancer-banc.sh
-- =============================================================================
begin;

-- 1. Gardes d'état (déclencheurs)
drop trigger if exists trg_zzzz_aflp_auh_garde_village on public.villages;
drop trigger if exists trg_zzzz_aflp_auh_garde_rt on public.rt;
drop trigger if exists trg_zzzz_aflp_auh_garde_producteur on public.producteurs;
drop trigger if exists trg_zzzz_aflp_auh_garde_achat on public.achats;
drop trigger if exists trg_zzzz_aflp_auh_garde_avance on public.avances;
drop trigger if exists trg_zzzz_aflp_auh_garde_incident on public.aflp_incidents;
drop function if exists private.aflp_auh_garde_village();
drop function if exists private.aflp_auh_garde_rt();
drop function if exists private.aflp_auh_garde_producteur();
drop function if exists private.aflp_auh_garde_achat();
drop function if exists private.aflp_auh_garde_avance();
drop function if exists private.aflp_auh_garde_incident();

-- 2. Politiques restrictives
drop policy if exists villages_auh_perimetre_sel on public.villages;
drop policy if exists rt_auh_perimetre_sel on public.rt;
drop policy if exists rt_auh_perimetre_ins on public.rt;
drop policy if exists achats_auh_perimetre_sel on public.achats;
drop policy if exists avances_auh_perimetre_sel on public.avances;
drop policy if exists avances_auh_interdit_ins on public.avances;
drop policy if exists aflp_incidents_auh_perimetre_sel on public.aflp_incidents;
drop policy if exists sacs_mouvements_auh_perimetre_sel on public.sacs_mouvements;
drop policy if exists sacs_mouvements_auh_perimetre_ins on public.sacs_mouvements;
drop policy if exists reconciliations_auh_perimetre_sel on public.reconciliations;
drop policy if exists reconciliations_auh_perimetre_ins on public.reconciliations;
drop policy if exists depenses_mission_auh_perimetre_sel on public.depenses_mission;

-- 3. Comptes assistants : désactivation (procédure administrateur tracée)
update public.profils set actif = false where role = 'Assistant Unit Head' and actif;

-- 4. Cohérence de compte et fonctions d'appui
drop trigger if exists trg_zzz_profil_auh_coherence on public.profils;
drop function if exists private.profil_auh_coherence();
drop function if exists private.aflp_auh_dans_perimetre(text, text);
drop function if exists private.aflp_village_du_rt(text);
drop function if exists private.aflp_cluster_du_village(text);
drop function if exists private.aflp_auh_cluster();
drop function if exists private.aflp_auh_actif();

-- 5. Contrainte d'origine (NOT VALID : lignes existantes conservées)
alter table public.profils drop constraint profils_role_check;
alter table public.profils add constraint profils_role_check CHECK ((role = ANY (ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'Head of Field'::text, 'Procurement Officer'::text, 'Supervisor'::text, 'Agent Recenseur'::text, 'Consultation uniquement'::text, 'General Manager'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'RT'::text, 'LBA Purchase Officer'::text, 'Warehouse Manager'::text, 'Storekeeper'::text, 'QA / Lab'::text, 'Factory User'::text, 'Finance'::text, 'Viewer / Auditor'::text, 'Finance Manager'::text]))) NOT VALID;

-- 6. Fonctions de production d'origine (copies textuelles du 03/11/2026)
CREATE OR REPLACE FUNCTION public.fbms_roles_attribuables()
 RETURNS TABLE(valeur text, libelle text, portee text, cluster_requis boolean, attribuable boolean, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.est_bm() then
    raise exception 'Réservé au Branch Manager actif' using errcode = '42501';
  end if;
  return query
  with c as (
    select (regexp_matches(pg_get_constraintdef(k.oid), '''([^'']+)''::text', 'g'))[1] as v
    from pg_constraint k
    where k.conrelid = 'public.profils'::regclass and k.conname = 'profils_role_check'
  ),
  meta(v, lib, portee, clr, attr, note, ordre) as (values
    ('Branch Manager', 'Branch Manager / Responsable programme', 'GLOBAL', false, false, 'Non attribuable depuis l''écran : procédure administrateur (Supabase).', 1),
    ('General Manager', 'General Manager', 'GLOBAL', false, false, 'Rôle supérieur au Branch Manager : non attribuable par lui.', 2),
    ('Finance Manager', 'Finance Manager (rapprochement des paiements)', 'GLOBAL', false, false, 'Contrôle financier indépendant du Branch Manager : procédure administrateur.', 2),
    ('Zonal Head', 'Chef de Zone (Zonal Head)', 'GLOBAL', false, true, 'Portée terrain globale (décision du 17/09/2026). Revue des demandes ; ne mouvemente pas les sacs.', 3),
    ('Field Buying Operations Officer', 'Field Buying Operations Officer', 'GLOBAL', false, true, 'Consolidation et coordination ; lecture Sacherie globale.', 4),
    ('Unit Head', 'Chef d''Unité (Unit Head)', 'CLUSTER', true, true, 'Demandes RT, suivi des comptes RT, réceptions terrain. Cluster obligatoire.', 5),
    ('Storekeeper', 'Magasinier (Storekeeper)', 'CLUSTER', true, true, 'Sorties, transferts, comptages, constats physiques. Cluster obligatoire.', 6),
    ('Warehouse Manager', 'Responsable entrepôt usine (Warehouse Manager)', 'HORS_SACHERIE_AFLP', false, true, 'Module RCN TRACE / usine. Aucun accès aux emplacements AFLP.', 7)
  )
  select c.v, coalesce(m.lib, c.v), coalesce(m.portee, 'HORS_SACHERIE_AFLP'), coalesce(m.clr, false),
         coalesce(m.attr, true), m.note
  from c left join meta m on m.v = c.v
  order by coalesce(m.ordre, 100), c.v;
end
$function$;

CREATE OR REPLACE FUNCTION private.sacherie_contexte()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  p public.profils%rowtype;
  v_cl text; v_lect text; v_ecr text; v_glob boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('connecte', false, 'actif', false);
  end if;
  select * into p from public.profils where user_id = auth.uid() and actif = true limit 1;
  if not found then
    return jsonb_build_object('connecte', true, 'actif', false);
  end if;
  v_cl   := private.sacherie_norm_cluster(p.cluster);
  v_glob := coalesce(p.authority_level,'') = 'GLOBAL';
  if p.role = 'Branch Manager' then
    v_lect := 'GLOBAL'; v_ecr := 'GLOBAL';
  elsif p.role = 'Zonal Head' then
    -- Decision du 17/09/2026 (migration zonal_head_global_field_access) :
    -- portee terrain globale. Le Zonal Head controle, il ne mouvemente pas.
    v_lect := case when public.portee_terrain_globale() then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := null;
  elsif p.role = 'Field Buying Operations Officer' then
    v_lect := 'GLOBAL'; v_ecr := null;
  elsif p.role in ('Unit Head', 'Storekeeper') then
    v_lect := case when v_glob then 'GLOBAL' else 'CLUSTER' end;
    v_ecr  := v_lect;
  end if;
  return jsonb_build_object(
    'connecte', true, 'actif', true, 'role', p.role,
    'cluster', v_cl, 'cluster_saisi', p.cluster,
    'lecture', v_lect, 'ecriture', v_ecr);
end
$function$;

commit;
