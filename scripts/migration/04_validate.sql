-- Gate validation — run after each batch import.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/migration/04_validate.sql
-- All checks raise on failure; final SELECTs are the human-readable report.

-- imported clients so far
CREATE TEMP TABLE _done AS
SELECT cb.old_id, m.new_id
FROM migration_map.client_batch cb
JOIN migration_map.id_map m ON m.entity='client' AND m.old_id = cb.old_id
WHERE cb.imported_at IS NOT NULL;

DO $$
DECLARE r RECORD; bad bigint;
BEGIN
  -- guard against vacuous pass: at least one imported client must exist
  SELECT count(*) INTO bad FROM _done;
  IF bad = 0 THEN RAISE EXCEPTION 'Validation is vacuous: 0 clients marked imported'; END IF;
  -- 1) Row-count parity per entity (backup rows for imported clients == mapped rows present in public)
  FOR r IN
    WITH expected AS (
      SELECT m.entity, count(*) n
      FROM migration_map.id_map m JOIN _done d ON d.old_id = m.client_old_id
      WHERE m.entity NOT IN ('job') OR m.old_id NOT IN (SELECT old_id FROM migration_map.exclusions WHERE entity='job')
      GROUP BY 1),
    actual AS (
      SELECT 'client' e, count(*) n FROM public.clients p JOIN _done d ON d.new_id=p.id
      UNION ALL SELECT 'competitor', count(*) FROM public.competitors p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'topic', count(*) FROM public.topics p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'prompt', count(*) FROM public.prompts p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'prompt_run', count(*) FROM public.prompt_runs p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'prompt_run_item', count(*) FROM public.prompt_run_items p JOIN public.prompt_runs r2 ON r2.id=p.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'answer', count(*) FROM public.answers p JOIN public.prompt_run_items i ON i.id=p.prompt_run_item_id JOIN public.prompt_runs r2 ON r2.id=i.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'citation', count(*) FROM public.citations p JOIN public.answers a ON a.id=p.answer_id JOIN public.prompt_run_items i ON i.id=a.prompt_run_item_id JOIN public.prompt_runs r2 ON r2.id=i.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'mention', count(*) FROM public.mentions p JOIN public.answers a ON a.id=p.answer_id JOIN public.prompt_run_items i ON i.id=a.prompt_run_item_id JOIN public.prompt_runs r2 ON r2.id=i.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'ranking', count(*) FROM public.rankings p JOIN public.answers a ON a.id=p.answer_id JOIN public.prompt_run_items i ON i.id=a.prompt_run_item_id JOIN public.prompt_runs r2 ON r2.id=i.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'competitor_score', count(*) FROM public.competitor_scores p JOIN public.prompt_runs r2 ON r2.id=p.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'score_factor', count(*) FROM public.score_factors p JOIN public.prompt_run_items i ON i.id=p.prompt_run_item_id JOIN public.prompt_runs r2 ON r2.id=i.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'recommendation', count(*) FROM public.recommendations p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'generated_content', count(*) FROM public.generated_contents p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'xray_site', count(*) FROM public.xray_sites p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'xray_page', count(*) FROM public.xray_pages p JOIN public.xray_sites s ON s.id=p.site_id JOIN _done d ON d.new_id=s.client_id
      UNION ALL SELECT 'xray_page_structure', count(*) FROM public.xray_page_structure p JOIN public.xray_pages g ON g.id=p.page_id JOIN public.xray_sites s ON s.id=g.site_id JOIN _done d ON d.new_id=s.client_id
      UNION ALL SELECT 'xray_page_analysis', count(*) FROM public.xray_page_analysis p JOIN public.xray_pages g ON g.id=p.page_id JOIN public.xray_sites s ON s.id=g.site_id JOIN _done d ON d.new_id=s.client_id
      UNION ALL SELECT 'report_snapshot', count(*) FROM public.report_snapshots p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'report_section', count(*) FROM public.report_sections p JOIN public.report_snapshots sn ON sn.id=p.snapshot_id JOIN _done d ON d.new_id=sn.client_id
      UNION ALL SELECT 'report_job', count(*) FROM public.report_jobs p JOIN public.report_snapshots sn ON sn.id=p.snapshot_id JOIN _done d ON d.new_id=sn.client_id
      UNION ALL SELECT 'job', count(*) FROM public.jobs p JOIN migration_map.id_map m ON m.entity='job' AND m.new_id=p.id JOIN _done d ON d.old_id=m.client_old_id
      UNION ALL SELECT 'prompt_run_log', count(*) FROM public.prompt_run_logs p JOIN public.prompt_runs r2 ON r2.id=p.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
      UNION ALL SELECT 'upload', count(*) FROM public.uploads p JOIN _done d ON d.new_id=p.client_id
      UNION ALL SELECT 'run_checkpoint', count(*) FROM public.run_checkpoints p JOIN public.prompt_runs r2 ON r2.id=p.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
    )
    SELECT e.entity, e.n expected, coalesce(a.n,0) actual
    FROM expected e LEFT JOIN actual a ON a.e = e.entity
    WHERE e.n <> coalesce(a.n,0)
  LOOP
    RAISE EXCEPTION 'Parity failed for %: expected % got %', r.entity, r.expected, r.actual;
  END LOOP;

  -- 2) Zero old IDs of ANY entity anywhere in imported JSON/text reference surfaces.
  --    Extract every UUID token from the imported documents and anti-join against the full old-ID map.
  SELECT count(*) INTO bad FROM (
    SELECT u2.tok FROM public.report_snapshots p JOIN _done d ON d.new_id=p.client_id,
      LATERAL regexp_matches(p.snapshot_data::text || ' ' || p.run_ids::text,
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') u(tok0),
      LATERAL (SELECT u0 FROM unnest(u.tok0) u0) u2(tok)
    UNION ALL
    SELECT u2.tok FROM public.jobs p JOIN migration_map.id_map mj ON mj.entity='job' AND mj.new_id=p.id
      JOIN _done d ON d.old_id=mj.client_old_id,
      LATERAL regexp_matches(p.payload::text,
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') u(tok0),
      LATERAL (SELECT u0 FROM unnest(u.tok0) u0) u2(tok)
    UNION ALL
    SELECT u2.tok FROM public.prompt_run_logs p JOIN public.prompt_runs r2 ON r2.id=p.prompt_run_id
      JOIN _done d ON d.new_id=r2.client_id,
      LATERAL regexp_matches(coalesce(p.meta::text,''),
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') u(tok0),
      LATERAL (SELECT u0 FROM unnest(u.tok0) u0) u2(tok)
  ) toks
  WHERE toks.tok IN (SELECT old_id FROM migration_map.id_map)
    AND toks.tok NOT IN (SELECT new_id FROM migration_map.id_map); -- old ids that are not simultaneously someone's new id
  IF bad<>0 THEN RAISE EXCEPTION 'Old ids remain in imported JSON surfaces (snapshot_data/run_ids/jobs.payload/logs.meta): %', bad; END IF;

  -- 2b) Source-accounting gate: every backup source row is mapped exactly once or in approved exclusions
  FOR r IN
    WITH src AS (
      SELECT 'client' e, count(*) n FROM backup_import.clients
      UNION ALL SELECT 'competitor', count(*) FROM backup_import.competitors
      UNION ALL SELECT 'topic', count(*) FROM backup_import.topics
      UNION ALL SELECT 'prompt', count(*) FROM backup_import.prompts
      UNION ALL SELECT 'prompt_run', count(*) FROM backup_import.prompt_runs
      UNION ALL SELECT 'prompt_run_item', count(*) FROM backup_import.prompt_run_items
      UNION ALL SELECT 'answer', count(*) FROM backup_import.answers
      UNION ALL SELECT 'citation', count(*) FROM backup_import.citations
      UNION ALL SELECT 'mention', count(*) FROM backup_import.mentions
      UNION ALL SELECT 'ranking', count(*) FROM backup_import.rankings
      UNION ALL SELECT 'competitor_score', count(*) FROM backup_import.competitor_scores
      UNION ALL SELECT 'score_factor', count(*) FROM backup_import.score_factors
      UNION ALL SELECT 'recommendation', count(*) FROM backup_import.recommendations
      UNION ALL SELECT 'generated_content', count(*) FROM backup_import.generated_contents
      UNION ALL SELECT 'xray_site', count(*) FROM backup_import.xray_sites
      UNION ALL SELECT 'xray_page', count(*) FROM backup_import.xray_pages
      UNION ALL SELECT 'xray_page_structure', count(*) FROM backup_import.xray_page_structure
      UNION ALL SELECT 'xray_page_analysis', count(*) FROM backup_import.xray_page_analysis
      UNION ALL SELECT 'report_snapshot', count(*) FROM backup_import.report_snapshots
      UNION ALL SELECT 'report_section', count(*) FROM backup_import.report_sections
      UNION ALL SELECT 'report_job', count(*) FROM backup_import.report_jobs
      UNION ALL SELECT 'report_file', count(*) FROM backup_import.report_files
      UNION ALL SELECT 'job', count(*) FROM backup_import.jobs
      UNION ALL SELECT 'prompt_run_log', count(*) FROM backup_import.prompt_run_logs
      UNION ALL SELECT 'upload', count(*) FROM backup_import.uploads
      UNION ALL SELECT 'run_checkpoint', count(*) FROM backup_import.run_checkpoints
    ),
    acct AS (
      SELECT entity e, count(*) n FROM (
        SELECT entity, old_id FROM migration_map.id_map
        UNION SELECT entity, old_id FROM migration_map.exclusions) x GROUP BY 1)
    SELECT s.e, s.n src_rows, coalesce(a.n,0) accounted
    FROM src s LEFT JOIN acct a ON a.e = s.e
    WHERE s.n <> coalesce(a.n,0)
  LOOP
    RAISE EXCEPTION 'Source accounting failed for %: % source rows, % accounted (map+exclusions)', r.e, r.src_rows, r.accounted;
  END LOOP;

  -- 3) No non-terminal statuses among imported runs/items/jobs
  SELECT count(*) INTO bad FROM public.prompt_runs p JOIN _done d ON d.new_id=p.client_id
    WHERE p.status::text NOT IN ('done','completed_with_errors','error','cancelled');
  IF bad<>0 THEN RAISE EXCEPTION 'Non-terminal imported prompt_runs: %', bad; END IF;
  SELECT count(*) INTO bad FROM public.prompt_run_items p JOIN public.prompt_runs r2 ON r2.id=p.prompt_run_id JOIN _done d ON d.new_id=r2.client_id
    WHERE p.status::text NOT IN ('done','completed_with_errors','error','cancelled');
  IF bad<>0 THEN RAISE EXCEPTION 'Non-terminal imported prompt_run_items: %', bad; END IF;
  SELECT count(*) INTO bad FROM public.jobs p JOIN migration_map.id_map m ON m.entity='job' AND m.new_id=p.id JOIN _done d ON d.old_id=m.client_old_id
    WHERE p.status::text NOT IN ('done','error','cancelled');
  IF bad<>0 THEN RAISE EXCEPTION 'Non-terminal imported jobs: %', bad; END IF;

  -- 4) RBAC: every imported client has all 4 admin memberships + owner set
  SELECT count(*) INTO bad FROM _done d
    LEFT JOIN (SELECT client_id, count(*) c FROM public.project_memberships GROUP BY 1) pm ON pm.client_id=d.new_id
    WHERE coalesce(pm.c,0) < 4;
  IF bad<>0 THEN RAISE EXCEPTION 'Clients missing admin memberships: %', bad; END IF;
  SELECT count(*) INTO bad FROM public.clients p JOIN _done d ON d.new_id=p.id WHERE p.owner_user_id IS NULL;
  IF bad<>0 THEN RAISE EXCEPTION 'Imported clients without owner: %', bad; END IF;

  RAISE NOTICE 'ALL GATE CHECKS PASSED';
END $$;

-- human-readable report
SELECT p.project_name, p.name,
  (SELECT count(*) FROM public.prompts x WHERE x.client_id=p.id) prompts,
  (SELECT count(*) FROM public.prompt_runs x WHERE x.client_id=p.id) runs,
  (SELECT count(*) FROM public.report_snapshots x WHERE x.client_id=p.id) reports
FROM public.clients p JOIN _done d ON d.new_id=p.id ORDER BY 1;
