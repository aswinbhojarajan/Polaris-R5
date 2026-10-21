# R1A report verification and staged Publish gate

**Status:** owner publishing is complete; the production candidate is verified
with Web Search OFF. Production paid validation, final browser acceptance and
joint activation remain pending; this is not release completion.

The owner has now approved a fresh shared **$50 production ceiling** and
conditional joint activation after all gates pass. Durable, isolated production
controls are implemented and verified offline; the controlled private pilot
requires another owner Publish before any paid call. See
[production pilot controls](R1A_PRODUCTION_PILOT_CONTROLS_2026-10-21.md).

## Published OFF checkpoint

Follow-up production checks establish:
- Published page, live health endpoint and JavaScript asset return HTTP 200.
- Asset `/assets/index-XzBBXYB7.js` contains the Web Search request, invocation
  status and evidence UI paths.
- Managed schema preview has no remaining diff or warnings.
- Production SQL confirms `prompt_run_item_executions`,
  `native_search_validation_reservations` and `prompt_runs.search_config`.
- There are zero queued/running Prompt Runs at this inspection.
- Production catalog enables exact models `gpt-5.6-terra` and `claude-sonnet-5`.
- Selected production native feature/account/approval/cohort configuration is
  absent, including secret-existence checks. Native search remains fail-closed.

These are artifact/schema/OFF-configuration checks, not proof of paid OFF or ON
generation or a completed authenticated browser journey. No provider call or
production data/configuration mutation was made by this inspection.

**Next gate:** a new, explicitly approved production pilot scope and spending
allowance. The current file-backed development launcher is deliberately
development-only; its guard must not be relabeled as production enforcement.
Production-safe whole-pipeline controls must be ready before dispatch. Do not
reuse the closed development USD 50 allowance, enable public approvals from
development evidence, or mark the task complete at this checkpoint.

**Earlier owner gate update:** the owner confirmed production recovery availability and
approved publishing with Web Search OFF. This is owner-confirmed recovery, not
an independently inspected recovery window. A fresh read-only pre-publish check
still shows the same eight additive statements with no removals/warnings, and
all selected production native-search flags/account/approval/cohort variables
are absent (including secret-existence checks). The policy therefore remains
fail-closed. No configuration, schema or deployment mutation was performed.
That managed Publish gate has now been completed by the owner; paid production
validation and activation are still not authorized.

## What was repaired

The existing CSV/JSON exporters retained native evidence, but the report
narrative's raw response data did not guarantee that the generated technical
appendix retained native source associations. The legacy PDF formatter also
did not turn Markdown citation markers into PDF links.

- Add a deterministic native-answer/evidence supplement outside the narrative
  model. Preserve canonical saved answers, cited/consulted source distinctions
  and actual reported identity without changing scoring or analytical counts.
- Apply it to fresh and checkpointed appendices before section storage/rendering,
  and to the separate appendix-regeneration path.
- Keep narrative checkpoints raw so cache reuse cannot repeatedly append the
  supplement. Use retained snapshot data, never a lookup of a deleted run.
- Escape provider text/source titles as inert HTML text. Only validated HTTP(S)
  native citation markers become anchors, after protecting their URLs from
  Markdown formatting. Legacy OFF report rendering remains unchanged.

No provider output, model selection, scorer input, schema or approved web UI
layout was changed. This is report-output fidelity, not a new factual guarantee.

## Verification actually performed

The private temporary PostgreSQL runner never targets development/production
application databases and removes provider credentials. External transports are
synthetic or rejected; these checks made **no paid provider calls**.

- The full 67-test attempt passed 66 and exposed the newly added PDF assertion.
  The affected auth/routes/PDF file was corrected and finally passed **6/6**
  without skips. The other 61 tests' passing evidence remains valid; do not
  describe this as a newly rerun single all-green 67-test invocation.
- Actual real-route/session/CSRF/tenant/queue checks remain covered.
- A real Chromium technical PDF contains the native source as both readable
  extracted text and a clickable PDF URI. Invalid ranges fail closed; untrusted
  source-title HTML stays inert and unsafe link protocols are rejected.
- A report snapshot/section/file is persisted in the private database, its
  original run is deleted through the actual route, and authenticated historical
  snapshot/PDF downloads retain the saved native evidence and exact PDF bytes.
  A foreign tenant is denied; retrieval/rendering make zero provider calls.
- Display augmentation does not mutate snapshot/scoring data. OFF snapshots
  leave the appendix unchanged.
- A separate cheap formatter probe used saved Claude evidence and a citation URL
  containing Markdown metacharacters and query separators; its safe anchor
  target remained intact without changing snapshot data.
- Production build passes. Typecheck remains at the accepted 75 pre-existing
  diagnostics, with no new attribution/template/test diagnostics.

The initial PDF assertion was not accepted as a pass: extraction verified
readable text, then the implementation was extended and the affected suite
rerun to prove actual clickable URI retention. No real paid narrative generation
or full live report-job orchestration is being claimed.

## Publishing preview and remaining gates

The refreshed managed Publish preview still contains exactly eight additive
statements: two tables with checks, one nullable column, three foreign keys and
two indexes. No removals/truncations, structural-data-loss flags or warnings.
Production is still the previous healthy public VM build.

Before the owner publishes:
1. **Owner confirmed:** an available production recovery point/recovery mechanism. Official
   documentation describes production point-in-time restore in database
   settings, but this execution has not independently inspected the current
   database's recovery window. Do not confuse a development code checkpoint
   with a verified production restore point, and do not actually restore data.
2. **Owner approved:** the staged Publish/schema plan; preserve existing production data
   and decline any overwrite/copy-development-data option.
3. Confirm native flags and public approvals remain closed, then have the owner
   publish through the managed flow. Do not apply the reference SQL directly.

### Sequencing clarification

The remaining genuine authenticated browser journey is **not yet verified**.
Reserve the single final critical browser pass for the functionally complete
published candidate/approved production cohort, rather than repeating
development and production passes. It remains an activation/release acceptance
gate. A staged publish with public search OFF is not permission to activate it
or claim that this browser check has passed.

After the verified OFF-only publish: obtain a finite
production whole-pipeline validation allowance and account/environment scope,
complete the approved production checks and final browser acceptance, then
activate OpenAI and Claude in the agreed order/window. The development-only
budget guard and closed USD 50 allowance do not authorize production calls.

Prefer disabling native search with compatible code and retaining additive
schema/evidence over an unsafe binary downgrade while ON jobs exist.

Recovery documentation consulted:
`https://docs.replit.com/features/data-and-storage/data-recovery`.
