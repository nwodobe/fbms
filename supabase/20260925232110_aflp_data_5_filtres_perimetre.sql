-- FBMS · AFLP DATA (5/5) : filtres village / RT / producteur appliqués aux
-- évacuations, au cash RT et aux producteurs sans village dans les synthèses.
-- Correctif appliqué sur les définitions de la migration 4 (remplacement de texte
-- contrôlé : si le texte d'origine est absent, la fonction est laissée telle quelle).
do $patch$
declare
  f text; d text; d2 text;
  ev_old text := '    and public.aflp_ok_dim(p, e.zone_code, e.cluster_code, null, null)';
  ev_new text := '    and public.aflp_ok_dim(p, e.zone_code, e.cluster_code, null, null)
    and (nullif(p->>''village'', '''') is null or e.village_ids @> array[p->>''village''])
    and (nullif(p->>''rt'', '''') is null or e.rt_ids @> array[p->>''rt''])
    and (nullif(p->>''producer'', '''') is null or e.producer_ids @> array[p->>''producer''])';
  cash_old text := 'public.aflp_ok_dim(p, c.zone_code, c.cluster_code, null, c.rt_id)';
  cash_new text := 'public.aflp_ok_dim(p, c.zone_code, c.cluster_code, c.village_id, c.rt_id)';
  prod_old text := 'and (p1.village_id is null or vd.village_id is null or public.aflp_ok_dim(p, vd.zone_code, vd.cluster_code, p1.village_id, p1.rt_id))';
  prod_new text := 'and ((vd.village_id is not null and public.aflp_ok_dim(p, vd.zone_code, vd.cluster_code, p1.village_id, p1.rt_id))
      or (vd.village_id is null and nullif(p->>''zone'', '''') is null and nullif(p->>''cluster'', '''') is null and nullif(p->>''village'', '''') is null
          and coalesce(jsonb_array_length(case when jsonb_typeof(p->''clusters'') = ''array'' then p->''clusters'' end), 0) = 0
          and (nullif(p->>''rt'', '''') is null or p1.rt_id = p->>''rt'')))';
begin
  foreach f in array array['public.aflp_rpt_overview(jsonb)', 'public.aflp_rpt_controls(jsonb)', 'public.aflp_rpt_performance(jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    d2 := replace(replace(replace(d, ev_old || E'\n', ev_new || E'\n'), cash_old, cash_new), prod_old, prod_new);
    if d2 <> d and position('e.village_ids @> array' in d) = 0 then
      execute d2;
    end if;
  end loop;
end $patch$;
