import type { IStorage } from "../storage";
import { openaiService } from "../openai-service";

export const TARGET_CONTENT_DRAFTS = 3;

export interface DeliverableFinalizationResult {
  status: "ready" | "needs_attention";
  errors: string[];
  recommendationCount: number;
  contentCount: number;
}

export class DeliverablesAlreadyGeneratingError extends Error {
  constructor() {
    super("Final deliverables are already being generated");
    this.name = "DeliverablesAlreadyGeneratingError";
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

export async function finalizePromptRunDeliverables(options: {
  storage: IStorage;
  clientId: string;
  promptRunId: string;
  onProgress?: (progress: number, message: string) => void;
  checkCancellation?: () => void;
}): Promise<DeliverableFinalizationResult> {
  const {
    storage,
    clientId,
    promptRunId,
    onProgress,
    checkCancellation,
  } = options;
  const errors: string[] = [];

  const claimed = await storage.claimPromptRunDeliverables(promptRunId);
  if (!claimed) {
    throw new DeliverablesAlreadyGeneratingError();
  }

  onProgress?.(98, "Finalizing deliverables: generating recommendations");
  checkCancellation?.();

  let recommendationData = await storage.getRecommendations(clientId, promptRunId);
  const hasGeneratedRecommendations = recommendationData.recommendations.some(
    (recommendation: any) =>
      recommendation.source !== "manual" &&
      recommendation.source !== "prompt_response",
  );

  if (!hasGeneratedRecommendations) {
    try {
      const recommendations = await openaiService.generateRecommendations(clientId, promptRunId);
      if (recommendations.length === 0) {
        throw new Error("Recommendation generation returned no results");
      }
      await storage.saveRecommendations(clientId, promptRunId, recommendations);
    } catch (error) {
      errors.push(`Recommendations: ${safeErrorMessage(error)}`);
    }
  }

  recommendationData = await storage.getRecommendations(clientId, promptRunId);

  let existingContent = await storage.getGeneratedContents(clientId, promptRunId);
  for (
    let draftNumber = existingContent.length + 1;
    draftNumber <= TARGET_CONTENT_DRAFTS;
    draftNumber += 1
  ) {
    checkCancellation?.();
    onProgress?.(
      Math.min(99, 97 + draftNumber),
      `Finalizing deliverables: generating content draft ${draftNumber} of ${TARGET_CONTENT_DRAFTS}`,
    );

    try {
      const draft = await openaiService.generateOptimizedContent(
        clientId,
        draftNumber,
        TARGET_CONTENT_DRAFTS,
        promptRunId,
      );
      if (draft.length !== 1) {
        throw new Error("Content generation returned an unexpected number of drafts");
      }
      await storage.saveGeneratedContents(clientId, promptRunId, draft);
      existingContent = await storage.getGeneratedContents(clientId, promptRunId);
    } catch (error) {
      errors.push(`Content draft ${draftNumber}: ${safeErrorMessage(error)}`);
      break;
    }
  }

  const status = errors.length === 0 ? "ready" : "needs_attention";
  await storage.updatePromptRun(promptRunId, {
    deliverablesStatus: status,
    deliverablesErrorSummary: errors.length > 0 ? errors.join(" | ") : null,
    deliverablesCompletedAt: new Date(),
  });

  return {
    status,
    errors,
    recommendationCount: recommendationData.recommendations.length,
    contentCount: existingContent.length,
  };
}