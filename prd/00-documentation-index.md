# Polaris — Documentation Pack Index

This `/prd` folder is the **source-of-truth documentation pack** for the Polaris AEO/GEO (Answer-Engine / Generative-Engine Optimization) platform. It is reverse-engineered from the running codebase as of the date this pack was generated.

Every claim in these documents is anchored to a real file path, function, route, table, schema, prompt, or config. Anything that could not be verified in code is logged as a **gap** or **assumption** rather than guessed.

> **2026-06-08 refresh — what changed since May 16** (see [`../CHANGELOG.md`](../CHANGELOG.md) for the full history):
>
> - **Error UX is now permission-aware and consistent (Task #131).** `client/src/lib/api-errors.ts` centralizes 403 detection; `useErrorToast` renders friendly permission copy; remaining native `window.confirm()` prompts moved to Radix `AlertDialog`; conventions written in `client/src/components/feedback/README.md`. The "no top-level error boundary" gap (previously in `06-` and `22-`) was already closed by Task #114 and is now reflected here.
> - **Self-demotion lockout guard (Task #130).** The org member role-change route refuses to let a user change their own role; the admin Members UI disables the self-row selector.
> - **Onboarding wizard fixes (Tasks #132 / #133).** `resolveTenant()` now resolves the client id from the URL path (fixing the first-project "stuck on Next" freeze); the wizard gained a resume mode to re-open guided setup for an existing project without creating a duplicate.
> - **Forced change-password 401 recovery (Task #129).** Login re-probes `/auth/me` to verify the session cookie stuck; a 401 on the change-password submit redirects cleanly to login.
> - **Auth & session audit (Task #125).** Read-only security review at `docs/audits/AUTH_SESSION_AUDIT_2026-06-01.md`; audit-class docs now live under `docs/audits/`.
>
> **2026-05-01 refresh — what changed since the original pack** (see [`../CHANGELOG.md`](../CHANGELOG.md) for the full history):
>
> - **Auth is now real.** Passport-local + scrypt + 7-day sessions. `setupAuth(app)` is called from `server/index.ts:58` before route registration. All `/api/v1/*` endpoints (except `/api/v1/auth/*`) require authentication and tenant-membership authorization.
> - **`server/routes.ts` is now a 10-line shim.** The real handlers live in 15 per-domain modules under `server/routes/` (5,177 LoC total), wired in `server/routes/index.ts`. Tenancy is standardized through `server/routes/_helpers.ts`.
> - **OpenAPI is the authoritative API contract.** `server/routes/openapi.ts` (1,992 LoC) auto-generates a full OpenAPI 3 document from the existing Zod schemas using `@asteasolutions/zod-to-openapi`. Served at `GET /openapi.json` with a Swagger UI viewer at `GET /api/docs`. The frontend uses a typed `openapi-fetch` client generated from the same spec (`shared/api-types.ts`).
> - **Graceful shutdown is wired.** SIGTERM/SIGINT → stop accepting new HTTP, drain the `JobQueue` for `SHUTDOWN_GRACE_MS` (default 25s), hard-exit at `SHUTDOWN_FORCE_MS` (default 35s). See `server/index.ts:96–164`.
> - **Integration tests exist.** 50 supertest-based tests in `server/tests/routes-integration.test.ts` cover the per-domain split, tenancy resolution, the consolidated `/api/v1/jobs` route, and `/openapi.json` validity.
> - **`GET /health` and `GET /api/admin/queue` are wired.** Both live in `server/routes/admin.ts` and are registered from `server/routes/index.ts`; previously tracked as `20-` C2 (now resolved).
> - **`server/routes/index.ts` exports `jobQueue` exactly once** (the duplicate-export bug previously tracked as `20-` C1 is fixed; the `Start application` workflow boots cleanly).

## How to read this pack

1. Start with `02-product-requirements-document.md` (what the product is) and `21-future-agent-context-pack.md` (a dense 1-file briefing for any future agent).
2. To understand a *page*: see `03-screens-features-and-user-flows.md`.
3. To understand a *capability*: see `04-capability-map.md`.
4. To understand the *system shape*: see `05-technical-architecture.md` (Mermaid diagram), `06-frontend-architecture.md`, `07-backend-architecture.md`.
5. To understand the *data*: see `08-database-and-data-model.md`.
6. To understand the *APIs*: see `09-api-reference.md`.
7. To understand *scoring*: see `14-`, `15-`, and `16-` together.
8. To understand *LLM use*: see `12-` and `13-`.
9. To rebuild or refactor: see `18-`, `19-`, `20-`.
10. For coverage, gaps, and what was *not* documented: see `22-validation-and-gap-report.md`.

## Files in this pack

| # | File | Purpose |
|---|------|---------|
| 00 | `00-documentation-index.md` | This index. |
| 01 | `01-codebase-inventory.md` | Folder-by-folder, file-by-file inventory. |
| 02 | `02-product-requirements-document.md` | PRD: what Polaris is, who it's for, jobs-to-be-done. |
| 03 | `03-screens-features-and-user-flows.md` | Every page, every flow. |
| 04 | `04-capability-map.md` | Feature → file-path map. |
| 05 | `05-technical-architecture.md` | High-level system shape + Mermaid. |
| 06 | `06-frontend-architecture.md` | React/Vite/Wouter/shadcn architecture. |
| 07 | `07-backend-architecture.md` | Express/Drizzle/JobQueue architecture. |
| 08 | `08-database-and-data-model.md` | All tables, columns, enums, JSONB shapes. |
| 09 | `09-api-reference.md` | Every `/api/v1/*` endpoint. |
| 10 | `10-tech-stack-and-dependencies.md` | Stack + dependency criticality table. |
| 11 | `11-environment-and-deployment.md` | Env-var table; Replit `.replit`; build/start. |
| 12 | `12-llm-models-prompts-and-orchestration.md` | Every LLM call site + model table. |
| 13 | `13-prompt-library-and-output-schemas.md` | Prompt strings + Zod schemas. |
| 14 | `14-scoring-and-assessment-logic.md` | All assessment logic in one place. |
| 15 | `15-visibility-sentiment-position-score-definitions.md` | Formal scoring definitions, V1/V2. |
| 16 | `16-scoring-examples-and-edge-cases.md` | Worked examples + edge cases. |
| 17 | `17-reporting-and-exports.md` | Reports (Insights + Appendix), CSV/JSON/ZIP exports. |
| 18 | `18-implementation-framework.md` | Implementation framework / build sequence. |
| 19 | `19-rebuild-from-scratch-guide.md` | Full rebuild path. |
| 20 | `20-optimization-and-technical-debt-backlog.md` | Modernization + tech-debt backlog. |
| 21 | `21-future-agent-context-pack.md` | Single-file dense briefing for future agents. |
| 22 | `22-validation-and-gap-report.md` | Coverage scorecard + gaps. |

## Maintenance rules

- **Source truth is the code.** When code and docs disagree, the code wins; update the doc.
- **Cite file paths and line ranges** in every claim (e.g., `server/services/composer.ts: positionScoreFromRankings`).
- **Mark assumptions explicitly** (`> Assumption:` blockquote) rather than smoothing them over.
- Do **not** modify `vite.config.ts`, `server/vite.ts`, `package.json`, or `drizzle.config.ts`.
- Cross-link with relative paths (e.g., `[scoring](./14-scoring-and-assessment-logic.md)`) so the pack stays modular.

## Conventions used in this pack

- **Implemented**: present in code and exercised by routes/UI.
- **Partial**: present but flagged in code as in-progress, fallback-only, behind a feature flag, or not wired into the UI.
- **Inferred**: behavior deduced from naming/structure but not directly verified against runtime.
- **Gap**: documented absence — feature alluded to but not (yet) implemented, or implemented inconsistently.
