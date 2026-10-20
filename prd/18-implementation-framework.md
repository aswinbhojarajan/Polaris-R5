# 18 — Implementation Framework

This document explains the *philosophy* and *patterns* the codebase already follows. Use this as a guide when extending the system to keep new code consistent with the old.

## 1. Single source of truth: `shared/schema.ts`

- All persisted data is modeled in Drizzle.
- `createInsertSchema(table).omit({...})` produces a Zod insert schema.
- Frontend forms import the same insert schema (or `.extend(...)` it for UI-only validation).
- Backend route handlers parse `req.body` against the same schema before calling `IStorage`.
- This pattern means *types and validation flow from one definition*. Don't introduce ad-hoc DTOs that diverge from the schema.

## 2. Storage interface, not direct DB access

- Routes call `IStorage` (`server/storage.ts`).
- The Drizzle implementation is `server/db-storage.ts`.
- Never call Drizzle directly from a route — add the method to `IStorage` first.

## 3. Background work goes through the JobQueue

- Anything > a few hundred milliseconds (LLM calls, crawls, PDF rendering) belongs in `JobQueue`.
- Long-running runs persist a `runCheckpoints` row so they can resume after restart.
- Provide a heartbeat by writing to `jobs.lastHeartbeat` periodically.
- Choose a job `type` string and dispatch by type inside `JobQueue.processJob()` (or its delegated handler).

## 4. LLM calls go through one of three lanes

| Lane | When |
|------|------|
| `server/llm/getClient()` + `generateJsonWithRepair` | When you need structured JSON validated against a Zod schema. |
| `server/services/ai-executor.ts: executePrompt` | When you're running a *user prompt* against a vendor and want the raw response. |
| Direct SDK | Last resort; only do this for legacy or special cases (e.g., narrative generator using `gpt-5.1`-specific `buildOpenAIRequestParams` + `json_object`). |

Add the schema to the same file as the prompt, near the function that uses it. Never inline JSON schemas in routes.

## 5. Scoring composition pattern

- Sub-factors live in dedicated files (`mention-detector.ts`, `ranking-extractor.*`, `sentimentAbsa.llm.ts`).
- Composers (`composer.ts`, `visibility-scoring*.ts`, `scoring.ts`) only combine sub-factors and apply final transforms (sigmoid, weighted average, normalization).
- Versioning is controlled by env var (`POSITION_SCORING_VERSION`, `VISIBILITY_SCORING_VERSION`); both versions remain in code with a router function (`*Versioned` suffix).
- Any new score MUST persist explainability via `score-explainability.ts` → `score_factors`.

## 6. Frontend conventions

- Pages call `useQuery` with **default fetcher**; no custom `queryFn` unless required.
- Mutations use `apiRequest`; always invalidate the relevant query keys after success.
- Hierarchical query keys are arrays (`['/api/v1/prompt-runs', id]`).
- Skeletons via shadcn `Skeleton` for loading states.
- Forms via `useForm` + `zodResolver`.
- Add `data-testid` to interactive and meaningful elements (`fullstack_js` guideline). Idiomatic id pattern: `{type}-{description}-{id}`.

## 7. Multi-tenant boundary

- Every route that operates on tenant data accepts `?clientId=` (and/or `?orgId=`, defaulting to `"default-org"`).
- `db-storage.ts` always filters by `clientId` (or by `orgId`) at the SQL level.
- Frontend stores `current-client-id` in `localStorage` and forwards it as `x-client-id`.

## 8. Configuration discipline

- All env-var reads go through `server/config/*.ts` constants — not scattered `process.env.*` reads.
- `config/aeo.ts` validates and *logs* its resolved configuration on boot.
- `config/visibility-weights.ts` and `config/reporting.ts` similarly validate and log.
- Adding a new env var? Add it to a config file, log on boot, and update `prd/11-environment-and-deployment.md`.

## 9. Logging discipline

- Per-request log line in `server/index.ts` (don't add competing middleware).
- Per-run logs go to `prompt_run_logs` via `run-logger.ts`.
- LLM-call telemetry goes to `performance-logger.ts`.
- Console logs are tagged: `[AEO Config]`, `[OpenAI]`, `[Anthropic]`, `[AI-Executor]`, `[JobQueue]`, etc. Maintain that convention.

## 10. Forbidden modifications

- `vite.config.ts`, `server/vite.ts`, `package.json`, `drizzle.config.ts` are off-limits in this repo.
- For dependency changes, use the package manager tools, not direct edits.

## Suggested build sequence (for a feature that touches scoring + UI)

1. **Schema first** — add columns/tables to `shared/schema.ts`. Update insert schemas. `npm run db:push`.
2. **Storage interface** — add CRUD methods to `IStorage`, implement in `db-storage.ts`.
3. **Service** — write the new logic (extractor, scorer, etc.) under `server/services/`.
4. **Config** — add any env-var to `server/config/*.ts` with defaults + boot-time log.
5. **Route** — add a route to the appropriate per-domain module under `server/routes/` (e.g. `server/routes/clients.ts`, `server/routes/prompts.ts`). Resolve tenancy via `getClientId` / `requireClientId` / `getOrgId` from `server/routes/_helpers.ts`. Gate with `requireClientAccess` / `userHasOrgAccess` from `server/auth.ts` when the handler touches per-tenant data. Validate input via the Zod schema and call the storage / job queue. **Mirror the registration in `server/routes/openapi.ts`** so the OpenAPI doc and the typed `apiClient` stay in sync; then run `npx tsx scripts/generate-api-types.ts` and commit the regenerated `shared/api-types.ts`. (The legacy `server/routes.ts` is a 10-line re-export shim — do not add new handlers there.)
6. **UI** — build the React page/component using TanStack Query + shadcn primitives. Add `data-testid`s.
7. **Tests** — manual reproduction; document in `replit.md` if behavior changes user-facing.
8. **Docs** — update the relevant `prd/*.md` file.

## Suggested decomposition for a new "Score X" feature

1. Sub-factor extractor (heuristic).
2. (Optional) LLM equivalent via `getClient()` + Zod schema.
3. Composer with explicit weights and shifted-sigmoid (or other anchored transform) so 0-input → 0.
4. Versioning router (`scoreXVersioned`) reading `SCORE_X_VERSION` env var.
5. Persistence in `score_factors` (via `score-explainability.ts`).
6. Aggregation surface for dashboard / report aggregator.
7. UI tile + explainability modal.
