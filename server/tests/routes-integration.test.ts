/**
 * Integration tests for the per-domain route modules.
 *
 * These tests cover the behavior the per-domain split (`server/routes/*`)
 * promised, namely:
 *   1. Tenancy resolution via `_helpers.ts` accepts the `x-client-id` header,
 *      the recommended `?clientId=` query parameter and the legacy
 *      `?client_id=` query parameter — all should resolve to the same tenant.
 *   2. The consolidated `/api/v1/jobs` and `/api/v1/jobs/:id` endpoints behave
 *      correctly with and without tenancy filters (replacing the duplicated
 *      registrations that existed in the old monolithic `routes.ts`).
 *   3. A handful of representative endpoints across the other domain modules
 *      register correctly and exercise the standardized tenancy helpers.
 *   4. `/openapi.json` returns a syntactically valid OpenAPI 3 document.
 *
 * Run with:    npx tsx --test server/tests/routes-integration.test.ts
 *
 * The tests do not touch the real database. Instead, they monkey-patch the
 * methods on the `storage` singleton that each handler calls. This is safe
 * because `storage` is a single shared `DbStorage` instance and route modules
 * only access it via method calls (never via class identity / `instanceof`).
 *
 * `DATABASE_URL` is set defensively below so that a test run in a clean
 * environment (no real Postgres, no Replit secrets) still works — `db.ts`
 * only needs the variable defined to construct its lazy connection pool.
 * Because ES module `import` statements are hoisted and evaluated *before*
 * top-level code, every module that transitively touches `server/db.ts`
 * (notably `server/storage.ts`) is loaded via dynamic `await import(...)`
 * after the env is in place.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
// Short-circuit the global RBAC guard added in Task #7 so this legacy
// integration suite (which does not log in) keeps exercising the route
// behavior under test. Production code never sets this env var; the
// dedicated RBAC suite in `rbac.test.ts` runs WITHOUT this flag.
process.env.TEST_AUTH_BYPASS = "true";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import request from "supertest";

// Type-only imports do not produce runtime `import` statements after
// transpilation, so they cannot trigger `server/db.ts` to load.
import type { IStorage } from "../storage";
import type {
  Job,
  Competitor,
  Topic,
  Prompt,
  AiModel,
  Client,
  Organization,
  PromptRun,
  XRaySite,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Typed fixture builders
// ---------------------------------------------------------------------------

function buildJob(overrides: Partial<Job> & Pick<Job, "id">): Job {
  return {
    type: "demo",
    status: "queued",
    payload: {},
    progress: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as Job;
}

function buildCompetitor(clientId: string): Competitor {
  return {
    id: "comp-1",
    clientId,
    name: "ACME",
    website: null,
    aliases: [],
  };
}

function buildTopic(clientId: string): Topic {
  return {
    id: "topic-1",
    clientId,
    label: "Pricing",
    category: "comparison",
    keywords: [],
    source: "manual",
    accepted: true,
    createdAt: new Date(),
  };
}

function buildPrompt(clientId: string): Prompt {
  return {
    id: "prompt-1",
    clientId,
    text: "What is the best widget?",
    source: "manual",
    accepted: true,
    categoryId: null,
    createdAt: new Date(),
  };
}

function buildAiModel(): AiModel {
  return {
    id: "model-1",
    vendor: "openai",
    model: "gpt-4o",
    displayName: "GPT-4o",
    category: "core",
    maxTpm: null,
    maxRpm: null,
    costPer1kInput: null,
    costPer1kOutput: null,
    enabled: true,
  };
}

function buildClient(orgId: string): Client {
  return {
    id: "client-1",
    orgId,
    projectName: "ACME-Project",
    name: "ACME",
    website: null,
    urls: null,
    focusAreas: null,
    industry: null,
    geography: null,
    customIndustry: null,
    customGeography: null,
    aliases: null,
    brandAliases: null,
    selectedAiModelIds: null,
    onboardingStatus: "draft",
    isActive: true,
    createdAt: new Date(),
  };
}

function buildOrganization(): Organization {
  return { id: "org-1", name: "Test Org", createdAt: new Date() };
}

function buildPromptRun(clientId: string): PromptRun {
  return {
    id: "run-1",
    clientId,
    name: "Test run",
    createdBy: "system",
    totalPrompts: 1,
    status: "done",
    errorSummary: null,
    createdAt: new Date(),
  };
}

function buildXRaySite(clientId: string): XRaySite {
  return {
    id: "site-1",
    clientId,
    domain: "example.com",
    siteType: "first_party",
    robotsTxtPresent: false,
    aiTxtPresent: false,
    crawlAccessStatus: "ok",
    robotsRules: null,
    aiTxtContent: null,
    crawlEvidence: null,
    healthProbeStatus: "pending",
    lastProbedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const fakeJobs: Job[] = [
  buildJob({
    id: "job-tenant-a",
    payload: { clientId: "tenant-a" },
    createdAt: new Date("2025-01-01T00:00:00Z"),
  }),
  buildJob({
    id: "job-tenant-b",
    status: "done",
    payload: { clientId: "tenant-b" },
    progress: 100,
    createdAt: new Date("2025-01-02T00:00:00Z"),
  }),
  buildJob({
    id: "job-orphan",
    payload: { foo: "bar" },
    createdAt: new Date("2025-01-03T00:00:00Z"),
  }),
];

// Track which tenancy / org id reached the storage layer so we can assert
// regardless of how the caller supplied it (header / camelCase / snake_case).
const lastSeen = {
  competitorClientId: null as string | null,
  topicClientId: null as string | null,
  promptClientId: null as string | null,
  citationClientId: null as string | null,
  clientsOrgId: null as string | null,
};

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

/**
 * Apply a typed `Partial<IStorage>` patch to the shared storage singleton.
 * Using `Partial<IStorage>` keeps every override checked against the real
 * interface — there are no `as any` casts and a typo or signature drift in
 * `IStorage` will surface as a TypeScript error.
 */
function patchStorage(target: IStorage, patch: Partial<IStorage>) {
  Object.assign(target, patch);
}

const storagePatch: Partial<IStorage> = {
  // Jobs
  getJobs: async () => fakeJobs,
  getJob: async (id: string) => fakeJobs.find((j) => j.id === id),
  // The JobQueue constructor calls these on import; return null/no-ops so
  // the background worker never tries to mutate real DB state.
  claimJob: async () => null,
  updateJob: async (id: string, updates) => {
    const existing = fakeJobs.find((j) => j.id === id);
    return { ...(existing as Job), ...updates } as Job;
  },

  // Tenancy-aware reads
  getCompetitors: async (clientId: string) => {
    lastSeen.competitorClientId = clientId;
    return [buildCompetitor(clientId)];
  },
  getTopics: async (clientId: string) => {
    lastSeen.topicClientId = clientId;
    return [buildTopic(clientId)];
  },
  getPrompts: async (clientId: string) => {
    lastSeen.promptClientId = clientId;
    return [buildPrompt(clientId)];
  },

  // Reference data
  getAiModels: async () => [buildAiModel()],
  getScoreColorBands: async (category: string) => [
    { category, minScore: 0, maxScore: 33, color: "#ff0000" },
    { category, minScore: 34, maxScore: 66, color: "#ffaa00" },
    { category, minScore: 67, maxScore: 100, color: "#00aa00" },
  ],

  // Org / clients
  getOrganization: async (id: string) =>
    id === "org-1" ? buildOrganization() : undefined,
  getClients: async (orgId: string) => {
    lastSeen.clientsOrgId = orgId;
    return [buildClient(orgId)];
  },
  getClient: async (id: string) =>
    id === "client-1" ? buildClient("org-1") : undefined,

  // Dashboard fan-out
  getPromptRuns: async (clientId: string) => [buildPromptRun(clientId)],
  getClientModels: async (_clientId: string) => [buildAiModel()],
  getClientAggregatedScores: async (_clientId: string) => ({
    avgVisibilityScore: 75,
    avgSentimentScore: 80,
    avgPositionScore: 65,
    totalCitations: 42,
  }),
  getPromptRunsMetadata: async (_clientId: string) => [],
  getPromptRunItems: async (_runId: string) => [],
  getAnswerByPromptRunItem: async (_itemId: string) => undefined,

  // Opportunities
  getCitationAnalysis: async (clientId: string) => {
    lastSeen.citationClientId = clientId;
    return [];
  },

  // X-Ray
  getXRaySitesWithMetrics: async (_clientId: string) => [],
  getXRaySitesByClient: async (_clientId: string) => [],
  // Task #64
  getLatestXRayJobsBySite: async (_clientId: string) => new Map(),
  getXRaySite: async (siteId: string) =>
    siteId === "site-1" ? buildXRaySite("tenant-x") : undefined,
};

// ---------------------------------------------------------------------------
// Suite: env is set, then everything that touches `server/db.ts` is loaded
// via dynamic `await import(...)` so static-import hoisting cannot fire the
// "DATABASE_URL is not set" guard before our assignment runs.
// ---------------------------------------------------------------------------

let app: Express;
let pool: { end: () => Promise<void> };
let jobQueue: { stopAcceptingJobs: () => void };

before(async () => {
  // Patch BEFORE the routes load — `_shared.ts` constructs a `JobQueue`
  // whose constructor immediately calls `recoverStaleJobs()` which would
  // otherwise try to talk to a real database.
  const storageModule = await import("../storage");
  patchStorage(storageModule.storage, storagePatch);

  const routesModule = await import("../routes/index");
  jobQueue = routesModule.jobQueue;
  pool = (await import("../db")).pool;

  app = express();
  app.use(express.json());
  await routesModule.registerRoutes(app);
});

after(async () => {
  // Cleanly release the long-lived handles that would otherwise keep the
  // Node test runner alive after all assertions complete:
  //   * `jobQueue.stopAcceptingJobs()` clears the 15s polling `setInterval`.
  //   * `pool.end()` closes the Neon WebSocket connection pool.
  // Both are idempotent. We deliberately do NOT call `process.exit()` here
  // so the test runner's natural exit code (which reflects pass/fail) is
  // preserved.
  jobQueue?.stopAcceptingJobs();
  try {
    await pool?.end();
  } catch {
    // Pool may already be closed — ignore.
  }
});

// ---------------------------------------------------------------------------
// Tenancy resolution: header / camelCase / legacy snake_case all equivalent
// ---------------------------------------------------------------------------

test("GET /api/v1/jobs filters by tenant supplied via x-client-id header", async () => {
  const res = await request(app)
    .get("/api/v1/jobs")
    .set("x-client-id", "tenant-a");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, "job-tenant-a");
});

test("GET /api/v1/jobs filters by tenant supplied via ?clientId= (recommended)", async () => {
  const res = await request(app).get("/api/v1/jobs?clientId=tenant-a");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, "job-tenant-a");
});

test("GET /api/v1/jobs filters by tenant supplied via legacy ?client_id=", async () => {
  const res = await request(app).get("/api/v1/jobs?client_id=tenant-a");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, "job-tenant-a");
});

test("GET /api/v1/jobs: header takes precedence over both query params", async () => {
  const res = await request(app)
    .get("/api/v1/jobs?clientId=tenant-b&client_id=tenant-b")
    .set("x-client-id", "tenant-a");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, "job-tenant-a");
});

test("GET /api/v1/jobs: ?clientId= takes precedence over legacy ?client_id=", async () => {
  const res = await request(app).get(
    "/api/v1/jobs?clientId=tenant-a&client_id=tenant-b",
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, "job-tenant-a");
});

test("GET /api/v1/jobs without tenancy returns every job (sorted desc by createdAt)", async () => {
  const res = await request(app).get("/api/v1/jobs");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, fakeJobs.length);
  assert.equal(res.body[0].id, "job-orphan"); // 2025-01-03
  assert.equal(res.body[res.body.length - 1].id, "job-tenant-a");
});

// ---------------------------------------------------------------------------
// Consolidated /api/v1/jobs/:id endpoint (was previously double-registered)
// ---------------------------------------------------------------------------

test("GET /api/v1/jobs/:id returns the job when it exists", async () => {
  const res = await request(app).get("/api/v1/jobs/job-tenant-b");
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "job-tenant-b");
  assert.equal(res.body.status, "done");
});

test("GET /api/v1/jobs/:id 404s when the job is missing (no fallback to list handler)", async () => {
  const res = await request(app).get("/api/v1/jobs/does-not-exist");
  assert.equal(res.status, 404);
  assert.match(res.body.message, /not found/i);
});

test("GET /api/v1/jobs/:id ignores tenancy params (single-job lookup is by id only)", async () => {
  const res = await request(app)
    .get("/api/v1/jobs/job-tenant-a?clientId=tenant-b")
    .set("x-client-id", "tenant-b");
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "job-tenant-a");
});

// ---------------------------------------------------------------------------
// Representative tenancy endpoints (competitors/topics/prompts)
// ---------------------------------------------------------------------------

test("GET /api/v1/competitors requires tenancy and returns 400 with no clientId", async () => {
  const res = await request(app).get("/api/v1/competitors");
  assert.equal(res.status, 400);
  assert.match(res.body.message, /clientId is required/);
});

test("GET /api/v1/competitors resolves clientId from the x-client-id header", async () => {
  lastSeen.competitorClientId = null;
  const res = await request(app)
    .get("/api/v1/competitors")
    .set("x-client-id", "tenant-header");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.competitorClientId, "tenant-header");
  assert.equal(res.body[0].clientId, "tenant-header");
});

test("GET /api/v1/competitors resolves clientId from ?clientId= query param", async () => {
  lastSeen.competitorClientId = null;
  const res = await request(app).get("/api/v1/competitors?clientId=tenant-q");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.competitorClientId, "tenant-q");
});

test("GET /api/v1/competitors resolves clientId from legacy ?client_id= param", async () => {
  lastSeen.competitorClientId = null;
  const res = await request(app).get(
    "/api/v1/competitors?client_id=tenant-legacy",
  );
  assert.equal(res.status, 200);
  assert.equal(lastSeen.competitorClientId, "tenant-legacy");
});

test("GET /api/v1/topics resolves tenancy via header", async () => {
  lastSeen.topicClientId = null;
  const res = await request(app)
    .get("/api/v1/topics")
    .set("x-client-id", "tenant-topics");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.topicClientId, "tenant-topics");
  assert.equal(res.body[0].label, "Pricing");
});

test("GET /api/v1/topics/:clientId still works (path-param flavor)", async () => {
  lastSeen.topicClientId = null;
  const res = await request(app).get("/api/v1/topics/path-tenant");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.topicClientId, "path-tenant");
});

test("GET /api/v1/prompts requires clientId", async () => {
  const res = await request(app).get("/api/v1/prompts");
  assert.equal(res.status, 400);
});

test("GET /api/v1/prompts resolves clientId from query param", async () => {
  lastSeen.promptClientId = null;
  const res = await request(app).get("/api/v1/prompts?clientId=tenant-prompts");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.promptClientId, "tenant-prompts");
});

test("GET /api/v1/ai-models returns the model list with key availability", async () => {
  const res = await request(app).get("/api/v1/ai-models");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body[0].id, "model-1");
  assert.equal(typeof res.body[0].isKeyAvailable, "boolean");
});

test("GET /api/v1/score-colors requires the category query param", async () => {
  const res = await request(app).get("/api/v1/score-colors");
  assert.equal(res.status, 400);
});

test("GET /api/v1/score-colors rejects an unknown category", async () => {
  const res = await request(app).get("/api/v1/score-colors?category=Bogus");
  assert.equal(res.status, 400);
});

test("GET /api/v1/score-colors returns bands for a valid category", async () => {
  const res = await request(app).get(
    "/api/v1/score-colors?category=Visibility",
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 3);
  assert.equal(res.body[0].category, "Visibility");
});

test("GET /api/v1/organizations/:id returns the organization", async () => {
  const res = await request(app).get("/api/v1/organizations/org-1");
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "org-1");
});

test("GET /api/v1/organizations/:id returns 404 for unknown ids", async () => {
  const res = await request(app).get("/api/v1/organizations/missing");
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// /openapi.json — smoke test that the auto-generated document is valid.
// ---------------------------------------------------------------------------

test("GET /openapi.json returns a valid OpenAPI 3 document", async () => {
  const res = await request(app).get("/openapi.json");
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"]?.split(";")[0], "application/json");

  const doc = res.body;

  // Top-level shape.
  assert.ok(typeof doc.openapi === "string", "openapi version must be a string");
  assert.match(doc.openapi, /^3\./, "should declare OpenAPI 3.x");
  assert.ok(doc.info, "must include info");
  assert.ok(typeof doc.info.title === "string" && doc.info.title.length > 0);
  assert.ok(typeof doc.info.version === "string" && doc.info.version.length > 0);
  assert.ok(doc.paths && typeof doc.paths === "object", "must include paths");

  // Spot-check a representative path per domain to make sure the registry was
  // wired in `openapi.ts`.
  const expectedPaths = [
    "/api/v1/organizations/{id}",
    "/api/v1/clients",
    "/api/v1/jobs",
    "/api/v1/jobs/{id}",
    "/api/v1/competitors",
    "/api/v1/topics",
    "/api/v1/prompts",
    "/api/v1/ai-models",
    "/api/v1/score-colors",
    "/api/v1/dashboard/stats",
  ];
  for (const path of expectedPaths) {
    assert.ok(doc.paths[path], `OpenAPI doc missing path: ${path}`);
  }

  // Shared tenancy parameters must be registered as `components` so that
  // route registrations referencing them via `$ref` resolve correctly.
  assert.ok(doc.components?.parameters?.XClientIdHeader);
  assert.ok(doc.components?.parameters?.ClientIdQuery);

  // Tag list should advertise every domain module.
  const tagNames = new Set(
    ((doc.tags ?? []) as Array<{ name: string }>).map((t) => t.name),
  );
  for (const expectedTag of [
    "organizations",
    "clients",
    "jobs",
    "competitors",
    "topics",
    "prompts",
    "prompt-runs",
    "dashboard",
    "opportunities",
    "xray",
    "crawler",
    "reports",
  ]) {
    assert.ok(tagNames.has(expectedTag), `OpenAPI doc missing tag: ${expectedTag}`);
  }
});

// ---------------------------------------------------------------------------
// Remaining per-domain modules: at least one representative endpoint each,
// preferring tenancy-resolution coverage where the helper is involved.
// ---------------------------------------------------------------------------

// clients module
test("clients: GET /api/v1/clients lists clients (defaults orgId when missing)", async () => {
  lastSeen.clientsOrgId = null;
  const res = await request(app).get("/api/v1/clients");
  assert.equal(res.status, 200);
  // No orgId supplied -> handler falls back to "default-org".
  assert.equal(lastSeen.clientsOrgId, "default-org");
  assert.equal(res.body[0].id, "client-1");
});

test("clients: GET /api/v1/clients honors ?orgId= query param", async () => {
  lastSeen.clientsOrgId = null;
  const res = await request(app).get("/api/v1/clients?orgId=org-q");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.clientsOrgId, "org-q");
});

test("clients: GET /api/v1/clients honors legacy ?org_id= query param", async () => {
  lastSeen.clientsOrgId = null;
  const res = await request(app).get("/api/v1/clients?org_id=org-legacy");
  assert.equal(res.status, 200);
  assert.equal(lastSeen.clientsOrgId, "org-legacy");
});

test("clients: GET /api/v1/clients/:id returns 404 for unknown client", async () => {
  const res = await request(app).get("/api/v1/clients/missing-client");
  assert.equal(res.status, 404);
});

test("clients: GET /api/v1/clients/validate-project-name 400 without projectName/orgId", async () => {
  const res = await request(app).get("/api/v1/clients/validate-project-name");
  assert.equal(res.status, 400);
});

// onboarding module
test("onboarding: POST /api/v1/onboarding/enrich-urls 400 when name missing", async () => {
  const res = await request(app).post("/api/v1/onboarding/enrich-urls").send({});
  assert.equal(res.status, 400);
  assert.match(res.body.message, /name is required/i);
});

test("onboarding: POST /api/v1/onboarding/enrich-profile 400 when name missing", async () => {
  const res = await request(app)
    .post("/api/v1/onboarding/enrich-profile")
    .send({});
  assert.equal(res.status, 400);
});

test("onboarding: POST /api/v1/onboarding/enrich-competitors 400 when name missing", async () => {
  const res = await request(app)
    .post("/api/v1/onboarding/enrich-competitors")
    .send({});
  assert.equal(res.status, 400);
});

// prompt-runs module
test("prompt-runs: GET /api/v1/prompt-runs requires clientId", async () => {
  const res = await request(app).get("/api/v1/prompt-runs");
  assert.equal(res.status, 400);
});

test("prompt-runs: GET /api/v1/prompt-runs resolves clientId from header", async () => {
  const res = await request(app)
    .get("/api/v1/prompt-runs")
    .set("x-client-id", "tenant-runs");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test("prompt-runs: GET /api/v1/prompt-runs/metadata accepts legacy ?client_id=", async () => {
  const res = await request(app).get(
    "/api/v1/prompt-runs/metadata?client_id=tenant-runs",
  );
  assert.equal(res.status, 200);
});

// dashboard module
test("dashboard: GET /api/v1/dashboard/stats requires clientId", async () => {
  const res = await request(app).get("/api/v1/dashboard/stats");
  assert.equal(res.status, 400);
});

test("dashboard: GET /api/v1/dashboard/stats returns aggregated payload", async () => {
  const res = await request(app)
    .get("/api/v1/dashboard/stats")
    .set("x-client-id", "tenant-dash");
  assert.equal(res.status, 200);
  assert.equal(res.body.totalPrompts, 1);
  assert.equal(res.body.avgVisibilityScore, 75);
  assert.equal(res.body.totalCitations, 42);
  assert.equal(res.body.activeModels, 1);
  assert.equal(res.body.totalRuns, 1);
  assert.equal(res.body.completedRuns, 1);
});

// opportunities module
test("opportunities: GET /api/v1/opportunities/citations requires clientId", async () => {
  const res = await request(app).get("/api/v1/opportunities/citations");
  assert.equal(res.status, 400);
});

test("opportunities: GET /api/v1/opportunities/citations resolves clientId from query", async () => {
  lastSeen.citationClientId = null;
  const res = await request(app).get(
    "/api/v1/opportunities/citations?clientId=tenant-opp",
  );
  assert.equal(res.status, 200);
  assert.equal(lastSeen.citationClientId, "tenant-opp");
  assert.deepEqual(res.body, []);
});

// xray module
test("xray: GET /api/v1/xray/sites requires clientId", async () => {
  const res = await request(app).get("/api/v1/xray/sites");
  assert.equal(res.status, 400);
});

test("xray: GET /api/v1/xray/sites returns the (empty) site list with header", async () => {
  const res = await request(app)
    .get("/api/v1/xray/sites")
    .set("x-client-id", "tenant-xray");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("xray: GET /api/v1/xray/sites/:siteId 404 for unknown site", async () => {
  const res = await request(app).get("/api/v1/xray/sites/missing-site");
  assert.equal(res.status, 404);
});

// crawler module
test("crawler: POST /api/v1/crawler/execute 400 with missing body", async () => {
  const res = await request(app).post("/api/v1/crawler/execute").send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error?.code, "VALIDATION_ERROR");
});

test("crawler: POST /api/v1/crawler/execute 400 with insecure (non-http) URL", async () => {
  const res = await request(app)
    .post("/api/v1/crawler/execute")
    .send({ url: "ftp://example.com" });
  assert.equal(res.status, 400);
  assert.ok(["VALIDATION_ERROR", "INVALID_URL"].includes(res.body.error?.code));
});

test("crawler: GET /api/v1/crawler/jobs/:jobId returns the consolidated job shape", async () => {
  const res = await request(app).get("/api/v1/crawler/jobs/job-tenant-b");
  assert.equal(res.status, 200);
  assert.equal(res.body.jobId, "job-tenant-b");
  assert.equal(res.body.status, "done");
});

test("crawler: GET /api/v1/crawler/jobs/:jobId 404 for unknown id", async () => {
  const res = await request(app).get("/api/v1/crawler/jobs/missing");
  assert.equal(res.status, 404);
  assert.equal(res.body.error?.code, "JOB_NOT_FOUND");
});

// reports module
test("reports: GET /api/v1/reports requires clientId", async () => {
  const res = await request(app).get("/api/v1/reports");
  assert.equal(res.status, 400);
});

test("reports: POST /api/v1/reports/generate 400 when clientId missing", async () => {
  const res = await request(app).post("/api/v1/reports/generate").send({});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /clientId is required/i);
});

test("reports: POST /api/v1/reports/generate 400 when runId missing", async () => {
  const res = await request(app)
    .post("/api/v1/reports/generate")
    .send({ clientId: "client-1" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /runId is required/i);
});

test("GET /openapi.json sets a cache-control header (response is memoized)", async () => {
  const res = await request(app).get("/openapi.json");
  assert.equal(res.status, 200);
  assert.match(res.headers["cache-control"] || "", /max-age=/);
});

// ---------------------------------------------------------------------------
// admin module: /health and /api/admin/queue (Task #15)
// ---------------------------------------------------------------------------

test("GET /health returns the documented payload shape", async () => {
  const res = await request(app).get("/health");
  // The test pool can't actually reach Postgres, so dbOk will be false and
  // the endpoint will return 503. Either way, the body shape must be stable.
  assert.ok(res.status === 200 || res.status === 503);
  assert.ok(typeof res.body.status === "string");
  assert.equal(typeof res.body.dbOk, "boolean");
  assert.equal(typeof res.body.shuttingDown, "boolean");
  assert.ok(res.body.queue && typeof res.body.queue === "object");
  assert.equal(typeof res.body.queue.active, "number");
  assert.equal(typeof res.body.queue.queued, "number");
  assert.equal(typeof res.body.queue.stale, "number");
  assert.ok(res.body.config && typeof res.body.config === "object");
  assert.equal(typeof res.body.config.heartbeatIntervalMs, "number");
  assert.equal(typeof res.body.config.staleThresholdMs, "number");
  assert.equal(typeof res.body.config.maxResumeAttempts, "number");
  assert.equal(typeof res.body.config.maxConcurrentJobs, "number");
  assert.equal(typeof res.body.config.defaultTimeoutMs, "number");
});

test("GET /api/admin/queue returns the JobQueue tunable config", async () => {
  const res = await request(app).get("/api/admin/queue");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.heartbeatIntervalMs, "number");
  assert.equal(typeof res.body.staleThresholdMs, "number");
  assert.equal(typeof res.body.maxResumeAttempts, "number");
  assert.equal(typeof res.body.maxConcurrentJobs, "number");
  assert.equal(typeof res.body.defaultTimeoutMs, "number");
});

test("OpenAPI doc registers /health and /api/admin/queue", async () => {
  const res = await request(app).get("/openapi.json");
  assert.equal(res.status, 200);
  assert.ok(res.body.paths["/health"], "missing /health");
  assert.ok(res.body.paths["/api/admin/queue"], "missing /api/admin/queue");
});
