-- Multi-campagnes · 3c — règles d'une campagne saisies depuis l'assistant (étape « Règles »).
--
-- Prix, qualité (KOR minimum, humidité maximum) et commission RT de l'Achat Bord Champ : une seule règle ACTIVE
-- par campagne pour le canal FIELD_BUYING sans zone (mise à jour si elle existe, création sinon). Contrôle
-- « Mode A : RT de suivi obligatoire » : activé / désactivé par campagne. Modifiable tant que la campagne n'est pas
-- clôturée. Branch Manager ou General Manager. Aucune suppression.

create or replace function public.campaign_rule_set(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c public.campaigns := private.campaign_get(p_id); v_rule uuid; v_from date;
begin
  perform private.campaign_require(array['Branch Manager','General Manager']);
  if c.status in ('CLOSED','ARCHIVED') then
    raise exception 'Campagne % % : règles en lecture seule.', c.code, lower(private.campaign_status_fr(c.status)) using errcode = '42501';
  end if;
  if nullif(p->>'price_per_kg','') is null or (p->>'price_per_kg')::numeric <= 0 then
    raise exception 'Prix d''achat obligatoire (XOF/kg).' using errcode = '23514';
  end if;
  v_from := coalesce(nullif(p->>'effective_from','')::date, c.start_date, make_date(c.year, 1, 1));
  select id into v_rule from public.procurement_campaign_rules
   where campaign_id = p_id and channel_code = 'FIELD_BUYING' and zone_code is null and status = 'ACTIVE'
   order by effective_from desc limit 1;
  if v_rule is null then
    insert into public.procurement_campaign_rules (campaign, campaign_id, channel_code, status, effective_from, price_per_kg, min_kor,
                                                   max_moisture_pct, rt_commission_per_kg, source, reason, created_by)
    values (c.code, p_id, 'FIELD_BUYING', 'ACTIVE', v_from, (p->>'price_per_kg')::numeric, nullif(p->>'min_kor','')::numeric,
            nullif(p->>'max_moisture_pct','')::numeric, nullif(p->>'rt_commission_per_kg','')::numeric, 'CAMPAIGN_WIZARD',
            coalesce(nullif(btrim(p->>'reason'),''), 'Règle saisie dans l''assistant Campagnes'), auth.uid())
    returning id into v_rule;
  else
    update public.procurement_campaign_rules set price_per_kg = (p->>'price_per_kg')::numeric,
      min_kor = nullif(p->>'min_kor','')::numeric, max_moisture_pct = nullif(p->>'max_moisture_pct','')::numeric,
      rt_commission_per_kg = nullif(p->>'rt_commission_per_kg','')::numeric, effective_from = v_from,
      reason = coalesce(nullif(btrim(p->>'reason'),''), reason), updated_at = now()
    where id = v_rule;
  end if;
  if p ? 'mode_a_rt_required' then
    insert into public.aflp_campaign_controls (campaign, campaign_id, control_code, enabled, nature, description, decision_note, updated_by)
    values (c.code, p_id, 'COOP_MODE_A_RT_REQUIRED', (p->>'mode_a_rt_required')::boolean, 'TEMPORAIRE',
            'Achat individuel d''un membre de coopérative (mode A) : RT de suivi obligatoire pour le contrôle de caisse.',
            'Saisi dans l''assistant Campagnes', auth.uid())
    on conflict (campaign, control_code) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform private.campaign_log(p_id, 'CAMPAIGN_CONFIG_UPDATED', null, null, null,
    jsonb_build_object('regles', p - 'reason', 'rule_id', v_rule));
  return jsonb_build_object('rule_id', v_rule);
end $$;

revoke execute on function public.campaign_rule_set(uuid, jsonb) from public, anon;
grant execute on function public.campaign_rule_set(uuid, jsonb) to authenticated;
