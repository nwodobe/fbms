-- FBMS / WMS · vérification du 25/09/2026 · écarts 3 et 5
-- Écart 3 : wms_v_receptions.next_action renvoyait ALLOCATE_BIN pour toute
--   réception RELEASED, même quand le LOT est déjà entièrement en BIN.
--   Désormais ALLOCATE_BIN uniquement s'il reste du stock du LOT en staging.
-- Écart 5 : le message de blocage documentaire affichait « non conformes () »
--   quand la liste était vide. Il ne cite plus que les listes non vides.
do $mig$
declare v text; f text;
  old_na text := $a$WHEN 'RELEASED'::text THEN 'ALLOCATE_BIN'::text$a$;
  new_na text := $a$WHEN 'RELEASED'::text THEN CASE WHEN COALESCE(( SELECT sum(vb.qty) AS sum FROM wms_v_balances vb WHERE ((vb.lot_id = r.lot_id) AND (vb.location_type = 'STAGING'::text))), (0)::numeric) > 0.0005 THEN 'ALLOCATE_BIN'::text ELSE NULL::text END$a$;
  old_m1 text := $a$'Acceptation bloquée : documents obligatoires manquants (%) ou non conformes (%). Compléter la checklist ou obtenir une dérogation BM.',$a$;
  old_m2 text := $a$coalesce(array_to_string(v_missing, ', '),'-'), coalesce(array_to_string(v_bad, ', '),'-') using errcode = '42501';$a$;
  new_m1 text := $a$'Acceptation bloquée : %. Compléter la checklist ou obtenir une dérogation BM.',$a$;
  new_m2 text := $a$concat_ws(' ; ', case when coalesce(cardinality(v_missing),0)>0 then 'documents obligatoires manquants : '||array_to_string(v_missing, ', ') end, case when coalesce(cardinality(v_bad),0)>0 then 'documents obligatoires non conformes : '||array_to_string(v_bad, ', ') end, case when coalesce(cardinality(v_missing),0)=0 and coalesce(cardinality(v_bad),0)=0 then 'checklist documentaire incomplète' end) using errcode = '42501';$a$;
begin
  v := pg_get_viewdef('public.wms_v_receptions'::regclass);
  if position('vb.location_type' in v) = 0 then
    if position(old_na in v) = 0 then raise exception 'Ancre next_action introuvable dans wms_v_receptions'; end if;
    execute 'create or replace view public.wms_v_receptions with (security_invoker = true) as ' || replace(v, old_na, new_na);
  end if;
  f := pg_get_functiondef('public.wms_decide_reception(text,boolean,text)'::regprocedure);
  if position('checklist documentaire incomplète' in f) = 0 then
    if position(old_m1 in f) = 0 or position(old_m2 in f) = 0 then raise exception 'Ancre du message documentaire introuvable'; end if;
    execute replace(replace(f, old_m1, new_m1), old_m2, new_m2);
  end if;
end $mig$;
