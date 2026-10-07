-- Finalisation campagne 2027 · 1/3 — contrôles serveur : achat coopérative mode A, anti-doublon producteurs,
-- villages, clusters des profils.
--
-- Principes (mission de finalisation, 08/10/2026) :
--   * aucune règle de management inventée : la règle « RT obligatoire en mode A » est une mesure TEMPORAIRE de
--     prudence, stockée comme contrôle de campagne paramétrable (table aflp_campaign_controls), modifiable par le
--     Branch Manager / General Manager avec motif et historique ;
--   * le contrôle anti-doublon est porté par la base (un appel direct à l'API ne le contourne plus) ;
--   * un téléphone partagé (téléphone familial) n'est pas un doublon : il part en « À vérifier », sans blocage ;
--   * aucune donnée existante n'est modifiée (vérifié avant : 0 doublon actif téléphone, 0 village sans nom,
--     0 doublon nom + cluster, aucun profil avec un cluster non canonique).

-- ============================================================ 1. Contrôles de campagne paramétrables
create table if not exists public.aflp_campaign_controls (
  campaign      text not null,
  control_code  text not null,
  enabled       boolean not null default true,
  nature        text not null default 'TEMPORAIRE' check (nature in ('TEMPORAIRE','VALIDE_MANAGEMENT')),
  description   text not null,
  decision_note text,
  updated_by    uuid,
  updated_by_email text,
  updated_at    timestamptz not null default now(),
  primary key (campaign, control_code)
);
create table if not exists public.aflp_campaign_controls_history (
  id            bigint generated always as identity primary key,
  campaign      text not null,
  control_code  text not null,
  old_enabled   boolean,
  new_enabled   boolean not null,
  old_nature    text,
  new_nature    text not null,
  reason        text not null,
  actor         uuid,
  actor_email   text,
  actor_role    text,
  created_at    timestamptz not null default now()
);
alter table public.aflp_campaign_controls enable row level security;
alter table public.aflp_campaign_controls_history enable row level security;
create policy aflp_campaign_controls_sel on public.aflp_campaign_controls for select to authenticated using (true);
create policy aflp_campaign_controls_history_sel on public.aflp_campaign_controls_history for select to authenticated
  using (coalesce(public.mon_role(),'') in ('Branch Manager','Assistant Branch Manager','General Manager','Zonal Head','Finance','Viewer / Auditor'));
-- Aucune politique d'écriture : la seule voie d'écriture est la RPC aflp_campaign_control_set (rôle + motif + historique).
grant select on public.aflp_campaign_controls, public.aflp_campaign_controls_history to authenticated;

insert into public.aflp_campaign_controls(campaign, control_code, enabled, nature, description, decision_note)
values ('2027', 'COOP_MODE_A_RT_REQUIRED', true, 'TEMPORAIRE',
        'Achat individuel d''un membre de coopérative (mode A) : un RT de suivi actif est obligatoire pour rattacher l''achat à une avance et contrôler la caisse.',
        'Mesure de prudence posée le 08/10/2026 en attendant la décision du Branch Manager : qui porte l''avance en mode A (RT, coopérative, agent dédié ou caisse spéciale).')
on conflict (campaign, control_code) do nothing;

create or replace function private.aflp_campaign_control_enabled(p_campaign text, p_code text)
returns boolean language sql stable security definer set search_path = public, private as $$
  -- Contrôle absent = contrôle ACTIF (le défaut protège l'argent).
  select coalesce((select enabled from public.aflp_campaign_controls
                    where campaign = coalesce(nullif(p_campaign,''),'2027') and control_code = p_code), true)
$$;

create or replace function public.aflp_campaign_control_set(p_campaign text, p_code text, p_enabled boolean,
  p_nature text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_old public.aflp_campaign_controls; v_new public.aflp_campaign_controls; v_role text := public.mon_role();
begin
  if auth.uid() is null then raise exception 'Session requise' using errcode = '42501'; end if;
  if coalesce(v_role,'') not in ('Branch Manager','General Manager') then
    raise exception 'Seuls le Branch Manager et le General Manager peuvent modifier un contrôle de campagne.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'Motif obligatoire (10 caractères minimum).'; end if;
  if coalesce(p_nature,'') not in ('TEMPORAIRE','VALIDE_MANAGEMENT') then raise exception 'Nature du contrôle invalide.'; end if;
  select * into v_old from public.aflp_campaign_controls where campaign = p_campaign and control_code = p_code for update;
  if v_old.campaign is null then raise exception 'Contrôle de campagne inconnu : % / %', p_campaign, p_code; end if;
  update public.aflp_campaign_controls set enabled = p_enabled, nature = p_nature, decision_note = btrim(p_reason),
         updated_by = auth.uid(), updated_by_email = public.fbms_email(), updated_at = now()
   where campaign = p_campaign and control_code = p_code returning * into v_new;
  insert into public.aflp_campaign_controls_history(campaign, control_code, old_enabled, new_enabled, old_nature, new_nature,
         reason, actor, actor_email, actor_role)
  values (p_campaign, p_code, v_old.enabled, p_enabled, v_old.nature, p_nature, btrim(p_reason), auth.uid(), public.fbms_email(), v_role);
  return to_jsonb(v_new);
end $$;

-- ============================================================ 2. Achat coopérative mode A : RT de suivi + caisse
-- Ordre des triggers BEFORE sur achats (alphabétique) : ... trg_zz_aflp_achat_canal (fixe le canal) puis
-- trg_zzz_aflp_achat_mode_a_rt (ce contrôle). Le contrôle d'avance existant tourne AVANT le rattachement du canal :
-- il est donc rejoué ici, après rattachement éventuel du RT de suivi de l'affiliation.
create or replace function private.aflp_achat_controle_mode_a() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare v_follow text; v_rt public.rt; k text; v_avance numeric; v_achat numeric; v_dispo numeric;
begin
  if new.sourcing_channel is distinct from 'COOPERATIVE' then return new; end if;
  if tg_op = 'UPDATE' and new.rt_id is not distinct from old.rt_id and new.rt_nom is not distinct from old.rt_nom
     and new.montant is not distinct from old.montant and new.cooperative_id is not distinct from old.cooperative_id then
    return new;
  end if;
  if not private.aflp_campaign_control_enabled(new.campaign, 'COOP_MODE_A_RT_REQUIRED') then return new; end if;

  if nullif(btrim(coalesce(new.rt_id,'')),'') is null then
    select ms.followup_rt_id into v_follow from public.aflp_coop_memberships ms where ms.id = new.coop_membership_id;
    if v_follow is not null then new.rt_id := v_follow; new.rt_nom := null; end if;
  end if;
  if nullif(btrim(coalesce(new.rt_id,'')),'') is null then
    raise exception 'Un RT de suivi est requis pour un achat individuel d''un membre de coopérative afin d''assurer le contrôle de caisse.'
      using errcode = '23514', hint = 'Renseignez le RT de suivi du membre (fiche coopérative → Producteurs) ou choisissez le RT au moment de l''achat.';
  end if;
  select * into v_rt from public.rt where id = new.rt_id;
  if v_rt.id is null or coalesce(v_rt.deleted, false) then
    raise exception 'Le RT de suivi % est inactif ou introuvable : achat coopérative refusé.', new.rt_id using errcode = '23514';
  end if;
  new.rt_nom := coalesce(nullif(new.rt_nom,''), v_rt.nom);
  if auth.uid() is not null and not private.farmer_registry_can_access_village(v_rt.village_id, v_rt.id) then
    raise exception 'Le RT de suivi % est hors de votre périmètre : achat refusé.', coalesce(v_rt.id_rt, v_rt.id) using errcode = '42501';
  end if;

  -- Contrôle de caisse : même règle que fb_prevent_achat_over_advance (avances actives - achats déjà portés).
  k := public.fb_rt_key(new.rt_id, new.rt_nom);
  select coalesce(sum(a.montant),0) into v_avance from public.avances a
   where public.fb_rt_key(a.rt_id, a.rt_nom) = k and coalesce(a.statut,'Active') <> 'Annulee';
  select coalesce(sum(x.montant),0) into v_achat from public.achats x
   where public.fb_rt_key(x.rt_id, x.rt_nom) = k and x.id is distinct from new.id
     and not coalesce(nullif(btrim(coalesce(new.local_id,'')),'') is not null and x.local_id = new.local_id, false);
  v_dispo := v_avance - v_achat;
  if coalesce(new.montant,0) > v_dispo then
    raise exception 'Avance RT insuffisante. Disponible: %, achat: %', v_dispo, new.montant using errcode = '23514';
  end if;
  return new;
end $$;

create or replace trigger trg_zzz_aflp_achat_mode_a_rt before insert or update on public.achats
  for each row execute function private.aflp_achat_controle_mode_a();

-- ============================================================ 3. Anti-doublon producteurs côté serveur
-- Farmer ID : déjà unique (producteurs_code_key). Ici :
--   même téléphone + même identité (nom + prénoms)  → DOUBLON FORT : refus, sauf justification (≥ 10 car.)
--                                                     ET rôle de supervision (aflp_can_force_create) ;
--   nom + prénoms + même village                     → DOUBLON FORT : refus sauf justification ;
--   même téléphone + autre identité                  → À VÉRIFIER (téléphone familial possible), pas de blocage ;
--   même nom (sans prénoms d'un côté) + même village → À VÉRIFIER (indice faible), pas de blocage.
-- Justification = possible_duplicate vrai + review_reason ≥ 10 caractères ; tracée par le journal producteurs existant.
create or replace function private.farmer_controle_doublon() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare v_tel text; v_idn text; v_nn text; v_hit record; v_justif boolean;
begin
  if coalesce(new.deleted, false) then return new; end if;
  if tg_op = 'UPDATE' and new.telephone is not distinct from old.telephone and new.nom is not distinct from old.nom
     and new.prenoms is not distinct from old.prenoms and new.village_id is not distinct from old.village_id
     and old.deleted is not distinct from new.deleted then
    return new;
  end if;
  v_tel := nullif(public.farmer_registry_norm_phone(new.telephone), '');
  if v_tel is not null and length(v_tel) < 8 then v_tel := null; end if;
  v_idn := nullif(public.farmer_registry_norm_text(coalesce(new.nom,'') || ' ' || coalesce(new.prenoms,'')), '');
  v_nn  := nullif(public.farmer_registry_norm_text(new.nom), '');
  v_justif := coalesce(new.possible_duplicate, false) and length(btrim(coalesce(new.review_reason,''))) >= 10;

  if v_tel is not null and v_idn is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: ce producteur existe déjà (Farmer ID %, même téléphone et même identité). Ouvrez la fiche existante au lieu d''en créer une nouvelle.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      if auth.uid() is not null and not private.aflp_can_force_create() then
        raise exception 'DOUBLON_FORT: création malgré un doublon fort réservée à la supervision (Supervisor, Unit Head, Zonal Head, direction).'
          using errcode = '42501';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;

  if v_idn is not null and nullif(btrim(coalesce(new.prenoms,'')),'') is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id
       and public.farmer_registry_norm_text(coalesce(p.nom,'') || ' ' || coalesce(p.prenoms,'')) = v_idn
     limit 1;
    if v_hit.id is not null then
      if not v_justif then
        raise exception 'DOUBLON_FORT: un producteur de même nom et prénoms existe déjà dans ce village (Farmer ID %). Vérifiez la fiche existante ; une création exceptionnelle exige une justification.', coalesce(v_hit.code, v_hit.id)
          using errcode = '23505';
      end if;
      new.review_required := true;
      return new;
    end if;
  end if;

  if v_tel is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.telephone is not null
       and public.farmer_registry_norm_phone(p.telephone) = v_tel
     limit 1;
    if v_hit.id is not null then
      new.possible_duplicate := true; new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : téléphone partagé avec le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (téléphone familial possible).');
      return new;
    end if;
  end if;

  if v_nn is not null and new.village_id is not null then
    select p.id, p.code into v_hit from public.producteurs p
     where not p.deleted and p.id <> new.id and p.village_id = new.village_id and p.nom is not null
       and public.farmer_registry_norm_text(p.nom) = v_nn
       and (nullif(btrim(coalesce(new.prenoms,'')),'') is null or nullif(btrim(coalesce(p.prenoms,'')),'') is null)
     limit 1;
    if v_hit.id is not null then
      new.review_required := true;
      new.review_reason := coalesce(nullif(btrim(coalesce(new.review_reason,'')),''),
        'À vérifier : même nom dans le même village que le Farmer ID ' || coalesce(v_hit.code, v_hit.id) || ' (indice faible).');
    end if;
  end if;
  return new;
end $$;

create or replace trigger trg_farmer_registry_zz_controle_doublon before insert or update on public.producteurs
  for each row execute function private.farmer_controle_doublon();

-- ============================================================ 4. Villages : nom obligatoire, pas de doublon nom + cluster
-- Comparaison normalisée (accents, espaces, majuscules, apostrophes) : « N'Djebonoua » = « NDJEBONOUA ».
create or replace function private.village_controle_nom() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare v_nom text; v_k text; v_hit text;
begin
  if coalesce(new.deleted, false) then return new; end if;
  v_nom := nullif(btrim(coalesce(new.village, new.data->'s1'->>'village', '')), '');
  if v_nom is null then raise exception 'Le nom du village est obligatoire.' using errcode = '23514'; end if;
  v_k := public.farmer_registry_norm_text(v_nom);
  if v_k = '' then raise exception 'Le nom du village est obligatoire.' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and public.farmer_registry_norm_text(coalesce(old.village, old.data->'s1'->>'village','')) = v_k
     and old.cluster_code is not distinct from new.cluster_code and not coalesce(old.deleted,false) then
    return new;
  end if;
  select v.id into v_hit from public.villages v
   where not v.deleted and v.id <> new.id and v.cluster_code is not distinct from new.cluster_code
     and public.farmer_registry_norm_text(coalesce(v.village, v.data->'s1'->>'village','')) = v_k
   limit 1;
  if v_hit is not null then
    raise exception 'Le village « % » existe déjà dans ce cluster. Utilisez la fiche existante.', v_nom using errcode = '23505';
  end if;
  return new;
end $$;
create or replace trigger trg_zz_village_controle_nom before insert or update on public.villages
  for each row execute function private.village_controle_nom();

-- ============================================================ 5. Profils : cluster = code canonique
-- Le libellé (« N'DJEBONOUA », « Djébonoua ») est converti en code (DJEBONOUA) via aflp_clusters.aliases.
-- Un cluster inconnu est refusé : les règles de permission comparent des codes.
create or replace function private.profil_cluster_canonique() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare v_k text; v_code text;
begin
  if nullif(btrim(coalesce(new.cluster,'')),'') is null then new.cluster := null; return new; end if;
  if tg_op = 'UPDATE' and new.cluster is not distinct from old.cluster then return new; end if;
  v_k := public.farmer_registry_norm_text(new.cluster);
  select c.code into v_code from public.aflp_clusters c
   where public.farmer_registry_norm_text(c.code) = v_k or public.farmer_registry_norm_text(c.label) = v_k
      or exists (select 1 from unnest(coalesce(c.aliases, '{}'::text[])) a where public.farmer_registry_norm_text(a) = v_k)
   order by c.active desc limit 1;
  if v_code is null then
    raise exception 'Cluster « % » inconnu : choisissez un cluster du référentiel AFLP.', new.cluster using errcode = '23514';
  end if;
  new.cluster := v_code;
  return new;
end $$;
create or replace trigger trg_zz_profil_cluster_canonique before insert or update of cluster on public.profils
  for each row execute function private.profil_cluster_canonique();

-- ============================================================ 6. Droits
revoke execute on function private.aflp_campaign_control_enabled(text, text) from public, anon;
revoke execute on function private.aflp_achat_controle_mode_a() from public, anon, authenticated;
revoke execute on function private.farmer_controle_doublon() from public, anon, authenticated;
revoke execute on function private.village_controle_nom() from public, anon, authenticated;
revoke execute on function private.profil_cluster_canonique() from public, anon, authenticated;
revoke execute on function public.aflp_campaign_control_set(text, text, boolean, text, text) from public, anon;
grant execute on function public.aflp_campaign_control_set(text, text, boolean, text, text) to authenticated;
grant execute on function private.aflp_campaign_control_enabled(text, text) to authenticated;
