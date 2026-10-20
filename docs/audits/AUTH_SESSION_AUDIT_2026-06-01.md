# Polaris AI — Authentication & Session Management Security Audit

| | |
|---|---|
| **Audit scope** | Authentication, session management, RBAC, project-level access control, credential-grant lifecycle, and the supporting frontend/backend/database surface. |
| **Audit type** | Read-only senior-architect / security-engineer review. No code, schema, or runtime config changed. No production data queried. |
| **Generated (UTC)** | 2026-06-01 |
| **Auditor posture** | Architecture review against OWASP ASVS-style controls. Every claim cites a real artifact (`file:line`, route, table/column, env var, middleware, or test). Missing capabilities are marked **Not found**. |
| **Codebase reference** | Express.js + TypeScript backend, React + TanStack Query frontend, Neon PostgreSQL + Drizzle ORM. See `replit.md` for the system overview. |
| **Companion audits** | `docs/audits/LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md` (LLM provider inventory). Index: `docs/audits/README.md`. |

> **How to read this document.** It is self-contained — every finding inlines the evidence so you can consume it without opening the source tree, but each claim still cites `file:line` for traceability. Sections 1–3 orient you; 4–8 are the detailed findings; 9–13 are the risk register, target state, prioritized backlog, test plan, and open questions.

---

## 1. Executive summary

**Overall posture: STRONG for an internal / early-client-exposure product; NOT YET bank-grade.**

Polaris has a genuinely well-built authentication core. It is not a hand-rolled toy: passwords are Argon2id, sessions live in Postgres with a per-user epoch kill-switch, CSRF uses a double-submit cookie, login regenerates the session id to defeat fixation, and RBAC is enforced through a swept privilege matrix plus per-project grants. There is real automated test coverage for the security-critical paths (RBAC, sessions/CSRF/fixation, credential-grant lifecycle, project-access isolation). This is well above the typical SaaS baseline.

The gaps that remain are the ones you would expect from a product that has prioritized correctness over enterprise breadth: **no MFA, no real SSO/OIDC (it is a stubbed button), no email delivery for password resets/invitations (tokens are surfaced to an operator via an admin reveal modal), and a documentation/code discrepancy on HSTS.** None of these are "the auth is broken" findings; they are "this is not yet a regulated-industry deployment" findings.

### Top 3 strengths

1. **Modern password + session cryptography.** Argon2id hashing (`server/services/passwords.ts`), a strong password policy with history/reuse prevention (`shared/schema.ts:1213` `validatePasswordPolicy` + `password_history` table), and a Postgres-backed session store with a monotonic **session-epoch kill switch** (`users.session_epoch`, `shared/schema.ts:90`) that invalidates every outstanding cookie instantly.
2. **Defense-in-depth against the classic web-session attacks.** Session-fixation defence via `req.session.regenerate()` on login/register, CSRF double-submit (`polaris.csrf` cookie + `x-csrf-token` header), per-IP rate limiting on login/register/forgot-password, and an anti-enumeration design (generic login errors, `202` forgot-password regardless of account existence). All four are covered by `server/tests/sessions.test.ts` and `credential-grants.test.ts`.
3. **Real authorization model, not just authentication.** A three-tier role enum (`viewer`/`member`/`admin`), a `server/privileges.ts` matrix, **org-membership-does-not-imply-project-access** semantics enforced by `project_memberships`, and tenant isolation tested in `server/tests/project-access.test.ts` (foreign IDs dropped, no auto-grandfathering).

### Top 5 risks (full register in §9)

| # | Risk | Severity | One-line |
|---|---|---|---|
| R1 | No MFA / 2FA anywhere | High | A single leaked password fully compromises an account, including admins. |
| R2 | No email delivery; reset/invite tokens shown raw to operators | High | Out-of-band token handoff is manual and error-prone; raw secrets transit the admin UI. |
| R3 | HSTS doc/code discrepancy | Medium | Comment says HSTS is "off until opt-in," but `hsts: isProd ? undefined : false` actually enables helmet's default HSTS in production (`server/index.ts:79`). Behaviour ≠ documentation. |
| R5 | SSO/OIDC is a stub | Medium (roadmap) | `VITE_ENABLE_SSO` renders a "coming soon" button (`client/src/pages/login.tsx`). No federation, no SCIM, no enterprise provisioning. |
| R7 | `TEST_AUTH_BYPASS` not hard-blocked in prod | Medium | A truthy `TEST_AUTH_BYPASS` synthesizes an admin (`server/tests/project-access.test.ts:18`); nothing fails the boot if it leaks into a production env. |

### Headline recommendation

**Before broad client exposure, close the two High-severity gaps that are demo-visible: (a) ship TOTP MFA for at least the `admin` role, and (b) wire real transactional email for password resets and invitations so secrets never transit the operator UI.** Everything else is a near-term hardening or enterprise-roadmap item. The cryptographic and session foundations are sound enough that these are additive features, not rewrites.

---

## 2. Current implementation overview (plain English)

**How a user logs in, gets a session, hits a protected route, and logs out:**

1. **Page load.** The SPA boots. On the first GET, the server's `csrfTokenIssuer()` middleware (`server/index.ts:177`) sets a non-HttpOnly `polaris.csrf` cookie. The React app reads "who am I?" by querying `GET /api/v1/auth/me` (`client/src/lib/auth.ts:26`, `AUTH_QUERY_KEY`). If there is no valid session, that returns unauthenticated and the app routes to `/login`.
2. **Login.** The user submits email + password + an optional "Keep me signed in" checkbox (`client/src/pages/login.tsx`). The client POSTs to the login route with `credentials: "include"` and an `x-csrf-token` header copied from the `polaris.csrf` cookie (`client/src/lib/queryClient.ts:176`). The server verifies the Argon2id hash, checks the account is not `disabled` and not `locked`, then calls `req.session.regenerate()` to mint a **new** session id (defeats fixation), stamps a row into the `user_sessions` ledger, and snapshots the user's `session_epoch` into the session.
3. **Session cookie.** The session lives in Postgres (the `session` table, written by `connect-pg-simple`). The browser only holds the opaque `polaris.sid` cookie — `HttpOnly`, `SameSite=lax`, `Secure` in production, `rolling: true`. `rememberMe` controls whether the cookie is persistent (~30 d) or a browser-session cookie.
4. **Hitting a protected route.** Every `/api/v1` request carries the cookie. The `requireAuth` middleware (`server/auth.ts`) loads the user, then enforces four checks in order: **(a)** the session's epoch snapshot must equal the user's current `session_epoch` (else the session was killed); **(b)** the account must not be `disabled`; **(c)** idle timeout (7 d for users, 24 h for admins); **(d)** absolute timeout (30 d). State-changing methods additionally pass `csrfProtect()`, which compares the `x-csrf-token` header to the `polaris.csrf` cookie.
5. **Authorization.** Role-gated routes wrap `requireRole({ minRole, scope })`. `scope` is `org` (any org membership at/above the role), `client` (project-scoped, checked against `project_memberships`), or `none`. The `server/privileges.ts` matrix is the central capability map.
6. **Logout.** The client POSTs logout (CSRF-protected), the server destroys the session and removes the `user_sessions` row, and `BroadcastChannel("polaris-auth")` notifies sibling tabs to drop their cached user and route to `/login` (`client/src/lib/auth.ts:79`).

**Password reset / invitation (operator-mediated, no email yet):** A forgot-password POST always returns `202` (anti-enumeration). If the email matches a real account, a `credential_grant` of kind `password_reset` is created with a 1-hour TTL and a sha256-hashed token. **Not found:** any email-delivery integration — the raw token is instead surfaced to an admin through a one-shot reveal modal (`client/src/pages/admin/admin-users.tsx`), and the operator hands it to the user out-of-band.

---

## 3. Auth / session architecture (text diagram)

```
                          BROWSER (React SPA + TanStack Query)
  ┌───────────────────────────────────────────────────────────────────────────┐
  │  Current user  → AUTH_QUERY_KEY cache (/api/v1/auth/me)  [auth.ts:26]       │
  │  NO auth state in localStorage/sessionStorage (cookie-only)                 │
  │  Cookies held by browser:                                                   │
  │    • polaris.sid   (HttpOnly, SameSite=lax, Secure[prod], rolling)          │
  │    • polaris.csrf  (NON-HttpOnly — readable by JS for double-submit)        │
  │  Cross-tab: BroadcastChannel("polaris-auth")  [auth.ts:79]                  │
  │  Every mutating fetch: credentials:"include" + x-csrf-token header          │
  │                         [queryClient.ts:176, api-client.ts:62]              │
  └──────────────┬──────────────────────────────────────────────┬─────────────┘
                 │  HTTPS                                          │ 401 → broadcast
                 ▼                                                 ▲ "revoked" → /login
  ┌───────────────────────────────────────────────────────────────────────────┐
  │                         EXPRESS MIDDLEWARE CHAIN                            │
  │  helmet(CSP/HSTS/...)            [index.ts:30]                              │
  │  express.json (rawBody capture)  [index.ts:90]                             │
  │  requestId() (X-Request-Id)      [index.ts:101]                            │
  │  csrfTokenIssuer() (sets cookie) [index.ts:177]                            │
  │  /api/v1 → csrfProtect() unless isCsrfExemptApiV1(path)  [index.ts:178]    │
  │  setupAuth(app): express-session + passport-local        [index.ts:184]    │
  │  ── per-route ──                                                            │
  │     requireAuth: epoch == users.session_epoch ? + disabled? + idle? + abs? │
  │     requireRole({minRole, scope: org|client|none})       [auth.ts]         │
  │     auth-rate-limit (per-IP) on login/register/forgot     [middleware]     │
  │  errorHandler() LAST → {error:{code,message,requestId}}   [index.ts:203]   │
  └───────────────┬───────────────────────────────────────────────────────────┘
                  │ Drizzle ORM (Neon WebSocket pool)
                  ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │                          POSTGRES (Neon serverless)                        │
  │  session            ← connect-pg-simple (opaque sess JSON)  [schema:61]    │
  │  user_sessions      ← per-user ledger (UI + audit)          [schema:136]   │
  │  users              ← password_hash, status, session_epoch, lockedUntil,   │
  │                       failed_login_count, must_change_on_next_login [69]    │
  │  password_history   ← last-N Argon2id hashes (reuse block)  [schema:147]   │
  │  credential_grants  ← sha256 token, kind, TTL, consumed/revoked [schema:99]│
  │  user_org_memberships ← (user,org,role) unique             [schema:154]    │
  │  project_memberships  ← (client,user) binary access        [schema:214]    │
  │  audit_log          ← append-only admin-mutation trail     [schema:228]    │
  │  ai_vendor_status   ← per-vendor kill switch (Task #78)    [schema:271]    │
  └───────────────────────────────────────────────────────────────────────────┘

  KILL-SWITCH FLOW: admin "sign out everywhere" / password reset → users.session_epoch++
                    → next request: session snapshot != epoch → 401 → SPA logs out.
```

---

## 4. Feature coverage matrix

| Capability | Status | User-facing behavior | Technical implementation | Files / tables / routes | Risk / gap | Priority |
|---|---|---|---|---|---|---|
| **Login** | Implemented | Email + password + "Keep me signed in"; generic error on failure | passport-local; Argon2id verify; `session.regenerate()`; ledger stamp | `server/auth.ts`; `client/src/pages/login.tsx`; `users` | No MFA step | A |
| **Logout** | Implemented | Logs out; sibling tabs follow | session destroy + `user_sessions` delete + BroadcastChannel | `server/auth.ts`; `client/src/lib/auth.ts:79` | — | — |
| **Remember me** | Implemented | Persistent vs browser-session cookie | `rememberMe` toggles cookie `maxAge` (≈30 d) | `client/src/pages/login.tsx`; `server/auth.ts` | Long persistent window absent MFA | B |
| **Session persistence** | Implemented | Survives restarts | `connect-pg-simple` Postgres store; `rolling:true` | `session` table `schema:61`; `server/auth.ts` | — | — |
| **Session expiry (absolute)** | Implemented | Forced re-login after 30 d | absolute timeout check in `requireAuth` | `server/auth.ts` | — | — |
| **Idle timeout** | Implemented | Re-login after inactivity | 7 d users / 24 h admins | `server/auth.ts` | Idle window generous for users | C |
| **Password reset** | Partial | Always "if it exists, we'll send it" (202) | `credential_grants` kind=`password_reset`, 1 h TTL, sha256 token | `server/routes/auth-credentials.ts`; `credential_grants` | **Not found:** email delivery; token via admin reveal modal | A |
| **User invitation** | Partial | Admin invites by email; token revealed once | `credential_grants` kind=`invitation`, 7 d TTL; atomic membership grant on redeem | `server/routes/admin-users.ts:279`; `credential_grants` | **Not found:** email delivery | A |
| **User creation** | Implemented | Admin adds existing user / invites new | add-member + invitation routes; redeem creates user | `server/routes/admin-users.ts:92,279` | — | — |
| **User deactivation** | Implemented | Admin disables; login refused with generic error | `users.status='disabled'`; `requireAuth` rejects | `server/routes/admin-users.ts:581`; `users.status` | — | — |
| **RBAC (viewer/member/admin)** | Implemented | Viewers can't write; ordering enforced | `requireRole({minRole,scope})` + `server/privileges.ts` matrix | `server/auth.ts`; `server/privileges.ts`; `user_role_enum` | — | — |
| **Admin-only access** | Implemented | Admin module gated | `requireRole({minRole:'admin',scope:'org'})` on every admin-users route; `/api/admin/*` also wrapped by `requireAuth` + `requireRole(admin)` | `server/routes/admin-users.ts:64`; `server/routes/index.ts:185` | Monitoring-token bypass uses non-timing-safe compare (R4) | C |
| **Project-level access** | Implemented | Org membership ≠ project access | `project_memberships` binary grants; `assertClientAccess`/`requireProjectOwnerOrAdmin` | `server/routes/projects-sharing.ts`; `project_memberships` | Binary only — no per-project role | C |
| **Audit trail** | Implemented | Admin mutations + auth events recorded | append-only `audit_log` (orgId, actor, action, metadata); auth events via `recordAudit` (`auth.login.success`, `auth.logout`, `auth.login.locked`, `auth.register.success`, `auth.session.terminated`, `auth.sessions.revoke_one/sign_out_others`) | `audit_log` `schema:228`; `server/auth.ts:981,1101,1174,1216`; `server/services/audit.ts` | Failed-login granularity / export tooling could be richer | C |
| **Failed-login tracking** | Implemented | Lockout after repeated failures | `failed_login_count` + `locked_until` | `users` `schema:85-86`; `server/auth.ts` | — | — |
| **Password policy** | Implemented | ≥12 chars (3-class) or ≥16 passphrase; no common/equal-to-email | `validatePasswordPolicy` + `password_history` reuse block | `shared/schema.ts:1213`; `password_history` | — | — |
| **MFA readiness** | Not found | No second factor anywhere | — | — | **No MFA** (R1) | A |
| **SSO / OAuth readiness** | Partial (stub) | "SSO coming soon" toast | `VITE_ENABLE_SSO` flag gates a non-functional button | `client/src/pages/login.tsx` | No OIDC/SAML/SCIM | C |
| **Tenant / account separation** | Implemented | No cross-tenant leakage | org-scoped queries; foreign IDs dropped; tested | `server/tests/project-access.test.ts`; `user_org_memberships` | — | — |

---

## 5. Frontend findings

- **Where the current user lives.** Exclusively in the TanStack Query cache under `AUTH_QUERY_KEY = ["/api/v1/auth/me"]` (`client/src/lib/auth.ts:26,55`). There is **no** auth state in `localStorage` or `sessionStorage` — the session is cookie-only and the cache is hydrated from `/api/v1/auth/me`. This is the correct, XSS-resilient pattern for the session secret (the `polaris.sid` cookie is `HttpOnly` and never reachable by JS).
- **CSRF token is intentionally JS-readable.** `polaris.csrf` is non-HttpOnly by design so the SPA can copy it into the `x-csrf-token` header on every state-changing request (`client/src/lib/queryClient.ts:171-178`, `client/src/lib/api-client.ts:62-64`). This is the standard double-submit trade-off; the CSRF token is not a session secret, so its JS-readability is acceptable.
- **Route guards.** `ProtectedRoute` syncs the URL→store project selection on navigation (per `replit.md`) and renders empty states when unauthenticated/no-project. The login page lives at `/login`; root `/` redirects to `/app/clients`.
- **UX states.**
  - *Loading:* queries gate on `.isLoading`, mutations on `.isPending`.
  - *Expired / revoked:* a `401` from any request triggers a `revoked` broadcast and redirect to `/login` (`client/src/lib/queryClient.ts:42-50`, `api-client.ts:13`).
  - *Invalid login:* generic error text rendered below the form (`client/src/pages/login.tsx`); status codes are mapped to clean copy (anti-enumeration carried to the UI).
  - *Unauthorized (403):* surfaced via the typed error envelope and `useErrorToast` (renders `requestId` for support, per `replit.md` Task #114).
- **Cross-tab behaviour.** `BroadcastChannel("polaris-auth")` (`client/src/lib/auth.ts:79-119`) coordinates logout/revocation: when one tab logs out or hits a `401`, siblings drop the cached user and route to `/login`. Graceful no-op where `BroadcastChannel` is unavailable.
- **Sessions UI.** `client/src/pages/account/sessions.tsx` lists active sessions with device-class icons, badges the current device ("This device"), supports per-session revoke and "Sign out of all other sessions" (the latter bumps `session_epoch`).
- **Profile / password UI.** `client/src/pages/account/profile.tsx` PATCHes `displayName` to `/api/v1/auth/me`; `client/src/components/account/change-password-form.tsx` submits `currentPassword`+`newPassword` to the change-password route, client-validating `new !== current` and the shared policy before submit. The same form backs the forced `/change-password` interstitial.
- **Admin users UI.** `client/src/pages/admin/admin-users.tsx` exposes invite / reset-password / temp-password / disable / sign-out / bulk actions, with a one-shot `RevealedCredential` modal that displays a token or temp password exactly once and requires explicit copy.
- **Network retry policy.** `client/src/lib/queryClient.ts` retries 5xx/network up to 2× with capped exponential backoff and **never** retries 4xx (so a `401`/`403`/`419` fails fast). Consistent with the typed error contract (Task #113).
- **SSO button.** `VITE_ENABLE_SSO` gates a button that only shows a "coming soon" toast — **Not found:** any real federation client.

---

## 6. Backend findings

**Middleware chain (registration order is security-relevant; `server/index.ts`):** `helmet` (30) → `express.json` (90) → `requestId` (101) → request logger (103) → `csrfTokenIssuer` (177) → `/api/v1` `csrfProtect` unless exempt (178) → `setupAuth` (184) → routes (186) → `errorHandler` LAST (203). The comment at `server/index.ts:169-176` explicitly documents *why* CSRF is mounted **before** `setupAuth` — so logout / `/auth/sessions` and other auth routes registered inside `setupAuth` sit behind `csrfProtect`. This ordering is correct and deliberately defended.

**Auth middleware (`server/auth.ts`):**
- `requireAuth` enforces, in order: **session-epoch match** (instant kill switch via `users.session_epoch`), **account-not-disabled**, **idle timeout** (7 d users / 24 h admins), **absolute timeout** (30 d).
- `requireRole({ minRole, scope })` with `scope ∈ {org, client, none}`. `org` checks `user_org_memberships` at/above the role; `client` checks `project_memberships`; `none` is auth-only.
- Login + register call `req.session.regenerate()` (session-fixation defence) and stamp the `user_sessions` ledger; "sign out of all other sessions" bumps `session_epoch`. An hourly orphan sweep keeps `user_sessions` and the `session` table in lock-step (Task #42).

**Public vs protected.** Public paths are enumerated in `PUBLIC_API_V1_PATHS` (`server/routes/index.ts`) — the chain is deny-by-default for everything else. CSRF exemptions (`isCsrfExemptApiV1`) cover the bootstrap auth endpoints that cannot yet hold a token: login, register, forgot-password, and credential-grant redemption.

**Admin user management (`server/routes/admin-users.ts`) — every route is admin-scoped:**

| Method + path | Guard | Action | Audit event |
|---|---|---|---|
| `GET /api/v1/admin/orgs/:orgId/members` (62) | `requireRole(admin, org)` | list members | — |
| `POST .../members` (92) | admin/org | add existing user by email | `member.add` |
| `PATCH .../members/:userId` (134) | admin/org | change role | `member.role_change` |
| `DELETE .../members/:userId` (200) | admin/org | remove from org | `member.remove` |
| `GET .../invitations` (255) | admin/org | list invitations | — |
| `POST .../invitations` (279) | admin/org | create invitation (**returns raw token**, 339) | `credential_grant.invitation.create` |
| `DELETE .../invitations/:id` (350) | admin/org | revoke invitation | — |
| `POST .../users/:userId/reset-password` (440) | admin/org | issue reset grant (**returns raw token**, 499) | `admin.user.reset_password` |
| `POST .../users/:userId/temp-password` (511) | admin/org | set must-change temp password | `admin.user.temp_password` |
| `POST .../users/:userId/disable` (581) | admin/org | `status='disabled'` | `admin.user.disable` |
| `POST .../users/:userId/enable` (616) | admin/org | `status='active'` | `admin.user.enable` |

**Admin projects (`server/routes/admin-projects.ts`):** `PATCH /api/v1/admin/clients/:id` (20) guarded by `requireRole(admin, client)`; supports rename, owner reassign (`ownerUserId`), and soft-delete (`isActive`), emitting `project.update` (87) with `from`/`to` snapshots in metadata.

**Project sharing (`server/routes/projects-sharing.ts`):** `GET/POST/DELETE` on `/clients/:id/members` and `/clients/:id/invitations`. Reads use `assertClientAccess`; mutations use `requireProjectOwnerOrAdmin` (62,145,199). Revoking a project **owner** is blocked (149); invited/added users must already belong to the project's org (95). This is the per-project authorization boundary and it is enforced server-side, not just in the UI.

**Operational endpoints:** `GET /health/live` (`server/routes/admin.ts:27`, liveness), `GET /health` (`server/routes/admin.ts:36`, readiness — pings DB at 48, checks queue at 61-68), `GET /api/admin/queue` (queue stats). The queue stats route **is guarded**: `server/routes/index.ts:185` wraps the whole `/api/admin` mount with `requireAuth` + `requireRole({ minRole:'admin', scope:'none' })`, and a deliberately-registered-first handler (`server/routes/index.ts:167-184`) allows external monitoring probes to bypass *session* auth with an `Authorization: Bearer <MONITORING_TOKEN>` (or `x-monitoring-token`) header. **Finding (R4):** that bearer comparison is a plain `provided === expected` string equality (`server/routes/index.ts:179`) — **not** a constant-time compare — so it is theoretically vulnerable to a timing side-channel on the monitoring token. This is a minor hardening item, not an authorization bypass: when `MONITORING_TOKEN` is unset (or the token is wrong) the request falls through to the normal admin auth chain.

**Credential-grant service (`server/services/credential-grants.ts`):** tokens are `crypto.randomBytes(20).toString("hex")` (40 hex chars, >128 bits entropy) with a kind prefix (40-43), **sha256-hashed before storage** (36-38, 69), TTLs invitation=7 d / reset=1 h / magic_link=15 m / temp_password=24 h (29-34), **atomic single-use** consumption via `isNull(consumedAt)` in the WHERE clause so only the first redeem wins (153-174), revoke via `revokedAt` (200-236), and `classifyGrant` returning `consumed`/`revoked`/`expired`/`valid` (242-247). This is a clean, correct one-time-token primitive.

---

## 7. Database / schema findings (`shared/schema.ts`)

| Table | Key columns | Persisted | Notable |
|---|---|---|---|
| `session` (61) | `sid` PK, `sess` jsonb, `expire` | Yes | Written by `connect-pg-simple`; `sess` is opaque. Indexed on `expire`. |
| `users` (69) | `email` unique, `password_hash`, `display_name`, `status` (`invited`/`active`/`disabled`), `password_changed_at`, `must_change_on_next_login`, `locked_until`, `failed_login_count`, `session_epoch`, `created_at` | Yes | `session_epoch` (90) is the kill-switch; `locked_until`+`failed_login_count` (85-86) back lockout. |
| `credential_grants` (99) | `kind`, `token_hash` unique, `email`, `user_id`, `org_id`, `client_id`, `role`, `issued_by`, `issued_at`, `expires_at`, `consumed_at`, `consumed_ip`, `consumed_ua`, `revoked_at`, `metadata` | Yes | Only the **hash** is stored; consumption captures IP+UA for forensics. |
| `user_sessions` (136) | `session_id` PK, `user_id`, `user_agent`, `ip_address`, `created_at`, `last_seen_at` | Yes | Denormalized mirror for the UI; cascade-deletes with the user. Epoch is still source of truth for revocation. |
| `password_history` (147) | `user_id`, `password_hash`, `created_at` | Yes | Full Argon2id hashes for last-N reuse prevention. |
| `user_org_memberships` (154) | `user_id`, `org_id`, `role`, unique(user,org) | Yes | Org-level role. |
| `project_memberships` (214) | `client_id`, `user_id`, `granted_by`, `granted_at`, unique(client,user) | Yes | **Binary** project access — no per-project role (comment 212-213). |
| `audit_log` (228) | `org_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata`, `created_at` | Yes | Append-only; covers admin mutations **and** auth events (login/logout/lockout/register/session-terminate/revoke) written via `recordAudit` in `server/auth.ts`. |
| `ai_vendor_status` (271) | `vendor` PK, `paused`, `paused_by`, `pause_reason` | Yes | Vendor kill switch (Task #78); not auth, but part of the operational security surface. |

**What is tracked:** failed logins (`failed_login_count`), lockout (`locked_until`), password history/reuse (`password_history`), forced rotation (`must_change_on_next_login`), session revocation (`session_epoch`), per-session forensics (`user_sessions.ip_address`/`user_agent`, `credential_grants.consumed_ip`/`consumed_ua`).

**What is NOT found (naming note for the brief):** the audit brief lists an `invitations` table and a `client_user_grants` table. In the current schema these concepts are **unified/renamed**: invitations are rows in `credential_grants` (kind=`invitation`), and per-project access is `project_memberships` (not `client_user_grants`). No separate `invitations` or `client_user_grants` tables exist — **Not found** under those names; the functionality exists under the names above.

**Coverage note (R6):** end-user authentication events **are** recorded in `audit_log` — `server/auth.ts` calls `recordAudit` for `auth.login.success` (981), `auth.logout` (1101), `auth.login.locked` (820), `auth.register.success` (1068), `auth.session.terminated` (455), and the two session-revocation actions (1174, 1216). The remaining opportunity is *richer granularity* (e.g. an explicit per-attempt failed-login event, and credential-grant redemption events) plus an export/retention story for compliance — not a missing trail.

---

## 8. Security findings (against the requested checklist)

| Control | Verdict | Evidence |
|---|---|---|
| **Password hashing / salting** | Strong | Argon2id (`server/services/passwords.ts`), per-hash salt inherent to Argon2; full hash stored in `users.password_hash` and `password_history`. |
| **Password policy** | Strong | `validatePasswordPolicy` (`shared/schema.ts:1213`): ≥12 chars w/ 3 character classes OR ≥16-char passphrase; common-password blocklist (1238); rejects password == email / display name (1241-1245); reuse block via `password_history`. |
| **Cookie flags** | Strong | `polaris.sid`: `HttpOnly`, `SameSite=lax`, `Secure` in prod, `rolling:true`. `polaris.csrf`: intentionally non-HttpOnly for double-submit. |
| **CSRF** | Strong | Double-submit `polaris.csrf` cookie ↔ `x-csrf-token` header; `csrfProtect()` on all state-changing `/api/v1` except bootstrap auth (`server/index.ts:178`); tested `sessions.test.ts:141-165`. |
| **XSS** | Good (indirect) | Session secret is HttpOnly cookie (unreachable by JS); no auth state in `localStorage`; React escapes by default; helmet CSP tightens `script-src` in prod (`server/index.ts:36`). Residual: CSP allows `'unsafe-inline'` for `style-src`. |
| **Login rate-limiting** | Strong | Per-IP `express-rate-limit` on login/register/forgot-password (`server/middleware/auth-rate-limit.ts`); tested under real prod config (`sessions.test.ts:348`). |
| **Brute-force / lockout** | Strong | `failed_login_count` → lock via `locked_until`; generic error preserves anti-enumeration. |
| **Password-reset token security** | Strong (delivery gap) | 128-bit random token, sha256-at-rest, 1 h TTL, atomic single-use, IP/UA capture. **Gap:** no email delivery — raw token surfaced via admin reveal modal (R2). |
| **Session fixation** | Strong | `req.session.regenerate()` on login/register; tested `sessions.test.ts:171`. |
| **Token expiry / rotation** | Strong | Idle (7 d/24 h) + absolute (30 d) timeouts; `session_epoch` kill switch; grant TTLs per kind; `rolling:true` refreshes the cookie. |
| **CORS** | Acceptable for same-origin SPA | Same-origin app; `SameSite=lax` cookies; `crossOriginResourcePolicy: same-site` (`server/index.ts:81`); `X-Powered-By` disabled (22). **Not found:** explicit permissive CORS allowlist (correct — none needed for same-origin). |
| **HSTS** | Doc/code discrepancy (R3) | `hsts: isProd ? undefined : false` (`server/index.ts:79`). In prod, `undefined` → helmet's **default HSTS is applied (enabled)**; the adjacent comment claims it stays "off until the operator opts in." Behaviour and documentation disagree — verify intended max-age/preload and fix the comment or the code. |
| **Env-var / secret handling** | Good | `SESSION_SECRET` required in prod (`server/auth.ts`); secrets read from env, never hard-coded; per `replit.md`, prod uses a separate Neon DB. **Open question:** confirm `SESSION_SECRET` is actually set in the prod VM (see §13). |
| **AuthZ bypass risk** | Low | Deny-by-default chain; `requireRole` on every admin/project route; privilege matrix in `server/privileges.ts`; tested `rbac.test.ts`. **Watch:** `TEST_AUTH_BYPASS` (`project-access.test.ts:18`) synthesizes an admin — must never be truthy in prod. |
| **IDOR on admin/user/project APIs** | Low | Org/project scoping enforced server-side; foreign IDs dropped (`project-access.test.ts:241`); owner-revoke blocked (`projects-sharing.ts:149`); cross-tenant isolation tested. |
| **MFA** | **Not found** (R1) | No TOTP/WebAuthn/SMS anywhere. |
| **Operational endpoint auth** | Good (minor gap, R4) | `/api/admin/*` guarded by `requireAuth`+`requireRole(admin)` (`server/routes/index.ts:185`); optional `MONITORING_TOKEN` bearer bypass uses a non-constant-time `===` compare (`server/routes/index.ts:179`). |

**Test coverage (referenced, not re-run):**
- `server/tests/rbac.test.ts` (~10 cases): 401 unauthenticated (130), 403 viewer-on-write (147), role ordering viewer<member<admin (76).
- `server/tests/sessions.test.ts` (~12 cases): CSRF double-submit (141-165), fixation/id-change-on-login (171), revocation/epoch (296-333); flips `NODE_ENV=production` to test real rate limiting (348).
- `server/tests/credential-grants.test.ts` (~15 cases): reset lifecycle, anti-enumeration 202 for unknown email (209), tenant-scoped revokes (556).
- `server/tests/project-access.test.ts` (~8 cases): no auto-grandfathering (120), cross-tenant foreign-ID drop (241); uses `TEST_AUTH_BYPASS="true"` (18).

---

## 9. Risks and gaps (risk register)

| ID | Risk | Severity | Likelihood | Evidence | Business impact | Mitigation | Effort |
|---|---|---|---|---|---|---|---|
| R1 | No MFA / 2FA for any role | High | Medium | **Not found** (no TOTP/WebAuthn anywhere) | Single leaked admin password = full tenant compromise | Add TOTP (admin-first), recovery codes; consider WebAuthn | L |
| R2 | No email delivery; reset/invite tokens shown raw to operators | High | High | `server/routes/admin-users.ts:339,499`; **Not found** mailer | Manual, error-prone secret handoff; raw secrets transit admin UI/logs | Wire transactional email (one-time link, no raw token in UI) | M |
| R3 | HSTS doc/code discrepancy | Medium | High (already shipped) | `server/index.ts:79` vs comment 77-78 | Operator believes HSTS is off when it is on (or vice-versa); wrong max-age/preload risk | Set HSTS explicitly (max-age, includeSubDomains, preload decision) + fix comment | S |
| R4 | Monitoring-token bypass uses non-constant-time compare | Low | Low | `server/routes/index.ts:179` (endpoint itself is guarded at 185) | Timing side-channel could leak `MONITORING_TOKEN` to a determined attacker | Use `crypto.timingSafeEqual` for the token compare | S |
| R5 | SSO/OIDC is a non-functional stub | Medium (roadmap) | n/a | `client/src/pages/login.tsx` (`VITE_ENABLE_SSO`) | Blocks enterprise buyers needing federation/SCIM | Implement OIDC (e.g. Replit Auth / enterprise IdP) + SCIM later | L |
| R6 | Audit-event granularity / export incomplete | Low | Low | `server/auth.ts:981,1101,1174,1216` (core events already logged) | Harder to reconstruct per-attempt failures / grant redemptions for compliance | Add explicit failed-attempt + grant-redemption events; build export/retention tooling | S |
| R7 | `TEST_AUTH_BYPASS` admin synthesis | Medium | Low | `server/tests/project-access.test.ts:18` | Catastrophic if truthy in prod | Hard-fail boot if `TEST_AUTH_BYPASS` set and `NODE_ENV=production` | S |
| R8 | CSP allows `'unsafe-inline'` for styles | Low | Low | `server/index.ts:50-55` | Narrow XSS-via-style surface | Move to nonce/hash-based styles when feasible | M |
| R9 | Binary project access (no per-project role) | Low | Low | `project_memberships` `schema:212-214` | Can't express "viewer on project A, editor on B" | Add optional per-project role column if product needs it | M |
| R10 | Long persistent "remember me" window (~30 d) without MFA | Low | Medium | `client/src/pages/login.tsx`; `server/auth.ts` | Extended exposure of a stolen device/cookie | Shorten, or require MFA re-assert for sensitive actions | S |

---

## 10. Recommended target state (bank-grade)

For a regulated / bank-grade deployment, Polaris should reach: **mandatory MFA (TOTP + WebAuthn) for all privileged roles and optional-but-encouraged for all users; real federated SSO (OIDC) with SCIM provisioning and JIT de-provisioning; transactional email for every credential-bearing flow so no secret ever transits an operator UI; a complete, tamper-evident audit trail that records authentication events (login, logout, lockout, revocation, grant issuance/redemption) alongside the existing admin mutations; explicit, code-level authorization on every operational endpoint; and an HSTS posture that is configured intentionally (long max-age, includeSubDomains, deliberate preload).** The cryptographic core (Argon2id, session-epoch kill switch, CSRF double-submit, fixation defence) already meets that bar — the work is breadth (MFA/SSO/audit/email), not replacing foundations.

**Target-state sketch:**

```
  Browser ──┬── OIDC (PKCE) ──> Enterprise IdP ──SCIM──> users/memberships (auto-provision)
            └── password + TOTP/WebAuthn ──> Express
                                              │
   requireAuth ──> epoch + disabled + idle + absolute + [MFA-asserted?] checks
   requireRole ──> org/project matrix (unchanged)
   every credential flow ──> transactional email (one-time link; no raw token in UI)
   every auth event ──> audit_log (core events already logged; add grant.* + per-attempt + export)
   helmet ──> HSTS(max-age=63072000; includeSubDomains; preload-decided), strict CSP (nonce styles)
   /api/admin/* ──> explicit requireRole or timing-safe bearer (no network-only trust)
```

---

## 11. Prioritized implementation backlog

### Tier A — Immediate (before demo / client exposure)

1. **TOTP MFA for admins (then all roles).** *Why:* removes the single-password-compromise path for the most privileged accounts (R1). *What:* add an MFA secret + recovery-codes table, an enrollment flow, and an MFA-assert step in `requireAuth` for admin-scoped routes. *Files:* `server/auth.ts`, new `server/services/mfa.ts`, `shared/schema.ts` (new tables), `client/src/pages/login.tsx`, account settings. *Schema:* new `user_mfa` + `mfa_recovery_codes`. *Complexity:* L.
2. **Transactional email for resets/invitations.** *Why:* stops raw secrets transiting the operator UI and enables self-service (R2). *What:* send a one-time **link** (token in URL, never displayed); keep the reveal modal only as an explicit operator fallback. *Files:* `server/routes/auth-credentials.ts`, `server/routes/admin-users.ts`, new `server/services/mailer.ts` (note: `nodemailer` is already a dependency per `replit.md`). *Schema:* none. *Complexity:* M.
3. **Fix HSTS doc/code discrepancy.** *Why:* eliminate the gap between documented and actual production behaviour (R3). *What:* set `hsts` explicitly with a chosen `maxAge`/`includeSubDomains`/preload stance and correct the comment. *Files:* `server/index.ts:77-79`. *Schema:* none. *Complexity:* S.
4. **Guard `TEST_AUTH_BYPASS` in production.** *Why:* a truthy bypass in prod is catastrophic (R7). *What:* hard-fail boot if `TEST_AUTH_BYPASS` is set while `NODE_ENV=production`. *Files:* `server/index.ts` / `server/auth.ts`. *Complexity:* S.

### Tier B — Near-term (internal production use)

5. **Constant-time monitoring-token compare.** *Why:* the `/api/admin/queue` bearer bypass uses `provided === expected` (R4), a timing side-channel. *What:* replace with `crypto.timingSafeEqual`. *Files:* `server/routes/index.ts:179`. *Complexity:* S.
6. **Enrich the auth audit trail.** *Why:* core auth events already land in `audit_log`; the gap is granularity/export for compliance (R6). *What:* add explicit per-attempt failed-login and credential-grant-redemption events, plus an export/retention path. *Files:* `server/auth.ts`, `server/routes/auth-credentials.ts`, `audit_log`. *Complexity:* S.
7. **Re-evaluate "remember me" window + sensitive-action re-auth.** *Why:* shrink stolen-cookie exposure (R10). *What:* shorten persistent maxAge and/or require MFA re-assert for role changes, project sharing, and credential issuance. *Files:* `server/auth.ts`, admin routes. *Complexity:* S–M.

### Tier C — Enterprise / bank-grade roadmap

8. **Real SSO (OIDC) + SCIM provisioning.** *Why:* enterprise buyers require federation and lifecycle automation (R5). *What:* implement OIDC (PKCE) login alongside local; SCIM for user/membership sync; JIT de-provision. *Files:* new `server/auth-oidc.ts`, `client/src/pages/login.tsx`, membership tables. *Complexity:* L.
9. **WebAuthn / passkeys** as a phishing-resistant second factor / primary. *Complexity:* L.
10. **Strict CSP (nonce/hash styles), per-project roles, exportable tamper-evident audit log.** *Files:* `server/index.ts`, `project_memberships` (new role column), `audit_log` export endpoint. *Complexity:* M each.

**Suggested order:** 1 → 2 → 3 → 4 (Tier A, demo-blocking) → 5 → 6 → 7 (Tier B) → 8 → 9 → 10 (Tier C).

---

## 12. Test plan

**Manual cases.**
- Log in (valid / invalid / disabled / locked) → confirm generic error for the last three; confirm session id changes after login (fixation).
- "Keep me signed in" on/off → confirm persistent vs session cookie lifetime.
- Idle past timeout (simulate by editing session timestamps in a dev DB) → next request 401s.
- "Sign out of all other sessions" → other tabs/devices drop to `/login` (epoch bump).
- Forgot-password for a real and a non-existent email → both return the same 202 and identical UI copy.

**API cases (curl/REST).**
- `POST` a state-changing `/api/v1` route **without** `x-csrf-token` → expect CSRF rejection; **with** mismatched token → reject; matching → succeed.
- Hit any `/api/v1` protected route with no cookie → 401; with a viewer cookie on an admin route → 403.
- Redeem a `credential_grant` token twice → second attempt fails (atomic single-use); redeem an expired/revoked token → fails with correct `classifyGrant` status.
- `GET /health` with DB up vs DB unreachable → 200 vs 503.

**Frontend behaviour.**
- 401 mid-session → BroadcastChannel revoke → redirect across all open tabs.
- Loading/`isPending` states render; 4xx is not retried; 5xx retries ≤2× with backoff.
- Reveal modal shows a token/temp password exactly once and requires explicit copy.

**Negative / security cases.**
- IDOR: as org-A admin, attempt to mutate org-B users/projects → denied; foreign IDs dropped.
- Attempt to revoke a project **owner** via sharing API → blocked (`projects-sharing.ts:149`).
- Password policy: submit <12 chars, common password, password==email → each rejected; reuse a prior password → rejected.
- Confirm `TEST_AUTH_BYPASS` has no effect unless explicitly set in test env (and, post-fix, that it hard-fails under `NODE_ENV=production`).

**Regression (existing suites to keep green).** `server/tests/rbac.test.ts`, `sessions.test.ts`, `credential-grants.test.ts`, `project-access.test.ts`.

**Admin-vs-normal-user.** Member cannot reach `/api/v1/admin/*`; viewer cannot write; admin can invite/reset/disable and the action lands in `audit_log` (after R6).

---

## 13. Open questions / assumptions

1. **Is `SESSION_SECRET` actually set in the prod VM env?** The code requires it in production (`server/auth.ts`), but env contents cannot be verified from the codebase. *Assumption:* set correctly. **Open.**
2. **What HSTS posture is intended in production?** Given R3, is helmet's default HSTS (currently active in prod via `hsts: isProd ? undefined : false`) the desired max-age, and is `includeSubDomains`/`preload` wanted? **Open** — code and comment disagree.
3. **Is `MONITORING_TOKEN` set in the prod env**, and if so is the monitoring-probe bypass actually used? The endpoint is guarded by the admin chain regardless (`server/routes/index.ts:185`); this only affects whether the non-constant-time token path (R4) is reachable. **Open.**
4. **Is any reverse proxy/CDN in front of the VM** adding or stripping security headers (HSTS, CSP, CORS)? Not determinable from the repo. **Open.**
5. **Email delivery roadmap:** `nodemailer` is already a dependency (used by `server/services/alert-sink.ts` per `replit.md`). Is reusing it for auth email acceptable, or is a dedicated transactional provider preferred? **Open.**
6. **MFA scope:** admin-only first, or all users from day one? Drives Tier-A sizing. **Open.**
7. **`audit_log` retention/export requirements** for the target compliance regime (SOC 2 / bank-grade)? Affects R6 design. **Open.**

---

### Cross-references (drill-down)

- `replit.md` — system overview; "Authentication & Authorization", "Session hardening", "Reliability & operations" sections.
- `CHANGELOG.md`, `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`, `WEEKLY_CHANGELOG.md` — per-task narratives for the auth work (Tasks #8/#18/#26/#37/#42/#46/#47).
- `ISSUE_LOG.md` — symptom/root-cause/fix triplets and the "Alerts & Recovery" runbook.
- `BACKLOG.md` — open follow-ups.
- `server/README-errors.md` — the `{ error: { code, message, requestId } }` contract behind "what the user sees on failure".
- PRD chapters: `prd/05-technical-architecture.md`, `prd/07-backend-architecture.md`, `prd/08-database-and-data-model.md`, `prd/09-api-reference.md`, `prd/11-environment-and-deployment.md`, `prd/22-validation-and-gap-report.md`.
- Companion audit: `docs/audits/LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md`.

*End of audit — generated 2026-06-01 (UTC), read-only.*
