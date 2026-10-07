-- =============================================================================
-- AFLP 2027 · Coopératives — 6/6 : durcissement après revue des advisors Supabase
--   * fonctions de synthèse SECURITY DEFINER : exécution retirée à anon/public ;
--   * search_path figé sur les fonctions utilitaires signalées « mutable » ;
--   * séquences remises à 1 : la recette SQL (tests/sql/aflp_cooperatives_scenarios.sql)
--     est jouée en transaction annulée, mais une séquence ne recule jamais seule.
-- =============================================================================
begin;
revoke all on function public.aflp_coop_dashboard(text), public.aflp_channel_totals(text,boolean),
  public.aflp_coop_chain(uuid,text) from public, anon;
grant execute on function public.aflp_coop_dashboard(text), public.aflp_channel_totals(text,boolean),
  public.aflp_coop_chain(uuid,text) to authenticated;
alter function private.aflp_coop_block_delete() set search_path = public, pg_temp;
alter function private.aflp_txt(jsonb,text) set search_path = public, pg_temp;
alter function private.aflp_numv(jsonb,text) set search_path = public, pg_temp;
-- uniquement si aucune coopérative n'existe encore
do $$ begin
  if not exists (select 1 from public.aflp_cooperatives) then perform setval('public.aflp_coop_code_seq', 1, false); end if;
  if not exists (select 1 from public.aflp_coop_deliveries) then perform setval('public.aflp_coop_delivery_seq', 1, false); end if;
end $$;
commit;
