import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { storage } from "../storage";

export function registerScoreColorRoutes(app: Express) {
  app.get("/api/v1/score-colors", async (req, res, next) => {
    try {
      const { category } = req.query;

      if (!category || typeof category !== "string") {
        throw new ApiError({ status: 400, code: "bad_request", message: "Category query parameter is required" });
      }

      if (!["Visibility", "Sentiment", "Position"].includes(category)) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Invalid category. Must be 'Visibility', 'Sentiment', or 'Position'", details: {
        } });
      }

      const colorBands = await storage.getScoreColorBands(category);
      res.json(colorBands);
    } catch (error) {
      next(error);
    }
  });
}
