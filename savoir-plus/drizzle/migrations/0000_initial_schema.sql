CREATE TYPE "public"."assessment_type" AS ENUM('chapter', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."asset_scope" AS ENUM('content', 'user');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'ready', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."error_category" AS ENUM('sign', 'calculation', 'fraction', 'priority', 'formula', 'method', 'reading', 'knowledge', 'attention', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."error_status" AS ENUM('open', 'recurrent', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."exercise_type" AS ENUM('numeric', 'multiple_choice', 'short_text', 'ordered_steps');--> statement-breakpoint
CREATE TYPE "public"."link_initiator" AS ENUM('student', 'parent');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."mastery_status" AS ENUM('mastered', 'fragile', 'not_mastered', 'not_evaluated');--> statement-breakpoint
CREATE TYPE "public"."measure_source" AS ENUM('diagnostic', 'practice', 'assessment', 'revision');--> statement-breakpoint
CREATE TYPE "public"."operation_type" AS ENUM('diagnostic.answer', 'diagnostic.complete', 'exercise.attempt', 'exercise.hint_request', 'exercise.give_up', 'revision.item_result', 'revision.session_complete', 'session.heartbeat');--> statement-breakpoint
CREATE TYPE "public"."revision_item_result" AS ENUM('success', 'failure', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."revision_status" AS ENUM('scheduled', 'done', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."session_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planned', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'syncing', 'synced', 'failed', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('email_verification', 'password_reset', 'magic_link');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'parent', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."write_source" AS ENUM('online', 'offline_sync');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"preferred_report_day" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_profiles_report_day_ck" CHECK ("parent_profiles"."preferred_report_day" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "parent_student_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"status" "link_status" DEFAULT 'pending' NOT NULL,
	"invitation_code_hash" text,
	"invited_by" "link_initiator" NOT NULL,
	"invitation_expires_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_student_links_distinct_ck" CHECK ("parent_student_links"."parent_user_id" <> "parent_student_links"."student_user_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'fr-CI' NOT NULL,
	"timezone" text DEFAULT 'Africa/Abidjan' NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"grade_level" text DEFAULT '2nde_C' NOT NULL,
	"school_name" text,
	"current_average" numeric(4, 2),
	"target_average" numeric(4, 2),
	"daily_minutes" integer DEFAULT 60 NOT NULL,
	"days_per_week" integer DEFAULT 5 NOT NULL,
	"birth_year" integer,
	"diagnostic_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_days_per_week_ck" CHECK ("student_profiles"."days_per_week" between 1 and 7),
	CONSTRAINT "student_profiles_daily_minutes_ck" CHECK ("student_profiles"."daily_minutes" between 5 and 480),
	CONSTRAINT "student_profiles_current_average_ck" CHECK ("student_profiles"."current_average" is null or "student_profiles"."current_average" between 0 and 20),
	CONSTRAINT "student_profiles_target_average_ck" CHECK ("student_profiles"."target_average" is null or "student_profiles"."target_average" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"grade_level" text DEFAULT '2nde_C' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_attempt_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"exercise_step_id" uuid NOT NULL,
	"submitted_value" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"awarded_weight" numeric(6, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"submitted_answer" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"score" integer NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"solution_revealed" boolean DEFAULT false NOT NULL,
	"error_category" "error_category",
	"source" "write_source" DEFAULT 'online' NOT NULL,
	"client_operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_attempts_attempt_number_ck" CHECK ("exercise_attempts"."attempt_number" >= 1),
	CONSTRAINT "exercise_attempts_score_ck" CHECK ("exercise_attempts"."score" between 0 and 100),
	CONSTRAINT "exercise_attempts_hints_ck" CHECK ("exercise_attempts"."hints_used" >= 0),
	CONSTRAINT "exercise_attempts_duration_ck" CHECK ("exercise_attempts"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exercise_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"expected_value" jsonb NOT NULL,
	"weight" numeric(6, 3) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_steps_weight_ck" CHECK ("exercise_steps"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "exercise_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"statement" text NOT NULL,
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"answer_tolerance" jsonb,
	"hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"solution_markdown" text NOT NULL,
	"expected_error_category" "error_category",
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_versions_version_ck" CHECK ("exercise_versions"."version" >= 1),
	CONSTRAINT "exercise_versions_hints_ck" CHECK ("exercise_versions"."published_at" is null or jsonb_array_length("exercise_versions"."hints") >= 2)
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"type" "exercise_type" NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"similar_exercise_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_difficulty_ck" CHECK ("exercises"."difficulty" between 1 and 5),
	CONSTRAINT "exercises_no_self_similar_ck" CHECK ("exercises"."similar_exercise_id" is distinct from "exercises"."id")
);
--> statement-breakpoint
CREATE TABLE "lesson_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body_markdown" text NOT NULL,
	"rule" text NOT NULL,
	"example" text NOT NULL,
	"common_mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision_sheet" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_versions_version_ck" CHECK ("lesson_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"prerequisite_skill_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_no_self_prerequisite_ck" CHECK ("skills"."prerequisite_skill_id" is distinct from "skills"."id")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagnostic_attempt_id" uuid NOT NULL,
	"diagnostic_question_id" uuid NOT NULL,
	"submitted_answer" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"client_operation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "diagnostic_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"diagnostic_test_version_id" uuid NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"current_position" integer DEFAULT 1 NOT NULL,
	"total_score" integer,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagnostic_test_version_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"statement" text NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weight" numeric(6, 3) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_questions_position_ck" CHECK ("diagnostic_questions"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "diagnostic_test_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagnostic_test_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"question_count" integer DEFAULT 20 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_test_versions_count_ck" CHECK ("diagnostic_test_versions"."question_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "diagnostic_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"grade_level" text DEFAULT '2nde_C' NOT NULL,
	"title" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"total_score" numeric(8, 2),
	"max_score" numeric(8, 2),
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"per_skill_breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"statement" text NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"points" numeric(6, 2) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_questions_points_ck" CHECK ("assessment_questions"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid,
	"title" text NOT NULL,
	"type" "assessment_type" DEFAULT 'chapter' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"category" "error_category" NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"status" "error_status" DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_exercise_version_id" uuid,
	"next_review_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "error_logs_occurrence_ck" CHECK ("error_logs"."occurrence_count" >= 1),
	CONSTRAINT "error_logs_recurrent_threshold_ck" CHECK ("error_logs"."status" <> 'recurrent' or "error_logs"."occurrence_count" >= 3)
);
--> statement-breakpoint
CREATE TABLE "revision_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"error_log_id" uuid,
	"interval_index" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "revision_status" DEFAULT 'scheduled' NOT NULL,
	"consecutive_success" integer DEFAULT 0 NOT NULL,
	"consecutive_failure" integer DEFAULT 0 NOT NULL,
	"last_result" "revision_item_result",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_plans_interval_ck" CHECK ("revision_plans"."interval_index" between 0 and 4),
	CONSTRAINT "revision_plans_counters_ck" CHECK ("revision_plans"."consecutive_success" >= 0 and "revision_plans"."consecutive_failure" >= 0)
);
--> statement-breakpoint
CREATE TABLE "revision_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_session_id" uuid NOT NULL,
	"revision_plan_id" uuid,
	"exercise_version_id" uuid,
	"lesson_version_id" uuid,
	"position" integer NOT NULL,
	"result" "revision_item_result",
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_session_items_single_target_ck" CHECK ((case when "revision_session_items"."revision_plan_id" is not null then 1 else 0 end
         + case when "revision_session_items"."exercise_version_id" is not null then 1 else 0 end
         + case when "revision_session_items"."lesson_version_id" is not null then 1 else 0 end) = 1)
);
--> statement-breakpoint
CREATE TABLE "revision_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"planned_for" date NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"planned_minutes" integer DEFAULT 60 NOT NULL,
	"actual_duration_ms" integer DEFAULT 0 NOT NULL,
	"status" "session_status" DEFAULT 'planned' NOT NULL,
	"source" "session_source" DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_sessions_minutes_ck" CHECK ("revision_sessions"."planned_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "student_skill_levels" (
	"student_user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"status" "mastery_status" DEFAULT 'not_evaluated' NOT NULL,
	"success_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"source" "measure_source",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_skill_levels_rate_ck" CHECK ("student_skill_levels"."success_rate" between 0 and 100),
	CONSTRAINT "student_skill_levels_count_ck" CHECK ("student_skill_levels"."evaluated_count" >= 0),
	CONSTRAINT "student_skill_levels_mastery_requires_two_measures_ck" CHECK ("student_skill_levels"."status" <> 'mastered' or "student_skill_levels"."evaluated_count" >= 2)
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"sessions_completed" integer DEFAULT 0 NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"exercises_attempted" integer DEFAULT 0 NOT NULL,
	"success_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"first_try_success_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"skills_improved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"top_difficulties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recurrent_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reports_range_ck" CHECK ("weekly_reports"."week_end" > "weekly_reports"."week_start")
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text,
	"scope" "asset_scope" DEFAULT 'content' NOT NULL,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_assets_size_ck" CHECK ("file_assets"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"key" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_type" "operation_type" NOT NULL,
	"request_hash" text NOT NULL,
	"response_payload" jsonb,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"operation_type" "operation_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"server_version" integer,
	CONSTRAINT "offline_operations_attempts_ck" CHECK ("offline_operations"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempt_steps" ADD CONSTRAINT "exercise_attempt_steps_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exercise_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempt_steps" ADD CONSTRAINT "exercise_attempt_steps_exercise_step_id_exercise_steps_id_fk" FOREIGN KEY ("exercise_step_id") REFERENCES "public"."exercise_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "public"."exercise_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_steps" ADD CONSTRAINT "exercise_steps_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "public"."exercise_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_versions" ADD CONSTRAINT "exercise_versions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_versions" ADD CONSTRAINT "exercise_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_answers" ADD CONSTRAINT "diagnostic_answers_diagnostic_attempt_id_diagnostic_attempts_id_fk" FOREIGN KEY ("diagnostic_attempt_id") REFERENCES "public"."diagnostic_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_answers" ADD CONSTRAINT "diagnostic_answers_diagnostic_question_id_diagnostic_questions_id_fk" FOREIGN KEY ("diagnostic_question_id") REFERENCES "public"."diagnostic_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_diagnostic_test_version_id_diagnostic_test_versions_id_fk" FOREIGN KEY ("diagnostic_test_version_id") REFERENCES "public"."diagnostic_test_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_questions" ADD CONSTRAINT "diagnostic_questions_diagnostic_test_version_id_diagnostic_test_versions_id_fk" FOREIGN KEY ("diagnostic_test_version_id") REFERENCES "public"."diagnostic_test_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_questions" ADD CONSTRAINT "diagnostic_questions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_test_versions" ADD CONSTRAINT "diagnostic_test_versions_diagnostic_test_id_diagnostic_tests_id_fk" FOREIGN KEY ("diagnostic_test_id") REFERENCES "public"."diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_test_versions" ADD CONSTRAINT "diagnostic_test_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_tests" ADD CONSTRAINT "diagnostic_tests_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_last_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("last_exercise_version_id") REFERENCES "public"."exercise_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_error_log_id_error_logs_id_fk" FOREIGN KEY ("error_log_id") REFERENCES "public"."error_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_session_items" ADD CONSTRAINT "revision_session_items_revision_session_id_revision_sessions_id_fk" FOREIGN KEY ("revision_session_id") REFERENCES "public"."revision_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_session_items" ADD CONSTRAINT "revision_session_items_revision_plan_id_revision_plans_id_fk" FOREIGN KEY ("revision_plan_id") REFERENCES "public"."revision_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_session_items" ADD CONSTRAINT "revision_session_items_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "public"."exercise_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_session_items" ADD CONSTRAINT "revision_session_items_lesson_version_id_lesson_versions_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_sessions" ADD CONSTRAINT "revision_sessions_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_skill_levels" ADD CONSTRAINT "student_skill_levels_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_skill_levels" ADD CONSTRAINT "student_skill_levels_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_operations" ADD CONSTRAINT "offline_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_uq" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_profiles_user_uq" ON "parent_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_student_links_pair_uq" ON "parent_student_links" USING btree ("parent_user_id","student_user_id");--> statement-breakpoint
CREATE INDEX "parent_student_links_parent_active_idx" ON "parent_student_links" USING btree ("parent_user_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "parent_student_links_student_idx" ON "parent_student_links" USING btree ("student_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_uq" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_user_uq" ON "student_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_status_idx" ON "users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_idx" ON "verification_tokens" USING btree ("expires");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_subject_code_uq" ON "chapters" USING btree ("subject_id","code");--> statement-breakpoint
CREATE INDEX "chapters_subject_status_idx" ON "chapters" USING btree ("subject_id","status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_attempt_steps_uq" ON "exercise_attempt_steps" USING btree ("attempt_id","exercise_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_attempts_unique_try_uq" ON "exercise_attempts" USING btree ("student_user_id","exercise_version_id","attempt_number");--> statement-breakpoint
CREATE INDEX "exercise_attempts_student_created_idx" ON "exercise_attempts" USING btree ("student_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exercise_attempts_version_idx" ON "exercise_attempts" USING btree ("exercise_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_steps_version_position_uq" ON "exercise_steps" USING btree ("exercise_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_versions_exercise_version_uq" ON "exercise_versions" USING btree ("exercise_id","version");--> statement-breakpoint
CREATE INDEX "exercises_skill_difficulty_idx" ON "exercises" USING btree ("skill_id","difficulty","position");--> statement-breakpoint
CREATE INDEX "exercises_skill_status_idx" ON "exercises" USING btree ("skill_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_versions_lesson_version_uq" ON "lesson_versions" USING btree ("lesson_id","version");--> statement-breakpoint
CREATE INDEX "lessons_skill_status_idx" ON "lessons" USING btree ("skill_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_chapter_code_uq" ON "skills" USING btree ("chapter_id","code");--> statement-breakpoint
CREATE INDEX "skills_chapter_idx" ON "skills" USING btree ("chapter_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_code_uq" ON "subjects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_answers_attempt_question_uq" ON "diagnostic_answers" USING btree ("diagnostic_attempt_id","diagnostic_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_attempts_one_in_progress_uq" ON "diagnostic_attempts" USING btree ("student_user_id","diagnostic_test_version_id") WHERE status = 'in_progress';--> statement-breakpoint
CREATE INDEX "diagnostic_attempts_student_idx" ON "diagnostic_attempts" USING btree ("student_user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_questions_version_position_uq" ON "diagnostic_questions" USING btree ("diagnostic_test_version_id","position");--> statement-breakpoint
CREATE INDEX "diagnostic_questions_skill_idx" ON "diagnostic_questions" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_test_versions_uq" ON "diagnostic_test_versions" USING btree ("diagnostic_test_id","version");--> statement-breakpoint
CREATE INDEX "diagnostic_tests_subject_status_idx" ON "diagnostic_tests" USING btree ("subject_id","status");--> statement-breakpoint
CREATE INDEX "assessment_attempts_student_idx" ON "assessment_attempts" USING btree ("student_user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_questions_position_uq" ON "assessment_questions" USING btree ("assessment_id","position");--> statement-breakpoint
CREATE INDEX "assessments_chapter_status_idx" ON "assessments" USING btree ("chapter_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "error_logs_student_skill_category_uq" ON "error_logs" USING btree ("student_user_id","skill_id","category");--> statement-breakpoint
CREATE INDEX "error_logs_student_status_idx" ON "error_logs" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE INDEX "error_logs_next_review_idx" ON "error_logs" USING btree ("student_user_id","next_review_at") WHERE status <> 'resolved';--> statement-breakpoint
CREATE UNIQUE INDEX "revision_plans_one_active_uq" ON "revision_plans" USING btree ("student_user_id","skill_id",coalesce("error_log_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "revision_plans_due_idx" ON "revision_plans" USING btree ("student_user_id","due_at") WHERE status = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "revision_session_items_position_uq" ON "revision_session_items" USING btree ("revision_session_id","position");--> statement-breakpoint
CREATE INDEX "revision_sessions_student_date_idx" ON "revision_sessions" USING btree ("student_user_id","planned_for" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "student_skill_levels_pk" ON "student_skill_levels" USING btree ("student_user_id","skill_id");--> statement-breakpoint
CREATE INDEX "student_skill_levels_student_status_idx" ON "student_skill_levels" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reports_student_week_uq" ON "weekly_reports" USING btree ("student_user_id","week_start");--> statement-breakpoint
CREATE INDEX "application_events_type_idx" ON "application_events" USING btree ("event_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "application_events_user_idx" ON "application_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "file_assets_object_key_uq" ON "file_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "file_assets_owner_status_idx" ON "file_assets" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "idempotency_records_user_idx" ON "idempotency_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_operations_idempotency_uq" ON "offline_operations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "offline_operations_user_status_idx" ON "offline_operations" USING btree ("user_id","sync_status");