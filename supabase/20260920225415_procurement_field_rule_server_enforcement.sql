
begin;
alter table public.achats add column if not exists campaign text;
alter table public.achats drop constraint if exists achats_commission_coherente_chk;

create or replace function public.procurement_apply_field_purchase_rule()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.procurement_campaign_rules;
  v_campaign text;
  v_expected_comm numeric;
begin
  if coalesce(new.saisie_mode,'') not in ('OPERATIONS_FIELD_BUYING','TEST') then return new; end if;

  v_campaign:=nullif(btrim(new.campaign),'');
  if v_campaign is null then
    select pr.campaign into v_campaign
    from public.procurement_campaign_rules pr
    where pr.channel_code='FIELD_BUYING' and pr.status='ACTIVE'
      and pr.effective_from<=coalesce(new.date,current_date)
      and (pr.effective_to is null or pr.effective_to>=coalesce(new.date,current_date))
    order by (pr.zone_code is not null and upper(pr.zone_code)=upper(coalesce(new.cluster,''))) desc,
             pr.effective_from desc,pr.created_at desc
    limit 1;
  end if;
  if v_campaign is null then raise exception 'Aucune campagne/règle Procurement active pour cet achat'; end if;
  new.campaign:=v_campaign;

  select * into r
  from public.procurement_campaign_rules pr
  where pr.campaign=v_campaign and pr.channel_code='FIELD_BUYING' and pr.status='ACTIVE'
    and pr.effective_from<=coalesce(new.date,current_date)
    and (pr.effective_to is null or pr.effective_to>=coalesce(new.date,current_date))
    and (pr.zone_code is null or upper(pr.zone_code)=upper(coalesce(new.cluster,'')))
  order by (pr.zone_code is not null) desc,pr.effective_from desc,pr.created_at desc
  limit 1;
  if r.id is null then raise exception 'Règle Procurement FIELD_BUYING absente pour campagne %',v_campaign; end if;

  if new.weight_source is null then raise exception 'Weight Source obligatoire (SCALE / ESTIMATED / BAG_STANDARD)'; end if;

  if r.rt_commission_per_kg is not null then
    v_expected_comm:=round(new.poids_net*r.rt_commission_per_kg,0);
    if new.commission_rt is null then new.commission_rt:=v_expected_comm;
    elsif abs(new.commission_rt-v_expected_comm)>1 then
      raise exception 'Commission RT incohérente avec la règle active: attendu %, reçu %',v_expected_comm,new.commission_rt;
    end if;
  end if;

  if r.price_per_kg is not null then
    new.prix_hors_bareme:=abs(new.prix_kg-r.price_per_kg)>0.001;
    if new.prix_hors_bareme and nullif(btrim(coalesce(new.motif_prix,'')),'') is null then
      raise exception 'Prix hors barème: motif obligatoire';
    end if;
  end if;

  if new.humidite is not null and r.max_moisture_pct is not null and new.humidite>r.max_moisture_pct then
    new.qualite_statut:='À sécher';
  elsif new.kor is not null and r.min_kor is not null and new.kor<r.min_kor then
    new.qualite_statut:='À trier';
  elsif new.humidite is not null or new.kor is not null then
    new.qualite_statut:='OK';
  end if;

  if new.prix_hors_bareme then new.statut_validation:='Validation BM requise';
  elsif coalesce(new.qualite_statut,'OK')<>'OK' then new.statut_validation:='À contrôler';
  elsif new.statut_validation is null then new.statut_validation:='À valider';
  end if;
  return new;
end $$;

drop trigger if exists trg_procurement_apply_field_purchase_rule on public.achats;
create trigger trg_procurement_apply_field_purchase_rule
before insert or update of campaign,date,cluster,poids_net,prix_kg,commission_rt,humidite,kor,weight_source,motif_prix
on public.achats
for each row execute function public.procurement_apply_field_purchase_rule();

commit;