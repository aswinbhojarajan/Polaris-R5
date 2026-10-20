-- Task #79: Disable-lifecycle hardening for AI models. Adds attribution
-- columns so the History popover can render "Disabled by Alice on
-- 2026-05-12: rate-limited" and a per-project notification jsonb so
-- projects whose `selectedAiModelIds` referenced the now-disabled model
-- get a one-time banner on next visit.
--
-- All ALTERs are idempotent so re-runs after a `drizzle-kit push`
-- cutover are safe. disabled_by_user_id uses ON DELETE SET NULL so
-- deleting a user does not silently clear the disabled-by attribution
-- of the model row.

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "disabled_at" timestamp without time zone;

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "disabled_by_user_id" varchar;

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "disabled_reason" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_models_disabled_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "ai_models"
      ADD CONSTRAINT "ai_models_disabled_by_user_id_users_id_fk"
      FOREIGN KEY ("disabled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "disabled_model_notifications" jsonb;
