/**
 * Task #114 — Slow-query notice with Cancel + requestId.
 *
 * Renders the "Still working… this is taking longer than usual." message
 * once a query has been fetching past the configured threshold (default
 * 10s). When a `queryKey` is provided, surfaces a Cancel button that
 * aborts the in-flight query via `queryClient.cancelQueries`. When the
 * caller has a `requestId` from a previous failed attempt, shows it as
 * a reference so users can quote it to support.
 */
import { useSlowQueryNotice } from "@/hooks/use-slow-query-notice";
import { queryClient } from "@/lib/queryClient";

interface Props {
  loading: boolean;
  thresholdMs?: number;
  queryKey?: readonly unknown[];
  requestId?: string | null;
  onCancel?: () => void;
}

export function SlowQueryNotice({
  loading,
  thresholdMs = 10_000,
  queryKey,
  requestId,
  onCancel,
}: Props) {
  const slow = useSlowQueryNotice(loading, thresholdMs);
  if (!slow) return null;

  const handleCancel = () => {
    if (queryKey) {
      void queryClient.cancelQueries({ queryKey: queryKey as unknown[] });
    }
    onCancel?.();
  };
  const cancellable = !!queryKey || !!onCancel;

  return (
    <div
      className="text-sm text-muted-foreground text-center mt-2 flex items-center justify-center gap-2 flex-wrap"
      data-testid="text-slow-query-notice"
    >
      <span>Still working… this is taking longer than usual.</span>
      {cancellable ? (
        <button
          type="button"
          onClick={handleCancel}
          className="text-xs text-primary underline-offset-2 hover:underline"
          data-testid="button-slow-cancel"
        >
          Cancel
        </button>
      ) : null}
      {requestId ? (
        <span className="text-xs">
          · Reference: <code>{requestId}</code>
        </span>
      ) : null}
    </div>
  );
}
