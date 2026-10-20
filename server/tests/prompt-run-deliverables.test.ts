process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";

import { openaiService } from "../openai-service";
import {
  DeliverablesAlreadyGeneratingError,
  finalizePromptRunDeliverables,
  TARGET_CONTENT_DRAFTS,
} from "../services/prompt-run-deliverables";

function createStorage() {
  const writes: Array<Record<string, unknown>> = [];
  const recommendations: any[] = [];
  const contents: any[] = [];
  let deliverablesStatus = "pending";

  const storage = {
    claimPromptRunDeliverables: async () => {
      if (deliverablesStatus === "generating") return false;
      deliverablesStatus = "generating";
      return true;
    },
    updatePromptRun: async (_id: string, patch: Record<string, unknown>) => {
      writes.push(patch);
      if (typeof patch.deliverablesStatus === "string") {
        deliverablesStatus = patch.deliverablesStatus;
      }
      return patch;
    },
    getRecommendations: async () => ({ recommendations, generatedAt: null }),
    saveRecommendations: async (_clientId: string, _runId: string, rows: any[]) => {
      recommendations.push(...rows);
    },
    getGeneratedContents: async () => contents,
    saveGeneratedContents: async (_clientId: string, _runId: string, rows: any[]) => {
      contents.push(...rows);
    },
  } as any;

  return { storage, writes, recommendations, contents };
}

test("prompt-run deliverables finalize and retry only missing drafts", async () => {
  const originalRecommendations = openaiService.generateRecommendations;
  const originalContent = openaiService.generateOptimizedContent;

  try {
    const state = createStorage();
    let draftCalls = 0;
    openaiService.generateRecommendations = async () => [{
      title: "Recommendation",
      description: "Description",
      severity: "medium",
      category: "Content Visibility",
      source: "ai_analysis",
    }];
    openaiService.generateOptimizedContent = async () => {
      draftCalls += 1;
      return [{
        citationSource: "example.com",
        topic: `Draft ${draftCalls}`,
        content: "x".repeat(500),
        format: "Article",
      }];
    };

    const result = await finalizePromptRunDeliverables({
      storage: state.storage,
      clientId: "client-1",
      promptRunId: "run-1",
    });

    assert.equal(result.status, "ready");
    assert.equal(result.contentCount, TARGET_CONTENT_DRAFTS);
    assert.equal(draftCalls, TARGET_CONTENT_DRAFTS);
    assert.equal(state.recommendations.length, 1);
    assert.equal(state.writes.at(-1)?.deliverablesStatus, "ready");

    await finalizePromptRunDeliverables({
      storage: state.storage,
      clientId: "client-1",
      promptRunId: "run-1",
    });
    assert.equal(draftCalls, TARGET_CONTENT_DRAFTS);
    assert.equal(state.recommendations.length, 1);
  } finally {
    openaiService.generateRecommendations = originalRecommendations;
    openaiService.generateOptimizedContent = originalContent;
  }
});

test("only one concurrent finalization can claim a prompt run", async () => {
  const originalRecommendations = openaiService.generateRecommendations;
  const originalContent = openaiService.generateOptimizedContent;

  try {
    const state = createStorage();
    let draftCalls = 0;
    openaiService.generateRecommendations = async () => [{
      title: "Recommendation",
      description: "Description",
      severity: "medium",
      category: "Content Visibility",
      source: "citation",
    }];
    openaiService.generateOptimizedContent = async () => {
      draftCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{
        citationSource: "example.com",
        topic: `Draft ${draftCalls}`,
        content: "x".repeat(500),
        format: "Article",
      }];
    };

    const attempts = await Promise.allSettled([
      finalizePromptRunDeliverables({
        storage: state.storage,
        clientId: "client-1",
        promptRunId: "run-1",
      }),
      finalizePromptRunDeliverables({
        storage: state.storage,
        clientId: "client-1",
        promptRunId: "run-1",
      }),
    ]);

    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    const rejected = attempts.find(result => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof DeliverablesAlreadyGeneratingError);
    assert.equal(state.contents.length, TARGET_CONTENT_DRAFTS);
    assert.equal(state.recommendations.length, 1);
  } finally {
    openaiService.generateRecommendations = originalRecommendations;
    openaiService.generateOptimizedContent = originalContent;
  }
});

test("prompt-run deliverable failures are persisted separately from run status", async () => {
  const originalRecommendations = openaiService.generateRecommendations;
  const originalContent = openaiService.generateOptimizedContent;

  try {
    const state = createStorage();
    openaiService.generateRecommendations = async () => [{
      title: "Recommendation",
      description: "Description",
      severity: "medium",
      category: "Content Visibility",
      source: "ai_analysis",
    }];
    openaiService.generateOptimizedContent = async () => {
      throw new Error("Content response was incomplete (length)");
    };

    const result = await finalizePromptRunDeliverables({
      storage: state.storage,
      clientId: "client-1",
      promptRunId: "run-1",
    });

    assert.equal(result.status, "needs_attention");
    assert.match(result.errors[0], /incomplete/);
    assert.equal(state.writes.at(-1)?.deliverablesStatus, "needs_attention");
    assert.equal("status" in (state.writes.at(-1) || {}), false);
  } finally {
    openaiService.generateRecommendations = originalRecommendations;
    openaiService.generateOptimizedContent = originalContent;
  }
});