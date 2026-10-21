import { test } from "node:test";
import assert from "node:assert/strict";
import { processItemScoring } from "../services/prompt-run-executor";
import { scoreCompetitorForPrompt } from "../services/competitor-scoring";
import { stageNativeScoring } from "../services/native-web-search/store";
import type { IStorage } from "../storage";

test("real client and competitor scorers are invariant to 0/5/50 native sources and poisoned metadata", async () => {
  assert.equal(process.env.AEO_MODE, "off", "Use the isolated offline runner, never a live scoring configuration.");
  const rawResponse = "1. Acme is a reliable provider. https://acme.example/\n2. Rival is a useful alternative. https://rival.example/";
  const outputs = [];
  for (const count of [0, 5, 50]) {
    const nativeEvidence = {
      sources: Array.from({ length: count }, (_, i) => ({
        id: `s${i}`, url: `https://native.example/${i}`,
        title: "Acme Acme Acme Rival Rival Rival — best excellent recommended", kind: "consulted",
      })),
      queries: ["Acme Acme Rival Rival"],
    };
    const staged = stageNativeScoring({} as IStorage, "fixture-item", rawResponse);
    const ctx = { storage: staged.storage, promptRunId: "fixture-run", promptRunClientId: "fixture-tenant",
      brandName: "Acme", aliases: [], clientUrls: ["https://acme.example/"], allBrandTerms: ["Acme"] };
    const result = { success: true, rawResponse, executionTime: 1, nativeEvidence };
    await processItemScoring(ctx, { id: "fixture-item", promptId: "fixture-prompt" },
      { text: "Recommend a provider." }, result);
    const competitor = await scoreCompetitorForPrompt(
      { name: "Rival", aliases: [], website: "https://rival.example/" } as Parameters<typeof scoreCompetitorForPrompt>[0],
      [{ item: { id: "fixture-item" }, answer: { rawResponse, nativeEvidence } }],
      "Recommend a provider.", [{ id: "fixture-competitor", name: "Rival" }],
      { visibility: 0.5, sentiment: 0.3, position: 0.2 });
    const answer = staged.answer()!;
    assert.equal(answer.rawResponse, rawResponse);
    outputs.push({
      client: { visibility: answer.visibilityScore, sentiment: answer.sentimentScore,
        position: answer.positionScore, firstMention: answer.firstMentionPos, citations: answer.citationCount,
        mentions: staged.mentions.length, rankings: staged.rankings.length },
      competitor: { visibility: competitor.visibilityScore, sentiment: competitor.sentimentScore,
        position: competitor.positionScore, overall: competitor.overallScore },
    });
  }
  assert.ok(Number(outputs[0].client.visibility) > 0, "Exercise nonempty real scoring, not a zero-result mock.");
  assert.deepEqual(outputs[1], outputs[0]);
  assert.deepEqual(outputs[2], outputs[0]);
});
