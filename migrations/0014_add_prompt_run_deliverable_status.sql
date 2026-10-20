ALTER TABLE "prompt_runs"
  ADD COLUMN IF NOT EXISTS "deliverables_status" text DEFAULT 'pending' NOT NULL;

ALTER TABLE "prompt_runs"
  ADD COLUMN IF NOT EXISTS "deliverables_error_summary" text;

ALTER TABLE "prompt_runs"
  ADD COLUMN IF NOT EXISTS "deliverables_completed_at" timestamp;