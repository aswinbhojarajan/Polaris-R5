/**
 * Thin re-export shim. The previous monolithic implementation (87 routes,
 * 2925 lines) has been split into per-domain modules under `server/routes/`.
 * See `server/routes/index.ts` for the orchestrator and the per-domain files
 * (`clients.ts`, `onboarding.ts`, `jobs.ts`, `competitors.ts`, `ai-models.ts`,
 * `topics.ts`, `prompts.ts`, `prompt-runs.ts`, `score-colors.ts`,
 * `dashboard.ts`, `opportunities.ts`, `xray.ts`, `crawler.ts`, `reports.ts`,
 * `openapi.ts`).
 */
export { registerRoutes, jobQueue, isCsrfExemptApiV1 } from "./routes/index";
