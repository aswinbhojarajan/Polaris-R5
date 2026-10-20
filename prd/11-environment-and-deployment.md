# 11 — Environment and Deployment

## Replit configuration (`.replit`)

```toml
modules = ["nodejs-20", "web", "postgresql-16"]
run = "npm run dev"

[nix]
channel = "stable-25_05"
packages = ["chromium", "unzip"]

[deployment]
deploymentTarget = "vm"
build = ["npm", "run", "build"]
run = ["npm", "run", "start"]
publicDir = "dist/public"

[[ports]]
localPort = 5000
externalPort = 80

[env]
PORT = "5000"

[workflows.workflow]
name = "Start application"
[[workflows.workflow.tasks]]
task = "shell.exec"
args = "npm run dev"
waitForPort = 5000

[agent]
integrations = ["javascript_database:1.0.0"]

[userenv.shared]
JOB_MAX_TIMEOUT_HOURS = "8"
LLM_MODEL = "gpt-4o-mini"
POSITION_SCORING_VERSION = "v2"
```

Notes:
- `[deployment].deploymentTarget = "vm"` — the prod build runs as a VM, not autoscale, so the in-process job queue and cached browsers remain valid.
- `publicDir = "dist/public"` is what `vite build` produces.
- `chromium` is provided by Nix; `playwright install chromium chromium-headless-shell` runs in `postinstall` to the project-local cache, and `server/utils/chromium-path.ts` chooses the right binary at runtime.
- `[userenv.shared]` ships `POSITION_SCORING_VERSION=v2` and `LLM_MODEL=gpt-4o-mini` baked into the Replit user environment.

## Environment variables

Inventoried by ripgrepping `process.env.*` (server) and `import.meta.env.*` (client):

| Variable | Type | Required | Default | Used by |
|----------|------|----------|---------|---------|
| `DATABASE_URL` | secret | **yes** | — (throws if missing) | `server/db.ts:6`. |
| `OPENAI_API_KEY` | secret | yes (for OpenAI / Gemini-compat path / Perplexity path uses its own key but OpenAI is dominant) | — | `server/llm/openai.ts`, `server/openai-service.ts`, `server/services/ai-executor.ts`, `xray-content-analyzer.ts`, `competitor-discovery.ts`, `content-recommendation-analyzer.ts`, `prompt-classifier.ts`. |
| `ANTHROPIC_API_KEY` | secret | optional (required if `LLM_PROVIDER=anthropic` or any selected model is Anthropic) | — | `server/llm/anthropic.ts`, `ai-executor.ts:162`. |
| `GOOGLE_API_KEY` | secret | optional (Gemini models) | — | `ai-executor.ts:199` (uses `https://generativelanguage.googleapis.com/v1beta/openai/`). |
| `PERPLEXITY_API_KEY` | secret | optional (Perplexity models) | — | `ai-executor.ts:243`. |
| `PORT` | number | no | `5000` | `server/index.ts:77`; `.replit [env]`. |
| `NODE_ENV` | string | no | (set by scripts) | `dev`/`start` scripts; `server/vite.ts`. |
| `LLM_PROVIDER` | enum `openai`\|`anthropic` | no | `openai` | `server/config/aeo.ts`. |
| `LLM_MODEL` | string | no | `gpt-4o-mini` (or `claude-3-5-sonnet-20241022` if provider=anthropic) | `aeo.ts`; `.replit [userenv.shared]`. |
| `LLM_MAX_TOKENS` | number | no | model-specific (4096 / 16384 / 8192) | `aeo.ts`. |
| `AEO_MODE` | enum `heuristic`\|`llm`\|`hybrid` | no | `heuristic` | `aeo.ts`. Falls back to heuristic if API key absent for chosen provider. |
| `DEBUG_AEO` | string | no | unset | `mention-detector.ts`, `scoring.ts`, `prompt-run-executor.ts`. |
| `DEBUG_VISIBILITY` | string `'true'` | no | unset | `visibility-scoring-v2.ts`. |
| `VISIBILITY_SCORING_VERSION` | enum `v1`\|`v2` | no | `v1` | `server/config/visibility-weights.ts`. |
| `POSITION_SCORING_VERSION` | enum `v1`\|`v2` | no | `v1` (but `.replit [userenv]` sets `v2`) | `server/config/position-scoring.ts`. |
| `REPORT_AI_MODEL` | string | no | `gpt-5.1` | `server/config/reporting.ts`. |
| `REPORT_AI_TEMPERATURE` | number | no | `0.7` | `reporting.ts`. |
| `REPORT_MAX_RETENTION` | number | no | `5` | `reporting.ts` (snapshot retention). |
| `ENABLE_REPORTING` | string `'true'` | no | `false` | `reporting.ts`. |
| `JOB_MAX_TIMEOUT_HOURS` | number | no | `8` | `server/services/job-timeout.ts`; `.replit [userenv]`. |
| `OPENAI_REASONING_EFFORT` | enum `low`\|`medium`\|`high` | no | `medium` | `server/utils/openai-compat.ts`. |
| `CHROMIUM_PATH` | path | no | resolved automatically | `server/utils/chromium-path.ts`. |
| `PLAYWRIGHT_BROWSERS_PATH` | path | no | `./playwright-browsers` | `package.json` `postinstall`. |
| `SESSION_SECRET` | secret | **yes in prod** | dev fallback `dev-only-insecure-session-secret-change-me` | `server/auth.ts: setupAuth` — throws on boot if missing in `NODE_ENV=production`. |
| `SESSION_STORE` | enum `memory` | no | unset (uses Postgres via `connect-pg-simple`) | `server/auth.ts: createSessionStore()` — set to `memory` to force the in-process `memorystore` fallback (also forced under `NODE_ENV=test`). Task #8. |
| `SESSION_IDLE_MS` | number (ms) | no | `7 * 24 * 60 * 60 * 1000` (7 d) | `server/auth.ts:57` — idle timeout for non-admin users. Task #37. |
| `SESSION_ADMIN_IDLE_MS` | number (ms) | no | `24 * 60 * 60 * 1000` (24 h) | `server/auth.ts:61` — tighter idle timeout for admins. Task #37. |
| `SESSION_ABSOLUTE_MAX_AGE_MS` | number (ms) | no | `30 * 24 * 60 * 60 * 1000` (30 d) | `server/auth.ts:65` — hard ceiling regardless of activity. Task #37. |
| `SESSION_REMEMBER_ME_MS` | number (ms) | no | `30 * 24 * 60 * 60 * 1000` (30 d) | `server/auth.ts:72` — cookie maxAge when login payload sets `rememberMe: true`. Otherwise the cookie is a browser-session cookie. Task #37. |
| `AUTH_LOGIN_RATE_PER_MIN` | number | no | `10` | `server/middleware/auth-rate-limit.ts` — per-IP cap on `POST /api/v1/auth/login`. 429 with `{ message, retryAfterSeconds, code }`. Skipped under `NODE_ENV=test`. Task #37. |
| `AUTH_REGISTER_RATE_PER_HOUR` | number | no | `5` | `server/middleware/auth-rate-limit.ts` — per-IP cap on `POST /api/v1/auth/register`. Task #37. |
| `AUTH_FORGOT_RATE_PER_HOUR` | number | no | `5` | `server/middleware/auth-rate-limit.ts` — per-IP cap on `POST /api/v1/auth/forgot-password`. Task #37. |
| `ALLOW_PUBLIC_REGISTRATION` | string `'true'` | no | unset | `server/auth.ts` — gate on `POST /api/v1/auth/register`. Default off; new users join via credential-grant invitations. Task #7. |
| `VITE_ENABLE_SSO` | string `'true'` | no | unset (button hidden) | `client/src/pages/login.tsx:13` — when `true`, surfaces a "Continue with SSO" outline button on `/login`. Click currently shows a "SSO coming soon" toast (no provider wired). Task #34. |
| `VITE_REQUEST_ACCESS_EMAIL` | email | no | unset | `client/src/pages/login.tsx:14` — recipient for the "Request access" `mailto:` link in the login footer. If unset, the link shows a "Contact your organization admin" toast. Task #34. |
| `DEFAULT_ADMIN_EMAIL` | string | no | `admin@polaris.local` | `server/seed.ts` — used when seeding the bootstrap admin user. |
| `DEFAULT_ADMIN_PASSWORD` | secret | no (recommended) | `[REMOVED: configure password in Replit Secrets]` | `server/seed.ts` — bootstrap admin password. **Change this before any non-dev deploy.** |
| `SHUTDOWN_GRACE_MS` | number | no | `25000` | `server/index.ts:106` — how long the SIGTERM handler waits for `JobQueue.drain()` to finish. |
| `SHUTDOWN_FORCE_MS` | number | no | `35000` | `server/index.ts:107` — hard-exit deadline; guarantees the process dies before SIGKILL lands. |

> **Frontend env vars**: as of Task #34, the client reads two `VITE_*` variables — `VITE_ENABLE_SSO` and `VITE_REQUEST_ACCESS_EMAIL`, both consumed only in `client/src/pages/login.tsx` (see the table above). Everything else remains server-side; no other `import.meta.env.*` references exist in `client/`.

## Required vs optional secrets

- **Required for any startup**: `DATABASE_URL`.
- **Required to actually run prompts**: at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `PERPLEXITY_API_KEY` — depending on which `aiModels` rows are enabled and selected per client.
- **Required for executive reports**: `OPENAI_API_KEY` (narrative generator uses an OpenAI model).
- **Required for Site X-Ray AI analysis**: `OPENAI_API_KEY`.

## Build & start

| Action | Command | What it does |
|--------|---------|--------------|
| Local dev | `npm run dev` | Starts Express + Vite middleware on `:5000`. |
| Type check | `npm run check` | `tsc` no-emit. |
| Schema sync | `npm run db:push` | `drizzle-kit push`; **no migrations on disk**. |
| Build | `npm run build` | `vite build` → `dist/public`; `esbuild server/index.ts → dist/index.js`. |
| Start (prod) | `npm run start` | `NODE_ENV=production node dist/index.js`. |
| Browsers | `npm run postinstall` | `playwright install chromium chromium-headless-shell` into `./playwright-browsers`. |

## Health, readiness, and observability

- **`GET /health`** — returns `{ status, dbOk, queue: { active, queued, stale }, shuttingDown, config }` (`200` healthy, `503` when DB is down or shutdown is in progress). Wired in `server/routes/admin.ts` using `pingDatabase()` (`server/db.ts`) and `getHealthStats()` (`server/services/job-queue.ts`).
- **`GET /api/admin/queue`** — exposes the full `JobQueue` config (heartbeat, stale threshold, max resume attempts, concurrency, default timeout) plus the live counts from `getHealthStats()`. Wired in `server/routes/admin.ts`.
- Logging: per-request log line in `server/index.ts`; per-run logs persisted to `prompt_run_logs`; provider-call latency in `performance-logger.ts`; numerous `console.log/warn/error` across services.
- **No structured logger / log shipper.**

## Graceful shutdown (added by Task #4)

`server/index.ts:96–164` registers SIGTERM/SIGINT handlers that:

1. Stop accepting new HTTP connections (`server.close(...)`).
2. Call `jobQueue.stopAcceptingJobs()` — flips `isShuttingDown=true`, clears the polling interval; `enqueue()` and `processJobs()` short-circuit thereafter.
3. Wait up to `SHUTDOWN_GRACE_MS` (default `25000` ms) for `jobQueue.drain()` to return — i.e., for in-flight jobs to finish their current step.
4. Close the Neon pool (`pool.end()`).
5. `process.exit(0)`.

A separate hard-exit timer fires at `SHUTDOWN_FORCE_MS` (default `35000` ms) so the process always dies before SIGKILL. Jobs that didn't drain in time are picked up by `recoverStaleJobs()` on the next boot via the existing heartbeat-based stale-job recovery path (`STALE_THRESHOLD_MS = 15 min`, `MAX_RESUME_ATTEMPTS = 3`).

## Production deployment

- **Production URL**: `https://polaris-r3.ignitelabs.online`.
- **Target**: vm (single VM). The in-process JobQueue and the local Chromium cache stay valid across requests.
- **Run command**: `npm run start` (`NODE_ENV=production node dist/index.js`) — wired in `.replit [deployment]`.
- **Build command**: `npm run build` (`vite build` → `dist/public`; `esbuild server/index.ts → dist/index.js`).
- **Static assets**: served from `dist/public`.

### Dev vs prod database separation (operator gotcha)

The dev workflow and the production VM each carry **their own `DATABASE_URL`**, pointing at separate Neon databases. **Project renames, prompt runs, topics, citations, and uploads created against one do NOT appear in the other.** This caught an operator once — a user reported the "Masafi" project "looked empty in production" because they'd been running prompts against the dev DB and assumed the data would replicate. It will not. Production data must be created against the production deployment.

### `.config/pulse/` ignore

Chromium-under-Playwright creates PulseAudio runtime symlinks under `.config/pulse/` that point at `/tmp/pulse-XXXX` directories cleaned up on workflow exit. The symlinks themselves are not. `.gitignore` now excludes `.config/pulse/` so every Repl layer push no longer warns `Detected broken symlink` on the dangling links.

## Deployment notes / risks

- Single VM means the job queue cannot horizontally scale. **Gap.**
- Graceful shutdown is now wired (SIGTERM/SIGINT). The remaining edge case is the in-flight-job that doesn't checkpoint within `SHUTDOWN_GRACE_MS` — it becomes "stale" on next boot and is recovered or marked failed.
- ~~`memorystore` session store is single-process.~~ Resolved in Task #37 — `connect-pg-simple` is the active store when `DATABASE_URL` is set, sessions survive restart, and the stack is horizontally scalable. `memorystore` is the no-DB fallback only.
- New session-related env knobs (Task #37, all optional with sensible defaults): `SESSION_IDLE_MS`, `SESSION_ADMIN_IDLE_MS`, `SESSION_ABSOLUTE_MAX_AGE_MS`, `SESSION_REMEMBER_ME_MS`, `AUTH_LOGIN_RATE_PER_MIN`, `AUTH_REGISTER_RATE_PER_HOUR`, `AUTH_FORGOT_RATE_PER_HOUR`.
- No DB connection-pool sizing tuned: relies on Neon defaults.
- Playwright on Replit needs the Nix `chromium` package and the `./playwright-browsers` cache; if either is missing, `xray-health-probe.ts` and crawler fallback degrade.
