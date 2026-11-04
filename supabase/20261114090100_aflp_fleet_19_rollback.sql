-- AFLP FLEET 19 : RETOUR ARRIÈRE (séparation des tâches rétablie pour la remise en service et la levée).
-- Les remises en service et levées déjà tracées « Auto- » restent telles quelles. Rejouable.
CREATE OR REPLACE FUNCTION public.moto_incident_avancer(p_incident uuid, p_etape text, p_note text, p_cout numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.moto_incidents; v_classe text; v_cible text := upper(coalesce(p_etape, '')); v_ok boolean; v_immo boolean;
begin
  v_classe := private.moto_exiger_classe(array['BM','ZONE','ABM']);   -- inchangé : pas d'élargissement au coordinateur
  select * into i from public.moto_incidents where id = p_incident for update;
  if not found then perform private.moto_erreur('Incident introuvable.'); end if;
  if not private.moto_peut_operer(i.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(i.moto_id, 'cette étape');
  perform private.moto_motif(p_note, 5);
  if p_cout is not null then
    perform private.moto_refus('Aucun montant ne se saisit dans le circuit incident : le coût passe par un dossier de maintenance autorisé par le Branch Manager.');
  end if;
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
  if v_cible = 'AUTORISATION_DEPENSE' and not exists (
       select 1 from public.moto_autorisations a join public.moto_maintenances mt on mt.id = a.maintenance_id
       where mt.incident_id = i.id and mt.moto_id = i.moto_id and a.statut = 'AUTORISEE') then
    perform private.moto_refus('Aucune autorisation du Branch Manager : soumettez le devis dans un dossier de maintenance lié à cet incident.');
  end if;
  if v_cible = 'REMIS_EN_SERVICE' then
    if not private.moto_controle_apte_depuis(i.moto_id, i.declare_at) then
      perform private.moto_erreur('Remise en service bloquée : contrôle de remise en service APTE obligatoire après l''incident.');
    end if;
    if (select c.realise_par from public.moto_controles c where c.moto_id = i.moto_id and c.type_controle = 'REMISE_EN_SERVICE' and c.resultat = 'APTE'
          and c.date_controle >= i.declare_at order by c.date_controle desc limit 1) = auth.uid() then
      perform private.moto_refus('Séparation des tâches : l''auteur du contrôle de remise en service ne remet pas lui-même la moto en service.');
    end if;
    if exists (select 1 from public.moto_maintenances where incident_id = i.id and controle_par = auth.uid()) then
      perform private.moto_refus('Séparation des tâches : celui qui a contrôlé les travaux ne remet pas lui-même la moto en service.');
    end if;
    if exists (select 1 from public.moto_maintenances where incident_id = i.id and statut not in ('CONTROLEE','CLOTUREE','ANNULEE','REFUSEE')) then
      perform private.moto_erreur('Remise en service bloquée : les travaux liés à l''incident ne sont pas contrôlés conformes.');
    end if;
    if exists (select 1 from public.moto_actions_correctives where moto_id = i.moto_id and gravite = 'CRITIQUE' and statut in ('OUVERTE','PLANIFIEE','REALISEE')) then
      perform private.moto_erreur('Remise en service bloquée : une anomalie critique n''est pas encore corrigée et vérifiée.');
    end if;
    update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = 'Remise en service après incident'
    where source_type = 'INCIDENT' and source_id = i.id and fin is null;
  end if;
  update public.moto_incidents set etape = v_cible,
         clos_par = case when v_cible = 'CLOS' then auth.uid() else clos_par end,
         clos_at = case when v_cible = 'CLOS' then now() else clos_at end
  where id = i.id;
  insert into public.moto_incident_etapes (incident_id, etape, note) values (i.id, v_cible, btrim(p_note));
  perform private.moto_recalculer_statuts(i.moto_id);
  return jsonb_build_object('id', i.id, 'etape', v_cible);
end $function$

;

CREATE OR REPLACE FUNCTION public.moto_lever_immobilisation(p_immobilisation uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare im public.moto_immobilisations; v_ctrl public.moto_controles;
begin
  perform private.moto_exiger_classe(array['BM','ZONE']);
  perform private.moto_motif(p_motif, 5);
  select * into im from public.moto_immobilisations where id = p_immobilisation for update;
  if not found or im.fin is not null then perform private.moto_erreur('Immobilisation introuvable ou déjà levée.'); end if;
  if not private.moto_peut_operer(im.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if im.source_type = 'INCIDENT' then perform private.moto_erreur('Cette immobilisation se lève par le circuit de l''incident.'); end if;
  if im.source_type = 'MAINTENANCE' and not exists (select 1 from public.moto_maintenances where id = im.source_id and statut in ('CONTROLEE','CLOTUREE')) then
    perform private.moto_erreur('Levée bloquée : les travaux de maintenance ne sont pas contrôlés conformes.');
  end if;
  if im.source_type = 'MAINTENANCE' and exists (select 1 from public.moto_maintenances where id = im.source_id and controle_par = auth.uid()) then
    perform private.moto_refus('Séparation des tâches : celui qui a contrôlé les travaux ne lève pas lui-même l''immobilisation.');
  end if;
  perform private.moto_exiger_independance(im.moto_id, 'la levée d''immobilisation');
  if not private.moto_controle_apte_depuis(im.moto_id, im.debut) then
    perform private.moto_erreur('Levée bloquée : un contrôle de remise en service APTE est exigé après l''immobilisation.');
  end if;
  if exists (select 1 from public.moto_actions_correctives where moto_id = im.moto_id and gravite = 'CRITIQUE' and statut in ('OUVERTE','PLANIFIEE','REALISEE')) then
    perform private.moto_erreur('Levée bloquée : une anomalie critique n''est pas encore corrigée et vérifiée.');
  end if;
  select * into v_ctrl from public.moto_controles where moto_id = im.moto_id and type_controle = 'REMISE_EN_SERVICE' and resultat = 'APTE'
     and date_controle >= im.debut order by date_controle desc limit 1;
  if v_ctrl.realise_par = auth.uid() then
    perform private.moto_refus('Séparation des tâches : l''auteur du contrôle de remise en service ne lève pas lui-même l''immobilisation.');
  end if;
  update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = btrim(p_motif) where id = im.id;
  perform private.moto_recalculer_statuts(im.moto_id);
  return jsonb_build_object('id', im.id, 'levee', true);
end $function$

;

