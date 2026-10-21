import { createSearchConfig, type SearchConfig } from "../../../shared/native-web-search";
import { getSearchEligibility, getSearchApproval, getValidationCohort, loadSearchPolicy, type EligibilityActor, type EligibilityModel } from "./policy";

export interface AdmissionModel extends EligibilityModel { id: string }

/** Pure admission: called only after existing tenant/prompt/model access checks. */
export function admitNativeSearch(enabled: boolean, models: AdmissionModel[], actor: EligibilityActor,
  policy = loadSearchPolicy()): SearchConfig {
  const config = createSearchConfig(enabled);
  if (!enabled) return config;
  const blocked = models.map(model => ({ modelId: model.id,
    ...getSearchEligibility(model, policy, actor) })).filter(result => !result.eligible);
  if (blocked.length) {
    const error = new Error(blocked.map(b => `${b.modelId}: ${b.message}`).join("; "));
    Object.assign(error, { blocked });
    throw error;
  }
  return { ...config,
    models: Object.fromEntries(models.map(m => [m.id, { vendor: m.vendor, model: m.model }])),
    actor: { userId: actor.userId, tenantId: actor.tenantId, validation: actor.validation === true },
    validationApprovals: Array.from(new Set(models.filter(m => !getSearchApproval(m, policy))
      .map(m => getValidationCohort(m, policy, actor)?.approvalRef).filter((ref): ref is string => !!ref))),
  };
}
