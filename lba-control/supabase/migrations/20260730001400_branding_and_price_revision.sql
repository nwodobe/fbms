-- =============================================================================
-- LBA Control · 1400 · Validation serveur de la marque et révision de prix
-- =============================================================================
-- Phase 2. Deux règles qui ne peuvent pas rester côté client seulement :
--
--  1. Le contraste des couleurs de marque. Le formulaire le vérifie déjà, mais
--     ces couleurs finissent sur les PDF, les bons de transfert et les reçus —
--     des documents qui sortent de l'entreprise. Un appel direct à l'API ne doit
--     pas pouvoir contourner le contrôle.
--
--  2. La révision d'un prix. Clore l'ancienne version et créer la nouvelle sont
--     deux écritures : si la première réussit et la seconde échoue, le contrat
--     se retrouve sans prix applicable. Une seule transaction serveur.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Contraste WCAG 2.1 en SQL
-- -----------------------------------------------------------------------------

create or replace function app.hex_channel(p_hex text, p_offset integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select ('x' || substr(p_hex, p_offset, 2))::bit(8)::integer;
$$;

create or replace function app.relative_luminance(p_hex text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, app
as $$
declare
  v_channels numeric[] := array[]::numeric[];
  v_raw      numeric;
  v_offset   integer;
begin
  if p_hex !~* '^#[0-9a-f]{6}$' then
    raise exception 'Couleur hexadécimale invalide : %', p_hex using errcode = 'check_violation';
  end if;

  foreach v_offset in array array[2, 4, 6] loop
    v_raw := app.hex_channel(p_hex, v_offset)::numeric / 255;
    v_channels := v_channels || case
      when v_raw <= 0.03928 then v_raw / 12.92
      else power((v_raw + 0.055) / 1.055, 2.4)
    end;
  end loop;

  return 0.2126 * v_channels[1] + 0.7152 * v_channels[2] + 0.0722 * v_channels[3];
end;
$$;

create or replace function app.contrast_ratio(p_a text, p_b text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, app
as $$
declare
  l1 numeric := app.relative_luminance(p_a);
  l2 numeric := app.relative_luminance(p_b);
  lighter numeric := greatest(l1, l2);
  darker  numeric := least(l1, l2);
begin
  return round((lighter + 0.05) / (darker + 0.05), 2);
end;
$$;

-- Distance perceptuelle « redmean ». Le rapport de contraste ne convient pas
-- pour comparer deux couleurs de marque entre elles : un vert forêt et un brun
-- ont une luminance proche tout en restant parfaitement distinguables.
create or replace function app.color_distance(p_a text, p_b text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, app
as $$
declare
  r1 integer := app.hex_channel(p_a, 2); g1 integer := app.hex_channel(p_a, 4); b1 integer := app.hex_channel(p_a, 6);
  r2 integer := app.hex_channel(p_b, 2); g2 integer := app.hex_channel(p_b, 4); b2 integer := app.hex_channel(p_b, 6);
  r_mean numeric := (r1 + r2)::numeric / 2;
begin
  -- sqrt() renvoie un double precision : sans le cast, round(x, 2) ne trouve
  -- pas de signature correspondante.
  return round(
    sqrt(
      (2 + r_mean / 256) * power((r1 - r2)::numeric, 2)
      + 4 * power((g1 - g2)::numeric, 2)
      + (2 + (255 - r_mean) / 256) * power((b1 - b2)::numeric, 2)
    )::numeric, 2);
end;
$$;

-- -----------------------------------------------------------------------------
-- Validation de la paire de couleurs
-- -----------------------------------------------------------------------------
-- Miroir exact de src/domain/contrast.ts. Les seuils sont volontairement en dur
-- et non configurables : un client ne doit pas pouvoir « désactiver » la
-- lisibilité de sa propre application.

create or replace function app.validate_brand_colors(p_primary text, p_secondary text)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, app
as $$
declare
  v_issues     text[] := array[]::text[];
  v_ratios     numeric[] := array[]::numeric[];
  v_surfaces   numeric[] := array[]::numeric[];
  v_color      text;
  v_label      text;
  v_text_ratio numeric;
  v_surface    numeric;
  v_distance   numeric;
  v_index      integer := 0;
begin
  if p_primary !~* '^#[0-9a-f]{6}$' then
    v_issues := v_issues || format('La couleur principale « %s » n''est pas un code hexadécimal valide.', p_primary);
  end if;
  if p_secondary !~* '^#[0-9a-f]{6}$' then
    v_issues := v_issues || format('La couleur secondaire « %s » n''est pas un code hexadécimal valide.', p_secondary);
  end if;

  if array_length(v_issues, 1) > 0 then
    return jsonb_build_object('accepted', false, 'issues', to_jsonb(v_issues));
  end if;

  foreach v_color in array array[p_primary, p_secondary] loop
    v_index := v_index + 1;
    v_label := case when v_index = 1 then 'principale' else 'secondaire' end;

    -- Meilleur des deux textes possibles : imposer du blanc sur un fond clair
    -- serait un faux problème.
    v_text_ratio := greatest(app.contrast_ratio(v_color, '#ffffff'), app.contrast_ratio(v_color, '#111111'));
    v_surface    := app.contrast_ratio(v_color, '#ffffff');

    v_ratios   := v_ratios || v_text_ratio;
    v_surfaces := v_surfaces || v_surface;

    if v_text_ratio < 4.5 then
      v_issues := v_issues || format(
        'Couleur %s « %s » : contraste de %s:1 avec le texte, inférieur au minimum WCAG AA de 4,5:1.',
        v_label, v_color, v_text_ratio);
    end if;

    if v_surface < 3 then
      v_issues := v_issues || format(
        'Couleur %s « %s » : contraste de %s:1 avec le fond de l''application, inférieur au minimum de 3:1.',
        v_label, v_color, v_surface);
    end if;
  end loop;

  v_distance := app.color_distance(p_primary, p_secondary);
  if v_distance < 40 then
    v_issues := v_issues || format(
      'Les deux couleurs sont trop proches l''une de l''autre (distance de %s, minimum 40).', round(v_distance));
  end if;

  return jsonb_build_object(
    'accepted', coalesce(array_length(v_issues, 1), 0) = 0,
    'issues', to_jsonb(v_issues),
    'primary_contrast_ratio', v_ratios[1],
    'secondary_contrast_ratio', v_ratios[2],
    'primary_surface_ratio', v_surfaces[1],
    'secondary_surface_ratio', v_surfaces[2]
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Garde-fou sur tenant_branding
-- -----------------------------------------------------------------------------
-- Appliqué à TOUTE écriture, y compris un appel direct à l'API qui n'aurait pas
-- traversé le formulaire.

create or replace function app.enforce_brand_contrast()
returns trigger
language plpgsql
set search_path = pg_catalog, app, public
as $$
declare
  v_result jsonb;
begin
  v_result := app.validate_brand_colors(new.primary_color, new.secondary_color);

  if not (v_result ->> 'accepted')::boolean then
    raise exception 'Couleurs de marque refusées : %',
      array_to_string(array(select jsonb_array_elements_text(v_result -> 'issues')), ' ')
      using errcode = 'check_violation';
  end if;

  -- La mesure est conservée : un refus comme une acceptation doivent être
  -- justifiables après coup.
  new.primary_contrast_ratio   := (v_result ->> 'primary_contrast_ratio')::numeric;
  new.secondary_contrast_ratio := (v_result ->> 'secondary_contrast_ratio')::numeric;

  return new;
end;
$$;

create trigger tenant_branding_contrast_guard
  before insert or update on public.tenant_branding
  for each row execute function app.enforce_brand_contrast();

-- -----------------------------------------------------------------------------
-- Révision de prix · transactionnelle
-- -----------------------------------------------------------------------------

create or replace function app.revise_price(
  p_contract_id   uuid,
  p_price_type    price_type,
  p_price         numeric,
  p_valid_from    date,
  p_justification text,
  p_is_provisional boolean default false,
  p_proof_path    text default null
)
returns negotiated_prices
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_contract public.contracts;
  v_current  public.negotiated_prices;
  v_version  integer;
  v_new      public.negotiated_prices;
begin
  if length(btrim(coalesce(p_justification, ''))) < 10 then
    raise exception 'Une justification explicite est obligatoire pour créer ou réviser un prix.'
      using errcode = 'check_violation';
  end if;

  if p_price is null or p_price <= 0 then
    raise exception 'Le prix doit être strictement positif.' using errcode = 'check_violation';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Contrat introuvable.' using errcode = 'no_data_found';
  end if;

  if v_contract.tenant_id <> app.current_tenant_id() then
    raise exception 'Contrat hors du périmètre de votre entreprise.' using errcode = 'insufficient_privilege';
  end if;

  if not app.tenant_can_write(v_contract.tenant_id) then
    raise exception 'La saisie est désactivée : abonnement suspendu.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_role('proprietaire', 'gestionnaire') then
    raise exception 'Seuls le propriétaire et le gestionnaire peuvent réviser un prix.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Version en vigueur à la date d'effet demandée, s'il y en a une.
  select * into v_current
  from public.negotiated_prices np
  where np.contract_id = p_contract_id
    and np.price_type = p_price_type
    and np.valid_from <= p_valid_from
    and (np.valid_to is null or np.valid_to >= p_valid_from)
  order by np.valid_from desc, np.version desc
  limit 1
  for update;

  select coalesce(max(version), 0) + 1 into v_version
  from public.negotiated_prices
  where contract_id = p_contract_id and price_type = p_price_type;

  if v_current.id is null then
    -- Aucune version ne couvre la date d'effet. Reste à vérifier qu'on
    -- n'essaie pas de glisser un prix AVANT des versions existantes : cela
    -- revaloriserait des opérations déjà enregistrées, et la contrainte
    -- d'exclusion ne rendrait qu'un message incompréhensible.
    if exists (
      select 1 from public.negotiated_prices
      where contract_id = p_contract_id
        and price_type = p_price_type
        and valid_from > p_valid_from
    ) then
      raise exception
        'La date d''effet (%) précède une version de prix déjà enregistrée. Un prix ne peut pas '
        'être inséré rétroactivement : les opérations déjà valorisées changeraient de valeur.',
        p_valid_from
        using errcode = 'check_violation';
    end if;
  else
    if v_current.valid_from >= p_valid_from then
      raise exception
        'La date d''effet (%) doit être postérieure au début de la version en cours (%). '
        'Un prix ne peut pas être remplacé rétroactivement : les opérations déjà valorisées '
        'changeraient de valeur.', p_valid_from, v_current.valid_from
        using errcode = 'check_violation';
    end if;

    -- On CLÔT l'ancienne version, on ne modifie ni son prix ni sa date d'effet.
    update public.negotiated_prices
       set valid_to = p_valid_from - 1
     where id = v_current.id;
  end if;

  insert into public.negotiated_prices
    (tenant_id, contract_id, price_type, price, valid_from, valid_to,
     justification, proof_path, version, is_provisional, created_by)
  values
    (v_contract.tenant_id, p_contract_id, p_price_type, p_price, p_valid_from, null,
     p_justification, p_proof_path, v_version, coalesce(p_is_provisional, false),
     app.current_user_id())
  returning * into v_new;

  if v_current.id is not null then
    update public.negotiated_prices set superseded_by = v_new.id where id = v_current.id;
  end if;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, old_value, new_value, justification)
  values
    (v_contract.tenant_id, app.current_user_id(), 'price_change', 'negotiated_prices',
     v_new.id::text, to_jsonb(v_current), to_jsonb(v_new), p_justification);

  return v_new;
end;
$$;

-- PostgREST n'expose que le schéma `public` : sans ce relais, la fonction ne
-- serait appelable que depuis le SQL, pas depuis l'application. Le relais
-- n'ajoute aucun privilège — tous les contrôles restent dans app.revise_price.
create or replace function public.revise_price(
  p_contract_id    uuid,
  p_price_type     price_type,
  p_price          numeric,
  p_valid_from     date,
  p_justification  text,
  p_is_provisional boolean default false,
  p_proof_path     text default null
)
returns negotiated_prices
language sql
volatile
set search_path = pg_catalog, app, public
as $$
  select app.revise_price(p_contract_id, p_price_type, p_price, p_valid_from,
                          p_justification, p_is_provisional, p_proof_path);
$$;

grant execute on function public.revise_price(uuid, price_type, numeric, date, text, boolean, text)
  to authenticated;

comment on function app.revise_price(uuid, price_type, numeric, date, text, boolean, text) is
  'Seul chemin de révision d''un prix. Clôt la version en cours à la veille de la date d''effet et '
  'crée une nouvelle version. L''ancienne conserve son prix : les opérations déjà valorisées avec '
  'elle ne changent jamais de valeur (CMD §6).';

-- -----------------------------------------------------------------------------
-- Activation d'un contrat
-- -----------------------------------------------------------------------------
-- Un contrat activé sans prix ne permet de valoriser aucune opération : le
-- laisser passer déplacerait le problème jusqu'au premier achat, là où il est
-- le plus coûteux à corriger.

create or replace function app.enforce_contract_activation()
returns trigger
language plpgsql
set search_path = pg_catalog, app, public
as $$
begin
  if new.status = 'actif' and old.status is distinct from 'actif' then
    if not exists (
      select 1 from public.negotiated_prices
      where contract_id = new.id and price_type = 'negocie'
    ) then
      raise exception
        'Ce contrat ne peut pas être activé sans prix négocié : aucune opération ne pourrait être valorisée.'
        using errcode = 'check_violation';
    end if;

    new.activated_at := coalesce(new.activated_at, now());
  end if;

  return new;
end;
$$;

create trigger contracts_activation_guard
  before update on public.contracts
  for each row execute function app.enforce_contract_activation();
