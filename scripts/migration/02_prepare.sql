-- Phase 1/2 prep: mapping manifest, admin verification, renames, batch assignment.
-- Idempotent. Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/migration/02_prepare.sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS migration_map;

-- ============ RBAC identity gate (abort if any admin missing) ============
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users u
  JOIN user_org_memberships m ON m.user_id = u.id AND m.org_id = 'default-org' AND m.role = 'admin'
  WHERE u.email IN ('admin@polaris.local','adminuser@polaris.local','owner@polaris.local','aswin.bhojarajan@kearney.com');
  IF n <> 4 THEN RAISE EXCEPTION 'RBAC gate failed: expected 4 default-org admins, found %', n; END IF;
END $$;

-- ============ Seed backup-only AI models into the current catalog (config addition) ============
-- New models present only in the backup (e.g. GPT-5.4, Claude Opus 4.1) are copied verbatim
-- so historical prompt_run_items referencing them stay resolvable.
INSERT INTO public.ai_models (id, vendor, model, display_name, max_tpm, max_rpm, cost_per_1k_input, cost_per_1k_output, enabled, category)
SELECT b.id, b.vendor, b.model, b.display_name, b.max_tpm, b.max_rpm, b.cost_per_1k_input, b.cost_per_1k_output, b.enabled, b.category::text::public.ai_model_category_enum
FROM backup_import.ai_models b
WHERE NOT EXISTS (SELECT 1 FROM public.ai_models p WHERE p.id = b.id)
ON CONFLICT DO NOTHING;

-- ============ Model / category identity gate (abort on any mismatch) ============
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM backup_import.ai_models b
  LEFT JOIN public.ai_models p ON p.id = b.id AND p.vendor = b.vendor AND p.model = b.model
  WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'Model identity gate failed: % backup models without identical current row', n; END IF;
  SELECT count(*) INTO n FROM backup_import.prompt_categories b
  LEFT JOIN public.prompt_categories p ON p.id = b.id AND p.slug = b.slug
  WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'Category identity gate failed: % backup categories without identical current row', n; END IF;
END $$;

-- ============ Schema compatibility preflight gate ============
-- (a) every backup column must exist in the current public schema with a compatible shape;
-- (b) no current-only NOT NULL column without default may exist in an imported table.
-- Current-only nullable/defaulted columns are intentionally left to their defaults (documented).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(b.table_name||'.'||b.column_name, ', ') INTO bad
  FROM information_schema.columns b
  WHERE b.table_schema='backup_import'
    AND b.table_name NOT IN ('ai_models','prompt_categories','score_color_bands','score_interpretations') -- config tables: skipped by design
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns p
      WHERE p.table_schema='public' AND p.table_name=b.table_name AND p.column_name=b.column_name);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Schema gate: backup columns missing in current schema: %', bad; END IF;

  SELECT string_agg(p.table_name||'.'||p.column_name, ', ') INTO bad
  FROM information_schema.columns p
  WHERE p.table_schema='public' AND p.is_nullable='NO' AND p.column_default IS NULL
    AND p.table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='backup_import')
    AND p.table_name NOT IN ('ai_models','prompt_categories','score_color_bands','score_interpretations')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns b
      WHERE b.table_schema='backup_import' AND b.table_name=p.table_name AND b.column_name=p.column_name)
    -- columns the import script itself supplies:
    AND NOT (p.table_name='clients' AND p.column_name IN ('owner_user_id','updated_at'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Schema gate: current NOT NULL columns without default not covered by source or import script: %', bad; END IF;
END $$;

-- ============ ID map: one new UUID for every backup row of every per-project table ============
CREATE TABLE IF NOT EXISTS migration_map.id_map (
  entity text NOT NULL,
  old_id varchar NOT NULL,
  new_id varchar NOT NULL DEFAULT gen_random_uuid(),
  client_old_id varchar,
  PRIMARY KEY (entity, old_id)
);

-- client batches: 1 = pilot (backup-only ids), 2 = remaining
CREATE TABLE IF NOT EXISTS migration_map.client_batch (
  old_id varchar PRIMARY KEY,
  batch int NOT NULL,
  new_project_name text NOT NULL,
  imported_at timestamp
);

INSERT INTO migration_map.client_batch (old_id, batch, new_project_name)
SELECT b.id,
       CASE WHEN p.id IS NULL THEN 1 ELSE 2 END,
       -- de-dup duplicate names inside the backup: append (2), (3) by created_at order
       b.project_name || CASE WHEN rn = 1 THEN '' ELSE ' (' || rn || ')' END
FROM (
  SELECT id, project_name, created_at,
         row_number() OVER (PARTITION BY lower(trim(project_name)) ORDER BY created_at) rn
  FROM backup_import.clients
) b
LEFT JOIN public.clients p ON p.id = b.id
ON CONFLICT (old_id) DO NOTHING;

-- populate id_map for all entities (leaf tables included so snapshot JSON remap is complete)
INSERT INTO migration_map.id_map (entity, old_id, client_old_id)
SELECT 'client', id, id FROM backup_import.clients
UNION ALL SELECT 'competitor', id, client_id FROM backup_import.competitors
UNION ALL SELECT 'topic', id, client_id FROM backup_import.topics
UNION ALL SELECT 'prompt', id, client_id FROM backup_import.prompts
UNION ALL SELECT 'prompt_run', id, client_id FROM backup_import.prompt_runs
UNION ALL SELECT 'prompt_run_item', i.id, r.client_id FROM backup_import.prompt_run_items i JOIN backup_import.prompt_runs r ON r.id = i.prompt_run_id
UNION ALL SELECT 'answer', a.id, r.client_id FROM backup_import.answers a JOIN backup_import.prompt_run_items i ON i.id = a.prompt_run_item_id JOIN backup_import.prompt_runs r ON r.id = i.prompt_run_id
UNION ALL SELECT 'citation', c.id, r.client_id FROM backup_import.citations c JOIN backup_import.answers a ON a.id = c.answer_id JOIN backup_import.prompt_run_items i ON i.id = a.prompt_run_item_id JOIN backup_import.prompt_runs r ON r.id = i.prompt_run_id
UNION ALL SELECT 'mention', m.id, r.client_id FROM backup_import.mentions m JOIN backup_import.answers a ON a.id = m.answer_id JOIN backup_import.prompt_run_items i ON i.id = a.prompt_run_item_id JOIN backup_import.prompt_runs r ON r.id = i.prompt_run_id
UNION ALL SELECT 'ranking', k.id, r.client_id FROM backup_import.rankings k JOIN backup_import.answers a ON a.id = k.answer_id JOIN backup_import.prompt_run_items i ON i.id = a.prompt_run_item_id JOIN backup_import.prompt_runs r ON r.id = i.prompt_run_id
UNION ALL SELECT 'competitor_score', s.id, r.client_id FROM backup_import.competitor_scores s JOIN backup_import.prompt_runs r ON r.id = s.prompt_run_id
UNION ALL SELECT 'score_factor', f.id, r.client_id FROM backup_import.score_factors f JOIN backup_import.prompt_run_items i ON i.id = f.prompt_run_item_id JOIN backup_import.prompt_runs r ON r.id = i.prompt_run_id
UNION ALL SELECT 'recommendation', id, client_id FROM backup_import.recommendations
UNION ALL SELECT 'generated_content', id, client_id FROM backup_import.generated_contents
UNION ALL SELECT 'xray_site', id, client_id FROM backup_import.xray_sites
UNION ALL SELECT 'xray_page', p.id, s.client_id FROM backup_import.xray_pages p JOIN backup_import.xray_sites s ON s.id = p.site_id
UNION ALL SELECT 'xray_page_structure', st.id, s.client_id FROM backup_import.xray_page_structure st JOIN backup_import.xray_pages p ON p.id = st.page_id JOIN backup_import.xray_sites s ON s.id = p.site_id
UNION ALL SELECT 'xray_page_analysis', an.id, s.client_id FROM backup_import.xray_page_analysis an JOIN backup_import.xray_pages p ON p.id = an.page_id JOIN backup_import.xray_sites s ON s.id = p.site_id
UNION ALL SELECT 'report_snapshot', id, client_id FROM backup_import.report_snapshots
UNION ALL SELECT 'report_section', rs.id, sn.client_id FROM backup_import.report_sections rs JOIN backup_import.report_snapshots sn ON sn.id = rs.snapshot_id
UNION ALL SELECT 'report_job', rj.id, sn.client_id FROM backup_import.report_jobs rj JOIN backup_import.report_snapshots sn ON sn.id = rj.snapshot_id
UNION ALL SELECT 'prompt_run_log', l.id, r.client_id FROM backup_import.prompt_run_logs l JOIN backup_import.prompt_runs r ON r.id = l.prompt_run_id
UNION ALL SELECT 'upload', u.id, u.client_id FROM backup_import.uploads u
UNION ALL SELECT 'run_checkpoint', rc.id, r.client_id FROM backup_import.run_checkpoints rc JOIN backup_import.prompt_runs r ON r.id = rc.prompt_run_id
UNION ALL SELECT 'job', j.id, COALESCE(j.payload->>'clientId', pr.client_id, j.payload->'result'->>'clientId')
  FROM backup_import.jobs j
  LEFT JOIN backup_import.prompt_runs pr ON pr.id = j.payload->>'promptRunId'
  WHERE COALESCE(j.payload->>'clientId', pr.client_id, j.payload->'result'->>'clientId') IS NOT NULL
ON CONFLICT (entity, old_id) DO NOTHING;

-- gate: global UUID-token remap requires each old_id to map to exactly ONE new_id
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT old_id FROM migration_map.id_map GROUP BY old_id HAVING count(DISTINCT new_id) > 1) x;
  IF n <> 0 THEN RAISE EXCEPTION 'ID-map ambiguity gate failed: % old_ids map to multiple new_ids', n; END IF;
END $$;

-- Documented exclusion: terminal job rows whose prompt_run was already deleted
-- in the SOURCE backup (orphan history, resolvable to no project).
CREATE TABLE IF NOT EXISTS migration_map.exclusions (
  entity text, old_id varchar, reason text, PRIMARY KEY (entity, old_id)
);
INSERT INTO migration_map.exclusions (entity, old_id, reason)
SELECT 'job', j.id, 'orphan in source backup: payload promptRunId ' || (j.payload->>'promptRunId') || ' does not exist in backup (run deleted before backup was taken); job status=' || j.status::text
FROM backup_import.jobs j
LEFT JOIN backup_import.prompt_runs pr ON pr.id = j.payload->>'promptRunId'
WHERE COALESCE(j.payload->>'clientId', pr.client_id, j.payload->'result'->>'clientId') IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO migration_map.exclusions (entity, old_id, reason)
SELECT 'report_file', id, 'binary not present in this environment (SQL dump carries no file content): ' || file_url
FROM backup_import.report_files
ON CONFLICT DO NOTHING;

-- ============ Rename existing default-org projects (idempotent) ============
UPDATE public.clients
SET project_name = project_name || ' -Existing Dev',
    updated_at = now()
WHERE org_id = 'default-org'
  AND project_name NOT LIKE '% -Existing Dev'
  -- never rename clients created by this migration (idempotent re-runs)
  AND id NOT IN (SELECT new_id FROM migration_map.id_map WHERE entity = 'client');

-- gate: planned import names must be unique among themselves (case-insensitive)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM migration_map.client_batch GROUP BY lower(trim(new_project_name)) HAVING count(*) > 1) x;
  IF n <> 0 THEN RAISE EXCEPTION 'Planned-name duplicate gate failed: % case-insensitive duplicates among planned names', n; END IF;
END $$;

-- gate: no case-insensitive collision between planned import names and current names
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM migration_map.client_batch cb
  JOIN public.clients p ON p.org_id='default-org' AND lower(trim(p.project_name)) = lower(trim(cb.new_project_name))
  WHERE p.id NOT IN (SELECT new_id FROM migration_map.id_map WHERE entity='client')
    AND cb.imported_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'Name collision gate failed: % planned names collide with existing projects', n; END IF;
END $$;

-- self-heal: imported clients must carry exactly their planned name (repairs any prior accidental rename)
UPDATE public.clients c
SET project_name = cb.new_project_name, updated_at = now()
FROM migration_map.client_batch cb
JOIN migration_map.id_map m ON m.entity='client' AND m.old_id = cb.old_id
WHERE c.id = m.new_id AND c.project_name <> cb.new_project_name;

COMMIT;

SELECT batch, count(*) FROM migration_map.client_batch GROUP BY 1 ORDER BY 1;
SELECT entity, count(*) FROM migration_map.id_map GROUP BY 1 ORDER BY 1;
