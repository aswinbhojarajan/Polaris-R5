/**
 * Task #114 — Shared error UI for failed queries.
 *
 * Use under any `useQuery` whose `error` is set:
 *
 *   if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
 *
 * Knows the typed `ApiError` shape and surfaces `requestId` so operators
 * can grep the server log.
 */
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/queryClient";

interface Props {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  /** Compact in-card variant — no top padding, smaller icon. */
  compact?: boolean;
}

export function ErrorState({ error, onRetry, title, compact }: Props) {
  const apiErr = error instanceof ApiError ? error : null;
  const message =
    apiErr?.code === "vendor_paused"
      ? "This AI vendor is currently paused by an admin."
      : (error as Error | undefined)?.message?.replace(/^\d{3}:\s*/, "") ||
        "Something went wrong loading this data.";
  const requestId = apiErr?.requestId ?? null;

  return (
    <div
      className={`text-center ${compact ? "py-4" : "py-8"}`}
      data-testid="error-state"
    >
      <AlertCircle
        className={`mx-auto text-destructive mb-2 ${compact ? "h-6 w-6" : "h-10 w-10"}`}
      />
      <p className="text-sm font-medium text-foreground">
        {title || "Couldn't load this"}
      </p>
      <p className="text-xs text-muted-foreground mt-1 px-4 break-words">
        {message}
      </p>
      {requestId && (
        <p
          className="text-[10px] font-mono text-muted-foreground mt-2"
          data-testid="error-state-request-id"
        >
          Reference: {requestId}
        </p>
      )}
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-3"
          data-testid="button-error-state-retry"
        >
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * Render the message body of an `ApiError` (or any thrown value) as a
 * single inline string — useful inside toasts, alerts, or table cells.
 */
export function ApiErrorMessage({ error }: { error: unknown }) {
  const apiErr = error instanceof ApiError ? error : null;
  const message =
    (error as Error | undefined)?.message?.replace(/^\d{3}:\s*/, "") ||
    "Request failed";
  return (
    <span data-testid="api-error-message">
      {message}
      {apiErr?.requestId && (
        <span className="text-xs text-muted-foreground ml-2 font-mono">
          (Reference: {apiErr.requestId})
        </span>
      )}
    </span>
  );
}
