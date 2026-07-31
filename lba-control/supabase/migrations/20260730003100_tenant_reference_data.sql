-- =============================================================================
-- LBA Control · 3100 · Un client ouvert doit naître utilisable
-- =============================================================================
-- Écart trouvé en vérifiant, sur le projet hébergé, ce que contient réellement
-- une entreprise créée depuis la console. La migration 2900 posait pourtant la
-- règle : « une entreprise naît complète ou ne naît pas ». Elle créait le
-- tenant, sa marque, son abonnement et l'invitation du propriétaire — et
-- s'arrêtait là.
--
-- Manquaient deux référentiels, tous deux rangés par tenant, tous deux créés
-- jusqu'ici par le seul script de démonstration :
--
--  1. **Les 23 catégories de dépenses.** `expenses.category_id` est NOT NULL et
--     référence `expense_categories`, qui porte un `tenant_id`. Sans elles,
--     AUCUNE dépense n'est saisissable. L'écran s'ouvre, la liste déroulante est
--     vide, et rien n'explique pourquoi. C'est un blocage franc.
--
--  2. **Les 20 règles d'alerte.** `app.raise_alert` renvoie `null` quand la
--     règle est absente — silence assumé, et c'est le bon comportement pour une
--     règle volontairement désactivée. Mais pour un client neuf, ce silence
--     signifie que les vingt types d'alerte ne se déclencheront jamais. Le
--     produit paraît fonctionner : les tâches planifiées tournent, le journal
--     dit « exécuté », et aucune alerte n'arrive. C'est plus grave que le
--     blocage franc, parce que personne ne le remarque.
--
-- La correction seede les deux dans la transaction de création. Les deux
-- fonctions sont idempotentes (`on conflict do nothing`) : elles servent aussi à
-- réparer un client déjà ouvert sans risquer de dupliquer quoi que ce soit.
--
-- ⚠ Ce fichier crée des fonctions : révocation explicite à la fin (cf. 2400 et
-- 3000).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Référentiel des dépenses
-- -----------------------------------------------------------------------------
-- Les 23 catégories imposées, avec leurs trois propriétés qui portent des règles
-- métier réelles :
--
--  · `is_direct` — une charge indirecte se répartit par clé, une charge directe
--    est déjà rattachée à son périmètre ;
--
--  · `is_system_reserved` — `achat_produit` et `commission_pisteur` existent au
--    référentiel mais sont refusées en saisie manuelle. La valeur d'achat vient
--    de `purchases` : la saisir aussi en dépense la compterait deux fois dans le
--    TCB (INC-05) ;
--
--  · `is_controllable_by_agent` — détermine ce qui entre dans la composante
--    « maîtrise du TCB » du score. Évaluer un pisteur sur le gardiennage du
--    magasin serait le noter sur une décision qui n'est pas la sienne (D6).
--
-- Le seuil de justificatif est posé à 50 000 FCFA, valeur par défaut que chaque
-- entreprise ajuste ensuite : c'est son métier, pas celui de l'éditeur.

create or replace function app.seed_expense_categories(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_count integer;
begin
  if not app.is_platform_admin()
     and not (p_tenant = app.current_tenant_id() and app.can_manage_settings()) then
    raise exception 'Réservé à l''administration de cette entreprise.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.expense_categories
    (tenant_id, code, label, family, is_direct, is_system_reserved,
     is_controllable_by_agent, requires_receipt_above)
  values
    (p_tenant, 'achat_produit',      'Achat produit',           'Achat matière',             true,  true,  false, 50000),
    (p_tenant, 'commission_pisteur', 'Commission pisteur',      'Pisteurs',                  true,  true,  true,  50000),
    (p_tenant, 'collecte',           'Collecte',                'Collecte / manutention',    true,  false, true,  50000),
    (p_tenant, 'chargement',         'Chargement',              'Collecte / manutention',    true,  false, true,  50000),
    (p_tenant, 'dechargement',       'Déchargement',            'Collecte / manutention',    true,  false, false, 50000),
    (p_tenant, 'manutention',        'Manutention',             'Collecte / manutention',    true,  false, false, 50000),
    (p_tenant, 'transport',          'Transport',               'Transport',                 true,  false, false, 50000),
    (p_tenant, 'carburant',          'Carburant',               'Transport',                 true,  false, true,  50000),
    (p_tenant, 'peage',              'Péage',                   'Transport',                 true,  false, false, 50000),
    (p_tenant, 'pesee',              'Pesée',                   'Collecte / manutention',    true,  false, false, 50000),
    (p_tenant, 'sechage',            'Séchage',                 'Qualité / traitement',      true,  false, false, 50000),
    (p_tenant, 'tri',                'Tri',                     'Qualité / traitement',      true,  false, false, 50000),
    (p_tenant, 'reconditionnement',  'Reconditionnement',       'Qualité / traitement',      true,  false, false, 50000),
    (p_tenant, 'sacherie',           'Sacherie',                'Sacherie',                  true,  false, true,  50000),
    (p_tenant, 'mobile_money',       'Mobile Money',            'Financier',                 true,  false, false, 50000),
    (p_tenant, 'frais_bancaires',    'Frais bancaires',         'Financier',                 true,  false, false, 50000),
    (p_tenant, 'interets',           'Intérêts',                'Financier',                 false, false, false, 50000),
    (p_tenant, 'gardiennage',        'Gardiennage',             'Frais généraux imputables', false, false, false, 50000),
    (p_tenant, 'stockage',           'Stockage',                'Frais généraux imputables', false, false, false, 50000),
    (p_tenant, 'communication',      'Communication',           'Administratif',             true,  false, true,  50000),
    (p_tenant, 'administration',     'Administration',          'Administratif',             false, false, false, 50000),
    (p_tenant, 'qualite',            'Qualité',                 'Qualité / traitement',      true,  false, false, 50000),
    (p_tenant, 'autres_frais',       'Autres frais autorisés',  'Administratif',             true,  false, false, 50000)
  -- Idempotent : la fonction sert aussi à réparer un client déjà ouvert, et
  -- rejouer ne doit rien dupliquer ni écraser un seuil que le client a ajusté.
  on conflict (tenant_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.seed_expense_categories(uuid) is
  'Installe les 23 catégories imposées. Sans elles, aucune dépense n''est saisissable : '
  'expenses.category_id est NOT NULL et le référentiel est rangé par tenant.';

-- -----------------------------------------------------------------------------
-- Cloisonnement de app.seed_alert_rules
-- -----------------------------------------------------------------------------
-- La fonction ne vérifiait rien. Étant `security definer` et relayée dans
-- `public`, n'importe quel compte connecté pouvait installer des règles chez un
-- autre client en passant son identifiant. Aucune donnée n'était lisible pour
-- autant, mais écrire chez un tiers n'a jamais fait partie du contrat.

create or replace function app.seed_alert_rules(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_count integer;
begin
  if not app.is_platform_admin()
     and not (p_tenant = app.current_tenant_id() and app.can_manage_settings()) then
    raise exception 'Réservé à l''administration de cette entreprise.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.alert_rules (tenant_id, alert_type, severity, threshold)
  values
    (p_tenant, 'financement_proche_echeance',          'surveillance', '{"days": 7}'),
    (p_tenant, 'avance_sans_achat',                    'surveillance', '{"days": 3}'),
    (p_tenant, 'avance_non_couverte',                  'critique',     '{"days": 15, "amount": 0}'),
    (p_tenant, 'argent_chez_pisteur_trop_longtemps',   'critique',     '{"days": 7, "amount": 0}'),
    (p_tenant, 'aucune_livraison_depuis_x_jours',      'surveillance', '{"days": 5}'),
    (p_tenant, 'livraison_prevue_48h',                 'info',         '{"hours": 48}'),
    (p_tenant, 'livraison_prevue_demain',              'info',         '{"days": 1}'),
    (p_tenant, 'livraison_en_retard',                  'critique',     '{"days": 1}'),
    (p_tenant, 'stock_insuffisant',                    'critique',     '{"ratio": 1}'),
    (p_tenant, 'double_reservation',                   'blocage',      '{"kg": 0}'),
    (p_tenant, 'camion_sans_document',                 'critique',     '{"hours": 6}'),
    (p_tenant, 'transfert_transit_trop_long',          'critique',     '{"hours": 48}'),
    (p_tenant, 'reception_non_renseignee',             'surveillance', '{"hours": 24}'),
    (p_tenant, 'ecart_superieur_tolerance',            'critique',     '{"pct": 0}'),
    (p_tenant, 'tare_anormale',                        'surveillance', '{"kg": 100}'),
    (p_tenant, 'depense_sans_justificatif',            'surveillance', '{"amount": 50000}'),
    (p_tenant, 'depense_doublon_probable',             'surveillance', '{"score": 70}'),
    (p_tenant, 'tcb_superieur_prix_net',               'critique',     '{"margin": 0}'),
    (p_tenant, 'marge_inferieure_seuil',               'surveillance', '{"marginPerKg": 10}'),
    (p_tenant, 'abonnement_proche_echeance',           'surveillance', '{"days": 7}')
  on conflict (tenant_id, alert_type) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.seed_alert_rules(uuid) is
  'Installe les vingt règles avec leurs seuils par défaut, pour SA propre entreprise ou depuis la '
  'plateforme. Les seuils sont ensuite modifiables par tenant : un seuil imposé par l''éditeur '
  'serait un jugement sur un métier qu''il ne pratique pas.';

-- -----------------------------------------------------------------------------
-- Ouverture d'une entreprise · complétée
-- -----------------------------------------------------------------------------
-- Seul ajout par rapport à la migration 2900 : les deux appels de seed, dans la
-- même transaction que le reste. Une entreprise sans référentiel de dépenses
-- n'est pas « presque née » — elle est née inutilisable, et le découvrir demande
-- d'ouvrir l'écran des dépenses pour constater une liste vide.

create or replace function app.create_tenant(
  p_slug            text,
  p_commercial_name text,
  p_legal_name      text,
  p_owner_email     text,
  p_owner_name      text,
  p_plan_id         uuid default null,
  p_trial_days      integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant     public.tenants;
  v_plan       public.subscription_plans;
  v_invitation public.tenant_invitations;
  v_slug       text := lower(btrim(coalesce(p_slug, '')));
  v_categories integer;
  v_rules      integer;
begin
  if not app.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$' then
    raise exception
      'Identifiant d''entreprise invalide : minuscules, chiffres et tirets, 3 à 50 caractères. '
      'Il apparaît dans les adresses et ne se change pas ensuite.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    -- Arrêt net plutôt que rattachement : réutiliser un slug relierait le
    -- nouveau client aux données de l'ancien.
    raise exception 'L''identifiant « % » est déjà utilisé par une autre entreprise.', v_slug
      using errcode = 'unique_violation';
  end if;

  if length(btrim(coalesce(p_commercial_name, ''))) < 2 then
    raise exception 'Le nom commercial est obligatoire.' using errcode = 'check_violation';
  end if;

  if p_owner_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse électronique du propriétaire invalide.' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.subscription_plans
   where is_active
     and (p_plan_id is null or id = p_plan_id)
   order by (id = p_plan_id) desc, monthly_amount
   limit 1;

  if not found then
    raise exception 'Aucun plan d''abonnement disponible : impossible d''ouvrir une entreprise.'
      using errcode = 'no_data_found';
  end if;

  insert into public.tenants (slug, commercial_name, legal_name, status)
  values (v_slug, btrim(p_commercial_name),
          coalesce(nullif(btrim(p_legal_name), ''), btrim(p_commercial_name)), 'active')
  returning * into v_tenant;

  insert into public.tenant_branding (tenant_id, commercial_name, legal_name)
  values (v_tenant.id, v_tenant.commercial_name, v_tenant.legal_name);

  insert into public.subscriptions
    (tenant_id, plan_id, status, period_start, period_end, trial_end, amount, currency)
  values
    (v_tenant.id, v_plan.id, 'trial', current_date,
     current_date + greatest(1, coalesce(p_trial_days, 30)),
     current_date + greatest(1, coalesce(p_trial_days, 30)),
     v_plan.monthly_amount, coalesce(v_plan.currency, 'XOF'));

  -- Les deux référentiels, dans la même transaction. Sans eux l'entreprise est
  -- née inutilisable : aucune dépense saisissable, aucune alerte déclenchable.
  v_categories := app.seed_expense_categories(v_tenant.id);
  v_rules      := app.seed_alert_rules(v_tenant.id);

  insert into public.tenant_invitations (tenant_id, email, full_name, role, invited_by)
  values (v_tenant.id, lower(btrim(p_owner_email)), btrim(p_owner_name), 'proprietaire',
          app.current_user_id())
  returning * into v_invitation;

  insert into public.audit_log
    (tenant_id, user_id, action, table_name, record_id, new_value, justification)
  values
    (v_tenant.id, app.current_user_id(), 'create', 'tenants', v_tenant.id::text,
     jsonb_build_object('slug', v_slug, 'plan', v_plan.name,
                        'expense_categories', v_categories, 'alert_rules', v_rules),
     format('Entreprise ouverte depuis la console, propriétaire invité : %s.', p_owner_email));

  return jsonb_build_object(
    'tenant_id', v_tenant.id,
    'slug', v_tenant.slug,
    'invitation_id', v_invitation.id,
    'invitation_token', v_invitation.token,
    'invitation_expires_at', v_invitation.expires_at,
    'plan', v_plan.name,
    'trial_end', current_date + greatest(1, coalesce(p_trial_days, 30)),
    'expense_categories', v_categories,
    'alert_rules', v_rules);
end;
$$;

comment on function app.create_tenant(text, text, text, text, text, uuid, integer) is
  'Ouvre une entreprise complète — tenant, marque, abonnement d''essai, référentiel des dépenses, '
  'règles d''alerte, invitation du propriétaire — dans une seule transaction. Une entreprise à '
  'moitié née est plus coûteuse à réparer qu''à recommencer.';

-- -----------------------------------------------------------------------------
-- Relais public
-- -----------------------------------------------------------------------------

create or replace function public.seed_expense_categories(p_tenant uuid)
returns integer
language sql
set search_path = pg_catalog, app, public
as $$ select app.seed_expense_categories(p_tenant); $$;

-- -----------------------------------------------------------------------------
-- Fermeture de la surface d'exécution
-- -----------------------------------------------------------------------------
-- Deux titulaires distincts, deux révocations : `PUBLIC` (droit intégré de
-- PostgreSQL, cf. 2400) et `anon` (privilège par défaut posé par Supabase sur un
-- projet hébergé, cf. 3000).

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d
        on d.objid = p.oid
       and d.classid = 'pg_proc'::regclass
       and d.deptype = 'e'
     where n.nspname in ('app', 'public')
       and d.objid is null
       and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('revoke execute on function %s from anon', v_fn.signature);
  end loop;
end
$$;

grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app    to authenticated, service_role;
