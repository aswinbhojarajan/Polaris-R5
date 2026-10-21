# R1A — read-only production readiness and Claude quality decision

**Date:** 2026-10-21, Asia/Dubai; observations at approximately
20:26–20:33 UTC on October 20.  
**Scope:** Owner-approved read-only inspection and quality evaluation. No
production writes, publishing, activation, login/session creation or paid calls.

## Decision summary

- **Release scope: both OpenAI and Claude.** The owner explicitly requires Claude
  in production alongside OpenAI. An OpenAI-only release is not the fallback.
- **Claude quality decision: owner accepted the documented freshness limitation.**
  Keep both providers in the release. Its native integration passed;
  its latest-version answers did not. Do not relabel the failed checks as passes.
  [Exact prompt, parameters and both responses](CLAUDE_FRESHNESS_INVESTIGATION_2026-10-21.md).
- **Publishing readiness: conditional**, pending final unpaid browser/report
  verification and approval of the additive schema/publish plan.
- **Activation: NO-GO today.** The published app/schema are not the R1A candidate;
  production model/account/tool execution is not yet validated or approved.

## Verified production observations

| Area | Read-only evidence | Interpretation |
| --- | --- | --- |
| Deployment | Successful public VM deployment; primary URL `https://polaris-r5.ignitelabs.online`; additional URL `https://polaris-r-5-remix-2010.replit.app` | Current published service exists; deployment success alone is not feature parity |
| Runtime | Primary `/health/live` returned `status: alive` at `2026-10-20T20:26:36.280Z` | Process alive; not a full authenticated journey |
| Published UI | `/assets/index-BTL1NwR2.js`; candidate build has `/assets/index-BMdF2ljx.js` | Different assets; published bundle lacks candidate's `webSearchEnabled`, `invocationStatus` and `search-evidence` markers |
| Database access | Approved production read-only SQL now succeeds | Earlier execution's authentication denial no longer blocks inspection |
| Run configuration | `prompt_runs.search_config` absent | R1A schema not published |
| Evidence/checkpoint table | `prompt_run_item_executions` absent | R1A schema not published |
| Validation reservations | `native_search_validation_reservations` absent | R1A schema not published |
| Catalog | `gpt-5.6-terra` and `claude-sonnet-5` both enabled, not internal-only | Catalog selection exists; does not establish native-search eligibility |
| Configuration | No configured native flags, environment/account references, approvals or cohorts | New code's policy will fail closed by default; this is a settings snapshot, not live-process environment attestation |
| Secret presence | OpenAI, Anthropic and session secrets present; database URL runtime-managed | Presence only; no values inspected, no quota/account entitlement inferred |
| Queue | No queued/running jobs at inspection | Snapshot only; recheck during the actual release window |

The application uses `DATABASE_URL`; the platform identifies that key as
runtime-managed and computes a matching production schema diff. Use the
managed Publish schema workflow for this inspected target, not a custom
production SQL script. A Neon driver alone was not used to infer ownership.

Private tool receipts, including the complete SQL preview and configuration
**presence only**, are retained in ignored
`generated-artifacts/web-search-pilot/production-readiness-20261021.json`.

## Reviewed schema preview — not applied

The platform's read-only Publish preview reports **eight statements**:

1. Create `native_search_validation_reservations`, including positive item count.
2. Create `prompt_run_item_executions`, including answer/evidence size bounds,
   phase constraint, lease/claim/checkpoint fields and the ledger default.
3. Add nullable `prompt_runs.search_config` JSONB.
4. Add canonical-answer foreign key, `ON DELETE SET NULL`.
5. Add item foreign key, `ON DELETE CASCADE`.
6. Add run foreign key, `ON DELETE CASCADE`.
7. Create unique approval/run reservation index.
8. Create execution run-ID index.

Preview flags: `hasStructuralDataLoss=false`,
`maybeNonBackwardsCompatible=false`; warnings and all removal/truncation lists
are empty. No backfill, model changes or status-enum rewrite is proposed.
This is an observation, not a guarantee about a later changed diff or zero
lock time. Review the actual Publish dialog again before proceeding.

Preserve production data. Do **not** choose an overwrite/copy-development-data
option, seed pilot fixtures into production, replay baseline migrations, run
the reference SQL file directly against production, or add startup/build DDL.
Existing build/run commands are ordinary build/start, not migration hooks.

## Claude quality evaluation

The development probe and inherited-ON rerun both selected Firefox 158.0
(October 13), although the official 158.0.1 point release was available before
these calls. See the [paid evidence and timestamped ground truth](R1A_PAID_VALIDATION_RESULTS_2026-10-21.md#freshness-finding--do-not-hide-or-silently-correct-it).

What passed:
- Exact selected/reported model identity, native tool invocation and bounded
  execution.
- Canonical answer/citation/source preservation, valid spans and source IDs.
- Real queue, scoring, discovery, recommendations, drafts and exports.
- Both stale-answer cases used two searches, below the five-use item limit.
  There is no evidence that increasing that limit would fix this finding.

What failed:
- Selecting the most recent point release in this particular current-fact test.
- Native invocation cannot be marketed as proof that an answer is current or
  factually correct. OpenAI's observed pass is not a universal guarantee either.

**Why recommend keeping Claude:** Polaris measures how the selected model
actually answers and represents brands. A validly attributed stale response is
an important observed provider result, not by itself a transport, model-routing
or evidence-integrity defect. Excluding Claude, rewriting its answer, changing
only its prompt or repeatedly rerunning until a desired answer appears would
distort that measurement.

Accept this as a documented provider-quality limitation for the proposed R1A
release. The owner accepted this quality limitation; production publishing,
spending and activation still require separate approval. Preserve the failed quality result.
Do not require perfect factual freshness as an unachievable implicit activation
guarantee, and do not relax model identity, attribution or execution checks.
No extra development paid experiment is recommended as a prerequisite.

If production verification instead finds missing/invalid attribution, wrong
identity, broken canonical persistence/scoring, tool failures or unbounded
dispatch, stop activation for that combination. The joint release stays on hold
until corrected; do not quietly remove Claude from the release.

## Remaining execution sequence

1. Report-attribution repairs and real PDF/retained-download verification are
   complete without paid calls; see the [Publish gate checkpoint](R1A_REPORT_VERIFICATION_AND_PUBLISH_GATE_2026-10-21.md).
   The genuine authenticated browser check remains pending, reserved for the
   final functionally complete candidate before activation; it is not claimed
   from route checks or the signed-out preview.
2. Obtain approval for the reviewed Publish/schema plan and recovery point.
   User publishes the compatible candidate **with native search OFF** and
   without overwriting production data. Reconfirm exact diff before publishing.
3. Verify published artifact, schema and ordinary OFF operation. Do not add
   public validation approvals merely because development passed.
4. Propose a finite, separately approved production validation scope/budget for
   both exact model/tool/account/environment combinations. Key presence does
   not establish billing account identity or permissions. The development-only
   budget launcher/$50 allowance is not production spending authorization or a
   production-wide cap.
5. After successful production integration checks and explicit acceptance of
   Claude's documented quality limitation, activate OpenAI first, then Claude,
   within the same agreed joint-release window. Set an observation window and
   stop thresholds before activation; do not leave Claude indefinitely deferred.
6. Prefer disabling search while retaining compatible code and additive schema
   over rolling back blindly to the pre-R1A binary. Stop admission/dispatch,
   account for in-flight requests, drain or preserve ON work, and keep required
   attribution. Older workers must not process queued ON work as legacy OFF.
7. Close the overall release only after production acceptance, not this read-only
   review. Gemini remains a separately gated R1B scope.

The accepted baseline typecheck exception remains in force; no application
source, workflow, environment variable, secret or database was changed in this
read-only review.
