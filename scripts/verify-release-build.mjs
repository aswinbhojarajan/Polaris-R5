import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Check the emitted files, not source presence or stale files left in dist.
// This is an omission guard, not a substitute for functional release tests.
export const requiredInputs = [
  "server/bootstrap.ts",
  "server/routes/prompt-runs.ts",
  "server/services/prompt-run-executor.ts",
  "server/services/native-web-search/admission.ts",
  "server/services/native-web-search/openai.ts",
  "server/services/native-web-search/claude.ts",
  "server/services/native-web-search/store.ts",
  "server/services/native-web-search/worker.ts",
  "server/services/pilot-budget/production-runtime.ts",
  "server/services/pilot-budget/production-transport.ts",
  "server/services/prompt-run-deliverables.ts",
  "server/services/report-snapshot.ts",
  "server/services/json-exporter.ts",
  "server/services/csv-exporter.ts",
];
export const requiredMarkers = [
  "checkbox-enable-web-search",
  "Enable web search",
  "webSearchEnabled",
  "search-evidence",
];

export async function verifyReleaseBuild(root = process.cwd()) {
  const read = file => readFile(path.join(root, file), "utf8");
  const manifest = JSON.parse(await read("dist/public/.vite/manifest.json"));
  const html = await read("dist/public/index.html");
  const entries = Object.keys(manifest).filter(key => manifest[key].isEntry);
  if (!entries.length) throw new Error("No frontend entry in build manifest");
  const files = new Set();
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing frontend chunk: ${key}`);
    files.add(`dist/public/${chunk.file}`);
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(dependency);
  }
  for (const key of entries) {
    if (!html.includes(manifest[key].file)) throw new Error("HTML does not reference the built frontend entry");
    visit(key);
  }
  const frontend = (await Promise.all([...files].map(read))).join("\n");
  for (const marker of requiredMarkers) {
    if (!frontend.includes(marker)) throw new Error(`R1A frontend missing: ${marker}`);
  }

  const meta = JSON.parse(await read("dist/server-meta.json"));
  const outputs = meta.outputs;
  const reachable = new Set();
  function visitServer(file) {
    if (reachable.has(file)) return;
    const output = outputs[file];
    if (!output) throw new Error(`Missing backend build output: ${file}`);
    reachable.add(file);
    for (const dependency of output.imports ?? []) {
      if (!dependency.external) visitServer(dependency.path);
    }
  }
  if (outputs["dist/index.js"]?.entryPoint !== "server/bootstrap.ts") {
    throw new Error("Production entry must be the budget-first bootstrap");
  }
  visitServer("dist/index.js");
  const included = new Set([...reachable].flatMap(file =>
    Object.entries(outputs[file].inputs).filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name)));
  for (const input of requiredInputs) {
    if (!included.has(input)) throw new Error(`R1A backend missing: ${input}`);
  }
  for (const file of reachable) files.add(file);
  // Content identity includes frontend/backend, not credentials, environment or Git history.
  const hashes = {};
  for (const file of [...files].sort()) {
    hashes[file] = createHash("sha256").update(await read(file)).digest("hex");
  }
  const buildId = createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
  return {
    feature: "prompt-runs-native-web-search-r1a",
    buildId,
    builtAt: new Date().toISOString(),
    frontendAssets: entries.map(key => `/${manifest[key].file}`),
    verification: "compiled-presence-only",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const release = await verifyReleaseBuild();
  await writeFile("dist/public/release-build.json", `${JSON.stringify(release, null, 2)}\n`);
  console.log(`R1A compiled feature check passed; buildId=${release.buildId}`);
}
