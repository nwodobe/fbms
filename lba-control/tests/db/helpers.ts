/**
 * Outillage des tests de base de données.
 *
 * Le point important : `withUser` reproduit exactement le mécanisme
 * d'authentification de Supabase — `SET LOCAL ROLE authenticated` puis
 * `request.jwt.claims`. C'est le chemin de code que PostgREST exécute en
 * production, donc une politique qui passe ici passe chez Supabase.
 *
 * Chaque appel s'exécute dans une transaction annulée à la fin : les tests ne
 * peuvent pas se polluer mutuellement, et les cas d'écriture refusée n'ont pas
 * besoin de nettoyage.
 */
import { Pool, type PoolClient } from 'pg'

const PGHOST = process.env.LBA_PGHOST ?? '/var/tmp'
const PGPORT = Number(process.env.LBA_PGPORT ?? 54329)
const PGDATABASE = process.env.LBA_PGDATABASE ?? 'lba_control'
const PGUSER = process.env.LBA_PGUSER ?? 'postgres'

export const pool = new Pool({
  host: PGHOST,
  port: PGPORT,
  database: PGDATABASE,
  user: PGUSER,
  max: 8,
})

export type AppRole =
  | 'super_admin'
  | 'proprietaire'
  | 'gestionnaire'
  | 'comptable'
  | 'responsable_terrain'
  | 'pisteur'
  | 'auditeur'

export interface Actor {
  userId: string
  tenantId: string | null
  role: AppRole
  deviceId?: string
}

/** Exécute une requête avec les droits du propriétaire (contourne RLS, comme les migrations). */
export async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/**
 * Exécute un bloc en se faisant passer pour un utilisateur authentifié.
 * La transaction est systématiquement annulée : rien ne fuit d'un test à l'autre.
 */
export async function withUser<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  const claims = JSON.stringify({
    sub: actor.userId,
    role: 'authenticated',
    app_metadata: {
      tenant_id: actor.tenantId,
      role: actor.role,
      ...(actor.deviceId ? { device_id: actor.deviceId } : {}),
    },
  })

  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true)', ['request.jwt.claims', claims])
    await client.query('set local role authenticated')
    return await fn(client)
  } finally {
    try {
      await client.query('rollback')
    } catch {
      /* la transaction peut déjà être avortée : sans importance ici */
    }
    client.release()
  }
}

/**
 * Change d'acteur à l'intérieur d'une transaction en cours.
 * Indispensable pour tester un enchaînement réel — le client déclare un
 * paiement, l'administrateur le confirme — sans committer entre les deux.
 */
export async function switchActor(client: PoolClient, actor: Actor): Promise<void> {
  const claims = JSON.stringify({
    sub: actor.userId,
    role: 'authenticated',
    app_metadata: { tenant_id: actor.tenantId, role: actor.role },
  })
  await client.query('reset role')
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', claims])
  await client.query('set local role authenticated')
}

/**
 * Exécute un bloc avec les droits du propriétaire à l'intérieur d'une
 * transaction, puis restaure l'acteur. Sert à préparer un état qu'aucun
 * utilisateur n'a le droit de créer (une session d'assistance expirée,
 * par exemple).
 */
export async function asOwnerWithin<T>(
  client: PoolClient,
  actor: Actor,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('reset role')
  try {
    return await fn(client)
  } finally {
    await switchActor(client, actor)
  }
}

/** Renvoie le nombre de lignes visibles pour cet acteur. */
export async function countVisible(actor: Actor, table: string, where = 'true'): Promise<number> {
  return withUser(actor, async (c) => {
    const res = await c.query(`select count(*)::int as n from public.${table} where ${where}`)
    return res.rows[0].n as number
  })
}

/**
 * Vérifie qu'une requête est refusée.
 * Retourne le message d'erreur, pour pouvoir affirmer *pourquoi* elle a été refusée
 * et pas seulement qu'elle a échoué.
 */
export async function expectRejected(
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  try {
    await withUser(actor, (c) => c.query(sql, params))
  } catch (error) {
    return (error as Error).message
  }
  throw new Error(`La requête aurait dû être refusée mais elle a réussi :\n${sql}`)
}

/** Nombre de lignes réellement écrites par une commande (0 = silencieusement filtré par RLS). */
export async function affectedRows(actor: Actor, sql: string, params: unknown[] = []): Promise<number> {
  return withUser(actor, async (c) => {
    const res = await c.query(sql, params)
    return res.rowCount ?? 0
  })
}
