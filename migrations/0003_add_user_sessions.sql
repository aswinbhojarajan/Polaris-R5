-- Task #37: per-user "active sessions" ledger that mirrors the
-- express-session store at the application level so the
-- /app/account/sessions UI and the admin queue page can list
-- a user's sessions, distinguish the current one, and revoke
-- individual entries. The session-epoch kill switch in `users`
-- remains the source of truth for revocation; this table is the
-- UI-facing mirror.
--
-- Idempotent so re-runs after a `drizzle-kit push` cutover are safe.
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "session_id"   text PRIMARY KEY NOT NULL,
  "user_id"      varchar NOT NULL,
  "user_agent"   text,
  "ip_address"   text,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_sessions_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "user_sessions"
      ADD CONSTRAINT "user_sessions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx"
  ON "user_sessions" ("user_id");
