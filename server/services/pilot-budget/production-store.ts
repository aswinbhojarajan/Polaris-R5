import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { nativeSearchPilotBudgets, promptRuns, users, userOrgMemberships } from "../../../shared/schema";
import { ledgerSchema, PilotBudgetError, type Ledger } from "./guard";
import { pilotRates } from "./pricing";
import { productionInstanceId, productionManifestSchema, type ProductionManifest } from "./production-config";
import { loadSearchPolicy } from "../native-web-search/policy";

export const productionStateSchema = z.object({
  phase: z.enum(["pilot", "active", "closed"]),
  expiresAt: z.string().datetime(),
  ledger: ledgerSchema,
  cases: z.array(z.object({
    runId: z.string(), provider: z.enum(["openai", "anthropic"]), search: z.boolean(),
  })).max(6),
  approvals: z.array(z.unknown()).max(2).default([]),
  browserAcceptanceRef: z.string().max(300).optional(),
  instanceId: z.string().uuid(),
}).strict();
export type ProductionState = z.infer<typeof productionStateSchema>;
export const productionHash = (m: ProductionManifest) =>
  createHash("sha256").update(JSON.stringify({ m: productionManifestSchema.parse(m), rates: pilotRates, policy: 1 })).digest("hex");
export const accountedMicros = (ledger: Ledger) => ledger.entries.reduce((sum, e) => sum + e.accountedMicros, 0);

/** The row lock covers accounting only, NEVER a provider network request.
 * Errors are persisted before being thrown outside the transaction. */
export async function withProductionBudget<T>(m: ProductionManifest,
  operation: (state: ProductionState, tx: typeof db) => T | Promise<T>): Promise<T> {
  const outcome = await db.transaction(async transaction => {
    const tx = transaction as unknown as typeof db;
    const [row] = await tx.select().from(nativeSearchPilotBudgets)
      .where(eq(nativeSearchPilotBudgets.approvalRef, m.approvalRef)).for("update");
    if (!row) return { error: "MISSING_PRODUCTION_LEDGER" };
    const state = productionStateSchema.parse(row.state);
    let result: T | undefined, error: string | undefined;
    try {
      if (row.manifestHash !== productionHash(m) || state.ledger.manifestHash !== row.manifestHash)
        throw new PilotBudgetError("MANIFEST_CHANGED");
      if (accountedMicros(state.ledger) > Math.floor(m.budgetUsd * 1_000_000)) throw new PilotBudgetError("INVALID_LEDGER");
      result = await operation(state, tx);
    } catch (failure) {
      error = failure instanceof PilotBudgetError ? failure.code : "PRODUCTION_LEDGER_OPERATION_FAILED";
      state.ledger.stopped ||= error;
    }
    await tx.update(nativeSearchPilotBudgets).set({ state, updatedAt: new Date() })
      .where(eq(nativeSearchPilotBudgets.approvalRef, m.approvalRef));
    return { result, error };
  });
  if (outcome.error) throw new PilotBudgetError(outcome.error);
  return outcome.result as T;
}

export function checkProductionWindow(state: ProductionState) {
  if (state.phase !== "pilot" || state.ledger.stopped) throw new PilotBudgetError("ALREADY_STOPPED");
  if (state.instanceId !== productionInstanceId) throw new PilotBudgetError("PILOT_NOT_INITIALIZED");
  if (Date.now() >= Date.parse(state.expiresAt)) throw new PilotBudgetError("EXPIRED");
}

export async function checkProductionOperator(m: ProductionManifest, tx: typeof db) {
  const [operator] = await tx.select({ status: users.status, role: userOrgMemberships.role })
    .from(users).innerJoin(userOrgMemberships, eq(users.id, userOrgMemberships.userId))
    .where(and(eq(users.id, m.operatorId), eq(userOrgMemberships.orgId, m.orgId)));
  const policy = loadSearchPolicy();
  if (operator?.status !== "active" || operator.role !== "admin" || !policy.enabled ||
      policy.environment !== "production" || !policy.providerEnabled.openai || !policy.providerEnabled.anthropic ||
      policy.accounts.openai !== m.accountRefs.openai || policy.accounts.anthropic !== m.accountRefs.anthropic)
    throw new PilotBudgetError("PRODUCTION_AUTHORIZATION_REVOKED");
}

export async function reserveProduction(m: ProductionManifest, entry: Ledger["entries"][number]) {
  return withProductionBudget(m, async (state, tx) => {
    checkProductionWindow(state);
    await checkProductionOperator(m, tx);
    const run = state.cases.find(c => c.runId === entry.runId);
    if (!entry.runId || !run ||
        state.ledger.entries.length >= 512) throw new PilotBudgetError("UNAPPROVED_PRODUCTION_RUN");
    if ((entry.model === "gpt-5.6-terra" && run.provider !== "openai") ||
        (entry.model === "claude-sonnet-5" && run.provider !== "anthropic") ||
        ((entry.model === "gpt-5.6-terra" || entry.model === "claude-sonnet-5") &&
          (entry.searchUseCeiling > 0) !== run.search))
      throw new PilotBudgetError("PRODUCTION_PRIMARY_MISMATCH");
    if (accountedMicros(state.ledger) + entry.reservedMicros > Math.floor(m.budgetUsd * 1_000_000))
      throw new PilotBudgetError("INSUFFICIENT_BUDGET");
    state.ledger.entries.push(entry);
    return state.expiresAt;
  });
}
export async function stopProduction(m: ProductionManifest, code: string) {
  return withProductionBudget(m, state => { state.ledger.stopped ||= code; });
}

export async function closeProduction(m: ProductionManifest) {
  await withProductionBudget(m, async (state, tx) => {
    state.phase = "closed"; state.ledger.stopped ||= "OWNER_CLOSED";
    await tx.update(users).set({ status: "disabled", sessionEpoch: sql`${users.sessionEpoch} + 1` }).where(eq(users.id, m.operatorId));
    await tx.update(promptRuns).set({ status: "cancelled", errorSummary: "Production pilot closed" })
      .where(and(eq(promptRuns.clientId, m.clientId), eq(promptRuns.status, "queued")));
  });
}
