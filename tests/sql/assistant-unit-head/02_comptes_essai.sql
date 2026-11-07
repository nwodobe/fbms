-- Comptes 100 % synthétiques (domaine réservé example.test). Créés par
-- « procédure administrateur » (auth.uid() nul), APRÈS la migration : avant elle,
-- la contrainte profils_role_check refuse le rôle (voir phase AVANT).
insert into auth.users(id,email) values
  ('00000000-0000-4000-9000-000000000001','zzauh.bm@example.test'),
  ('00000000-0000-4000-9000-000000000002','zzauh.abm@example.test'),
  ('00000000-0000-4000-9000-000000000003','zzauh.zh@example.test'),
  ('00000000-0000-4000-9000-000000000004','zzauh.uh.botro@example.test'),
  ('00000000-0000-4000-9000-000000000005','zzauh.uh.brobo@example.test'),
  ('00000000-0000-4000-9000-000000000006','zzauh.auh.botro.a@example.test'),
  ('00000000-0000-4000-9000-000000000007','zzauh.auh.botro.b@example.test'),
  ('00000000-0000-4000-9000-000000000008','zzauh.auh.brobo@example.test'),
  ('00000000-0000-4000-9000-000000000009','zzauh.auh.botro.x@example.test')
on conflict do nothing;
insert into public.profils(user_id,email,nom,role,actif,cluster) values
  ('00000000-0000-4000-9000-000000000001','zzauh.bm@example.test','ZZAUH BM','Branch Manager',true,null),
  ('00000000-0000-4000-9000-000000000002','zzauh.abm@example.test','ZZAUH ABM','Assistant Branch Manager',true,null),
  ('00000000-0000-4000-9000-000000000003','zzauh.zh@example.test','ZZAUH ZH','Zonal Head',true,null),
  ('00000000-0000-4000-9000-000000000004','zzauh.uh.botro@example.test','ZZAUH UH BOTRO','Unit Head',true,'BOTRO'),
  ('00000000-0000-4000-9000-000000000005','zzauh.uh.brobo@example.test','ZZAUH UH BROBO','Unit Head',true,'BROBO'),
  ('00000000-0000-4000-9000-000000000006','zzauh.auh.botro.a@example.test','ZZAUH AUH BOTRO A','Assistant Unit Head',true,'Botro'),
  ('00000000-0000-4000-9000-000000000007','zzauh.auh.botro.b@example.test','ZZAUH AUH BOTRO B','Assistant Unit Head',true,'BOTRO'),
  ('00000000-0000-4000-9000-000000000008','zzauh.auh.brobo@example.test','ZZAUH AUH BROBO','Assistant Unit Head',true,'brobo'),
  ('00000000-0000-4000-9000-000000000009','zzauh.auh.botro.x@example.test','ZZAUH AUH BOTRO X','Assistant Unit Head',true,'BOTRO')
on conflict do nothing;
