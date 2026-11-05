-- =============================================================================
-- AFLP FLEET 19 : auto-remise en service par le Branch Manager ou l'Assistant Branch Manager
-- APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreintes des 2 fonctions identiques à la réplique testée).
-- Décision du Branch Manager du 04/11/2026 : « assouplir ce verrou pour le Branch Manager et
-- l'Assistant Branch Manager, avec une trace « auto-remise en service » ».
--
-- Ce qui change :
--   - moto_incident_avancer (étape REMIS_EN_SERVICE) : le BM ou l'ABM qui a fait le contrôle de remise
--     en service (ou contrôlé les travaux) peut remettre lui-même la moto en service ; l'étape et la levée
--     d'immobilisation sont tracées « Auto-remise en service ».
--   - moto_lever_immobilisation : même assouplissement pour le BM, trace « Auto-levée ».
-- Ce qui ne change pas : contrôle de remise en service APTE obligatoire après l'incident, aucune
-- anomalie critique ouverte, travaux contrôlés conformes, l'utilisateur de la moto ne remet jamais
-- sa propre moto en service, le Chef de zone reste soumis à la séparation des tâches.
-- Rejouable. Retour arrière : 20261114090100_aflp_fleet_19_rollback.sql
-- =============================================================================
do $$
declare v text; n text;
begin
  v := pg_get_functiondef('public.moto_incident_avancer(uuid, text, text, numeric)'::regprocedure);
  if position('Auto-remise en service' in v) = 0 then
    n := replace(v, 'declare i public.moto_incidents; v_classe text;', 'declare i public.moto_incidents; v_classe text; v_auto boolean := false;');
    n := replace(n, $a$    if (select c.realise_par from public.moto_controles c where c.moto_id = i.moto_id and c.type_controle = 'REMISE_EN_SERVICE' and c.resultat = 'APTE'
          and c.date_controle >= i.declare_at order by c.date_controle desc limit 1) = auth.uid() then
      perform private.moto_refus('Séparation des tâches : l''auteur du contrôle de remise en service ne remet pas lui-même la moto en service.');
    end if;
    if exists (select 1 from public.moto_maintenances where incident_id = i.id and controle_par = auth.uid()) then
      perform private.moto_refus('Séparation des tâches : celui qui a contrôlé les travaux ne remet pas lui-même la moto en service.');
    end if;$a$, $b$    -- AFLP FLEET 19 : le BM ou l'ABM peut remettre en service après son propre contrôle ; la trace le dit.
    v_auto := coalesce((select c.realise_par from public.moto_controles c where c.moto_id = i.moto_id and c.type_controle = 'REMISE_EN_SERVICE' and c.resultat = 'APTE'
          and c.date_controle >= i.declare_at order by c.date_controle desc limit 1) = auth.uid(), false)
          or exists (select 1 from public.moto_maintenances where incident_id = i.id and controle_par = auth.uid());
    if v_auto and v_classe not in ('BM','ABM') then
      perform private.moto_refus('Séparation des tâches : l''auteur du contrôle ne remet pas lui-même la moto en service (sauf Branch Manager ou Assistant Branch Manager).');
    end if;$b$);
    n := replace(n, $a$levee_motif = 'Remise en service après incident'$a$,
      $b$levee_motif = case when v_auto then 'Auto-remise en service après incident' else 'Remise en service après incident' end$b$);
    n := replace(n, 'insert into public.moto_incident_etapes (incident_id, etape, note) values (i.id, v_cible, btrim(p_note));',
      $b$insert into public.moto_incident_etapes (incident_id, etape, note)
  values (i.id, v_cible, case when v_auto then 'Auto-remise en service : ' || btrim(p_note) else btrim(p_note) end);$b$);
    if n = v or position('v_auto and v_classe' in n) = 0 or position('Auto-remise en service : ' in n) = 0 then
      raise exception 'AFLP FLEET 19 : texte attendu introuvable dans moto_incident_avancer';
    end if;
    execute n;
  end if;

  v := pg_get_functiondef('public.moto_lever_immobilisation(uuid, text)'::regprocedure);
  if position('Auto-levée' in v) = 0 then
    n := replace(v, 'declare im public.moto_immobilisations; v_ctrl public.moto_controles;',
                    'declare im public.moto_immobilisations; v_ctrl public.moto_controles; v_classe text; v_auto boolean := false;');
    n := replace(n, $a$  perform private.moto_exiger_classe(array['BM','ZONE']);$a$, $b$  v_classe := private.moto_exiger_classe(array['BM','ZONE']);$b$);
    n := replace(n, $a$  if im.source_type = 'MAINTENANCE' and exists (select 1 from public.moto_maintenances where id = im.source_id and controle_par = auth.uid()) then
    perform private.moto_refus$a$, $b$  if im.source_type = 'MAINTENANCE' and exists (select 1 from public.moto_maintenances where id = im.source_id and controle_par = auth.uid()) then
    v_auto := true;
  end if;
  if v_auto and v_classe <> 'BM' then
    perform private.moto_refus$b$);
    n := replace(n, $a$  if v_ctrl.realise_par = auth.uid() then
    perform private.moto_refus$a$, $b$  if v_ctrl.realise_par = auth.uid() then v_auto := true; end if;
  if v_ctrl.realise_par = auth.uid() and v_classe <> 'BM' then
    perform private.moto_refus$b$);
    n := replace(n, 'levee_motif = btrim(p_motif) where id = im.id;',
      $b$levee_motif = case when v_auto then 'Auto-levée : ' || btrim(p_motif) else btrim(p_motif) end where id = im.id;$b$);
    if n = v or position('Auto-levée' in n) = 0 or position('v_classe := private.moto_exiger_classe' in n) = 0 then
      raise exception 'AFLP FLEET 19 : texte attendu introuvable dans moto_lever_immobilisation';
    end if;
    execute n;
  end if;
end $$;
