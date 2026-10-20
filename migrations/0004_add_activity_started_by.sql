-- Task #56: per-row "started by" attribution for the Active Operations
-- visibility surface. Backfill of legacy rows is not attempted (they
-- attribute to "background" in the UI). FK uses ON DELETE SET NULL so a
-- deleted user does not orphan or cascade-delete in-flight work history.
--
-- Idempotent so re-runs after a `drizzle-kit push` cutover are safe.
ALTER TABLE "jobs"        ADD COLUMN IF NOT EXISTS "started_by_user_id" varchar;
ALTER TABLE "report_jobs" ADD COLUMN IF NOT EXISTS "started_by_user_id" varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_started_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_started_by_user_id_users_id_fk"
      FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'report_jobs_started_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "report_jobs"
      ADD CONSTRAINT "report_jobs_started_by_user_id_users_id_fk"
      FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Cheap filter index for the Active Operations service which always
-- restricts by status first then narrows on payload->>'clientId' /
-- snapshot.client_id. The status filter alone is the most selective.
CREATE INDEX IF NOT EXISTS "jobs_status_type_idx"
  ON "jobs" ("status", "type");
CREATE INDEX IF NOT EXISTS "report_jobs_status_idx"
  ON "report_jobs" ("status");
