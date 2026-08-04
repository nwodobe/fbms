/**
 * Savoir+ — Référentiel pédagogique et tentatives.
 * Voir docs/DATA_MODEL.md §4.
 *
 * PRINCIPE (DECISIONS.md ADR-004) : l'identité est stable, le contenu vit
 * dans la VERSION. Une tentative référence `exercise_version_id`, jamais
 * `exercise_id` — c'est ce qui permet de corriger un exercice sans rendre
 * inexplicable une tentative passée.
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
import { contentStatus, errorCategory, exerciseType, writeSource } from './enums';

// ---------------------------------------------------------------------------
// subjects → chapters → skills
// ---------------------------------------------------------------------------
export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Clé métier STABLE, utilisée par les seeds. Ex. « MATH ». */
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: contentStatus('status').notNull().default('draft'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('subjects_code_uq').on(t.code)],
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    gradeLevel: text('grade_level').notNull().default('2nde_C'),
    position: integer('position').notNull().default(0),
    status: contentStatus('status').notNull().default('draft'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('chapters_subject_code_uq').on(t.subjectId, t.code),
    index('chapters_subject_status_idx').on(t.subjectId, t.status, t.position),
  ],
);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'restrict' }),
    /** Ex. « SK-FRA-02 ». Stable, jamais modifié. */
    code: text('code').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    status: contentStatus('status').notNull().default('draft'),

    /**
     * Graphe de prérequis (PEDAGOGY.md §2). L'absence de cycle est vérifiée
     * à l'écriture et au seed : PostgreSQL ne sait pas l'exprimer.
     */
    prerequisiteSkillId: uuid('prerequisite_skill_id'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('skills_chapter_code_uq').on(t.chapterId, t.code),
    index('skills_chapter_idx').on(t.chapterId, t.position),
    check('skills_no_self_prerequisite_ck', sql`${t.prerequisiteSkillId} is distinct from ${t.id}`),
  ],
);

// ---------------------------------------------------------------------------
// lessons / lesson_versions
// ---------------------------------------------------------------------------
export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    status: contentStatus('status').notNull().default('draft'),
    /** Version actuellement servie. `null` tant qu'aucune n'est publiée. */
    currentVersionId: uuid('current_version_id'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('lessons_skill_status_idx').on(t.skillId, t.status)],
);

export const lessonVersions = pgTable(
  'lesson_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),

    // Les 7 blocs d'une notion (PEDAGOGY.md §8).
    bodyMarkdown: text('body_markdown').notNull(),
    rule: text('rule').notNull(),
    example: text('example').notNull(),
    commonMistakes: jsonb('common_mistakes')
      .notNull()
      .default(sql`'[]'::jsonb`),
    revisionSheet: text('revision_sheet').notNull(),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lesson_versions_lesson_version_uq').on(t.lessonId, t.version),
    check('lesson_versions_version_ck', sql`${t.version} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// exercises / exercise_versions / exercise_steps
// ---------------------------------------------------------------------------
export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    /** Difficulté 1 à 5. */
    difficulty: integer('difficulty').notNull().default(1),
    type: exerciseType('type').notNull(),
    status: contentStatus('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    position: integer('position').notNull().default(0),
    /** Exercice proposé après la solution (PEDAGOGY.md §6, étape 8). */
    similarExerciseId: uuid('similar_exercise_id'),
    ...timestamps,
  },
  (t) => [
    index('exercises_skill_difficulty_idx').on(t.skillId, t.difficulty, t.position),
    index('exercises_skill_status_idx').on(t.skillId, t.status),
    check('exercises_difficulty_ck', sql`${t.difficulty} between 1 and 5`),
    check('exercises_no_self_similar_ck', sql`${t.similarExerciseId} is distinct from ${t.id}`),
  ],
);

/**
 * LIGNE ROUGE DU MODÈLE (DATA_MODEL.md §4.7).
 *
 * Les colonnes `correctAnswer`, `answerTolerance`, `hints` et
 * `solutionMarkdown` ne doivent JAMAIS figurer dans la projection d'un
 * repository de lecture élève. Le filtrage se fait en SQL, pas dans un
 * composant React : sinon la donnée a déjà transité par le réseau.
 */
export const exerciseVersions = pgTable(
  'exercise_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),

    // --- Exposable au client ---
    statement: text('statement').notNull(),
    assets: jsonb('assets')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // --- SECRET : jamais envoyé avant droit acquis ---
    correctAnswer: jsonb('correct_answer').notNull(),
    answerTolerance: jsonb('answer_tolerance'),
    hints: jsonb('hints')
      .notNull()
      .default(sql`'[]'::jsonb`),
    solutionMarkdown: text('solution_markdown').notNull(),
    expectedErrorCategory: errorCategory('expected_error_category'),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('exercise_versions_exercise_version_uq').on(t.exerciseId, t.version),
    check('exercise_versions_version_ck', sql`${t.version} >= 1`),
    // CQ-02 : au moins 2 indices sur un contenu publié.
    check(
      'exercise_versions_hints_ck',
      sql`${t.publishedAt} is null or jsonb_array_length(${t.hints}) >= 2`,
    ),
  ],
);

export const exerciseSteps = pgTable(
  'exercise_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exerciseVersionId: uuid('exercise_version_id')
      .notNull()
      .references(() => exerciseVersions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    /** SECRET. Support du score partiel (PEDAGOGY.md §4.2). */
    expectedValue: jsonb('expected_value').notNull(),
    weight: numeric('weight', { precision: 6, scale: 3 }).notNull().default('1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('exercise_steps_version_position_uq').on(t.exerciseVersionId, t.position),
    check('exercise_steps_weight_ck', sql`${t.weight} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// exercise_attempts — IMMUABLES (AUTHORIZATION_MATRIX.md §4.5)
// ---------------------------------------------------------------------------
export const exerciseAttempts = pgTable(
  'exercise_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /**
     * On fige la VERSION réellement vue par l'élève, pas l'exercice.
     * ADR-004 et ADR-014 : aucune donnée pédagogique produite par un élève
     * n'est supprimée en cascade.
     */
    exerciseVersionId: uuid('exercise_version_id')
      .notNull()
      .references(() => exerciseVersions.id, { onDelete: 'restrict' }),

    attemptNumber: integer('attempt_number').notNull(),
    submittedAnswer: jsonb('submitted_answer').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    /** Calculé côté serveur UNIQUEMENT (ADR-005). */
    score: integer('score').notNull(),
    hintsUsed: integer('hints_used').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    solutionRevealed: boolean('solution_revealed').notNull().default(false),
    errorCategory: errorCategory('error_category'),

    source: writeSource('source').notNull().default('online'),
    /** Corrélation avec la file d'opérations hors ligne. */
    clientOperationId: uuid('client_operation_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * ANTI-DOUBLON STRUCTUREL (OFFLINE_SYNC.md §5, ADR-006).
     * La clé d'idempotence attrape le rejeu exact ; cette contrainte attrape
     * le rejeu déformé — clé perdue, appareil réinstallé.
     */
    uniqueIndex('exercise_attempts_unique_try_uq').on(
      t.studentUserId,
      t.exerciseVersionId,
      t.attemptNumber,
    ),
    index('exercise_attempts_student_created_idx').on(t.studentUserId, t.createdAt.desc()),
    index('exercise_attempts_version_idx').on(t.exerciseVersionId),
    check('exercise_attempts_attempt_number_ck', sql`${t.attemptNumber} >= 1`),
    check('exercise_attempts_score_ck', sql`${t.score} between 0 and 100`),
    check('exercise_attempts_hints_ck', sql`${t.hintsUsed} >= 0`),
    check('exercise_attempts_duration_ck', sql`${t.durationMs} >= 0`),
  ],
);

export const exerciseAttemptSteps = pgTable(
  'exercise_attempt_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => exerciseAttempts.id, { onDelete: 'cascade' }),
    exerciseStepId: uuid('exercise_step_id')
      .notNull()
      .references(() => exerciseSteps.id, { onDelete: 'restrict' }),
    submittedValue: jsonb('submitted_value').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    awardedWeight: numeric('awarded_weight', { precision: 6, scale: 3 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('exercise_attempt_steps_uq').on(t.attemptId, t.exerciseStepId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  subject: one(subjects, { fields: [chapters.subjectId], references: [subjects.id] }),
  skills: many(skills),
}));

export const skillsRelations = relations(skills, ({ one, many }) => ({
  chapter: one(chapters, { fields: [skills.chapterId], references: [chapters.id] }),
  prerequisite: one(skills, {
    fields: [skills.prerequisiteSkillId],
    references: [skills.id],
    relationName: 'prerequisite',
  }),
  lessons: many(lessons),
  exercises: many(exercises),
}));

export const exerciseVersionsRelations = relations(exerciseVersions, ({ one, many }) => ({
  exercise: one(exercises, {
    fields: [exerciseVersions.exerciseId],
    references: [exercises.id],
  }),
  steps: many(exerciseSteps),
  attempts: many(exerciseAttempts),
}));
