import type { IStorage } from "../../storage";
import type { AIExecutionResult } from "../ai-executor";
import type { BatchItem, BatchResult } from "../batch-executor";
import type { SearchConfig } from "../../../shared/native-web-search";
import { getUserRoleForClient } from "../../auth";
import { ensureVendorPauseLoaded, isVendorPaused } from "../../config/vendor-pause";
import { NativeSearchError, isControlSignal, failedGeneration } from "./common";
import { getSearchExecutionPolicy, getSearchEligibility, getValidationCohort, loadSearchPolicy, resolveNativeProvider } from "./policy";
import { executeNativeSearch } from "./runtime";
import { NativeSearchStore, NativeOwnershipError } from "./store";

const instructions = `You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order`;

/** One manager per run; claims stay renewed through the sibling barrier/scoring. */
export class NativeRunWorker {
  readonly store: NativeSearchStore;
  private claims = new Map<string, { token: string; timer: NodeJS.Timeout; lost: boolean }>();
  constructor(private storage: IStorage, private runId: string, private config: SearchConfig,
    private checkControl: () => void,
    private dependencies: {
      store?: NativeSearchStore;
      execute?: typeof executeNativeSearch;
      role?: typeof getUserRoleForClient;
      vendorPaused?: (vendor: string) => Promise<boolean>;
    } = {}) { this.store = dependencies.store ?? new NativeSearchStore(); }

  async execute(item: BatchItem): Promise<BatchResult> {
    const execution = await this.store.claim(item.id, this.runId);
    const token = execution.claimToken!;
    const claim = { token, timer: undefined as unknown as NodeJS.Timeout, lost: false };
    claim.timer = setInterval(() => {
      this.store.renew(item.id, token).then(ok => { if (!ok) claim.lost = true; })
        .catch(() => { claim.lost = true; });
    }, 25_000);
    claim.timer.unref?.();
    this.claims.set(item.id, claim);
    const control = () => {
      this.checkControl();
      if (claim.lost) throw new NativeOwnershipError();
      const provider = resolveNativeProvider(this.config.models?.[item.modelId]?.vendor ?? "");
      const policy = loadSearchPolicy();
      if (!policy.valid || !policy.enabled || !provider || !policy.providerEnabled[provider]) {
        throw new NativeSearchError("SEARCH_DISABLED", "Native web search was disabled; the request was not downgraded.");
      }
    };
    const reply = (rawResponse: string, error?: string): BatchResult => ({
      itemId: item.id, success: !error, retries: 0,
      result: { rawResponse, ...(error ? { error } : {}) }, error,
    });
    // A saved failure/answer is terminal generation work, even after recovery.
    if (execution.evidence?.error) return reply("", execution.evidence.error.message);
    if (execution.answerText !== null) return reply(execution.answerText);
    const snapshot = this.config.models?.[item.modelId];
    const provider = snapshot && resolveNativeProvider(snapshot.vendor);
    if (!snapshot || !provider || !this.config.actor) {
      throw new NativeSearchError("MISSING_ADMISSION", "Native run is missing its immutable admission configuration.");
    }
    const deadlineAt = execution.deadlineAt ?? new Date(Date.now() + this.config.webSearch.itemDeadlineMs);
    if (execution.ledger.attemptCount > 0) {
      // No transcript survives an interrupted provider request. Do not blindly
      // repeat a potentially paid, successful-but-uncommitted generation.
      const failure = failedGeneration({ provider, model: snapshot.model,
        attempts: execution.ledger.attemptCount, continuations: execution.ledger.continuationCount },
      new NativeSearchError("INDETERMINATE_GENERATION", "Interrupted generation outcome is unknown; no automatic paid replay."));
      await this.store.saveGeneration(item.id, token, failure);
      return reply("", failure.evidence.error!.message);
    }
    await this.store.begin(item.id, token, deadlineAt);
    const assertEligible = async () => {
      control();
      const run = await this.storage.getPromptRun(this.runId);
      if (!run || run.status === "cancelled") throw new Error("Job cancelled");
      if (run.status === "paused") throw new Error("Job paused");
      if (run.status === "error") throw new Error("Run halted by admin disable");
      const actor = this.config.actor!;
      const role = await (this.dependencies.role ?? getUserRoleForClient)(actor.userId, actor.tenantId);
      if (!role || role === "viewer") throw new NativeSearchError("ACCESS_REVOKED", "Run owner no longer has execution access.");
      const model = await this.storage.getAiModel(item.modelId);
      if (!model || model.model !== snapshot.model || model.vendor !== snapshot.vendor) {
        throw new NativeSearchError("MODEL_CHANGED", "Selected model identity changed after admission.");
      }
      let vendorPaused: boolean;
      if (this.dependencies.vendorPaused) vendorPaused = await this.dependencies.vendorPaused(model.vendor);
      else { await ensureVendorPauseLoaded(); vendorPaused = isVendorPaused(model.vendor); }
      if (vendorPaused) throw new Error("Run halted by admin disable");
      const policy = loadSearchPolicy();
      const eligibilityActor = {
        tenantId: actor.tenantId, userId: actor.userId, isAdmin: role === "admin",
        validation: actor.validation, itemCount: run.totalPrompts,
      };
      const eligibility = getSearchEligibility(model, policy, eligibilityActor);
      if (!eligibility.eligible) throw new NativeSearchError("SEARCH_POLICY_CHANGED", eligibility.message);
      if (eligibility.reason === "unverified") {
        const cohort = getValidationCohort(model, policy, eligibilityActor);
        if (!cohort || !this.config.validationApprovals?.includes(cohort.approvalRef) ||
            !(await this.store.hasValidationReservation(this.runId, cohort.approvalRef))) {
          throw new NativeSearchError("VALIDATION_NOT_RESERVED", "No applicable durable validation allowance exists for this run.");
        }
      }
      await this.store.assertOwner(item.id, token);
    };
    const actor = this.config.actor;
    const role = await (this.dependencies.role ?? getUserRoleForClient)(actor.userId, actor.tenantId);
    const run = await this.storage.getPromptRun(this.runId);
    const executionPolicy = getSearchExecutionPolicy({ ...snapshot, enabled: true }, loadSearchPolicy(), {
      ...actor, isAdmin: role === "admin", itemCount: run?.totalPrompts,
    });
    const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : provider === "anthropic" ?
      process.env.ANTHROPIC_API_KEY : undefined;
    const generation = await (this.dependencies.execute ?? executeNativeSearch)({
      provider, model: snapshot.model, prompt: item.promptText, instructions, apiKey: apiKey ?? "",
      assertEligible, checkControl: control,
      saveAttempt: ledger => this.store.saveAttempt(item.id, token, ledger),
      ledger: execution.ledger, deadlineAt: deadlineAt.getTime(), maxRetries: this.config.webSearch.maxRetries,
      actualModels: executionPolicy?.actualModels ?? [], openAiOffsetUnit: executionPolicy?.openAiOffsetUnit,
    });
    // Mandatory save happens HERE, before returning to Promise.allSettled and
    // before the batch's pause/cancel check or scoring callback.
    await this.store.saveGeneration(item.id, token, generation);
    return reply(generation.answerText ?? "", generation.evidence.error?.message);
  }

  async score(itemId: string, compute: (storage: IStorage) => Promise<void>) {
    const claim = this.claims.get(itemId);
    if (!claim || claim.lost) throw new NativeOwnershipError();
    this.checkControl();
    await this.store.score(itemId, claim.token, this.storage, compute);
  }
  async owns(itemId: string) {
    const claim = this.claims.get(itemId);
    if (!claim || claim.lost) return false;
    await this.store.assertOwner(itemId, claim.token);
    return true;
  }
  async fail(itemId: string, error: string) {
    const claim = this.claims.get(itemId);
    if (!claim || claim.lost) throw new NativeOwnershipError();
    await this.store.finishFailure(itemId, claim.token, error);
  }
  async complete(patch: Parameters<NativeSearchStore["completeRun"]>[1]) {
    const claims = Array.from(this.claims, ([itemId, claim]) => {
      if (claim.lost) throw new NativeOwnershipError();
      return { itemId, token: claim.token };
    });
    await this.store.completeRun(this.runId, patch, claims);
  }
  async close() {
    await Promise.all(Array.from(this.claims).map(async ([itemId, claim]) => {
      clearInterval(claim.timer);
      await this.store.release(itemId, claim.token).catch(() => {});
    }));
    this.claims.clear();
  }
}
