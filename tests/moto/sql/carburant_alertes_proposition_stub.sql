-- Schéma minimal FICTIF pour rejouer la proposition d'alertes carburant hors production.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
create schema private;
create function private.moto_classe() returns text language sql as $$ select 'BM' $$;
create function private.moto_dans_perimetre(uuid) returns boolean language sql as $$ select true $$;
create table public.moto_motos (id uuid primary key, code text, compteur_actuel_km numeric, mise_en_service_at timestamptz, actif boolean default true);
create table public.moto_releves_km (moto_id uuid, date_releve timestamptz, compteur_km numeric);
create table public.moto_carburant (id uuid primary key default gen_random_uuid(), moto_id uuid, date_achat timestamptz, compteur_km numeric, litres numeric, plein_complet boolean, justificatif_statut text);
create table public.moto_missions (moto_id uuid, depart_at timestamptz, depart_km numeric);
-- Fixtures fictives (kilométrages de référence du 6/11/2026)
insert into moto_motos values ('00000000-0000-0000-0000-000000000003','MOTO-003',231,'2026-11-04T10:00Z'),('00000000-0000-0000-0000-000000000004','MOTO-004',150,'2026-11-04T10:00Z'),('00000000-0000-0000-0000-000000000009','MOTO-SANS',10,'2026-11-04T10:00Z');
insert into moto_releves_km values ('00000000-0000-0000-0000-000000000003','2026-11-06T09:30:48Z',231),('00000000-0000-0000-0000-000000000004','2026-11-06T13:43:36Z',150),('00000000-0000-0000-0000-000000000009','2026-11-06T13:00Z',10);
insert into moto_carburant(moto_id,date_achat,compteur_km,litres,plein_complet,justificatif_statut) values ('00000000-0000-0000-0000-000000000003','2026-11-04T17:15:19Z',2,9.95,true,'A_VERIFIER'),('00000000-0000-0000-0000-000000000004','2026-11-04T17:25:42Z',5,12.16,true,'A_VERIFIER');
insert into moto_missions values ('00000000-0000-0000-0000-000000000003','2026-11-04T17:10:35Z',2),('00000000-0000-0000-0000-000000000004','2026-11-04T17:19:07Z',5);
