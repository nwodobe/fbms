-- =====================================================================
-- ANAGROCI FBMS — AFLP MOTO MANAGER (2/3) : fonctions métier sécurisées
-- Fichier : supabase/20261031090100_aflp_moto_manager_2_rpc.sql
--
-- STATUT : APPLIQUÉE EN PRODUCTION le 31/10/2026 sur autorisation de M. KOUASSI.
--
-- Toutes les écritures Moto Manager passent par ces fonctions. Chacune :
--   · vérifie le compte actif, la classe métier et le périmètre côté serveur ;
--   · interdit l'auto-approbation des opérations sensibles ;
--   · trace le motif dans le journal (setting transactionnel moto.motif) ;
--   · pour les opérations terrain : idempotence par client_op_id.
-- Aucune fonction n'exécute de paiement : elles enregistrent et rapprochent.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Outils internes
-- ---------------------------------------------------------------------
create or replace function private.moto_refus(p_message text)
returns void language plpgsql as $$
begin raise exception '%', p_message using errcode = '42501'; end $$;

create or replace function private.moto_erreur(p_message text)
returns void language plpgsql as $$
begin raise exception '%', p_message using errcode = 'P0001'; end $$;

create or replace function private.moto_exiger_classe(p_classes text[])
returns text language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v text := private.moto_classe();
begin
  if auth.uid() is null or v is null then perform private.moto_refus('Accès Moto Manager refusé : compte inactif ou rôle non habilité.'); end if;
  if not (v = any(p_classes)) then
    perform private.moto_refus('Votre rôle ne permet pas cette opération Moto Manager.');
  end if;
  return v;
end $$;

create or replace function private.moto_motif(p_motif text, p_min integer default 0)
returns void language plpgsql as $$
begin
  if length(btrim(coalesce(p_motif, ''))) < p_min then
    raise exception 'Motif obligatoire (% caractères minimum).', p_min using errcode = 'P0001';
  end if;
  perform set_config('moto.motif', coalesce(btrim(p_motif), ''), true);
end $$;

create or replace function private.moto_op_existant(p_client uuid)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare r record;
begin
  if p_client is null then return null; end if;
  select * into r from public.moto_operations where client_op_id = p_client;
  if not found then return null; end if;
  if r.user_id <> auth.uid() then
    perform private.moto_refus('Identifiant d''opération déjà utilisé par un autre compte.');
  end if;
  return r.resultat || jsonb_build_object('doublon', true, 'statut', r.statut);
end $$;

create or replace function private.moto_op_enregistrer(p_client uuid, p_type text, p_statut text, p_resultat jsonb)
returns void language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.moto_operations (client_op_id, user_id, type_operation, statut, resultat)
  select p_client, auth.uid(), p_type, p_statut, p_resultat where p_client is not null
  on conflict (client_op_id) do nothing
$$;

create or replace function private.moto_uuid(p jsonb, k text)
returns uuid language sql immutable as $$ select private.moto_uuid_ou_null(nullif(btrim(p ->> k), '')) $$;

create or replace function private.moto_num(p jsonb, k text)
returns numeric language plpgsql immutable as $$
begin
  if nullif(btrim(coalesce(p ->> k, '')), '') is null then return null; end if;
  return (replace(btrim(p ->> k), ',', '.'))::numeric;
exception when others then
  raise exception 'Valeur numérique invalide pour « % ».', k using errcode = 'P0001';
end $$;

create or replace function private.moto_peut_operer(p_moto uuid)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v text := private.moto_classe();
begin
  if v in ('BM','ABM') then return exists (select 1 from public.moto_motos where id = p_moto); end if;
  if v = 'ZONE' then return private.moto_dans_perimetre(p_moto); end if;
  if v = 'UNITE' then return private.moto_est_affectataire(p_moto); end if;
  return false;
end $$;

create or replace function private.moto_charger(p_moto uuid, p_pour_maj boolean default false)
returns public.moto_motos language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare m public.moto_motos;
begin
  if p_moto is null then perform private.moto_erreur('Moto non précisée.'); end if;
  if p_pour_maj then select * into m from public.moto_motos where id = p_moto for update;
  else select * into m from public.moto_motos where id = p_moto; end if;
  if not found or not m.actif then perform private.moto_erreur('Moto introuvable ou inactive.'); end if;
  return m;
end $$;

create or replace function private.moto_stockage_valide(p_moto uuid, p_path text, p_categories text[])
returns void language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if p_path is null then return; end if;
  if (storage.foldername(p_path))[1] is distinct from p_moto::text
     or not ((storage.foldername(p_path))[2] = any(p_categories)) then
    perform private.moto_erreur('Chemin de fichier non conforme pour cette moto.');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'moto-documents' and name = p_path) then
    perform private.moto_erreur('Fichier introuvable dans le stockage privé : déposez-le avant d''enregistrer.');
  end if;
end $$;

-- Cohérence temporelle du compteur : à l'instant t, un relevé k est incohérent
-- s'il existe un relevé antérieur supérieur à k ou un relevé postérieur inférieur.
create or replace function private.moto_enregistrer_km(p_moto uuid, p_km numeric, p_at timestamptz, p_source text, p_client uuid default null)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_avant numeric; v_apres numeric;
begin
  if p_km is null then return; end if;
  if p_km < 0 then perform private.moto_erreur('Compteur négatif refusé.'); end if;
  select max(compteur_km) into v_avant from public.moto_releves_km where moto_id = p_moto and date_releve <= p_at;
  select min(compteur_km) into v_apres from public.moto_releves_km where moto_id = p_moto and date_releve > p_at;
  if v_avant is not null and p_km < v_avant then
    perform private.moto_erreur(format('CONFLIT_COMPTEUR : %s km est inférieur au relevé antérieur (%s km). Demandez une correction.', p_km, v_avant));
  end if;
  if v_apres is not null and p_km > v_apres then
    perform private.moto_erreur(format('CONFLIT_COMPTEUR : %s km dépasse un relevé postérieur (%s km). Demandez une correction.', p_km, v_apres));
  end if;
  insert into public.moto_releves_km (moto_id, date_releve, compteur_km, source, client_op_id)
  values (p_moto, p_at, p_km, p_source, case when p_source = 'RELEVE' then p_client else null end);
  update public.moto_motos set compteur_actuel_km = greatest(coalesce(compteur_actuel_km, 0), p_km), updated_at = now()
  where id = p_moto and (compteur_actuel_km is null or compteur_actuel_km < p_km);
end $$;

-- Recalcul des statuts administratif et technique (source unique de vérité).
create or replace function private.moto_recalculer_statuts(p_moto uuid)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_req text[];
  v_type text;
  v_doc record;
  v_tous_conformes boolean := true;
  v_non_conforme boolean := false;
  v_en_verif boolean := false;
  v_admin text;
  v_tech text;
  m public.moto_motos;
begin
  select * into m from public.moto_motos where id = p_moto;
  select array(select jsonb_array_elements_text(valeur_json)) into v_req from public.moto_parametres where cle = 'documents_obligatoires';
  foreach v_type in array coalesce(v_req, array['CARTE_GRISE','PLAQUE','ASSURANCE']) loop
    select * into v_doc from public.moto_documents
     where moto_id = p_moto and type_document = v_type and statut <> 'REMPLACE'
     order by depose_at desc limit 1;
    if not found then v_tous_conformes := false; continue; end if;
    if v_doc.statut = 'NON_CONFORME' or (v_doc.statut = 'CONFORME' and v_doc.date_expiration is not null and v_doc.date_expiration < current_date) then
      v_non_conforme := true; v_tous_conformes := false;
    elsif v_doc.statut = 'EN_VERIFICATION' then
      v_en_verif := true; v_tous_conformes := false;
    end if;
  end loop;
  -- Pas de conformité sans identifiants réels (aucun numéro fictif n'est accepté par défaut).
  if v_tous_conformes and (nullif(btrim(coalesce(m.numero_chassis, '')), '') is null
                           or nullif(btrim(coalesce(m.immatriculation, '')), '') is null) then
    v_tous_conformes := false; v_en_verif := true;
  end if;
  v_admin := case when v_non_conforme then 'NON_CONFORME' when v_tous_conformes then 'CONFORME'
                  when v_en_verif or exists (select 1 from public.moto_documents where moto_id = p_moto and type_document = any(v_req)) then 'EN_VERIFICATION'
                  else 'EN_ATTENTE' end;

  if exists (select 1 from public.moto_immobilisations where moto_id = p_moto and fin is null) then
    v_tech := case when exists (select 1 from public.moto_maintenances where moto_id = p_moto and statut = 'EN_COURS')
                   then 'EN_REPARATION' else 'IMMOBILISEE' end;
  elsif exists (select 1 from public.moto_controles c where c.moto_id = p_moto and c.type_controle = 'INSPECTION_INITIALE'
                  and c.resultat = 'APTE'
                  and c.date_controle = (select max(c2.date_controle) from public.moto_controles c2
                                         where c2.moto_id = p_moto and c2.type_controle = 'INSPECTION_INITIALE')) then
    v_tech := 'APTE';
  else
    v_tech := 'A_CONTROLER';
  end if;

  update public.moto_motos set statut_administratif = v_admin, statut_technique = v_tech, updated_at = now()
  where id = p_moto and (statut_administratif is distinct from v_admin or statut_technique is distinct from v_tech);
end $$;

create or replace function private.moto_ouvrir_immobilisation(p_moto uuid, p_motif text, p_source text, p_source_id uuid)
returns uuid language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid;
begin
  insert into public.moto_immobilisations (moto_id, motif, source_type, source_id)
  values (p_moto, p_motif, p_source, p_source_id) returning id into v_id;
  perform private.moto_recalculer_statuts(p_moto);
  return v_id;
end $$;

-- Items de contrôle : [{code, libelle, ok, critique}] ; l'anomalie critique est
-- calculée par le serveur, jamais acceptée telle quelle du client.
create or replace function private.moto_items_valides(p_items jsonb)
returns boolean language plpgsql immutable as $$
declare it jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Liste de points de contrôle vide ou invalide.' using errcode = 'P0001';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it -> 'ok') <> 'boolean' or nullif(it ->> 'code', '') is null then
      raise exception 'Point de contrôle invalide : chaque point exige un code et un résultat oui/non.' using errcode = 'P0001';
    end if;
  end loop;
  return exists (select 1 from jsonb_array_elements(p_items) e
                 where coalesce((e ->> 'critique')::boolean, false) and not (e ->> 'ok')::boolean);
end $$;

-- ---------------------------------------------------------------------
-- 1. Inventaire et passeport
-- ---------------------------------------------------------------------
create or replace function public.moto_creer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_cluster text; v_zone text; m public.moto_motos;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  if nullif(btrim(p ->> 'marque'), '') is null or nullif(btrim(p ->> 'modele'), '') is null then
    perform private.moto_erreur('Marque et modèle obligatoires.');
  end if;
  v_cluster := public.aflp_cluster_code(p ->> 'cluster_code');
  if nullif(p ->> 'cluster_code', '') is not null and v_cluster is null then
    perform private.moto_erreur('Cluster inconnu du référentiel AFLP.');
  end if;
  select zone_code into v_zone from public.aflp_clusters where code = v_cluster;
  perform private.moto_motif(coalesce(p ->> 'motif', 'Création au passeport numérique'));
  insert into public.moto_motos (marque, modele, annee, couleur, numero_chassis, numero_moteur, immatriculation,
                                 fournisseur, date_reception, cluster_code, zone_code, observations)
  values (btrim(p ->> 'marque'), btrim(p ->> 'modele'), private.moto_num(p, 'annee')::integer,
          nullif(btrim(p ->> 'couleur'), ''), nullif(upper(btrim(p ->> 'numero_chassis')), ''),
          nullif(upper(btrim(p ->> 'numero_moteur')), ''), nullif(upper(btrim(p ->> 'immatriculation')), ''),
          nullif(btrim(p ->> 'fournisseur'), ''), nullif(p ->> 'date_reception', '')::date, v_cluster, v_zone,
          nullif(btrim(p ->> 'observations'), ''))
  returning * into m;
  if private.moto_num(p, 'compteur_km') is not null then
    perform private.moto_enregistrer_km(m.id, private.moto_num(p, 'compteur_km'), now(), 'RELEVE');
  end if;
  perform private.moto_recalculer_statuts(m.id);
  return jsonb_build_object('id', m.id, 'code', m.code, 'qr_token', m.qr_token);
end $$;

create or replace function public.moto_modifier_identite(p_moto uuid, p jsonb, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text; m public.moto_motos; v_cluster text;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM']);
  perform private.moto_motif(p_motif, 5);
  m := private.moto_charger(p_moto, true);
  if p ? 'row_version' and private.moto_num(p, 'row_version') <> m.row_version then
    perform private.moto_erreur('CONFLIT : la fiche a été modifiée par un autre utilisateur. Rechargez-la.');
  end if;
  if m.mise_en_service_at is not null and v_classe <> 'BM'
     and ((p ? 'numero_chassis' and nullif(upper(btrim(p ->> 'numero_chassis')), '') is distinct from m.numero_chassis)
       or (p ? 'immatriculation' and nullif(upper(btrim(p ->> 'immatriculation')), '') is distinct from m.immatriculation)) then
    perform private.moto_refus('Moto en service : seul le Branch Manager peut modifier châssis ou immatriculation.');
  end if;
  if p ? 'cluster_code' then
    v_cluster := public.aflp_cluster_code(p ->> 'cluster_code');
    if v_cluster is null and nullif(p ->> 'cluster_code', '') is not null then perform private.moto_erreur('Cluster inconnu du référentiel AFLP.'); end if;
    if m.statut_affectation <> 'NON_AFFECTEE' and v_cluster is distinct from m.cluster_code then
      perform private.moto_erreur('Le cluster d''une moto affectée change uniquement par transfert.');
    end if;
  end if;
  update public.moto_motos set
    marque = case when p ? 'marque' then coalesce(nullif(btrim(p ->> 'marque'), ''), marque) else marque end,
    modele = case when p ? 'modele' then coalesce(nullif(btrim(p ->> 'modele'), ''), modele) else modele end,
    annee = case when p ? 'annee' then private.moto_num(p, 'annee')::integer else annee end,
    couleur = case when p ? 'couleur' then nullif(btrim(p ->> 'couleur'), '') else couleur end,
    numero_chassis = case when p ? 'numero_chassis' then nullif(upper(btrim(p ->> 'numero_chassis')), '') else numero_chassis end,
    numero_moteur = case when p ? 'numero_moteur' then nullif(upper(btrim(p ->> 'numero_moteur')), '') else numero_moteur end,
    immatriculation = case when p ? 'immatriculation' then nullif(upper(btrim(p ->> 'immatriculation')), '') else immatriculation end,
    fournisseur = case when p ? 'fournisseur' then nullif(btrim(p ->> 'fournisseur'), '') else fournisseur end,
    date_reception = case when p ? 'date_reception' then nullif(p ->> 'date_reception', '')::date else date_reception end,
    observations = case when p ? 'observations' then nullif(btrim(p ->> 'observations'), '') else observations end,
    cluster_code = case when p ? 'cluster_code' then v_cluster else cluster_code end,
    zone_code = case when p ? 'cluster_code' then (select zone_code from public.aflp_clusters where code = v_cluster) else zone_code end,
    row_version = row_version + 1, updated_at = now()
  where id = p_moto returning * into m;
  perform private.moto_recalculer_statuts(p_moto);
  return jsonb_build_object('id', m.id, 'row_version', m.row_version);
end $$;

-- ---------------------------------------------------------------------
-- 2. Documents
-- ---------------------------------------------------------------------
create or replace function public.moto_document_enregistrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_type text := upper(coalesce(p ->> 'type_document', ''));
        v_path text := nullif(btrim(p ->> 'storage_path'), ''); v_id uuid; m public.moto_motos;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE']);
  m := private.moto_charger(v_moto);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if v_classe = 'ZONE' and v_type not in ('RAPPORT_MECANICIEN','PHOTO','FACTURE') then
    perform private.moto_refus('Le Chef de Zone dépose rapports mécaniciens, photos et factures uniquement.');
  end if;
  if v_classe = 'UNITE' and v_type not in ('PHOTO','JUSTIFICATIF') then
    perform private.moto_refus('Le Chef d''unité dépose photos et justificatifs uniquement.');
  end if;
  if v_type in ('CARTE_GRISE','ASSURANCE','PV_REMISE','RAPPORT_MECANICIEN','PERMIS','FACTURE') and v_path is null then
    perform private.moto_erreur('Ce document exige le fichier numérisé.');
  end if;
  perform private.moto_stockage_valide(v_moto, v_path, array['document','controle','incident','maintenance','photo','justificatif']);
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_documents (moto_id, affectation_id, type_document, numero_reference, date_emission, date_expiration,
                                     storage_path, nom_fichier)
  values (v_moto, private.moto_uuid(p, 'affectation_id'), v_type, nullif(btrim(p ->> 'numero_reference'), ''),
          nullif(p ->> 'date_emission', '')::date, nullif(p ->> 'date_expiration', '')::date, v_path,
          nullif(btrim(p ->> 'nom_fichier'), ''))
  returning id into v_id;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'statut', 'EN_VERIFICATION');
end $$;

create or replace function public.moto_document_verifier(p_document uuid, p_statut text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare d public.moto_documents;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  select * into d from public.moto_documents where id = p_document for update;
  if not found then perform private.moto_erreur('Document introuvable.'); end if;
  if d.statut <> 'EN_VERIFICATION' then perform private.moto_erreur('Ce document a déjà été vérifié.'); end if;
  if d.depose_par = auth.uid() then perform private.moto_refus('Auto-validation interdite : un autre responsable doit vérifier ce document.'); end if;
  if upper(p_statut) not in ('CONFORME','NON_CONFORME') then perform private.moto_erreur('Statut de vérification inconnu.'); end if;
  perform private.moto_motif(p_motif, case when upper(p_statut) = 'NON_CONFORME' then 5 else 0 end);
  if upper(p_statut) = 'CONFORME' and d.date_expiration is not null and d.date_expiration < current_date then
    perform private.moto_erreur('Document expiré : il ne peut pas être déclaré conforme.');
  end if;
  update public.moto_documents set statut = upper(p_statut), verifie_par = auth.uid(), verifie_at = now(),
         motif_verification = nullif(btrim(p_motif), '')
  where id = p_document;
  if upper(p_statut) = 'CONFORME' and d.type_document in ('CARTE_GRISE','PLAQUE','ASSURANCE') then
    update public.moto_documents set statut = 'REMPLACE'
    where moto_id = d.moto_id and type_document = d.type_document and id <> d.id and statut in ('CONFORME','EN_VERIFICATION','NON_CONFORME');
  end if;
  perform private.moto_recalculer_statuts(d.moto_id);
  return jsonb_build_object('id', p_document, 'statut', upper(p_statut));
end $$;

-- ---------------------------------------------------------------------
-- 3. Contrôle initial, affectations, remise, mise en service
-- ---------------------------------------------------------------------
create or replace function public.moto_inspection_initiale(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_crit boolean; v_res text; v_id uuid; v_rapport uuid := private.moto_uuid(p, 'rapport_document_id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null or nullif(btrim(p ->> 'garage_nom'), '') is null then
    perform private.moto_erreur('Nom du mécanicien et du garage obligatoires.');
  end if;
  if v_rapport is not null and not exists (select 1 from public.moto_documents where id = v_rapport and moto_id = v_moto and type_document = 'RAPPORT_MECANICIEN') then
    perform private.moto_erreur('Le rapport doit être un document RAPPORT_MECANICIEN de cette moto.');
  end if;
  v_crit := private.moto_items_valides(p -> 'items');
  v_res := case when v_crit then 'INAPTE' when upper(coalesce(p ->> 'resultat', 'INAPTE')) = 'APTE' then 'APTE' else 'INAPTE' end;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat,
                                     intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id)
  values (v_moto, 'INSPECTION_INITIALE', private.moto_num(p, 'compteur_km'), p -> 'items', v_crit, v_res,
          btrim(p ->> 'intervenant_nom'), btrim(p ->> 'garage_nom'), nullif(btrim(p ->> 'avis_mecanicien'), ''), v_rapport)
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'CONTROLE');
  if v_crit then
    perform private.moto_ouvrir_immobilisation(v_moto, 'Anomalie critique à l''inspection initiale', 'CONTROLE', v_id);
  end if;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit);
end $$;

create or replace function public.moto_preaffecter(p_moto uuid, p_beneficiaire uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare b public.profils; v_cluster text; v_id uuid; m public.moto_motos;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 5);
  m := private.moto_charger(p_moto, true);
  select * into b from public.profils where user_id = p_beneficiaire and actif;
  if not found then perform private.moto_erreur('Bénéficiaire introuvable ou compte inactif.'); end if;
  if b.role not in ('Unit Head','Zonal Head') then perform private.moto_erreur('Le bénéficiaire doit être un Chef d''unité ou un Chef de zone.'); end if;
  v_cluster := public.aflp_cluster_code(b.cluster);
  if v_cluster is null then perform private.moto_erreur('Le cluster du bénéficiaire n''est pas renseigné dans son profil FBMS.'); end if;
  if exists (select 1 from public.moto_affectations where moto_id = p_moto and statut = 'ACTIVE') then
    perform private.moto_erreur('Cette moto a déjà une affectation active : utilisez le transfert.');
  end if;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, motif)
  values (p_moto, p_beneficiaire, v_cluster, 'PREAFFECTATION', btrim(p_motif)) returning id into v_id;
  update public.moto_motos set statut_affectation = 'PREAFFECTEE', cluster_code = v_cluster,
         zone_code = (select zone_code from public.aflp_clusters where code = v_cluster), updated_at = now()
  where id = p_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'PREAFFECTEE');
end $$;

create or replace function private.moto_controle_remise(p_moto uuid, p jsonb)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_pv uuid := private.moto_uuid(p, 'pv_document_id'); v_req text; v_eq jsonb := coalesce(p -> 'equipements', '{}'::jsonb);
begin
  if not exists (select 1 from public.moto_documents where id = v_pv and moto_id = p_moto and type_document = 'PV_REMISE' and statut = 'CONFORME') then
    perform private.moto_erreur('Procès-verbal signé, numérisé et vérifié CONFORME obligatoire.');
  end if;
  if coalesce((p ->> 'permis_verifie')::boolean, false) is not true or nullif(btrim(p ->> 'permis_categorie'), '') is null
     or nullif(btrim(p ->> 'permis_verifie_par_nom'), '') is null then
    perform private.moto_erreur('Vérification RH du permis adapté obligatoire (catégorie et vérificateur).');
  end if;
  for v_req in select jsonb_array_elements_text(valeur_json) from public.moto_parametres where cle = 'equipements_obligatoires' loop
    if coalesce((v_eq ->> v_req)::boolean, false) is not true then
      perform private.moto_erreur(format('Équipement de sécurité manquant : %s.', v_req));
    end if;
  end loop;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur à la remise obligatoire.'); end if;
end $$;

create or replace function public.moto_remettre(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); m public.moto_motos; a public.moto_affectations; v_id uuid;
begin
  perform private.moto_exiger_classe(array['ABM','BM']);
  perform private.moto_recalculer_statuts(v_moto);
  m := private.moto_charger(v_moto, true);
  select * into a from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation = 'PREAFFECTATION';
  if not found then perform private.moto_erreur('Aucune préaffectation active : le Branch Manager doit d''abord préaffecter la moto.'); end if;
  if m.statut_administratif <> 'CONFORME' then perform private.moto_erreur('Remise bloquée : documents administratifs non conformes ('||m.statut_administratif||').'); end if;
  if m.statut_technique <> 'APTE' then perform private.moto_erreur('Remise bloquée : état technique '||m.statut_technique||'.'); end if;
  perform private.moto_controle_remise(v_moto, p);
  perform private.moto_motif(coalesce(p ->> 'motif', 'Remise officielle au bureau de Bouaké'));
  update public.moto_affectations set statut = 'CLOTUREE', date_fin = current_date, cloture_par = auth.uid(), cloture_at = now() where id = a.id;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, compteur_km, pv_document_id,
         permis_verifie, permis_categorie, permis_verifie_par_nom, permis_verifie_at, equipements, motif)
  values (v_moto, a.beneficiaire_id, a.cluster_code, 'REMISE', private.moto_num(p, 'compteur_km'), private.moto_uuid(p, 'pv_document_id'),
          true, btrim(p ->> 'permis_categorie'), btrim(p ->> 'permis_verifie_par_nom'),
          coalesce(nullif(p ->> 'permis_verifie_at', '')::date, current_date), p -> 'equipements', nullif(btrim(p ->> 'motif'), ''))
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'REMISE');
  update public.moto_documents set affectation_id = v_id where id = private.moto_uuid(p, 'pv_document_id');
  update public.moto_motos set statut_affectation = 'REMISE', updated_at = now() where id = v_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'REMISE',
    'note', 'Remise enregistrée. L''autorisation de circulation (mise en service) reste une décision distincte du Branch Manager.');
end $$;

create or replace function public.moto_mettre_en_service(p_moto uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare m public.moto_motos; a public.moto_affectations;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 5);
  perform private.moto_recalculer_statuts(p_moto);
  m := private.moto_charger(p_moto, true);
  if m.mise_en_service_at is not null then perform private.moto_erreur('Moto déjà en service.'); end if;
  select * into a from public.moto_affectations where moto_id = p_moto and statut = 'ACTIVE' and type_affectation in ('REMISE','TRANSFERT');
  if not found then perform private.moto_erreur('Mise en service impossible : aucune remise enregistrée.'); end if;
  if a.cree_par = auth.uid() then perform private.moto_refus('Séparation des tâches : la personne qui a enregistré la remise ne peut pas autoriser la circulation.'); end if;
  if m.statut_administratif <> 'CONFORME' then perform private.moto_erreur('Mise en service bloquée : documents '||m.statut_administratif||'.'); end if;
  if m.statut_technique <> 'APTE' then perform private.moto_erreur('Mise en service bloquée : état technique '||m.statut_technique||'.'); end if;
  update public.moto_motos set mise_en_service_at = now(), mise_en_service_par = auth.uid(), mise_en_service_motif = btrim(p_motif), updated_at = now()
  where id = p_moto;
  return jsonb_build_object('id', p_moto, 'mise_en_service', true);
end $$;

create or replace function public.moto_transferer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_benef uuid := private.moto_uuid(p, 'beneficiaire_id');
        b public.profils; v_cluster text; a public.moto_affectations; v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p ->> 'motif', 5);
  perform private.moto_charger(v_moto, true);
  select * into a from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation in ('REMISE','TRANSFERT');
  if not found then perform private.moto_erreur('Transfert impossible : la moto n''a pas été remise.'); end if;
  select * into b from public.profils where user_id = v_benef and actif and role in ('Unit Head','Zonal Head');
  if not found then perform private.moto_erreur('Nouveau bénéficiaire invalide (Chef d''unité ou Chef de zone actif).'); end if;
  if v_benef = a.beneficiaire_id then perform private.moto_erreur('Le nouveau bénéficiaire est déjà affectataire.'); end if;
  v_cluster := public.aflp_cluster_code(b.cluster);
  if v_cluster is null then perform private.moto_erreur('Cluster du nouveau bénéficiaire non renseigné.'); end if;
  perform private.moto_controle_remise(v_moto, p);
  update public.moto_affectations set statut = 'CLOTUREE', date_fin = current_date, cloture_par = auth.uid(), cloture_at = now() where id = a.id;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, compteur_km, pv_document_id,
         permis_verifie, permis_categorie, permis_verifie_par_nom, permis_verifie_at, equipements, motif)
  values (v_moto, v_benef, v_cluster, 'TRANSFERT', private.moto_num(p, 'compteur_km'), private.moto_uuid(p, 'pv_document_id'),
          true, btrim(p ->> 'permis_categorie'), btrim(p ->> 'permis_verifie_par_nom'),
          coalesce(nullif(p ->> 'permis_verifie_at', '')::date, current_date), p -> 'equipements', btrim(p ->> 'motif'))
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'REMISE');
  update public.moto_motos set statut_affectation = 'TRANSFEREE', cluster_code = v_cluster,
         zone_code = (select zone_code from public.aflp_clusters where code = v_cluster), updated_at = now()
  where id = v_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'TRANSFEREE');
end $$;

create or replace function public.moto_retirer(p_moto uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 10);
  perform private.moto_charger(p_moto, true);
  update public.moto_affectations set statut = case when type_affectation = 'PREAFFECTATION' then 'ANNULEE' else 'CLOTUREE' end,
         date_fin = current_date, cloture_par = auth.uid(), cloture_at = now()
  where moto_id = p_moto and statut = 'ACTIVE';
  update public.moto_motos set statut_affectation = 'NON_AFFECTEE', mise_en_service_at = null, mise_en_service_par = null,
         mise_en_service_motif = null, updated_at = now() where id = p_moto;
  return jsonb_build_object('id', p_moto, 'statut_affectation', 'NON_AFFECTEE');
end $$;

-- ---------------------------------------------------------------------
-- 4. Opérations terrain (idempotentes, synchronisables hors connexion)
-- ---------------------------------------------------------------------
create or replace function private.moto_exiger_terrain(p_moto uuid)
returns text language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text := private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE']); m public.moto_motos;
begin
  m := private.moto_charger(p_moto);
  if not private.moto_peut_operer(p_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if v_classe = 'UNITE' and m.mise_en_service_at is null then
    perform private.moto_erreur('Moto non mise en service : saisie terrain impossible.');
  end if;
  return v_classe;
end $$;

create or replace function public.moto_releve_km(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_at timestamptz := coalesce(nullif(p ->> 'date_releve', '')::timestamptz, now()); v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_terrain(v_moto);
  if v_at > now() + interval '15 minutes' then perform private.moto_erreur('Date de relevé dans le futur.'); end if;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Compteur obligatoire.'); end if;
  perform private.moto_charger(v_moto, true);
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), v_at, 'RELEVE', v_client);
  v_res := jsonb_build_object('moto_id', v_moto, 'compteur_km', private.moto_num(p, 'compteur_km'));
  perform private.moto_op_enregistrer(v_client, 'RELEVE_KM', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_incident_declarer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_type text := upper(coalesce(p ->> 'type_incident', '')); v_grav text := upper(coalesce(p ->> 'gravite', ''));
        v_id uuid; v_immo boolean; v_aflp text; v_note text; m public.moto_motos; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE']);
  m := private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if v_type not in ('PANNE','ACCIDENT','CREVAISON','ANOMALIE') then perform private.moto_erreur('Type d''incident inconnu.'); end if;
  if v_grav not in ('MINEURE','MAJEURE','CRITIQUE') then perform private.moto_erreur('Gravité inconnue.'); end if;
  if length(btrim(coalesce(p ->> 'description', ''))) < 10 then perform private.moto_erreur('Description trop courte (10 caractères minimum).'); end if;
  -- Règle de sécurité : incident critique ou accident = immobilisation immédiate.
  v_immo := v_grav = 'CRITIQUE' or v_type = 'ACCIDENT' or coalesce((p ->> 'immobiliser')::boolean, false);
  perform private.moto_motif('Déclaration d''incident');
  insert into public.moto_incidents (moto_id, type_incident, gravite, etape, description, lieu, compteur_km, survenu_at,
                                     arret_confirme, client_op_id)
  values (v_moto, v_type, v_grav, case when v_immo then 'IMMOBILISEE' else 'SIGNALE' end, btrim(p ->> 'description'),
          nullif(btrim(p ->> 'lieu'), ''), private.moto_num(p, 'compteur_km'),
          coalesce(nullif(p ->> 'survenu_at', '')::timestamptz, now()), coalesce((p ->> 'arret_confirme')::boolean, false), v_client)
  returning id into v_id;
  insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'SIGNALE', 'Déclaration');
  if v_immo then
    perform private.moto_ouvrir_immobilisation(v_moto, 'Incident '||v_type||' '||v_grav, 'INCIDENT', v_id);
    insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'IMMOBILISEE', 'Immobilisation de sécurité automatique');
  end if;
  -- Registre AFLP existant : un accident moto y est aussi inscrit (pas de double saisie).
  if v_type = 'ACCIDENT' and to_regprocedure('public.aflp_declare_incident(jsonb)') is not null then
    begin
      select public.aflp_declare_incident(jsonb_build_object(
        'incident_type', 'ACCIDENT_MOTO', 'risk_category', 'SECURITE', 'cluster', m.cluster_code,
        'severity', case v_grav when 'MINEURE' then 'FAIBLE' when 'MAJEURE' then 'ELEVEE' else 'CRITIQUE' end,
        'description', 'Moto '||m.code||' : '||btrim(p ->> 'description'),
        'immediate_action', case when v_immo then 'Moto immobilisée (Moto Manager)' else null end,
        'evidence_ref', 'moto_incidents:'||v_id)) ->> 'id' into v_aflp;
      update public.moto_incidents set aflp_incident_id = v_aflp where id = v_id;
    exception when others then
      v_note := 'Inscription au registre AFLP non effectuée : '||sqlerrm;
      insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'SIGNALE', v_note);
    end;
  end if;
  begin
    perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'),
                                        coalesce(nullif(p ->> 'survenu_at', '')::timestamptz, now()), 'INCIDENT');
  exception when sqlstate 'P0001' then
    insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'SIGNALE', 'Compteur non retenu : '||sqlerrm);
  end;
  v_res := jsonb_build_object('id', v_id, 'immobilisee', v_immo, 'aflp_incident_id', v_aflp);
  perform private.moto_op_enregistrer(v_client, 'INCIDENT', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_controle_depart(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_crit boolean; v_res text; v_id uuid; v_inc jsonb; v_out jsonb; m public.moto_motos;
        v_at timestamptz := coalesce(nullif(p ->> 'date_controle', '')::timestamptz, now());
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_terrain(v_moto);
  m := private.moto_charger(v_moto, true);
  v_crit := private.moto_items_valides(p -> 'items');
  v_res := case when v_crit then 'INAPTE' when exists (select 1 from jsonb_array_elements(p -> 'items') e where not (e ->> 'ok')::boolean) then 'INAPTE' else 'APTE' end;
  insert into public.moto_controles (moto_id, type_controle, date_controle, compteur_km, items, anomalie_critique, resultat, client_op_id)
  values (v_moto, 'AVANT_DEPART', v_at, private.moto_num(p, 'compteur_km'), p -> 'items', v_crit, v_res, v_client)
  returning id into v_id;
  begin
    perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), v_at, 'CONTROLE');
  exception when sqlstate 'P0001' then null; -- un compteur douteux n'empêche jamais d'enregistrer une anomalie
  end;
  if v_crit then
    v_inc := public.moto_incident_declarer(jsonb_build_object('moto_id', v_moto, 'type_incident', 'ANOMALIE', 'gravite', 'CRITIQUE',
             'description', 'Anomalie critique au contrôle avant départ : '||coalesce((select string_agg(coalesce(e ->> 'libelle', e ->> 'code'), ', ')
               from jsonb_array_elements(p -> 'items') e where coalesce((e ->> 'critique')::boolean, false) and not (e ->> 'ok')::boolean), ''),
             'arret_confirme', true, 'survenu_at', v_at));
  end if;
  v_out := jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit, 'incident', v_inc);
  perform private.moto_op_enregistrer(v_client, 'CONTROLE_DEPART', 'SYNCHRONISE', v_out);
  return v_out;
end $$;

create or replace function public.moto_carburant_declarer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_classe text; v_agent uuid; v_at timestamptz; v_id uuid; v_path text := nullif(btrim(p ->> 'justificatif_path'), ''); v_res jsonb;
        v_fin text := upper(coalesce(nullif(p ->> 'financement', ''), 'DOTATION'));
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  v_classe := private.moto_exiger_terrain(v_moto);
  perform private.moto_charger(v_moto, true);
  v_at := nullif(p ->> 'date_achat', '')::timestamptz;
  if v_at is null then perform private.moto_erreur('Date d''achat obligatoire.'); end if;
  if v_at > now() + interval '15 minutes' then perform private.moto_erreur('Date d''achat dans le futur.'); end if;
  if v_at < now() - interval '45 days' then perform private.moto_erreur('Achat de plus de 45 jours : passez par une correction validée.'); end if;
  if p -> 'plein_complet' is null or jsonb_typeof(p -> 'plein_complet') <> 'boolean' then
    perform private.moto_erreur('Préciser plein complet ou partiel.');
  end if;
  if v_fin not in ('DOTATION','AVANCE_PERSONNELLE') then perform private.moto_erreur('Mode de financement inconnu.'); end if;
  v_agent := case when v_classe = 'UNITE' then auth.uid() else coalesce(private.moto_uuid(p, 'agent_id'), auth.uid()) end;
  if not exists (select 1 from public.profils where user_id = v_agent and actif) then perform private.moto_erreur('Agent inconnu ou inactif.'); end if;
  perform private.moto_stockage_valide(v_moto, v_path, array['justificatif']);
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), v_at, 'CARBURANT');
  insert into public.moto_carburant (moto_id, agent_id, date_achat, compteur_km, litres, montant, plein_complet, station,
                                     financement, justificatif_path, client_op_id)
  values (v_moto, v_agent, v_at, private.moto_num(p, 'compteur_km'), private.moto_num(p, 'litres'), private.moto_num(p, 'montant'),
          (p ->> 'plein_complet')::boolean, nullif(btrim(p ->> 'station'), ''), v_fin, v_path, v_client)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'justificatif_statut', 'A_VERIFIER',
           'note', 'Achat enregistré. Il ne vaut pas justificatif vérifié tant que l''ABM ou Finance ne l''a pas contrôlé.');
  perform private.moto_op_enregistrer(v_client, 'CARBURANT', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_justificatif_verifier(p_carburant uuid, p_statut text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare c public.moto_carburant;
begin
  perform private.moto_exiger_classe(array['BM','ABM','FINANCE']);
  select * into c from public.moto_carburant where id = p_carburant for update;
  if not found then perform private.moto_erreur('Achat de carburant introuvable.'); end if;
  if c.justificatif_statut <> 'A_VERIFIER' then perform private.moto_erreur('Justificatif déjà traité : passez par une correction.'); end if;
  if auth.uid() in (c.saisi_par, c.agent_id) then perform private.moto_refus('Auto-validation interdite : un autre responsable doit vérifier ce justificatif.'); end if;
  if upper(p_statut) not in ('VERIFIE','REJETE') then perform private.moto_erreur('Statut inconnu.'); end if;
  if upper(p_statut) = 'VERIFIE' and c.justificatif_path is null then perform private.moto_erreur('Aucun justificatif photographié : vérification impossible.'); end if;
  perform private.moto_motif(p_motif, case when upper(p_statut) = 'REJETE' then 5 else 0 end);
  update public.moto_carburant set justificatif_statut = upper(p_statut), justificatif_motif = nullif(btrim(p_motif), ''),
         verifie_par = auth.uid(), verifie_at = now() where id = p_carburant;
  return jsonb_build_object('id', p_carburant, 'justificatif_statut', upper(p_statut));
end $$;

-- ---------------------------------------------------------------------
-- 5. Budgets, dotations, restitutions, remboursements
-- ---------------------------------------------------------------------
create or replace function public.moto_budget_proposer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text; v_id uuid; v_benef uuid := private.moto_uuid(p, 'beneficiaire_id'); v_statut text;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM']);
  if not exists (select 1 from public.profils where user_id = v_benef and actif) then perform private.moto_erreur('Bénéficiaire introuvable ou inactif.'); end if;
  perform private.moto_motif(p ->> 'motif', 5);
  -- Le Branch Manager est l'autorité budgétaire : son budget est autorisé à la création.
  -- Une proposition de l'ABM attend la décision du Branch Manager.
  v_statut := case when v_classe = 'BM' then 'VALIDE' else 'PROPOSE' end;
  insert into public.moto_budgets (moto_id, beneficiaire_id, periode_debut, periode_fin, montant_autorise, statut, motif, valide_par, valide_at)
  values (private.moto_uuid(p, 'moto_id'), v_benef, (p ->> 'periode_debut')::date, (p ->> 'periode_fin')::date,
          private.moto_num(p, 'montant_autorise'), v_statut, btrim(p ->> 'motif'),
          case when v_statut = 'VALIDE' then auth.uid() end, case when v_statut = 'VALIDE' then now() end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', v_statut);
end $$;

create or replace function public.moto_budget_decider(p_budget uuid, p_decision text, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare b public.moto_budgets;
begin
  perform private.moto_exiger_classe(array['BM']);
  select * into b from public.moto_budgets where id = p_budget for update;
  if not found or b.statut <> 'PROPOSE' then perform private.moto_erreur('Budget introuvable ou déjà décidé.'); end if;
  if b.propose_par = auth.uid() then perform private.moto_refus('Auto-validation interdite.'); end if;
  if upper(p_decision) not in ('VALIDE','REJETE') then perform private.moto_erreur('Décision inconnue.'); end if;
  perform private.moto_motif(p_motif, case when upper(p_decision) = 'REJETE' then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_budgets set statut = upper(p_decision), valide_par = auth.uid(), valide_at = now() where id = p_budget;
  return jsonb_build_object('id', p_budget, 'statut', upper(p_decision));
end $$;

create or replace function public.moto_dotation_remettre(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare b public.moto_budgets; v_mode text := upper(coalesce(p ->> 'mode_paiement', '')); v_montant numeric := private.moto_num(p, 'montant_remis');
        v_deja numeric; v_id uuid; v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['ABM','BM']);
  select * into b from public.moto_budgets where id = private.moto_uuid(p, 'budget_id') for update;
  if not found or b.statut <> 'VALIDE' then perform private.moto_erreur('Dotation impossible : aucun budget autorisé.'); end if;
  if current_date not between b.periode_debut and b.periode_fin then perform private.moto_erreur('Budget hors période de validité.'); end if;
  if v_mode not in ('ESPECES','MOBILE_MONEY') then perform private.moto_erreur('Mode de paiement : espèces ou Mobile Money.'); end if;
  if v_montant is null or v_montant <= 0 then perform private.moto_erreur('Montant remis invalide.'); end if;
  if v_mode = 'MOBILE_MONEY' and nullif(btrim(p ->> 'reference'), '') is null then perform private.moto_erreur('Référence de transaction Mobile Money obligatoire.'); end if;
  select coalesce(sum(montant_remis), 0) into v_deja from public.moto_dotations where budget_id = b.id and statut not in ('ECHOUEE','ANNULEE');
  if v_deja + v_montant > b.montant_autorise then
    perform private.moto_erreur(format('Dépassement du budget autorisé : %s déjà remis sur %s FCFA.', v_deja, b.montant_autorise));
  end if;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_dotations (budget_id, moto_id, beneficiaire_id, mode_paiement, operateur_mobile_money, montant_remis,
                                     frais_transaction, reference, client_op_id)
  values (b.id, b.moto_id, b.beneficiaire_id, v_mode, nullif(btrim(p ->> 'operateur_mobile_money'), ''), v_montant,
          case when v_mode = 'MOBILE_MONEY' then coalesce(private.moto_num(p, 'frais_transaction'), 0) else 0 end,
          nullif(btrim(p ->> 'reference'), ''), v_client)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'statut', 'REMISE_DECLAREE', 'note', 'En attente de confirmation de réception par le bénéficiaire.');
  perform private.moto_op_enregistrer(v_client, 'DOTATION_REMETTRE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_dotation_confirmer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare d public.moto_dotations; v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_recu numeric; v_statut text; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  if private.moto_classe() is null then perform private.moto_refus('Accès Moto Manager refusé.'); end if;
  select * into d from public.moto_dotations where id = private.moto_uuid(p, 'dotation_id') for update;
  if not found then perform private.moto_erreur('Dotation introuvable.'); end if;
  if d.beneficiaire_id <> auth.uid() then perform private.moto_refus('Seul le bénéficiaire confirme la réception de sa dotation.'); end if;
  if d.statut <> 'REMISE_DECLAREE' then perform private.moto_erreur('Cette dotation n''est plus en attente de confirmation ('||d.statut||').'); end if;
  if coalesce((p ->> 'non_recu')::boolean, false) then v_recu := 0; else v_recu := private.moto_num(p, 'montant_recu'); end if;
  if v_recu is null or v_recu < 0 then perform private.moto_erreur('Montant reçu obligatoire.'); end if;
  if v_recu > d.montant_remis then perform private.moto_erreur('Le montant reçu ne peut pas dépasser le montant remis.'); end if;
  v_statut := case when v_recu = d.montant_remis then 'CONFIRMEE' else 'CONTESTEE' end;
  perform private.moto_motif(coalesce(p ->> 'motif', 'Confirmation de réception'), case when v_statut = 'CONTESTEE' then 5 else 0 end);
  update public.moto_dotations set statut = v_statut, montant_recu = v_recu, confirme_par = auth.uid(), confirme_at = now(),
         motif = coalesce(nullif(btrim(p ->> 'motif'), ''), motif)
  where id = d.id;
  v_res := jsonb_build_object('id', d.id, 'statut', v_statut, 'montant_recu', v_recu);
  perform private.moto_op_enregistrer(v_client, 'DOTATION_CONFIRMER', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_dotation_signaler_echec(p_dotation uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare d public.moto_dotations;
begin
  perform private.moto_exiger_classe(array['ABM','BM']);
  perform private.moto_motif(p_motif, 5);
  select * into d from public.moto_dotations where id = p_dotation for update;
  if not found then perform private.moto_erreur('Dotation introuvable.'); end if;
  if d.statut not in ('REMISE_DECLAREE','CONTESTEE') then perform private.moto_erreur('Seule une dotation non confirmée peut être déclarée échouée.'); end if;
  update public.moto_dotations set statut = 'ECHOUEE', motif = btrim(p_motif) where id = p_dotation;
  return jsonb_build_object('id', p_dotation, 'statut', 'ECHOUEE');
end $$;

create or replace function private.moto_solde_a_apurer(p_benef uuid)
returns numeric language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select sum(montant_recu) from public.moto_dotations where beneficiaire_id = p_benef and statut in ('CONFIRMEE','CONTESTEE')), 0)
       - coalesce((select sum(montant) from public.moto_carburant where agent_id = p_benef and financement = 'DOTATION' and justificatif_statut = 'VERIFIE'), 0)
       - coalesce((select sum(montant) from public.moto_restitutions where beneficiaire_id = p_benef), 0)
$$;

create or replace function public.moto_restitution_enregistrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_benef uuid := private.moto_uuid(p, 'beneficiaire_id'); v_montant numeric := private.moto_num(p, 'montant'); v_id uuid; v_solde numeric;
begin
  perform private.moto_exiger_classe(array['ABM','BM']);
  if v_benef = auth.uid() then perform private.moto_refus('Une restitution est enregistrée par la personne qui reçoit les fonds, pas par le bénéficiaire.'); end if;
  v_solde := private.moto_solde_a_apurer(v_benef);
  if v_montant is null or v_montant <= 0 then perform private.moto_erreur('Montant invalide.'); end if;
  if v_montant > v_solde then perform private.moto_erreur(format('Restitution supérieure à l''avance à apurer (%s FCFA).', v_solde)); end if;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_restitutions (beneficiaire_id, moto_id, montant, mode_paiement, reference, motif)
  values (v_benef, private.moto_uuid(p, 'moto_id'), v_montant, upper(coalesce(p ->> 'mode_paiement', 'ESPECES')),
          nullif(btrim(p ->> 'reference'), ''), nullif(btrim(p ->> 'motif'), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'solde_restant', v_solde - v_montant);
end $$;

create or replace function public.moto_remboursement_demander(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_benef uuid := private.moto_uuid(p, 'beneficiaire_id'); v_ids uuid[]; v_total numeric; v_n integer; v_id uuid;
begin
  perform private.moto_exiger_classe(array['ABM','BM']);
  select array_agg(private.moto_uuid_ou_null(x)) into v_ids from jsonb_array_elements_text(p -> 'carburant_ids') x;
  if v_ids is null or array_length(v_ids, 1) = 0 then perform private.moto_erreur('Aucun achat sélectionné.'); end if;
  perform 1 from public.moto_carburant where id = any(v_ids) for update;
  select count(*), coalesce(sum(montant), 0) into v_n, v_total from public.moto_carburant
   where id = any(v_ids) and agent_id = v_benef and financement = 'AVANCE_PERSONNELLE'
     and justificatif_statut = 'VERIFIE' and remboursement_id is null;
  if v_n <> array_length(v_ids, 1) then
    perform private.moto_erreur('Chaque achat doit être une avance personnelle de ce bénéficiaire, justifiée VÉRIFIÉE et non encore remboursée.');
  end if;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_remboursements (beneficiaire_id, carburant_ids, montant, motif)
  values (v_benef, v_ids, v_total, nullif(btrim(p ->> 'motif'), '')) returning id into v_id;
  update public.moto_carburant set remboursement_id = v_id where id = any(v_ids);
  return jsonb_build_object('id', v_id, 'montant', v_total, 'statut', 'DEMANDE');
end $$;

create or replace function public.moto_remboursement_decider(p_remboursement uuid, p_decision text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_remboursements; v_classe text;
begin
  v_classe := private.moto_exiger_classe(array['BM','FINANCE']);
  if v_classe = 'FINANCE' and not private.moto_est_finance_manager() then perform private.moto_refus('Validation réservée au Branch Manager ou au Finance Manager.'); end if;
  select * into r from public.moto_remboursements where id = p_remboursement for update;
  if not found or r.statut <> 'DEMANDE' then perform private.moto_erreur('Remboursement introuvable ou déjà décidé.'); end if;
  if r.demande_par = auth.uid() then perform private.moto_refus('Auto-validation interdite.'); end if;
  if upper(p_decision) not in ('VALIDE','REJETE') then perform private.moto_erreur('Décision inconnue.'); end if;
  perform private.moto_motif(p_motif, case when upper(p_decision) = 'REJETE' then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_remboursements set statut = upper(p_decision), valide_par = auth.uid(), valide_at = now(), motif = coalesce(nullif(btrim(p_motif), ''), motif)
  where id = p_remboursement;
  if upper(p_decision) = 'REJETE' then
    update public.moto_carburant set remboursement_id = null where remboursement_id = p_remboursement;
  end if;
  return jsonb_build_object('id', p_remboursement, 'statut', upper(p_decision));
end $$;

create or replace function public.moto_remboursement_declarer_paye(p_remboursement uuid, p_mode text, p_reference text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_remboursements;
begin
  perform private.moto_exiger_classe(array['FINANCE','ABM','BM']);
  select * into r from public.moto_remboursements where id = p_remboursement for update;
  if not found or r.statut <> 'VALIDE' then perform private.moto_erreur('Seul un remboursement validé peut être déclaré payé.'); end if;
  if upper(p_mode) not in ('ESPECES','MOBILE_MONEY') then perform private.moto_erreur('Mode de paiement inconnu.'); end if;
  if upper(p_mode) = 'MOBILE_MONEY' and nullif(btrim(p_reference), '') is null then perform private.moto_erreur('Référence Mobile Money obligatoire.'); end if;
  perform private.moto_motif('Paiement déclaré (exécuté hors Moto Manager)');
  update public.moto_remboursements set statut = 'PAYE_DECLARE', mode_paiement = upper(p_mode), reference = nullif(btrim(p_reference), ''),
         paye_declare_par = auth.uid(), paye_declare_at = now() where id = p_remboursement;
  return jsonb_build_object('id', p_remboursement, 'statut', 'PAYE_DECLARE');
end $$;

-- ---------------------------------------------------------------------
-- 6. Corrections sensibles (quatre yeux)
-- ---------------------------------------------------------------------
create or replace function private.moto_champ_corrigeable(p_table text, p_champ text, p_classe text)
returns text language sql immutable as $$
  select case
    when p_table = 'moto_carburant' and p_champ in ('litres','montant','compteur_km') then 'numeric'
    when p_table = 'moto_carburant' and p_champ = 'plein_complet' then 'boolean'
    when p_table = 'moto_carburant' and p_champ = 'date_achat' then 'timestamptz'
    when p_table = 'moto_releves_km' and p_champ = 'compteur_km' then 'numeric'
    when p_table = 'moto_dotations' and p_champ in ('montant_remis','frais_transaction') and p_classe in ('BM','ABM') then 'numeric'
    when p_table = 'moto_dotations' and p_champ = 'reference' and p_classe in ('BM','ABM') then 'text'
    else null end
$$;

create or replace function public.moto_correction_demander(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text; v_table text := p ->> 'cible_table'; v_champ text := p ->> 'champ'; v_cible uuid := private.moto_uuid(p, 'cible_id');
        v_type text; v_old text; v_moto uuid; v_id uuid; v_n integer;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM','ZONE']);
  v_type := private.moto_champ_corrigeable(v_table, v_champ, v_classe);
  if v_type is null then perform private.moto_refus('Champ non corrigeable par votre rôle.'); end if;
  execute format('select %I::text, moto_id from public.%I where id = $1', v_champ, v_table)
    into v_old, v_moto using v_cible;
  get diagnostics v_n = row_count;
  if v_n = 0 then perform private.moto_erreur('Cible introuvable.'); end if;
  if v_moto is not null and v_classe = 'ZONE' and not private.moto_dans_perimetre(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if nullif(btrim(p ->> 'nouvelle_valeur'), '') is null then perform private.moto_erreur('Nouvelle valeur obligatoire.'); end if;
  if exists (select 1 from public.moto_corrections where cible_table = v_table and cible_id = v_cible and champ = v_champ and statut = 'DEMANDEE') then
    perform private.moto_erreur('Une correction est déjà en attente sur ce champ.');
  end if;
  perform private.moto_motif(p ->> 'motif', 10);
  insert into public.moto_corrections (cible_table, cible_id, champ, ancienne_valeur, nouvelle_valeur, motif)
  values (v_table, v_cible, v_champ, v_old, btrim(p ->> 'nouvelle_valeur'), btrim(p ->> 'motif')) returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', 'DEMANDEE');
end $$;

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

-- ---------------------------------------------------------------------
-- 7. Maintenance et remise en service
-- ---------------------------------------------------------------------
create or replace function public.moto_maintenance_demander(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_id uuid; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE']);
  perform private.moto_charger(v_moto);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if upper(coalesce(p ->> 'type_maintenance', '')) not in ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION','REPARATION','PANNE') then
    perform private.moto_erreur('Type de maintenance inconnu.');
  end if;
  perform private.moto_motif('Demande d''entretien');
  insert into public.moto_maintenances (moto_id, type_maintenance, description, compteur_km, cout_estime, garage_nom, incident_id, client_op_id)
  values (v_moto, upper(p ->> 'type_maintenance'), btrim(coalesce(p ->> 'description', '')), private.moto_num(p, 'compteur_km'),
          private.moto_num(p, 'cout_estime'), nullif(btrim(p ->> 'garage_nom'), ''), private.moto_uuid(p, 'incident_id'), v_client)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'statut', 'DEMANDEE');
  perform private.moto_op_enregistrer(v_client, 'MAINTENANCE_DEMANDE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

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

create or replace function public.moto_maintenance_demarrer(p_maintenance uuid, p_garage text, p_date date default current_date)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances;
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM']);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut <> 'AUTORISEE' then perform private.moto_erreur('Seule une maintenance autorisée peut démarrer.'); end if;
  if not private.moto_peut_operer(mt.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if nullif(btrim(p_garage), '') is null then perform private.moto_erreur('Garage intervenant obligatoire.'); end if;
  perform private.moto_motif('Début d''intervention');
  update public.moto_maintenances set statut = 'EN_COURS', garage_nom = btrim(p_garage), date_intervention = p_date where id = p_maintenance;
  perform private.moto_ouvrir_immobilisation(mt.moto_id, 'Maintenance '||mt.type_maintenance, 'MAINTENANCE', mt.id);
  return jsonb_build_object('id', p_maintenance, 'statut', 'EN_COURS');
end $$;

create or replace function public.moto_maintenance_terminer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_fact uuid := private.moto_uuid(p, 'facture_document_id'); v_remise boolean := coalesce((p ->> 'remettre_en_service')::boolean, false);
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found or mt.statut <> 'EN_COURS' then perform private.moto_erreur('Seule une maintenance en cours peut être terminée.'); end if;
  if not private.moto_peut_operer(mt.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if v_fact is not null and not exists (select 1 from public.moto_documents where id = v_fact and moto_id = mt.moto_id and type_document = 'FACTURE') then
    perform private.moto_erreur('La facture doit être un document FACTURE de cette moto.');
  end if;
  if private.moto_num(p, 'cout_reel') is null then perform private.moto_erreur('Coût réel obligatoire (0 si aucune dépense).'); end if;
  if v_remise and private.moto_num(p, 'cout_reel') > 0 and v_fact is null then
    perform private.moto_erreur('Facture obligatoire pour clôturer une intervention payante.');
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif', 'Fin d''intervention'));
  update public.moto_maintenances set statut = 'TERMINEE', cout_reel = private.moto_num(p, 'cout_reel'), facture_document_id = v_fact,
         compteur_km = coalesce(private.moto_num(p, 'compteur_km'), compteur_km), garage_nom = coalesce(nullif(btrim(p ->> 'garage_nom'), ''), garage_nom),
         termine_par = auth.uid(), termine_at = now() where id = mt.id;
  perform private.moto_enregistrer_km(mt.moto_id, private.moto_num(p, 'compteur_km'), now(), 'MAINTENANCE');
  if v_remise then
    update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = 'Fin de maintenance'
    where moto_id = mt.moto_id and source_type = 'MAINTENANCE' and source_id = mt.id and fin is null;
  end if;
  perform private.moto_recalculer_statuts(mt.moto_id);
  return jsonb_build_object('id', mt.id, 'statut', 'TERMINEE', 'remise_en_service', v_remise);
end $$;

create or replace function public.moto_controle_remise_en_service(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_crit boolean; v_res text; v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null then perform private.moto_erreur('Nom de l''intervenant obligatoire.'); end if;
  v_crit := private.moto_items_valides(p -> 'items');
  v_res := case when v_crit or exists (select 1 from jsonb_array_elements(p -> 'items') e where not (e ->> 'ok')::boolean) then 'INAPTE' else 'APTE' end;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat, intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id)
  values (v_moto, 'REMISE_EN_SERVICE', private.moto_num(p, 'compteur_km'), p -> 'items', v_crit, v_res, btrim(p ->> 'intervenant_nom'),
          nullif(btrim(p ->> 'garage_nom'), ''), nullif(btrim(p ->> 'avis_mecanicien'), ''), private.moto_uuid(p, 'rapport_document_id'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'resultat', v_res);
end $$;

create or replace function private.moto_controle_apte_depuis(p_moto uuid, p_depuis timestamptz)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.moto_controles c where c.moto_id = p_moto and c.type_controle = 'REMISE_EN_SERVICE'
                 and c.resultat = 'APTE' and c.date_controle >= p_depuis
                 and not exists (select 1 from public.moto_controles c2 where c2.moto_id = p_moto and c2.type_controle = 'REMISE_EN_SERVICE'
                                 and c2.date_controle > c.date_controle and c2.resultat = 'INAPTE'))
$$;

create or replace function public.moto_lever_immobilisation(p_immobilisation uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare im public.moto_immobilisations;
begin
  perform private.moto_exiger_classe(array['BM','ZONE']);
  perform private.moto_motif(p_motif, 5);
  select * into im from public.moto_immobilisations where id = p_immobilisation for update;
  if not found or im.fin is not null then perform private.moto_erreur('Immobilisation introuvable ou déjà levée.'); end if;
  if not private.moto_peut_operer(im.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if im.source_type in ('INCIDENT','MAINTENANCE') then perform private.moto_erreur('Cette immobilisation se lève par le circuit de l''incident ou de la maintenance.'); end if;
  if not private.moto_controle_apte_depuis(im.moto_id, im.debut) then
    perform private.moto_erreur('Levée bloquée : un contrôle de remise en service APTE est exigé après l''immobilisation.');
  end if;
  update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = btrim(p_motif) where id = im.id;
  perform private.moto_recalculer_statuts(im.moto_id);
  return jsonb_build_object('id', im.id, 'levee', true);
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

create or replace function public.moto_parametre_modifier(p_cle text, p_valeur numeric, p_valeur_json jsonb, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 5);
  update public.moto_parametres set valeur = coalesce(p_valeur, valeur), valeur_json = coalesce(p_valeur_json, valeur_json),
         updated_by = auth.uid(), updated_at = now() where cle = p_cle;
  if not found then perform private.moto_erreur('Paramètre inconnu.'); end if;
  return jsonb_build_object('cle', p_cle);
end $$;

-- ---------------------------------------------------------------------
-- 8. Pneumatiques (identité propre, indépendante de la moto)
-- ---------------------------------------------------------------------
create or replace function public.moto_pneu_creer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  if nullif(btrim(p ->> 'code'), '') is null or nullif(btrim(p ->> 'marque'), '') is null or nullif(btrim(p ->> 'dimensions'), '') is null then
    perform private.moto_erreur('Code, marque et dimensions obligatoires.');
  end if;
  perform private.moto_motif('Entrée en stock pneu');
  insert into public.moto_pneus (code, marque, modele, dimensions, numero_serie, date_achat, cout_achat, fournisseur)
  values (upper(btrim(p ->> 'code')), btrim(p ->> 'marque'), nullif(btrim(p ->> 'modele'), ''), btrim(p ->> 'dimensions'),
          nullif(btrim(p ->> 'numero_serie'), ''), nullif(p ->> 'date_achat', '')::date, private.moto_num(p, 'cout_achat'),
          nullif(btrim(p ->> 'fournisseur'), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.moto_pneu_poser(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare pn public.moto_pneus; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  select * into pn from public.moto_pneus where id = private.moto_uuid(p, 'pneu_id') for update;
  if not found or pn.statut <> 'EN_STOCK' then perform private.moto_erreur('Pneu introuvable ou non disponible en stock.'); end if;
  if upper(coalesce(p ->> 'position', '')) not in ('AVANT','ARRIERE') then perform private.moto_erreur('Position : AVANT ou ARRIERE.'); end if;
  if exists (select 1 from public.moto_pneu_poses where moto_id = v_moto and position = upper(p ->> 'position') and depose_date is null) then
    perform private.moto_erreur('Un pneu est déjà monté à cette position : déposez-le d''abord.');
  end if;
  if private.moto_num(p, 'pose_km') is null then perform private.moto_erreur('Compteur au montage obligatoire.'); end if;
  perform private.moto_motif('Montage pneu');
  insert into public.moto_pneu_poses (pneu_id, moto_id, position, pose_date, pose_km)
  values (pn.id, v_moto, upper(p ->> 'position'), coalesce(nullif(p ->> 'pose_date', '')::date, current_date), private.moto_num(p, 'pose_km'))
  returning id into v_id;
  update public.moto_pneus set statut = 'MONTE' where id = pn.id;
  begin
    perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'pose_km'), now(), 'MAINTENANCE');
  exception when sqlstate 'P0001' then null;
  end;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.moto_pneu_deposer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare po public.moto_pneu_poses; v_dest text := upper(coalesce(p ->> 'destination', 'EN_STOCK'));
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE']);
  select * into po from public.moto_pneu_poses where id = private.moto_uuid(p, 'pose_id') for update;
  if not found or po.depose_date is not null then perform private.moto_erreur('Montage introuvable ou déjà déposé.'); end if;
  if not private.moto_peut_operer(po.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if v_dest not in ('EN_STOCK','EN_REPARATION','REFORME') then perform private.moto_erreur('Destination inconnue.'); end if;
  if private.moto_num(p, 'depose_km') is null or private.moto_num(p, 'depose_km') < po.pose_km then
    perform private.moto_erreur('Compteur à la dépose obligatoire et supérieur ou égal au montage.');
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif_depose', 'Dépose pneu'), 3);
  update public.moto_pneu_poses set depose_date = coalesce(nullif(p ->> 'depose_date', '')::date, current_date),
         depose_km = private.moto_num(p, 'depose_km'), motif_depose = btrim(p ->> 'motif_depose'), depose_par = auth.uid()
  where id = po.id;
  update public.moto_pneus set statut = v_dest, motif_reforme = case when v_dest = 'REFORME' then btrim(p ->> 'motif_depose') else motif_reforme end
  where id = po.pneu_id;
  return jsonb_build_object('id', po.id, 'km_parcourus', private.moto_num(p, 'depose_km') - po.pose_km);
end $$;

create or replace function public.moto_pneu_reparation(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid; v_moto uuid := private.moto_uuid(p, 'moto_id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE']);
  if v_moto is not null and not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if not exists (select 1 from public.moto_pneus where id = private.moto_uuid(p, 'pneu_id')) then perform private.moto_erreur('Pneu introuvable.'); end if;
  perform private.moto_motif('Réparation pneu');
  insert into public.moto_pneu_reparations (pneu_id, moto_id, date_reparation, compteur_km, cout, description)
  values (private.moto_uuid(p, 'pneu_id'), v_moto, coalesce(nullif(p ->> 'date_reparation', '')::date, current_date),
          private.moto_num(p, 'compteur_km'), coalesce(private.moto_num(p, 'cout'), 0), btrim(coalesce(p ->> 'description', 'Réparation')))
  returning id into v_id;
  update public.moto_pneus set statut = 'EN_STOCK' where id = private.moto_uuid(p, 'pneu_id') and statut = 'EN_REPARATION';
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- 9. Circuit incident critique
--    Arrêt → Signalement → Immobilisation → Diagnostic → Autorisation de
--    dépense (si nécessaire) → Réparation → Contrôle → Remise en service → Clos
-- ---------------------------------------------------------------------
create or replace function public.moto_incident_avancer(p_incident uuid, p_etape text, p_note text, p_cout numeric default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare i public.moto_incidents; v_classe text; v_cible text := upper(coalesce(p_etape, '')); v_ok boolean; v_immo boolean;
begin
  v_classe := private.moto_exiger_classe(array['BM','ZONE','ABM']);
  select * into i from public.moto_incidents where id = p_incident for update;
  if not found then perform private.moto_erreur('Incident introuvable.'); end if;
  if not private.moto_peut_operer(i.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_motif(p_note, 5);
  v_immo := exists (select 1 from public.moto_immobilisations where source_type = 'INCIDENT' and source_id = i.id and fin is null);
  v_ok := case i.etape
    when 'SIGNALE' then v_cible in ('IMMOBILISEE','DIAGNOSTIC') or (v_cible = 'CLOS' and i.gravite <> 'CRITIQUE')
    when 'IMMOBILISEE' then v_cible = 'DIAGNOSTIC'
    when 'DIAGNOSTIC' then v_cible in ('AUTORISATION_DEPENSE','REPARATION','CONTROLE') or (v_cible = 'CLOS' and not v_immo and i.gravite <> 'CRITIQUE')
    when 'AUTORISATION_DEPENSE' then v_cible = 'REPARATION'
    when 'REPARATION' then v_cible = 'CONTROLE'
    when 'CONTROLE' then v_cible = 'REMIS_EN_SERVICE'
    when 'REMIS_EN_SERVICE' then v_cible = 'CLOS'
    else false end;
  if not v_ok then perform private.moto_erreur(format('Transition interdite : %s → %s.', i.etape, v_cible)); end if;
  if v_cible = 'IMMOBILISEE' and not v_immo then
    perform private.moto_ouvrir_immobilisation(i.moto_id, 'Incident '||i.type_incident, 'INCIDENT', i.id);
  end if;
  if v_cible = 'AUTORISATION_DEPENSE' then
    if v_classe not in ('BM','ZONE') then perform private.moto_refus('Autorisation de dépense réservée au Branch Manager ou au Chef de Zone.'); end if;
    if i.declare_par = auth.uid() then perform private.moto_refus('Le déclarant ne peut pas autoriser la dépense de son propre incident.'); end if;
    if p_cout is null or p_cout <= 0 then perform private.moto_erreur('Montant estimé de la dépense obligatoire.'); end if;
    perform set_config('moto.valideur', auth.uid()::text, true);
    update public.moto_incidents set cout_estime = p_cout, depense_autorisee_par = auth.uid() where id = i.id;
  end if;
  if v_cible = 'REMIS_EN_SERVICE' then
    if not private.moto_controle_apte_depuis(i.moto_id, i.declare_at) then
      perform private.moto_erreur('Remise en service bloquée : contrôle de remise en service APTE obligatoire après l''incident.');
    end if;
    update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = 'Remise en service après incident'
    where source_type = 'INCIDENT' and source_id = i.id and fin is null;
  end if;
  if v_cible = 'CLOS' and p_cout is not null then update public.moto_incidents set cout_reel = p_cout where id = i.id; end if;
  update public.moto_incidents set etape = v_cible,
         clos_par = case when v_cible = 'CLOS' then auth.uid() else clos_par end,
         clos_at = case when v_cible = 'CLOS' then now() else clos_at end
  where id = i.id;
  insert into public.moto_incident_etapes (incident_id, etape, note) values (i.id, v_cible, btrim(p_note));
  perform private.moto_recalculer_statuts(i.moto_id);
  return jsonb_build_object('id', i.id, 'etape', v_cible);
end $$;

-- ---------------------------------------------------------------------
-- 10. Formation
-- ---------------------------------------------------------------------
create or replace function public.moto_formation_enregistrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_id uuid; v_score integer; v_total integer; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  if private.moto_classe() is null then perform private.moto_refus('Accès Moto Manager refusé.'); end if;
  v_score := private.moto_num(p, 'score')::integer; v_total := private.moto_num(p, 'total')::integer;
  if nullif(btrim(p ->> 'module_code'), '') is null or v_total is null or v_total <= 0 or v_score is null or v_score < 0 or v_score > v_total then
    perform private.moto_erreur('Résultat de quiz invalide.');
  end if;
  insert into public.moto_formation_resultats (module_code, score, total, reussi, client_op_id)
  values (btrim(p ->> 'module_code'), v_score, v_total, v_score::numeric / v_total >= 0.8, v_client) returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'reussi', v_score::numeric / v_total >= 0.8);
  perform private.moto_op_enregistrer(v_client, 'FORMATION', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- 10 bis. Bénéficiaires éligibles (BM, ABM) : nom, rôle et cluster seulement.
--         profils reste lisible par le seul BM (RLS existante inchangée).
-- ---------------------------------------------------------------------
create or replace function public.moto_beneficiaires()
returns table (user_id uuid, nom text, role text, cluster_code text)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  return query select p.user_id, coalesce(p.nom, p.email), p.role, public.aflp_cluster_code(p.cluster)
    from public.profils p where p.actif and p.role in ('Unit Head','Zonal Head') order by p.role, p.nom;
end $$;

-- ---------------------------------------------------------------------
-- 11. Synchronisation par lot (file hors connexion)
--     Chaque opération est traitée dans une sous-transaction : un rejet
--     n'annule pas les autres. Rejet métier = statut REJETE mémorisé (le
--     même client_op_id renverra toujours la même réponse). Erreur technique
--     transitoire = ERREUR_TEMPORAIRE, non mémorisée : le client réessaie.
-- ---------------------------------------------------------------------
create or replace function public.moto_sync_batch(p_operations jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare op jsonb; v_type text; v_client uuid; v_payload jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb; v_state text; v_msg text; v_prev jsonb;
begin
  if auth.uid() is null or private.moto_classe() is null then perform private.moto_refus('Accès Moto Manager refusé.'); end if;
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

-- ---------------------------------------------------------------------
-- 12. Droits d'exécution
--     · fonctions public.moto_* : authentifiés uniquement, jamais anon ;
--     · fonctions private.moto_* d'écriture : AUCUN droit direct (elles ne
--       s'exécutent qu'à travers les fonctions publiques SECURITY DEFINER) ;
--     · seules les fonctions de lecture utilisées par la RLS et les vues
--       restent exécutables par `authenticated`.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
