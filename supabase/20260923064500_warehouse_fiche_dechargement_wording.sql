-- Align Warehouse user-facing wording with the operational document name.
-- Technical columns delivery_note / delivery_note_present remain unchanged for backward compatibility.

do $$
declare
  d text;
begin
  select pg_get_functiondef('public.wms_create_reception(jsonb,text)'::regprocedure) into d;
  if d is null then
    raise exception 'wms_create_reception(jsonb,text) introuvable';
  end if;

  d := replace(
    d,
    'Numéro du bon de livraison obligatoire lorsque le document est indiqué présent',
    'Numéro de la fiche de déchargement obligatoire lorsque le document est indiqué présent'
  );

  execute d;
end $$;
