-- 07_merge_duplicate_models.sql — consolidate duplicate ai_models rows.
-- Canonical = the MIGRATED UUIDs (they back the 127 imported projects' history
-- and already exist in the production source backup). The pre-existing dev
-- twins are remapped and deleted. Idempotent; run in dev now, replay in prod
-- AFTER the data import (see PRODUCTION_RUNBOOK.md).
BEGIN;

CREATE SCHEMA IF NOT EXISTS migration_map;
CREATE TABLE IF NOT EXISTS migration_map.ai_model_map (
  old_id text PRIMARY KEY,
  canonical_id text NOT NULL,
  vendor text NOT NULL,
  model text NOT NULL,
  reason text NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now()
);
-- The canonical ids are the MIGRATED ones (fixed — they come from the backup
-- and are identical in every environment that imported it). The twin old_ids
-- are DISCOVERED in the target database: any other row sharing (vendor,model).
-- This makes the script replayable in prod, where twins have different UUIDs.
INSERT INTO migration_map.ai_model_map (old_id, canonical_id, vendor, model, reason)
SELECT a.id, c.canonical_id, c.vendor, c.model,
       'pre-existing twin merged into migrated canonical row'
FROM (VALUES
  ('64ec2c1d-f985-4378-ae1c-36f7fbabcc2f', 'OpenAI', 'gpt-5.4'),
  ('a03cb4b9-ecb4-45ca-98fc-cced3ab763e8', 'Anthropic', 'claude-opus-4-1')
) AS c(canonical_id, vendor, model)
JOIN public.ai_models a ON a.vendor = c.vendor AND a.model = c.model AND a.id <> c.canonical_id
ON CONFLICT (old_id) DO NOTHING;

-- Gates: every mapped old row (if still present) must match its declared
-- (vendor,model) and differ from canonical; canonical rows must exist; abort
-- if a semantic duplicate run item would be created by the remap.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM migration_map.ai_model_map mm
    WHERE NOT EXISTS (SELECT 1 FROM public.ai_models a WHERE a.id = mm.canonical_id);
  IF n <> 0 THEN RAISE EXCEPTION 'canonical model row missing (%)', n; END IF;

  SELECT count(*) INTO n FROM migration_map.ai_model_map mm
    WHERE mm.old_id = mm.canonical_id;
  IF n <> 0 THEN RAISE EXCEPTION 'ai_model_map: % rows map an id to itself', n; END IF;

  SELECT count(*) INTO n FROM migration_map.ai_model_map mm
    JOIN public.ai_models a ON a.id = mm.old_id
    WHERE a.vendor <> mm.vendor OR a.model <> mm.model;
  IF n <> 0 THEN RAISE EXCEPTION 'ai_model_map: % old rows do not match declared (vendor,model)', n; END IF;

  SELECT count(*) INTO n
  FROM prompt_run_items i
  JOIN migration_map.ai_model_map mm ON mm.old_id = i.model_id
  WHERE EXISTS (SELECT 1 FROM prompt_run_items j
                WHERE j.prompt_run_id = i.prompt_run_id AND j.prompt_id = i.prompt_id
                  AND j.model_id = mm.canonical_id);
  IF n <> 0 THEN RAISE EXCEPTION 'remap would create % duplicate (run,prompt,model) items — needs manual decision', n; END IF;
END $$;

-- FK surfaces
UPDATE prompt_run_items i SET model_id = mm.canonical_id
  FROM migration_map.ai_model_map mm WHERE i.model_id = mm.old_id;
UPDATE llm_function_overrides o SET model_id = mm.canonical_id
  FROM migration_map.ai_model_map mm WHERE o.model_id = mm.old_id;

-- JSON surfaces (exact 36-char UUID token replacement)
UPDATE clients c SET selected_ai_model_ids =
    replace(replace(c.selected_ai_model_ids::text,
      '76cf38dd-32dd-4b45-b473-b19cecedc45a', '64ec2c1d-f985-4378-ae1c-36f7fbabcc2f'),
      '6dc21591-679b-4d11-9190-c130831dc990', 'a03cb4b9-ecb4-45ca-98fc-cced3ab763e8')::jsonb
  WHERE c.selected_ai_model_ids::text LIKE '%76cf38dd-32dd-4b45-b473-b19cecedc45a%'
     OR c.selected_ai_model_ids::text LIKE '%6dc21591-679b-4d11-9190-c130831dc990%';
-- De-duplicate any selection that now contains the canonical id twice
UPDATE clients c SET selected_ai_model_ids = (
    SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements(c.selected_ai_model_ids) e)
  WHERE jsonb_typeof(c.selected_ai_model_ids) = 'array';

UPDATE clients c SET disabled_model_notifications =
    replace(replace(c.disabled_model_notifications::text,
      '76cf38dd-32dd-4b45-b473-b19cecedc45a', '64ec2c1d-f985-4378-ae1c-36f7fbabcc2f'),
      '6dc21591-679b-4d11-9190-c130831dc990', 'a03cb4b9-ecb4-45ca-98fc-cced3ab763e8')::jsonb
  WHERE c.disabled_model_notifications::text LIKE '%76cf38dd%'
     OR c.disabled_model_notifications::text LIKE '%6dc21591%';

UPDATE report_snapshots s SET snapshot_data =
    replace(replace(s.snapshot_data::text,
      '76cf38dd-32dd-4b45-b473-b19cecedc45a', '64ec2c1d-f985-4378-ae1c-36f7fbabcc2f'),
      '6dc21591-679b-4d11-9190-c130831dc990', 'a03cb4b9-ecb4-45ca-98fc-cced3ab763e8')::jsonb
  WHERE s.snapshot_data::text LIKE '%76cf38dd-32dd-4b45-b473-b19cecedc45a%'
     OR s.snapshot_data::text LIKE '%6dc21591-679b-4d11-9190-c130831dc990%';

UPDATE jobs j SET payload =
    replace(replace(j.payload::text,
      '76cf38dd-32dd-4b45-b473-b19cecedc45a', '64ec2c1d-f985-4378-ae1c-36f7fbabcc2f'),
      '6dc21591-679b-4d11-9190-c130831dc990', 'a03cb4b9-ecb4-45ca-98fc-cced3ab763e8')::jsonb
  WHERE j.payload::text LIKE '%76cf38dd%' OR j.payload::text LIKE '%6dc21591%';

UPDATE prompt_run_logs l SET meta =
    replace(replace(l.meta::text,
      '76cf38dd-32dd-4b45-b473-b19cecedc45a', '64ec2c1d-f985-4378-ae1c-36f7fbabcc2f'),
      '6dc21591-679b-4d11-9190-c130831dc990', 'a03cb4b9-ecb4-45ca-98fc-cced3ab763e8')::jsonb
  WHERE l.meta::text LIKE '%76cf38dd%' OR l.meta::text LIKE '%6dc21591%';

UPDATE audit_log a SET metadata =
    replace(replace(a.metadata::text,
      '76cf38dd-32dd-4b45-b473-b19cecedc45a', '64ec2c1d-f985-4378-ae1c-36f7fbabcc2f'),
      '6dc21591-679b-4d11-9190-c130831dc990', 'a03cb4b9-ecb4-45ca-98fc-cced3ab763e8')::jsonb
  WHERE a.metadata::text LIKE '%76cf38dd%' OR a.metadata::text LIKE '%6dc21591%';

-- Delete the merged twins
DELETE FROM ai_models a USING migration_map.ai_model_map mm WHERE a.id = mm.old_id;

-- Never again: one catalog row per (vendor, model)
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_vendor_model_uniq ON ai_models (vendor, model);

-- Post-merge gate: zero references to any merged-away id may remain
DO $$
DECLARE n int;
BEGIN
  SELECT
    (SELECT count(*) FROM prompt_run_items i JOIN migration_map.ai_model_map mm ON mm.old_id = i.model_id)
  + (SELECT count(*) FROM llm_function_overrides o JOIN migration_map.ai_model_map mm ON mm.old_id = o.model_id)
  + (SELECT count(*) FROM clients c CROSS JOIN migration_map.ai_model_map mm WHERE c.selected_ai_model_ids::text LIKE '%'||mm.old_id||'%')
  INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'post-merge gate: % stale references remain', n; END IF;
END $$;

COMMIT;
SELECT 'ai_models rows for merged pairs' what, vendor, model, count(*) FROM ai_models
WHERE (vendor,model) IN (('OpenAI','gpt-5.4'),('Anthropic','claude-opus-4-1')) GROUP BY 2,3;
