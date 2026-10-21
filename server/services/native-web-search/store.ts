import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, or, isNull, lt, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  promptRunItemExecutions as executions, promptRuns, promptRunItems,
  answers, citations, mentions, rankings, scoreFactors,
  nativeSearchValidationReservations as reservations,
} from "../../../shared/schema";
import { validateGeneration, type NativeGeneration } from "../../../shared/native-web-search";
import type { AttemptLedger } from "./runtime";
import type { IStorage } from "../../storage";
import type { SearchConfig } from "../../../shared/native-web-search";
import { loadSearchPolicy } from "./policy";

export class NativeOwnershipError extends Error {
  constructor() { super("Native execution ownership changed; stale work was not committed."); }
}
type Execution = typeof executions.$inferSelect;
const active = ["running", "scoring", "queued_for_benchmarking", "benchmarking"] as const;

/** Short DB transactions only. No provider or scoring calls inside a transaction. */
export class NativeSearchStore {
  constructor(private database = db) {}

  async reserveValidation(config: SearchConfig, runId: string, totalItems: number) {
    const refs = [...(config.validationApprovals ?? [])].sort();
    if (!refs.length) return;
    const policy = loadSearchPolicy();
    await this.database.transaction(async tx => {
      for (const ref of refs) {
        const cohort = policy.cohorts.find(c => c.approvalRef === ref &&
          c.operatorId === config.actor?.userId && c.tenantId === config.actor?.tenantId &&
          c.environment === policy.environment && c.accountRef === policy.accounts[c.provider] &&
          Date.parse(c.expiresAt) > Date.now());
        if (!cohort) throw new Error("Validation approval expired or changed.");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ref}))`);
        const [usage] = await tx.select({ count: sql<number>`coalesce(sum(${reservations.itemCount}),0)::int` })
          .from(reservations).where(eq(reservations.approvalRef, ref));
        if (usage.count + totalItems > cohort.maxItems) throw new Error("Approved validation item allowance is exhausted.");
        await tx.insert(reservations).values({ approvalRef: ref, runId, itemCount: totalItems });
      }
    });
  }
  async hasValidationReservation(runId: string, approvalRef: string): Promise<boolean> {
    const [row] = await this.database.select({ count: reservations.itemCount }).from(reservations)
      .where(and(eq(reservations.runId, runId), eq(reservations.approvalRef, approvalRef)));
    return !!row;
  }

  async claim(itemId: string, runId: string): Promise<Execution> {
    return this.database.transaction(async tx => {
      const [run] = await tx.select().from(promptRuns).where(eq(promptRuns.id, runId)).for("update");
      if (!run || !active.includes(run.status as typeof active[number])) throw new NativeOwnershipError();
      const [item] = await tx.select().from(promptRunItems).where(and(
        eq(promptRunItems.id, itemId), eq(promptRunItems.promptRunId, runId)));
      if (!item) throw new NativeOwnershipError();
      await tx.insert(executions).values({ itemId, runId }).onConflictDoNothing();
      const [row] = await tx.update(executions).set({
        claimToken: randomUUID(), leaseUntil: new Date(Date.now() + 90_000), updatedAt: new Date(),
      }).where(and(eq(executions.itemId, itemId), eq(executions.runId, runId),
        or(isNull(executions.leaseUntil), lt(executions.leaseUntil, new Date())))).returning();
      if (!row) throw new NativeOwnershipError();
      await tx.update(promptRunItems).set({
        status: row.phase === "scored" ? "queued_for_benchmarking" : "running",
        startedAt: item.startedAt ?? new Date(),
      }).where(eq(promptRunItems.id, itemId));
      return row;
    });
  }

  async renew(itemId: string, token: string): Promise<boolean> {
    const rows = await this.database.update(executions).set({
      leaseUntil: new Date(Date.now() + 90_000), updatedAt: new Date(),
    }).where(and(eq(executions.itemId, itemId), eq(executions.claimToken, token),
      gt(executions.leaseUntil, new Date()))).returning({ id: executions.itemId });
    return rows.length === 1;
  }

  async assertOwner(itemId: string, token: string): Promise<Execution> {
    const [row] = await this.database.select().from(executions).where(and(
      eq(executions.itemId, itemId), eq(executions.claimToken, token)));
    if (!row || !row.leaseUntil || row.leaseUntil.getTime() <= Date.now()) throw new NativeOwnershipError();
    return row;
  }

  async begin(itemId: string, token: string, deadlineAt: Date): Promise<void> {
    await this.write(itemId, token, { phase: "generating", deadlineAt });
  }
  async saveAttempt(itemId: string, token: string, ledger: AttemptLedger): Promise<void> {
    await this.write(itemId, token, { ledger });
  }
  async saveGeneration(itemId: string, token: string, generation: NativeGeneration): Promise<void> {
    const checked = validateGeneration(generation);
    const current = await this.assertOwner(itemId, token);
    if (current.evidence || current.answerText !== null) {
      if (current.answerText === checked.answerText &&
          isDeepStrictEqual(current.evidence, JSON.parse(JSON.stringify(checked.evidence)))) return;
      throw new Error("A saved native generation is immutable.");
    }
    // Control state deliberately not checked here: a response that finished during
    // pause/cancel still deserves a fenced durable save before unwinding.
    await this.write(itemId, token, {
      answerText: checked.answerText, evidence: checked.evidence,
      phase: checked.evidence.error ? "failed" : "generated",
    }, true);
  }
  async release(itemId: string, token: string): Promise<void> {
    await this.database.update(executions).set({ leaseUntil: null, claimToken: null })
      .where(and(eq(executions.itemId, itemId), eq(executions.claimToken, token)));
  }
  async finishFailure(itemId: string, token: string, error: string) {
    const owned = await this.assertOwner(itemId, token);
    await this.database.transaction(async tx => {
      const [run] = await tx.select().from(promptRuns).where(eq(promptRuns.id, owned.runId)).for("update");
      if (!run || !active.includes(run.status as typeof active[number])) throw new NativeOwnershipError();
      const [current] = await tx.select().from(executions).where(eq(executions.itemId, itemId)).for("update");
      if (current?.claimToken !== token || !current.leaseUntil || current.leaseUntil.getTime() <= Date.now()) throw new NativeOwnershipError();
      await tx.update(promptRunItems).set({ status: "error", error: error.slice(0, 1000), finishedAt: new Date() })
        .where(eq(promptRunItems.id, itemId));
    });
  }
  async completeRun(runId: string, patch: Partial<typeof promptRuns.$inferInsert>,
    claims: ReadonlyArray<{ itemId: string; token: string }> = []) {
    await this.database.transaction(async tx => {
      const [run] = await tx.select().from(promptRuns).where(eq(promptRuns.id, runId)).for("update");
      if (!run || !active.includes(run.status as typeof active[number])) return;
      for (const claim of claims) {
        const [owned] = await tx.select().from(executions).where(and(eq(executions.itemId, claim.itemId),
          eq(executions.runId, runId))).for("update");
        if (owned?.claimToken !== claim.token || !owned.leaseUntil || owned.leaseUntil.getTime() <= Date.now()) {
          throw new NativeOwnershipError();
        }
      }
      await tx.update(promptRuns).set(patch).where(eq(promptRuns.id, runId));
    });
  }
  private async write(itemId: string, token: string, patch: Partial<typeof executions.$inferInsert>, generationOnly = false) {
    await this.assertOwner(itemId, token);
    const rows = await this.database.update(executions).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(executions.itemId, itemId), eq(executions.claimToken, token),
        gt(executions.leaseUntil, new Date()),
        ...(generationOnly ? [isNull(executions.answerText), isNull(executions.evidence)] : [])))
      .returning({ id: executions.itemId });
    if (rows.length !== 1) throw new NativeOwnershipError();
  }

  async details(runId: string, itemId?: string) {
    return this.database.select({
      itemId: executions.itemId, phase: executions.phase, evidence: executions.evidence, answerText: executions.answerText,
    }).from(executions).where(itemId ? and(eq(executions.runId, runId), eq(executions.itemId, itemId)) :
      eq(executions.runId, runId));
  }

  /** Compute into an isolated write buffer, then atomically commit all derived facts. */
  async score(itemId: string, token: string, storage: IStorage,
    compute: (buffer: IStorage) => Promise<void>): Promise<void> {
    const execution = await this.assertOwner(itemId, token);
    if (execution.phase === "scored") return;
    if (!execution.answerText || !execution.evidence || execution.evidence.error) {
      throw new Error("Cannot score an incomplete native generation.");
    }
    await this.write(itemId, token, { phase: "scoring" });
    const staged = stageNativeScoring(storage, itemId, execution.answerText);
    await compute(staged.storage);
    await this.database.transaction(async tx => {
      const [run] = await tx.select().from(promptRuns).where(eq(promptRuns.id, execution.runId)).for("update");
      if (!run || !active.includes(run.status as typeof active[number])) throw new NativeOwnershipError();
      const [owned] = await tx.select().from(executions).where(eq(executions.itemId, itemId)).for("update");
      if (!owned || owned.claimToken !== token || !owned.leaseUntil || owned.leaseUntil.getTime() <= Date.now()) {
        throw new NativeOwnershipError();
      }
      if (owned.phase === "scored") return;
      // This owner creates exactly one canonical answer. Historical duplicates
      // outside native execution ownership are never removed.
      if (owned.canonicalAnswerId) throw new Error("Unexpected partial canonical scoring commit.");
      await tx.insert(answers).values(staged.answer());
      for (const row of staged.citations) await tx.insert(citations).values(row as typeof citations.$inferInsert);
      for (const row of staged.mentions) await tx.insert(mentions).values(row as typeof mentions.$inferInsert);
      for (const row of staged.rankings) await tx.insert(rankings).values(row as typeof rankings.$inferInsert);
      for (const row of staged.factors) await tx.insert(scoreFactors).values(row as typeof scoreFactors.$inferInsert);
      await tx.update(executions).set({ phase: "scored", canonicalAnswerId: staged.answer().id,
        updatedAt: new Date() }).where(eq(executions.itemId, itemId));
      await tx.update(promptRunItems).set({ status: "queued_for_benchmarking" }).where(eq(promptRunItems.id, itemId));
    });
  }
}

/** Only scoring's known writes are intercepted; unexpected writes fail explicitly. */
export function stageNativeScoring(base: IStorage, itemId: string, answerText: string) {
  let answer: typeof answers.$inferInsert | undefined;
  const citationRows: unknown[] = [], mentionRows: unknown[] = [], rankingRows: unknown[] = [], factors: unknown[] = [];
  const handlers: Record<string, (...args: any[]) => Promise<any>> = {
    updatePromptRunItem: async (id, patch) => {
      if (id !== itemId || patch.status !== "scoring") throw new Error("Unexpected scoring item update.");
      return { id, ...patch };
    },
    createAnswer: async data => {
      if (answer || data.promptRunItemId !== itemId || data.rawResponse !== answerText) throw new Error("Invalid canonical answer.");
      answer = { ...data, id: randomUUID() }; return answer;
    },
    updateAnswer: async (id, patch) => {
      const allowed = ["visibilityScore", "sentimentScore", "positionScore", "firstMentionPos", "citationCount"];
      if (!answer || answer.id !== id || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error("Invalid scoring answer update.");
      answer = { ...answer, ...patch }; return answer;
    },
    createCitation: async data => { checkAnswer(data); citationRows.push(data); return { ...data, id: randomUUID() }; },
    createMention: async data => { checkAnswer(data); mentionRows.push(data); return { ...data, id: randomUUID() }; },
    createRanking: async data => { checkAnswer(data); rankingRows.push(data); return { ...data, id: randomUUID() }; },
    createScoreFactors: async data => {
      if (data.promptRunItemId !== itemId) throw new Error("Score factors belong to a different item.");
      factors.push(data); return { ...data, id: randomUUID() };
    },
  };
  function checkAnswer(data: { answerId: string }) {
    if (!answer || data.answerId !== answer.id) throw new Error("Derived fact belongs to a different answer.");
  }
  const storage = new Proxy(base, { get(target, property) {
    if (typeof property === "string" && handlers[property]) return handlers[property];
    if (typeof property === "string" && /^(create|update|delete|save|set|upsert)/.test(property)) {
      return () => { throw new Error(`Unexpected native scoring write: ${property}`); };
    }
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { storage, citations: citationRows, mentions: mentionRows, rankings: rankingRows, factors,
    answer() { if (!answer) throw new Error("Scorer did not produce an answer."); return answer; } };
}
