-- ============================================================================
-- Vérification de rls_roles_aflp_20260822.sql
-- ----------------------------------------------------------------------------
-- À exécuter APRÈS la migration, dans le SQL Editor du même projet.
-- Chaque requête doit renvoyer ce que sa colonne « attendu » annonce. Aucune
-- ne modifie quoi que ce soit.
-- ============================================================================

-- 1. Tout rôle proposé par l'écran d'administration est-il reconnu ?
--    Attendu : AUCUNE ligne en dehors des deux rôles en lecture seule.
with roles_portail(libelle, niveau) as (values
  ('Branch Manager','bm'),
  ('Branch Manager / Head of Programme','bm'),
  ('Assistant Branch Manager','bm'),
  ('Head of Field','bm'),
  ('Procurement Officer','bm'),
  ('Supervisor','chef'),
  ('Zonal Head','chef'),
  ('Logistics Coordinator','chef'),
  ('Unit Head','chef'),
  ('Assistant Unit Head','chef'),
  ('Finance / Controller','chef'),
  ('Agent Recenseur','agent'),
  ('Warehouse Keeper','agent'),
  ('RT / Field Partner','agent'),
  ('Consultation uniquement','direction'),
  ('Read Only / Audit','direction')
)
select
  libelle,
  niveau,
  prosrc like '%''' || libelle || '''%' as reconnu_ecriture_terrain,
  case when niveau = 'direction' then 'lecture seule : absence normale'
       else 'DOIT être reconnu' end as attendu
from roles_portail,
     (select prosrc from pg_proc where proname = 'peut_editer_terrain') f
where prosrc not like '%''' || libelle || '''%'
order by niveau, libelle;

-- 2. Les rôles en lecture seule n'ont-ils toujours aucun droit d'écriture ?
--    Attendu : deux lignes, toutes deux à false.
select r.libelle,
       (select prosrc from pg_proc where proname='peut_editer_terrain') like '%'''||r.libelle||'''%' as ecrit_terrain,
       (select prosrc from pg_proc where proname='peut_editer_config')  like '%'''||r.libelle||'''%' as ecrit_config
from (values ('Consultation uniquement'), ('Read Only / Audit')) as r(libelle);

-- 3. `est_bm()` reste-t-il étroit ?
--    Attendu : la fonction cite exactement 'Branch Manager' et
--    'Branch Manager / Head of Programme', et RIEN d'autre.
select prosrc as corps_est_bm from pg_proc where proname = 'est_bm';

-- 4. Les magasiniers et partenaires RT sont-ils bien exclus de la config ?
--    Attendu : deux lignes, toutes deux à false.
select r.libelle,
       (select prosrc from pg_proc where proname='peut_editer_config') like '%'''||r.libelle||'''%' as ecrit_config
from (values ('Warehouse Keeper'), ('RT / Field Partner')) as r(libelle);

-- 5. Comptes réellement en base dont le rôle resterait non reconnu.
--    Attendu : AUCUNE ligne. Si une ligne apparaît, un compte actif ne peut
--    rien enregistrer — c'est exactement le défaut que la migration corrige.
select p.email, p.role, p.actif
from public.profils p
where p.actif = true
  and p.role not in ('Consultation uniquement', 'Read Only / Audit')
  and (select prosrc from pg_proc where proname = 'peut_editer_terrain') not like '%''' || p.role || '''%'
order by p.role, p.email;

-- 6. La RLS est-elle bien active sur les tables sensibles ?
--    Attendu : rowsecurity = true partout.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('villages','hubs_clusters','rt','producteurs','profils','achats','avances','audit_log')
order by tablename;
