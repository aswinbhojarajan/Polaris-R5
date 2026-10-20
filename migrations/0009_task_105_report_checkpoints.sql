-- Task #105: Executive Report pipeline reliability + perf uplift.
--
-- R2 — Mid-pipeline checkpointing: persist Step 3 summaries on the
-- answers row and Step 4/5 LLM outputs on the snapshot row so a retry
-- after a crash can skip already-completed phases instead of paying
-- the OpenAI cost again.
--
-- P4 — DB index audit: the parallelized aggregator (P1) joins on
-- prompt_run_id / answer_id paths several times per report; these
-- indexes turn the seq-scan-on-large-table path into index lookups.
--
-- All ALTER / CREATE statements are idempotent so re-running after a
-- `drizzle-kit push --force` cutover is safe.

ALTER TABLE "answers"
  ADD COLUMN IF NOT EXISTS "summary" text;

ALTER TABLE "report_snapshots"
  ADD COLUMN IF NOT EXISTS "narratives" jsonb;

ALTER TABLE "report_snapshots"
  ADD COLUMN IF NOT EXISTS "appendix_content" jsonb;

CREATE INDEX IF NOT EXISTS "idx_prompt_run_items_prompt_run_id"
  ON "prompt_run_items" ("prompt_run_id");

CREATE INDEX IF NOT EXISTS "idx_answers_prompt_run_item_id"
  ON "answers" ("prompt_run_item_id");

CREATE INDEX IF NOT EXISTS "idx_citations_answer_id"
  ON "citations" ("answer_id");

CREATE INDEX IF NOT EXISTS "idx_mentions_answer_id"
  ON "mentions" ("answer_id");

CREATE INDEX IF NOT EXISTS "idx_rankings_answer_id"
  ON "rankings" ("answer_id");
