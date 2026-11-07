-- =============================================================================
-- PRÉPARÉ, NON APPLIQUÉ · anomalie D-3 (25/10/2026)
-- La fonction public.offline_sync_batch (opération FARMER_ENROLL) ignorait la
-- précision GPS envoyée par le téléphone : une parcelle synchronisée hors ligne
-- avec coordonnées devenait POINT_CAPTURED sans précision (la contrainte
-- farmer_plots_gps_metadata_chk laisse passer un NULL).
--
-- Correctif ciblé : remplacement d'UN SEUL bloc (l'insertion de la parcelle) dans la
-- définition déployée, avec contrôle d'unicité. Le reste de la fonction est inchangé.
--   * précision > 0  : coordonnées + précision + heure de capture, POINT_CAPTURED ;
--   * sans précision : coordonnées NON enregistrées comme point GPS, conservées en note,
--     NOT_MAPPED (même règle que le formulaire en ligne corrigé).
-- Test : tests/sql/regularisation_aflp/04_offline_sync_precision_gps.sql (transaction annulée).
-- Retour arrière : section R (remplacement inverse).
-- =============================================================================
do $prep$
declare
  d text := pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure);
  ancien text := $a$insert into public.farmer_plots(
            id,producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,
            gps_status,gps_captured_at,area_source,evidence_level,status
          ) values (
            gen_random_uuid(),v_pid,v_row->>'village_id',
            coalesce(nullif(v_payload->'plot'->>'local_name',''),'PARCELLE PRINCIPALE'),
            nullif(v_payload->'plot'->>'declared_area','')::numeric,'HA',
            nullif(v_payload->'plot'->>'latitude','')::numeric,
            nullif(v_payload->'plot'->>'longitude','')::numeric,
            'NOT_MAPPED',
            null,
            'DECLARED','DECLARED','ACTIVE'
          );$a$;
  nouveau text := $n$insert into public.farmer_plots(
            id,producteur_id,village_id,local_name,declared_area,area_unit,latitude,longitude,
            gps_accuracy_m,gps_status,gps_captured_at,area_source,evidence_level,status,notes
          ) values (
            gen_random_uuid(),v_pid,v_row->>'village_id',
            coalesce(nullif(v_payload->'plot'->>'local_name',''),'PARCELLE PRINCIPALE'),
            nullif(v_payload->'plot'->>'declared_area','')::numeric,'HA',
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                 then nullif(v_payload->'plot'->>'latitude','')::numeric end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                 then nullif(v_payload->'plot'->>'longitude','')::numeric end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                 then nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                  and nullif(v_payload->'plot'->>'latitude','') is not null
                 then 'POINT_CAPTURED' else 'NOT_MAPPED' end,
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) > 0
                  and nullif(v_payload->'plot'->>'latitude','') is not null
                 then coalesce(nullif(v_payload->'plot'->>'gps_captured_at','')::timestamptz, now()) end,
            'DECLARED','DECLARED','ACTIVE',
            case when coalesce(nullif(v_payload->'plot'->>'gps_accuracy_m','')::numeric,0) <= 0
                  and nullif(v_payload->'plot'->>'latitude','') is not null
                 then 'Coordonnées saisies sans précision GPS : '||(v_payload->'plot'->>'latitude')||', '
                      ||(v_payload->'plot'->>'longitude')||'. À relever au GPS.' end
          );$n$;
  n int;
begin
  n := (length(d) - length(replace(d, ancien, ''))) / length(ancien);
  if n <> 1 then
    raise exception 'Bloc attendu trouvé % fois (1 attendu) : la fonction déployée a changé, correctif à revoir.', n;
  end if;
  execute replace(d, ancien, nouveau);
end
$prep$;

-- Contrôle :
-- select position('gps_accuracy_m,gps_status' in pg_get_functiondef('public.offline_sync_batch(jsonb)'::regprocedure)) > 0;

-- R · Retour arrière : rejouer le bloc DO ci-dessus en inversant « ancien » et « nouveau ».
