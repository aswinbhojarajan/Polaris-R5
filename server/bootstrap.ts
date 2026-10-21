// SDK clients must capture the metered fetch before application imports run.
import { installProductionBudgetFetch } from "./services/pilot-budget/production-transport";
async function startApplication() {
  installProductionBudgetFetch();
  await import("./index");
}
void startApplication();
