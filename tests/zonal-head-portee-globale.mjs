/* Chef de Zone (Zonal Head) — portée terrain globale, sans suppression.
   Deux garanties vérifiées ici :
     1. la matrice côté client (shared/aflp-access.js), qui pilote réellement
        l'affichage et la logique de fbms/index.html via ACL.can() ;
     2. la présence, dans la migration versionnée, des garde-fous serveur qui
        sont la seule vraie barrière (RLS + trigger anti-suppression logique).
   Le frontend n'est jamais considéré comme la barrière de sécurité. */
import fs from 'node:fs';
import vm from 'node:vm';

function has(x, msg) { if (!x) throw new Error(msg); }

/* ---- 1. Matrice client ---------------------------------------------------- */
const src = fs.readFileSync('shared/aflp-access.js', 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const A = sandbox.window.AFLP_ACCESS;
has(A, 'AFLP_ACCESS doit être exposé');

const zh = { nom: 'ZH', role: 'Zonal Head', actif: true, zone: null, cluster: null };
const uh = { nom: 'UH', role: 'Unit Head', actif: true, zone: 'GBEKE_2', cluster: 'BEOUMI' };
const ar = { nom: 'AR', role: 'Agent Recenseur', actif: true, zone: 'GBEKE_1', cluster: 'DJEBONOUA', village_id: 'v_x' };
const bm = { nom: 'BM', role: 'Branch Manager', actif: true };

/* Deux cibles dans deux zones différentes, désignées par leur cluster :
   aucun code de zone n'est écrit en dur dans la logique testée. */
const zones = A.ZONES.map(z => z.code);
has(zones.length >= 2, 'le référentiel doit contenir au moins deux zones');
const cibleA = { cluster: A.clustersOfZone(zones[0])[0].label };
const cibleB = { cluster: A.clustersOfZone(zones[1])[0].label };

const cas = [
  ['voir producteurs zone B',      zh, 'read',   'producteurs', cibleB, true],
  ['voir villages zone B',         zh, 'read',   'villages',    cibleB, true],
  ['voir RT zone B',               zh, 'read',   'rt',          cibleB, true],
  ['créer village zone B',         zh, 'create', 'villages',    cibleB, true],
  ['créer RT zone B',              zh, 'create', 'rt',          cibleB, true],
  ['créer producteur zone B',      zh, 'create', 'producteurs', cibleB, true],
  ['modifier village zone A',      zh, 'update', 'villages',    cibleA, true],
  ['modifier RT zone B',           zh, 'update', 'rt',          cibleB, true],
  ['modifier producteur zone B',   zh, 'update', 'producteurs', cibleB, true],
  ['SUPPRIMER village',            zh, 'delete', 'villages',    cibleA, false],
  ['SUPPRIMER RT',                 zh, 'delete', 'rt',          cibleB, false],
  ['SUPPRIMER producteur',         zh, 'delete', 'producteurs', cibleB, false],
  ['administrer les comptes',      zh, 'admin',  'utilisateurs', null,  false],
  ['créer un compte',              zh, 'create', 'utilisateurs', null,  false],
  ['modifier le référentiel',      zh, 'update', 'referentiel',  null,  false],
  /* Non-régression : les autres rôles gardent exactement leur périmètre. */
  ['NR Unit Head hors cluster',    uh, 'update', 'producteurs', cibleA, false],
  ['NR Unit Head dans cluster',    uh, 'update', 'producteurs', cibleB, true],
  ['NR Agent Recenseur hors zone', ar, 'update', 'villages',    cibleB, false],
  ['NR Branch Manager supprime',   bm, 'delete', 'villages',    cibleA, true],
];
cas.forEach(([lib, u, action, res, cible, attendu]) => {
  const obtenu = A.can(u, action, res, cible);
  has(obtenu === attendu, `Chef de Zone — ${lib} : attendu ${attendu}, obtenu ${obtenu}`);
});

/* Aucune permission de suppression ne doit exister dans la matrice du rôle. */
has(!A.PERMISSIONS.ZONAL_HEAD.some(p => /:(delete)$/.test(p)),
  'la matrice ZONAL_HEAD ne doit contenir aucune permission de suppression');
has(!A.PERMISSIONS.ZONAL_HEAD.some(p => /^utilisateurs:(?!read$)/.test(p)),
  'la matrice ZONAL_HEAD ne doit accorder que la lecture sur utilisateurs');

/* Portée globale dynamique : toutes les zones du référentiel, sans liste en dur. */
const perimetre = A.scopeOf(A.normalizeUser(zh));
has(perimetre.level === 'GLOBAL', 'le Chef de Zone doit avoir une portée terrain globale');
has(perimetre.zones.length === zones.length, 'la portée doit couvrir toutes les zones déclarées');
has(A.scopeFields('Zonal Head').length === 0, 'aucun périmètre ne doit plus être exigé du Chef de Zone');
has(A.niveauPortail('Zonal Head') === 'chef', "le Chef de Zone ne doit pas passer au niveau portail 'bm'");

/* Le filtrage de listes ne doit plus rien retirer au Chef de Zone. */
const lignes = [{ cluster: cibleA.cluster }, { cluster: cibleB.cluster }];
has(A.filterByScope(A.normalizeUser(zh), lignes).length === 2,
  'le Chef de Zone doit voir les fiches de toutes les zones dans les listes');
has(A.filterByScope(A.normalizeUser(uh), lignes).length === 1,
  'le Unit Head doit rester filtré sur son seul cluster');

/* ---- 2. Garde-fous serveur (migration versionnée) -------------------------- */
const sql = fs.readFileSync('supabase/20260917_zonal_head_global_field_access.sql', 'utf8');
has(/create or replace function public\.portee_terrain_globale/i.test(sql),
  'la migration doit définir public.portee_terrain_globale()');
has(/'Zonal Head'/.test(sql), 'la portée globale doit être accordée au rôle Zonal Head');
has(/farmer_registry_can_access_village/.test(sql),
  'la migration doit passer par le point de décision géographique unique');
has(/portee_terrain_globale\(\) then return true/.test(sql),
  'le court-circuit géographique doit être explicite');
has(/villages_delete_bm_only_guard/.test(sql) && /as restrictive for delete/i.test(sql),
  'une garde RESTRICTIVE de suppression doit exister sur villages');
has(!/grant .*delete.* to authenticated/i.test(sql),
  'la migration ne doit accorder aucun droit de suppression');
has(!/disable row level security/i.test(sql), 'la migration ne doit jamais désactiver la RLS');
has(!/service_role/i.test(sql), 'aucune référence à service_role dans une migration applicative');

/* Le repli global implicite retiré en base ne doit pas être réintroduit. */
has(!fs.existsSync('supabase/20260917_perimetre_obligatoire_fin_fallback_global.sql'),
  'la migration obsolète de repli global ne doit plus exister dans le dépôt');

console.log('Chef de Zone — portée globale, création et modification, aucune suppression : OK');
