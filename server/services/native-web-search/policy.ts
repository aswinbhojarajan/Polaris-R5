import { z } from "zod";
import { SEARCH_POLICY_VERSION, type SearchEligibility, type NativeProvider } from "../../../shared/native-web-search";
import { productionPilotPolicy } from "../pilot-budget/production-config";

/** Configuration contains approval references, never API credentials. All defaults fail closed. */
const approvalSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().min(1).max(200),
  tool: z.enum(["web_search", "web_search_20250305"]),
  environment: z.string().min(1).max(100),
  accountRef: z.string().min(1).max(100),
  validatedAt: z.string().datetime(),
  evidenceRef: z.string().min(1).max(200),
  actualModels: z.array(z.string().min(1).max(200)).max(8).default([]),
  openAiOffsetUnit: z.enum(["utf16", "codepoint"]).optional(),
}).strict();
const cohortSchema = z.object({
  environment: z.string().min(1).max(100), accountRef: z.string().min(1).max(100),
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200), operatorId: z.string().min(1).max(200),
  approvalRef: z.string().min(1).max(200),
  expiresAt: z.string().datetime(),
  maxItems: z.number().int().min(1).max(12),
  spendCeilingUsd: z.number().positive().max(100),
  // Pilot-only parsing policy is not a public validation approval.
  actualModels: z.array(z.string().min(1).max(200)).max(8).default([]),
  openAiOffsetUnit: z.enum(["utf16", "codepoint"]).optional(),
}).strict();
export type SearchApproval = z.infer<typeof approvalSchema>;
export type ValidationCohort = z.infer<typeof cohortSchema>;
export interface SearchPolicy {
  enabled: boolean;
  environment: string;
  providerEnabled: Record<NativeProvider, boolean>;
  accounts: Record<string, string>;
  approvals: SearchApproval[];
  cohorts: ValidationCohort[];
  valid: boolean;
}
function json<T>(value: string | undefined, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): T {
  return value === undefined ? fallback : schema.parse(JSON.parse(value));
}
export function loadSearchPolicy(env: NodeJS.ProcessEnv = process.env): SearchPolicy {
  const base = {
    enabled: env.POLARIS_NATIVE_WEB_SEARCH_ENABLED === "true",
    environment: env.POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT ?? "",
    providerEnabled: {
      openai: env.POLARIS_NATIVE_WEB_SEARCH_OPENAI_ENABLED === "true",
      anthropic: env.POLARIS_NATIVE_WEB_SEARCH_ANTHROPIC_ENABLED === "true",
      google: false, // Independent, non-overridable R1A terms gate.
    },
  };
  try {
    return { ...base,
      accounts: json(env.POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS,
        z.record(z.string().max(100)), {}),
      approvals: env.NODE_ENV === "production" && env.POLARIS_R1A_PRODUCTION_PILOT
        ? z.array(approvalSchema).parse(productionPilotPolicy().approvals)
        : json(env.POLARIS_NATIVE_WEB_SEARCH_APPROVALS, z.array(approvalSchema).max(100), []),
      cohorts: env.NODE_ENV === "production" && env.POLARIS_R1A_PRODUCTION_PILOT
        ? z.array(cohortSchema).parse(productionPilotPolicy().cohorts)
        : json(env.POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS,
          z.array(cohortSchema).max(12).refine(rows =>
            new Set(rows.map(row => row.approvalRef)).size === rows.length, "Validation approval references must be unique"), []), valid: true };
  } catch {
    // Never log raw configuration: approval refs may contain private account metadata.
    return { ...base, enabled: false, accounts: {}, approvals: [], cohorts: [], valid: false };
  }
}
export function resolveNativeProvider(vendor: string): NativeProvider | null {
  const v = vendor.toLowerCase();
  return v === "openai" || v === "anthropic" || v === "google" ? v : null;
}
const toolFor = (p: NativeProvider) => p === "openai" ? "web_search" :
  p === "anthropic" ? "web_search_20250305" : "google_search";
export interface EligibilityModel { vendor: string; model: string; enabled: boolean; internalOnly?: boolean }
export interface EligibilityActor {
  tenantId: string; userId: string; isAdmin: boolean;
  /** Must be explicitly selected by authorized server code, not a public boolean. */
  validation?: boolean;
  itemCount?: number;
}
export function getSearchApproval(model: EligibilityModel, policy: SearchPolicy): SearchApproval | undefined {
  const provider = resolveNativeProvider(model.vendor);
  return policy.approvals.find(a => a.provider === provider && a.model === model.model &&
    a.tool === toolFor(provider!) && a.environment === policy.environment &&
    a.accountRef === policy.accounts[provider!]);
}
export function getValidationCohort(model: EligibilityModel, policy: SearchPolicy,
  actor: EligibilityActor, now = Date.now()) {
  const provider = resolveNativeProvider(model.vendor);
  return actor.validation && actor.isAdmin ? policy.cohorts.find(c =>
    c.provider === provider && c.model === model.model && c.environment === policy.environment &&
    c.accountRef === policy.accounts[provider!] && c.tenantId === actor.tenantId &&
    c.operatorId === actor.userId && Date.parse(c.expiresAt) > now &&
    (actor.itemCount ?? Infinity) > 0 && (actor.itemCount ?? Infinity) <= c.maxItems) : undefined;
}
export function getSearchEligibility(model: EligibilityModel, policy: SearchPolicy,
  actor?: EligibilityActor, now = Date.now()): SearchEligibility {
  const reply = (eligible: boolean, reason: SearchEligibility["reason"], message: string): SearchEligibility =>
    ({ eligible, reason, message, policyVersion: SEARCH_POLICY_VERSION });
  const provider = resolveNativeProvider(model.vendor);
  if (!provider) return reply(false, "unsupported", "This provider is outside R1A native web search.");
  if (provider === "google") return reply(false, "terms_blocked",
    "Gemini grounding for scored diagnostics requires applicable written permission and model-identity approval.");
  if (!model.enabled) return reply(false, "temporarily_disabled", "The selected model is disabled.");
  if (model.internalOnly && !actor?.isAdmin) return reply(false, "permission_required", "Internal model access requires an administrator.");
  if (!policy.valid || !policy.enabled || !policy.providerEnabled[provider]) {
    return reply(false, "temporarily_disabled", "Native web search is not activated for this provider/environment.");
  }
  if (!policy.environment || !policy.accounts[provider]) {
    return reply(false, "permission_required", "An approved provider account/environment reference is required.");
  }
  if (getSearchApproval(model, policy)) return reply(true, "validated", "Exact model and tool validated for this account/environment.");
  const cohort = actor?.validation && actor.isAdmin && policy.cohorts.find(c =>
    c.provider === provider && c.model === model.model && c.environment === policy.environment &&
    c.accountRef === policy.accounts[provider] && c.tenantId === actor.tenantId &&
    c.operatorId === actor.userId && Date.parse(c.expiresAt) > now &&
    (actor.itemCount ?? Infinity) > 0 && (actor.itemCount ?? Infinity) <= c.maxItems);
  if (cohort) return reply(true, "unverified", "Approved internal validation only; not publicly search-validated.");
  return reply(false, "unverified", "This exact model/tool/account combination has not passed approved native-search validation.");
}

/** Metadata only; admission, durable reservation and dispatch checks still apply. */
export function getSearchExecutionPolicy(model: EligibilityModel, policy: SearchPolicy,
  actor: EligibilityActor) {
  if (!getSearchEligibility(model, policy, actor).eligible) return undefined;
  return getSearchApproval(model, policy) ?? getValidationCohort(model, policy, actor);
}
