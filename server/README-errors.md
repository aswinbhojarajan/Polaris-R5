# Backend error contract & observability (Task #113)

This is the single source of truth for how the Polaris backend reports
errors and surfaces operational health. If you are adding a new route,
read this first.

## Wire format

Every non-2xx `/api/v1` response uses this shape:

```jsonc
{
  "error": {
    "code":      "validation_failed",   // machine-readable, from the catalog below
    "message":   "Request body failed validation.",
    "requestId": "5b9c7c7c-…",          // matches the X-Request-Id response header
    "details":   { "fieldErrors": { "name": ["Required"] } }  // optional, structured
  }
}
```

`X-Request-Id` is always present on the response. The frontend
(`client/src/lib/queryClient.ts`) parses this into a typed `ApiError`
exposing `status`, `code`, `requestId`, and `details` while keeping the
legacy `"${status}: ${message}"` form on `Error.message` so existing UI
that pattern-matches on the string still works.

## Error code catalog

Codes live in `server/utils/api-error.ts::ERROR_CODES`. The default HTTP
status for each is in parentheses; routes can override status when
needed but the code should still be one of these.

| Code                  | Status | When                                                          |
| --------------------- | -----: | ------------------------------------------------------------- |
| `bad_request`         |    400 | Malformed input the client should fix                         |
| `validation_failed`   |    422 | Zod / FK / NOT NULL / CHECK constraint violation              |
| `unauthenticated`     |    401 | No session / expired session                                  |
| `forbidden`           |    403 | Authenticated but lacks role / project grant                  |
| `not_found`           |    404 | Resource does not exist or caller cannot see it               |
| `conflict`            |    409 | Unique constraint hit, duplicate write, concurrent edit       |
| `csrf_failed`         |    403 | `polaris.csrf` cookie / `x-csrf-token` header mismatch        |
| `rate_limited`        |    429 | Per-user limiter on an expensive endpoint                     |
| `vendor_paused`       |    503 | Admin paused the LLM vendor (Task #78)                        |
| `database_error`      |    503 | Deadlock / serialization failure / connection exhaustion      |
| `service_unavailable` |    503 | Generic upstream outage (use sparingly)                       |
| `upstream_error`      |    502 | LLM / SMTP / HTTP outbound returned 5xx                       |
| `timeout`             |    504 | Statement timeout, LLM streaming timeout                      |
| `internal_error`      |    500 | Unhandled — should be alarming; investigate the requestId     |

## How to throw an error from a route

```ts
import { ApiError } from "../utils/api-error";

if (!client) throw ApiError.notFound("Project not found");
if (existing) throw ApiError.conflict("A project with that name already exists.");
```

You can also throw a plain `ZodError` from a parsed schema; the global
middleware turns it into `validation_failed` with a populated
`details.fieldErrors`.

The middleware (`server/middleware/error-handler.ts`) ALSO recognises
Postgres driver errors and translates the common codes:

| PG code | → `code`              | Status |
| ------- | --------------------- | -----: |
| 23505   | `conflict`            |    409 |
| 23503   | `validation_failed`   |    422 |
| 23502   | `validation_failed`   |    422 |
| 23514   | `validation_failed`   |    422 |
| 40P01   | `database_error`      |    503 |
| 40001   | `database_error`      |    503 |
| 53300   | `database_error`      |    503 |
| 57014   | `timeout`             |    504 |

## Request IDs and correlated logging

`server/middleware/request-id.ts` stamps every request with a stable id:

- Inbound `X-Request-Id` is honored when it matches the safety pattern
  (`/^[A-Za-z0-9_\-:.]{8,128}$/`) so upstream tracing agents pass through.
- Otherwise a v4 UUID is generated.
- The id is exposed on `req.id`, returned on the `X-Request-Id` response
  header, and printed in every access log line as `[req <id>]`.
- `req.log("info" | "warn" | "error", message, meta?)` emits a log line
  prefixed with `[req <id>]`.

When a request errors out, the middleware logs a single `[error]` line
with `req`, `status`, `code`, `method`, `path`, and the message — grep
either the access log or the `[error]` line by the same id to correlate.

## Health endpoints

- **`GET /health/live`** — Pure liveness. Always 200 if the event loop
  can reply. Use this for the platform's "is the container alive?" check.
- **`GET /health`** — Readiness + ops snapshot. 503 if the DB ping fails
  or the server is shutting down. Body includes:
  - `uptimeSec`, `timestamp`
  - `queue: { active, queued, stale }`
  - `memoryMb: { rss, heapUsed, heapTotal, external }`
  - `process: { unhandledRejectionCount, lastUnhandledRejectionAt,
    lastUnhandledRejectionMessage, uncaughtExceptionCount, … }`
  - `config` — JobQueue tunables (heartbeat / stale threshold / max
    resume attempts / concurrency / default timeout)

The `process.*` fields are fed by the `unhandledRejection` /
`uncaughtException` sinks in `server/index.ts`, which log the failure
but DO NOT call `process.exit()` — one buggy handler must not take
every other in-flight request down with it.

## Per-user rate limits

`server/middleware/rate-limit-expensive.ts` exports four limiters keyed
by `user.id` (IP fallback for anonymous). Limits are tunable via env:

| Endpoint                                        | Env var                            | Default |
| ----------------------------------------------- | ---------------------------------- | ------: |
| `POST /api/v1/clients/:id/refresh-prompts`      | `REFRESH_PROMPTS_RATE_PER_HOUR`    |   10/hr |
| `POST /api/v1/reports/generate`                 | `REPORTS_GENERATE_RATE_PER_HOUR`   |    5/hr |
| `POST /api/v1/prompt-runs`                      | `PROMPT_RUNS_RATE_PER_HOUR`        |   30/hr |
| `POST /api/v1/xray/analyze/batch`               | `XRAY_BATCH_RATE_PER_HOUR`         |   10/hr |

429 responses use the standard envelope with `code: "rate_limited"`
and `details: { scope, retryAfterSeconds }`. Limiters are bypassed under
`NODE_ENV=test` or `RATE_LIMIT_BYPASS=true` (mirroring the auth limiter
pattern in `auth-rate-limit.ts`).
