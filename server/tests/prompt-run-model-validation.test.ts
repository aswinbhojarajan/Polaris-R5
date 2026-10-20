/**
 * Task #25 — control-plane hardening for the Start Prompt Run route.
 *
 * The popup hiding disabled models is not a security boundary, so
 * POST /api/v1/prompt-runs must itself reject:
 *   - unknown model ids            → 400 unknown_model
 *   - disabled model ids           → 400 model_disabled
 *   - vendor-paused model ids      → 400 vendor_paused
 *   - prompts from another client  → 400 unknown_prompt
 * and must de-duplicate repeated prompt/model ids so a tampered payload
 * cannot multiply run items (and provider cost).
 *
 * Run with: npx tsx --test server/tests/prompt-run-model-validation.test.ts
 */

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
// vendor-pause computes its SKIP_DB shortcut at import time from NODE_ENV;
// under "test" it would pin the pause cache to an empty set, making the
// vendor_paused rejection untestable. Auth's TEST_AUTH_BYPASS, by contrast,
// checks NODE_ENV per-request. So: import + seed the pause cache under
// "development", then flip NODE_ENV to "test" (in before()) so the auth
// bypass applies to requests.
process.env.NODE_ENV = "development";
process.env.TEST_AUTH_BYPASS = "true";

import { test, before } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import request from "supertest";

import type { AiModel, Prompt, PromptRun, PromptRunItem } from "@shared/schema";

const CLIENT_ID = "client-1";

function model(overrides: Partial<AiModel> & Pick<AiModel, "id">): AiModel {
  return {
    vendor: "OpenAI",
    model: overrides.id,
    displayName: overrides.id,
    category: "core",
    enabled: true,
    internalOnly: false,
    maxTpm: 1000,
    maxRpm: 1000,
    costPer1kInput: "1.00",
    costPer1kOutput: "1.00",
    isKeyAvailable: true,
    disabledAt: null,
    disabledBy: null,
    disabledReason: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as AiModel;
}

function prompt(id: string, clientId: string): Prompt {
  return {
    id,
    clientId,
    text: "What is the best widget?",
    source: "manual",
    accepted: true,
    categoryId: null,
    createdAt: new Date(),
  } as unknown as Prompt;
}

let app: Express;
const createdItems: PromptRunItem[] = [];

before(async () => {
  const { storage } = await import("../storage");
  const { jobQueue } = await import("../routes/_shared");
  const vendorPause = await import("../config/vendor-pause");
  const { registerPromptRunRoutes } = await import("../routes/prompt-runs");

  const s = storage as Record<string, unknown>;
  s.getAllAiModels = async (): Promise<AiModel[]> => [
    model({ id: "m-enabled" }),
    model({ id: "m-enabled-2" }),
    model({ id: "m-disabled", enabled: false }),
    model({ id: "m-paused", vendor: "Perplexity" }),
    // Task #29 — enabled but internal-only (candidate validation window).
    model({ id: "m-internal", internalOnly: true }),
  ];
  s.getPromptsByIds = async (clientId: string, ids: string[]): Promise<Prompt[]> => {
    const owned = clientId === CLIENT_ID ? [prompt("p-1", CLIENT_ID), prompt("p-2", CLIENT_ID)] : [];
    return owned.filter((p) => ids.includes(p.id));
  };
  s.createPromptRun = async (run: PromptRun) => run;
  s.createPromptRunItem = async (item: PromptRunItem) => {
    createdItems.push(item);
    return item;
  };
  s.getPromptRunsByClient = async () => [];
  (jobQueue as Record<string, unknown>).enqueue = async () => ({ id: "job-1" });
  // Importing routes/_shared constructs the real singleton JobQueue, which
  // starts DB recovery + polling. Stop it so the test process exits cleanly.
  jobQueue.stopAcceptingJobs();

  // Vendor pause: Perplexity paused, everything else live. Seed the module
  // cache through its real load path by stubbing the storage read it uses.
  s.getAiVendorStatuses = async () => [{ vendor: "Perplexity", paused: true }];
  await vendorPause.invalidateVendorPauseCache();
  assert.equal(vendorPause.isVendorPaused("Perplexity"), true);

  // Now that the pause cache is warm, switch to test mode so the
  // TEST_AUTH_BYPASS escape hatch applies to the requests below.
  process.env.NODE_ENV = "test";

  app = express();
  app.use(express.json());
  // Simulate the role resolved authoritatively for the submitted client.
  // A separate global-admin header reproduces the stale/cross-org session
  // condition that must never grant internal-model access.
  app.use((req, _res, next) => {
    const tenantRole = req.get("X-Test-Tenant-Role");
    if (tenantRole) {
      (req as any).tenantRole = tenantRole;
      (req as any).currentClientRole = tenantRole;
    }
    (req as any).session = {
      isAdmin: req.get("X-Test-Global-Admin") === "true",
    };
    next();
  });
  registerPromptRunRoutes(app);
  app.use(
    (err: { status?: number; code?: string; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status || 500).json({ code: err.code, message: err.message });
    },
  );
});

function post(
  body: Record<string, unknown>,
  auth: { tenantRole?: "admin" | "member"; globalAdmin?: boolean } = {},
) {
  const req = request(app)
    .post("/api/v1/prompt-runs")
    .set("X-Client-Id", CLIENT_ID);
  if (auth.tenantRole) req.set("X-Test-Tenant-Role", auth.tenantRole);
  if (auth.globalAdmin) req.set("X-Test-Global-Admin", "true");
  return req.send({ clientId: CLIENT_ID, promptIds: ["p-1"], modelIds: ["m-enabled"], ...body });
}

test("rejects unknown model ids", async () => {
  const res = await post({ modelIds: ["m-enabled", "m-nope"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_model");
});

test("rejects disabled model ids", async () => {
  const res = await post({ modelIds: ["m-disabled"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "model_disabled");
});

test("rejects internal-only model ids for non-admin sessions", async () => {
  const res = await post({ modelIds: ["m-internal"] });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "model_internal_only");
});

test("rejects a global/cross-org admin who is only a member of this client", async () => {
  const res = await post(
    { modelIds: ["m-internal"] },
    { tenantRole: "member", globalAdmin: true },
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "model_internal_only");
});

test("allows an internal-only model for the current client's admin", async () => {
  const res = await post(
    { modelIds: ["m-internal"] },
    { tenantRole: "admin" },
  );
  assert.equal(res.status, 201);
});

test("rejects vendor-paused model ids", async () => {
  const res = await post({ modelIds: ["m-paused"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "vendor_paused");
});

test("rejects prompts that belong to another client", async () => {
  const res = await post({ promptIds: ["p-1", "p-other-client"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_prompt");
});

test("rejects empty arrays", async () => {
  assert.equal((await post({ promptIds: [] })).status, 400);
  assert.equal((await post({ modelIds: [] })).status, 400);
});

test("de-duplicates repeated prompt/model ids", async () => {
  createdItems.length = 0;
  const res = await post({
    promptIds: ["p-1", "p-1", "p-2"],
    modelIds: ["m-enabled", "m-enabled", "m-enabled-2"],
  });
  assert.equal(res.status, 201);
  // 2 unique prompts × 2 unique models = 4 items, not 3×3 = 9.
  assert.equal(createdItems.length, 4);
  assert.equal(res.body.run.totalPrompts, 4);
});

test("accepts a valid submission", async () => {
  const res = await post({});
  assert.equal(res.status, 201);
  assert.equal(res.body.run.status, "queued");
});
