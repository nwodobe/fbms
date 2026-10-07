-- Multi-campagnes · 4/4 — suppression définitive d'une campagne DEMO / SIMULATION / TRAINING / QA.
--
-- Séparée des migrations 1 à 3 : c'est la seule qui supprime des lignes. Elle n'est appliquée qu'après validation
-- explicite de la direction (l'outil d'application des migrations demande une confirmation humaine pour toute
-- instruction de suppression). Tant qu'elle n'est pas appliquée, l'écran Campagnes propose l'analyse de suppression
-- (aucune suppression) et l'export, et indique que la suppression attend cette validation.
--
-- Règles : jamais une campagne REAL ; confirmation forte « SUPPRIMER <TYPE> <CODE> » ; motif obligatoire ; ordre de
-- suppression du registre private.campaign_scoped_tables (lignes filles d'abord) ; référentiels permanents jamais
-- touchés ; producteurs / coopératives marqués is_qa pour cette campagne supprimés seulement sur option et s'ils ne
-- sont plus référencés ailleurs ; événement SIMULATION_DELETED journalisé avec les comptages.

-- Codes alphanumériques (RCN-2028, SIM-2027) : le registre historique procurement_campaigns n'acceptait que des années.
alter table public.procurement_campaigns drop constraint if exists procurement_campaigns_code_check;
alter table public.procurement_campaigns add constraint procurement_campaigns_code_check check (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$');

-- Suppression définitive d'une campagne non REAL : données de campagne uniquement. Les référentiels permanents ne
-- sont jamais supprimés ; les producteurs / coopératives explicitement marqués QA pour cette campagne ne le sont
-- que si l'option est cochée, et seulement s'ils ne sont plus référencés ailleurs.
create or replace function public.campaign_purge(p_id uuid, p_confirm text, p_reason text, p_include_qa_masters boolean default false)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); r record; v bigint; counts jsonb := '{}'::jsonb; kept jsonb := '[]'::jsonb;
        v_expected text; q record; v_role text; v_next uuid;
begin
  v_role := private.campaign_require(array['Branch Manager','General Manager']);
  if c.campaign_type = 'REAL' then
    raise exception 'Une campagne réelle ne se supprime jamais : clôturez-la puis archivez-la.' using errcode = '42501';
  end if;
  v_expected := 'SUPPRIMER ' || private.campaign_type_fr(c.campaign_type) || ' ' || c.code;
  if upper(btrim(coalesce(p_confirm,''))) <> v_expected then
    raise exception 'Confirmation invalide : saisissez exactement « % ».', v_expected using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'Motif obligatoire (10 caractères minimum).' using errcode = '23514'; end if;

  perform set_config('aflp.campaign_purge', p_id::text, true);
  for r in select * from private.campaign_scoped_tables order by purge_rank loop
    execute format('delete from public.%I where %s', r.table_name, r.predicate) using p_id;
    get diagnostics v = row_count;
    if v > 0 then counts := counts || jsonb_build_object(r.table_name, v); end if;
  end loop;

  if p_include_qa_masters then
    for q in select id, code from public.aflp_cooperatives where is_qa and qa_campaign_id = p_id loop
      begin
        delete from public.aflp_coop_contacts where cooperative_id = q.id;
        delete from public.aflp_coop_villages where cooperative_id = q.id;
        delete from public.aflp_coop_documents where cooperative_id = q.id;
        delete from public.aflp_coop_sections where cooperative_id = q.id;
        delete from public.aflp_coop_collection_points where cooperative_id = q.id;
        delete from public.aflp_cooperatives where id = q.id;
        counts := counts || jsonb_build_object('aflp_cooperatives_qa', coalesce((counts->>'aflp_cooperatives_qa')::int,0) + 1);
      exception when foreign_key_violation then
        kept := kept || jsonb_build_object('type','COOPERATIVE','code', q.code, 'raison', 'encore référencée par une autre campagne');
      end;
    end loop;
    for q in select id, code from public.producteurs where is_qa and qa_campaign_id = p_id loop
      begin
        delete from public.aflp_producer_enrollment where producer_id = q.id;
        delete from public.farmer_consents where producteur_id = q.id;
        delete from public.farmer_identity_documents where producteur_id = q.id;
        delete from public.farmer_visits where producteur_id = q.id;
        delete from public.farmer_verifications where producteur_id = q.id;
        delete from public.farmer_action_plans where producteur_id = q.id;
        delete from public.farmer_plots where producteur_id = q.id;
        delete from public.producteurs where id = q.id;
        counts := counts || jsonb_build_object('producteurs_qa', coalesce((counts->>'producteurs_qa')::int,0) + 1);
      exception when foreign_key_violation then
        kept := kept || jsonb_build_object('type','PRODUCTEUR','code', q.code, 'raison', 'encore référencé par une autre campagne');
      end;
    end loop;
  end if;

  select count(*) into v from public.campaign_participants where campaign_id = p_id; if v > 0 then counts := counts || jsonb_build_object('campaign_participants', v); end if;
  select count(*) into v from public.campaign_targets where campaign_id = p_id; if v > 0 then counts := counts || jsonb_build_object('campaign_targets', v); end if;
  select count(*) into v from public.producer_campaigns where campaign_id = p_id; if v > 0 then counts := counts || jsonb_build_object('producer_campaigns', v); end if;
  select count(*) into v from public.campaign_snapshots where campaign_id = p_id; if v > 0 then counts := counts || jsonb_build_object('campaign_snapshots', v); end if;

  insert into public.campaign_events (campaign_id, campaign_code, event, actor, actor_email, actor_role, reason, before, details)
  values (p_id, c.code, 'SIMULATION_DELETED', auth.uid(), public.fbms_email(), v_role, btrim(p_reason), to_jsonb(c),
          jsonb_build_object('deleted', counts, 'kept_masters', kept, 'include_qa_masters', p_include_qa_masters));

  update public.producteurs set qa_campaign_id = null where qa_campaign_id = p_id;
  update public.aflp_cooperatives set qa_campaign_id = null where qa_campaign_id = p_id;
  delete from public.campaigns where id = p_id;
  begin delete from public.procurement_campaigns where code = c.code and source = 'CAMPAIGNS';
  exception when foreign_key_violation then null; end;
  if c.is_current then
    select id into v_next from public.campaigns where status = 'OPEN' order by (campaign_type = 'REAL') desc, opened_at desc limit 1;
    if v_next is not null then update public.campaigns set is_current = true where id = v_next; end if;
  end if;
  perform set_config('aflp.campaign_purge', '', true);
  return jsonb_build_object('campaign', c.code, 'deleted', counts, 'kept_masters', kept, 'new_current', v_next);
end $$;


revoke execute on function public.campaign_purge(uuid, text, text, boolean) from public, anon;
grant execute on function public.campaign_purge(uuid, text, text, boolean) to authenticated;
