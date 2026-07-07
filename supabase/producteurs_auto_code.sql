-- FBMS Producteurs: attribution automatique du code producteur
-- Objectif: chaque producteur enrôlé reçoit un code court par village.

create or replace function public.fbms_slug4(txt text)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(
      translate(upper(coalesce(txt,'')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸÆŒ', 'AAAAAACEEEEIIIINOOOOOUUUUYYAO'),
      '[^A-Z0-9]+', '', 'g'
    ) || 'XXXX',
    4
  )
$$;

create or replace function public.next_producteur_code(p_village_id text, p_village_nom text)
returns text
language plpgsql
as $$
declare
  n integer;
  prefix text;
begin
  prefix := public.fbms_slug4(coalesce(p_village_nom, 'VIL'));
  insert into public.prod_code_seq(village_id, dernier)
  values (p_village_id, 1)
  on conflict (village_id)
  do update set dernier = public.prod_code_seq.dernier + 1
  returning dernier into n;
  return prefix || '-' || lpad(n::text, 4, '0');
end;
$$;

create or replace function public.set_producteur_code()
returns trigger
language plpgsql
as $$
declare
  vnom text;
begin
  if new.code is null or trim(new.code) = '' then
    select coalesce(v.village, v.data->'s1'->>'village', new.village_nom)
      into vnom
    from public.villages v
    where v.id = new.village_id;
    new.code := public.next_producteur_code(new.village_id, coalesce(vnom, new.village_nom));
  end if;

  if new.village_nom is null or trim(new.village_nom) = '' then
    select coalesce(v.village, v.data->'s1'->>'village')
      into new.village_nom
    from public.villages v
    where v.id = new.village_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_producteur_code on public.producteurs;
create trigger trg_set_producteur_code
before insert or update on public.producteurs
for each row execute function public.set_producteur_code();

alter table public.achats alter column village_id type text using village_id::text;