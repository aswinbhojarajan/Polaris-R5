-- Task #18: backfill the unified credential_grants primitive from any
-- existing legacy invitation rows so that pre-existing pending invites
-- continue to redeem against the new endpoint after the cutover.
--
-- Idempotent: only inserts grants for invitations that aren't already
-- mirrored (matched by token_hash). The legacy `invitations` table is
-- dropped by `0002_drop_invitations.sql` (Task #21) once the cutover
-- has settled, so this backfill is a no-op on environments that have
-- already advanced past Task #21 — the `to_regclass` guard below skips
-- the SELECT entirely when the source table is gone.

DO $$
BEGIN
  IF to_regclass('public.invitations') IS NULL THEN
    RAISE NOTICE 'invitations table not present (already dropped by 0002); skipping backfill';
    RETURN;
  END IF;

  INSERT INTO "credential_grants" (
  "id",
  "kind",
  "token_hash",
  "email",
  "user_id",
  "org_id",
  "client_id",
  "role",
  "issued_by_user_id",
  "expires_at",
  "consumed_at",
  "revoked_at",
  "issued_at"
)
SELECT
  gen_random_uuid(),
  'invitation',
  i."token_hash",
  i."email",
  NULL,
  i."org_id",
  i."client_id",
  i."role",
  i."invited_by_user_id",
  i."expires_at",
  i."accepted_at",
  i."revoked_at",
  i."created_at"
  FROM "invitations" i
  LEFT JOIN "credential_grants" g ON g."token_hash" = i."token_hash"
  WHERE g."id" IS NULL;
END $$;
