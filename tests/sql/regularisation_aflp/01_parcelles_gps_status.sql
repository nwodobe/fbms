-- Test A-BUG-1 · reproduit l'échec des parcelles 'DEFERRED' (chemin en ligne de field-buying.js).
-- Exécution : tout est annulé (RAISE final). Aucune donnée persistée.
-- Résultat observé le 25/10/2026 avant correctif client :
--   T1 ECHEC: farmer_plots_gps_metadata_chk ; T2 OK ; T3 OK ; T4 OK
-- Remplacer <UUID_BRANCH_MANAGER> par l'identifiant du compte Branch Manager.
do $$
declare r text := ''; v_pid text; v_vid text;
begin
  perform set_config('request.jwt.claims','{"sub":"<UUID_BRANCH_MANAGER>","role":"authenticated"}',true);
  perform set_config('role','authenticated',true);
  select id, village_id into v_pid, v_vid from public.producteurs where not deleted limit 1;
  begin
    insert into public.farmer_plots(producteur_id,village_id,local_name,declared_area,area_unit,gps_status,area_source,evidence_level,status)
    values (v_pid,v_vid,'TEST',1,'HA','DEFERRED','DECLARED','DECLARED','ACTIVE'); r := r || 'T1 OK; ';
  exception when others then r := r || 'T1 ECHEC: ' || sqlerrm || '; '; end;
  begin
    insert into public.farmer_plots(producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,gps_status,gps_captured_at,area_source,evidence_level,status)
    values (v_pid,v_vid,'TEST',1,'HA',7.7,-5.0,'POINT_CAPTURED',now(),'DECLARED','DECLARED','ACTIVE'); r := r || 'T2 OK (précision NULL acceptée : faiblesse de contrainte); ';
  exception when others then r := r || 'T2 ECHEC: ' || sqlerrm || '; '; end;
  begin
    insert into public.farmer_plots(producteur_id,village_id,local_name,declared_area,area_unit,gps_status,area_source,evidence_level,status)
    values (v_pid,v_vid,'TEST',1,'HA','NOT_MAPPED','DECLARED','DECLARED','ACTIVE'); r := r || 'T4 OK; ';
  exception when others then r := r || 'T4 ECHEC: ' || sqlerrm || '; '; end;
  raise exception 'RESULTATS (rollback) : %', r;
end $$;
