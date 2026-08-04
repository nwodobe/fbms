/**
 * Savoir+ — Progression, erreurs, révision, évaluations, rapports.
 * Voir docs/DATA_MODEL.md §6.
 */
import { relations, sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, users } from './auth';
import { chapters, exerciseVersions, lessonVersions, skills } from './pedagogy';
import {
  assessmentType,
  attemptStatus,
  contentStatus,
  errorCategory,
  errorStatus,
  masteryStatus,
  measureSource,
  revisionItemResult,
  revisionStatus,
  sessionSource,
  sessionStatus,
} from './enums';

// ---------------------------------------------------------------------------
// student_skill_levels — TABLE DÉRIVÉE, intégralement recalculable.
// L'existence de `scripts/maintenance/recompute-mastery.ts` est une exigence
// de conception : sans lui, une régression de scoring serait irréparable.
// ---------------------------------------------------------------------------
export const studentSkillLevels = pgTable(
  'student_skill_levels',
  {
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    status: masteryStatus('status').notNull().default('not_evaluated'),
    successRate: numeric('success_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Nombre TOTAL de mesures, pas seulement celles de la fenêtre glissante. */
    evaluatedCount: integer('evaluated_count').notNull().default(0),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    source: measureSource('source'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('student_skill_levels_pk').on(t.studentUserId, t.skillId),
    index('student_skill_levels_student_status_idx').on(t.studentUserId, t.status),
    check('student_skill_levels_rate_ck', sql`${t.successRate} between 0 and 100`),
    check('student_skill_levels_count_ck', sql`${t.evaluatedCount} >= 0`),
    // PEDAGOGY.md §3.2 : une compétence mesurée moins de 2 fois ne peut JAMAIS
    // être déclarée maîtrisée. La règle est portée par la base, pas seulement
    // par le code : c'est la dernière ligne de défense.
    check(
      'student_skill_levels_mastery_requires_two_measures_ck',
      sql`${t.status} <> 'mastered' or ${t.evaluatedCount} >= 2`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// error_logs — UNE ligne par (élève, compétence, catégorie), incrémentée.
// C'est ce qui rend le comptage de récurrence exact même en cas de rejeu.
// ---------------------------------------------------------------------------
export const errorLogs = pgTable(
  'error_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    category: errorCategory('category').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    status: errorStatus('status').notNull().default('open'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastExerciseVersionId: uuid('last_exercise_version_id').references(() => exerciseVersions.id, {
      onDelete: 'set null',
    }),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('error_logs_student_skill_category_uq').on(t.studentUserId, t.skillId, t.category),
    index('error_logs_student_status_idx').on(t.studentUserId, t.status),
    // Index PARTIEL : « erreurs à réviser », cœur de la répétition espacée.
    index('error_logs_next_review_idx')
      .on(t.studentUserId, t.nextReviewAt)
      .where(sql`status <> 'resolved'`),
    check('error_logs_occurrence_ck', sql`${t.occurrenceCount} >= 1`),
    // PEDAGOGY.md §5.2 : seuil STRICT de 3, pas « environ trois fois ».
    check(
      'error_logs_recurrent_threshold_ck',
      sql`${t.status} <> 'recurrent' or ${t.occurrenceCount} >= 3`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// revision_plans
// ---------------------------------------------------------------------------
export const revisionPlans = pgTable(
  'revision_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    errorLogId: uuid('error_log_id').references(() => errorLogs.id, { onDelete: 'set null' }),

    /** 0 → J+1, 1 → J+3, 2 → J+7, 3 → J+14, 4 → J+30. */
    intervalIndex: integer('interval_index').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: revisionStatus('status').notNull().default('scheduled'),
    consecutiveSuccess: integer('consecutive_success').notNull().default(0),
    consecutiveFailure: integer('consecutive_failure').notNull().default(0),
    lastResult: revisionItemResult('last_result'),
    ...timestamps,
  },
  (t) => [
    /**
     * GARANTIE « AUCUNE DUPLICATION » de la Phase 9 : une seule révision
     * active par cible. `coalesce` traite `null` comme une valeur, sans quoi
     * l'unicité serait inopérante sur les plans sans erreur associée.
     */
    uniqueIndex('revision_plans_one_active_uq')
      .on(
        t.studentUserId,
        t.skillId,
        sql`coalesce(${t.errorLogId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`status = 'scheduled'`),
    // Index PARTIEL : « révisions dues aujourd'hui », exécutée à chaque
    // ouverture de l'application.
    index('revision_plans_due_idx')
      .on(t.studentUserId, t.dueAt)
      .where(sql`status = 'scheduled'`),
    check('revision_plans_interval_ck', sql`${t.intervalIndex} between 0 and 4`),
    check(
      'revision_plans_counters_ck',
      sql`${t.consecutiveSuccess} >= 0 and ${t.consecutiveFailure} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// revision_sessions / revision_session_items
// ---------------------------------------------------------------------------
export const revisionSessions = pgTable(
  'revision_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plannedFor: date('planned_for').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    plannedMinutes: integer('planned_minutes').notNull().default(60),
    actualDurationMs: integer('actual_duration_ms').notNull().default(0),
    status: sessionStatus('status').notNull().default('planned'),
    source: sessionSource('source').notNull().default('auto'),
    ...timestamps,
  },
  (t) => [
    index('revision_sessions_student_date_idx').on(t.studentUserId, t.plannedFor.desc()),
    check('revision_sessions_minutes_ck', sql`${t.plannedMinutes} > 0`),
  ],
);

export const revisionSessionItems = pgTable(
  'revision_session_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revisionSessionId: uuid('revision_session_id')
      .notNull()
      .references(() => revisionSessions.id, { onDelete: 'cascade' }),
    revisionPlanId: uuid('revision_plan_id').references(() => revisionPlans.id, {
      onDelete: 'set null',
    }),
    exerciseVersionId: uuid('exercise_version_id').references(() => exerciseVersions.id, {
      onDelete: 'restrict',
    }),
    lessonVersionId: uuid('lesson_version_id').references(() => lessonVersions.id, {
      onDelete: 'restrict',
    }),
    position: integer('position').notNull(),
    result: revisionItemResult('result'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('revision_session_items_position_uq').on(t.revisionSessionId, t.position),
    // Exactement UNE référence de contenu non nulle.
    check(
      'revision_session_items_single_target_ck',
      sql`(case when ${t.revisionPlanId} is not null then 1 else 0 end
         + case when ${t.exerciseVersionId} is not null then 1 else 0 end
         + case when ${t.lessonVersionId} is not null then 1 else 0 end) = 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// assessments
// ---------------------------------------------------------------------------
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    type: assessmentType('type').notNull().default('chapter'),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    status: contentStatus('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    ...timestamps,
  },
  (t) => [index('assessments_chapter_status_idx').on(t.chapterId, t.status)],
);

export const assessmentQuestions = pgTable(
  'assessment_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    statement: text('statement').notNull(),
    /** SECRET. */
    correctAnswer: jsonb('correct_answer').notNull(),
    points: numeric('points', { precision: 6, scale: 2 }).notNull().default('1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('assessment_questions_position_uq').on(t.assessmentId, t.position),
    check('assessment_questions_points_ck', sql`${t.points} > 0`),
  ],
);

export const assessmentAttempts = pgTable(
  'assessment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'restrict' }),
    status: attemptStatus('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    totalScore: numeric('total_score', { precision: 8, scale: 2 }),
    maxScore: numeric('max_score', { precision: 8, scale: 2 }),
    answers: jsonb('answers')
      .notNull()
      .default(sql`'[]'::jsonb`),
    perSkillBreakdown: jsonb('per_skill_breakdown'),
    ...timestamps,
  },
  (t) => [index('assessment_attempts_student_idx').on(t.studentUserId, t.startedAt.desc())],
);

// ---------------------------------------------------------------------------
// weekly_reports — TABLE LUE PAR LE PARENT.
// Elle ne contient QUE des agrégats. Cette séparation physique est ce qui
// garantit techniquement qu'un parent ne voit aucune réponse brute
// (AUTHORIZATION_MATRIX.md §4.7).
// ---------------------------------------------------------------------------
export const weeklyReports = pgTable(
  'weekly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
    weekEnd: date('week_end').notNull(),
    sessionsCompleted: integer('sessions_completed').notNull().default(0),
    totalMinutes: integer('total_minutes').notNull().default(0),
    exercisesAttempted: integer('exercises_attempted').notNull().default(0),
    successRate: numeric('success_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    firstTrySuccessRate: numeric('first_try_success_rate', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    skillsImproved: jsonb('skills_improved')
      .notNull()
      .default(sql`'[]'::jsonb`),
    topDifficulties: jsonb('top_difficulties')
      .notNull()
      .default(sql`'[]'::jsonb`),
    recurrentErrors: jsonb('recurrent_errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('weekly_reports_student_week_uq').on(t.studentUserId, t.weekStart),
    check('weekly_reports_range_ck', sql`${t.weekEnd} > ${t.weekStart}`),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const errorLogsRelations = relations(errorLogs, ({ one }) => ({
  student: one(users, { fields: [errorLogs.studentUserId], references: [users.id] }),
  skill: one(skills, { fields: [errorLogs.skillId], references: [skills.id] }),
}));

export const revisionPlansRelations = relations(revisionPlans, ({ one }) => ({
  student: one(users, { fields: [revisionPlans.studentUserId], references: [users.id] }),
  skill: one(skills, { fields: [revisionPlans.skillId], references: [skills.id] }),
  errorLog: one(errorLogs, { fields: [revisionPlans.errorLogId], references: [errorLogs.id] }),
}));

export const revisionSessionsRelations = relations(revisionSessions, ({ one, many }) => ({
  student: one(users, { fields: [revisionSessions.studentUserId], references: [users.id] }),
  items: many(revisionSessionItems),
}));
