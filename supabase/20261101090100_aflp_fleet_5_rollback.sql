-- =====================================================================
-- AFLP FLEET — retour arrière de la migration 5.
-- USAGE : uniquement sur décision du Branch Manager, si la migration 5 doit
-- être retirée. NE SUPPRIME AUCUNE DONNÉE : refuse de s'exécuter si des
-- enregistrements créés par la migration 5 existent (sauf le catalogue et
-- les paramètres, qui sont des données de référence).
--
-- Procédure complète (vérifiée sur réplique locale, tests/moto/verifier_rollback_5.sh) :
--   1. exécuter ce fichier ;
--   2. rejouer, dans l'ordre, les migrations 1, 2, 3 et 4 (toutes rejouables) :
--      elles restaurent les définitions d'origine des fonctions, vues et politiques.
-- Les colonnes ajoutées (toutes facultatives) sont conservées : elles sont sans
-- effet pour le code d'origine et leur suppression détruirait de l'information.
-- =====================================================================
begin;

do $$
declare n bigint;
begin
  select (select count(*) from public.moto_photos) + (select count(*) from public.moto_actions_correctives)
       + (select count(*) from public.moto_enveloppes) + (select count(*) from public.moto_depenses)
       + (select count(*) from public.moto_controles where type_controle in ('ETAT_REMISE','INSPECTION_MENSUELLE'))
       + (select count(*) from public.moto_motos where situation_parc = 'PREVUE' or origine = 'EN_EXPLOITATION' or marque is null or modele is null)
       + (select count(*) from public.moto_affectations where cluster_code is null)
    into n;
  if n > 0 then
    raise exception 'Retour arrière refusé : % enregistrement(s) AFLP FLEET existent. Décision humaine requise (archivage avant retrait).', n;
  end if;
end $$;

-- Vues propres à la migration 5 (les vues d'origine sont recréées par la migration 3)
drop view if exists public.moto_v_inspections_exigibles;
drop view if exists public.moto_v_actions;
drop view if exists public.moto_v_enveloppes;
drop view if exists public.moto_v_flotte;   -- recréée par la migration 3 (colonnes d'origine)
drop view if exists public.moto_v_pneus;    -- idem

-- Tables vides (vérifié ci-dessus) ; le catalogue est une donnée de référence.
drop table if exists public.moto_depenses;
drop table if exists public.moto_enveloppes;
drop table if exists public.moto_actions_correctives;
drop table if exists public.moto_photos;
drop table if exists public.moto_catalogue_points;
-- Politique de consultation du stockage d'origine (migration 1) : retire la dépendance aux fonctions de la migration 5.
drop policy if exists moto_documents_consultation on storage.objects;
create policy moto_documents_consultation on storage.objects for select to authenticated
  using (bucket_id = 'moto-documents'
         and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])));

-- Fonctions et vues propres à la migration 5
drop function if exists public.moto_beneficiaires();  -- recréée par la migration 2 (signature d'origine)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname, p.proname) in (
             ('public','moto_photo_ajouter'), ('public','moto_action_signaler'), ('public','moto_action_planifier'),
             ('public','moto_action_realiser'), ('public','moto_action_verifier'), ('public','moto_action_annuler'),
             ('public','moto_receptionner'), ('public','moto_etat_remise_enregistrer'), ('public','moto_etat_remise_confirmer'),
             ('public','moto_mes_etats_a_confirmer'), ('public','moto_inspection_mensuelle'), ('public','moto_enveloppe_demander'),
             ('public','moto_enveloppe_decider'), ('public','moto_depense_declarer'), ('public','moto_depense_justifier'),
             ('public','moto_depense_verifier'),
             ('private','moto_classe_de'), ('private','moto_affectataire'), ('private','moto_items_controles'),
             ('private','moto_photos_enregistrer'), ('private','moto_actions_depuis_items'), ('private','moto_actions_ouvertes'),
             ('private','moto_immobiliser_si_critique'), ('private','moto_beneficiaire_valide'), ('private','moto_etat_remise_valide'),
             ('private','moto_fenetre'), ('private','moto_est_inspecteur_independant'), ('private','moto_lecture_enveloppe'),
             ('private','moto_justificatif_depense_valide'), ('private','moto_exiger_independance'))
  loop execute format('drop function if exists %s', f.sig); end loop;
end $$;

drop index if exists public.moto_controles_mensuelle_unique;
alter table public.moto_controles drop constraint if exists moto_controles_mensuelle_check;
alter table public.moto_controles drop constraint if exists moto_controles_type_controle_check;
alter table public.moto_controles add constraint moto_controles_type_controle_check
  check (type_controle in ('INSPECTION_INITIALE','AVANT_DEPART','REMISE_EN_SERVICE'));
alter table public.moto_motos drop constraint if exists moto_motos_prevue_check;
alter table public.moto_motos alter column marque set not null;
alter table public.moto_motos alter column modele set not null;
alter table public.moto_affectations alter column cluster_code set not null;
delete from public.moto_parametres where cle in ('inspection_zone_jour_fin','inspection_coordination_jour_debut','etat_remise_validite_jours',
  'photos_inspection_min','photos_etat_remise_categories','photos_reference_min','inspecteurs_independants');

commit;
-- Étape 2 obligatoire : rejouer les migrations 1, 2, 3 et 4.
