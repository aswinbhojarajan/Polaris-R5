import { LLM_FUNCTIONS } from "./llm-functions";

const parseTemperature = (value: string | undefined): number => {
  const parsed = parseFloat(value || "0.7");
  return Number.isFinite(parsed) ? parsed : 0.7;
};

const parseRetention = (value: string | undefined): number => {
  const parsed = parseInt(value || "5", 10);
  return Number.isFinite(parsed) ? parsed : 5;
};

const AI_TEMPERATURE = parseTemperature(process.env.REPORT_AI_TEMPERATURE);
const MAX_RETENTION = parseRetention(process.env.REPORT_MAX_RETENTION);
const ENABLED = process.env.ENABLE_REPORTING === "true";

// Task #77 — `AI_MODEL` is exposed as a getter so each read goes through the
// `LLM_FUNCTIONS` proxy and picks up DB overrides without a restart.
// `narrative-generator.ts` reads `REPORTING_CONFIG.AI_MODEL` per call, so a
// getter makes the override live for every two-pass narrative generation.
export const REPORTING_CONFIG = Object.freeze({
  get AI_MODEL(): string {
    return LLM_FUNCTIONS.narrativeReport;
  },
  AI_TEMPERATURE,
  MAX_RETENTION,
  ENABLED,
});

export function getReportingConfig() {
  return {
    aiModel: REPORTING_CONFIG.AI_MODEL,
    aiTemperature: REPORTING_CONFIG.AI_TEMPERATURE,
    maxRetention: REPORTING_CONFIG.MAX_RETENTION,
    enabled: REPORTING_CONFIG.ENABLED,
  };
}

export function validateReportingConfig(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (
    REPORTING_CONFIG.AI_TEMPERATURE < 0 ||
    REPORTING_CONFIG.AI_TEMPERATURE > 2
  ) {
    errors.push("REPORT_AI_TEMPERATURE must be between 0 and 2");
  }

  if (REPORTING_CONFIG.MAX_RETENTION < 1) {
    errors.push("REPORT_MAX_RETENTION must be at least 1");
  }

  // Support all OpenAI models flexibly - validate by prefix
  // The openai-compat utility handles max_tokens vs max_completion_tokens automatically
  const validModelPrefixes = ["gpt-4", "gpt-3.5", "gpt-5", "o1", "o3", "o4"];
  const isValidModel = validModelPrefixes.some((prefix) =>
    REPORTING_CONFIG.AI_MODEL.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  if (!isValidModel) {
    errors.push(
      `REPORT_AI_MODEL must start with one of: ${validModelPrefixes.join(", ")}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
