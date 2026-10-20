type CatalogModel = {
  vendor?: string | null;
  model?: string | null;
  displayName?: string | null;
};

const VENDOR_PRIORITY: Record<string, number> = {
  OpenAI: 0,
  Anthropic: 1,
  Google: 2,
  Perplexity: 3,
};

// Newest/current models first within each vendor. Explicit priorities avoid
// lexical mistakes such as sorting 5.6 below 5.4 or Lite above Pro.
const MODEL_PRIORITY = [
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-sonnet-4-5",
  "claude-opus-4-1",
  "claude-3-5-haiku-20241022",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-pro",
  "sonar-pro",
  "sonar-reasoning",
  "sonar",
] as const;

const MODEL_PRIORITY_INDEX = new Map<string, number>(
  MODEL_PRIORITY.map((model, index) => [model, index]),
);

export function compareCatalogModels(a: CatalogModel, b: CatalogModel): number {
  const vendorA = VENDOR_PRIORITY[a.vendor ?? ""] ?? Number.MAX_SAFE_INTEGER;
  const vendorB = VENDOR_PRIORITY[b.vendor ?? ""] ?? Number.MAX_SAFE_INTEGER;
  if (vendorA !== vendorB) return vendorA - vendorB;

  const modelA = MODEL_PRIORITY_INDEX.get(a.model ?? "") ?? Number.MAX_SAFE_INTEGER;
  const modelB = MODEL_PRIORITY_INDEX.get(b.model ?? "") ?? Number.MAX_SAFE_INTEGER;
  if (modelA !== modelB) return modelA - modelB;

  return (a.displayName ?? "").localeCompare(b.displayName ?? "");
}