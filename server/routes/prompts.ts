import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import { insertPromptSchema } from "@shared/schema";
import { requireClientId } from "./_helpers";
import { requireRole } from "../auth";

export function registerPromptRoutes(app: Express) {
  app.get("/api/v1/prompts/:clientId", async (req, res, next) => {
    try {
      const clientId = req.params.clientId;
      const prompts = await storage.getPrompts(clientId);
      res.json(prompts);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/prompts", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;
      const prompts = await storage.getPrompts(clientId);
      res.json(prompts);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/prompts", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const data = insertPromptSchema.parse(req.body);

      if (data.categoryId !== null && data.categoryId !== undefined) {
        const categories = await storage.getPromptCategories();
        const categoryExists = categories.some((c) => c.id === data.categoryId);
        if (!categoryExists) {
          throw new ApiError({ status: 400, code: "bad_request", message: "Invalid category ID", details: {
            errors: [
              { field: "categoryId", message: "Category does not exist" },
            ],
          } });
        }
      }

      const prompt = await storage.createPrompt(data);
      res.status(201).json(prompt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid prompt data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  app.put("/api/v1/prompts/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const data = insertPromptSchema.partial().parse(req.body);

      if (data.categoryId !== null && data.categoryId !== undefined) {
        const categories = await storage.getPromptCategories();
        const categoryExists = categories.some((c) => c.id === data.categoryId);
        if (!categoryExists) {
          throw new ApiError({ status: 400, code: "bad_request", message: "Invalid category ID", details: {
            errors: [
              { field: "categoryId", message: "Category does not exist" },
            ],
          } });
        }
      }

      const prompt = await storage.updatePrompt(req.params.id, data);
      res.json(prompt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid prompt data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  app.delete("/api/v1/prompts/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      await storage.deletePrompt(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/prompt-categories", async (req, res, next) => {
    try {
      const categories = await storage.getPromptCategories();
      res.json(categories);
    } catch (error) {
      next(error);
    }
  });
}
