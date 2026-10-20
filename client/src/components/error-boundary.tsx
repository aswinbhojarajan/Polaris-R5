/**
 * Task #114 — App-root React error boundary.
 *
 * Catches render-time crashes anywhere in the React tree and shows a
 * friendly fallback page with a Reload button, a Back-to-Catalog link,
 * and the typed `requestId` (if the thrown value was an `ApiError`).
 *
 * Resets automatically on `location` change so a user navigating away
 * via the sidebar is not stuck on the fallback.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "@/lib/queryClient";

interface Props {
  children: ReactNode;
  /** Reset key — when this changes, the boundary clears its error state. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryClass extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const requestId =
      error instanceof ApiError ? error.requestId ?? null : null;
    const isDev =
      typeof import.meta !== "undefined" && import.meta.env?.DEV === true;

    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background p-6"
        data-testid="error-boundary-fallback"
      >
        <div className="max-w-md w-full text-center space-y-4">
          <AlertTriangle className="h-10 w-10 mx-auto text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">
            Something went wrong on this page
          </h1>
          <p className="text-sm text-muted-foreground">
            Try reloading. If this keeps happening, send us this reference
            code so we can investigate.
          </p>
          {requestId && (
            <p
              className="text-xs font-mono text-muted-foreground bg-muted inline-block px-2 py-1 rounded"
              data-testid="error-boundary-request-id"
            >
              Reference: {requestId}
            </p>
          )}
          <div className="flex gap-2 justify-center pt-2">
            <Button
              variant="default"
              onClick={() => window.location.reload()}
              data-testid="button-error-reload"
            >
              Reload
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/app/clients";
              }}
              data-testid="button-error-back-to-catalog"
            >
              Back to Projects
            </Button>
          </div>
          {isDev && (
            <pre className="text-xs text-left bg-muted p-3 rounded overflow-auto max-h-64 mt-4">
              {error.stack || error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <ErrorBoundaryClass resetKey={location}>{children}</ErrorBoundaryClass>
  );
}
