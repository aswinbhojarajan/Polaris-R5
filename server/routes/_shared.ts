import { storage } from "../storage";
import { JobQueue } from "../services/job-queue";
import { OnboardingEnrichmentService } from "../services/onboarding-enrichment";

/** Singleton job queue used by every route module that enqueues background work. */
export const jobQueue = new JobQueue(storage);

/** Singleton onboarding enrichment service used by the onboarding routes. */
export const enrichmentService = new OnboardingEnrichmentService();
