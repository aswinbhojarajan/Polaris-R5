-- Task #77: per-function LLM model overrides. One row per LLM_FUNCTIONS key
-- (see server/config/llm-functions.ts). When a row exists and references an
-- enabled ai_models row, the resolver uses that model in preference to the
-- env var or default. Designed to allow a future `client_id` column for
-- per-tenant overrides without a rewrite.
--
-- model_id cascades on delete so removing a model also clears any override
-- pinned to it. updated_by_user_id has no ON DELETE rule (default NO ACTION)
-- to match the rest of the codebase's audit-style references; we accept the
-- (rare) failure mode of blocking a user delete when an override row points
-- at them, in exchange for not losing attribution.
--
-- Idempotent so re-runs after a `drizzle-kit push` cutover are safe.
CREATE TABLE IF NOT EXISTS "llm_function_overrides" (
  "function_key"       text                          PRIMARY KEY NOT NULL,
  "model_id"           varchar                       NOT NULL,
  "updated_by_user_id" varchar,
  "updated_at"         timestamp without time zone   NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'llm_function_overrides_model_id_ai_models_id_fk'
  ) THEN
    ALTER TABLE "llm_function_overrides"
      ADD CONSTRAINT "llm_function_overrides_model_id_ai_models_id_fk"
      FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'llm_function_overrides_updated_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "llm_function_overrides"
      ADD CONSTRAINT "llm_function_overrides_updated_by_user_id_users_id_fk"
      FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
