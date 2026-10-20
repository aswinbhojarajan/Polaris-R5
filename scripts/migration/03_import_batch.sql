-- Phase 2/3 — Import one batch of projects from backup_import into public.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v batch=1 -f scripts/migration/03_import_batch.sql
-- Idempotent: clients already imported (client_batch.imported_at set) are skipped.
BEGIN;

SET LOCAL mig.batch = :batch;

-- clients in this batch not yet imported
CREATE TEMP TABLE _batch_clients ON COMMIT DROP AS
SELECT cb.old_id, m.new_id, cb.new_project_name
FROM migration_map.client_batch cb
JOIN migration_map.id_map m ON m.entity='client' AND m.old_id = cb.old_id
WHERE cb.batch = :batch AND cb.imported_at IS NULL;

-- Fail loudly if this batch has nothing pending yet its target clients are absent
-- (e.g. migration_map was copied from another environment WITH execution state —
--  reset client_batch.imported_at to NULL there before importing).
DO $$
DECLARE pending int; absent int;
BEGIN
  SELECT count(*) INTO pending FROM _batch_clients;
  IF pending = 0 THEN
    SELECT count(*) INTO absent
    FROM migration_map.client_batch cb
    JOIN migration_map.id_map m ON m.entity='client' AND m.old_id = cb.old_id
    WHERE cb.batch = current_setting('mig.batch')::int
      AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = m.new_id);
    IF absent > 0 THEN
      RAISE EXCEPTION 'Batch % has 0 pending clients but % of its target clients are ABSENT from public.clients. If migration_map was copied from another environment, reset client_batch.imported_at to NULL first.', current_setting('mig.batch'), absent;
    END IF;
  END IF;
END $$;

-- ============ clients ============
INSERT INTO public.clients (id, org_id, project_name, name, website, urls, focus_areas, industry, geography,
  aliases, brand_aliases, selected_ai_model_ids, onboarding_status, is_active, created_at,
  custom_industry, custom_geography,
  owner_user_id, updated_at)
SELECT bc.new_id, 'default-org', bc.new_project_name, c.name, c.website, c.urls, c.focus_areas, c.industry, c.geography,
  c.aliases, c.brand_aliases, c.selected_ai_model_ids, c.onboarding_status::text::public.onboarding_status_enum,
  c.is_active, c.created_at,
  c.custom_industry, c.custom_geography,
  (SELECT id FROM users WHERE email='admin@polaris.local'), now()
FROM backup_import.clients c JOIN _batch_clients bc ON bc.old_id = c.id
ON CONFLICT DO NOTHING;

-- ============ project memberships: all 4 default-org admins ============
INSERT INTO public.project_memberships (client_id, user_id, granted_by_user_id)
SELECT bc.new_id, u.id, (SELECT id FROM users WHERE email='admin@polaris.local')
FROM _batch_clients bc
CROSS JOIN (SELECT id FROM users WHERE email IN
  ('admin@polaris.local','adminuser@polaris.local','owner@polaris.local','aswin.bhojarajan@kearney.com')) u
ON CONFLICT (client_id, user_id) DO NOTHING;

-- ============ competitors / topics / prompts ============
INSERT INTO public.competitors (id, client_id, name, website, aliases)
SELECT m.new_id, bc.new_id, s.name, s.website, s.aliases
FROM backup_import.competitors s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='competitor' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.topics (id, client_id, label, category, keywords, source, accepted, created_at)
SELECT m.new_id, bc.new_id, s.label, s.category, s.keywords, s.source::text::public.source_enum, s.accepted, s.created_at
FROM backup_import.topics s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='topic' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.prompts (id, client_id, text, source, category_id, accepted, created_at)
SELECT m.new_id, bc.new_id, s.text, s.source::text::public.source_enum, s.category_id, s.accepted, s.created_at
FROM backup_import.prompts s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='prompt' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ prompt runs (normalize non-terminal -> cancelled) ============
INSERT INTO public.prompt_runs (id, client_id, name, created_by, total_prompts, status, error_summary, created_at)
SELECT m.new_id, bc.new_id, s.name, s.created_by, s.total_prompts,
  CASE WHEN s.status::text IN ('done','completed_with_errors','error','cancelled')
       THEN s.status::text::public.status_enum ELSE 'cancelled'::public.status_enum END,
  CASE WHEN s.status::text IN ('done','completed_with_errors','error','cancelled') THEN s.error_summary
       ELSE coalesce(s.error_summary || ' | ', '') || '[migration] was non-terminal (' || s.status::text || ') in source backup, normalized to cancelled' END,
  s.created_at
FROM backup_import.prompt_runs s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='prompt_run' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.prompt_run_items (id, prompt_run_id, prompt_id, model_id, status, started_at, finished_at, error)
SELECT m.new_id, mr.new_id, mp.new_id, s.model_id,
  CASE WHEN s.status::text IN ('done','completed_with_errors','error','cancelled')
       THEN s.status::text::public.status_enum ELSE 'cancelled'::public.status_enum END,
  s.started_at, s.finished_at,
  CASE WHEN s.status::text IN ('done','completed_with_errors','error','cancelled') THEN s.error
       ELSE coalesce(s.error || ' | ', '') || '[migration] normalized from ' || s.status::text END
FROM backup_import.prompt_run_items s
JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = s.prompt_run_id
JOIN _batch_clients bc ON bc.old_id = mr.client_old_id
JOIN migration_map.id_map mp ON mp.entity='prompt' AND mp.old_id = s.prompt_id
JOIN migration_map.id_map m ON m.entity='prompt_run_item' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ answers + children ============
INSERT INTO public.answers (id, prompt_run_item_id, raw_response, visibility_score, first_mention_pos, sentiment_score, position_score, citation_count)
SELECT m.new_id, mi.new_id, s.raw_response, s.visibility_score, s.first_mention_pos, s.sentiment_score, s.position_score, s.citation_count
FROM backup_import.answers s
JOIN migration_map.id_map mi ON mi.entity='prompt_run_item' AND mi.old_id = s.prompt_run_item_id
JOIN _batch_clients bc ON bc.old_id = mi.client_old_id
JOIN migration_map.id_map m ON m.entity='answer' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.citations (id, answer_id, url, domain, display_text, position, type, anchor_text, is_self_citation)
SELECT m.new_id, ma.new_id, s.url, s.domain, s.display_text, s.position, s.type::text::public.citation_type_enum, s.anchor_text, s.is_self_citation
FROM backup_import.citations s
JOIN migration_map.id_map ma ON ma.entity='answer' AND ma.old_id = s.answer_id
JOIN _batch_clients bc ON bc.old_id = ma.client_old_id
JOIN migration_map.id_map m ON m.entity='citation' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.mentions (id, answer_id, span, is_alias, sentiment)
SELECT m.new_id, ma.new_id, s.span, s.is_alias, s.sentiment::text::public.sentiment_enum
FROM backup_import.mentions s
JOIN migration_map.id_map ma ON ma.entity='answer' AND ma.old_id = s.answer_id
JOIN _batch_clients bc ON bc.old_id = ma.client_old_id
JOIN migration_map.id_map m ON m.entity='mention' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.rankings (id, answer_id, item, position, is_client_brand, ranking_group)
SELECT m.new_id, ma.new_id, s.item, s.position, s.is_client_brand, s.ranking_group
FROM backup_import.rankings s
JOIN migration_map.id_map ma ON ma.entity='answer' AND ma.old_id = s.answer_id
JOIN _batch_clients bc ON bc.old_id = ma.client_old_id
JOIN migration_map.id_map m ON m.entity='ranking' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ competitor scores / score factors ============
INSERT INTO public.competitor_scores (id, prompt_run_id, prompt_id, competitor_id, competitor_name, is_client,
  visibility_score, sentiment_score, position_score, overall_score, created_at)
SELECT m.new_id, mr.new_id, mp.new_id, mc.new_id, s.competitor_name, s.is_client,
  s.visibility_score, s.sentiment_score, s.position_score, s.overall_score, s.created_at
FROM backup_import.competitor_scores s
JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = s.prompt_run_id
JOIN _batch_clients bc ON bc.old_id = mr.client_old_id
LEFT JOIN migration_map.id_map mp ON mp.entity='prompt' AND mp.old_id = s.prompt_id
LEFT JOIN migration_map.id_map mc ON mc.entity='competitor' AND mc.old_id = s.competitor_id
JOIN migration_map.id_map m ON m.entity='competitor_score' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.score_factors (id, prompt_run_item_id, category, score, relevance_value, position_value,
  positive_mentions, neutral_mentions, negative_mentions, mentions_count, heading_hits_count, created_at)
SELECT m.new_id, mi.new_id, s.category::text::public.score_category_enum, s.score, s.relevance_value, s.position_value,
  s.positive_mentions, s.neutral_mentions, s.negative_mentions, s.mentions_count, s.heading_hits_count, s.created_at
FROM backup_import.score_factors s
JOIN migration_map.id_map mi ON mi.entity='prompt_run_item' AND mi.old_id = s.prompt_run_item_id
JOIN _batch_clients bc ON bc.old_id = mi.client_old_id
JOIN migration_map.id_map m ON m.entity='score_factor' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ recommendations / generated contents ============
INSERT INTO public.recommendations (id, client_id, prompt_run_id, title, description, severity, category,
  examples, action_items, source, created_at, updated_at)
SELECT m.new_id, bc.new_id, mr.new_id, s.title, s.description, s.severity, s.category,
  s.examples, s.action_items, s.source::text::public.recommendation_source_enum, s.created_at, s.updated_at
FROM backup_import.recommendations s
JOIN _batch_clients bc ON bc.old_id = s.client_id
LEFT JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = s.prompt_run_id
JOIN migration_map.id_map m ON m.entity='recommendation' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.generated_contents (id, client_id, prompt_run_id, source_url, source_domain, title, content, target_keywords, created_at)
SELECT m.new_id, bc.new_id, mr.new_id, s.source_url, s.source_domain, s.title, s.content, s.target_keywords, s.created_at
FROM backup_import.generated_contents s
JOIN _batch_clients bc ON bc.old_id = s.client_id
LEFT JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = s.prompt_run_id
JOIN migration_map.id_map m ON m.entity='generated_content' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ x-ray graph ============
INSERT INTO public.xray_sites (id, client_id, domain, site_type, robots_txt_present, ai_txt_present, crawl_access_status,
  robots_rules, ai_txt_content, crawl_evidence, created_at, updated_at, last_probed_at, health_probe_status)
SELECT m.new_id, bc.new_id, s.domain, s.site_type::text::public.site_type_enum, s.robots_txt_present, s.ai_txt_present,
  s.crawl_access_status::text::public.crawl_access_status_enum, s.robots_rules, s.ai_txt_content, s.crawl_evidence,
  s.created_at, s.updated_at, s.last_probed_at, s.health_probe_status::text::public.health_probe_status_enum
FROM backup_import.xray_sites s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='xray_site' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.xray_pages (id, site_id, url, title, page_type, status_code, word_count, raw_html, raw_text, last_modified, created_at, updated_at)
SELECT m.new_id, ms.new_id, s.url, s.title, s.page_type, s.status_code, s.word_count, s.raw_html, s.raw_text, s.last_modified, s.created_at, s.updated_at
FROM backup_import.xray_pages s
JOIN migration_map.id_map ms ON ms.entity='xray_site' AND ms.old_id = s.site_id
JOIN _batch_clients bc ON bc.old_id = ms.client_old_id
JOIN migration_map.id_map m ON m.entity='xray_page' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.xray_page_structure (id, page_id, headings, paragraphs, lists, tables, entities, focus_areas, topics, sentiment_score, link_counts, created_at)
SELECT m.new_id, mp.new_id, s.headings, s.paragraphs, s.lists, s.tables, s.entities, s.focus_areas, s.topics, s.sentiment_score, s.link_counts, s.created_at
FROM backup_import.xray_page_structure s
JOIN migration_map.id_map mp ON mp.entity='xray_page' AND mp.old_id = s.page_id
JOIN _batch_clients bc ON bc.old_id = mp.client_old_id
JOIN migration_map.id_map m ON m.entity='xray_page_structure' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.xray_page_analysis (id, page_id, assessment, gaps, recommendations, actions, seo_issues, freshness_data, consistency_data, compliance_data, scores, created_at, updated_at)
SELECT m.new_id, mp.new_id, s.assessment, s.gaps, s.recommendations, s.actions, s.seo_issues, s.freshness_data, s.consistency_data, s.compliance_data, s.scores, s.created_at, s.updated_at
FROM backup_import.xray_page_analysis s
JOIN migration_map.id_map mp ON mp.entity='xray_page' AND mp.old_id = s.page_id
JOIN _batch_clients bc ON bc.old_id = mp.client_old_id
JOIN migration_map.id_map m ON m.entity='xray_page_analysis' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ report snapshots (remap run_ids; snapshot_data via exact-UUID token replace) ============
INSERT INTO public.report_snapshots (id, client_id, project_id, run_ids, snapshot_data, generated_at, generated_by, status, narrative_generated)
SELECT m.new_id, bc.new_id, bc.new_project_name,
  (SELECT coalesce(jsonb_agg(coalesce(mr.new_id, r.value)), '[]'::jsonb)
     FROM jsonb_array_elements_text(s.run_ids) r(value)
     LEFT JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = r.value),
  s.snapshot_data, -- remapped in-place below
  s.generated_at, s.generated_by, s.status::text::public.report_status_enum, s.narrative_generated
FROM backup_import.report_snapshots s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='report_snapshot' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- exact UUID-token replacement inside snapshot_data, per snapshot, using the FULL manifest.
-- Snapshots may reference entities of OTHER clients (consolidated source DB carries
-- cross-project copies), so the map must not be restricted to the snapshot's own client.
-- Only tokens actually present in the document are replaced (kept fast by extracting them first).
DO $$
DECLARE snap RECORD; pair RECORD; txt text;
BEGIN
  FOR snap IN
    SELECT p.id
    FROM public.report_snapshots p
    JOIN migration_map.id_map m ON m.entity='report_snapshot' AND m.new_id = p.id
    JOIN _batch_clients bc ON bc.old_id = m.client_old_id
  LOOP
    SELECT p.snapshot_data::text INTO txt FROM public.report_snapshots p WHERE p.id = snap.id;
    FOR pair IN
      SELECT DISTINCT im.old_id, im.new_id
      FROM (SELECT (regexp_matches(txt, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g'))[1] tok) t
      JOIN migration_map.id_map im ON im.old_id = t.tok
    LOOP
      txt := replace(txt, pair.old_id, pair.new_id);
    END LOOP;
    UPDATE public.report_snapshots SET snapshot_data = txt::jsonb WHERE id = snap.id;
  END LOOP;
END $$;

INSERT INTO public.report_sections (id, snapshot_id, section_name, section_content, section_order, created_at)
SELECT m.new_id, msn.new_id, s.section_name::text::public.report_section_name_enum, s.section_content, s.section_order, s.created_at
FROM backup_import.report_sections s
JOIN migration_map.id_map msn ON msn.entity='report_snapshot' AND msn.old_id = s.snapshot_id
JOIN _batch_clients bc ON bc.old_id = msn.client_old_id
JOIN migration_map.id_map m ON m.entity='report_section' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

INSERT INTO public.report_jobs (id, snapshot_id, status, progress_percent, progress_message, current_step, model_used, tokens_used, cost_usd, error_message, created_at, completed_at)
SELECT m.new_id, msn.new_id, s.status::text::public.report_job_status_enum, s.progress_percent, s.progress_message, s.current_step, s.model_used, s.tokens_used, s.cost_usd, s.error_message, s.created_at, s.completed_at
FROM backup_import.report_jobs s
JOIN migration_map.id_map msn ON msn.entity='report_snapshot' AND msn.old_id = s.snapshot_id
JOIN _batch_clients bc ON bc.old_id = msn.client_old_id
JOIN migration_map.id_map m ON m.entity='report_job' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- report_files intentionally NOT imported (binaries absent — see migration_map.exclusions)

-- ============ jobs (payload id remap; statuses already terminal) ============
INSERT INTO public.jobs (id, type, payload, status, priority, progress, created_at, started_at, finished_at, error,
  last_heartbeat, resume_count, worker_id, heartbeat_grace_ms)
SELECT mj.new_id, s.type,
  (
    SELECT (jsonb_strip_nulls(s.payload
      || CASE WHEN s.payload ? 'clientId' THEN jsonb_build_object('clientId', bc.new_id) ELSE '{}'::jsonb END
      || CASE WHEN s.payload ? 'sourceClientId' THEN jsonb_build_object('sourceClientId', coalesce(msc.new_id, s.payload->>'sourceClientId')) ELSE '{}'::jsonb END
      || CASE WHEN s.payload ? 'promptRunId' THEN jsonb_build_object('promptRunId', coalesce(mpr.new_id, s.payload->>'promptRunId')) ELSE '{}'::jsonb END
      || CASE WHEN s.payload #> '{result,clientId}' IS NOT NULL THEN jsonb_build_object('result', (s.payload->'result') || jsonb_build_object('clientId', bc.new_id)) ELSE '{}'::jsonb END
    ))
  ),
  s.status::text::public.status_enum, s.priority::text::public.priority_enum, s.progress, s.created_at, s.started_at, s.finished_at, s.error,
  s.last_heartbeat, s.resume_count, s.worker_id, s.heartbeat_grace_ms
FROM backup_import.jobs s
JOIN migration_map.id_map mj ON mj.entity='job' AND mj.old_id = s.id
JOIN _batch_clients bc ON bc.old_id = mj.client_old_id
LEFT JOIN migration_map.id_map mpr ON mpr.entity='prompt_run' AND mpr.old_id = s.payload->>'promptRunId'
LEFT JOIN migration_map.id_map msc ON msc.entity='client' AND msc.old_id = s.payload->>'sourceClientId'
ON CONFLICT DO NOTHING;

-- ============ prompt run logs (remap meta.jobId when mapped) ============
INSERT INTO public.prompt_run_logs (id, prompt_run_id, level, message, meta, "timestamp")
SELECT m.new_id, mr.new_id, s.level::text::public.log_level_enum, s.message,
  CASE WHEN s.meta ? 'jobId' AND mj.new_id IS NOT NULL THEN s.meta || jsonb_build_object('jobId', mj.new_id) ELSE s.meta END,
  s."timestamp"
FROM backup_import.prompt_run_logs s
JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = s.prompt_run_id
JOIN _batch_clients bc ON bc.old_id = mr.client_old_id
LEFT JOIN migration_map.id_map mj ON mj.entity='job' AND mj.old_id = s.meta->>'jobId'
JOIN migration_map.id_map m ON m.entity='prompt_run_log' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ uploads ============
INSERT INTO public.uploads (id, client_id, kind, filename, storage_path, processed, created_at)
SELECT m.new_id, bc.new_id, s.kind::text::public.upload_kind_enum, s.filename, s.storage_path, s.processed, s.created_at
FROM backup_import.uploads s
JOIN _batch_clients bc ON bc.old_id = s.client_id
JOIN migration_map.id_map m ON m.entity='upload' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- ============ run checkpoints (completed_item_ids remapped via prompt_run_item map) ============
INSERT INTO public.run_checkpoints (id, prompt_run_id, completed_item_ids, current_stage, prompt_count, model_count, competitor_count, timeout_ms, last_updated, created_at)
SELECT m.new_id, mr.new_id,
  (SELECT coalesce(jsonb_agg(coalesce(mi.new_id, v.value)), '[]'::jsonb)
     FROM jsonb_array_elements_text(s.completed_item_ids) v(value)
     LEFT JOIN migration_map.id_map mi ON mi.entity='prompt_run_item' AND mi.old_id = v.value),
  s.current_stage, s.prompt_count, s.model_count, s.competitor_count, s.timeout_ms, s.last_updated, s.created_at
FROM backup_import.run_checkpoints s
JOIN migration_map.id_map mr ON mr.entity='prompt_run' AND mr.old_id = s.prompt_run_id
JOIN _batch_clients bc ON bc.old_id = mr.client_old_id
JOIN migration_map.id_map m ON m.entity='run_checkpoint' AND m.old_id = s.id
ON CONFLICT DO NOTHING;

-- mark ONLY the clients imported in this run (rows of _batch_clients) as imported
UPDATE migration_map.client_batch
SET imported_at = now()
WHERE old_id IN (SELECT old_id FROM _batch_clients);

COMMIT;

SELECT 'imported clients in batch ' || :batch AS what, count(*) FROM migration_map.client_batch WHERE batch = :batch AND imported_at IS NOT NULL;
