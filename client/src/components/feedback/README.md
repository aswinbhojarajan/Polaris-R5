# Feedback Kit (Task #114)

Shared components for rendering errors, retries, and degraded-network
states across the Polaris frontend. All call sites can reach for these
instead of inventing per-page error UI.

## Components

### `<ErrorBoundary>` — `client/src/components/error-boundary.tsx`
Mounted ONCE at the app root. Catches render-time crashes anywhere in
the React tree and shows a friendly fallback with Reload + Back-to-Projects
buttons and the typed `requestId` from any `ApiError` that propagated.
Resets automatically on route change.

### `<NetworkBanner>` — `client/src/components/feedback/NetworkBanner.tsx`
Mounted ONCE at the app root. Watches `navigator.onLine` and pings
`/health/live` every 30s (paused while the tab is hidden). When the
browser goes offline OR the server has been unreachable for >15s,
shows a dismissible amber bar at the top of the viewport with a
"Retry now" button. Clears itself as soon as health returns.

### `<ErrorState error={...} onRetry={...} />`
The default in-card / in-section error UI for failed `useQuery` calls:

```tsx
if (query.isError) {
  return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
}
```

Knows the typed `ApiError` shape and renders the `requestId` so the user
can quote it when contacting support. Pass `compact` for a tighter layout
inside small cards.

### `<RetryCard>`
The same as `<ErrorState>` but wrapped in a `<Card>` — for top-level
dashboard sections that need a card-shaped error placeholder.

### `<ApiErrorMessage error={...} />`
Inline single-line renderer for an `ApiError`. Use inside toasts, table
cells, or alert bodies when a full `<ErrorState>` is too heavy.

## Hooks

### `useErrorToast()` — `client/src/hooks/use-error-toast.ts`
Returns `(title, error, options?) => void` that always shows a
destructive-variant toast with the error message plus `Reference: <requestId>`
when present. Use instead of hand-rolling
`toast({ ..., variant: "destructive" })` inside `useMutation.onError`.

It is **permission-aware**: when the thrown error is a 403 (`ApiError.status
=== 403` or `code === "forbidden"`) it overrides the title with "You don't
have permission" and shows a friendly, actionable description instead of the
generic title you passed. Pass action-specific guidance via the third arg:

```tsx
errorToast("Couldn't create project", err, {
  permissionMessage:
    "You don't have permission to create projects. Ask an org admin to upgrade your role.",
});
```

### `useSlowQueryNotice(isFetching, thresholdMs?)`
Returns `true` once `isFetching` has been continuously true for longer
than `thresholdMs` (default 10s). Swap the regular skeleton for a
"Still working… this is taking longer than usual" message on slow
surfaces.

## Imports

Import per-component for tree-shaking — do not add a barrel file:

```tsx
import { ErrorState } from "@/components/feedback/ErrorState";
import { useErrorToast } from "@/hooks/use-error-toast";
```

## Error & notification conventions (Task #131)

A consistent vocabulary so users can tell *why* something failed and what to
do next. Reach for the shared helpers in `client/src/lib/api-errors.ts`
(`isPermissionError`, `permissionMessage`, `cleanErrorMessage`) rather than
re-detecting status codes by hand.

| Kind | How to detect | What the user sees |
| --- | --- | --- |
| **Permission (403)** | `isPermissionError(err)` | Title "You don't have permission" + friendly, action-specific guidance ("Ask an org admin to upgrade your role"). Handled automatically by `useErrorToast`. |
| **Validation (400 / 409)** | inspect `ApiError.status` / `code` in `onError` | A specific, corrective message — e.g. the 409 duplicate-name toast tells the user to pick another name. Keep these bespoke branches; do not collapse them into the generic path. |
| **Server / network (5xx, offline)** | the default `useErrorToast` path | Generic title you pass + cleaned server message + `Reference: <requestId>`. Network outages are also surfaced globally by `<NetworkBanner>`. |

Rules of thumb:

- **Mutations** → `useErrorToast` in `onError`. Add explicit branches *before*
  it only for cases that need bespoke copy (409 duplicate, etc.); let
  permission and the generic fallback flow through the hook.
- **Queries** → `<ErrorState>` / `<RetryCard>` with `onRetry`, not a toast.
- **Toast titles** describe the action that failed in plain language
  ("Couldn't add topic"), never "Failed to…" / "Something went wrong".
- **Destructive confirmations** → the app's `<AlertDialog>`
  (`@/components/ui/alert-dialog`), never the native `window.confirm()`.
  Drive it with controlled state and give the confirm/cancel buttons stable
  `data-testid`s.
