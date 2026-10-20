import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { useAuth, AUTH_QUERY_KEY, broadcastAuthEvent } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { validatePasswordPolicy } from "@shared/schema";

interface ChangePasswordFormProps {
  /** "page" = standalone /change-password (forced rotation interstitial). "card" = embedded inside a settings card. */
  variant?: "page" | "card";
  /** Submit button label. */
  submitLabel?: string;
  /** Called after a successful change. The form clears its inputs before this fires. */
  onSuccess?: () => void;
  /** When true, error feedback is rendered inline above the form. Defaults to true. */
  showInlineError?: boolean;
}

/**
 * Reusable change-password form. Backs both the standalone
 * /change-password page (used as the must-change-on-next-login
 * interstitial) and the Security card on /app/account/profile, so policy
 * enforcement and field validation can't drift between the two surfaces.
 */
export function ChangePasswordForm({
  variant = "card",
  submitLabel,
  onSuccess,
  showInlineError = true,
}: ChangePasswordFormProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const policy = validatePasswordPolicy(newPassword, {
        email: user?.email,
        displayName: user?.displayName,
      });
      if (!policy.ok) throw new Error(policy.reason);
      if (newPassword !== confirm) throw new Error("Passwords do not match");
      if (newPassword === currentPassword)
        throw new Error("Pick a password different from your current one");
      const res = await apiRequest("POST", "/api/v1/auth/change-password", {
        currentPassword,
        newPassword,
      });
      return res.json();
    },
    onSuccess: async () => {
      // Refresh auth snapshot — server bumped sessionEpoch and cleared
      // mustChangeOnNextLogin; this session was refreshed in place.
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      onSuccess?.();
    },
    onError: (err: Error) => {
      // A 401 here means the server has no valid session for this request
      // (e.g. the login cookie never established in this browser context,
      // or the session expired before submit). Don't strand the user on a
      // raw "401: Authentication required" — clear the stale auth snapshot
      // and bounce them to /login to re-authenticate. The global
      // redirectToLoginIfNeeded intentionally skips /api/v1/auth/* paths,
      // so we handle the redirect here.
      if (err instanceof ApiError && err.status === 401) {
        queryClient.setQueryData(AUTH_QUERY_KEY, null);
        broadcastAuthEvent({ type: "revoked", reason: "session_revoked" });
        toast({
          title: "Please sign in again",
          description:
            "Your session expired before the password change could be saved. Sign in and try again.",
          variant: "destructive",
        });
        setLocation("/login");
        return;
      }
      setError(err.message);
    },
  });

  const isPage = variant === "page";

  return (
    <>
      {showInlineError && error && (
        <Alert variant="destructive" className={isPage ? "" : "mb-4"} data-testid="alert-change-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="current">Current password</Label>
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            data-testid="input-change-current"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new">New password</Label>
          <Input
            id="new"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            data-testid="input-change-new"
          />
          <p className="text-xs text-muted-foreground">
            At least 12 characters; mix letters, numbers, and symbols (or use a passphrase of 16+).
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="input-change-confirm"
          />
        </div>
        <Button
          type="submit"
          className={isPage ? "w-full" : ""}
          disabled={mutation.isPending}
          data-testid="button-change-submit"
        >
          {mutation.isPending ? "Saving…" : (submitLabel ?? "Change password")}
        </Button>
      </form>
    </>
  );
}
