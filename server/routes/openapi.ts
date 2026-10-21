import type { Express } from "express";
import type { OpenAPIObject } from "openapi3-ts/oas30";
import { z } from "zod";
import { searchEvidenceSchema, webSearchEnabledInput } from "../../shared/native-web-search";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";

/**
 * Type-safe wrapper around `registry.registerPath` that explicitly allows
 * the `x-required-role` OpenAPI extension we use for documenting RBAC
 * requirements without resorting to `as any` casts. The library's
 * `RouteConfig` type is structurally open to extra string-keyed
 * properties, so we just widen the parameter type to include known
 * extensions.
 */
type RouteConfigWithExtensions = RouteConfig & {
  "x-required-role"?: "admin" | "member" | "viewer";
};
import {
  insertOrganizationSchema,
  insertClientSchema,
  createClientSchema,
  insertCompetitorSchema,
  insertAiModelSchema,
  insertTopicSchema,
  insertPromptSchema,
  insertPromptRunSchema,
  insertJobSchema,
  insertRecommendationSchema,
  insertGeneratedContentSchema,
  insertReportSnapshotSchema,
  insertXRaySiteSchema,
  insertXRayPageSchema,
} from "@shared/schema";

extendZodWithOpenApi(z);

// Helpers used to derive lightweight "select"-style schemas (insert + id)
// for documenting response shapes without redefining every column.
const withId = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.extend({ id: z.string() });

let cachedDocument: OpenAPIObject | null = null;

export function buildOpenApiDocument(): OpenAPIObject {
  if (cachedDocument) return cachedDocument;

  const registry = new OpenAPIRegistry();
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}/search-evidence/{itemId}",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "itemId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: { 200: { description: "Authorized bounded native-search item evidence, including failures without an answer",
      content: { "application/json": { schema: z.object({
        itemId: z.string().optional(), phase: z.string(), evidence: searchEvidenceSchema.nullable(),
        answerText: z.string().max(250000).nullable().optional(), runStatus: z.string().optional(),
      }) } } } },
  });

  // ---- Reusable schemas ----
  const ErrorResponseSchema = registry.register(
    "ErrorResponse",
    z
      .object({
        message: z.string().optional(),
        error: z.string().optional(),
        errors: z.array(z.any()).optional(),
      })
      .openapi("ErrorResponse"),
  );

  registry.register("Organization", insertOrganizationSchema.openapi("Organization"));
  registry.register("Client", insertClientSchema.openapi("Client"));
  registry.register("CreateClient", createClientSchema.openapi("CreateClient"));
  registry.register("Competitor", insertCompetitorSchema.openapi("Competitor"));
  registry.register("AiModel", insertAiModelSchema.openapi("AiModel"));

  // Augmented response shape for `GET /api/v1/ai-models`: every model row
  // plus an `isKeyAvailable` flag the route computes from env vars, and the
  // primary key (the insert schema omits it).
  const AiModelWithStatusSchema = registry.register(
    "AiModelWithStatus",
    insertAiModelSchema
      .extend({
        id: z.string(),
        isKeyAvailable: z.boolean(),
        webSearch: z.object({
          eligible: z.boolean(), reason: z.string(), message: z.string(), policyVersion: z.string(),
        }),
      })
      .openapi("AiModelWithStatus"),
  );
  registry.register("Topic", insertTopicSchema.openapi("Topic"));
  registry.register("Prompt", insertPromptSchema.openapi("Prompt"));
  registry.register("PromptRun", insertPromptRunSchema.openapi("PromptRun"));
  registry.register("Job", insertJobSchema.openapi("Job"));
  registry.register("Recommendation", insertRecommendationSchema.openapi("Recommendation"));
  registry.register(
    "GeneratedContent",
    insertGeneratedContentSchema.openapi("GeneratedContent"),
  );
  registry.register(
    "ReportSnapshot",
    insertReportSnapshotSchema.openapi("ReportSnapshot"),
  );

  // ---- Common parameters ----
  const ClientIdHeader = registry.registerParameter(
    "XClientIdHeader",
    z
      .string()
      .optional()
      .openapi({
        param: { name: "x-client-id", in: "header" },
        description:
          "Tenancy identifier. Preferred over query parameters. May also be supplied via ?clientId= or legacy ?client_id=.",
      }),
  );

  const ClientIdQuery = registry.registerParameter(
    "ClientIdQuery",
    z
      .string()
      .optional()
      .openapi({
        param: { name: "clientId", in: "query" },
        description:
          "Tenancy identifier (alternative to x-client-id header). Legacy snake_case `client_id` is also accepted.",
      }),
  );

  // ---- Helpers ----
  const ok = (description: string, schema: z.ZodTypeAny = z.any()) => ({
    [200]: {
      description,
      content: { "application/json": { schema } },
    },
    [400]: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    [500]: {
      description: "Server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  });

  // For endpoints that respond with 204 No Content (typical for DELETE).
  const noContent = (description = "Deleted") => ({
    [204]: { description },
    [400]: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    [500]: {
      description: "Server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  });

  // ---- Reusable response schemas ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}/selections",
    tags: ["prompt-runs"],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: ok("Current rerun selections and inherited search mode", z.object({
      runId: z.string(), promptIds: z.array(z.string()), modelIds: z.array(z.string()),
      webSearchEnabled: z.boolean(),
    })),
  });
  const JobStatusEnum = z
    .enum(["queued", "running", "done", "error", "failed"])
    .or(z.string());

  const QueuedJobResponse = z.object({
    jobId: z.string(),
    status: JobStatusEnum,
  });

  const MessageOnlyResponse = z.object({ message: z.string() });

  const SuccessMessageResponse = z.object({
    success: z.boolean(),
    message: z.string().optional(),
  });

  const CountedSuccessResponse = z.object({
    message: z.string(),
    count: z.number().int().nonnegative(),
  });

  // ---- Route registrations (every server/routes/*.ts handler is documented) ----
  registry.registerPath({
    method: "get",
    path: "/api/v1/organizations/{id}",
    tags: ["organizations"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("The organization", withId(insertOrganizationSchema)),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/clients",
    tags: ["clients"],
    parameters: [
      {
        name: "orgId",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Organization id (legacy: org_id)",
      },
    ],
    responses: ok("List of clients", z.array(withId(insertClientSchema))),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/clients/validate-project-name",
    tags: ["clients"],
    parameters: [
      {
        name: "projectName",
        in: "query",
        required: true,
        schema: { type: "string" },
        description: "Project name to validate for uniqueness within the org",
      },
      {
        name: "excludeId",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Optional client id to exclude (used when renaming)",
      },
      {
        name: "orgId",
        in: "query",
        required: true,
        schema: { type: "string" },
        description:
          "Organization id (legacy: org_id). Required — the handler returns 400 without it.",
      },
    ],
    responses: ok(
      "Project name availability",
      z.object({
        available: z.boolean(),
        conflictingProjectId: z.string().nullable(),
      }),
    ),
  });

  // Override: orgId must be supplied (the handler 400s without it).
  registry.registerPath({
    method: "post",
    path: "/api/v1/clients",
    tags: ["clients"],
    request: {
      body: {
        content: { "application/json": { schema: createClientSchema } },
      },
    },
    responses: ok("Created client", withId(insertClientSchema)),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/clients/{id}",
    tags: ["clients"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("The client", withId(insertClientSchema)),
  });

  registry.registerPath({
    method: "put",
    path: "/api/v1/clients/{id}",
    tags: ["clients"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": { schema: insertClientSchema.partial() },
        },
      },
    },
    responses: ok("Updated client", withId(insertClientSchema)),
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/clients/{id}",
    tags: ["clients"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Deleted",
      z.object({ message: z.string(), success: z.boolean().optional() }),
    ),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/clients/{id}/copy",
    tags: ["clients"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ projectName: z.string().optional() }),
          },
        },
      },
    },
    responses: ok(
      "Copy job started",
      z.object({
        success: z.boolean(),
        jobId: z.string(),
        message: z.string(),
      }),
    ),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/clients/{id}/generate-metadata",
    tags: ["clients"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ enableSiteXRay: z.boolean().optional() }),
          },
        },
      },
    },
    responses: ok(
      "Metadata generation started",
      z.object({
        message: z.string(),
        clientId: z.string(),
        jobId: z.string(),
      }),
    ),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/clients/{id}/models",
    tags: ["clients", "ai-models"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Models selected for the client",
      z.array(withId(insertAiModelSchema)),
    ),
  });

  registry.registerPath({
    method: "put",
    path: "/api/v1/clients/{id}/models",
    tags: ["clients", "ai-models"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ model_ids: z.array(z.string()) }),
          },
        },
      },
    },
    responses: ok("Updated", z.object({ success: z.boolean() })),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/clients/{id}/refresh-prompts",
    tags: ["clients", "prompts"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Prompts refreshed from accepted topics",
      z.object({
        message: z.string(),
        promptCount: z.number().int().nonnegative().optional(),
        prompts: z.array(withId(insertPromptSchema)).optional(),
      }),
    ),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/onboarding/enrich-urls",
    tags: ["onboarding"],
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ name: z.string() }) },
        },
      },
    },
    responses: ok(
      "URL suggestions",
      z
        .object({
          urls: z.array(z.string()).optional(),
        })
        .passthrough(),
    ),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/onboarding/enrich-profile",
    tags: ["onboarding"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string(),
              urls: z.array(z.string()).optional(),
              focusAreas: z.array(z.string()).optional(),
            }),
          },
        },
      },
    },
    responses: ok(
      "Profile suggestions",
      z
        .object({
          industry: z.string().optional(),
          geography: z.string().optional(),
          brandAliases: z.array(z.string()).optional(),
          focusAreas: z.array(z.string()).optional(),
          description: z.string().optional(),
        })
        .passthrough(),
    ),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/onboarding/enrich-competitors",
    tags: ["onboarding"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string(),
              urls: z.array(z.string()).optional(),
              industry: z.string().optional(),
              geography: z.string().optional(),
              brandAliases: z.array(z.string()).optional(),
              focusAreas: z.array(z.string()).optional(),
            }),
          },
        },
      },
    },
    responses: ok(
      "Competitor suggestions",
      z
        .object({
          competitors: z
            .array(
              z
                .object({
                  name: z.string(),
                  url: z.string().optional(),
                  description: z.string().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/jobs",
    tags: ["jobs"],
    parameters: [{ $ref: "#/components/parameters/ClientIdQuery" }],
    responses: ok(
      "Jobs (optionally filtered by tenancy)",
      z.array(withId(insertJobSchema)),
    ),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/jobs/{id}",
    tags: ["jobs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("The job", withId(insertJobSchema)),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/competitors",
    tags: ["competitors"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "List of competitors",
      z.array(withId(insertCompetitorSchema)),
    ),
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/competitors",
    tags: ["competitors"],
    request: {
      body: {
        content: { "application/json": { schema: insertCompetitorSchema } },
      },
    },
    responses: ok("Created competitor", withId(insertCompetitorSchema)),
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/competitors/{id}",
    tags: ["competitors"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: noContent("Competitor deleted"),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/ai-models",
    tags: ["ai-models"],
    responses: ok(
      "List of AI models with key availability",
      z.array(AiModelWithStatusSchema),
    ),
  });

  // Topics
  registry.registerPath({
    method: "get",
    path: "/api/v1/topics",
    tags: ["topics"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok("Topics for the client", z.array(withId(insertTopicSchema))),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/topics/{clientId}",
    tags: ["topics"],
    parameters: [
      {
        name: "clientId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok("Topics for the client", z.array(withId(insertTopicSchema))),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/topics",
    tags: ["topics"],
    request: {
      body: {
        content: { "application/json": { schema: insertTopicSchema } },
      },
    },
    responses: ok("Created topic", withId(insertTopicSchema)),
  });
  registry.registerPath({
    method: "put",
    path: "/api/v1/topics/{id}",
    tags: ["topics"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": { schema: insertTopicSchema.partial() },
        },
      },
    },
    responses: ok("Updated topic", withId(insertTopicSchema)),
  });
  registry.registerPath({
    method: "delete",
    path: "/api/v1/topics/{id}",
    tags: ["topics"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: noContent("Topic deleted"),
  });

  // Prompts
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompts",
    tags: ["prompts"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Prompts for the client",
      z.array(withId(insertPromptSchema)),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompts/{clientId}",
    tags: ["prompts"],
    parameters: [
      {
        name: "clientId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok(
      "Prompts for the client",
      z.array(withId(insertPromptSchema)),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/prompts",
    tags: ["prompts"],
    request: {
      body: {
        content: { "application/json": { schema: insertPromptSchema } },
      },
    },
    responses: ok("Created prompt", withId(insertPromptSchema)),
  });
  registry.registerPath({
    method: "put",
    path: "/api/v1/prompts/{id}",
    tags: ["prompts"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": { schema: insertPromptSchema.partial() },
        },
      },
    },
    responses: ok("Updated prompt", withId(insertPromptSchema)),
  });
  registry.registerPath({
    method: "delete",
    path: "/api/v1/prompts/{id}",
    tags: ["prompts"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: noContent("Prompt deleted"),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-categories",
    tags: ["prompts"],
    responses: ok(
      "Prompt categories",
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          description: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
    ),
  });

  // Prompt Runs
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs",
    tags: ["prompt-runs"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Prompt runs (with score aggregates)",
      z.array(
        withId(insertPromptRunSchema).extend({
          modelCount: z.number().int().nonnegative(),
          avgVisibilityScore: z.number(),
          avgSentimentScore: z.number(),
          avgPositionScore: z.number(),
        }),
      ),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/metadata",
    tags: ["prompt-runs"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Lightweight prompt run metadata",
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: z.string(),
          status: z.string(),
          totalPrompts: z.number().int().nullable(),
          modelCount: z.number().int().nonnegative(),
        }),
      ),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/prompt-runs",
    tags: ["prompt-runs"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              clientId: z.string(),
              promptIds: z.array(z.string()),
              modelIds: z.array(z.string()),
              createdBy: z.string().optional(),
              name: z.string().max(200).optional(),
              iterationOf: z.string().max(200).optional(),
              webSearchEnabled: webSearchEnabledInput,
            }),
          },
        },
      },
    },
    responses: ok(
      "Created prompt run (returns the new run plus the per-(prompt,model) items that were enqueued)",
      z.object({
        run: withId(insertPromptRunSchema),
        items: z.array(
          z.object({
            id: z.string(),
            promptRunId: z.string(),
            promptId: z.string(),
            modelId: z.string(),
            status: z.string(),
            startedAt: z.string().nullable(),
            finishedAt: z.string().nullable(),
            error: z.string().nullable(),
          }),
        ),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("The prompt run", withId(insertPromptRunSchema)),
  });
  registry.registerPath({
    method: "patch",
    path: "/api/v1/prompt-runs/{id}",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ name: z.string().min(1).max(200) }),
          },
        },
      },
    },
    responses: ok("Updated", withId(insertPromptRunSchema)),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}/results",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Detailed results (run + per-item answer/citations/mentions/rankings + competitor scores)",
      z.object({
        run: withId(insertPromptRunSchema),
        results: z.array(
          z.object({
            item: z.object({}).passthrough(),
            prompt: z.object({}).passthrough().nullable(),
            model: z.object({}).passthrough().nullable(),
            answer: z.object({}).passthrough().nullable(),
            citations: z.array(z.object({}).passthrough()),
            mentions: z.array(z.object({}).passthrough()),
            rankings: z.array(z.object({}).passthrough()),
          }),
        ),
        competitorScores: z.array(z.object({}).passthrough()),
      }),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/prompt-runs/{id}/recalculate-position",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Recalculation summary",
      z.object({
        message: z.string(),
        updated: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}/errors",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Per-item error details",
      z.object({
        promptRunId: z.string(),
        status: z.string(),
        totalItems: z.number().int().nonnegative(),
        errorCount: z.number().int().nonnegative(),
        errorSummary: z.array(z.object({}).passthrough()),
        errors: z.array(z.object({}).passthrough()),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}/logs",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "limit", in: "query", schema: { type: "integer" } },
      { name: "cursor", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Structured logs (cursor-paginated)",
      z.object({
        promptRunId: z.string(),
        logs: z.array(z.object({}).passthrough()),
        nextCursor: z.string().nullable().optional(),
      }),
    ),
  });
  registry.registerPath({
    method: "delete",
    path: "/api/v1/prompt-runs/{id}",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: noContent("Prompt run deleted"),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/prompt-runs/{id}/stop",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("Stop request accepted", MessageOnlyResponse),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{id}/score-explanation/{category}",
    tags: ["prompt-runs"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      {
        name: "category",
        in: "path",
        required: true,
        schema: {
          type: "string",
          enum: ["Visibility", "Sentiment", "Position"],
        },
      },
      { name: "promptId", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Score explanation (factor breakdown + interpretation)",
      z
        .object({
          category: z.string(),
          score: z.number(),
          color: z.string().optional(),
          interpretation: z.string().optional(),
          factors: z.array(z.object({}).passthrough()).optional(),
        })
        .passthrough(),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{runId}/prompts/{promptId}/benchmarks",
    tags: ["prompt-runs"],
    parameters: [
      {
        name: "runId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "promptId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Prompt-level benchmarks (summary + per-entity rows for the brand and competitors)",
      z.object({
        runId: z.string(),
        promptId: z.string(),
        clientId: z.string(),
        summary: z.object({}).passthrough(),
        entities: z.array(z.object({}).passthrough()),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{runId}/prompts/{promptId}/metric-details",
    tags: ["prompt-runs"],
    parameters: [
      {
        name: "runId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "promptId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Combined interpretations + benchmarks for a single (run, prompt) pair",
      z.object({
        runId: z.string(),
        promptId: z.string(),
        clientId: z.string(),
        interpretations: z.object({
          visibility: z.object({}).passthrough().nullable(),
          sentiment: z.object({}).passthrough().nullable(),
          position: z.object({}).passthrough().nullable(),
        }),
        benchmarks: z
          .object({
            summary: z.object({}).passthrough(),
            entities: z.array(z.object({}).passthrough()),
          })
          .nullable(),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/prompt-runs/{runId}/benchmarks-bulk",
    tags: ["prompt-runs"],
    parameters: [
      {
        name: "runId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Bulk benchmarks for all prompts in a run",
      z.object({
        runId: z.string(),
        clientId: z.string(),
        benchmarks: z.array(z.object({}).passthrough()),
        metricDescriptions: z.object({
          visibility: z.string(),
          sentiment: z.string(),
          position: z.string(),
        }),
      }),
    ),
  });

  // Score colors
  registry.registerPath({
    method: "get",
    path: "/api/v1/score-colors",
    tags: ["scores"],
    parameters: [
      {
        name: "category",
        in: "query",
        required: true,
        schema: {
          type: "string",
          enum: ["Visibility", "Sentiment", "Position"],
        },
      },
    ],
    responses: ok(
      "Score color bands",
      z.array(
        z.object({
          id: z.string(),
          category: z.string(),
          bandName: z.string(),
          colorHex: z.string(),
          scoreMin: z.union([z.string(), z.number()]),
          scoreMax: z.union([z.string(), z.number()]),
        }),
      ),
    ),
  });

  // Dashboard
  for (const [path, description] of [
    ["/api/v1/dashboard/stats", "Dashboard summary stats"],
    ["/api/v1/dashboard/historical-scores", "Historical scores"],
    ["/api/v1/dashboard/top-topics", "Top performing topics"],
    ["/api/v1/dashboard/recent-runs", "Recent prompt runs"],
    ["/api/v1/dashboard/competitor-rankings", "Competitor rankings"],
  ] as const) {
    registry.registerPath({
      method: "get",
      path,
      tags: ["dashboard"],
      parameters: [
        { $ref: "#/components/parameters/XClientIdHeader" },
        { $ref: "#/components/parameters/ClientIdQuery" },
      ],
      responses: ok(description),
    });
  }

  // Opportunities
  for (const [path, description] of [
    ["/api/v1/opportunities/citations", "Citation analysis"],
    ["/api/v1/opportunities/recommendations", "Existing recommendations"],
    [
      "/api/v1/opportunities/recommendations/stats",
      "Recommendation category statistics",
    ],
    [
      "/api/v1/opportunities/recommendations/summary",
      "Recommendations summary (deduplicated)",
    ],
    ["/api/v1/opportunities/content", "Generated content"],
  ] as const) {
    registry.registerPath({
      method: "get",
      path,
      tags: ["opportunities"],
      parameters: [
        { $ref: "#/components/parameters/XClientIdHeader" },
        { $ref: "#/components/parameters/ClientIdQuery" },
      ],
      responses: ok(description),
    });
  }
  registry.registerPath({
    method: "get",
    path: "/api/v1/opportunities/citations/domain/{domain}",
    tags: ["opportunities"],
    parameters: [
      {
        name: "domain",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Citations for a specific domain (untyped raw rows)",
      z.array(z.object({}).passthrough()),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/opportunities/recommendations",
    tags: ["opportunities"],
    request: {
      body: {
        content: { "application/json": { schema: insertRecommendationSchema } },
      },
    },
    responses: ok(
      "Created recommendation",
      withId(insertRecommendationSchema),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/opportunities/recommendations/generate",
    tags: ["opportunities"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ clientId: z.string() }),
          },
        },
      },
    },
    responses: ok("Recommendations generated", CountedSuccessResponse),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/opportunities/content/generate",
    tags: ["opportunities"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ clientId: z.string() }),
          },
        },
      },
    },
    responses: ok("Content generated", CountedSuccessResponse),
  });

  // X-Ray
  registry.registerPath({
    method: "get",
    path: "/api/v1/xray/sites",
    tags: ["xray"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "X-Ray sites for a client",
      z.array(withId(insertXRaySiteSchema)),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/xray/sites/{siteId}",
    tags: ["xray"],
    parameters: [
      {
        name: "siteId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok("Site details", withId(insertXRaySiteSchema)),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/xray/sites/{siteId}/refresh-health",
    tags: ["xray"],
    parameters: [
      {
        name: "siteId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Health check refreshed",
      z.object({
        success: z.boolean(),
        message: z.string(),
        site: withId(insertXRaySiteSchema),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/xray/sites/{siteId}/pages",
    tags: ["xray"],
    parameters: [
      {
        name: "siteId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok("Pages summary", z.array(withId(insertXRayPageSchema))),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/xray/pages/{pageId}",
    tags: ["xray"],
    parameters: [
      {
        name: "pageId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok("Page details", withId(insertXRayPageSchema)),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/xray/pages/{pageId}/analysis",
    tags: ["xray"],
    parameters: [
      {
        name: "pageId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok(
      "AI-generated analysis (assessment, gaps, recommendations, actions, SEO issues, scores)",
      z
        .object({
          assessment: z.unknown().nullable(),
          gaps: z.unknown().nullable(),
          recommendations: z.unknown().nullable(),
          actions: z.unknown().nullable(),
          seoIssues: z.unknown().nullable(),
          scores: z.unknown().nullable(),
        })
        .passthrough(),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/xray/analyze/batch",
    tags: ["xray"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ siteId: z.string() }),
          },
        },
      },
    },
    responses: ok("Batch analysis queued", QueuedJobResponse),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/xray/actions",
    tags: ["xray"],
    parameters: [
      {
        name: "siteId",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
      { name: "owner", in: "query", schema: { type: "string" } },
      { name: "effort", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Filtered actions across all pages of the site",
      z.object({
        actions: z.array(
          z.object({
            pageUrl: z.string(),
            pageTitle: z.string().nullable(),
            text: z.string().optional(),
            owner: z.string().optional(),
            effort: z.string().optional(),
          }),
        ),
      }),
    ),
  });

  // Crawler
  const crawlerExecuteBody = z.object({
    url: z.string().url(),
    options: z
      .object({
        maxPages: z.number().int().min(1).max(50).optional(),
        timeout: z.number().int().min(1000).max(60000).optional(),
        method: z.enum(["auto", "cheerio", "playwright"]).optional(),
      })
      .optional(),
  });
  const crawlerPageSchema = z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    pageType: z.string(),
  });
  const crawlerResultSchema = z.object({
    pages: z.array(crawlerPageSchema),
    totalPages: z.number().int(),
    crawlMethod: z.string(),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/crawler/execute",
    tags: ["crawler"],
    request: {
      body: {
        content: { "application/json": { schema: crawlerExecuteBody } },
      },
    },
    responses: ok(
      "Crawl result (synchronous)",
      z.object({
        url: z.string(),
        crawledAt: z.string(),
        duration: z.number().int().nonnegative(),
        result: crawlerResultSchema,
      }),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/crawler/execute/async",
    tags: ["crawler"],
    request: {
      body: {
        content: { "application/json": { schema: crawlerExecuteBody } },
      },
    },
    responses: {
      [202]: {
        description: "Crawl job queued; poll the returned pollUrl for status",
        content: {
          "application/json": {
            schema: z.object({
              jobId: z.string(),
              status: JobStatusEnum,
              url: z.string(),
              pollUrl: z.string(),
            }),
          },
        },
      },
      [400]: {
        description: "Bad request",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [429]: {
        description: "Rate limit exceeded",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [500]: {
        description: "Server error",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/crawler/jobs/{jobId}",
    tags: ["crawler"],
    parameters: [
      {
        name: "jobId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: ok(
      "Crawler job status (result/error/progress fields appear conditionally based on status)",
      z
        .object({
          jobId: z.string(),
          status: JobStatusEnum,
          url: z.string().optional(),
          createdAt: z.string().optional(),
          crawledAt: z.string().optional(),
          result: crawlerResultSchema.optional(),
          error: z.string().optional(),
          progress: z.number().int().nullable().optional(),
        })
        .passthrough(),
    ),
  });
  const formattedCrawlResponse = z.object({
    formatted: z.string(),
    stats: z.object({
      totalPages: z.number().int(),
      includedPages: z.number().int(),
      excludedPages: z.number().int(),
      totalChars: z.number().int(),
      pagesByType: z.record(z.string(), z.number().int()),
    }),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/crawler/format-for-llm",
    tags: ["crawler"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              crawlResult: crawlerResultSchema,
              options: z
                .object({
                  maxCharsPerPage: z.number().int().min(500).max(10000).optional(),
                  includePageTypes: z.array(z.string()).optional(),
                })
                .optional(),
            }),
          },
        },
      },
    },
    responses: ok("Crawl result formatted for LLM", formattedCrawlResponse),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/crawler/crawl-and-format",
    tags: ["crawler"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              url: z.string().url(),
              crawlOptions: crawlerExecuteBody.shape.options,
              formatOptions: z
                .object({
                  maxCharsPerPage: z.number().int().min(500).max(10000).optional(),
                  includePageTypes: z.array(z.string()).optional(),
                })
                .optional(),
            }),
          },
        },
      },
    },
    responses: ok(
      "Crawl + format combined response",
      z
        .object({
          url: z.string(),
          crawledAt: z.string(),
          result: crawlerResultSchema,
          formatted: formattedCrawlResponse,
        })
        .passthrough(),
    ),
  });

  // Reports
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports",
    tags: ["reports"],
    parameters: [{ $ref: "#/components/parameters/ClientIdQuery" }],
    responses: ok(
      "Reports for the client",
      z.array(withId(insertReportSnapshotSchema)),
    ),
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/reports/generate",
    tags: ["reports"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              clientId: z.string(),
              runId: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      [202]: {
        description:
          "Report generation started; runs asynchronously in the background. Poll GET /api/v1/reports for status.",
        content: {
          "application/json": {
            schema: z.object({
              message: z.string(),
              note: z.string().optional(),
            }),
          },
        },
      },
      [400]: {
        description: "Bad request",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [404]: {
        description: "Client not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [500]: {
        description: "Server error",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Report details",
      z.object({ report: withId(insertReportSnapshotSchema) }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}/sections",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Report sections (ordered by sectionOrder)",
      z.object({ sections: z.array(z.object({}).passthrough()) }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}/files",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Report files",
      z.object({ files: z.array(z.object({}).passthrough()) }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}/download/pdf",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: {
      [200]: {
        description: "Insights PDF",
        content: {
          "application/pdf": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      [400]: {
        description: "Bad request",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [404]: {
        description: "Not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [500]: {
        description: "Server error",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}/download/appendix",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: {
      [200]: {
        description: "Technical Appendix PDF",
        content: {
          "application/pdf": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      [400]: {
        description: "Bad request",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [404]: {
        description: "Not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [500]: {
        description: "Server error",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}/export",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: {
      [200]: {
        description: "Streamed ZIP export of the report bundle",
        content: {
          "application/zip": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      [400]: {
        description: "Bad request",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [404]: {
        description: "Not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      [500]: {
        description: "Server error",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{id}/job",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Report job status",
      z
        .object({
          jobId: z.string().optional(),
          status: JobStatusEnum.optional(),
          progress: z.number().int().nullable().optional(),
          error: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  });
  registry.registerPath({
    method: "delete",
    path: "/api/v1/reports/{id}",
    tags: ["reports"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok("Report deleted", MessageOnlyResponse),
  });

  // Opportunities
  registry.registerPath({
    method: "get",
    path: "/api/v1/opportunities/citations",
    tags: ["opportunities"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      { name: "promptRunId", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Citation analysis grouped by domain",
      z.array(z.object({}).passthrough()),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/opportunities/recommendations",
    tags: ["opportunities"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      { name: "promptRunId", in: "query", schema: { type: "string" } },
      {
        name: "id",
        in: "query",
        schema: { type: "string" },
        description: "Optional id filter",
      },
    ],
    responses: ok(
      "Recommendations for the client (optionally filtered by promptRunId or id)",
      z
        .object({
          recommendations: z.array(withId(insertRecommendationSchema)),
        })
        .passthrough(),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/opportunities/recommendations/stats",
    tags: ["opportunities"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      { name: "promptRunId", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Category stats for recommendations",
      z.array(z.object({}).passthrough()),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/opportunities/recommendations/summary",
    tags: ["opportunities"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      { name: "page", in: "query", schema: { type: "integer" } },
      { name: "pageSize", in: "query", schema: { type: "integer" } },
      { name: "sortBy", in: "query", schema: { type: "string" } },
      { name: "sortDir", in: "query", schema: { type: "string" } },
      { name: "search", in: "query", schema: { type: "string" } },
      { name: "category", in: "query", schema: { type: "string" } },
      { name: "highLevelCategory", in: "query", schema: { type: "string" } },
      { name: "severity", in: "query", schema: { type: "string" } },
      { name: "source", in: "query", schema: { type: "string" } },
      { name: "promptRunId", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Paginated, filtered recommendations summary",
      z.object({}).passthrough(),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/opportunities/content",
    tags: ["opportunities"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      { name: "promptRunId", in: "query", schema: { type: "string" } },
    ],
    responses: ok(
      "Generated content suggestions",
      z.array(withId(insertGeneratedContentSchema)),
    ),
  });

  // Dashboard
  registry.registerPath({
    method: "get",
    path: "/api/v1/dashboard/stats",
    tags: ["dashboard"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Aggregated dashboard counters and average scores",
      z.object({
        totalPrompts: z.number().int().nonnegative(),
        avgVisibilityScore: z.number(),
        avgSentimentScore: z.number(),
        avgPositionScore: z.number(),
        totalCitations: z.number().int().nonnegative(),
        activeModels: z.number().int().nonnegative(),
        totalRuns: z.number().int().nonnegative(),
        completedRuns: z.number().int().nonnegative(),
      }),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/dashboard/historical-scores",
    tags: ["dashboard"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      {
        name: "runIds",
        in: "query",
        schema: { type: "string" },
        description: "Comma-separated list of run ids",
      },
      { name: "limit", in: "query", schema: { type: "integer" } },
    ],
    responses: ok(
      "Per-run historical score series",
      z.array(
        z.object({
          runId: z.string(),
          runName: z.string(),
          createdAt: z.string(),
          avgVisibilityScore: z.number(),
          avgSentimentScore: z.number(),
          avgPositionScore: z.number(),
          totalCitations: z.number().int().nonnegative(),
        }),
      ),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/dashboard/top-topics",
    tags: ["dashboard"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Top accepted topics by score",
      z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          category: z.string().nullable(),
          score: z.number(),
          keywords: z.array(z.string()),
        }),
      ),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/dashboard/recent-runs",
    tags: ["dashboard"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
    ],
    responses: ok(
      "Five most recent prompt runs",
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          prompts: z.number().int().nonnegative(),
          models: z.number().int().nonnegative(),
          status: z.string(),
          createdAt: z.string(),
        }),
      ),
    ),
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/dashboard/competitor-rankings",
    tags: ["dashboard"],
    parameters: [
      { $ref: "#/components/parameters/XClientIdHeader" },
      { $ref: "#/components/parameters/ClientIdQuery" },
      {
        name: "runIds",
        in: "query",
        schema: { type: "string" },
        description: "Comma-separated list of run ids",
      },
    ],
    responses: ok(
      "Aggregated competitor scores ranked by overall score",
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          competitorId: z.string().nullable(),
          isClient: z.boolean(),
          visibilityScore: z.number(),
          sentimentScore: z.number(),
          positionScore: z.number(),
          overallScore: z.number(),
          rank: z.number().int().positive(),
        }),
      ),
    ),
  });

  // ---- Admin / monitoring endpoints ----
  const QueueConfigSchema = z.object({
    heartbeatIntervalMs: z.number().int().nonnegative(),
    staleThresholdMs: z.number().int().nonnegative(),
    maxResumeAttempts: z.number().int().nonnegative(),
    maxConcurrentJobs: z.number().int().nonnegative(),
    defaultTimeoutMs: z.number().int().nonnegative(),
  });

  const HealthResponseSchema = z.object({
    status: z.enum(["ok", "unhealthy"]),
    dbOk: z.boolean(),
    queue: z.object({
      active: z.number().int().nonnegative(),
      queued: z.number().int().nonnegative(),
      stale: z.number().int().nonnegative(),
    }),
    shuttingDown: z.boolean(),
    config: QueueConfigSchema,
  });

  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["admin"],
    responses: {
      [200]: {
        description: "Service healthy",
        content: { "application/json": { schema: HealthResponseSchema } },
      },
      [503]: {
        description:
          "Service unhealthy (database ping failed or graceful shutdown in progress)",
        content: { "application/json": { schema: HealthResponseSchema } },
      },
    },
  });

  // /api/admin/queue returns the JobQueue tunables PLUS an
  // `activeUserSessions` count (Task #37) so monitoring dashboards can
  // alert on session growth.
  const QueueConfigWithSessionsSchema = QueueConfigSchema.extend({
    activeUserSessions: z.number().int().nonnegative().optional(),
  }).openapi("QueueConfigWithSessions");
  registry.registerPath({
    method: "get",
    path: "/api/admin/queue",
    tags: ["admin"],
    responses: ok(
      "JobQueue tunable configuration plus active session count",
      QueueConfigWithSessionsSchema,
    ),
  });

  // ---- Admin / RBAC: members, invitations, audit, project admin ----
  // The `x-required-role` extension documents the minimum tenant role
  // required (member|admin). The global guard wired in
  // `server/routes/index.ts` rejects unauthenticated callers with 401 and
  // cross-tenant callers with 403 before any of these handlers run.

  const RoleEnum = z.enum(["admin", "member", "viewer"]);

  const MemberSchema = z.object({
    userId: z.string(),
    email: z.string().email(),
    displayName: z.string().nullable(),
    role: RoleEnum,
    membershipId: z.string(),
    joinedAt: z.string(),
  });

  const InvitationSchema = z.object({
    id: z.string(),
    orgId: z.string(),
    email: z.string().email(),
    role: RoleEnum,
    invitedByUserId: z.string().nullable(),
    expiresAt: z.string(),
    acceptedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
  });

  const AuditEntrySchema = z.object({
    id: z.string(),
    orgId: z.string().nullable(),
    actorUserId: z.string().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    metadata: z.record(z.unknown()),
    createdAt: z.string(),
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/admin/orgs/{orgId}/members",
    tags: ["admin"],
    parameters: [{ name: "orgId", in: "path", required: true, schema: { type: "string" } }],
    "x-required-role": "admin",
    responses: ok("Org members", z.object({ members: z.array(MemberSchema) })),
  } as any);

  registry.registerPath({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/members",
    tags: ["admin"],
    parameters: [{ name: "orgId", in: "path", required: true, schema: { type: "string" } }],
    "x-required-role": "admin",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ email: z.string().email(), role: RoleEnum.default("member") }),
          },
        },
      },
    },
    responses: ok("Member added", z.object({ ok: z.literal(true) })),
  } as any);

  registry.registerPath({
    method: "patch",
    path: "/api/v1/admin/orgs/{orgId}/members/{userId}",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    "x-required-role": "admin",
    request: {
      body: {
        content: { "application/json": { schema: z.object({ role: RoleEnum }) } },
      },
    },
    responses: ok("Role updated", z.object({ ok: z.literal(true) })),
  } as any);

  registry.registerPath({
    method: "delete",
    path: "/api/v1/admin/orgs/{orgId}/members/{userId}",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    "x-required-role": "admin",
    responses: ok("Member removed", z.object({ ok: z.literal(true) })),
  } as any);

  registry.registerPath({
    method: "get",
    path: "/api/v1/admin/orgs/{orgId}/invitations",
    tags: ["admin"],
    parameters: [{ name: "orgId", in: "path", required: true, schema: { type: "string" } }],
    "x-required-role": "admin",
    responses: ok("Invitations list", z.object({ invitations: z.array(InvitationSchema) })),
  } as any);

  registry.registerPath({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/invitations",
    tags: ["admin"],
    parameters: [{ name: "orgId", in: "path", required: true, schema: { type: "string" } }],
    "x-required-role": "admin",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ email: z.string().email(), role: RoleEnum }),
          },
        },
      },
    },
    responses: ok(
      "Invitation created — capture `token` once and deliver to the invitee",
      z.object({
        invitation: InvitationSchema,
        token: z.string(),
        acceptUrl: z.string(),
      }),
    ),
  } as any);

  registry.registerPath({
    method: "delete",
    path: "/api/v1/admin/orgs/{orgId}/invitations/{id}",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    "x-required-role": "admin",
    responses: ok("Invitation revoked", z.object({ ok: z.literal(true) })),
  } as any);

  registry.registerPath({
    method: "get",
    path: "/api/v1/admin/orgs/{orgId}/audit",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "limit", in: "query", required: false, schema: { type: "integer" } },
    ],
    "x-required-role": "admin",
    responses: ok("Audit log entries", z.object({ entries: z.array(AuditEntrySchema) })),
  } as any);

  registry.registerPath({
    method: "patch",
    path: "/api/v1/admin/clients/{id}",
    tags: ["admin"],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    "x-required-role": "admin",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1).optional(),
              projectName: z.string().min(1).optional(),
              ownerUserId: z.string().nullable().optional(),
              isActive: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: ok(
      "Project updated (rename / project owner / soft-delete)",
      z.object({ project: z.record(z.unknown()) }),
    ),
  } as any);

  // ---- Credential grants & admin password actions (Task #18) ----
  // Public endpoints intentionally have no `x-required-role` since they
  // pre-date authentication; admin endpoints require org-admin.

  // Local type-safe registrar so the new admin endpoints below can carry
  // the `x-required-role` extension without any `as any` escapes.
  const registerExt = (config: RouteConfigWithExtensions) =>
    registry.registerPath(config);

  registerExt({
    method: "post",
    path: "/api/v1/auth/forgot-password",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ email: z.string().email() }),
          },
        },
      },
    },
    responses: {
      [202]: { description: "Always 202, regardless of whether the email exists (anti-enumeration)." },
    },
  });

  registerExt({
    method: "get",
    path: "/api/v1/auth/credential-grants/{token}",
    tags: ["auth"],
    parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
    responses: ok(
      "Grant status (valid|consumed|revoked|expired) for the supplied token.",
      z.object({
        status: z.enum(["valid", "consumed", "revoked", "expired"]),
        kind: z.string(),
        email: z.string().optional(),
        expiresAt: z.string().optional(),
      }),
    ),
  });

  registerExt({
    method: "post",
    path: "/api/v1/auth/credential-grants/{token}/redeem",
    tags: ["auth"],
    parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              password: z.string().min(12),
              displayName: z.string().min(1).max(100).optional(),
            }),
          },
        },
      },
    },
    responses: ok("Grant consumed; user authenticated.", z.object({ ok: z.literal(true) })),
  });

  registerExt({
    method: "post",
    path: "/api/v1/auth/change-password",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              currentPassword: z.string(),
              newPassword: z.string().min(12),
            }),
          },
        },
      },
    },
    responses: ok("Password changed; all other sessions revoked.", z.object({ ok: z.literal(true) })),
  });

  // ---- Active session management (Task #37) ----
  registerExt({
    method: "get",
    path: "/api/v1/auth/sessions",
    tags: ["auth"],
    responses: ok(
      "List of the caller's active sessions; the current one is flagged.",
      z.object({
        currentSessionId: z.string(),
        sessions: z.array(
          z.object({
            sessionId: z.string(),
            userAgent: z.string().nullable(),
            ipAddress: z.string().nullable(),
            createdAt: z.string(),
            lastSeenAt: z.string(),
            current: z.boolean(),
          }),
        ),
      }),
    ),
  });

  registerExt({
    method: "delete",
    path: "/api/v1/auth/sessions/{id}",
    tags: ["auth"],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: { [204]: { description: "Session revoked (idempotent)." } },
  });

  registerExt({
    method: "post",
    path: "/api/v1/auth/sessions/sign-out-others",
    tags: ["auth"],
    responses: ok(
      "Bumps the caller's session epoch — every other session is now invalid.",
      z.object({ ok: z.literal(true), newEpoch: z.number() }),
    ),
  });

  registerExt({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/users/{userId}/reset-password",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: { content: { "application/json": { schema: z.object({ reason: z.string().optional() }) } } },
    },
    responses: ok(
      "Single-use reset link issued; target user is signed out everywhere. Atomically revokes any outstanding self-service /forgot-password grants for this email so only one valid recovery link exists at a time — `revokedSelfService` reports how many were superseded.",
      z.object({
        token: z.string(),
        expiresAt: z.string(),
        acceptUrl: z.string(),
        revokedSelfService: z.number(),
      }),
    ),
    "x-required-role": "admin",
  });

  registerExt({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/users/{userId}/temp-password",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    request: {
      body: { content: { "application/json": { schema: z.object({ reason: z.string().optional() }) } } },
    },
    responses: ok(
      "Random temporary password issued; mustChangeOnNextLogin set; sessions revoked.",
      z.object({ tempPassword: z.string(), mustChangeOnNextLogin: z.literal(true) }),
    ),
    "x-required-role": "admin",
  });

  registerExt({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/users/{userId}/disable",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("User disabled and signed out everywhere.", z.object({ ok: z.literal(true) })),
    "x-required-role": "admin",
  });

  registerExt({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/users/{userId}/enable",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok("User re-enabled.", z.object({ ok: z.literal(true) })),
    "x-required-role": "admin",
  });

  registerExt({
    method: "post",
    path: "/api/v1/admin/orgs/{orgId}/users/{userId}/sign-out-everywhere",
    tags: ["admin"],
    parameters: [
      { name: "orgId", in: "path", required: true, schema: { type: "string" } },
      { name: "userId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: ok(
      "Session epoch bumped; all of the target user's existing sessions are now invalid.",
      z.object({ ok: z.literal(true), sessionEpoch: z.number() }),
    ),
    "x-required-role": "admin",
  });

  registerExt({
    method: "get",
    path: "/api/v1/admin/orgs/{orgId}/pending-resets",
    tags: ["admin"],
    parameters: [{ name: "orgId", in: "path", required: true, schema: { type: "string" } }],
    responses: ok(
      "Active self-service password_reset grants for org members.",
      z.object({
        pendingResets: z.array(
          z.object({
            id: z.string(),
            email: z.string(),
            userId: z.string().nullable(),
            createdAt: z.string(),
            expiresAt: z.string(),
            issuedByUserId: z.string().nullable(),
          }),
        ),
      }),
    ),
    "x-required-role": "admin",
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);
  cachedDocument = generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "AI Visibility Platform API",
      version: "1.0.0",
      description:
        "Auto-generated OpenAPI spec for the platform. Built from Zod schemas using @asteasolutions/zod-to-openapi. Tenancy is identified via the `x-client-id` header (preferred), `?clientId=` (recommended) or legacy `?client_id=` query parameter.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "organizations" },
      { name: "clients" },
      { name: "onboarding" },
      { name: "competitors" },
      { name: "ai-models" },
      { name: "topics" },
      { name: "prompts" },
      { name: "prompt-runs" },
      { name: "scores" },
      { name: "jobs" },
      { name: "dashboard" },
      { name: "opportunities" },
      { name: "xray" },
      { name: "crawler" },
      { name: "reports" },
      { name: "admin" },
    ],
  });

  return cachedDocument;
}

const SWAGGER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AI Visibility Platform API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener('load', () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    });
  </script>
</body>
</html>`;

export function registerOpenApiRoutes(app: Express) {
  app.get("/openapi.json", (_req, res, next) => {
    try {
      const doc = buildOpenApiDocument();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(doc);
    } catch (error) {
      console.error("Failed to build OpenAPI document:", error);
      next(error);
    }
  });

  app.get("/api/docs", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(SWAGGER_HTML);
  });
}
