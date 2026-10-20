# Production Migration Runbook (Phase 4 — document only, DO NOT run without approval)

Goal: bring the migrated projects into the production database (separate Neon DB behind the published app at polaris-r3.ignitelabs.online) after publishing.

> **Source of truth (v2):** the consolidated backup `Polaris-DEV-R2-Remix-3003_PROD_DBBK_v4_FINAL_CONSOLIDATED_DB_9_1786277556046.sql` (127 projects). The dev DB now holds the fully validated, remapped import of it, plus `migration_map` as the permanent manifest. After importing, also run `scripts/migration/06_disable_non_backup.sql` so only backup projects are active.

## Recommended approach
Because dev now holds the fully validated, remapped data, migrate **dev → prod** (not backup → prod). Two options:

### Option A — prod is empty / prod data is disposable (simplest)
1. Publish the app first so prod schema is migrated to the current code's schema (`npm run db:push` equivalent runs against prod per deployment setup).
2. `pg_dump -Fc "$DEV_DATABASE_URL" --schema=public --schema=migration_map -f dev_data.dump` — **including `migration_map` is mandatory** (validation in step 4 requires it; it is the permanent identity manifest). Never include `backup_import`.
3. `pg_restore --data-only --disable-triggers` into prod inside one transaction, seeded config tables first or excluded if already seeded identically (they are — same IDs).
4. Run `scripts/migration/04_validate.sql` against prod (needs `migration_map` present there).

### Option B — prod already has live data to preserve
Repeat the exact dev procedure against prod:
1. Take a prod backup first (`pg_dump -Fc`), verify with `pg_restore -l`, store checksum.
2. Load the source dump into prod via `scripts/migration/01_stage_backup.py` output (`psql -f /tmp/backup_import.sql`).
3. Copy `migration_map` schema from dev to prod (`pg_dump -n migration_map | psql`) so the SAME new IDs are used in both environments — important so URLs/manifests match.
   - **Then RESET the copied execution state — mandatory:** `UPDATE migration_map.client_batch SET imported_at = NULL;` The copied schema records dev's completed runs; without this reset every batch selects zero pending clients and imports nothing. Only the ID/name/batch *mapping* may carry over, never execution state. (`03_import_batch.sql` fails loudly if a batch has zero pending clients while its target clients are absent, so a forgotten reset aborts instead of silently succeeding.)
   - In `03_import_batch.sql` nothing else changes; `02_prepare.sql` gates re-run safely (skip its map/batch inserts since copied — they're `ON CONFLICT DO NOTHING`, safe).
4. Verify the 4 admin users exist in prod with default-org admin role (RBAC gate aborts otherwise).
5. Run batches 1 then 2, running `04_validate.sql` after each.
6. **Duplicate-model merge — mandatory:** prod's seeded catalog contains its own GPT-5.4 / Claude Opus 4.1 rows while the imported history references the migrated (canonical) UUIDs. After the import, run `scripts/migration/07_merge_duplicate_models.sql` against prod — it remaps prod's pre-existing twin IDs to the canonical migrated IDs, deletes the twins, and adds the unique `(vendor, model)` index. The script discovers the target environment's twin UUIDs itself (any row sharing (vendor,model) with a canonical migrated id) — no manual edits needed, and it is safe even though the copied `migration_map.ai_model_map` already contains dev's entries. (Under Option A a wholesale dev restore already carries the merged catalog; run 07 there only if the restore preserved prod's old catalog rows.)
7. **Renames — caution:** `02_prepare.sql` unconditionally appends ` -Existing Dev` to every default-org project not already suffixed. Before running it against prod, DELETE or comment out that `UPDATE public.clients ...` statement unless prod really contains the same legacy dev projects to be renamed. Never run it as-is against a prod with unrelated live projects.

## Pre-flight checklist
- [ ] Fresh prod backup taken, restore-verified, checksummed
- [ ] App published so prod schema matches current code
- [ ] 4 admin accounts present in prod (`admin@`, `adminuser@`, `owner@polaris.local`, `aswin.bhojarajan@kearney.com`) with default-org admin role
- [ ] Config catalogs (ai_models, prompt_categories) seeded and identical to dev (identity gate enforces)
- [ ] Maintenance window: pause report/prompt-run activity during import (all imported rows are terminal, but avoid concurrent writes to the same projects)
- [ ] After import: spot-check 2–3 projects in the UI, check report snapshots render, confirm no download buttons for legacy PDFs (expected — binaries were never in the backup)

## Rollback
Restore the pre-import prod backup taken in step 1, or delete imported rows using `migration_map.id_map` new IDs in reverse dependency order.
