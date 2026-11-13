-- OBSERVATOIRE — jeu de données 100 % FICTIF pour le test navigateur de bout en bout.
-- Réplique LOCALE uniquement. Aucun producteur, village ou compte réel.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'bm@example.invalid'), ('00000000-0000-4000-8000-0000000000a2', 'zh1@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'uh.bro@example.invalid'), ('00000000-0000-4000-8000-0000000000a4', 'auh.bro@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a5', 'uh.bot@example.invalid'), ('00000000-0000-4000-8000-0000000000a6', 'rt@example.invalid')
on conflict do nothing;
insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values
  ('00000000-0000-4000-8000-0000000000a1', 'bm@example.invalid', 'BM FICTIF', 'Branch Manager', null, null, true),
  ('00000000-0000-4000-8000-0000000000a2', 'zh1@example.invalid', 'ZH GBEKE 1 FICTIF', 'Zonal Head', null, 'GBEKE 1', true),
  ('00000000-0000-4000-8000-0000000000a3', 'uh.bro@example.invalid', 'UH BROBO FICTIF', 'Unit Head', 'BROBO', 'GBEKE 1', true),
  ('00000000-0000-4000-8000-0000000000a4', 'auh.bro@example.invalid', 'AUH BROBO FICTIF', 'Assistant Unit Head', 'BROBO', 'GBEKE 1', true),
  ('00000000-0000-4000-8000-0000000000a5', 'uh.bot@example.invalid', 'UH BOTRO FICTIF', 'Unit Head', 'BOTRO', 'GBEKE 2', true),
  ('00000000-0000-4000-8000-0000000000a6', 'rt@example.invalid', 'RT FICTIF', 'RT', 'BROBO', 'GBEKE 1', true)
on conflict do nothing;
insert into public.campaigns (id, code, name, year, status, is_current, campaign_type) values
  ('10000000-0000-4000-8000-000000000001', '2097', 'CAMPAGNE FICTIVE E2E', 2097, 'OPEN', true, 'SIMULATION') on conflict do nothing;
insert into public.villages (id, data, village, cluster, cluster_code) values
  ('V-E2E-BRO', '{}', 'VILLAGE FICTIF BROBO', 'Brobo', 'BROBO'), ('V-E2E-BOT', '{}', 'VILLAGE FICTIF BOTRO', 'Botro', 'BOTRO') on conflict do nothing;
insert into public.producteurs (id, data, nom, code, village_id) values
  ('P-E2E-1', '{}', 'PRODUCTEUR FICTIF UN', 'BROBO-9001', 'V-E2E-BRO'), ('P-E2E-2', '{}', 'PRODUCTEUR FICTIF DEUX', 'BROBO-9002', 'V-E2E-BRO'),
  ('P-E2E-3', '{}', 'PRODUCTEUR FICTIF TROIS', 'BOTRO-9001', 'V-E2E-BOT') on conflict do nothing;
insert into public.farmer_plots (id, producteur_id, village_id, local_name, tree_count) values
  ('20000000-0000-4000-8000-000000000001', 'P-E2E-1', 'V-E2E-BRO', 'PARCELLE FICTIVE UN', 120),
  ('20000000-0000-4000-8000-000000000002', 'P-E2E-2', 'V-E2E-BRO', 'PARCELLE FICTIVE DEUX', 80),
  ('20000000-0000-4000-8000-000000000003', 'P-E2E-3', 'V-E2E-BOT', 'PARCELLE FICTIVE TROIS', 60) on conflict do nothing;
-- La réplique n'a pas la RLS de production sur ces référentiels : lecture ouverte aux comptes connectés pour le test.
grant select on public.farmer_plots, public.villages, public.producteurs, public.campaigns, public.aflp_clusters, public.aflp_zones to authenticated;
-- Politiques de lecture PROPRES AU TEST (la réplique a la RLS activée sans les politiques de production).
drop policy if exists e2e_lecture_villages on public.villages;
create policy e2e_lecture_villages on public.villages for select to authenticated using (true);
drop policy if exists e2e_lecture_producteurs on public.producteurs;
create policy e2e_lecture_producteurs on public.producteurs for select to authenticated using (true);
drop policy if exists e2e_lecture_clusters on public.aflp_clusters;
create policy e2e_lecture_clusters on public.aflp_clusters for select to authenticated using (true);

-- Graine de campagne FICTIVE (en production : créée par le BM via pheno_graine_creer).
insert into public.pheno_graines (campaign_id, graine, cree_par) values ('10000000-0000-4000-8000-000000000001', repeat('ab', 32), '00000000-0000-4000-8000-0000000000a1') on conflict do nothing;
