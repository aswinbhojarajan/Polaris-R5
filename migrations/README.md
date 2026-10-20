# Migrations

This directory holds the Drizzle-Kit generated artifacts. **The canonical
deployment path for this project is `npm run db:push` (Drizzle's "push" mode)**,
which diffs `shared/schema.ts` against the live database and applies only the
needed `ALTER` / `CREATE` statements. Existing deployments therefore do not
replay these `.sql` files end-to-end.

## File map

- `0000_nebulous_krista_starr.sql` — **fresh-install baseline only.** Generated
  via `drizzle-kit generate` from the full `shared/schema.ts` after the Task #18
  schema additions landed. It is safe to apply against an empty database
  (e.g. a brand-new dev/preview environment), but **must not** be applied
  blindly against an existing deployment — almost every `CREATE TABLE` /
  `CREATE TYPE` would conflict with pre-existing objects.
- `0001_credential_grants_backfill.sql` — **idempotent backfill.** Mirrors any
  pre-existing rows in the legacy `invitations` table into the new
  `credential_grants` primitive. Wrapped in `WHERE NOT EXISTS` guards so it is
  safe to run multiple times. Guarded by `to_regclass('public.invitations')` so
  it becomes a no-op once `0002_drop_invitations.sql` has run. Existing
  deployments must run this file **before** `npm run db:push` (Task #21 removed
  `invitations` from `shared/schema.ts`, so `db:push` will drop the source
  table — running the backfill afterward would be a no-op and any pending
  legacy invites would be lost). See the upgrade procedure below.
- `0002_drop_invitations.sql` — **Task #21 cutover.** Drops the legacy
  `invitations` table (with `IF EXISTS` so it is safe to re-run and safe on
  fresh installs that never created the table). Every reader/writer was moved
  to `credential_grants` in Task #19; this file makes the retirement physical
  so the two stores cannot drift again.
- `0013_finalize_ai_model_catalog.sql` — **validated catalog cutover.** Adds
  the `internal_only` safeguard if needed, releases the 13 validated
  prompt-run models, and enforces exactly one Core model for OpenAI,
  Anthropic, and Google. It is idempotent for existing databases. Because
  existing deployments use `db:push` rather than replaying SQL files,
  `seedDatabase()` also applies this data cutover exactly once under a durable
  audit marker after the Publish schema diff completes.

## Upgrade procedure for an existing deployment

The order below is load-bearing. Since the post-Task-#21 `shared/schema.ts`
no longer declares `invitations`, running `db:push` first would let Drizzle
drop the table before its rows are mirrored — pending legacy invites would
be lost. Always backfill first.

```bash
# 1. Backfill the unified credential-grants table from any legacy
#    invitation rows. Idempotent and guarded by `to_regclass`, so it is a
#    no-op once the source table is gone.
psql "$DATABASE_URL" -f migrations/0001_credential_grants_backfill.sql

# 2. Apply the schema diffs. With `invitations` removed from the schema,
#    Drizzle will drop it here on environments that still carry it.
npm run db:push

# 3. Belt-and-suspenders: explicitly drop the legacy invitations table in
#    case `db:push` left it in place (managed-DB guard, etc.). `IF EXISTS`
#    keeps this safe to re-run.
psql "$DATABASE_URL" -f migrations/0002_drop_invitations.sql
```

`db:push` is preferred over replaying the baseline because it inspects the
target database first and only emits the ALTERs that are actually needed —
making it the safe default for upgrades. The baseline `.sql` exists so that
fresh environments and CI scratch databases can be provisioned without a
running drizzle-kit.
