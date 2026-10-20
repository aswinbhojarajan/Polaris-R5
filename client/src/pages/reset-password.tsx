import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { validatePasswordPolicy } from "@shared/schema";
import { AuthLayout, AUTH_BRAND_INK } from "@/components/layout/auth-layout";

interface GrantStatus {
  status: "valid";
  kind: "invitation" | "password_reset" | "magic_link" | "temp_password";
  email: string;
  expiresAt: string;
}

export default function ResetPasswordPage() {
  const [, params] = useRoute<{ token: string }>("/reset-password/:token");
  const [, setLocation] = useLocation();
  const token = params?.token ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery<GrantStatus>({
    queryKey: ["/api/v1/auth/credential-grants", token],
    queryFn: async () => {
      const res = await fetch(`/api/v1/auth/credential-grants/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Invalid or expired link");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const redeem = useMutation({
    mutationFn: async () => {
      const policy = validatePasswordPolicy(password, {
        email: statusQuery.data?.email,
        displayName,
      });
      if (!policy.ok) throw new Error(policy.reason);
      if (password !== confirm) throw new Error("Passwords do not match");
      const res = await apiRequest(
        "POST",
        `/api/v1/auth/credential-grants/${token}/redeem`,
        { password, displayName: displayName || undefined },
      );
      return res.json();
    },
    onSuccess: () => setLocation("/login?reset=ok"),
    onError: (err: Error) => setError(err.message),
  });

  if (!token) return <ErrorState message="Missing token" />;
  if (statusQuery.isLoading) {
    return (
      <AuthLayout title="Just a moment…" subtitle="Validating your link.">
        <div className="flex items-center justify-center py-8">
          <Loader2
            className="h-6 w-6 animate-spin"
            style={{ color: AUTH_BRAND_INK }}
          />
        </div>
      </AuthLayout>
    );
  }
  if (statusQuery.isError) {
    return <ErrorState message={(statusQuery.error as Error).message} />;
  }
  const status = statusQuery.data;
  if (!status) return <ErrorState message="Invalid link" />;

  const isInvite = status.kind === "invitation";

  return (
    <AuthLayout
      title={isInvite ? "Welcome — set your password" : "Choose a new password"}
      subtitle={`For ${status.email}`}
    >
      {error && (
        <Alert
          variant="destructive"
          className="mb-4"
          data-testid="alert-reset-error"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          redeem.mutate();
        }}
      >
        {isInvite && (
          <div className="space-y-2">
            <Label
              htmlFor="displayName"
              className="text-sm font-semibold"
              style={{ color: AUTH_BRAND_INK }}
            >
              Display name (optional)
            </Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-11 rounded-lg bg-white border-transparent shadow-sm placeholder:text-[hsl(252,15%,60%)]"
              data-testid="input-reset-display-name"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label
            htmlFor="password"
            className="text-sm font-semibold"
            style={{ color: AUTH_BRAND_INK }}
          >
            New password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg bg-white border-transparent shadow-sm placeholder:text-[hsl(252,15%,60%)]"
            data-testid="input-reset-password"
          />
          <p className="text-xs" style={{ color: "hsl(252, 20%, 45%)" }}>
            At least 12 characters, mixing letters/numbers/symbols — or a
            passphrase of 16+.
          </p>
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="confirm"
            className="text-sm font-semibold"
            style={{ color: AUTH_BRAND_INK }}
          >
            Confirm new password
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-11 rounded-lg bg-white border-transparent shadow-sm placeholder:text-[hsl(252,15%,60%)]"
            data-testid="input-reset-confirm"
          />
        </div>
        <Button
          type="submit"
          className="w-full h-12 rounded-lg text-white font-semibold bg-[#2C2665] hover:bg-[#1F1B4A]"
          disabled={redeem.isPending}
          data-testid="button-reset-submit"
        >
          {redeem.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {isInvite ? "Create account" : "Set new password"}
        </Button>
      </form>

      <p
        className="text-center text-sm pt-6"
        style={{ color: "hsl(252, 20%, 45%)" }}
      >
        <Link
          href="/login"
          className="font-semibold hover:underline text-[#2C2665]"
          data-testid="link-back-to-login"
        >
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <AuthLayout
      title="Link unavailable"
      subtitle="This link can no longer be used."
    >
      <Alert variant="destructive" data-testid="alert-reset-invalid">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <p
        className="text-center text-sm pt-6 space-x-4"
        style={{ color: "hsl(252, 20%, 45%)" }}
      >
        <Link
          href="/forgot-password"
          className="font-semibold hover:underline text-[#2C2665]"
          data-testid="link-forgot"
        >
          Request a new link
        </Link>
        <Link
          href="/login"
          className="font-semibold hover:underline text-[#2C2665]"
          data-testid="link-back-to-login"
        >
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
