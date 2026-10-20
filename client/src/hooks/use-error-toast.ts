/**
 * Task #114 / #131 — Thin wrapper over `useToast()` that always shows
 * destructive-variant toasts for errors and surfaces the typed
 * `requestId` from `ApiError` under the message
 * ("Reference: r-1234abcd"). Falls back gracefully when the thrown
 * value is a plain `Error` (long-tail call sites not yet migrated).
 *
 * Task #131 — Permission (403) failures are special-cased: instead of the
 * generic title the caller passed, they render "You don't have permission"
 * with a friendly, actionable description so users can tell a role problem
 * apart from a real failure. Pass `permissionMessage` to override the
 * default copy with action-specific guidance.
 *
 * Usage:
 *
 *   const errorToast = useErrorToast();
 *   useMutation({
 *     onError: (err) => errorToast("Failed to save", err),
 *   });
 *
 *   // Permission-aware with custom guidance:
 *   errorToast("Couldn't create project", err, {
 *     permissionMessage:
 *       "You don't have permission to create projects. Ask an org admin to upgrade your role.",
 *   });
 */
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/queryClient";
import {
  isPermissionError,
  permissionMessage as resolvePermissionMessage,
  cleanErrorMessage,
} from "@/lib/api-errors";

interface ErrorToastOptions {
  /** Override the friendly permission copy shown on a 403. */
  permissionMessage?: string;
}

function withReference(message: string, requestId: string | null): string {
  return requestId ? `${message} · Reference: ${requestId}` : message;
}

export function useErrorToast() {
  const { toast } = useToast();

  return function showErrorToast(
    title: string,
    error: unknown,
    options?: ErrorToastOptions,
  ) {
    const apiErr = error instanceof ApiError ? error : null;

    if (isPermissionError(error)) {
      toast({
        title: "You don't have permission",
        description: withReference(
          resolvePermissionMessage(error, options?.permissionMessage),
          apiErr?.requestId ?? null,
        ),
        variant: "destructive",
      });
      return;
    }

    toast({
      title,
      description: withReference(cleanErrorMessage(error), apiErr?.requestId ?? null),
      variant: "destructive",
    });
  };
}
