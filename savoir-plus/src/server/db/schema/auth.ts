/**
 * Savoir+ — Authentification et profils.
 * Voir docs/DATA_MODEL.md §3.
 */
import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { linkInitiator, linkStatus, tokenPurpose, userRole, userStatus } from './enums';

/** Colonnes d'horodatage communes. `timestamptz` PARTOUT (DATA_MODEL.md §1). */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// users — source de vérité UNIQUE du rôle (DECISIONS.md ADR-003)
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),

    /**
     * Argon2id. `null` si le compte n'utilise que le magic link.
     * NE DOIT JAMAIS être sélectionné par un repository de lecture
     * (DATA_MODEL.md §10).
     */
    passwordHash: text('password_hash'),

    /** Relu en base à CHAQUE requête. Jamais lu depuis le client. */
    role: userRole('role').notNull().default('student'),
    status: userStatus('status').notNull().default('active'),

    // Champs requis par l'adaptateur Auth.js.
    name: text('name'),
    image: text('image'),

    ...timestamps,
  },
  (t) => [
    // Unicité insensible à la casse : « Anderson@… » et « anderson@… »
    // désignent la même personne.
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    index('users_role_status_idx').on(t.role, t.status),
  ],
);

// ---------------------------------------------------------------------------
// accounts — Auth.js. Existe dès le MVP MÊME VIDE, pour permettre l'ajout de
// Google plus tard sans migration (ARCHITECTURE.md §7).
// ---------------------------------------------------------------------------
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('accounts_provider_uq').on(t.provider, t.providerAccountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// sessions — stratégie BASE DE DONNÉES, pas JWT (DECISIONS.md ADR-002).
// Supprimer la ligne révoque immédiatement l'accès.
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionToken: text('session_token').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.sessionToken),
    index('sessions_user_idx').on(t.userId),
    // Sert la purge périodique des sessions expirées.
    index('sessions_expires_idx').on(t.expires),
  ],
);

// ---------------------------------------------------------------------------
// verification_tokens — jetons HACHÉS, à usage unique, séparés par usage.
// ---------------------------------------------------------------------------
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    /** Haché. Le jeton en clair n'existe que dans l'e-mail envoyé. */
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    purpose: tokenPurpose('purpose').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.identifier, t.token] }),
    index('verification_tokens_expires_idx').on(t.expires),
  ],
);

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    locale: text('locale').notNull().default('fr-CI'),
    timezone: text('timezone').notNull().default('Africa/Abidjan'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('profiles_user_uq').on(t.userId)],
);

// ---------------------------------------------------------------------------
// student_profiles
// ---------------------------------------------------------------------------
export const studentProfiles = pgTable(
  'student_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gradeLevel: text('grade_level').notNull().default('2nde_C'),
    schoolName: text('school_name'),

    /** Déclaratif, non vérifié. Ex. 9.57 */
    currentAverage: numeric('current_average', { precision: 4, scale: 2 }),
    targetAverage: numeric('target_average', { precision: 4, scale: 2 }),

    dailyMinutes: integer('daily_minutes').notNull().default(60),
    daysPerWeek: integer('days_per_week').notNull().default(5),

    /**
     * MINIMISATION (SECURITY.md §4.8) : l'année suffit à savoir s'il s'agit
     * d'un mineur. La date complète est une donnée personnelle inutile.
     */
    birthYear: integer('birth_year'),

    diagnosticCompletedAt: timestamp('diagnostic_completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('student_profiles_user_uq').on(t.userId),
    check('student_profiles_days_per_week_ck', sql`${t.daysPerWeek} between 1 and 7`),
    check('student_profiles_daily_minutes_ck', sql`${t.dailyMinutes} between 5 and 480`),
    check(
      'student_profiles_current_average_ck',
      sql`${t.currentAverage} is null or ${t.currentAverage} between 0 and 20`,
    ),
    check(
      'student_profiles_target_average_ck',
      sql`${t.targetAverage} is null or ${t.targetAverage} between 0 and 20`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// parent_profiles
// ---------------------------------------------------------------------------
export const parentProfiles = pgTable(
  'parent_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    phone: text('phone'),
    /** 0 = dimanche. */
    preferredReportDay: integer('preferred_report_day').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('parent_profiles_user_uq').on(t.userId),
    check('parent_profiles_report_day_ck', sql`${t.preferredReportDay} between 0 and 6`),
  ],
);

// ---------------------------------------------------------------------------
// parent_student_links — LA TABLE LA PLUS SENSIBLE DU MODÈLE.
// Toute requête parent part d'ici. Un défaut ici est une fuite de données
// concernant un mineur (SECURITY.md R-S05).
// ---------------------------------------------------------------------------
export const parentStudentLinks = pgTable(
  'parent_student_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentUserId: uuid('parent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SEUL `active` ouvre un droit de lecture. */
    status: linkStatus('status').notNull().default('pending'),

    /** Code d'invitation HACHÉ. Jamais stocké en clair. */
    invitationCodeHash: text('invitation_code_hash'),
    invitedBy: linkInitiator('invited_by').notNull(),
    invitationExpiresAt: timestamp('invitation_expires_at', { withTimezone: true }),

    activatedAt: timestamp('activated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('parent_student_links_pair_uq').on(t.parentUserId, t.studentUserId),
    check('parent_student_links_distinct_ck', sql`${t.parentUserId} <> ${t.studentUserId}`),
    // Index PARTIEL : la requête d'autorisation « les enfants de ce parent »
    // s'exécute à chaque page parent et ne porte que sur les liens actifs.
    index('parent_student_links_parent_active_idx')
      .on(t.parentUserId)
      .where(sql`status = 'active'`),
    index('parent_student_links_student_idx').on(t.studentUserId),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  studentProfile: one(studentProfiles, {
    fields: [users.id],
    references: [studentProfiles.userId],
  }),
  parentProfile: one(parentProfiles, {
    fields: [users.id],
    references: [parentProfiles.userId],
  }),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const parentStudentLinksRelations = relations(parentStudentLinks, ({ one }) => ({
  parent: one(users, {
    fields: [parentStudentLinks.parentUserId],
    references: [users.id],
    relationName: 'parent',
  }),
  student: one(users, {
    fields: [parentStudentLinks.studentUserId],
    references: [users.id],
    relationName: 'student',
  }),
}));
