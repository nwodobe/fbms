-- =====================================================================
-- AFLP FLEET · Retour arrière de la migration 8 (journal de mission).
-- REFUSÉ s'il existe une mission ou un relevé de source MISSION : on ne
-- détruit jamais de données de terrain. Restaure les textes exacts des
-- migrations 5 (moto_sync_batch) et 7 (moto_peut_deposer, moto_carnet).
-- Restes à purger à la main après retour arrière : aucun (refusé dès qu'une
-- mission existe) ; si des photos <moto>/mission/ ont été déposées sans
-- mission synchronisée, les supprimer par l'API Storage (tableau de bord).
-- Couplage : l'interface (moto-mission.js) doit être retirée en même temps.
-- =====================================================================
begin;

do $$ begin
  if to_regclass('public.moto_missions') is not null then
    if exists (select 1 from public.moto_missions) then raise exception 'Retour arrière refusé : des missions existent.'; end if;
  end if;
  if exists (select 1 from public.moto_releves_km where source = 'MISSION') then
    raise exception 'Retour arrière refusé : des relevés de mission existent.';
  end if;
end $$;

drop view if exists public.moto_v_missions_couts;
drop view if exists public.moto_v_missions_mois;
drop view if exists public.moto_v_mission_ecarts;
drop view if exists public.moto_v_missions;

drop trigger if exists moto_releves_mission_coherence_trg on public.moto_releves_km;

drop function if exists public.moto_mission_demarrer(jsonb);
drop function if exists public.moto_mission_cloturer(jsonb);
drop function if exists public.moto_mission_annuler(uuid, text);
drop function if exists public.moto_mission_anomalie_traiter(uuid, text, text);
drop function if exists public.moto_missions_photos_a_purger();
drop function if exists public.moto_missions_photos_purger(text[]);

drop table if exists public.moto_mission_anomalies;
drop table if exists public.moto_mission_positions;
drop table if exists public.moto_mission_photos;

drop function if exists private.moto_mission_lecture_id(uuid);
drop function if exists private.moto_mission_lecture_position(uuid);
do $$ begin
  if to_regclass('public.moto_missions') is not null then drop policy if exists moto_missions_lecture on public.moto_missions; end if;
end $$;
drop function if exists private.moto_mission_lecture(public.moto_missions);
drop table if exists public.moto_missions;

drop function if exists private.moto_mission_gps_statut(jsonb, text);
drop function if exists private.moto_mission_horloge(jsonb);
drop function if exists private.moto_mission_signaler(uuid, text, text, numeric, numeric);
drop function if exists private.moto_mission_photo(uuid, uuid, uuid, text, jsonb);
drop function if exists private.moto_mission_position(uuid, text, jsonb, text);
drop function if exists private.moto_mission_origine(jsonb, numeric);
drop function if exists private.moto_mission_capture(jsonb);
drop function if exists private.moto_mission_releve_coherence();
drop function if exists private.moto_mission_immuable();

alter table public.moto_releves_km drop constraint if exists moto_releves_km_source_check;
alter table public.moto_releves_km add constraint moto_releves_km_source_check
  check (source in ('RELEVE','CONTROLE','CARBURANT','REMISE','INCIDENT','MAINTENANCE','CORRECTION'));

delete from public.moto_parametres where cle in ('mission_seuil_hors_mission_km','mission_seuil_continuite_km','mission_vitesse_max_kmh',
  'mission_distance_max_km','mission_photo_max_octets','mission_photos_conservation_mois','mission_horloge_ecart_max_min','mission_delai_saisie_jours',
  'mission_saisie_differee_h');

-- Textes d'origine
create or replace function private.moto_num(p jsonb, k text)
returns numeric language plpgsql immutable as $$
begin
  if nullif(btrim(coalesce(p ->> k, '')), '') is null then return null; end if;
  return (replace(btrim(p ->> k), ',', '.'))::numeric;
exception when others then
  raise exception 'Valeur numérique invalide pour « % ».', k using errcode = 'P0001';
end $$;

alter function private.moto_num(jsonb, text) set search_path = public, private, pg_temp;   -- migration 4

create or replace function public.moto_correction_decider(p_correction uuid, p_decision text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare c public.moto_corrections; v_classe text; v_type text; v_actuel text; v_moto uuid;
begin
  v_classe := private.moto_exiger_classe(array['BM','DIRECTION','FINANCE']);
  if v_classe = 'FINANCE' and not private.moto_est_finance_manager() then perform private.moto_refus('Validation réservée au Branch Manager, au General Manager ou au Finance Manager.'); end if;
  select * into c from public.moto_corrections where id = p_correction for update;
  if not found or c.statut <> 'DEMANDEE' then perform private.moto_erreur('Correction introuvable ou déjà décidée.'); end if;
  if c.demande_par = auth.uid() then perform private.moto_refus('Auto-approbation interdite : un autre responsable doit valider.'); end if;
  if upper(p_decision) not in ('APPLIQUEE','REJETEE') then perform private.moto_erreur('Décision inconnue.'); end if;
  perform private.moto_motif(coalesce(nullif(btrim(p_motif), ''), c.motif), case when upper(p_decision) = 'REJETEE' then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  if upper(p_decision) = 'APPLIQUEE' then
    v_type := private.moto_champ_corrigeable(c.cible_table, c.champ, 'BM');
    execute format('select %I::text, moto_id from public.%I where id = $1 for update', c.champ, c.cible_table) into v_actuel, v_moto using c.cible_id;
    if v_actuel is distinct from c.ancienne_valeur then
      perform private.moto_erreur('CONFLIT : la valeur a changé depuis la demande. Créez une nouvelle demande.');
    end if;
    execute format('update public.%I set %I = $1::%s where id = $2', c.cible_table, c.champ, v_type) using c.nouvelle_valeur, c.cible_id;
    if c.cible_table = 'moto_releves_km' or (c.cible_table = 'moto_carburant' and c.champ = 'compteur_km') then
      update public.moto_motos set compteur_actuel_km = (select max(compteur_km) from public.moto_releves_km where moto_id = v_moto)
      where id = v_moto;
    end if;
  end if;
  update public.moto_corrections set statut = upper(p_decision), valide_par = auth.uid(), valide_at = now(),
         decision_motif = nullif(btrim(p_motif), '') where id = p_correction;
  return jsonb_build_object('id', p_correction, 'statut', upper(p_decision));
end $$;


alter policy moto_documents_consultation on storage.objects
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))
              or ((storage.foldername(name))[1] = 'finmaint' and private.moto_lecture_fin_maintenance())
              or ((storage.foldername(name))[1] = 'permis'
                  and private.moto_lecture_permis(private.moto_uuid_ou_null((storage.foldername(name))[2])))));


drop function if exists private.moto_mission_photo_lecture(text);

create or replace function public.moto_sync_batch(p_operations jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare op jsonb; v_type text; v_client uuid; v_payload jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb; v_state text; v_msg text; v_prev jsonb;
begin
  if auth.uid() is null or private.moto_classe() is null then perform private.moto_refus('Accès AFLP FLEET refusé.'); end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then perform private.moto_erreur('Lot invalide.'); end if;
  if jsonb_array_length(p_operations) > 50 then perform private.moto_erreur('Lot limité à 50 opérations.'); end if;
  for op in select * from jsonb_array_elements(p_operations) loop
    v_type := upper(coalesce(op ->> 'type', ''));
    v_client := private.moto_uuid_ou_null(op ->> 'client_op_id');
    if v_client is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', op ->> 'client_op_id', 'statut', 'REJETE', 'message', 'Identifiant d''opération manquant ou invalide.'));
      continue;
    end if;
    v_payload := coalesce(op -> 'payload', '{}'::jsonb) || jsonb_build_object('client_op_id', v_client::text);
    begin
      v_prev := private.moto_op_existant(v_client);
      if v_prev is not null then
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', coalesce(v_prev ->> 'statut', 'SYNCHRONISE'),
                                                                'doublon', true, 'resultat', v_prev, 'message', v_prev ->> 'message'));
        continue;
      end if;
      v_res := case v_type
        when 'RELEVE_KM' then public.moto_releve_km(v_payload)
        when 'CONTROLE_DEPART' then public.moto_controle_depart(v_payload)
        when 'CARBURANT' then public.moto_carburant_declarer(v_payload)
        when 'INCIDENT' then public.moto_incident_declarer(v_payload)
        when 'DOTATION_CONFIRMER' then public.moto_dotation_confirmer(v_payload)
        when 'MAINTENANCE_DEMANDE' then public.moto_maintenance_demander(v_payload)
        when 'FORMATION' then public.moto_formation_enregistrer(v_payload)
        when 'INSPECTION_MENSUELLE' then public.moto_inspection_mensuelle(v_payload)
        when 'ACTION_SIGNALER' then public.moto_action_signaler(v_payload)
        when 'DEPENSE' then public.moto_depense_declarer(v_payload)
        else null end;
      if v_res is null then perform private.moto_erreur('Type d''opération non synchronisable : '||v_type); end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'SYNCHRONISE', 'resultat', v_res));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state in ('P0001','42501','23514','23505','23502','23503','22P02','22003','22007','22008','22023','2201B') then
        perform private.moto_op_enregistrer(v_client, v_type, 'REJETE', jsonb_build_object('message', v_msg, 'code', v_state));
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'REJETE', 'message', v_msg, 'code', v_state));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'ERREUR_TEMPORAIRE', 'message', v_msg, 'code', v_state));
      end if;
    end;
  end loop;
  return v_out;
end $$;


create or replace function private.moto_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
        v_tit uuid;
begin
  if v_classe is null then return false; end if;
  if (storage.foldername(p_nom))[1] = 'depenses' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and v_cat = auth.uid()::text;
  end if;
  if (storage.foldername(p_nom))[1] = 'finmaint' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and (storage.foldername(p_nom))[3] in ('devis','facture')
       and exists (select 1 from public.moto_motos where id = private.moto_uuid_ou_null((storage.foldername(p_nom))[2]));
  end if;
  if (storage.foldername(p_nom))[1] = 'permis' then
    v_tit := private.moto_uuid_ou_null(v_cat);
    if v_tit is null or not private.moto_chemin_permis_valide(p_nom, v_tit) or not private.moto_beneficiaire_valide(v_tit) then return false; end if;
    return v_tit = auth.uid() or v_classe in ('BM','ABM','LOGISTIQUE');
  end if;
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle'); end if;
  return false;
end $$;


create or replace function public.moto_carnet(p_moto uuid)
returns table (date_evenement timestamptz, categorie text, evenement text, detail text, statut text,
               compteur_km numeric, montant numeric, montant_nature text, acteur text, source text, source_id uuid)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_fin boolean := private.moto_lecture_fin_maintenance();
begin
  if p_moto is null or not private.moto_dans_perimetre(p_moto) then
    perform private.moto_refus('Moto hors de votre périmètre.');
  end if;
  return query
  select * from (
    -- Parc : enregistrement, début d'utilisation déclaré, début du suivi fiable, mise en service
    select m.created_at, 'PARC'::text,
           case when m.origine = 'EN_EXPLOITATION' then 'Intégration dans AFLP FLEET' else 'Enregistrement de la moto' end,
           concat_ws(' · ', nullif(btrim(concat_ws(' ', m.marque, m.modele)), ''),
                     case when m.date_reception is not null then 'réception le ' || to_char(m.date_reception, 'DD/MM/YYYY') end,
                     case when m.situation_parc is not null then private.moto_lib(m.situation_parc) end),
           null::text, m.compteur_reception_km, null::numeric, null::text, private.moto_nom_profil(m.created_by), 'moto_motos'::text, m.id
    from public.moto_motos m where m.id = p_moto
    union all
    select m.date_debut_utilisation::timestamptz, 'PARC', 'Début d''utilisation (déclaré)', coalesce(m.historique_note, 'Historique antérieur non documenté'),
           null, null, null, null, null, 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.date_debut_utilisation is not null
    union all
    select m.date_debut_suivi::timestamptz, 'PARC', 'Début du suivi fiable', 'Les indicateurs ne remontent pas avant cette date', null, null, null, null, null, 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.date_debut_suivi is not null
    union all
    select m.mise_en_service_at, 'PARC', 'Mise en service (autorisation de circuler)', m.mise_en_service_motif, null, null, null, null,
           private.moto_nom_profil(m.mise_en_service_par), 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.mise_en_service_at is not null
    union all
    -- Affectations
    select a.created_at, 'AFFECTATION',
           case a.type_affectation when 'PREAFFECTATION' then 'Préaffectation' when 'REMISE' then 'Remise officielle' else 'Transfert' end,
           'Bénéficiaire : ' || coalesce(private.moto_nom_profil(a.beneficiaire_id), '—')
             || case when a.permis_id is not null then ' · permis vérifié (' || coalesce(a.permis_categorie, '') || ')' else '' end,
           a.statut, a.compteur_km, null, null, private.moto_nom_profil(a.cree_par), 'moto_affectations', a.id
    from public.moto_affectations a where a.moto_id = p_moto
    union all
    -- Contrôles et inspections (les contrôles avant départ n'apparaissent qu'en cas de défaut)
    select c.date_controle, 'CONTROLE',
           case c.type_controle when 'INSPECTION_INITIALE' then 'Inspection mécanique initiale'
                                when 'INSPECTION_MENSUELLE' then 'Inspection mensuelle (' || private.moto_lib(c.niveau) || ')'
                                when 'ETAT_REMISE' then 'État contradictoire avant remise'
                                when 'REMISE_EN_SERVICE' then 'Contrôle de remise en service'
                                else 'Contrôle avant départ : défaut' end,
           concat_ws(' · ', nullif(c.intervenant_nom, ''), nullif(c.garage_nom, ''), nullif(c.observations, ''), nullif(c.besoins_entretien, '')),
           coalesce(c.conformite, c.resultat), c.compteur_km, null, null, private.moto_nom_profil(c.realise_par), 'moto_controles', c.id
    from public.moto_controles c
    where c.moto_id = p_moto and c.remplace_par is null
      and (c.type_controle <> 'AVANT_DEPART' or c.anomalie_critique or c.resultat = 'INAPTE')
    union all
    -- Anomalies et actions correctives
    select ac.constat_at, 'ANOMALIE', 'Anomalie constatée (' || private.moto_lib(ac.gravite) || ')', ac.anomalie, ac.statut, null, null, null,
           private.moto_nom_profil(ac.signale_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto
    union all
    select ac.realise_at, 'ANOMALIE', 'Correction réalisée', coalesce(ac.action_prevue, ac.anomalie), ac.statut, null, null, null,
           private.moto_nom_profil(ac.realise_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto and ac.realise_at is not null
    union all
    select ac.verifie_at, 'ANOMALIE', 'Correction vérifiée', coalesce(ac.verification_note, ac.anomalie), ac.statut, null, null, null,
           private.moto_nom_profil(ac.verifie_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto and ac.verifie_at is not null
    union all
    -- Maintenance : besoin, travaux réalisés, contrôle, clôture, annulation
    select mt.demande_at, 'MAINTENANCE', 'Besoin d''entretien ou de réparation (' || private.moto_lib(mt.type_maintenance) || ')',
           mt.description, mt.statut, mt.compteur_km, null, null, private.moto_nom_profil(mt.demande_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto
    union all
    select coalesce(mt.date_realisation::timestamptz, mt.termine_at), 'MAINTENANCE', 'Travaux réalisés' || coalesce(' chez ' || g.nom, ''),
           concat_ws(' · ', (select string_agg(t.libelle, ', ' order by t.created_at) from public.moto_maintenance_travaux t
                             where t.maintenance_id = mt.id and t.statut = 'REALISE'),
                     case when mt.pieces_remplacees is not null then 'Pièces : ' || mt.pieces_remplacees end, mt.observations_travaux),
           mt.statut, null, null, null, private.moto_nom_profil(mt.termine_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt left join public.moto_garages g on g.id = mt.garage_id
    where mt.moto_id = p_moto and (mt.date_realisation is not null or mt.termine_at is not null)
    union all
    select mt.controle_at, 'MAINTENANCE', 'Contrôle des travaux', mt.controle_note, mt.controle_resultat, null, null, null,
           private.moto_nom_profil(mt.controle_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.controle_at is not null
    union all
    select mt.cloture_at, 'MAINTENANCE', 'Dossier clôturé', mt.cloture_motif, mt.statut, null, null, null,
           private.moto_nom_profil(mt.cloture_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.cloture_at is not null
    union all
    select mt.annule_at, 'MAINTENANCE', 'Dossier annulé', mt.annule_motif, mt.statut, null, null, null,
           private.moto_nom_profil(mt.annule_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.annule_at is not null
    union all
    -- Décisions du Branch Manager (lecture financière uniquement)
    select au.decide_at, 'AUTORISATION', 'Décision du Branch Manager : ' || private.moto_lib(au.statut), au.perimetre, au.statut, null,
           au.montant_autorise, 'AUTORISE', private.moto_nom_profil(au.decide_par), 'moto_autorisations', au.id
    from public.moto_autorisations au where v_fin and au.moto_id = p_moto and au.decide_at is not null
    union all
    -- Factures et paiements (lecture financière uniquement)
    select f.date_facture::timestamptz, 'FACTURE', 'Facture n° ' || f.numero_facture || coalesce(' · ' || g.nom, ''),
           coalesce(f.motif_verification, ''), f.statut, null, f.montant, 'FACTURE', private.moto_nom_profil(f.depose_par), 'moto_factures', f.id
    from public.moto_factures f left join public.moto_garages g on g.id = f.garage_id
    where v_fin and f.moto_id = p_moto
    union all
    select f.paiement_date::timestamptz, 'FACTURE', 'Paiement constaté · facture n° ' || f.numero_facture, f.paiement_reference, null, null,
           f.montant_paye, 'PAYE', private.moto_nom_profil(f.paiement_par), 'moto_factures', f.id
    from public.moto_factures f where v_fin and f.moto_id = p_moto and f.paiement_date is not null and f.montant_paye > 0
    union all
    -- Pneumatiques
    select po.pose_date::timestamptz, 'PNEU', 'Pneu monté (' || private.moto_lib(po.position) || ')',
           concat_ws(' ', pn.code, pn.marque, pn.dimensions), null, po.pose_km, null, null, private.moto_nom_profil(po.pose_par), 'moto_pneu_poses', po.id
    from public.moto_pneu_poses po left join public.moto_pneus pn on pn.id = po.pneu_id where po.moto_id = p_moto
    union all
    select po.depose_date::timestamptz, 'PNEU', 'Pneu déposé (' || private.moto_lib(po.position) || ')',
           concat_ws(' · ', concat_ws(' ', pn.code, pn.marque), po.motif_depose,
                     case when po.depose_km is not null and po.pose_km is not null then (po.depose_km - po.pose_km)::text || ' km parcourus' end),
           null, po.depose_km, null, null, private.moto_nom_profil(po.depose_par), 'moto_pneu_poses', po.id
    from public.moto_pneu_poses po left join public.moto_pneus pn on pn.id = po.pneu_id where po.moto_id = p_moto and po.depose_date is not null
    union all
    select pr.date_reparation::timestamptz, 'PNEU', 'Réparation de pneu', pr.description, null, pr.compteur_km,
           case when v_fin then pr.cout end, case when v_fin and pr.cout is not null then 'PNEU' end,
           private.moto_nom_profil(pr.saisi_par), 'moto_pneu_reparations', pr.id
    from public.moto_pneu_reparations pr where pr.moto_id = p_moto
    union all
    -- Carburant : synthèse mensuelle (le détail reste dans l'onglet Carburant)
    select max(c.date_achat), 'CARBURANT', 'Carburant · ' || to_char(date_trunc('month', c.date_achat), 'MM/YYYY'),
           count(*)::text || ' achat(s) · ' || replace(trim(to_char(sum(c.litres), 'FM999990.0')), '.', ',') || ' L'
             || case when count(*) filter (where c.justificatif_statut = 'A_VERIFIER') > 0
                     then ' · ' || count(*) filter (where c.justificatif_statut = 'A_VERIFIER') || ' justificatif(s) à vérifier' else '' end,
           null, max(c.compteur_km), sum(c.montant), 'CARBURANT', null, 'moto_carburant', null::uuid
    from public.moto_carburant c where c.moto_id = p_moto
    group by date_trunc('month', c.date_achat)
    union all
    -- Incidents
    select i.declare_at, 'INCIDENT', 'Incident : ' || private.moto_lib(i.type_incident) || ' (' || private.moto_lib(i.gravite) || ')', i.description, i.etape, i.compteur_km,
           null, null, private.moto_nom_profil(i.declare_par), 'moto_incidents', i.id
    from public.moto_incidents i where i.moto_id = p_moto
    union all
    select i.clos_at, 'INCIDENT', 'Incident clos', i.description, i.etape, null, null, null, private.moto_nom_profil(i.clos_par), 'moto_incidents', i.id
    from public.moto_incidents i where i.moto_id = p_moto and i.clos_at is not null
    union all
    -- Immobilisations
    select im.debut, 'IMMOBILISATION', 'Immobilisation', im.motif, case when im.fin is null then 'EN_COURS' else 'LEVEE' end, null, null, null,
           private.moto_nom_profil(im.ouverte_par), 'moto_immobilisations', im.id
    from public.moto_immobilisations im where im.moto_id = p_moto
    union all
    select im.fin, 'IMMOBILISATION', 'Remise en circulation', im.levee_motif, 'LEVEE', null, null, null,
           private.moto_nom_profil(im.levee_par), 'moto_immobilisations', im.id
    from public.moto_immobilisations im where im.moto_id = p_moto and im.fin is not null
    union all
    -- Documents de la moto
    select d.depose_at, 'DOCUMENT', 'Document déposé : ' || private.moto_lib(d.type_document),
           concat_ws(' · ', d.numero_reference, case when d.date_expiration is not null then 'expire le ' || to_char(d.date_expiration, 'DD/MM/YYYY') end),
           d.statut, null, null, null, private.moto_nom_profil(d.depose_par), 'moto_documents', d.id
    from public.moto_documents d where d.moto_id = p_moto
  ) e (date_evenement, categorie, evenement, detail, statut, compteur_km, montant, montant_nature, acteur, source, source_id)
  where e.date_evenement is not null
  order by e.date_evenement desc, e.categorie;
end $$;


do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_classe_de','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_lecture_enveloppe','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param','moto_fenetre','moto_lecture_fin_maintenance','moto_lecture_permis') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
