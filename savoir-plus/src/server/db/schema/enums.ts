/**
 * Savoir+ — Types énumérés PostgreSQL.
 * Voir docs/DATA_MODEL.md §1.
 *
 * Règle : `enum` PostgreSQL pour les valeurs stables (rôles, statuts),
 * `text` + `check` pour celles susceptibles d'évoluer.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// --- Comptes ---------------------------------------------------------------
export const userRole = pgEnum('user_role', ['student', 'parent', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);

/**
 * Un jeton de vérification d'e-mail ne doit jamais pouvoir servir à
 * réinitialiser un mot de passe : d'où la séparation par usage.
 */
export const tokenPurpose = pgEnum('token_purpose', [
  'email_verification',
  'password_reset',
  'magic_link',
]);

export const linkStatus = pgEnum('link_status', ['pending', 'active', 'revoked']);
export const linkInitiator = pgEnum('link_initiator', ['student', 'parent']);

// --- Contenu ---------------------------------------------------------------
export const contentStatus = pgEnum('content_status', ['draft', 'published', 'archived']);

export const exerciseType = pgEnum('exercise_type', [
  'numeric',
  'multiple_choice',
  'short_text',
  'ordered_steps',
]);

// --- Progression -----------------------------------------------------------
export const masteryStatus = pgEnum('mastery_status', [
  'mastered',
  'fragile',
  'not_mastered',
  'not_evaluated',
]);

export const measureSource = pgEnum('measure_source', [
  'diagnostic',
  'practice',
  'assessment',
  'revision',
]);

/** Les 10 catégories d'erreurs de PEDAGOGY.md §5.1. */
export const errorCategory = pgEnum('error_category', [
  'sign',
  'calculation',
  'fraction',
  'priority',
  'formula',
  'method',
  'reading',
  'knowledge',
  'attention',
  'incomplete',
]);

export const errorStatus = pgEnum('error_status', ['open', 'recurrent', 'resolved']);

export const revisionStatus = pgEnum('revision_status', [
  'scheduled',
  'done',
  'missed',
  'cancelled',
]);

export const sessionStatus = pgEnum('session_status', [
  'planned',
  'in_progress',
  'completed',
  'skipped',
]);

export const sessionSource = pgEnum('session_source', ['auto', 'manual']);

export const revisionItemResult = pgEnum('revision_item_result', ['success', 'failure', 'skipped']);

export const attemptStatus = pgEnum('attempt_status', ['in_progress', 'completed', 'abandoned']);

export const assessmentType = pgEnum('assessment_type', ['chapter', 'mixed']);

// --- Technique -------------------------------------------------------------
/** Trace l'origine d'une écriture : en ligne ou rejouée depuis la file. */
export const writeSource = pgEnum('write_source', ['online', 'offline_sync']);

export const syncStatus = pgEnum('sync_status', [
  'pending',
  'syncing',
  'synced',
  'failed',
  'conflict',
]);

export const operationType = pgEnum('operation_type', [
  'diagnostic.answer',
  'diagnostic.complete',
  'exercise.attempt',
  'exercise.hint_request',
  'exercise.give_up',
  'revision.item_result',
  'revision.session_complete',
  'session.heartbeat',
]);

export const assetScope = pgEnum('asset_scope', ['content', 'user']);
export const assetStatus = pgEnum('asset_status', ['pending', 'ready', 'deleted']);
