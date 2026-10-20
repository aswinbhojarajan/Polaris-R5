/**
 * Sanity checks for the Executive Report PDF filename helper (Task #110).
 *
 * These tests intentionally use no test framework — they're plain
 * `assert` calls runnable with `tsx server/utils/__tests__/report-filename.test.ts`.
 * The repo doesn't have a jest/vitest harness wired in for server code
 * yet (see follow-up #111); when it does, port these to `it()` blocks.
 */
import { strict as assert } from "node:assert";
import {
  buildReportFileBaseName,
  buildReportFileName,
  contentDispositionHeader,
} from "../report-filename";

const SNAP = "584e61eb-1234-4567-8901-abcdefabcdef";
const DATE = new Date("2026-05-16T10:00:00Z");

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("[report-filename] sanity checks");

check("identical client and project drops project segment", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Masafi",
    projectName: "Masafi",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.equal(out, "Polaris_Insights_Masafi_2026-05-16_584e61eb");
});

check("project starts with client → strip prefix", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Diageo",
    projectName: "Diageo Tequila",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.equal(out, "Polaris_Insights_Diageo_-_Tequila_2026-05-16_584e61eb");
});

check("project contains-but-not-starts is kept verbatim", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Acme",
    projectName: "North Acme Region",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.ok(
    out.startsWith("Polaris_Insights_Acme_-_North_Acme_Region_"),
    `got ${out}`,
  );
});

check("empty/missing project name falls back to `project`", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Masafi",
    projectName: "",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.equal(out, "Polaris_Insights_Masafi_-_project_2026-05-16_584e61eb");
});

check("empty client name falls back to `client`", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "",
    projectName: "Tequila",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.equal(out, "Polaris_Insights_client_-_Tequila_2026-05-16_584e61eb");
});

check("NFKD normalizes unicode (Café Solé)", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Café Solé",
    projectName: "Café Solé Espresso",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.ok(out.includes("Cafe_Sole"), `got ${out}`);
  assert.ok(out.includes("_-_Espresso_"), `got ${out}`);
});

check("oversized inputs are capped per segment (~40 chars)", () => {
  const long = "A".repeat(200);
  const out = buildReportFileBaseName({
    kind: "appendix",
    clientName: long,
    projectName: long,
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  // identical → project dropped, client capped
  const clientPart = out.replace(/^Polaris_Technical_Appendix_/, "").split("_2026-")[0];
  assert.ok(clientPart.length <= 40, `client segment ${clientPart.length} > 40`);
});

check("kind=appendix uses Polaris_Technical_Appendix prefix", () => {
  const out = buildReportFileBaseName({
    kind: "appendix",
    clientName: "Masafi",
    projectName: "Masafi",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.ok(out.startsWith("Polaris_Technical_Appendix_"), `got ${out}`);
});

check("invalid date string falls back without throwing", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Masafi",
    projectName: "Tequila",
    generatedAt: "not-a-date",
    snapshotId: SNAP,
  });
  assert.match(out, /_\d{4}-\d{2}-\d{2}_/, `got ${out}`);
});

check("short non-uuid snapshotId is left-padded to 8 chars", () => {
  const out = buildReportFileBaseName({
    kind: "insights",
    clientName: "Masafi",
    projectName: "Tequila",
    generatedAt: DATE,
    snapshotId: "ab",
  });
  assert.ok(/_(ab|.{8})$/.test(out), `got ${out}`);
});

check("buildReportFileName appends .pdf", () => {
  const out = buildReportFileName({
    kind: "insights",
    clientName: "Masafi",
    projectName: "Tequila",
    generatedAt: DATE,
    snapshotId: SNAP,
  });
  assert.ok(out.endsWith(".pdf"), `got ${out}`);
});

check("contentDispositionHeader emits both filename and filename* forms", () => {
  const header = contentDispositionHeader("Polaris_Insights_Café.pdf");
  assert.match(header, /filename="/);
  assert.match(header, /filename\*=UTF-8''/);
});

console.log("[report-filename] done");
