import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import { insertTopicSchema } from "@shared/schema";
import { requireClientId } from "./_helpers";
import { requireRole } from "../auth";

export function registerTopicRoutes(app: Express) {
  app.get("/api/v1/topics/:clientId", async (req, res, next) => {
    try {
      const clientId = req.params.clientId;
      const topics = await storage.getTopics(clientId);
      res.json(topics);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/topics", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;
      const topics = await storage.getTopics(clientId);
      res.json(topics);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/topics", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const data = insertTopicSchema.parse(req.body);
      const topic = await storage.createTopic(data);
      res.status(201).json(topic);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid topic data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  app.put("/api/v1/topics/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const data = insertTopicSchema.partial().parse(req.body);
      const topic = await storage.updateTopic(req.params.id, data);
      res.json(topic);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid topic data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  app.delete("/api/v1/topics/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      await storage.deleteTopic(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
}
