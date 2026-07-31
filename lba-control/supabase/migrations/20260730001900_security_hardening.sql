-- =============================================================================
-- LBA Control · 1900 · Durcissement issu de l'audit de sécurité (phase 7)
-- =============================================================================
-- Ce fichier ne livre aucune fonctionnalité. Il ferme quatre écarts trouvés par
-- l'audit piloté par le catalogue (`tests/db/security-audit.test.ts`), qui
-- affirme des invariants au lieu de citer des tables à la main.
--
-- Les quatre écarts avaient le même profil : rien de cassé, rien de visible,
-- mais une porte laissée ouverte par défaut plutôt que fermée par décision.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Écart 1 · suppression physique d'entités à statut terminal
-- -----------------------------------------------------------------------------
-- Cinq tables portaient une politique DELETE permissive alors qu'elles ont
-- toutes un état de fin de vie explicite — `annule`, `cloture`, `closed`,
-- `superseded_by`. Laisser la suppression possible rend ce statut décoratif :
-- une annulation motivée et tracée devient un `delete` déguisé, et l'historique
-- disparaît sans laisser de trace de sa disparition.
--
-- Le cas le plus net est `negotiated_prices`. Toute la phase 2 a été construite
-- pour qu'un prix ne soit jamais écrasé mais versionné (`app.revise_price`).
-- Pouvoir supprimer une version close annulait ce travail par la porte de
-- service.

drop policy if exists contracts_delete          on public.contracts;
drop policy if exists campaigns_delete          on public.campaigns;
drop policy if exists partner_companies_delete  on public.partner_companies;
drop policy if exists field_agents_delete       on public.field_agents;
drop policy if exists negotiated_prices_delete  on public.negotiated_prices;

-- La politique existe **et** refuse : une absence de politique refuserait
-- aussi, mais sans dire que le refus est voulu. La distinction compte pour qui
-- relira ce schéma dans deux ans.
create policy contracts_delete on public.contracts
  for delete using (false);
create policy campaigns_delete on public.campaigns
  for delete using (false);
create policy partner_companies_delete on public.partner_companies
  for delete using (false);
create policy field_agents_delete on public.field_agents
  for delete using (false);
create policy negotiated_prices_delete on public.negotiated_prices
  for delete using (false);

comment on policy negotiated_prices_delete on public.negotiated_prices is
  'Un prix se révise, il ne se supprime pas. Supprimer une version close effacerait la justification '
  'du prix appliqué à des achats déjà payés.';

comment on policy contracts_delete on public.contracts is
  'Un contrat s''annule ou se clôture, avec motif et auteur. La suppression rendrait ce statut décoratif.';

comment on policy field_agents_delete on public.field_agents is
  'Un pisteur se clôture. Le supprimer effacerait le lien entre ses achats et son identité.';

-- -----------------------------------------------------------------------------
-- Écart 3 · journalisation des exports sensibles
-- -----------------------------------------------------------------------------
-- `sensitive_export` existait dans l'énumération d'audit depuis la phase 1 mais
-- rien ne l'écrivait. Un export de données nominatives ou financières qui ne
-- laisse aucune trace ne peut pas être retracé après une fuite — et c'est
-- précisément le moment où on en a besoin.

create or replace function app.log_export(
  p_scope    text,
  p_document text,
  p_rows     integer,
  p_filters  jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Entreprise non résolue.' using errcode = 'insufficient_privilege';
  end if;

  if p_scope not in ('donnees_financieres', 'donnees_pisteurs', 'donnees_partenaires') then
    -- Un export sans donnée sensible n'a pas à être journalisé : tracer tout
    -- revient à ne rien tracer, parce que plus personne ne relit le journal.
    return;
  end if;

  insert into public.audit_log
    (tenant_id, user_id, device_id, action, table_name, new_value, justification)
  values
    (v_tenant, app.current_user_id(), app.current_device_id(), 'sensitive_export', p_document,
     jsonb_build_object('scope', p_scope, 'row_count', p_rows, 'filters', p_filters),
     format('Export « %s » de %s ligne(s).', p_document, p_rows));
end;
$$;

create or replace function public.log_export(
  p_scope text, p_document text, p_rows integer, p_filters jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = pg_catalog, app, public
as $$ select app.log_export(p_scope, p_document, p_rows, p_filters); $$;

grant execute on function public.log_export(text, text, integer, jsonb) to authenticated;

comment on function app.log_export(text, text, integer, jsonb) is
  'Journalise un export contenant des montants ou des données nominatives. Les exports sans donnée '
  'sensible ne sont pas tracés : un journal qui enregistre tout n''est plus relu.';

-- -----------------------------------------------------------------------------
-- Écart 4 · lisibilité de l'audit lui-même
-- -----------------------------------------------------------------------------
-- Quatre tables échappent volontairement au verrou d'écriture par abonnement.
-- La raison était dans la tête de l'auteur ; elle est désormais dans le schéma,
-- pour qu'un futur relecteur n'y voie pas un oubli à « corriger ».

comment on table public.sync_operations is
  'ÉCHAPPE VOLONTAIREMENT au verrou d''abonnement. Un appareil hors ligne doit pouvoir enregistrer '
  'ses tentatives et leurs échecs même quand le tenant est suspendu : sinon l''opération resterait '
  'pending sans que personne ne sache pourquoi elle ne passe pas.';

comment on table public.sync_sessions is
  'ÉCHAPPE VOLONTAIREMENT au verrou d''abonnement, pour la même raison que sync_operations.';

comment on table public.user_devices is
  'ÉCHAPPE VOLONTAIREMENT au verrou d''abonnement : un utilisateur d''un tenant suspendu conserve le '
  'droit de se connecter en lecture, donc d''enregistrer son appareil.';

comment on table public.notifications is
  'ÉCHAPPE VOLONTAIREMENT au verrou d''abonnement : un client suspendu doit continuer à recevoir les '
  'messages qui lui expliquent comment se débloquer.';

-- -----------------------------------------------------------------------------
-- Écart 2 · surface d'exécution ouverte par défaut
-- -----------------------------------------------------------------------------
-- Placé en fin de fichier à dessein : une révocation écrite avant la dernière
-- fonction créée laisserait précisément celle-ci avec son droit par défaut.
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction créée. Les relais
-- publics étaient donc appelables par le rôle `anon`, c'est-à-dire par un
-- visiteur non authentifié.
--
-- Aucun n'aurait rendu de donnée : ils commencent tous par résoudre le tenant,
-- et un appelant anonyme n'en a pas. Mais « la fonction refuse » et « la
-- fonction est inatteignable » ne sont pas la même garantie : la première
-- dépend de chaque implémentation, la seconde du droit d'accès.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on all functions in schema public to authenticated, service_role;
-- Les relais publics sont des fonctions SQL ordinaires : l'appelant doit
-- pouvoir atteindre la fonction `app` qu'elles appellent.
grant execute on all functions in schema app to authenticated, service_role;

-- Privilèges par défaut : ils accordent aux deux rôles applicatifs les
-- fonctions créées plus tard.
--
-- ⚠ Ils NE suffisent PAS à fermer l'accès de PUBLIC. `ALTER DEFAULT PRIVILEGES
-- … REVOKE EXECUTE … FROM PUBLIC` ne retire pas le droit intégré de
-- PostgreSQL, qui accorde EXECUTE à PUBLIC sur toute fonction créée : la forme
-- REVOKE n'annule que ce qu'un GRANT par défaut avait ajouté. Une révocation
-- explicite reste donc nécessaire APRÈS la création de la dernière fonction —
-- c'est l'objet de la migration 2400, et l'audit du catalogue échoue si elle
-- manque.
alter default privileges in schema public grant execute on functions to authenticated, service_role;
alter default privileges in schema app    grant execute on functions to authenticated, service_role;

-- `anon` n'a jamais eu USAGE sur le schéma `app` ; on l'inscrit explicitement
-- pour que la révoquer devienne un acte visible plutôt qu'un oubli.
revoke all on schema app from anon;
