import { eq, sql } from "drizzle-orm";
import * as s from "../../../shared/schema";
import { validateGeneration, type SearchEvidence } from "../../../shared/native-web-search";
import { getSearchEligibility, loadSearchPolicy, type SearchApproval } from "../native-web-search/policy";
import { PilotBudgetError } from "./guard";
import type { ProductionManifest } from "./production-config";
import { applyProductionState, productionModels } from "./production-runtime";
import { checkProductionOperator, checkProductionWindow, withProductionBudget } from "./production-store";

/** Public approvals come from completed PRODUCTION evidence, never copied dev
 * records. The release operator must supply the final real-browser audit ref. */
export async function activateProductionPilot(m: ProductionManifest, browserAcceptanceRef: string) {
  if (!/^[a-zA-Z0-9_./:-]{1,200}$/.test(browserAcceptanceRef))
    throw new PilotBudgetError("BROWSER_ACCEPTANCE_REQUIRED");
  const state = await withProductionBudget(m, async (state, tx) => {
    checkProductionWindow(state); await checkProductionOperator(m, tx);
    if (state.cases.length !== 6 || !state.ledger.entries.length ||
        state.ledger.entries.some(e => e.state !== "settled")) throw new PilotBudgetError("INCOMPLETE_PRODUCTION_MATRIX");
    const observed = { openai: new Set<string>(), anthropic: new Set<string>() };
    const invoked = { openai: false, anthropic: false };
    for (let index = 0; index < state.cases.length; index++) {
      const item = state.cases[index];
      if (item.provider !== (index < 3 ? "openai" : "anthropic") || item.search !== (index % 3 !== 2))
        throw new PilotBudgetError("INVALID_PRODUCTION_MATRIX");
      const [run] = await tx.select().from(s.promptRuns).where(eq(s.promptRuns.id, item.runId));
      const primary = state.ledger.entries.filter(e => e.runId === item.runId && e.model === productionModels[item.provider]);
      if (!run || run.clientId !== m.clientId || run.createdBy !== m.operatorId ||
          run.status !== "done" || run.deliverablesStatus !== "ready" || run.deliverablesErrorSummary ||
          !primary.length || primary.some(e => (e.searchUseCeiling > 0) !== item.search) ||
          !state.ledger.entries.some(e => e.runId === item.runId && e.model === "gpt-4o-mini") ||
          !state.ledger.entries.some(e => e.runId === item.runId && e.model === "gpt-5.4"))
        throw new PilotBudgetError("PRODUCTION_PIPELINE_NOT_VERIFIED");
      const rows = await tx.select({ item: s.promptRunItems, model: s.aiModels })
        .from(s.promptRunItems).innerJoin(s.aiModels, eq(s.aiModels.id, s.promptRunItems.modelId))
        .where(eq(s.promptRunItems.promptRunId, item.runId));
      if (rows.length !== 1 || rows[0].item.promptId !== m.promptId ||
          rows[0].model.model !== productionModels[item.provider] || !rows[0].model.enabled ||
          rows[0].model.vendor.toLowerCase() !== item.provider)
        throw new PilotBudgetError("PRODUCTION_IDENTITY_MISMATCH");
      if (!item.search) {
        if (run.searchConfig?.webSearch.enabled) throw new PilotBudgetError("OFF_CONTROL_CHANGED");
        continue;
      }
      const [execution] = await tx.select().from(s.promptRunItemExecutions)
        .where(eq(s.promptRunItemExecutions.itemId, rows[0].item.id));
      const [answer] = await tx.select().from(s.answers)
        .where(eq(s.answers.id, execution?.canonicalAnswerId ?? ""));
      if (!execution || execution.phase !== "scored" || !answer || answer.rawResponse !== execution.answerText)
        throw new PilotBudgetError("CANONICAL_NATIVE_ANSWER_MISSING");
      const evidence = validateGeneration({ answerText: answer.rawResponse,
        evidence: execution.evidence as SearchEvidence }).evidence;
      if (evidence.error || evidence.provider !== item.provider ||
          evidence.requestedModel !== productionModels[item.provider] || !evidence.actualModel)
        throw new PilotBudgetError("PRODUCTION_EVIDENCE_INVALID");
      if (item.provider === "openai" && !answer.rawResponse.startsWith("🧭"))
        throw new PilotBudgetError("PRODUCTION_UNICODE_PROBE_MISSING");
      if (item.provider === "openai" && evidence.invocationStatus === "invoked" &&
          (!evidence.citations.length || evidence.citations.some(citation =>
            citation.association !== "span" || citation.providerLocator.unit !== "codepoint")))
        throw new PilotBudgetError("PRODUCTION_UNICODE_POLICY_UNVERIFIED");
      observed[item.provider].add(evidence.actualModel);
      if (evidence.invocationStatus === "invoked" && evidence.citations.length &&
          evidence.sources.some(source => source.kind === "cited")) invoked[item.provider] = true;
    }
    if (!invoked.openai || !invoked.anthropic) throw new PilotBudgetError("PRODUCTION_INVOCATION_NOT_OBSERVED");
    state.approvals = (["openai", "anthropic"] as const).map(provider => ({
      provider, model: productionModels[provider],
      tool: provider === "openai" ? "web_search" : "web_search_20250305",
      environment: "production", accountRef: m.accountRefs[provider],
      validatedAt: new Date().toISOString(), evidenceRef: `production:${m.approvalRef}`,
      actualModels: Array.from(observed[provider]),
      ...(provider === "openai" ? { openAiOffsetUnit: "codepoint" } : {}),
    } satisfies SearchApproval));
    state.phase = "active"; state.browserAcceptanceRef = browserAcceptanceRef;
    state.ledger.stopped = "PILOT_COMPLETE";
    await tx.update(s.users).set({ status: "disabled", sessionEpoch: sql`${s.users.sessionEpoch} + 1` })
      .where(eq(s.users.id, m.operatorId));
    return state;
  });
  applyProductionState(m, state);
  const policy = loadSearchPolicy();
  return { state, publicEligibility: (["openai", "anthropic"] as const).map(provider => ({
    provider, eligible: getSearchEligibility({ vendor: provider, model: productionModels[provider], enabled: true }, policy).eligible,
  })) };
}
