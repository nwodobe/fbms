-- =====================================================================
-- FBMS / WMS — P1 : clôture journalière, pertes en transit
-- Audit du 24/09/2026, rejeu simulation 2 (25/09/2026).
--
-- Constat : lors d'un transfert inter-entrepôts avec écart accepté
-- (WRITE_OFF), l'ajustement est posté sur l'emplacement TRANSIT. La
-- clôture du Warehouse destinataire l'intégrait dans les « ajustements »
-- alors que ce stock n'a jamais été dans ses emplacements physiques
-- (STAGING/BIN/DRYING) : statut VARIANCE à tort (écart 50 kg sur un
-- transfert pourtant réconcilié et clôturé).
--
-- Correctif (lecture seule, non destructif) :
--   * inventory_adjustments_kg = ajustements sur emplacements physiques ;
--   * nouveau champ transit_adjustments_kg = pertes/gains constatés en
--     transit (visibles, hors bilan physique du Warehouse).
-- Idempotent : ne réapplique pas si déjà patché.
-- =====================================================================
do $$
declare d text;
  a1 text := 'v_prod numeric:=0; v_ret numeric:=0;';
  a2 text := 'coalesce(sum(ml.qty_in-ml.qty_out) filter(where m.type=''ADJUSTMENT''),0),';
  a3 text := 'coalesce(sum(ml.qty_out) filter(where m.type=''RETURN_TO_SUPPLIER''),0)
  into v_receipts,v_tin,v_tout,v_adj,v_prod,v_ret';
  a4 text := '''production_issues_kg'',round(v_prod,3),';
begin
  select pg_get_functiondef('public.wms_daily_closing(uuid,date)'::regprocedure) into d;
  if position('transit_adjustments_kg' in d) > 0 then return; end if;
  if position(a1 in d)=0 or position(a2 in d)=0 or position(a3 in d)=0 or position(a4 in d)=0 then
    raise exception 'Ancre introuvable dans wms_daily_closing';
  end if;
  d := replace(d, a1, 'v_prod numeric:=0; v_ret numeric:=0; v_tadj numeric:=0;');
  d := replace(d, a2, 'coalesce(sum((case when m.dest_type in (''STAGING'',''BIN'',''DRYING'') then ml.qty_in else 0 end)-(case when m.source_type in (''STAGING'',''BIN'',''DRYING'') then ml.qty_out else 0 end)) filter(where m.type=''ADJUSTMENT''),0),');
  d := replace(d, a3, 'coalesce(sum(ml.qty_out) filter(where m.type=''RETURN_TO_SUPPLIER''),0),
    coalesce(sum((case when m.dest_type=''TRANSIT'' then ml.qty_in else 0 end)-(case when m.source_type=''TRANSIT'' then ml.qty_out else 0 end)) filter(where m.type=''ADJUSTMENT''),0)
  into v_receipts,v_tin,v_tout,v_adj,v_prod,v_ret,v_tadj');
  d := replace(d, a4, '''production_issues_kg'',round(v_prod,3),''transit_adjustments_kg'',round(v_tadj,3),');
  execute d;
end $$;

comment on function public.wms_daily_closing(uuid,date) is
  'Clôture journalière par Warehouse : Ouverture + Réceptions + Transferts entrants − Transferts sortants − Pertes process ± Ajustements physiques − Sorties production − Retours fournisseur = Clôture. Les pertes constatées en transit sont publiées à part (transit_adjustments_kg).';
