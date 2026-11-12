-- Multi-campagnes · 5 — remise à zéro ciblée de la SACHERIE et de la CAISSE d'une campagne non réelle.
--
-- Demandé par le Branch Manager le 12/11/2026. À appliquer uniquement sur sa validation explicite.
--
-- Différence avec campaign_purge (migration 4) : la campagne n'est PAS supprimée. Seules ses données de sacherie
-- (mouvements de sacs, sacs jute, inventaires, pertes, demandes de sacs) et de caisse (avances RT et achats bord
-- champ qui les consomment) sont effacées, avec leurs lignes filles. Missions, producteurs, villages, RT,
-- coopératives, objectifs et paramètres de la campagne sont conservés.
--
-- Règles : réservé au Branch Manager ; jamais une campagne REAL ; confirmation forte
-- « REMETTRE A ZERO <CODE> » ; motif obligatoire (10 caractères) ; ordre de suppression du registre
-- private.campaign_scoped_tables (lignes filles d'abord) ; événement SACHERIE_CAISSE_RESET journalisé
-- avec les comptages ; copie intégrale des lignes effacées conservée dans private.campaign_reset_backups.

alter table public.campaign_events drop constraint if exists campaign_events_event_check;
alter table public.campaign_events add constraint campaign_events_event_check check (event = any (array[
  'CAMPAIGN_CREATED','CAMPAIGN_CONFIG_UPDATED','CAMPAIGN_STATUS_CHANGED','CAMPAIGN_OPENED','CAMPAIGN_CURRENT_SET',
  'CAMPAIGN_CLOSING_STARTED','CAMPAIGN_CLOSED','CAMPAIGN_REOPENED','CAMPAIGN_ARCHIVED','SIMULATION_EXPORTED',
  'SIMULATION_DELETED','SACHERIE_CAISSE_RESET']));

-- Sauvegarde des lignes effacées : restaurables par un administrateur, illisibles depuis l'application.
create table if not exists private.campaign_reset_backups (
  id bigint generated always as identity primary key,
  campaign_id uuid not null,
  table_name text not null,
  ligne jsonb not null,
  reset_by uuid,
  reset_at timestamptz not null default now()
);
revoke all on private.campaign_reset_backups from public, anon, authenticated;

-- Périmètre : tables du registre de campagne qui relèvent de la sacherie ou de la caisse.
create or replace function private.campaign_reset_scope()
returns text[] language sql immutable as $$
  select array[
    -- filles des achats et des sacs
    'field_lot_contributors','field_purchase_sources','field_rcn_bags','wms_lot_procurement_contributors','ops_bag_releases',
    -- caisse
    'achats','avances',
    -- sacherie
    'sacs_mouvements','ops_bag_requests','bag_movement_requests',
    'rcn_jute_movements','rcn_jute_purchases','rcn_jute_transfers','rcn_jute_inventories',
    'rcn_jute_reconciliations','rcn_jute_loss_requests','rcn_jute_repairs'
  ]::text[]
$$;

create or replace function public.campaign_reset_sacherie_caisse_preview(p_id uuid)
returns table(object text, table_name text, n bigint)
language plpgsql stable security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); r record; v bigint;
begin
  perform private.campaign_require(array['Branch Manager']);
  if c.campaign_type = 'REAL' then
    raise exception 'Campagne réelle : la remise à zéro est interdite.' using errcode = '42501';
  end if;
  for r in select * from private.campaign_scoped_tables s where s.table_name = any (private.campaign_reset_scope()) order by purge_rank loop
    execute format('select count(*) from public.%I where %s', r.table_name, r.predicate) into v using p_id;
    if v > 0 then object := r.label_fr; table_name := r.table_name; n := v; return next; end if;
  end loop;
end $$;

create or replace function public.campaign_reset_sacherie_caisse(p_id uuid, p_confirm text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); r record; v bigint; counts jsonb := '{}'::jsonb;
        v_expected text; v_role text;
begin
  v_role := private.campaign_require(array['Branch Manager']);
  if c.campaign_type = 'REAL' then
    raise exception 'Campagne réelle : la remise à zéro est interdite. Les corrections passent par des contre-écritures.' using errcode = '42501';
  end if;
  v_expected := 'REMETTRE A ZERO ' || c.code;
  if upper(btrim(coalesce(p_confirm,''))) <> v_expected then
    raise exception 'Confirmation invalide : saisissez exactement « % ».', v_expected using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'Motif obligatoire (10 caractères minimum).' using errcode = '23514'; end if;

  perform set_config('aflp.campaign_purge', p_id::text, true);
  for r in select * from private.campaign_scoped_tables s where s.table_name = any (private.campaign_reset_scope()) order by purge_rank loop
    execute format('insert into private.campaign_reset_backups (campaign_id, table_name, ligne, reset_by)
                    select $1, %L, to_jsonb(t), auth.uid() from public.%I t where %s', r.table_name, r.table_name, r.predicate) using p_id;
    execute format('delete from public.%I where %s', r.table_name, r.predicate) using p_id;
    get diagnostics v = row_count;
    if v > 0 then counts := counts || jsonb_build_object(r.table_name, v); end if;
  end loop;
  perform set_config('aflp.campaign_purge', '', true);

  insert into public.campaign_events (campaign_id, campaign_code, event, actor, actor_email, actor_role, reason, before, details)
  values (p_id, c.code, 'SACHERIE_CAISSE_RESET', auth.uid(), public.fbms_email(), v_role, btrim(p_reason), to_jsonb(c),
          jsonb_build_object('deleted', counts));
  return jsonb_build_object('campaign', c.code, 'deleted', counts);
end $$;

revoke execute on function public.campaign_reset_sacherie_caisse_preview(uuid) from public, anon;
revoke execute on function public.campaign_reset_sacherie_caisse(uuid, text, text) from public, anon;
grant execute on function public.campaign_reset_sacherie_caisse_preview(uuid) to authenticated;
grant execute on function public.campaign_reset_sacherie_caisse(uuid, text, text) to authenticated;
