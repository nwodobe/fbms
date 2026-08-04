/**
 * Savoir+ — Diagnostic initial.
 * Voir docs/DATA_MODEL.md §5.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import { skills, subjects } from './pedagogy';
import { attemptStatus, contentStatus } from './enums';

export const diagnosticTests = pgTable(
  'diagnostic_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    gradeLevel: text('grade_level').notNull().default('2nde_C'),
    title: text('title').notNull(),
    status: contentStatus('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    ...timestamps,
  },
  (t) => [index('diagnostic_tests_subject_status_idx').on(t.subjectId, t.status)],
);

export const diagnosticTestVersions = pgTable(
  'diagnostic_test_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagnosticTestId: uuid('diagnostic_test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    /** 20 en MVP (PEDAGOGY.md §3.1). */
    questionCount: integer('question_count').notNull().default(20),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('diagnostic_test_versions_uq').on(t.diagnosticTestId, t.version),
    check('diagnostic_test_versions_count_ck', sql`${t.questionCount} > 0`),
  ],
);

export const diagnosticQuestions = pgTable(
  'diagnostic_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagnosticTestVersionId: uuid('diagnostic_test_version_id')
      .notNull()
      .references(() => diagnosticTestVersions.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    statement: text('statement').notNull(),

    /** SECRET — jamais transmis avant soumission de CETTE question. */
    correctAnswer: jsonb('correct_answer').notNull(),

    /**
     * Propositions SANS marqueur de bonne réponse.
     * L'ordre affiché est mélangé côté serveur avec une graine dérivée de
     * (attempt_id, question_id) : le mélange reste REPRODUCTIBLE lors d'une
     * reprise après coupure (DATA_MODEL.md §5.3).
     */
    choices: jsonb('choices')
      .notNull()
      .default(sql`'[]'::jsonb`),
    weight: numeric('weight', { precision: 6, scale: 3 }).notNull().default('1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('diagnostic_questions_version_position_uq').on(
      t.diagnosticTestVersionId,
      t.position,
    ),
    index('diagnostic_questions_skill_idx').on(t.skillId),
    check('diagnostic_questions_position_ck', sql`${t.position} >= 1`),
  ],
);

export const diagnosticAttempts = pgTable(
  'diagnostic_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    diagnosticTestVersionId: uuid('diagnostic_test_version_id')
      .notNull()
      .references(() => diagnosticTestVersions.id, { onDelete: 'restrict' }),
    status: attemptStatus('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Sauvegarde progressive : position de reprise après coupure. */
    currentPosition: integer('current_position').notNull().default(1),
    totalScore: integer('total_score'),
    /** Statuts par compétence, FIGÉS au moment du calcul. */
    report: jsonb('report'),
    ...timestamps,
  },
  (t) => [
    // Index PARTIEL : au plus un diagnostic en cours par élève et par version.
    uniqueIndex('diagnostic_attempts_one_in_progress_uq')
      .on(t.studentUserId, t.diagnosticTestVersionId)
      .where(sql`status = 'in_progress'`),
    index('diagnostic_attempts_student_idx').on(t.studentUserId, t.startedAt.desc()),
  ],
);

export const diagnosticAnswers = pgTable(
  'diagnostic_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagnosticAttemptId: uuid('diagnostic_attempt_id')
      .notNull()
      .references(() => diagnosticAttempts.id, { onDelete: 'cascade' }),
    diagnosticQuestionId: uuid('diagnostic_question_id')
      .notNull()
      .references(() => diagnosticQuestions.id, { onDelete: 'restrict' }),
    submittedAnswer: jsonb('submitted_answer').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer('duration_ms').notNull().default(0),
    clientOperationId: uuid('client_operation_id'),
  },
  (t) => [
    /**
     * C'EST CETTE CONTRAINTE qui rend la sauvegarde progressive idempotente
     * (OFFLINE_SYNC.md §5). Une réponse renvoyée après coupure met à jour,
     * elle ne duplique pas.
     */
    uniqueIndex('diagnostic_answers_attempt_question_uq').on(
      t.diagnosticAttemptId,
      t.diagnosticQuestionId,
    ),
  ],
);

export const diagnosticAttemptsRelations = relations(diagnosticAttempts, ({ one, many }) => ({
  student: one(users, {
    fields: [diagnosticAttempts.studentUserId],
    references: [users.id],
  }),
  version: one(diagnosticTestVersions, {
    fields: [diagnosticAttempts.diagnosticTestVersionId],
    references: [diagnosticTestVersions.id],
  }),
  answers: many(diagnosticAnswers),
}));
