/**
 * Operator-only development launcher. Creating a manifest/using --approved
 * does not replace owner approval in the release workflow. Never run alongside
 * the normal application: temporarily replace its existing managed workflow.
 */
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PilotBudgetGuard } from "../server/services/pilot-budget/guard";

const [manifestFile, acknowledgement] = process.argv.slice(2);
if (process.env.NODE_ENV !== "development" || acknowledgement !== "--approved" || !manifestFile) {
  throw new Error("Requires explicit paid-pilot approval, NODE_ENV=development, and an approved manifest path plus --approved");
}
const evidenceRoot = resolve("generated-artifacts/web-search-pilot");
const manifestPath = resolve(manifestFile);
if (!manifestPath.startsWith(`${evidenceRoot}${sep}`)) throw new Error("Pilot manifest must be inside ignored private evidence storage");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const guard = new PilotBudgetGuard(resolve(evidenceRoot, `${manifest.approvalRef}.ledger.json`), manifest);
if (guard.summary().stopped) {
  guard.close();
  throw new Error("Pilot ledger is stopped; operator review and new approval are required");
}
process.on("exit", () => guard.close());
globalThis.fetch = guard.wrap(globalThis.fetch);
// Both installed SDKs take their default fetch from the global at construction.
// Install BEFORE importing any application modules/SDK clients.
await import("../server/index");
