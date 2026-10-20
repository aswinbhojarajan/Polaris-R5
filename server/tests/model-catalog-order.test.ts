import test from "node:test";
import assert from "node:assert/strict";
import { compareCatalogModels } from "../../client/src/lib/model-catalog-order";

test("orders catalog by vendor and current model priority", () => {
  const models = [
    { vendor: "Google", model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
    { vendor: "OpenAI", model: "gpt-5.2", displayName: "GPT-5.2" },
    { vendor: "Anthropic", model: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
    { vendor: "Google", model: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
    { vendor: "OpenAI", model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
    { vendor: "Anthropic", model: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
    { vendor: "Perplexity", model: "sonar-pro", displayName: "Sonar Pro" },
  ];

  assert.deepEqual(
    models.sort(compareCatalogModels).map((model) => model.model),
    [
      "gpt-5.6-luna",
      "gpt-5.2",
      "claude-sonnet-5",
      "claude-sonnet-4-5",
      "gemini-3.7-flash",
      "gemini-2.5-flash",
      "sonar-pro",
    ],
  );
});