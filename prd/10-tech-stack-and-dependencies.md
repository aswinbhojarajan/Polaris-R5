# 10 — Tech Stack and Dependencies

This list reflects `package.json` exactly. Critical = removing it breaks core flows. High = breaks a major feature. Medium = swappable with effort. Low = cosmetic / DX.

## Frontend dependencies

| Package | Version | Criticality | Used for |
|---------|---------|-------------|----------|
| `react`, `react-dom` | ^18.3.1 | **Critical** | UI runtime. |
| `vite` | ^5.4.20 | **Critical** | Build / dev server (dev middleware in `server/vite.ts`). |
| `@vitejs/plugin-react` | ^4.7.0 | **Critical** | React fast-refresh. |
| `wouter` | ^3.3.5 | **Critical** | Client routing (`client/src/App.tsx`). |
| `@tanstack/react-query` | ^5.60.5 | **Critical** | Server-state fetching/caching/polling. |
| `tailwindcss` | ^3.4.17 | **Critical** | All styling. |
| `tailwindcss-animate`, `tw-animate-css`, `tailwind-merge`, `class-variance-authority`, `clsx` | various | High | shadcn/ui ergonomics. |
| `@tailwindcss/typography` | ^0.5.15 | Medium | Markdown rendering in report previews. |
| `@tailwindcss/vite` | ^4.1.3 | Low | Build-time helper. |
| `@radix-ui/*` (28+ packages) | various | **Critical** | shadcn/ui primitives. |
| `lucide-react` | ^0.453.0 | High | App icons. |
| `react-icons` | ^5.4.0 | Medium | Brand/logo icons. |
| `recharts` | ^2.15.2 | High | Dashboard charts. |
| `react-hook-form`, `@hookform/resolvers` | ^7.55 / ^3.10 | **Critical** | Forms across onboarding/config. |
| `zod`, `zod-validation-error` | ^3.24, ^3.4 | **Critical** | Validation everywhere. |
| `react-markdown`, `remark-gfm` | ^10.1 / ^4.0.1 | High | Markdown rendering for narratives + recommendations. |
| `framer-motion`, `embla-carousel-react`, `vaul` | various | Low/Medium | Animations / carousels / drawers. |
| `react-day-picker`, `input-otp`, `cmdk`, `react-resizable-panels` | various | Low/Medium | Specific UI primitives. |
| `next-themes` | ^0.4.6 | Medium | Dark-mode toggle. |
| `date-fns` | ^3.6.0 | High | Date formatting across runs/reports. |

## Backend dependencies

| Package | Version | Criticality | Used for |
|---------|---------|-------------|----------|
| `express` | ^4.21.2 | **Critical** | HTTP server. |
| `tsx` | ^4.20.5 | **Critical** | Dev runtime. |
| `typescript` | 5.6.3 | **Critical** | Language. |
| `esbuild` | ^0.25.0 | **Critical** | Server bundling for prod. |
| `drizzle-orm`, `drizzle-zod`, `drizzle-kit` | ^0.39 / ^0.7 / ^0.31 | **Critical** | DB schema + access. |
| `@neondatabase/serverless` | ^0.10.4 | **Critical** | Postgres connection (WebSocket). |
| `ws` | ^8.19.0 | **Critical** | WebSocket transport for Neon. |
| `bufferutil` | ^4.0.8 (optional) | Medium | WS native speedup. |
| `openai` | ^5.23.2 | **Critical** | OpenAI / Gemini-compat / Perplexity-compat clients. |
| `@anthropic-ai/sdk` | ^0.65.0 | **Critical** | Anthropic client. |
| `crawlee` | ^3.15.1 | **Critical** (X-Ray + onboarding) | CheerioCrawler/PlaywrightCrawler orchestration. |
| `playwright-extra` | ^4.3.6 | High | Stealth-aware Playwright launcher. |
| `puppeteer-extra-plugin-stealth` | ^2.11.2 | High | Anti-bot headers/fingerprints. |
| `cheerio` | ^1.1.2 | High | HTML parsing for crawler. |
| `archiver` | ^7.0.1 | High | ZIP exports. |
| `csv-parse` | ^6.1.0 | Medium | CSV uploads (topics/prompts). |
| `passport`, `passport-local`, `express-session`, `memorystore` | various | **Critical** | Wired by `server/auth.ts: setupAuth(app)` (Task #2); back the cookie session + `requireRole` middleware (Task #7). `memorystore` is now the **fallback** store only (used when no `DATABASE_URL`). |
| `connect-pg-simple` | ^10 | **Critical** | Active session store when `DATABASE_URL` is set (Task #37 confirmation). Survives process restarts and supports horizontal scale-out. |
| `helmet` | ^8 | **Critical** | Baseline security headers + dev-vs-prod CSP, mounted in `server/index.ts` (Task #37). |
| `express-rate-limit` | ^8.4.1 | **Critical** | Per-IP throttles on `/auth/login`, `/auth/register`, `/auth/forgot-password` via `server/middleware/auth-rate-limit.ts` (Task #37). |

## Replit / dev plugins

| Package | Criticality | Used for |
|---------|-------------|----------|
| `@replit/vite-plugin-cartographer` | Low | Replit Cartographer integration. |
| `@replit/vite-plugin-dev-banner` | Low | Dev banner. |
| `@replit/vite-plugin-runtime-error-modal` | Medium | Dev runtime error modal. |

## Build tooling

| Package | Used for |
|---------|----------|
| `autoprefixer` + `postcss` | CSS pipeline. |
| `@types/*` | TS typings. |

## Runtime model

- Single Node 20 process (`server/index.ts`).
- Postgres: Neon serverless via WebSocket. `server/db.ts` uses `drizzle-orm/neon-serverless` and `@neondatabase/serverless` `Pool` with `neonConfig.webSocketConstructor = ws`.
- Playwright browsers installed by `postinstall` into `./playwright-browsers` (path used by `server/utils/chromium-path.ts` and `getChromiumLaunchOptions`).

## Notable absences (for context)

- No Redis / BullMQ — queue is in-process.
- No Sentry / OpenTelemetry — observability is `console.*` lines.
- No tRPC / GraphQL — REST only.
- No CSS-in-JS — Tailwind only.
- No SWR — TanStack Query only.
- No mobile framework — React-only.
- No Stripe / RevenueCat — no monetization.

## Upgrade considerations

- React 19 / React Compiler not adopted yet.
- Vite 6 / Vite 7 ecosystem upgrade requires plugin updates.
- `openai@^5` is a major recent SDK; update prompts using `responses.create` would unlock structured outputs more cleanly than the current `chat.completions.create` + `json_object` pattern.
- Drizzle 0.39 → 0.41+ has breaking type changes; test before bumping.
