import type { Express, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { nativeSearchPilotBudgets } from "../../shared/schema";
import { productionManifest, productionPilotContext, setProductionPilotPolicy } from "../services/pilot-budget/production-config";
import { productionHash, productionStateSchema, accountedMicros, checkProductionOperator,
  closeProduction } from "../services/pilot-budget/production-store";
import { activateProductionPilot } from "../services/pilot-budget/production-activation";

/** Prevent the delegated operator from using other billable app journeys.
 * Existing auth + tenant + CSRF middleware still apply; this grants no auth. */
export const productionPilotFence: RequestHandler = (req, res, next) => {
  try {
    const m = productionManifest();
    if (!m || req.user?.id !== m.operatorId) return next();
    // Any accidental billable HTTP helper (including a GET) is denied by the
    // transport. Only the worker can replace this sentinel with an admitted run.
    const scopedNext = () => productionPilotContext.run({ approvalRef: m.approvalRef, runId: "unapproved-http" }, () => next());
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return scopedNext();
    const path = req.originalUrl.split("?")[0];
    if (req.method === "POST" && (
      /^\/api\/v1\/prompt-runs\/?$/.test(path) ||
      /^\/api\/v1\/prompt-runs\/[^/]+\/(pause|resume|cancel)$/.test(path) ||
      /^\/api\/v1\/internal\/r1a-pilot\/(activate|close)$/.test(path) ||
      /^\/api\/v1\/auth\/(login|logout)$/.test(path))) return scopedNext();
    res.status(403).json({ error: { code: "pilot_scope", message: "Production pilot operator is restricted to the approved run matrix." } });
  } catch { res.status(503).json({ error: { code: "pilot_unavailable", message: "Production pilot configuration is invalid." } }); }
};

export function registerProductionPilotRoutes(app: Express) {
  const authorize: RequestHandler = async (req, res, next) => {
    try {
      const m = productionManifest();
      if (!m || req.user?.id !== m.operatorId) { res.sendStatus(403); return; }
      await checkProductionOperator(m, db);
      next();
    } catch { res.sendStatus(403); }
  };
  app.get("/api/v1/internal/r1a-pilot", authorize, async (_req, res, next) => {
    try {
      const m = productionManifest()!;
      const [row] = await db.select().from(nativeSearchPilotBudgets)
        .where(eq(nativeSearchPilotBudgets.approvalRef, m.approvalRef));
      if (!row || row.manifestHash !== productionHash(m)) { res.sendStatus(409); return; }
      const state = productionStateSchema.parse(row.state);
      res.json({ scope: { clientId: m.clientId, promptId: m.promptId, operatorId: m.operatorId },
        state, budgetUsd: m.budgetUsd, accountedUpperUsd: accountedMicros(state.ledger) / 1_000_000 });
    } catch (error) { next(error); }
  });
  app.post("/api/v1/internal/r1a-pilot/activate", authorize, async (req, res, next) => {
    try { res.json(await activateProductionPilot(productionManifest()!, req.body?.browserAcceptanceRef ?? "")); }
    catch (error) { next(error); }
  });
  app.post("/api/v1/internal/r1a-pilot/close", authorize, async (_req, res, next) => {
    try {
      await closeProduction(productionManifest()!);
      setProductionPilotPolicy({ approvals: [], cohorts: [] });
      res.json({ closed: true });
    } catch (error) { next(error); }
  });
}
