-- =============================================================================
-- AFLP FLEET 22 : correction directe d'un relevé de compteur par le Branch Manager ou l'ABM
-- APPLIQUÉ EN PRODUCTION le 09/11/2026 sur autorisation du Branch Manager (empreinte md5(prosrc) 29f5304ec1e2089d4588f1f59123dd81, identique à la réplique testée).
-- Décision du Branch Manager du 09/11/2026 : l'agent de MOTO-003 a fait une erreur de saisie du
-- compteur ; le Branch Manager et son assistant doivent pouvoir la corriger eux-mêmes.
--
-- public.moto_releve_corriger(p_releve, p_nouveau_km, p_motif) :
--   - réservé au Branch Manager et à l'Assistant Branch Manager (aucun autre rôle) ;
--   - appliqué immédiatement, sans second valideur (même logique que les migrations 11, 14, 17, 20) ;
--   - motif obligatoire (10 caractères minimum), nouvelle valeur ≥ 0 et différente de l'actuelle ;
--   - le déclencheur existant moto_mission_releve_coherence garde les protections : le compteur ne
--     recule pas sous un relevé antérieur, ne dépasse pas un relevé postérieur, reste cohérent avec
--     le départ et l'arrivée de la mission ; il reporte la valeur dans la mission liée ;
--   - l'enregistrement d'origine est aligné (contrôle avant départ, achat de carburant : même moto,
--     même instant, même ancienne valeur) ; le compteur actuel de la moto est recalculé ;
--   - traçabilité : une ligne APPLIQUEE dans moto_corrections (auteur, ancienne et nouvelle valeur,
--     motif) et, par les déclencheurs existants, chaque ligne modifiée dans moto_journal ;
--   - une demande de correction EN ATTENTE sur ce relevé est close (REJETEE, « remplacée ») ;
--   - le circuit « demande validée par un autre responsable » reste disponible et inchangé.
-- Aucune table, aucune colonne, aucune politique RLS ajoutée ou modifiée.
-- Rejouable. Retour arrière : 20261117090100_aflp_fleet_22_rollback.sql
-- =============================================================================
create or replace function public.moto_releve_corriger(p_releve uuid, p_nouveau_km numeric, p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  r public.moto_releves_km; v_classe text; v_ancien numeric; v_nouveau numeric := round(p_nouveau_km, 1);
  v_missions integer := 0; v_controles integer := 0; v_carburant integer := 0; v_compteur numeric; v_corr uuid;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM']);
  perform private.moto_motif(p_motif, 10);
  if p_releve is null then perform private.moto_erreur('Relevé non précisé.'); end if;
  if v_nouveau is null or v_nouveau < 0 or v_nouveau > 999999 then perform private.moto_erreur('Nouvelle valeur du compteur invalide.'); end if;

  select * into r from public.moto_releves_km where id = p_releve;
  if not found then perform private.moto_erreur('Relevé introuvable.'); end if;
  perform private.moto_charger(r.moto_id, true);                       -- même ordre de verrous que les missions : moto d'abord
  select * into r from public.moto_releves_km where id = p_releve for update;
  v_ancien := r.compteur_km;
  if v_ancien = v_nouveau then perform private.moto_erreur('La nouvelle valeur est identique à la valeur enregistrée.'); end if;

  perform set_config('moto.motif', 'Correction du compteur (' || v_classe || ') : ' || btrim(p_motif), true);
  perform set_config('moto.valideur', auth.uid()::text, true);

  -- Le déclencheur de cohérence refuse un recul, un dépassement ou une mission incohérente,
  -- et reporte la nouvelle valeur dans le départ ou l'arrivée de la mission liée.
  update public.moto_releves_km set compteur_km = v_nouveau where id = r.id;
  select count(*) into v_missions from public.moto_missions where depart_releve_id = r.id or arrivee_releve_id = r.id;

  -- Enregistrement d'origine : même moto, même instant, même ancienne valeur.
  if r.source = 'CONTROLE' then
    update public.moto_controles set compteur_km = v_nouveau
     where moto_id = r.moto_id and date_controle = r.date_releve and compteur_km = v_ancien;
    get diagnostics v_controles = row_count;
  elsif r.source = 'CARBURANT' then
    update public.moto_carburant set compteur_km = v_nouveau
     where moto_id = r.moto_id and date_achat = r.date_releve and compteur_km = v_ancien;
    get diagnostics v_carburant = row_count;
  end if;

  update public.moto_motos set compteur_actuel_km = (select max(compteur_km) from public.moto_releves_km where moto_id = r.moto_id)
   where id = r.moto_id returning compteur_actuel_km into v_compteur;

  update public.moto_corrections set statut = 'REJETEE', valide_at = now(),
         decision_motif = 'Remplacée par une correction directe du ' || v_classe
   where cible_table = 'moto_releves_km' and cible_id = r.id and champ = 'compteur_km' and statut = 'DEMANDEE';
  insert into public.moto_corrections (cible_table, cible_id, champ, ancienne_valeur, nouvelle_valeur, motif,
                                       statut, valide_at, decision_motif)
  values ('moto_releves_km', r.id, 'compteur_km', v_ancien::text, v_nouveau::text, btrim(p_motif),
          'APPLIQUEE', now(), 'Correction directe par le ' || v_classe || ' (décision du Branch Manager du 09/11/2026)')
  returning id into v_corr;

  return jsonb_build_object('correction_id', v_corr, 'releve_id', r.id, 'moto_id', r.moto_id, 'source', r.source,
    'ancien_km', v_ancien, 'nouveau_km', v_nouveau, 'compteur_actuel_km', v_compteur,
    'missions_alignees', v_missions, 'controles_alignes', v_controles, 'achats_alignes', v_carburant);
end $function$;

revoke all on function public.moto_releve_corriger(uuid, numeric, text) from public, anon;
grant execute on function public.moto_releve_corriger(uuid, numeric, text) to authenticated;
