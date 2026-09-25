-- =====================================================================
-- FBMS / WMS — P1-08 (complément) : périmètre Warehouse sur le GRN
-- Contre-vérification du 25/09/2026 (test G3).
--
-- Constat : wms_generate_grn renvoyait le GRN déjà émis (chemin
-- idempotent) AVANT de contrôler le périmètre : un Storekeeper rattaché
-- à BKE-003 obtenait « Générer » avec succès sur une réception BKE-002.
-- Aucune écriture n'était possible (le déclencheur de périmètre protège
-- l'insertion), mais l'action tracée comme réussie était trompeuse.
--
-- Correctif : contrôle du périmètre sur la réception AVANT le retour
-- idempotent. La lecture du GRN (écran « Voir ») reste inchangée.
-- Idempotent : ne réapplique pas si déjà patché.
-- =====================================================================
do $$
declare d text;
  a1 text := '  select * into g from public.wms_grns where reception_id = p_reception_id;
  if g.id is not null then return to_jsonb(g) || jsonb_build_object(''idempotent'', true); end if;';
  v_msg_check text := 'GRN : contrôle de périmètre avant retour idempotent';
begin
  select pg_get_functiondef('public.wms_generate_grn(text)'::regprocedure) into d;
  if position(v_msg_check in d) > 0 then return; end if;
  if position(a1 in d) = 0 then raise exception 'Ancre introuvable dans wms_generate_grn'; end if;
  d := replace(d, a1, '  -- '||v_msg_check||'
  select * into r from public.wms_receptions where id = p_reception_id;
  if r.id is not null and private.wms_scope_violation(r.warehouse_id) is not null then
    raise exception ''%'', private.wms_scope_violation(r.warehouse_id) using errcode = ''42501'';
  end if;
'||a1);
  execute d;
end $$;
