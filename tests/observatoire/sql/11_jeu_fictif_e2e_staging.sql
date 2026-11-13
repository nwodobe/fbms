-- OBSERVATOIRE — jeu FICTIF pour le test navigateur sur le STAGING FIDÈLE.
-- Contrairement à 10_jeu_fictif_e2e.sql, AUCUNE politique ni aucun droit n'est ajouté :
-- la RLS et les déclencheurs de production s'appliquent tels quels.
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
-- Écritures du référentiel fictif sous l'identité du Branch Manager fictif (gardes de production actives).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', false);
insert into public.campaigns (id, code, name, year, status, is_current, campaign_type) values
  ('10000000-0000-4000-8000-000000000001', '2097', 'CAMPAGNE FICTIVE E2E', 2097, 'OPEN', true, 'SIMULATION') on conflict do nothing;
insert into public.villages (id, data, village, cluster, cluster_code) values
  ('V-E2E-BRO', '{}', 'VILLAGE FICTIF BROBO', 'Brobo', 'BROBO'), ('V-E2E-BOT', '{}', 'VILLAGE FICTIF BOTRO', 'Botro', 'BOTRO') on conflict do nothing;
insert into public.rt (id, data, nom, village_id) values ('RT-E2E-BRO', '{}', 'RT FICTIF BROBO', 'V-E2E-BRO'), ('RT-E2E-BOT', '{}', 'RT FICTIF BOTRO', 'V-E2E-BOT') on conflict do nothing;
insert into public.producteurs (id, data, nom, village_id, rt_id) values
  ('P-E2E-1', '{}', 'PRODUCTEUR FICTIF UN', 'V-E2E-BRO', 'RT-E2E-BRO'), ('P-E2E-2', '{}', 'PRODUCTEUR FICTIF DEUX', 'V-E2E-BRO', 'RT-E2E-BRO'),
  ('P-E2E-3', '{}', 'PRODUCTEUR FICTIF TROIS', 'V-E2E-BOT', 'RT-E2E-BOT') on conflict do nothing;
insert into public.farmer_plots (id, producteur_id, village_id, local_name, tree_count) values
  ('20000000-0000-4000-8000-000000000001', 'P-E2E-1', 'V-E2E-BRO', 'PARCELLE FICTIVE UN', 120),
  ('20000000-0000-4000-8000-000000000002', 'P-E2E-2', 'V-E2E-BRO', 'PARCELLE FICTIVE DEUX', 80),
  ('20000000-0000-4000-8000-000000000003', 'P-E2E-3', 'V-E2E-BOT', 'PARCELLE FICTIVE TROIS', 60) on conflict do nothing;
insert into public.pheno_graines (campaign_id, graine, cree_par) values ('10000000-0000-4000-8000-000000000001', repeat('ab', 32), '00000000-0000-4000-8000-0000000000a1') on conflict do nothing;
