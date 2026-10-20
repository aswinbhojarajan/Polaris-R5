import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import { insertCompetitorSchema } from "@shared/schema";
import { requireClientId } from "./_helpers";
import { requireRole } from "../auth";

export function registerCompetitorRoutes(app: Express) {
  app.get("/api/v1/competitors", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;
      const competitors = await storage.getCompetitors(clientId);
      res.json(competitors);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/competitors", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const data = insertCompetitorSchema.parse(req.body);
      // Task #90 — idempotent create. The Create-Project wizard POSTs every
      // competitor on completion; if completion is ever retried (network
      // hiccup, double-click, or a future "Resume setup" flow) we must not
      // create duplicate rows. Match on (clientId, case-insensitive name).
      const existing = await storage.getCompetitors(data.clientId);
      const dupe = existing.find(
        (c) => c.name.trim().toLowerCase() === data.name.trim().toLowerCase(),
      );
      if (dupe) {
        return res.status(200).json(dupe);
      }
      const competitor = await storage.createCompetitor(data);
      res.status(201).json(competitor);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid competitor data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  app.delete("/api/v1/competitors/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      await storage.deleteCompetitor(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
}
