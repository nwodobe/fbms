begin;

-- Isoler les donnees de test evidentes sans supprimer l'historique.
update public.producteurs p
set deleted = true,
    operational_status = 'INACTIVE',
    statut = 'INACTIF',
    updated_at = now()
where not p.deleted
  and p.code like 'SESSEN-%'
  and upper(coalesce(p.nom,'')) like 'TEST %';

-- Separer l'ID technique et le Farmer ID lisible.
alter table public.achats add column if not exists producteur_code text;
alter table public.sacs_mouvements add column if not exists producteur_code text;

create index if not exists idx_achats_producteur_id on public.achats(producteur_id) where producteur_id is not null;
create index if not exists idx_achats_producteur_code on public.achats(producteur_code) where producteur_code is not null;
create index if not exists idx_sacs_mouvements_producteur_id on public.sacs_mouvements(producteur_id) where producteur_id is not null;
create index if not exists idx_sacs_mouvements_producteur_code on public.sacs_mouvements(producteur_code) where producteur_code is not null;

-- Canonicaliser tout achat reference vers producteurs.id.
create or replace function public.fbms_achat_canonicaliser_producteur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.producteurs%rowtype;
  v_village text;
  v_cluster text;
  v_rt_nom text;
begin
  if new.producteur_id is null or btrim(new.producteur_id) = '' then
    new.producteur_id := null;
    new.producteur_code := null;
    return new;
  end if;

  select p.* into v_p
  from public.producteurs p
  where not p.deleted
    and (p.id = new.producteur_id or p.code = new.producteur_id)
  order by case when p.id = new.producteur_id then 0 else 1 end
  limit 1;

  if v_p.id is null then
    raise exception 'Producteur inconnu ou inactif: %', new.producteur_id;
  end if;

  new.producteur_id := v_p.id;
  new.producteur_code := v_p.code;
  new.producteur_nom := v_p.nom;
  new.producteur_tel := v_p.telephone;
  new.producteur_ref := true;
  new.producteur_statut := 'Référencé';
  new.village_id := v_p.village_id;

  select v.village, v.cluster
    into v_village, v_cluster
  from public.villages v
  where v.id = v_p.village_id and not v.deleted;

  if v_village is null then
    raise exception 'Village du producteur introuvable ou inactif: %', v_p.village_id;
  end if;

  new.village_nom := upper(v_village);
  new.cluster := upper(v_cluster);

  if v_p.rt_id is not null then
    new.rt_id := v_p.rt_id;
    select r.nom into v_rt_nom from public.rt r where r.id = v_p.rt_id and not r.deleted limit 1;
    if v_rt_nom is null then
      raise exception 'RT du producteur introuvable ou inactif: %', v_p.rt_id;
    end if;
    new.rt_nom := upper(v_rt_nom);
  end if;

  return new;
end;
$$;

revoke all on function public.fbms_achat_canonicaliser_producteur() from public, anon, authenticated;

drop trigger if exists trg_achats_canonicaliser_producteur on public.achats;
create trigger trg_achats_canonicaliser_producteur
before insert or update of producteur_id on public.achats
for each row execute function public.fbms_achat_canonicaliser_producteur();

-- Meme canonicalisation pour la sacherie.
create or replace function public.fbms_sacs_canonicaliser_producteur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.producteurs%rowtype;
  v_village text;
  v_cluster text;
  v_rt_nom text;
begin
  if new.producteur_id is null or btrim(new.producteur_id) = '' then
    new.producteur_id := null;
    new.producteur_code := null;
    return new;
  end if;

  select p.* into v_p
  from public.producteurs p
  where not p.deleted
    and (p.id = new.producteur_id or p.code = new.producteur_id)
  order by case when p.id = new.producteur_id then 0 else 1 end
  limit 1;

  if v_p.id is null then
    raise exception 'Producteur inconnu ou inactif: %', new.producteur_id;
  end if;

  new.producteur_id := v_p.id;
  new.producteur_code := v_p.code;
  new.producteur_nom := v_p.nom;
  new.village_id := v_p.village_id;

  select v.village, v.cluster
    into v_village, v_cluster
  from public.villages v
  where v.id = v_p.village_id and not v.deleted;

  if v_village is null then
    raise exception 'Village du producteur introuvable ou inactif: %', v_p.village_id;
  end if;

  new.village_nom := upper(v_village);
  new.cluster := upper(v_cluster);

  if v_p.rt_id is not null then
    new.rt_id := v_p.rt_id;
    select r.nom into v_rt_nom from public.rt r where r.id = v_p.rt_id and not r.deleted limit 1;
    if v_rt_nom is null then
      raise exception 'RT du producteur introuvable ou inactif: %', v_p.rt_id;
    end if;
    new.rt_nom := upper(v_rt_nom);
  end if;

  return new;
end;
$$;

revoke all on function public.fbms_sacs_canonicaliser_producteur() from public, anon, authenticated;

drop trigger if exists trg_sacs_canonicaliser_producteur on public.sacs_mouvements;
create trigger trg_sacs_canonicaliser_producteur
before insert or update of producteur_id on public.sacs_mouvements
for each row execute function public.fbms_sacs_canonicaliser_producteur();

-- FK techniques: les triggers convertissent les anciens codes lisibles avant validation.
alter table public.achats drop constraint if exists achats_producteur_id_fkey;
alter table public.achats
  add constraint achats_producteur_id_fkey
  foreign key (producteur_id) references public.producteurs(id)
  on update restrict on delete restrict
  not valid;
alter table public.achats validate constraint achats_producteur_id_fkey;

alter table public.sacs_mouvements drop constraint if exists sacs_mouvements_producteur_id_fkey;
alter table public.sacs_mouvements
  add constraint sacs_mouvements_producteur_id_fkey
  foreign key (producteur_id) references public.producteurs(id)
  on update restrict on delete restrict
  not valid;
alter table public.sacs_mouvements validate constraint sacs_mouvements_producteur_id_fkey;

-- Regles minimales posees NOT VALID ici puis finalisees par la migration suivante,
-- afin de ne pas rendre les anciennes donnees de test bloquantes.
alter table public.producteurs drop constraint if exists producteurs_phone_format_ck;
alter table public.producteurs add constraint producteurs_phone_format_ck
check (
  telephone is null
  or btrim(telephone) = ''
  or regexp_replace(telephone, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
) not valid;

alter table public.producteurs drop constraint if exists producteurs_nom_no_html_ck;
alter table public.producteurs add constraint producteurs_nom_no_html_ck
check (
  coalesce(nom,'') !~ '[<>]'
  and coalesce(prenoms,'') !~ '[<>]'
) not valid;

commit;
