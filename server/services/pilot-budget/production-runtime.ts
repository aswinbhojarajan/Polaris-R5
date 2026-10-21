import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import * as s from "../../../shared/schema";
import { hashPassword } from "../passwords";
import { PilotBudgetError } from "./guard";
import { loadSearchPolicy, type SearchApproval } from "../native-web-search/policy";
import { productionManifest, productionPilotContext, productionPilotPrompt,
  productionInstanceId, setProductionPilotPolicy, type ProductionManifest } from "./production-config";
import { productionHash, productionStateSchema, withProductionBudget, checkProductionWindow,
  checkProductionOperator, type ProductionState } from "./production-store";

export const productionModels = { openai: "gpt-5.6-terra", anthropic: "claude-sonnet-5" } as const;
export function applyProductionState(m: ProductionManifest, state: ProductionState) {
  setProductionPilotPolicy({
    approvals: state.phase === "active" ? state.approvals as SearchApproval[] : [],
    cohorts: state.phase === "pilot" && !state.ledger.stopped ? (["openai", "anthropic"] as const).map(provider => ({
      environment: "production", accountRef: m.accountRefs[provider], provider, model: productionModels[provider],
      tenantId: m.clientId, operatorId: m.operatorId, approvalRef: `${m.approvalRef}-${provider}`,
      expiresAt: state.expiresAt, maxItems: 2, spendCeilingUsd: m.budgetUsd,
      actualModels: [productionModels[provider]],
      ...(provider === "openai" ? { openAiOffsetUnit: "codepoint" as const } : {}),
    })) : [],
  });
}

/** Explicitly configured, owner-approved fixture DATA only. No migrations/DDL,
 * no provider IO, and no automatic budget reset or operator reactivation. */
export async function initializeProductionPilot() {
  const m = productionManifest();
  if (!m) return;
  const policy = loadSearchPolicy();
  if (!policy.enabled || policy.environment !== "production" ||
      !policy.providerEnabled.openai || !policy.providerEnabled.anthropic ||
      policy.accounts.openai !== m.accountRefs.openai || policy.accounts.anthropic !== m.accountRefs.anthropic)
    throw new PilotBudgetError("PRODUCTION_CONFIGURATION_MISMATCH");
  const hash = productionHash(m);
  const [existing] = await db.select().from(s.nativeSearchPilotBudgets)
    .where(eq(s.nativeSearchPilotBudgets.approvalRef, m.approvalRef));
  if (!existing) {
    // The app consumes a shared Secret normally; no password or hash is returned.
    const password = process.env.SAMPLE_USER_PASSWORD;
    if (!password) throw new PilotBudgetError("PILOT_OPERATOR_SECRET_REQUIRED");
    const passwordHash = await hashPassword(password);
    await db.transaction(async tx => {
      const models = await tx.select().from(s.aiModels);
      const selected = Object.entries(productionModels).map(([provider, model]) => models.find(row =>
        row.model === model && row.vendor.toLowerCase() === provider && row.enabled && !row.internalOnly));
      if (selected.some(row => !row)) throw new PilotBudgetError("EXACT_PRODUCTION_MODELS_UNAVAILABLE");
      const state: ProductionState = {
        phase: "pilot", expiresAt: new Date(Date.now() + m.durationSeconds * 1000).toISOString(),
        ledger: { version: 1, manifestHash: hash, stopped: null, entries: [] }, cases: [], approvals: [],
        instanceId: productionInstanceId,
      };
      // Unique approval_ref serializes competing initializers. A loser returns
      // without seeding another scope or replacing any budget state.
      const inserted = await tx.insert(s.nativeSearchPilotBudgets).values({ approvalRef: m.approvalRef, manifestHash: hash, state })
        .onConflictDoNothing().returning();
      if (!inserted.length) return;
      await tx.insert(s.organizations).values({ id: m.orgId, name: "R1A production release validation" });
      await tx.insert(s.users).values({ id: m.operatorId, email: m.operatorEmail, passwordHash,
        displayName: "R1A production pilot operator" });
      await tx.insert(s.userOrgMemberships).values({ orgId: m.orgId, userId: m.operatorId, role: "admin" });
      await tx.insert(s.clients).values({ id: m.clientId, orgId: m.orgId, ownerUserId: m.operatorId,
        projectName: "Web Search R1A production pilot", name: "Mozilla Firefox", website: "https://www.mozilla.org",
        urls: ["https://www.mozilla.org", "https://www.firefox.com"], aliases: ["Firefox", "Mozilla"],
        brandAliases: ["Firefox", "Mozilla"], industry: "Web browsers", geography: "Global",
        selectedAiModelIds: selected.map(row => row!.id) });
      await tx.insert(s.competitors).values({ clientId: m.clientId, name: "Google Chrome", website: "https://www.google.com/chrome/", aliases: ["Chrome"] });
      await tx.insert(s.topics).values({ clientId: m.clientId, label: "Browser privacy", category: "Product", source: "manual", accepted: true });
      await tx.insert(s.prompts).values({ id: m.promptId, clientId: m.clientId, text: productionPilotPrompt, source: "manual", accepted: true });
    });
  }
  const state = await withProductionBudget(m, state => {
    if (state.phase === "pilot" && state.ledger.entries.some(e => e.state === "reserved"))
      state.ledger.stopped ||= "UNRESOLVED_RESTART";
    if (state.phase === "pilot" && Date.now() >= Date.parse(state.expiresAt)) state.ledger.stopped ||= "EXPIRED";
    state.instanceId = productionInstanceId;
    return state;
  });
  applyProductionState(m, state);
  if (state.phase !== "pilot" || state.ledger.stopped) {
    await db.update(s.users).set({ status: "disabled", sessionEpoch: sql`${s.users.sessionEpoch} + 1` }).where(eq(s.users.id, m.operatorId));
  } else {
    const expiry = setTimeout(() => {
      void withProductionBudget(m, async (current, tx) => {
        if (current.phase !== "pilot") return;
        current.phase = "closed"; current.ledger.stopped ||= "EXPIRED";
        await tx.update(s.users).set({ status: "disabled", sessionEpoch: sql`${s.users.sessionEpoch} + 1` })
          .where(eq(s.users.id, m.operatorId));
        return current;
      }).then(current => { if (current) applyProductionState(m, current); })
        .catch(() => console.error("[R1A production pilot] expiry cleanup failed; transport expiry remains enforced"));
    }, Math.max(1, Date.parse(state.expiresAt) - Date.now()));
    expiry.unref();
  }
  console.log(`[R1A production pilot] initialized phase=${state.phase}; stopped=${!!state.ledger.stopped}`);
}

export async function executeWithProductionBudget<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const m = productionManifest();
  if (!m) return productionPilotContext.exit(work);
  const [run] = await db.select().from(s.promptRuns).where(eq(s.promptRuns.id, runId));
  if (!run || (run.clientId !== m.clientId && run.createdBy !== m.operatorId)) return productionPilotContext.exit(work);
  await withProductionBudget(m, async (state, tx) => {
    checkProductionWindow(state); await checkProductionOperator(m, tx);
    if (run.clientId !== m.clientId || run.createdBy !== m.operatorId || run.totalPrompts !== 1)
      throw new PilotBudgetError("PRODUCTION_SCOPE_MISMATCH");
    const items = await tx.select({ model: s.aiModels.model, vendor: s.aiModels.vendor, prompt: s.prompts.text,
      promptId: s.prompts.id, enabled: s.aiModels.enabled }).from(s.promptRunItems)
      .innerJoin(s.aiModels, eq(s.aiModels.id, s.promptRunItems.modelId))
      .innerJoin(s.prompts, eq(s.prompts.id, s.promptRunItems.promptId))
      .where(eq(s.promptRunItems.promptRunId, runId));
    if (items.length !== 1 || items[0].promptId !== m.promptId ||
        items[0].prompt !== productionPilotPrompt || !items[0].enabled) throw new PilotBudgetError("PRODUCTION_SCOPE_MISMATCH");
    const provider = items[0].model === productionModels.openai ? "openai"
      : items[0].model === productionModels.anthropic ? "anthropic" : null;
    if (!provider) throw new PilotBudgetError("UNAPPROVED_MODEL");
    if (items[0].vendor.toLowerCase() !== provider) throw new PilotBudgetError("UNAPPROVED_MODEL");
    if (state.cases.some(c => c.runId === runId)) return; // Never resets reservations on resume.
    const index = state.cases.length;
    const expectedProvider = index < 3 ? "openai" : "anthropic";
    const search = run.searchConfig?.webSearch.enabled === true;
    if (index >= 6 || provider !== expectedProvider || search !== (index % 3 !== 2))
      throw new PilotBudgetError("PRODUCTION_CASE_ORDER");
    for (const previous of state.cases) {
      const [saved] = await tx.select().from(s.promptRuns).where(eq(s.promptRuns.id, previous.runId));
      if (saved?.status !== "done" || saved.deliverablesStatus !== "ready" || saved.deliverablesErrorSummary)
        throw new PilotBudgetError("PREVIOUS_PRODUCTION_CASE_FAILED");
    }
    state.cases.push({ runId, provider, search });
  });
  return productionPilotContext.run({ approvalRef: m.approvalRef, runId }, work);
}
