/**
 * Task #113 — Unified API error contract.
 *
 * Wire format on every non-2xx `/api/v1` response:
 *
 *   {
 *     "error": {
 *       "code":      "<machine-readable code from ERROR_CODES>",
 *       "message":   "<safe-to-show user message>",
 *       "requestId": "<X-Request-Id of the failing request>",
 *       "details":   { ... }   // optional, structured
 *     }
 *   }
 *
 * `ApiError` is the throwable canonical form. Route handlers should
 * `throw new ApiError(...)` rather than building ad-hoc res.status().json()
 * bodies — the global error middleware in `server/index.ts` is the single
 * serializer.
 */

export const ERROR_CODES = {
  // 4xx — caller's fault
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf_failed: 403,
  gone: 410,
  // 5xx — our fault
  internal_error: 500,
  service_unavailable: 503,
  vendor_paused: 503,
  database_error: 503,
  upstream_error: 502,
  timeout: 504,
} as const;

export type ApiErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number;
  readonly details?: unknown;
  /** True if message is safe to render verbatim to end users. */
  readonly exposeMessage: boolean;

  constructor(opts: {
    code: ApiErrorCode | string;
    message: string;
    status?: number;
    details?: unknown;
    exposeMessage?: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status =
      opts.status ??
      (ERROR_CODES as Record<string, number>)[opts.code] ??
      500;
    this.details = opts.details;
    this.exposeMessage = opts.exposeMessage ?? true;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError({ code: "bad_request", message, details });
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError({ code: "validation_failed", message, details });
  }

  static notFound(message = "Not found"): ApiError {
    return new ApiError({ code: "not_found", message });
  }

  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError({ code: "forbidden", message });
  }

  static unauthenticated(message = "Authentication required"): ApiError {
    return new ApiError({ code: "unauthenticated", message });
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError({ code: "conflict", message, details });
  }
}

/**
 * Wraps an async Express handler so any thrown error (including ApiError
 * subclasses and bare Errors) is routed through the global error
 * middleware instead of crashing the request with an unhandled rejection.
 */
export function asyncHandler<
  H extends (...args: unknown[]) => Promise<unknown> | unknown,
>(handler: H): H {
  return (async (...args: unknown[]) => {
    const next = args[args.length - 1] as (err?: unknown) => void;
    try {
      await handler(...args);
    } catch (err) {
      if (typeof next === "function") next(err);
      else throw err;
    }
  }) as unknown as H;
}
