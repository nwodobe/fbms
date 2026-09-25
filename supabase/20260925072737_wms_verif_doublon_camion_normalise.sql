-- FBMS / WMS · vérification du 25/09/2026 · écart 1
-- Doublon camion : la normalisation de la plaque utilisait le motif '\\s+'
-- (antislash littéral), les espaces n'étaient donc pas retirés et
-- "GH 4455 CI" n'était pas détecté comme doublon de "GH4455CI".
-- Correctif : normalisation par suppression de tout caractère non
-- alphanumérique (espaces, tirets, points), en majuscules, et comparaison
-- des doublons sur la plaque normalisée des réceptions existantes.
-- Aucune donnée existante n'est réécrite.
do $mig$
declare f text; pat text := ''''||repeat(chr(92),2)||'s+'''; old_dup text := 'where truck=v_truck and status';
begin
  f := pg_get_functiondef('public.wms_create_reception(jsonb,text)'::regprocedure);
  if position('[^A-Za-z0-9]' in f) > 0 then raise notice 'Correctif doublon camion déjà appliqué'; return; end if;
  if (length(f)-length(replace(f,pat,'')))/length(pat) <> 3 then raise exception 'Ancre de normalisation introuvable (attendu 3 occurrences)'; end if;
  if position(old_dup in f) = 0 then raise exception 'Ancre du contrôle de doublon introuvable'; end if;
  f := replace(f, pat, '''[^A-Za-z0-9]''');
  f := replace(f, old_dup, 'where upper(regexp_replace(coalesce(truck,''''),''[^A-Za-z0-9]'','''',''g''))=v_truck and status');
  execute f;
end $mig$;
