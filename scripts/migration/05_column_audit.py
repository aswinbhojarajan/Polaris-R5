#!/usr/bin/env python3
"""Column-level source accounting: every column of every backup table must be
either (a) referenced in the corresponding INSERT of 03_import_batch.sql,
(b) in the documented exclusion list below, or the audit FAILS.
Run: python3 scripts/migration/05_column_audit.py
"""
import re, subprocess, sys, os, collections

# columns intentionally not copied, with reasons
EXCLUDED = {
    # config tables skipped entirely by design (identical rows already seeded)
    "ai_models": "*", "prompt_categories": "*", "score_color_bands": "*", "score_interpretations": "*",
    # report_files rows not imported (binaries absent) — whole table documented in migration_map.exclusions
    "report_files": "*",
    # single 'default-org' row already exists in target; verified identical by org_id FK on import
    "organizations": "*",
}

# columns deliberately TRANSFORMED instead of copied verbatim (value derived from source)
TRANSFORMED = {
    "report_snapshots.project_id",  # project *name* string -> planned (de-duplicated) new name from client_batch
    "clients.project_name",         # -> planned (de-duplicated) name from client_batch (user decision)
    "clients.org_id",               # -> 'default-org' (single-org target; source is also default-org)
}

sql = open("scripts/migration/03_import_batch.sql").read()

out = subprocess.check_output([
    "psql", os.environ["DATABASE_URL"], "-Atc",
    "select table_name||'|'||column_name from information_schema.columns where table_schema='backup_import' order by 1"
], text=True)
src = collections.defaultdict(set)
for line in out.strip().splitlines():
    t, c = line.split("|")
    src[t].add(c)

failures = []
reads = re.findall(r"FROM backup_import\.(\w+) (\w+)\b", sql)
for t, alias in reads:
    # every column of table t must be read via its alias somewhere in the file
    for c in src.get(t, ()):  
        if f"{t}.{c}" in TRANSFORMED:
            print(f"TRANSFORMED (documented): {t}.{c}")
            continue
        if not re.search(rf"{alias}\.{c}\b|{alias}\.\"{c}\"", sql):
            failures.append(f"{t}.{c}")

covered = {t for t, _ in reads}
for t in src:
    if t in covered:
        continue
    if EXCLUDED.get(t) == "*":
        print(f"EXCLUDED (documented): {t}")
        continue
    failures.append(f"{t}: entire table not read by import script")

if failures:
    print("FAIL — unaccounted source columns:")
    for f in failures:
        print("  ", f)
    sys.exit(1)
print("OK: every backup column is copied by the import script or documented as excluded")
