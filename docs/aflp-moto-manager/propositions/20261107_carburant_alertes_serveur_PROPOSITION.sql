-- =============================================================================
-- AFLP FLEET · Alertes carburant calculées côté serveur — PROPOSITION
-- -----------------------------------------------------------------------------
-- STATUT : NON APPLIQUÉE. Fichier volontairement placé HORS de supabase/ :
-- la politique du dépôt interdit toute modification automatique du schéma,
-- des RLS et des fonctions serveur. À relire (label human-review) puis, sur
-- autorisation explicite du Branch Manager, à copier en migration datée.
--
-- Constat du 06/11/2026 (lecture seule) : l'extension pg_cron est DISPONIBLE
-- sur le projet mais NON INSTALLÉE ; aucune tâche planifiée n'existe donc.
-- Tant que ce fichier n'est pas appliqué, les alertes ne sont calculées que
-- lorsqu'un utilisateur habilité ouvre AFLP FLEET.
--
-- Ce que fait la proposition :
--   1. table public.moto_carburant_alertes : historique dédoublonné
--      (une ligne par moto, statut et jour ; occurrences incrémentées) ;
--   2. fonction private.moto_carburant_evaluer(moto) : même règle que
--      moto/moto-carburant-previsionnel.js (evaluerMoto), sans planning ;
--   3. fonction private.moto_carburant_recalculer() : boucle sur les motos
--      suivies, n'écrit QUE dans moto_carburant_alertes ;
--   4. planification pg_cron toutes les 30 minutes (section 4, séparée).
-- Ce qu'elle ne fait PAS : aucun message WhatsApp, SMS ou e-mail ; aucune
-- dotation, aucun paiement ; aucune modification des tables existantes.
-- =============================================================================

-- 1. Historique des alertes ---------------------------------------------------
create table if not exists public.moto_carburant_alertes (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  jour date not null,
  statut text not null check (statut in ('CRITIQUE','RAVITAILLEMENT_A_PLANIFIER','DONNEES_A_VERIFIER')),
  stock_l numeric(6,2),
  seuil_alerte_l numeric(6,2),
  stock_securite_l numeric(6,2),
  autonomie_km numeric(7,0),
  km_jour numeric(7,1),
  source_km text not null check (source_km in ('HISTORIQUE','REFERENTIEL')),
  plein_conseille_l numeric(6,2),
  cout_plein_fcfa numeric(10,0),
  justification text not null,
  premiere_at timestamptz not null default now(),
  derniere_at timestamptz not null default now(),
  occurrences integer not null default 1,
  unique (moto_id, statut, jour)
);
alter table public.moto_carburant_alertes enable row level security;
drop policy if exists moto_carburant_alertes_lecture on public.moto_carburant_alertes;
create policy moto_carburant_alertes_lecture on public.moto_carburant_alertes for select to authenticated
  using (private.moto_classe() in ('BM','ABM','LOGISTIQUE','ZONE','FINANCE','DIRECTION') and private.moto_dans_perimetre(moto_id));
revoke insert, update, delete on public.moto_carburant_alertes from public, anon, authenticated;

-- 2. Évaluation d'une moto (miroir de evaluerMoto, sans planning) --------------
create or replace function private.moto_carburant_evaluer(p_moto uuid, p_maintenant timestamptz default now())
returns table (statut text, stock_l numeric, seuil_l numeric, secu_l numeric, autonomie_km numeric, km_jour numeric,
               source_km text, plein_l numeric, cout_fcfa numeric, justification text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant numeric := 15;  conso constant numeric := 4.4;  prix constant numeric := 905;
  ref_km constant numeric := 70;
  v_compteur numeric; v_releve timestamptz; a record; ancre record;
  s numeric; dernier numeric; v_km numeric; v_span numeric; o_t timestamptz; o_km numeric;
  besoin numeric; secu numeric; seuil numeric; bloquant boolean := false; incoherent boolean := false; epuise boolean := false;
begin
  select m.compteur_actuel_km, (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = m.id)
    into v_compteur, v_releve from public.moto_motos m where m.id = p_moto;
  select c.* into ancre from public.moto_carburant c
   where c.moto_id = p_moto and c.plein_complet and c.justificatif_statut <> 'REJETE'
   order by c.compteur_km desc, c.date_achat desc limit 1;
  if ancre.id is null or v_compteur is null then
    return query select 'DONNEES_A_VERIFIER'::text, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      'REFERENTIEL'::text, null::numeric, null::numeric, 'Aucun plein complet ou compteur absent : stock non calculable'::text; return;
  end if;
  if v_compteur < ancre.compteur_km then incoherent := true; end if;
  s := cap; dernier := ancre.compteur_km;
  for a in select c.* from public.moto_carburant c
            where c.moto_id = p_moto and c.justificatif_statut <> 'REJETE' and c.id <> ancre.id
              and (c.compteur_km > ancre.compteur_km or (c.compteur_km = ancre.compteur_km and c.date_achat > ancre.date_achat))
            order by c.compteur_km, c.date_achat loop
    if a.compteur_km > v_compteur then incoherent := true; exit; end if;
    s := greatest(0, s - (a.compteur_km - dernier) * conso / 100) + a.litres;
    s := least(cap, s);                      -- achat supérieur à la place disponible : plafonné, à vérifier
    dernier := a.compteur_km;
  end loop;
  if incoherent then
    return query select 'DONNEES_A_VERIFIER'::text, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      'REFERENTIEL'::text, null::numeric, null::numeric, 'Compteur ou achat incohérent'::text; return;
  end if;
  s := s - (v_compteur - dernier) * conso / 100;
  if s < -0.05 then epuise := true; end if;
  s := greatest(0, s);

  -- Rythme : compteur depuis le plus ancien point (achat ou départ de mission) des 14 derniers jours.
  select t, km into o_t, o_km from (
      select c.date_achat as t, c.compteur_km as km from public.moto_carburant c where c.moto_id = p_moto and c.justificatif_statut <> 'REJETE'
      union all select mi.depart_at, mi.depart_km from public.moto_missions mi where mi.moto_id = p_moto) x
   where t <= p_maintenant
   order by (t >= p_maintenant - interval '14 days') desc, case when t >= p_maintenant - interval '14 days' then extract(epoch from t) else -extract(epoch from t) end
   limit 1;
  v_span := extract(epoch from (coalesce(v_releve, p_maintenant) - o_t)) / 86400;
  if o_t is not null and v_compteur - o_km > 0 and v_span > 0 then v_km := (v_compteur - o_km) / greatest(1, v_span);
  else v_km := ref_km; bloquant := true; end if;
  if v_releve is null or p_maintenant - v_releve > interval '48 hours' then bloquant := true; end if;

  besoin := v_km * conso / 100; secu := besoin; seuil := besoin + secu;
  return query select
    case when epuise or s <= secu or besoin > s or besoin > cap then 'CRITIQUE'
         when s <= seuil or seuil > cap then 'RAVITAILLEMENT_A_PLANIFIER'
         when bloquant then 'DONNEES_A_VERIFIER' else 'NORMAL' end,
    round(s, 2), round(seuil, 2), round(secu, 2), round(100 * s / conso, 0), round(v_km, 1),
    case when bloquant and v_km = ref_km then 'REFERENTIEL' else 'HISTORIQUE' end,
    round(cap - s, 2), round((cap - s) * prix, 0),
    format('Stock estimé %s L, seuil %s L, %s km/jour', round(s, 2), round(seuil, 2), round(v_km, 0));
end $$;
revoke all on function private.moto_carburant_evaluer(uuid, timestamptz) from public, anon, authenticated;

-- 3. Recalcul de toutes les motos suivies (écrit uniquement dans l'historique) ---
create or replace function private.moto_carburant_recalculer(p_maintenant timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; e record; n integer := 0;
begin
  for m in select mo.id from public.moto_motos mo
            where mo.actif and (mo.mise_en_service_at is not null or exists (select 1 from public.moto_carburant c where c.moto_id = mo.id)) loop
    select * into e from private.moto_carburant_evaluer(m.id, p_maintenant);
    continue when e.statut = 'NORMAL';
    insert into public.moto_carburant_alertes as x (moto_id, jour, statut, stock_l, seuil_alerte_l, stock_securite_l, autonomie_km, km_jour,
                                                    source_km, plein_conseille_l, cout_plein_fcfa, justification, premiere_at, derniere_at)
    values (m.id, (p_maintenant at time zone 'Africa/Abidjan')::date, e.statut, e.stock_l, e.seuil_l, e.secu_l, e.autonomie_km, e.km_jour,
            e.source_km, e.plein_l, e.cout_fcfa, e.justification, p_maintenant, p_maintenant)
    on conflict (moto_id, statut, jour) do update
      set derniere_at = excluded.derniere_at, occurrences = x.occurrences + 1, stock_l = excluded.stock_l,
          autonomie_km = excluded.autonomie_km, justification = excluded.justification;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.moto_carburant_recalculer(timestamptz) from public, anon, authenticated;

-- 4. Planification (exige l'installation de pg_cron, autorisation BM requise) --
-- create extension if not exists pg_cron;
-- select cron.schedule('aflp-fleet-carburant-alertes', '*/30 * * * *', $$select private.moto_carburant_recalculer()$$);

-- Retour arrière -------------------------------------------------------------
-- select cron.unschedule('aflp-fleet-carburant-alertes');
-- drop function if exists private.moto_carburant_recalculer(timestamptz);
-- drop function if exists private.moto_carburant_evaluer(uuid, timestamptz);
-- drop table if exists public.moto_carburant_alertes;
