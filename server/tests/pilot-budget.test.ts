import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { PilotBudgetGuard } from "../services/pilot-budget/guard";

const manifest = (extra = {}) => ({ version: 1, approvalRef: "unpaid-fixture",
  budgetUsd: 50, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...extra });
const native = () => ({ model: "gpt-5.6-terra", input: "fixture", tools: [{ type: "web_search" }],
  max_tool_calls: 5, max_output_tokens: 8000 });
const post = (body: unknown, url = "https://api.openai.com/v1/responses") =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });
const usage = () => Response.json({ service_tier: "default", usage: { input_tokens: 100, output_tokens: 50 } });
async function fixture(run: (guard: PilotBudgetGuard, path: string, config: ReturnType<typeof manifest>) => Promise<void>, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "polaris-pilot-budget-"));
  const config = manifest(extra), path = join(dir, "ledger.json");
  const guard = new PilotBudgetGuard(path, config);
  try { await run(guard, path, config); } finally { guard.close(); rmSync(dir, { recursive: true, force: true }); }
}

test("pilot quote reserves full native context and tool fees before wire, then settles conservatively", async () => {
  await fixture(async (guard, path) => {
    const wrapped = guard.wrap(async req => {
      const body = await (req as Request).clone().json();
      assert.equal(body.model, "gpt-5.6-terra");
      assert.equal(body.service_tier, "default");
      const saved = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(saved.entries[0].state, "reserved");
      assert.equal(saved.entries[0].accountedMicros, 10_840_000);
      return usage();
    });
    const response = await wrapped(post(native()));
    assert.equal((await response.json()).usage.input_tokens, 100, "provider response is unmodified");
    assert.equal(guard.summary().accountedUpperUsd, 0.1025);
    assert.equal(guard.summary().unresolved, 0);
    assert.ok(!readFileSync(path, "utf8").includes("fixture\""), "ledger has no request prose");
  });
});

test("concurrent reservations cannot overspend or dispatch after budget exhaustion", async () => {
  await fixture(async guard => {
    let calls = 0;
    const wrapped = guard.wrap(async req => {
      calls++;
      return new Promise<Response>((_resolve, reject) => (req as Request).signal.addEventListener("abort", () => reject(new Error("fixture abort"))));
    });
    const results = await Promise.allSettled([wrapped(post(native())), wrapped(post(native()))]);
    assert.ok(results.every(r => r.status === "rejected"));
    assert.equal(calls, 1);
    assert.equal(guard.summary().stopped, "INSUFFICIENT_BUDGET");
    assert.equal(guard.summary().accountedUpperUsd, 10.84);
  }, { budgetUsd: 15 });
});

test("unknown HTTP outcomes retain reservations and stop all future billable dispatch", async () => {
  await fixture(async guard => {
    let calls = 0;
    const wrapped = guard.wrap(async () => { calls++; throw new Error("never echo transport details"); });
    await assert.rejects(wrapped(post(native())), /UNKNOWN_OUTCOME/);
    await assert.rejects(wrapped(post(native())), /ALREADY_STOPPED/);
    assert.equal(calls, 1);
    assert.equal(guard.summary().unresolved, 1);
    assert.equal(guard.summary().accountedUpperUsd, 10.84);
  });
});

test("missing usage never releases native context reservations", async () => {
  await fixture(async guard => {
    await assert.rejects(guard.wrap(async () => Response.json({}))(post(native())), /UNVERIFIED_USAGE/);
    assert.equal(guard.summary().accountedUpperUsd, 10.84);
  });
  await fixture(async guard => {
    const body = { model: "claude-sonnet-5", messages: [{ role: "user", content: "fixture" }], max_tokens: 100 };
    await assert.rejects(guard.wrap(async () => Response.json({ usage: {
      input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: -99,
    } }))(post(body, "https://api.anthropic.com/v1/messages")), /UNVERIFIED_USAGE/);
    assert.equal(guard.summary().unresolved, 1);
  });
});

test("receipt survives restart, manifest changes cannot refill, and locks exclude concurrent processes", async () => {
  await fixture(async (guard, path, config) => {
    assert.throws(() => new PilotBudgetGuard(path, config), /EEXIST/);
    await guard.wrap(async () => usage())(post(native()));
    const charged = guard.usedMicros;
    guard.close();
    assert.throws(() => new PilotBudgetGuard(path, { ...config, budgetUsd: 49 }), /MANIFEST_CHANGED/);
    const recovered = new PilotBudgetGuard(path, config);
    try { assert.equal(recovered.usedMicros, charged); } finally { recovered.close(); }
  });
});

test("crash-like unresolved restart stays stopped even with unused budget", async () => {
  await fixture(async (guard, path, config) => {
    await assert.rejects(guard.wrap(async () => { throw new Error("fixture"); })(post(native())));
    // Simulate a crash between durable admission and a persisted stop record.
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.stopped = null;
    guard.close();
    const fs = await import("node:fs");
    fs.writeFileSync(path, JSON.stringify(saved));
    const recovered = new PilotBudgetGuard(path, config);
    try {
      assert.equal(recovered.summary().stopped, "UNRESOLVED_RESTART");
      await assert.rejects(recovered.wrap(async () => usage())(post(native())), /ALREADY_STOPPED/);
    } finally { recovered.close(); }
  });
});

test("ledger persistence failures prevent wire dispatch and do not refill post-dispatch uncertainty", async () => {
  await fixture(async (guard, path, config) => {
    let calls = 0;
    mkdirSync(`${path}.tmp`);
    const wrapped = guard.wrap(async () => { calls++; return usage(); });
    await assert.rejects(wrapped(post(native())), /LEDGER_WRITE_FAILED/);
    assert.equal(calls, 0);
    guard.close(); rmSync(`${path}.tmp`, { recursive: true });
    const next = new PilotBudgetGuard(path, config);
    try {
      await assert.rejects(next.wrap(async () => { mkdirSync(`${path}.tmp`); return usage(); })(post(native())), /LEDGER_WRITE_FAILED/);
    } finally { next.close(); rmSync(`${path}.tmp`, { recursive: true }); }
    const recovered = new PilotBudgetGuard(path, config);
    try { assert.equal(recovered.summary().stopped, "UNRESOLVED_RESTART"); } finally { recovered.close(); }
  });
});

test("ordinary OpenAI calls without explicit output limits reserve published model maxima without changing requests", async () => {
  for (const [model, maximumOutput, outputRate] of [
    ["gpt-4o-mini", 16_384, 2], ["gpt-5.4", 128_000, 45],
  ] as const) await fixture(async (guard, path) => {
    let calls = 0;
    const body = { model, messages: [{ role: "user", content: "Synthetic ordinary JSON request" }],
      response_format: { type: "json_object" } };
    await guard.wrap(async request => {
      calls++;
      const sent = await new Request(request).json();
      assert.equal(sent.max_tokens, undefined);
      assert.equal(sent.max_completion_tokens, undefined);
      assert.deepEqual(sent.messages, body.messages);
      const ledger = JSON.parse(readFileSync(path, "utf8"));
      assert.ok(ledger.entries[0].reservedMicros >= maximumOutput * outputRate);
      return Response.json({ model, usage: { prompt_tokens: 2, completion_tokens: 3 } });
    })(post(body, "https://api.openai.com/v1/chat/completions"));
    assert.equal(calls, 1);
    assert.equal(guard.summary().stopped, null);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).entries[0].state, "settled");
  });
});

test("unpriced models, alternate providers, paid tools, tiers, streaming and missing native limits fail before dispatch", async () => {
  const cases = [
    post({ ...native(), model: "unpriced" }), post({ ...native(), max_tool_calls: undefined }),
    post({ ...native(), tools: [{ type: "code_interpreter" }] }), post({ ...native(), max_output_tokens: undefined }),
    post({ ...native(), stream: true }), post({ ...native(), service_tier: "priority" }),
    post(native(), "https://api.perplexity.ai/chat/completions"),
    post({ model: "gpt-4o-mini", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "fixture" } }] }], max_tokens: 100 }, "https://api.openai.com/v1/chat/completions"),
  ];
  for (const req of cases) await fixture(async guard => {
    let calls = 0;
    await assert.rejects(guard.wrap(async () => { calls++; return usage(); })(req));
    assert.equal(calls, 0);
  });
});

test("expiry stops before dispatch and metadata GETs consume no billable allowance", async () => {
  await fixture(async (guard, path) => {
    assert.throws(() => new PilotBudgetGuard(`${path}.expired`, manifest({ expiresAt: new Date(0).toISOString() })), /INVALID_EXPIRY/);
    await guard.wrap(async () => Response.json({ id: "gpt-5.6-terra" }))("https://api.openai.com/v1/models/gpt-5.6-terra");
    assert.equal(guard.summary().requests, 0);
    assert.equal(existsSync(`${path}.expired`), false);
    let now = Date.now(), calls = 0;
    const config = manifest({ expiresAt: new Date(now + 1000).toISOString() });
    const expires = new PilotBudgetGuard(`${path}.clock`, config, () => now);
    try {
      now += 1001;
      await assert.rejects(expires.wrap(async () => { calls++; return usage(); })(post(native())), /EXPIRED/);
      assert.equal(calls, 0);
    } finally { expires.close(); }
  });
});

test("real OpenAI and Anthropic SDKs inherit guarded fetch; SDK retries cannot bypass a latched stop", async () => {
  await fixture(async guard => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = guard.wrap(async req => {
      calls++;
      const body = await (req as Request).clone().json();
      if (body.model === "claude-sonnet-5") {
        assert.equal(body.service_tier, "standard_only");
        return Response.json({ id: "msg-fixture", type: "message", role: "assistant", model: body.model,
          content: [], usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 25 } });
      }
      return Response.json({ id: "chat-fixture", choices: [{ message: { role: "assistant", content: "{}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 } });
    });
    try {
      const openai = new OpenAI({ apiKey: "unpaid-fixture", maxRetries: 0 });
      const anthropic = new Anthropic({ apiKey: "unpaid-fixture", maxRetries: 0 });
      await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "fixture" }], max_tokens: 100 });
      await anthropic.messages.create({ model: "claude-sonnet-5", messages: [{ role: "user", content: "fixture" }], max_tokens: 100 });
      assert.equal(calls, 2);
      assert.equal(guard.summary().unresolved, 0);
      globalThis.fetch = guard.wrap(async () => { calls++; throw new Error("fixture"); });
      const retrying = new OpenAI({ apiKey: "unpaid-fixture", maxRetries: 2 });
      await assert.rejects(retrying.chat.completions.create({ model: "gpt-4o-mini",
        messages: [{ role: "user", content: "fixture" }], max_tokens: 100 }));
      assert.equal(calls, 3, "only the first wire attempt may dispatch");
    } finally { globalThis.fetch = original; }
  });
});
