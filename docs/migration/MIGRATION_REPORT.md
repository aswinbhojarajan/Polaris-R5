# Backup Data Migration — Dev Import Report (v2, correct source)

**Date:** 2026-08-09 · **Source:** `attached_assets/Polaris-DEV-R2-Remix-3003_PROD_DBBK_v4_FINAL_CONSOLIDATED_DB_9_1786277556046.sql` (PG16 plain dump, sha256 in `storage/migration/source_dump_v2.sha256`)

> **Supersedes the v1 import** from `database_backup_helium_ready_1770044151699.sql` (25 projects) — that was the wrong source file and its import was fully reverted by restoring `storage/migration/pre_migration_dev_backup_20260809.dump` and dropping the old `backup_import`/`migration_map` schemas. Safety backup of the pre-revert state: `storage/migration/pre_revert_backup_20260809_task7.dump`.

## Outcome
All **127 client projects** from the consolidated backup were imported under **new UUIDs** in two gated batches (109 backup-only IDs, 18 whose old IDs collided with existing dev rows). 98,586 source rows staged with 0 count mismatches; 98,459 rows mapped in the manifest.

Per user decision:
- `is_active` copied **verbatim** from the backup → exactly **53 active projects** (incl. all 4 Diageo projects), matching the source.
- **Every non-backup project disabled** (118 rows set inactive — the 24 renamed ` -Existing Dev` legacy projects plus test rows). Nothing deleted.

All validation gates passed (`04_validate.sql`): row-count parity for all 25 per-project entities, zero old UUIDs in any JSON surface, source-accounting (every source row mapped or excluded), no non-terminal statuses (all source runs were already terminal — 0 normalizations needed), RBAC (owner = admin@polaris.local + 4 admin memberships per project). Column-level accounting (`05_column_audit.py`) passes.

## New-source specifics (vs v1 procedure)
- **2 new AI models seeded** into the current catalog (GPT-5.4, Claude Opus 4.1) — present only in the backup, referenced by 160 run items; copied verbatim in `02_prepare.sql` before the identity gate.
- `created_by`/`generated_by` sentinel strings (`user`, `system`) exist in the source; no FK on those columns — copied verbatim.
- **Cross-project snapshot references:** consolidated-source snapshots reference entities of other clients, so `snapshot_data` UUID remap now uses the FULL id map (token-extraction driven), guarded by an id-map ambiguity gate in `02_prepare.sql`.
- `clients.custom_industry`/`custom_geography` now copied (new columns in this source).
- Staging skips `\restrict` guards and ACL statements from newer pg_dump output.

## Documented exceptions (`migration_map.exclusions`)
- **54 `report_files` rows NOT imported** — the SQL dump carries no binaries. Snapshots, sections and job history were imported; reports can be regenerated.
- **23 orphan job rows NOT imported** — terminal jobs whose prompt run was already deleted in the source.

## Manifest / artifacts
- Old→new client manifest incl. active flags: `docs/migration/client_id_manifest.csv` (127 rows).
- Full row-level map: `migration_map.id_map` (98,459 rows); exclusions: `migration_map.exclusions` (permanent — prod import must reuse this manifest, never regenerate).
- Staged source retained in `backup_import` (drop after sign-off; keep `migration_map`).
- Execution evidence: `docs/migration/execution_evidence.txt`.

## Scripts (idempotent, re-runnable)
| Script | Purpose |
|---|---|
| `scripts/migration/01_stage_backup.py` | Rewrite dump into isolated `backup_import` schema (COPY data untouched; fail-fast rewrite assertion) |
| `scripts/migration/02_prepare.sql` | Gates (RBAC, model/category identity, schema preflight, id-map ambiguity, name dedupe/collision), new-model seeding, ID map, renames, batches |
| `scripts/migration/03_import_batch.sql` | Transactional batch import (`-v batch=N`), conflict-safe, loud-fail on copied execution state |
| `scripts/migration/04_validate.sql` | All gate checks (incl. anti-vacuous guard); raises on any failure |
| `scripts/migration/05_column_audit.py` | Column-level source accounting |
| `scripts/migration/06_disable_non_backup.sql` | Disable every project not created by this migration (user decision; disable-only) |

