CREATE TYPE "public"."ai_model_category_enum" AS ENUM('core', 'additional');--> statement-breakpoint
CREATE TYPE "public"."citation_type_enum" AS ENUM('hard', 'soft');--> statement-breakpoint
CREATE TYPE "public"."crawl_access_status_enum" AS ENUM('ok', 'blocked', 'rate_limited', 'captcha');--> statement-breakpoint
CREATE TYPE "public"."credential_grant_kind_enum" AS ENUM('invitation', 'password_reset', 'magic_link', 'temp_password');--> statement-breakpoint
CREATE TYPE "public"."effort_enum" AS ENUM('S', 'M', 'L');--> statement-breakpoint
CREATE TYPE "public"."health_probe_status_enum" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."log_level_enum" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status_enum" AS ENUM('draft', 'inprogress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."priority_enum" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."recommendation_source_enum" AS ENUM('crawl', 'prompt_response', 'citation', 'ai_analysis', 'manual');--> statement-breakpoint
CREATE TYPE "public"."report_file_type_enum" AS ENUM('pdf', 'json', 'csv_zip', 'insights_pdf', 'appendix_pdf');--> statement-breakpoint
CREATE TYPE "public"."report_job_status_enum" AS ENUM('queued', 'aggregating', 'analyzing', 'rendering', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_section_name_enum" AS ENUM('executive_summary', 'diagnostic_overview', 'competitive_landscape', 'visibility_performance', 'critical_gaps', 'pattern_analysis', 'consulting_inference', 'strategic_implications', 'leadership_conversations', 'business_impact', 'action_plan_306090', 'implementation_roadmap', 'diagnostic_appendix');--> statement-breakpoint
CREATE TYPE "public"."report_status_enum" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."score_category_enum" AS ENUM('Position', 'Sentiment', 'Visibility');--> statement-breakpoint
CREATE TYPE "public"."sentiment_enum" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "public"."site_type_enum" AS ENUM('internal', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."source_enum" AS ENUM('crawl', 'manual', 'csv', 'ai');--> statement-breakpoint
CREATE TYPE "public"."status_enum" AS ENUM('queued', 'running', 'scoring', 'queued_for_benchmarking', 'benchmarking', 'done', 'completed_with_errors', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upload_kind_enum" AS ENUM('csv_topics', 'csv_prompts');--> statement-breakpoint
CREATE TYPE "public"."user_role_enum" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status_enum" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" text NOT NULL,
	"model" text NOT NULL,
	"display_name" text NOT NULL,
	"category" "ai_model_category_enum" DEFAULT 'additional' NOT NULL,
	"max_tpm" integer,
	"max_rpm" integer,
	"cost_per_1k_input" numeric(10, 4),
	"cost_per_1k_output" numeric(10, 4),
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_item_id" varchar NOT NULL,
	"raw_response" text NOT NULL,
	"visibility_score" numeric(5, 2),
	"first_mention_pos" integer,
	"sentiment_score" numeric(5, 2),
	"position_score" numeric(5, 2),
	"citation_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"actor_user_id" varchar,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" varchar NOT NULL,
	"url" text,
	"domain" text,
	"display_text" text,
	"position" integer NOT NULL,
	"type" "citation_type_enum" NOT NULL,
	"anchor_text" text,
	"is_self_citation" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"project_name" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"urls" jsonb,
	"focus_areas" jsonb,
	"industry" text,
	"geography" text,
	"custom_industry" text,
	"custom_geography" text,
	"aliases" jsonb,
	"brand_aliases" jsonb,
	"selected_ai_model_ids" jsonb,
	"onboarding_status" "onboarding_status_enum" DEFAULT 'draft',
	"is_active" boolean DEFAULT true NOT NULL,
	"owner_user_id" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_id" varchar NOT NULL,
	"prompt_id" varchar,
	"competitor_id" varchar,
	"competitor_name" text NOT NULL,
	"is_client" boolean DEFAULT false NOT NULL,
	"visibility_score" numeric(5, 2),
	"sentiment_score" numeric(5, 2),
	"position_score" numeric(5, 2),
	"overall_score" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"aliases" jsonb
);
--> statement-breakpoint
CREATE TABLE "credential_grants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "credential_grant_kind_enum" NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"user_id" varchar,
	"org_id" varchar,
	"client_id" varchar,
	"role" "user_role_enum",
	"issued_by_user_id" varchar,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"consumed_ip" text,
	"consumed_ua" text,
	"revoked_at" timestamp,
	"metadata" jsonb,
	CONSTRAINT "credential_grants_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "generated_contents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"prompt_run_id" varchar,
	"source_url" text,
	"source_domain" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"target_keywords" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"client_id" varchar,
	"email" text NOT NULL,
	"role" "user_role_enum" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "status_enum" DEFAULT 'queued' NOT NULL,
	"priority" "priority_enum" DEFAULT 'low' NOT NULL,
	"progress" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"error" text,
	"last_heartbeat" timestamp,
	"resume_count" integer DEFAULT 0,
	"worker_id" varchar,
	"heartbeat_grace_ms" integer
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" varchar NOT NULL,
	"span" text NOT NULL,
	"is_alias" boolean DEFAULT false NOT NULL,
	"sentiment" "sentiment_enum" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"granted_by_user_id" varchar,
	"granted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prompt_run_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_id" varchar NOT NULL,
	"prompt_id" varchar NOT NULL,
	"model_id" varchar NOT NULL,
	"status" "status_enum" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "prompt_run_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_id" varchar NOT NULL,
	"level" "log_level_enum" NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"name" text NOT NULL,
	"created_by" varchar NOT NULL,
	"total_prompts" integer NOT NULL,
	"status" "status_enum" DEFAULT 'queued' NOT NULL,
	"error_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"text" text NOT NULL,
	"source" "source_enum" NOT NULL,
	"category_id" varchar,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rankings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" varchar NOT NULL,
	"item" text NOT NULL,
	"position" integer NOT NULL,
	"is_client_brand" boolean DEFAULT false NOT NULL,
	"ranking_group" text,
	"group_relevance" text,
	"relevance_reason" text
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"prompt_run_id" varchar,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"examples" jsonb,
	"action_items" jsonb,
	"source" "recommendation_source_enum" DEFAULT 'ai_analysis' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" varchar NOT NULL,
	"file_type" "report_file_type_enum" NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" varchar NOT NULL,
	"status" "report_job_status_enum" DEFAULT 'queued' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"progress_message" text,
	"current_step" text,
	"model_used" text,
	"tokens_used" integer,
	"cost_usd" numeric(10, 4),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "report_sections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" varchar NOT NULL,
	"section_name" "report_section_name_enum" NOT NULL,
	"section_content" text NOT NULL,
	"section_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"project_id" text NOT NULL,
	"run_ids" jsonb NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"generated_by" varchar NOT NULL,
	"status" "report_status_enum" DEFAULT 'generating' NOT NULL,
	"narrative_generated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_checkpoints" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_id" varchar NOT NULL,
	"completed_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_stage" varchar(50) DEFAULT 'execution' NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"model_count" integer DEFAULT 0 NOT NULL,
	"competitor_count" integer DEFAULT 0 NOT NULL,
	"timeout_ms" integer NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "run_checkpoints_prompt_run_id_unique" UNIQUE("prompt_run_id")
);
--> statement-breakpoint
CREATE TABLE "score_color_bands" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "score_category_enum" NOT NULL,
	"band_name" text NOT NULL,
	"color_hex" text NOT NULL,
	"score_min" numeric(5, 2) NOT NULL,
	"score_max" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_factors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_item_id" varchar NOT NULL,
	"category" "score_category_enum" NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"relevance_value" numeric(10, 2),
	"position_value" numeric(10, 2),
	"positive_mentions" integer,
	"neutral_mentions" integer,
	"negative_mentions" integer,
	"mentions_count" integer,
	"heading_hits_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_interpretations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "score_category_enum" NOT NULL,
	"score_min" numeric(5, 2) NOT NULL,
	"score_max" numeric(5, 2) NOT NULL,
	"message_template" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"keywords" jsonb,
	"source" "source_enum" NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"kind" "upload_kind_enum" NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_org_memberships" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"role" "user_role_enum" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"status" "user_status_enum" DEFAULT 'active' NOT NULL,
	"password_changed_at" timestamp,
	"must_change_on_next_login" boolean DEFAULT false NOT NULL,
	"locked_until" timestamp,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"session_epoch" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "xray_page_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"assessment" text,
	"gaps" jsonb,
	"recommendations" jsonb,
	"actions" jsonb,
	"seo_issues" jsonb,
	"freshness_data" jsonb,
	"consistency_data" jsonb,
	"compliance_data" jsonb,
	"scores" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xray_page_structure" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"headings" jsonb,
	"paragraphs" jsonb,
	"lists" jsonb,
	"tables" jsonb,
	"entities" jsonb,
	"focus_areas" jsonb,
	"topics" jsonb,
	"sentiment_score" numeric(5, 2),
	"link_counts" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xray_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" varchar NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"page_type" text,
	"status_code" integer,
	"word_count" integer DEFAULT 0,
	"raw_html" text,
	"raw_text" text,
	"last_modified" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xray_sites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"domain" text NOT NULL,
	"site_type" "site_type_enum" NOT NULL,
	"robots_txt_present" boolean DEFAULT false NOT NULL,
	"ai_txt_present" boolean DEFAULT false NOT NULL,
	"crawl_access_status" "crawl_access_status_enum" DEFAULT 'ok' NOT NULL,
	"robots_rules" jsonb,
	"ai_txt_content" text,
	"crawl_evidence" jsonb,
	"health_probe_status" "health_probe_status_enum" DEFAULT 'pending',
	"last_probed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_prompt_run_item_id_prompt_run_items_id_fk" FOREIGN KEY ("prompt_run_item_id") REFERENCES "public"."prompt_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_run_items" ADD CONSTRAINT "prompt_run_items_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_run_items" ADD CONSTRAINT "prompt_run_items_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_run_items" ADD CONSTRAINT "prompt_run_items_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_run_logs" ADD CONSTRAINT "prompt_run_logs_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_runs" ADD CONSTRAINT "prompt_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_category_id_prompt_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."prompt_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_files" ADD CONSTRAINT "report_files_snapshot_id_report_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_snapshot_id_report_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_snapshot_id_report_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_factors" ADD CONSTRAINT "score_factors_prompt_run_item_id_prompt_run_items_id_fk" FOREIGN KEY ("prompt_run_item_id") REFERENCES "public"."prompt_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_org_memberships" ADD CONSTRAINT "user_org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_org_memberships" ADD CONSTRAINT "user_org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_page_analysis" ADD CONSTRAINT "xray_page_analysis_page_id_xray_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."xray_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_page_structure" ADD CONSTRAINT "xray_page_structure_page_id_xray_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."xray_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_pages" ADD CONSTRAINT "xray_pages_site_id_xray_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."xray_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_sites" ADD CONSTRAINT "xray_sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_memberships_client_user_uniq" ON "project_memberships" USING btree ("client_id","user_id");