-- Additive R1A upgrade only. Apply schema before deploying compatible workers.
-- Does not enable providers, rewrite old answers, or change score/status enums.
BEGIN;
ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS search_config jsonb;
CREATE TABLE IF NOT EXISTS prompt_run_item_executions (
  item_id varchar PRIMARY KEY REFERENCES prompt_run_items(id) ON DELETE CASCADE,
  run_id varchar NOT NULL REFERENCES prompt_runs(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'not_started'
    CHECK (phase IN ('not_started','generating','generated','scoring','scored','failed')),
  answer_text text,
  evidence jsonb,
  canonical_answer_id varchar REFERENCES answers(id) ON DELETE SET NULL,
  claim_token varchar,
  lease_until timestamp,
  deadline_at timestamp,
  ledger jsonb NOT NULL DEFAULT '{"attemptCount":0,"continuationCount":0,"searchBudgetReserved":0}'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (answer_text IS NULL OR length(answer_text) BETWEEN 1 AND 250000),
  CHECK (evidence IS NULL OR octet_length(evidence::text) <= 262144)
);
CREATE INDEX IF NOT EXISTS idx_native_executions_run_id ON prompt_run_item_executions(run_id);
CREATE TABLE IF NOT EXISTS native_search_validation_reservations (
  approval_ref varchar NOT NULL,
  run_id varchar NOT NULL,
  item_count integer NOT NULL CHECK (item_count > 0),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_validation_reservation
  ON native_search_validation_reservations(approval_ref, run_id);
COMMIT;
