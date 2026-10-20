#!/usr/bin/env bash
# Reconciliation script that runs automatically after a task agent's branch
# is merged into main. Keep operations idempotent — this may run more than
# once per merge if the platform retries.
set -euo pipefail

# IMPORTANT (Task #21): the legacy `invitations` table is no longer in
# `shared/schema.ts`, so `db:push --force` will DROP it. We must mirror
# any pre-cutover rows into `credential_grants` BEFORE that happens, or
# pending invites on legacy environments would be lost forever. The
# backfill is wrapped in a `to_regclass` guard so it is a safe no-op
# once the source table is gone.
echo "[post_merge_setup] backfilling credential_grants from legacy invitations (Task #18, idempotent, must precede db:push)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_credential_grants_backfill.sql

echo "[post_merge_setup] applying Drizzle schema changes (db:push --force)"
npm run db:push --force

# Belt-and-suspenders: explicitly drop the legacy table in case the
# environment is somehow still carrying it after `db:push` (e.g. a
# managed-database guard prevented the implicit drop). `IF EXISTS`
# makes this a no-op when db:push already removed it.
echo "[post_merge_setup] dropping legacy invitations table (Task #21, idempotent)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0002_drop_invitations.sql

echo "[post_merge_setup] running audit-log rename (Task #19)"
npx tsx server/scripts/audit-rename.ts

echo "[post_merge_setup] running password rotation sweep (Task #19)"
npx tsx server/scripts/rotation-sweep.ts

echo "[post_merge_setup] done"
