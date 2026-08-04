/**
 * Savoir+ — Tables techniques : synchronisation, idempotence, fichiers,
 * audit, événements.
 * Voir docs/DATA_MODEL.md §7.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { assetScope, assetStatus, operationType, syncStatus, userRole } from './enums';

// ---------------------------------------------------------------------------
// offline_operations — miroir serveur de la file client.
// ---------------------------------------------------------------------------
export const offlineOperations = pgTable(
  'offline_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** ANTI-DOUBLON (ADR-006). Générée par le client À LA CRÉATION de
     *  l'intention, jamais à l'envoi : sinon un rejeu après expiration
     *  produirait une nouvelle clé, donc un doublon. */
    idempotencyKey: uuid('idempotency_key').notNull(),

    /** Toujours celui de la SESSION. Un `user_id` fourni par le client est
     *  ignoré ; une divergence est un incident de sécurité (R-S03). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    deviceId: uuid('device_id').notNull(),
    operationType: operationType('operation_type').notNull(),
    payload: jsonb('payload').notNull(),

    /**
     * Horodatage CLIENT — chronologie pédagogique affichée uniquement.
     * L'horloge d'un téléphone n'est pas fiable et ne doit jamais ordonner
     * une écriture serveur (OFFLINE_SYNC.md O4).
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** Horodatage SERVEUR — fait foi pour l'ordre d'écriture. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    syncStatus: syncStatus('sync_status').notNull().default('pending'),
    lastError: text('last_error'),
    serverVersion: integer('server_version'),
  },
  (t) => [
    uniqueIndex('offline_operations_idempotency_uq').on(t.idempotencyKey),
    index('offline_operations_user_status_idx').on(t.userId, t.syncStatus),
    check('offline_operations_attempts_ck', sql`${t.attemptCount} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// idempotency_records — couvre TOUTE écriture idempotente, y compris en
// ligne. Distincte de `offline_operations` (DATA_MODEL.md §7.2).
// ---------------------------------------------------------------------------
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    key: uuid('key').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operationType: operationType('operation_type').notNull(),

    /**
     * Empreinte de la requête. Même clé + hash DIFFÉRENT = conflit (409),
     * pas un rejeu : soit un bug client, soit une manipulation (C7).
     */
    requestHash: text('request_hash').notNull(),
    responsePayload: jsonb('response_payload'),
    status: text('status').notNull().default('completed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Rétention 30 jours. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('idempotency_records_user_idx').on(t.userId),
    index('idempotency_records_expires_idx').on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// file_assets — un objet R2 sans ligne `ready` est orphelin et sera purgé.
// ---------------------------------------------------------------------------
export const fileAssets = pgTable(
  'file_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `null` pour un asset de contenu pédagogique. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    bucket: text('bucket').notNull(),
    /** Clé GÉNÉRÉE côté serveur. Jamais le nom fourni par l'utilisateur. */
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum'),
    scope: assetScope('scope').notNull().default('content'),
    status: assetStatus('status').notNull().default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('file_assets_object_key_uq').on(t.objectKey),
    index('file_assets_owner_status_idx').on(t.ownerUserId, t.status),
    check('file_assets_size_ck', sql`${t.sizeBytes} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// audit_logs — APPEND-ONLY. Aucune route applicative ne permet de modifier
// ni de supprimer une ligne (AUTHORIZATION_MATRIX.md §10).
// ---------------------------------------------------------------------------
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `null` si l'action vient du système. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: userRole('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** Expurgés des secrets AVANT écriture (SECURITY.md §4.6). */
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt.desc()),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_action_idx').on(t.action, t.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// application_events — base des indicateurs du Product Brief.
// AUCUNE donnée personnelle identifiante dans `payload`.
// ---------------------------------------------------------------------------
export const applicationEvents = pgTable(
  'application_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('application_events_type_idx').on(t.eventType, t.occurredAt.desc()),
    index('application_events_user_idx').on(t.userId, t.occurredAt.desc()),
  ],
);
