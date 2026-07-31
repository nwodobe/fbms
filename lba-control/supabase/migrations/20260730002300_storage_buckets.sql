-- =============================================================================
-- LBA Control · 2300 · Buckets de fichiers et cloisonnement des objets
-- =============================================================================
-- Deux buckets, tous deux PRIVÉS :
--
--   · `preuves` — tickets de pesée, justificatifs de dépense, preuves d'achat.
--     Ils contiennent des montants, des noms de vendeurs, des plaques de camion.
--     Un bucket public exposerait tout cela à qui devine une URL.
--
--   · `marque` — logos et images de connexion. Moins sensibles, mais privés
--     aussi : le logo d'un client révèle qui est client.
--
-- Le cloisonnement repose sur le **chemin** : chaque objet est rangé sous
-- `<tenant_id>/…`, et la politique compare ce premier segment au tenant du
-- jeton. Un nom de fichier plat serait incloisonnable.
--
-- ⚠ Ce fichier suppose le schéma `storage` de Supabase. Il est ignoré par la
-- base locale de test, qui n'héberge pas Storage — la garde ci-dessous le rend
-- inoffensif dans les deux environnements.
-- =============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Schéma storage absent (base locale) : buckets et politiques non appliqués.';
    return;
  end if;

  -- Buckets ------------------------------------------------------------------
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('preuves', 'preuves', false, 8388608,
     array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    ('marque', 'marque', false, 1048576,
     array['image/png', 'image/webp', 'image/svg+xml'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Politiques ---------------------------------------------------------------
  -- Le premier segment du chemin porte le tenant. `storage.foldername(name)`
  -- renvoie les segments ; comparer `[1]` au tenant du jeton cloisonne les
  -- objets exactement comme RLS cloisonne les lignes.

  execute $policy$
    drop policy if exists proofs_read on storage.objects;
    create policy proofs_read on storage.objects
      for select to authenticated
      using (
        bucket_id in ('preuves', 'marque')
        and (storage.foldername(name))[1] = app.current_tenant_id()::text
      );
  $policy$;

  execute $policy$
    drop policy if exists proofs_write on storage.objects;
    create policy proofs_write on storage.objects
      for insert to authenticated
      with check (
        bucket_id in ('preuves', 'marque')
        and (storage.foldername(name))[1] = app.current_tenant_id()::text
        -- Un abonnement suspendu ne dépose plus de fichier, comme il n'écrit
        -- plus de ligne. La lecture et l'export restent ouverts.
        and app.tenant_can_write()
      );
  $policy$;

  execute $policy$
    drop policy if exists proofs_update on storage.objects;
    create policy proofs_update on storage.objects
      for update to authenticated
      using (
        bucket_id in ('preuves', 'marque')
        and (storage.foldername(name))[1] = app.current_tenant_id()::text
        and app.tenant_can_write()
      );
  $policy$;

  -- Suppression refusée, comme pour les transactions métier : un justificatif
  -- effacé après coup est précisément celui qu'un contrôleur voudra voir.
  execute $policy$
    drop policy if exists proofs_delete on storage.objects;
    create policy proofs_delete on storage.objects
      for delete to authenticated
      using (false);
  $policy$;

  raise notice 'Buckets « preuves » et « marque » créés ou mis à jour, politiques appliquées.';
end
$$;

-- -----------------------------------------------------------------------------
-- Exigence d'un justificatif sur les montants importants
-- -----------------------------------------------------------------------------
-- Le seuil vit déjà dans `expense_categories.requires_receipt_above` mais n'était
-- lu par personne : la règle existait en donnée, pas en comportement.

create or replace function app.enforce_expense_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_threshold numeric;
  v_label     text;
begin
  -- Contrôlé à la validation seulement : un brouillon se saisit sur le terrain,
  -- la pièce est jointe au bureau. Exiger le justificatif dès la saisie
  -- empêcherait le pisteur d'enregistrer une dépense réelle.
  -- `old.status` est une énumération : la comparer à '' échouerait à
  -- l'exécution, pas à la compilation.
  if new.status <> 'validee' or old.status = 'validee' then
    return new;
  end if;

  select ec.requires_receipt_above, ec.label into v_threshold, v_label
  from public.expense_categories ec where ec.id = new.category_id;

  if v_threshold is not null and new.amount > v_threshold and new.proof_path is null then
    raise exception
      'La catégorie « % » exige un justificatif au-delà de % FCFA. Joignez la pièce avant de valider.',
      v_label, trim_scale(v_threshold)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger expenses_receipt_guard
  before update on public.expenses
  for each row execute function app.enforce_expense_receipt();

comment on function app.enforce_expense_receipt() is
  'Applique expense_categories.requires_receipt_above à la VALIDATION, pas à la saisie : un pisteur '
  'doit pouvoir enregistrer une dépense réelle depuis le terrain, la pièce étant jointe au bureau.';
