import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyReleaseBuild, requiredInputs, requiredMarkers } from "./verify-release-build.mjs";

async function fixture(t, { omitMarker, omitInput, wrongHtml = false, disconnected = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "r1a-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, value) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  await put("dist/public/.vite/manifest.json", { "index.html": { isEntry: true, file: "assets/main.js" } });
  await put("dist/public/index.html", `<script src="/assets/${wrongHtml ? "stale" : "main"}.js"></script>`);
  await put("dist/public/assets/main.js", requiredMarkers.filter(m => m !== omitMarker).join(";"));
  const inputs = Object.fromEntries(requiredInputs.filter(i => i !== omitInput).map(i => [i, { bytesInOutput: 1 }]));
  await put("dist/server-meta.json", { outputs: {
    "dist/index.js": { entryPoint: "server/bootstrap.ts", inputs: disconnected ? {} : inputs, imports: [] },
    ...(disconnected ? { "dist/stale.js": { inputs, imports: [] } } : {}),
  } });
  await put("dist/index.js", "// fixture");
  return root;
}

test("complete compiled feature produces a stable content identity", async t => {
  const root = await fixture(t);
  const release = await verifyReleaseBuild(root);
  assert.match(release.buildId, /^[a-f0-9]{64}$/);
  assert.equal(release.buildId, (await verifyReleaseBuild(root)).buildId);
  assert.deepEqual(release.frontendAssets, ["/assets/main.js"]);
});
test("missing checkbox fails the build", async t => {
  await assert.rejects(verifyReleaseBuild(await fixture(t, { omitMarker: requiredMarkers[0] })), /frontend missing/);
});
test("missing matching backend fails the build", async t => {
  await assert.rejects(verifyReleaseBuild(await fixture(t, { omitInput: requiredInputs[3] })), /backend missing/);
});
test("stale HTML cannot validate against newer assets", async t => {
  await assert.rejects(verifyReleaseBuild(await fixture(t, { wrongHtml: true })), /HTML does not reference/);
});
test("disconnected stale backend chunks cannot satisfy the guard", async t => {
  await assert.rejects(verifyReleaseBuild(await fixture(t, { disconnected: true })), /backend missing/);
});
