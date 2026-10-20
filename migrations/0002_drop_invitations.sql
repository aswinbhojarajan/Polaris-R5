-- Task #21: retire the legacy `invitations` table.
--
-- Task #18 introduced the unified `credential_grants` primitive and Task
-- #19 cut every reader/writer over to it; the legacy `invitations` table
-- has had no in-application traffic since. This migration drops the
-- table (and any FK constraints from `organizations` / `clients` /
-- `users` that referenced it) so the two stores cannot drift again.
--
-- Idempotent: `IF EXISTS` makes this safe to re-run on environments
-- where the table has already been removed (e.g. fresh installs that
-- ran `db:push` against the post-Task-#21 schema, where `invitations`
-- was never created in the first place).

DROP TABLE IF EXISTS "invitations" CASCADE;
