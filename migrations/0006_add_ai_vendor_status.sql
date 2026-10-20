-- Task #78: vendor-level kill switch. One row per vendor (free-form text
-- so it stays in sync with the `vendor` column on `ai_models` without an
-- enum migration every time we add a provider). `paused = true` hides
-- the vendor's models from the consumer-facing model list and refuses
-- new executions; the per-model `enabled` flag is untouched so
-- un-pausing restores prior state.
--
-- paused_by_user_id uses ON DELETE SET NULL so deleting a user does not
-- silently un-pause a vendor.
--
-- Idempotent so re-runs after a `drizzle-kit push` cutover are safe.
CREATE TABLE IF NOT EXISTS "ai_vendor_status" (
  "vendor"             text                          PRIMARY KEY NOT NULL,
  "paused"             boolean                       NOT NULL DEFAULT false,
  "paused_at"          timestamp without time zone,
  "paused_by_user_id"  varchar,
  "pause_reason"       text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_vendor_status_paused_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "ai_vendor_status"
      ADD CONSTRAINT "ai_vendor_status_paused_by_user_id_users_id_fk"
      FOREIGN KEY ("paused_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
