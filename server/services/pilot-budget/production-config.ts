import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { SearchApproval, ValidationCohort } from "../native-web-search/policy";
import { PilotBudgetError } from "./guard";
import { randomUUID } from "node:crypto";

export const productionManifestSchema = z.object({
  version: z.literal(1),
  approvalRef: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  budgetUsd: z.number().positive().max(50),
  durationSeconds: z.literal(3600),
  orgId: z.string().uuid(), operatorId: z.string().uuid(), clientId: z.string().uuid(),
  promptId: z.string().uuid(),
  operatorEmail: z.string().email().endsWith("@pilot.invalid"),
  accountRefs: z.object({ openai: z.string().min(1).max(100), anthropic: z.string().min(1).max(100) }).strict(),
}).strict();
export type ProductionManifest = z.infer<typeof productionManifestSchema>;
export const productionInstanceId = randomUUID();
export const productionPilotContext = new AsyncLocalStorage<{ approvalRef: string; runId: string }>();
let cachedPolicy: { approvals: SearchApproval[]; cohorts: ValidationCohort[] } = { approvals: [], cohorts: [] };
export const productionPilotPolicy = () => cachedPolicy;
export function setProductionPilotPolicy(policy: typeof cachedPolicy) { cachedPolicy = policy; }
export function productionManifest(): ProductionManifest | undefined {
  if (process.env.NODE_ENV !== "production" || !process.env.POLARIS_R1A_PRODUCTION_PILOT) return;
  try { return productionManifestSchema.parse(JSON.parse(process.env.POLARIS_R1A_PRODUCTION_PILOT)); }
  catch { throw new PilotBudgetError("INVALID_PRODUCTION_MANIFEST"); }
}
export const productionPilotPrompt =
  "Check Mozilla's official release notes. What is the current stable Firefox version and release date at the time of your answer? " +
  'Answer in English. Start your answer with the literal marker "🧭 " exactly once, so citation positions can be checked. ' +
  "Finish with a short Sources section listing the literal official URLs. Do not invent facts or citations.";
