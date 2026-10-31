-- =====================================================================
-- AFLP FLEET — retour arrière de la migration 6 (maintenance, autorisations BM).
-- USAGE : uniquement sur décision du Branch Manager. NE SUPPRIME AUCUNE DONNÉE
-- MÉTIER : refuse de s'exécuter si un garage, un dossier au nouveau circuit,
-- une autorisation, une facture, une règle versionnée autre que les brouillons
-- d'origine, ou une association moto → modèle existe.
--
-- ATTENTION : retirer la migration 6 RÉTABLIT les failles qu'elle corrige
-- (décision de maintenance par le Chef de zone ou l'ABM, autorisation de
-- dépense d'incident par le Chef de zone, levée d'immobilisation par case cochée).
--
-- Procédure complète (vérifiée sur réplique locale, tests/moto/verifier_rollback_6.sh) :
--   1. exécuter ce fichier (il restaure lui-même, au texte près, les deux fonctions de la
--      migration 2 et les trois vues de la migration 3 modifiées par la migration 6) ;
--   2. rejouer la migration 5 (rejouable), qui restaure les autres fonctions.
--   Les migrations 1 à 4 ne se rejouent plus après la migration 5 (types de retour modifiés).
-- =====================================================================
begin;

do $$
declare n bigint;
begin
  select (select count(*) from public.moto_garages) + (select count(*) from public.moto_maintenance_travaux)
       + (select count(*) from public.moto_autorisations) + (select count(*) from public.moto_factures)
       + (select count(*) from public.moto_regles_versions where nature_source <> 'HYPOTHESE' or statut <> 'BROUILLON' or moto_id is not null)
       + (select count(*) from public.moto_motos where modele_technique_code is not null)
       + (select count(*) from public.moto_maintenances where statut not in ('DEMANDEE','AUTORISEE','EN_COURS','TERMINEE','REFUSEE','ANNULEE')
                                                        or type_maintenance in ('DIAGNOSTIC','PNEUMATIQUE'))
       + (select count(*) from public.moto_depenses where nature is not null)
    into n;
  if n > 0 then
    raise exception 'Retour arrière refusé : % enregistrement(s) du circuit de maintenance AFLP FLEET existent. Décision humaine requise (archivage avant retrait).', n;
  end if;
end $$;

-- Vues (dépendances d'abord)
drop view if exists public.moto_v_exceptions_bm;
drop view if exists public.moto_v_decisions_bm;
drop view if exists public.moto_v_garages;
drop view if exists public.moto_v_maintenance_dossiers;
drop view if exists public.moto_v_echeances;
drop view if exists public.moto_v_cout_km;
drop view if exists public.moto_v_couts;

-- Politique de stockage : retour à la définition de la migration 5
alter policy moto_documents_consultation on storage.objects
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))));

-- Fonctions créées par la migration 6
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname, p.proname) in (
             ('public','moto_modele_technique_definir'), ('public','moto_regle_version_proposer'), ('public','moto_regle_version_approuver'),
             ('public','moto_regle_version_retirer'), ('public','moto_garage_enregistrer'), ('public','moto_garage_statut'),
             ('public','moto_maintenance_diagnostic'), ('public','moto_maintenance_devis'), ('public','moto_autorisation_soumettre'),
             ('public','moto_autorisation_decider'), ('public','moto_maintenance_programmer'), ('public','moto_maintenance_controler'),
             ('public','moto_facture_deposer'), ('public','moto_facture_verifier'), ('public','moto_facture_paiement_constater'),
             ('public','moto_maintenance_cloturer'), ('public','moto_maintenance_annuler'),
             ('private','moto_piece_fin_valide'), ('private','moto_total_autorise'),
             ('private','moto_autorisation_valide'), ('private','moto_premiere_decision'), ('private','moto_facture_utilisable'))
  loop execute format('drop function %s', f.sig); end loop;
end $$;

-- Colonnes de rattachement (vides, vérifié ci-dessus) puis tables
alter table public.moto_depenses drop constraint if exists moto_depenses_nature_check;
alter table public.moto_depenses drop column if exists facture_id;
alter table public.moto_depenses drop column if exists autorisation_id;
alter table public.moto_depenses drop column if exists nature;
alter table public.moto_pneus drop column if exists facture_id;
alter table public.moto_pneu_reparations drop column if exists facture_id;
alter table public.moto_pneus drop column if exists autorisation_id;
alter table public.moto_pneu_reparations drop column if exists autorisation_id;
drop table if exists public.moto_factures;
drop table if exists public.moto_autorisations;
drop table if exists public.moto_maintenance_travaux;
alter table public.moto_maintenances drop constraint if exists moto_maintenances_devis_unique;
alter table public.moto_maintenances drop column if exists garage_id;
alter table public.moto_motos drop column if exists modele_technique_code;
alter table public.moto_motos drop column if exists modele_technique_par;
alter table public.moto_motos drop column if exists modele_technique_at;
drop table if exists public.moto_garages;
drop table if exists public.moto_regles_versions;
drop table if exists public.moto_modeles_techniques;
drop function if exists private.moto_lecture_fin_maintenance();   -- après les politiques qui l'utilisent

-- Droit de lecture d'origine sur la table des dossiers (la migration 6 l'avait restreint par colonne)
do $$ declare c record; begin
  for c in select column_name from information_schema.columns where table_schema = 'public' and table_name = 'moto_maintenances' loop
    execute format('revoke select (%I) on public.moto_maintenances from authenticated', c.column_name);
  end loop;
end $$;
grant select on public.moto_maintenances to authenticated;

-- Contraintes d'origine
alter table public.moto_maintenances drop constraint if exists moto_maintenances_statut_check;
alter table public.moto_maintenances add constraint moto_maintenances_statut_check
  check (statut in ('DEMANDEE','AUTORISEE','EN_COURS','TERMINEE','REFUSEE','ANNULEE'));
alter table public.moto_maintenances drop constraint if exists moto_maintenances_type_maintenance_check;
alter table public.moto_maintenances add constraint moto_maintenances_type_maintenance_check
  check (type_maintenance in ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION','REPARATION','PANNE'));

-- Les colonnes facultatives ajoutées à moto_maintenances (devis, programmation, contrôle, clôture)
-- sont conservées : sans effet pour le code d'origine (même règle que le retour arrière 5).
-- Restauration exacte des définitions d'origine (migration 2 : fonctions ; migration 3 : vues).
create or replace function public.moto_maintenance_decider(p_maintenance uuid, p_decision text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances;
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM']);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut <> 'DEMANDEE' then perform private.moto_erreur('Demande introuvable ou déjà décidée.'); end if;
  if not private.moto_peut_operer(mt.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if mt.demande_par = auth.uid() then perform private.moto_refus('Auto-autorisation interdite : un autre responsable décide.'); end if;
  if upper(p_decision) not in ('AUTORISEE','REFUSEE') then perform private.moto_erreur('Décision inconnue.'); end if;
  perform private.moto_motif(p_motif, case when upper(p_decision) = 'REFUSEE' then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_maintenances set statut = upper(p_decision), autorise_par = auth.uid(), autorise_at = now() where id = p_maintenance;
  return jsonb_build_object('id', p_maintenance, 'statut', upper(p_decision));
end $$;
create or replace function public.moto_regle_maintenance_definir(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p ->> 'motif', 5);
  update public.moto_regles_maintenance set
    intervalle_km = private.moto_num(p, 'intervalle_km'), intervalle_jours = private.moto_num(p, 'intervalle_jours')::integer,
    tolerance_km = coalesce(private.moto_num(p, 'tolerance_km'), tolerance_km),
    source = coalesce(nullif(upper(p ->> 'source'), ''), 'PARAMETRE_ANAGROCI'),
    reference_documentaire = nullif(btrim(p ->> 'reference_documentaire'), ''),
    actif = coalesce((p ->> 'actif')::boolean, false), updated_by = auth.uid(), updated_at = now()
  where code = p ->> 'code';
  if not found then perform private.moto_erreur('Règle inconnue.'); end if;
  return jsonb_build_object('code', p ->> 'code');
end $$;
create or replace view public.moto_v_couts with (security_invoker = on) as
select m.id as moto_id, m.code, m.mise_en_service_at,
  (select min(r.compteur_km) from public.moto_releves_km r where r.moto_id = m.id and m.mise_en_service_at is not null
     and r.date_releve >= m.mise_en_service_at - interval '2 days') as km_debut,
  m.compteur_actuel_km as km_fin,
  coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'VERIFIE'), 0) as cout_carburant_verifie,
  coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'A_VERIFIER'), 0) as cout_carburant_a_verifier,
  coalesce((select sum(mt.cout_reel) from public.moto_maintenances mt where mt.moto_id = m.id and mt.statut = 'TERMINEE'), 0) as cout_maintenance,
  coalesce((select sum(pr.cout) from public.moto_pneu_reparations pr where pr.moto_id = m.id), 0)
    + coalesce((select sum(pn.cout_achat) from public.moto_pneus pn
                where (select po.moto_id from public.moto_pneu_poses po where po.pneu_id = pn.id order by po.pose_date, po.id limit 1) = m.id), 0) as cout_pneus,
  coalesce((select sum(i.cout_reel) from public.moto_incidents i where i.moto_id = m.id and i.etape = 'CLOS'
              and not exists (select 1 from public.moto_maintenances mt where mt.incident_id = i.id)), 0) as cout_incidents
from public.moto_motos m where m.actif;

create or replace view public.moto_v_cout_km with (security_invoker = on) as
select c.*, c.km_fin - c.km_debut as km_parcourus,
  c.cout_carburant_verifie + c.cout_maintenance + c.cout_pneus + c.cout_incidents as cout_direct_total,
  case when c.km_fin - c.km_debut > 0
       then round((c.cout_carburant_verifie + c.cout_maintenance + c.cout_pneus + c.cout_incidents) / (c.km_fin - c.km_debut), 1) end as fcfa_km
from public.moto_v_couts c;

create or replace view public.moto_v_echeances with (security_invoker = on) as
select m.id as moto_id, m.code, r.code as regle, r.libelle, r.source, r.intervalle_km, r.intervalle_jours,
  coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) as base_km,
  coalesce(last.termine_at, m.mise_en_service_at)::date as base_date,
  coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) + r.intervalle_km as prochaine_km,
  (coalesce(last.termine_at, m.mise_en_service_at)::date + r.intervalle_jours) as prochaine_date,
  case
    when (r.intervalle_km is not null and m.compteur_actuel_km >= coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) + r.intervalle_km)
      or (r.intervalle_jours is not null and current_date >= coalesce(last.termine_at, m.mise_en_service_at)::date + r.intervalle_jours) then 'DEPASSEE'
    when (r.intervalle_km is not null and m.compteur_actuel_km >= coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) + r.intervalle_km - r.tolerance_km)
      or (r.intervalle_jours is not null and current_date >= coalesce(last.termine_at, m.mise_en_service_at)::date + r.intervalle_jours - 7) then 'PROCHE'
    when coalesce(last.compteur_km, (select min(x.compteur_km) from public.moto_releves_km x where x.moto_id = m.id and x.source = 'REMISE')) is null
      and coalesce(last.termine_at, m.mise_en_service_at) is null then 'NON_DISPONIBLE'
    else 'A_JOUR' end as statut
from public.moto_motos m
cross join public.moto_regles_maintenance r
left join lateral (select mt.compteur_km, mt.termine_at from public.moto_maintenances mt
                   where mt.moto_id = m.id and mt.statut = 'TERMINEE' and mt.type_maintenance = r.type_maintenance
                   order by mt.termine_at desc limit 1) last on true
where m.actif and r.actif and m.mise_en_service_at is not null;


do $$ declare v text; begin
  foreach v in array array['moto_v_couts','moto_v_cout_km','moto_v_echeances'] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

commit;
