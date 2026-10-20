#!/usr/bin/env python3
"""Phase 1 — Stage the backup dump into an isolated scratch schema.

Rewrites schema-qualified references `public.` -> `backup_import.` ONLY on
lines outside COPY data blocks (data rows are never touched), drops the
search_path reset, and writes /tmp/backup_import.sql ready for psql.
"""
import re, sys

SRC = "attached_assets/Polaris-DEV-R2-Remix-3003_PROD_DBBK_v4_FINAL_CONSOLIDATED_DB_9_1786277556046.sql"
OUT = "/tmp/backup_import.sql"

in_copy = False
with open(SRC) as f, open(OUT, "w") as o:
    o.write("SET client_min_messages = warning;\n")
    o.write("DROP SCHEMA IF EXISTS backup_import CASCADE;\n")
    o.write("CREATE SCHEMA backup_import;\n")
    for line in f:
        if in_copy:
            o.write(line)
            if line.rstrip("\n") == "\\.":
                in_copy = False
            continue
        # skip the search_path reset so our rewrite governs
        if line.startswith("SELECT pg_catalog.set_config('search_path'"):
            continue
        # skip newer pg_dump \restrict/\unrestrict guards (not needed for staging)
        if line.startswith("\\restrict") or line.startswith("\\unrestrict"):
            continue
        # skip ACL/ownership statements referencing roles that don't exist here
        if line.startswith("ALTER DEFAULT PRIVILEGES") or line.startswith("GRANT ") or line.startswith("REVOKE "):
            continue
        rewritten = line.replace("public.", "backup_import.")
        o.write(rewritten)
        if re.match(r"COPY backup_import\.\w+ \(", rewritten):
            in_copy = True
print("wrote", OUT)

# fail-fast sanity: no `public.` reference may remain outside COPY data blocks
bad = 0
in_copy = False
for line in open(OUT):
    if in_copy:
        if line.rstrip("\n") == "\\.":
            in_copy = False
        continue
    if re.match(r"COPY backup_import\.\w+ \(", line):
        in_copy = True
        continue
    if "public." in line:
        bad += 1
        print("UNREWRITTEN:", line.rstrip())
if bad:
    sys.exit(f"FAIL: {bad} lines still reference public. — aborting")
print("OK: staged SQL references only backup_import schema")
