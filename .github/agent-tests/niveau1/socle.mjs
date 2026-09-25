// ============================================================================
// Banc d'essai Niveau 1 — socle commun
// ----------------------------------------------------------------------------
// Exécute du PostgreSQL AUTHENTIQUE (PGlite : PostgreSQL compilé en WebAssembly)
// sans Docker ni droits administrateur — les deux étant indisponibles sur le
// poste de travail. Ce n'est pas un simulacre : les contraintes, triggers et
// politiques RLS sont réellement évalués par PostgreSQL.
//
// CE QUE CE BANC NE PROUVE PAS
//   · le comportement de PostgREST ni des jetons JWT réels ;
//   · l'état de la base de production (schéma, volumétrie, doublons) ;
//   · la version exacte de PostgreSQL de Supabase (ici 18.3).
// Il prouve qu'une règle SQL donnée refuse bien ce qu'elle doit refuser.
//
// Installation : npm install --no-save @electric-sql/pglite@0.5.5
// Exécution    : node .github/agent-tests/niveau1/executer.mjs
// ============================================================================

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
export const RACINE = join(ICI, '..', '..', '..');
const DOSSIER_MIGRATIONS = join(RACINE, 'docs', 'migrations', 'niveau1');

// --- Comptes de test. Aucune donnée réelle : UUID fixes, noms fictifs. -------
export const COMPTES = {
  bm:        { id: '00000000-0000-4000-8000-000000000001', nom: 'BM Test',        role: 'Branch Manager',     cluster: 'ALPHA', fonction: 'Branch Manager' },
  // Un second Branch Manager est indispensable : sans lui, le contrôle à quatre
  // yeux sur les ajustements est intestable — et, sur le terrain, impossible.
  bm2:       { id: '00000000-0000-4000-8000-000000000007', nom: 'BM Test 2',      role: 'Branch Manager',     cluster: 'ALPHA', fonction: 'Branch Manager' },
  superviseur:{ id: '00000000-0000-4000-8000-000000000002', nom: 'Superviseur',   role: 'Supervisor',         cluster: 'ALPHA', fonction: 'Unit Head' },
  agent:     { id: '00000000-0000-4000-8000-000000000003', nom: 'Agent Test',     role: 'Agent Recenseur',    cluster: 'ALPHA', fonction: null },
  agent2:    { id: '00000000-0000-4000-8000-000000000004', nom: 'Agent Test 2',   role: 'Agent Recenseur',    cluster: 'ALPHA', fonction: null },
  controle:  { id: '00000000-0000-4000-8000-000000000005', nom: 'Controle Test',  role: 'Head of Field',      cluster: 'ALPHA', fonction: 'Zonal Head' },
  inactif:   { id: '00000000-0000-4000-8000-000000000006', nom: 'Inactif',        role: 'Agent Recenseur',    cluster: 'ALPHA', fonction: null, actif: false },
};

export const RT_TEST      = '00000000-0000-4000-9000-000000000011';
export const RT_TEST_2    = '00000000-0000-4000-9000-000000000012';
export const VILLAGE_TEST = '00000000-0000-4000-9000-000000000021';
export const PROD_TEST    = '00000000-0000-4000-9000-000000000031';

function migrations() {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => /^\d{8}_\d{2}_.*\.sql$/.test(f))
    .sort();
}

/** Démarre une base neuve : émulation Supabase + ligne de base + migrations. */
export async function demarrer({ jusqua = null, avecJeuDEssai = true } = {}) {
  const db = await new PGlite();
  await db.exec(readFileSync(join(ICI, 'baseline.sql'), 'utf8'));

  const appliquees = [];
  for (const f of migrations()) {
    if (jusqua && f > jusqua) break;
    try {
      await db.exec(readFileSync(join(DOSSIER_MIGRATIONS, f), 'utf8'));
      appliquees.push(f);
    } catch (e) {
      throw new Error(`Migration ${f} en échec : ${e.message}`);
    }
  }

  if (avecJeuDEssai) await jeuDEssai(db);
  db._migrations = appliquees;
  return db;
}

/** Profils, référentiels et paramètres minimaux. Aucune donnée réelle. */
export async function jeuDEssai(db) {
  for (const c of Object.values(COMPTES)) {
    await db.query(
      `insert into public.profils(user_id, nom, email, role, actif, fonction_operationnelle, cluster)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (user_id) do nothing`,
      [c.id, c.nom, `${c.nom.toLowerCase().replace(/\s+/g, '.')}@test.invalid`,
       c.role, c.actif !== false, c.fonction, c.cluster]);
  }
  await db.query(
    `insert into public.rt(id, data, village_nom) values ($1,$2,$3), ($4,$5,$6)
     on conflict (id) do nothing`,
    [RT_TEST,   { nom: 'RT Test', cluster: 'ALPHA', zone: 'ZONE1' }, 'Village Test',
     RT_TEST_2, { nom: 'RT Test 2', cluster: 'ALPHA', zone: 'ZONE1' }, 'Village Test']);
  await db.query(
    `insert into public.villages(id, data) values ($1,$2) on conflict (id) do nothing`,
    [VILLAGE_TEST, { nom: 'Village Test', cluster: 'ALPHA' }]);
  await db.query(
    `insert into public.producteurs(id, data, code, village_id) values ($1,$2,$3,$4)
     on conflict (id) do nothing`,
    [PROD_TEST, { nom: 'Producteur Test' }, 'PROD-TEST-001', VILLAGE_TEST]);

  // Campagne active : prérequis documenté de la migration 01.
  const aParametres = await db.query(
    `select count(*)::int c from information_schema.tables
     where table_schema='public' and table_name='n1_parametres'`);
  if (aParametres.rows[0].c > 0) {
    await connecter(db, COMPTES.bm);
    await db.query(`select public.n1_definir_parametre('campagne_active', null, 'AFLP2027', null,
                    'Jeu d''essai', 'GLOBAL')`);
    await deconnecter(db);
  }
}

/** Prend l'identité d'un compte, avec le rôle Postgres `authenticated`. */
export async function connecter(db, compte) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [compte.id]);
  await db.exec('set role authenticated');
}

export async function deconnecter(db) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}

/** Exécute en propriétaire de la base (équivaut à service_role / SQL Editor). */
export async function enProprietaire(db, fn) {
  await db.exec('reset role');
  const r = await fn();
  return r;
}

// --- Assertions --------------------------------------------------------------

export class Rapport {
  constructor(titre) { this.titre = titre; this.cas = []; }
  ok(nom, detail = '')   { this.cas.push({ nom, etat: 'REUSSI', detail }); }
  ko(nom, detail = '')   { this.cas.push({ nom, etat: 'ECHOUE', detail }); }
  get echecs() { return this.cas.filter((c) => c.etat === 'ECHOUE'); }
  get reussis() { return this.cas.filter((c) => c.etat === 'REUSSI'); }
}

/** Attend que l'opération SOIT REFUSÉE, et que le message contienne `motif`. */
export async function doitRefuser(rapport, nom, fn, motif = null) {
  try {
    await fn();
    rapport.ko(nom, 'ACCEPTÉ alors que le refus était attendu');
  } catch (e) {
    const m = String(e.message || e);
    if (motif && !m.toLowerCase().includes(String(motif).toLowerCase())) {
      rapport.ko(nom, `refusé, mais motif inattendu : ${m.slice(0, 160)}`);
    } else {
      rapport.ok(nom, m.split('\n')[0].slice(0, 120));
    }
  }
}

/** Attend que l'opération SOIT ACCEPTÉE. */
export async function doitAccepter(rapport, nom, fn) {
  try {
    const r = await fn();
    rapport.ok(nom);
    return r;
  } catch (e) {
    rapport.ko(nom, String(e.message || e).split('\n')[0].slice(0, 200));
    return null;
  }
}

export function doitEgaler(rapport, nom, obtenu, attendu) {
  const a = JSON.stringify(attendu);
  const o = JSON.stringify(obtenu);
  if (a === o) rapport.ok(nom); else rapport.ko(nom, `attendu ${a}, obtenu ${o}`);
}

export function doitEtreVrai(rapport, nom, condition, detail = '') {
  if (condition) rapport.ok(nom); else rapport.ko(nom, detail || 'condition fausse');
}
