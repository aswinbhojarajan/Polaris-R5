# 06 — Frontend Architecture

## Stack

| Concern | Choice | Source |
|---------|--------|--------|
| Framework | React 18 (`react@^18.3.1`) | `package.json` |
| Build tool | Vite 5 (`vite@^5.4.20`) + `@vitejs/plugin-react` | `package.json` |
| Router | Wouter (`wouter@^3.3.5`) | `client/src/App.tsx` |
| Server state | TanStack Query v5 (`@tanstack/react-query@^5.60.5`) | `client/src/lib/queryClient.ts` |
| UI primitives | shadcn/ui on Radix UI | `client/src/components/ui/*` |
| Styling | TailwindCSS 3 + `tailwindcss-animate`, `tailwind-merge`, `class-variance-authority`, typography plugin | `tailwind.config.ts`, `client/src/index.css` |
| Forms | `react-hook-form` + `@hookform/resolvers` (Zod) | components |
| Icons | `lucide-react` (UI), `react-icons` (logos) | components |
| Charts | `recharts` | dashboard |
| Markdown render | `react-markdown` + `remark-gfm` | report previews / recs |
| Animations | `framer-motion`, `tw-animate-css` | landing / transitions |
| Theming | `next-themes` (dark mode) | shadcn pattern |
| Replit dev plugins | `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal` | `vite.config.ts` (do not edit) |

## File layout (`client/src/`)

```
client/src/
├── App.tsx                     # Wouter routes + QueryClientProvider + Tooltip + Toaster
├── main.tsx                    # ReactDOM root
├── index.css                   # Tailwind layers + design tokens (HSL CSS vars)
├── pages/                      # Route-level pages (see 03-screens-features-and-user-flows.md)
│   ├── admin/                  # Task #7 admin module
│   │   ├── _shared.tsx         # Task #32: AdminPageShell, PageHeader, StatRow,
│   │   │                       #   StatusBadge, TableState, AdminForbidden,
│   │   │                       #   roleBadgeClass — reused across every admin page
│   │   ├── admin-users.tsx     # Members + Invitations + Access Matrix tabs
│   │   ├── admin-projects.tsx  # Projects table + per-project owner + soft delete
│   │   ├── admin-queue.tsx     # Task #6 — JobQueue health, stuck jobs, manual resume
│   │   └── admin-audit.tsx     # admin audit log feed
│   ├── login.tsx               # Task #34 split-screen redesign
│   └── invite-accept.tsx
├── components/
│   ├── layout/                 # App shell (sidebar/header) — Admin section gated by useRole().canAdmin
│   ├── ui/                     # shadcn primitives
│   ├── client-selector.tsx
│   ├── create-client-wizard.tsx
│   ├── start-run-dialog.tsx
│   ├── run-details-drawer.tsx
│   ├── run-details-section.tsx
│   ├── RunFilterBar.tsx
│   ├── OpportunityRunFilter.tsx
│   ├── benchmark-modal.tsx
│   ├── ComparisonTable.tsx
│   ├── rankings-accordion.tsx
│   ├── recommendations-summary.tsx
│   ├── category-dashboard-tiles.tsx
│   ├── score-explainability-modal.tsx
│   ├── metadata-progress-overlay.tsx
│   ├── generate-report-dialog.tsx
│   └── protected-route.tsx
├── hooks/
│   ├── use-toast.ts
│   └── use-role.ts             # Task #7: returns { role, canWrite, canAdmin, atLeast }
└── lib/
    ├── auth.ts                 # useAuth/useLogin/useLogout/useRegister, typed AuthSession with memberships
    ├── api-client.ts           # openapi-fetch typed client; redirects to /login on 401
    ├── api-errors.ts           # Task #131: isPermissionError/permissionMessage/cleanErrorMessage/getApiError
    └── queryClient.ts
```

## Routing

`client/src/App.tsx` defines two top-level Wouter routes:

- `path="/"` → `Landing`.
- `path="/app/:rest*"` → `AppRoutes`, which inside another `Switch` registers all `/app/*` pages and a 404.

Each `/app/*` page (except `client-catalog`) is wrapped in `ProtectedRoute`, which redirects to `/app/clients` if `localStorage['current-client-id']` is empty. Note: this is **not** authentication — it is a "client selected" guard.

## Server-state pattern

- Default fetcher set up in `client/src/lib/queryClient.ts` — pages call `useQuery({ queryKey: ['/api/v1/...', ...args] })` without supplying `queryFn`.
- Mutations use `apiRequest` from `@/lib/queryClient`. After mutation, callers `queryClient.invalidateQueries({ queryKey: [...] })`.
- Hierarchical keys use array form (`['/api/v1/prompt-runs', runId]`) so partial invalidation works.
- Polling for jobs: pages use `refetchInterval` with exponential backoff (per `replit.md` "Job Queue Reliability").

## Auth / session / RBAC in the client

- **Login UI** at `/login` (`pages/login.tsx`) and **invitation accept** at `/invite/:token` (`pages/invite-accept.tsx`).
- The login page (Task #34) is a split-screen layout: a `lg:grid-cols-2` shell with a cosmic-purple hero panel on the left (wordmark + value props + "Secure workspace access" glass card baked into `attached_assets/image_1777956038609.png`) and the "Welcome back" form on the right (email, password with Eye/EyeOff toggle, client-only Remember-me, Forgot password, Sign in, optional SSO behind `VITE_ENABLE_SSO`, "Request access" mailto fallback). Mobile collapses to a centered form. The `useLogin()` mutation and all original `data-testid`s are unchanged.
- Cookie session (`polaris.sid`) is read by `useAuth()` (`client/src/lib/auth.ts`) via `GET /api/v1/auth/me`. The typed `AuthSession` includes `memberships: { orgId, role }[]`.
- `client/src/hooks/use-role.ts` reads memberships and exposes `{ role, isViewer, canWrite, canAdmin, atLeast }`. The sidebar's **Admin** section (`Shield` icon) is rendered only when `canAdmin` is true; execute-style action buttons are disabled when `isViewer`.
- `client/src/lib/api-client.ts` is the typed `openapi-fetch` client; its middleware injects `x-client-id` and redirects to `/login` on `401`.
- `localStorage['current-client-id']` is still the client-selection state (set by `client-selector.tsx`, read by `ProtectedRoute`).

## Admin design system (`pages/admin/_shared.tsx`)

Introduced in Task #32 and adopted by every admin page (Tasks #33, #34 follow-ups, plus #6 / audit). The shared primitives are:

- `AdminPageShell` — page container (`p-6 space-y-6`).
- `PageHeader` — title + subtitle + optional `actions` slot (top-right buttons).
- `StatRow` — KPI tile row, each tile typed `{ label, value, icon, tone, hint?, testid? }` where `tone ∈ "blue" | "emerald" | "amber" | "purple" | "rose" | "slate"`.
- `StatusBadge` — capitalized status pill, `tone ∈ "active" | "disabled" | "invited" | "warning" | "neutral"`.
- `TableState` — single component that renders the loading and empty rows of a `Table` based on `{ loading, empty, loadingText, emptyText, colSpan }` props.
- `AdminForbidden` — full-page "you need admin role to … " state, used when `useRole().canAdmin` is false.
- `roleBadgeClass(role: AdminRole)` — canonical color map for role badges.

Pages should never re-implement these inline. Tables use a bordered `<div className="rounded-md border">` wrapper instead of `<Card>`. Row-action `DropdownMenuItem`s that open a `Dialog`/`Sheet` (or trigger a mutation that opens one on success) use the Task #35 pattern `onSelect={(e) => { e.preventDefault(); setTimeout(fn, 0); }}` to avoid Radix scroll-lock overlap; each admin page also runs a defensive `useEffect` that clears stuck `document.body.style.pointerEvents = "none"` 250 ms after every overlay flag returns to closed.

## Theming

- Tokens live in `client/src/index.css` as HSL CSS variables under `:root` and `.dark`.
- `darkMode: ["class"]` in Tailwind config; theme toggling via `next-themes`.

## Forms & validation

- `react-hook-form` controlled forms; resolvers from `@hookform/resolvers/zod`.
- Zod schemas usually come from `@shared/schema` (Drizzle-Zod insert schemas) or local `.extend()` versions for UI-only validation.

## Charts & data viz

- `recharts` is the only chart library in use (dashboard historical scores, competitor ranking visualizations).
- No D3 / nivo / visx.

## Notable UX patterns

- **Run filtering**: `OpportunityRunFilter.tsx` and `RunFilterBar.tsx` propagate a `runId` query param across opportunity surfaces.
- **Score explainability modal**: opens from dashboard tiles, fetches per-category factor breakdown.
- **Skeleton loading**: shadcn `Skeleton` primitive used for loading states (idiomatic per `fullstack_js` guidelines).
- **Test IDs**: per `fullstack_js` instructions, interactive and meaningful elements should have `data-testid`. Consistency across components is uneven (gap candidate).

## Error & notification UX (Tasks #114 / #131)

- **App-root `ErrorBoundary` + `NetworkBanner`** are mounted in `App.tsx` (Task #114). The feedback kit lives in `client/src/components/feedback/` (`ErrorState`, `RetryCard`, `NetworkBanner`, `ApiErrorMessage`) with `useErrorToast` and `useSlowQueryNotice` hooks.
- **Permission-aware errors** (Task #131): `client/src/lib/api-errors.ts` centralizes `isPermissionError` / `permissionMessage` / `cleanErrorMessage` / `getApiError` (403 via `ApiError.status`/`code`, legacy string fallback). `useErrorToast` renders friendly "You don't have permission…" copy on 403, overridable via `opts.permissionMessage`, still appending the `requestId`. Remaining native `window.confirm()` prompts (revoke current session, halt running job) were replaced with Radix `AlertDialog`. The convention (permission vs validation vs server vs network) is documented in `client/src/components/feedback/README.md`.

## Frontend gaps / risks

- ~~No top-level error boundary in the React tree.~~ **Resolved by Task #114** — an `ErrorBoundary` is mounted at the App root; see "Error & notification UX" above.
- `metadata-top-topics.tsx` is **not registered** in `App.tsx`. **Gap**.
- No global feature-flag / config provider on the client — the visibility V1/V2 flag is server-side only.
- No analytics SDK (Mixpanel / PostHog). **Gap**.

## Session UX (Task #37)
- Both fetch helpers (`client/src/lib/api-client.ts` and `client/src/lib/queryClient.ts`) read the `polaris.csrf` cookie and inject `x-csrf-token` on every non-GET. Both also broadcast a revocation message on 401 with a `reason` body.
- `client/src/pages/account/sessions.tsx` lists devices (inline regex UA helper — no AGPL dep), highlights the current row, and supports revoke + "Sign out of all other sessions".
- `client/src/lib/auth.ts` exposes `broadcastAuthEvent` and `installAuthBroadcastListener`; `client/src/App.tsx` wires the listener so sibling tabs clear the React Query cache and bounce to `/login` on logout/revocation.
- The login form now exposes a "Remember me" checkbox; unchecked = browser-session cookie, checked = `SESSION_REMEMBER_ME_MS`.
