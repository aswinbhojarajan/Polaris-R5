# 02 — Product Requirements Document (PRD)

## 1. What Polaris is

Polaris is an **AEO/GEO (Answer-Engine / Generative-Engine Optimization)** platform. It measures, explains, and improves how *large language models* (ChatGPT, Claude, Gemini, Perplexity) talk about a brand when users ask AI models product, category, and brand questions.

The product turns LLM responses into structured signals — **mentions, sentiment, rankings, citations** — and converts those signals into three core scores (**Visibility, Sentiment, Position**) plus an Overall score, then layers on competitor benchmarks, content gaps, and consulting-grade reports.

Evidence:
- `replit.md` Overview: *"Polaris AI is a brand visibility and competitive intelligence platform that analyzes how AI models respond to prompts about companies and their competitors."*
- `server/services/scoring.ts` — composes visibility/sentiment/position into an overall score (`calculateOverallScore`).
- `server/services/narrative-generator.ts` — generates board-grade consulting narratives for executive PDFs.

## 2. Personas (inferred from feature surfaces)

| Persona | Goals | Where they live in the product |
|---------|-------|--------------------------------|
| **Brand / SEO / AEO lead at a brand** | Understand AI visibility, see vs competitors, get an action plan. | `dashboard`, `recommendations`, `reports`. |
| **Consulting analyst** | Turn raw LLM data into client-ready PDFs. | `reports`, `metadata-prompts`, `recommendations`. |
| **Content / growth marketer** | Generate AEO-optimized briefs/content from gaps. | `content-generator`, `recommendations`. |
| **Tech SEO / web team** | Audit a site's AI-readiness (robots.txt, ai.txt, structure). | `site-xray`. |
| **Operator / multi-tenant manager** | Manage many client projects under one org. | `client-catalog`, `client-configuration`. |

> Personas are **inferred** from page surfaces and route names. Not directly authored anywhere in code.

## 3. Jobs to be done (JTBD)

1. *"When I'm asked how visible our brand is in ChatGPT, I want a defensible number with components I can explain."* → Visibility/Sentiment/Position scores + `score_factors` explainability.
2. *"When I want to compare us vs. competitors in AI answers, I want the same scoring applied to both."* → `competitor-scoring.ts` mirrors the client pipeline.
3. *"When I need to brief executives, I want a consulting-grade PDF, not a dashboard screenshot."* → `report-job-processor.ts` + `narrative-generator.ts` produce dual PDFs.
4. *"When I want to fix gaps, I want page-level recommendations grounded in real prompts."* → `recommendations.tsx` + `content-recommendation-analyzer.ts`.
5. *"When my site is the source AI cites, I want to know if AI can crawl it."* → `site-xray.tsx` + `xray-health-probe.ts` (robots.txt, ai.txt, dual-UA).
6. *"When I add a brand-new client, I want the system to scaffold competitors/topics/prompts for me."* → `onboarding-enrichment.ts` + `openai-service.ts`.
7. *"When I rerun monthly, I want trends, not just snapshots."* → `dashboard.historical-scores`, `runIds` filters across opportunity surfaces.

## 4. Multi-tenancy & access model

- **Organization → Clients → (everything else).** `clients.orgId` is the multi-tenant key; default org is `"default-org"`.
- The frontend persists `current-client-id` in `localStorage`; backend routes resolve tenancy via `server/routes/_helpers.ts: getClientId` (priority: `x-client-id` header > `?clientId=` > legacy `?client_id=`) and `getOrgId` (priority: `?orgId=` > legacy `?org_id=`), with `"default-org"` as the fallback in handlers that need one. Per-tenant authorization is enforced through `user_org_memberships` by `server/auth.ts: requireClientAccess` / `userHasOrgAccess` (added by Task #2).
- Real authentication is wired (Task #2): cookie sessions (`polaris.sid`, `httpOnly`, `sameSite=lax`, `secure` in prod) issued by `POST /api/v1/auth/login` (passport-local + Argon2id only — `server/services/passwords.ts:verifyPassword` returns `false` for any stored hash that doesn't start with `$argon2`; the rotation sweep in Task #19 flagged every legacy-scrypt user as `must_change_on_next_login=true`, so remaining scrypt hashes are replaced via the change-password interstitial on the user's next successful sign-in). A bootstrap admin (`admin@polaris.local` / `[REMOVED: configure password in Replit Secrets]`, override via `DEFAULT_ADMIN_*`) is seeded into `default-org` as `admin`.
- **Session persistence (Task #8)**: sessions are stored in Postgres via `connect-pg-simple` (`server/auth.ts: createSessionStore()`), reusing the Neon `pool`. Logged-in users survive server restarts, deploys, and autoscale events. `SESSION_SECRET` is required in production. `SESSION_STORE=memory` (or `NODE_ENV=test`) forces the in-process `memorystore` fallback.
- **Session hardening (Task #37)**: login/register rotate the session id (`req.session.regenerate()`), CSRF double-submit (`polaris.csrf` cookie + `x-csrf-token` header) is enforced on every state-changing `/api/v1` call (auth bootstrap exempted), per-IP rate limits cover login/register/forgot-password, idle (7 d users / 24 h admins) + absolute (30 d) timeouts auto-expire sessions, login accepts `rememberMe`, and `helmet` is mounted with a dev-vs-prod CSP. `/app/account/sessions` is a self-service device list with one-click revoke and "Sign out of all other sessions"; `BroadcastChannel("polaris-auth")` keeps sibling tabs in sync. The `user_sessions` ledger mirrors the express-session table; **Task #42** keeps the ledger consistent via an `EXISTS` filter on read and an hourly orphan sweep so revoked or expired sessions never linger in the UI.
- **RBAC (Task #7)**: three roles ordered `viewer < member < admin` (the legacy `owner` role was merged into `admin` in May 2026). Viewers can read but cannot execute or write; members can write/execute; admins manage members, project settings, hard-delete projects, and read the audit log. Per-project ownership is tracked on `clients.ownerUserId` (a per-project assignment, unrelated to the role system). Enforcement: a global `requireAuth` + `requireTenantAccessIfPresent` guard on `/api/v1`, plus per-route `requireRole({minRole, scope})` driven by the canonical matrix in `server/privileges.ts` (surfaced in OpenAPI as `x-required-role`).
- **Onboarding new users**: public self-registration is OFF by default (`POST /api/v1/auth/register` returns 403 unless `ALLOW_PUBLIC_REGISTRATION=true`). Admins invite users via `POST /api/v1/admin/orgs/:orgId/invitations`; the recipient accepts at `POST /api/v1/auth/invitations/:token/accept` (single-use, sha256-hashed token, 7-day expiry, atomic claim).

## 5. Data Polaris generates and stores

| Asset | Source | Table |
|-------|--------|-------|
| Brand profile | Manual + LLM-enriched | `clients`, `competitors` |
| Topics / keywords | Crawled + AI + manual | `topics` |
| Prompts | Generated, manual, CSV | `prompts`, `prompt_categories` |
| LLM raw responses | Multi-vendor execution | `answers.rawResponse` |
| Mentions | Heuristic + LLM | `mentions` |
| Rankings | Heuristic + LLM | `rankings` (with `rankingGroup`, `groupRelevance`) |
| Citations | Markdown / bare URL extraction | `citations` |
| Per-answer scores | `scoring.ts` + `composer.ts` | `answers.{visibilityScore,sentimentScore,positionScore}` |
| Per-run competitor scores | Same scoring pipeline | `competitor_scores` |
| Score factors | Explainability | `score_factors` |
| X-Ray crawl + analysis | Crawlee + GPT | `xray_sites`, `xray_pages`, `xray_page_structure`, `xray_page_analysis` |
| Recommendations | AI analysis + manual | `recommendations` |
| Generated content drafts | LLM | `generated_contents` |
| Reports | GPT narrative + PDF | `report_snapshots`, `report_sections`, `report_files`, `report_jobs` |
| Job state | Background queue | `jobs`, `run_checkpoints`, `prompt_run_logs` |

## 6. Out-of-scope (explicit)

- **No billing / usage metering.** No Stripe / RevenueCat integration in the codebase.
- **No webhooks / external API surface.** All `/api/v1/*` is internal to the React app.
- **No mobile app**. Single web artifact.
- **No realtime channels (WebSockets) for users.** Only WebSockets are the Neon driver's transport.
- **No collaboration / comments.** Team roles ARE in scope (Task #7 RBAC: viewer/member/admin/owner + per-project owner + invitations + audit log) but commenting / discussion threads are not.
- **No SSO / SAML / OIDC.** Login is email + password only; SCIM provisioning is not implemented. The login UI exposes a feature-flagged seam — `VITE_ENABLE_SSO=true` surfaces a "Continue with SSO" button that currently shows a "SSO coming soon" toast — but no provider is wired.
- **No org switcher in the UI** — multi-org is supported in the data model (memberships are many-to-many) but the frontend assumes a single active org.

## 7. Success measures (proposed; **not currently tracked**)

> The platform doesn't ship product analytics. These are reasonable KPIs to add later:
- Time-to-first-report (project create → first PDF).
- % of prompt runs that complete without `error` / `completed_with_errors`.
- LLM cost per report (sum of `report_jobs.costUsd`).
- Score volatility per client per week (using `getHistoricalScores`).

## 8. Current product priorities (from `replit.md` "Key Features")

- **Position Scoring V2** is the most active scoring redesign (env flag `POSITION_SCORING_VERSION=v2` is already on by default in `.replit` `[userenv]`). See `composer.ts: calculatePositionScoreV2`.
- **Visibility Scoring V2** exists, off by default (`VISIBILITY_SCORING_VERSION` not set in `.replit`).
- **Group-aware nDCG ranking** is live; the relevance tagging is the new dimension.
- **Two-pass executive reports** are live; `narrative-generator.ts` produces the 12-section JSON; PDF rendering in `pdf-renderer.ts` + `pdf-template.ts`.

## Task #37 — session hardening (2026-05-04)
Closed PR-level requirements: session-fixation fix on login/register, CSRF double-submit on every state-changing `/api/v1` call (logout included), per-IP rate limit on auth endpoints, idle/absolute timeouts (admins tighter), remember-me, user-visible Active Sessions page with revoke + sign-out-others, cross-tab logout via BroadcastChannel, Helmet baseline, and audit emission on every forced-termination path with a `reason` taxonomy (`session_revoked`, `account_disabled`, `idle_timeout`, `absolute_timeout`, `manual`).

## Auth & onboarding hardening (Tasks #125, #129, #130, #132, #133 — 2026-06)
- **Self-demotion guard (Task #130).** `PATCH /api/v1/admin/orgs/:orgId/members/:userId` rejects with 403 when the target equals the caller (placed before the existing last-admin check). The admin Members UI disables the role selector for the caller's own row and excludes it from bulk role changes. Closes the production footgun where an admin demoted themselves to `viewer` and lost admin access.
- **Tenant resolution from URL path (Task #132).** `resolveTenant()` (`server/auth.ts`) now reads the client id from the request URL with an `/api/v1`-tolerant regex, authoritative after `req.params.clientId` and before body/query/`x-client-id` header. Fixes the create-project wizard freezing on "Next" for first-project / incognito users; security-positive (binds auth to the URL resource, not a stale selected-project header).
- **Onboarding wizard resume mode (Task #133).** `CreateClientWizard` accepts `existingClientId` to re-open guided setup for an existing project (pre-filled from client + competitors + models), suppresses auto AI-enrichment, PUTs to the same project (never duplicates), and reconciles competitors idempotently.
- **Forced change-password 401 recovery (Task #129).** Login re-probes `/auth/me` to verify the session cookie persisted; a 401 on the change-password submit clears the auth snapshot and redirects cleanly to `/login`.
- **Auth & session audit (Task #125).** Read-only, evidence-anchored security review at `docs/audits/AUTH_SESSION_AUDIT_2026-06-01.md`. Posture: strong for internal use, not yet bank-grade (top gaps: no MFA, no email delivery for resets/invites, HSTS doc/code discrepancy).
