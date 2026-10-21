# Web Search R1A — foundation and UI review checkpoint

**Date:** 2026-10-20  
**Status:** implementation in progress, awaiting the planned Canvas review. **Not code-ready, live-validated, released or enabled.**

This is an incremental checkpoint, not a replacement for the original native-search audit or the approved full build plan.

## Implemented and verified at this checkpoint

- A shared versioned, strict ON/OFF search-config contract. Legacy absent config resolves OFF; malformed/newer configurations fail instead of silently downgrading.
- Bounded native evidence, safe source URLs, separate cited versus consulted links, inline citation locators, provider-reported versus absent model identity, usage and conservative failure states. Optional consulted links can be omitted with a disclosed count; mandatory attribution cannot be silently truncated.
- OpenAI Responses native-search request builder and final-text/evidence parser.
- Claude Messages basic `web_search_20250305` request builder and parser, including multiple text blocks, block-level citation association, HTTP-200 embedded tool failures, bounded pause-turn continuations and transient encrypted tool content.
- Gemini native REST `generateContent` request builder and synthetic parser fixtures. An independent hard gate prevents live grounded execution, including when a mock transport is injected.
- A dedicated native-only HTTP owner with bounded transport, item deadline, abort/control propagation, persisted-attempt callback, bounded transient retries and exact-model checks. OFF execution code is untouched.
- Fail-closed exact-model/tool/account/environment policy evaluation and scoped internal-validation eligibility. **These helpers are not admission enforcement or a spend ledger until wired into the real queued worker and storage.**
- Current, proposed and phone Canvas previews extracted from the actual existing `StartRunDialog`, with synthetic fixture dependencies. Search starts OFF; toggling keeps selections; blocked mixed selections require explicit correction rather than silent filtering. Rerun and attribution/status fixtures are available for review.

## Verification performed

| Check | Result | What it does / does not establish |
|---|---|---|
| `npx tsx --test server/tests/native-web-search.test.ts` | 33 passed | Offline/synthetic contracts, parser, policy and HTTP-owner tests. No real provider calls or DB mutations. |
| Main `npm run build` | Passed | Existing application builds with the additional foundation modules present. Does not prove runtime integration. |
| Main `npm run check` | Fails with the same 91 pre-existing diagnostics | Captured before changes; final diagnostic output is identical to baseline. No new diagnostics from this foundation. Release still needs a narrow repair or an approved exception. |
| Sandbox `npm run typecheck` | Passed | Isolated preview sources typecheck. |
| Sandbox build | Passed | Isolated preview production build succeeds. |
| Preview screenshots | Verified current desktop, proposed desktop and proposed phone | Initial sandbox dependency/PostCSS isolation issues and phone shrink/clipping were corrected before presentation. |

No end-to-end application test has been run: the new public flow is not integrated yet. Fixture success must not be described as real-model search validation.

## Decisions and limitations

- Native generation and evidence remain separate from analytical citations. Only final assistant prose is intended for the existing scoring path.
- Claude's initial whole-item search budget is five uses. Unknown network outcomes retain their reservation; they are not automatically retried as if no provider work occurred. A clearly rejected rate-limited request may release its reservation.
- Ambiguous Unicode citation-offset units fail rather than guessing. OpenAI's verified endpoint-specific unit can be supplied through the exact-model validation record. Gemini Unicode support mapping and compliant Search Suggestions rendering remain R1B gates.
- A saved generation must be committed inside its individual queue worker before cancellation processing, any batch barrier, or scoring. **That persistence/queue integration is still pending.** The runtime's pre-dispatch attempt callback alone is not a generation checkpoint.
- The policy configuration describes approval references, not credentials. No environment flags, approvals, cohorts or API keys were changed.
- Canvas “validated” model examples are explicitly synthetic fixture/demo states. **No exact model has acquired native-search validation from this work.**

## Remaining R1A work

1. Owner review of the Canvas UI before main-app UI integration.
2. Additive migration and immutable run configuration; fenced, unique per-item execution checkpoints; canonical native-answer ownership and cleanup.
3. Real create/list/selections/results contracts and authorization; whole-run eligibility checks; scoped validation admission with durable aggregate bounds, not just per-request helper checks.
4. Generation checkpointing inside each worker; recoverable/idempotent scoring from saved prose; control-safe benchmarking, deliverables and resume/finalization.
5. Approved UI integration into creation/rerun and both existing detail views; mode-aware overlap warnings and terminal-status fixes.
6. Isolated PostgreSQL migration/API/lifecycle/scoring/export tests against an explicitly approved disposable target. Never fall back to the current development or production database.
7. Complete the release capability matrix, test evidence and deployment/runbook documents; truthfully update the affected PRD/backlog/changelog when integration is implemented.
8. Separately approved paid, small real queued proofs before exact-model allowlisting. Production schema changes, Publish and activation remain separate approvals.

## Safety boundaries unchanged

No production changes, database/schema mutations, live provider generations, Google grounded calls, public GitHub upload, model-catalog substitution or global SDK upgrade were performed.
