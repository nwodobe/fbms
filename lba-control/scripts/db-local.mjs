#!/usr/bin/env node
/**
 * Pilote un PostgreSQL local pour le développement et les tests RLS,
 * sans dépendre de Docker.
 *
 *   node scripts/db-local.mjs start   démarre le serveur, applique shim + migrations
 *   node scripts/db-local.mjs stop    arrête le serveur
 *   node scripts/db-local.mjs reset   repart d'une base vide
 *   node scripts/db-local.mjs psql    ouvre une session interactive
 *
 * Quand Docker est disponible, `supabase start` reste utilisable : les deux
 * chemins consomment les mêmes fichiers de supabase/migrations/.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

export const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin'
export const PGDATA = process.env.LBA_PGDATA ?? '/var/tmp/lba-control-pgdata'
export const PGHOST = process.env.LBA_PGHOST ?? '/var/tmp'
export const PGPORT = process.env.LBA_PGPORT ?? '54329'
export const PGDATABASE = process.env.LBA_PGDATABASE ?? 'lba_control'
export const PGUSER = process.env.LBA_PGUSER ?? 'postgres'

const isRoot = process.getuid?.() === 0
/** initdb et postgres refusent de tourner en root : on repasse par `su postgres`. */
const asPostgres = (cmd) => (isRoot ? ['su', ['postgres', '-c', cmd]] : ['sh', ['-c', cmd]])

function run(cmd, { quiet = false } = {}) {
  const [bin, args] = asPostgres(cmd)
  const res = spawnSync(bin, args, { encoding: 'utf8' })
  if (res.status !== 0 && !quiet) {
    throw new Error(`Échec : ${cmd}\n${res.stdout ?? ''}${res.stderr ?? ''}`)
  }
  return res
}

function psql(args, { input } = {}) {
  const res = spawnSync(join(PG_BIN, 'psql'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, PGOPTIONS: '--client-min-messages=warning' },
  })
  if (res.status !== 0) {
    throw new Error(`psql a échoué :\n${res.stdout ?? ''}${res.stderr ?? ''}`)
  }
  return res.stdout
}

export function isRunning() {
  const res = spawnSync(join(PG_BIN, 'pg_isready'), ['-h', PGHOST, '-p', PGPORT], { encoding: 'utf8' })
  return res.status === 0
}

export function start() {
  if (!existsSync(PGDATA)) {
    mkdirSync(PGDATA, { recursive: true })
    if (isRoot) execFileSync('chown', ['-R', 'postgres:postgres', PGDATA])
    run(`${join(PG_BIN, 'initdb')} -D ${PGDATA} -U ${PGUSER} --auth=trust -E UTF8 --locale=C`)
  }

  if (!isRunning()) {
    run(
      `${join(PG_BIN, 'pg_ctl')} -D ${PGDATA} ` +
        `-o "-p ${PGPORT} -k ${PGHOST} -c listen_addresses=" -l ${PGDATA}/server.log start`,
    )
    for (let i = 0; i < 40 && !isRunning(); i++) execFileSync('sleep', ['0.25'])
  }

  const exists = psql(['-d', 'postgres', '-tAc', `select 1 from pg_database where datname='${PGDATABASE}'`])
  if (!exists.trim()) {
    psql(['-d', 'postgres', '-c', `create database ${PGDATABASE}`])
  }

  applySchema()
  console.log(`PostgreSQL prêt sur ${PGHOST}:${PGPORT}/${PGDATABASE}`)
}

export function applySchema() {
  const shim = join(ROOT, 'supabase', 'local', '00_local_shim.sql')
  psql(['-d', PGDATABASE, '-v', 'ON_ERROR_STOP=1', '-q', '-f', shim])

  const dir = join(ROOT, 'supabase', 'migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    process.stdout.write(`  → ${file}\n`)
    psql(['-d', PGDATABASE, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, file)])
  }
  console.log(`${files.length} migrations appliquées.`)
}

export function stop() {
  if (isRunning()) run(`${join(PG_BIN, 'pg_ctl')} -D ${PGDATA} -m fast stop`)
  console.log('PostgreSQL arrêté.')
}

export function reset() {
  if (isRunning()) {
    psql(['-d', 'postgres', '-c', `drop database if exists ${PGDATABASE} with (force)`])
    psql(['-d', 'postgres', '-c', `create database ${PGDATABASE}`])
    applySchema()
  } else {
    start()
  }
  console.log('Base réinitialisée.')
}

export function connectionString() {
  return `postgresql://${PGUSER}@localhost/${PGDATABASE}?host=${PGHOST}&port=${PGPORT}`
}

const command = process.argv[2]
if (command) {
  const actions = { start, stop, reset, migrate: applySchema }
  if (command === 'psql') {
    spawnSync(join(PG_BIN, 'psql'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', PGDATABASE], {
      stdio: 'inherit',
    })
  } else if (actions[command]) {
    actions[command]()
  } else {
    console.error(`Commande inconnue : ${command}. Attendu : start | stop | reset | migrate | psql`)
    process.exit(1)
  }
}
