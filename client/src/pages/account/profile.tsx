import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cleanErrorMessage } from "@/lib/api-errors";
import { useAuth, AUTH_QUERY_KEY, type AuthSession } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { Loader2 } from "lucide-react";

const MAX_DISPLAY_NAME = 60;

export default function ProfilePage() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [displayName, setDisplayName] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);

  // Sync the input with the canonical user record whenever it loads /
  // refetches (e.g. after a successful save invalidates AUTH_QUERY_KEY).
  useEffect(() => {
    if (user) setDisplayName(user.displayName ?? "");
  }, [user?.id, user?.displayName]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const trimmed = displayName.trim();
      if (trimmed.length > MAX_DISPLAY_NAME) {
        throw new Error(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer`);
      }
      const res = await apiRequest("PATCH", "/api/v1/auth/me", {
        displayName: trimmed.length === 0 ? null : trimmed,
      });
      return (await res.json()) as AuthSession;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      toast({ title: "Profile updated" });
    },
    onError: (err: unknown) => {
      setProfileError(cleanErrorMessage(err));
      errorToast("Couldn't update profile", err);
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return null;

  const currentName = user.displayName ?? "";
  const trimmed = displayName.trim();
  const normalized = trimmed.length === 0 ? "" : trimmed;
  const isDirty = normalized !== currentName;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-profile-title">
          Profile & security
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage how your name appears across Polaris and update your sign-in password.
        </p>
      </div>

      <Card data-testid="card-profile-info">
        <CardHeader>
          <CardTitle>Profile information</CardTitle>
          <CardDescription>
            Your display name appears in the top bar and to admins managing your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profileError && (
            <Alert variant="destructive" className="mb-4" data-testid="alert-profile-error">
              <AlertDescription>{profileError}</AlertDescription>
            </Alert>
          )}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setProfileError(null);
              saveProfile.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                readOnly
                disabled
                data-testid="input-email-readonly"
              />
              <p className="text-xs text-muted-foreground">
                Email changes aren't available yet — contact an admin if you need to update it.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                type="text"
                placeholder="Add a display name"
                maxLength={MAX_DISPLAY_NAME}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="input-display-name"
              />
              <p className="text-xs text-muted-foreground">
                Up to {MAX_DISPLAY_NAME} characters. Leave blank to fall back to your email.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={!isDirty || saveProfile.isPending}
                data-testid="button-save-profile"
              >
                {saveProfile.isPending ? "Saving…" : "Save changes"}
              </Button>
              {isDirty && !saveProfile.isPending && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDisplayName(currentName);
                    setProfileError(null);
                  }}
                  data-testid="button-reset-profile"
                >
                  Reset
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card data-testid="card-security">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Use your current password to set a new one. Other signed-in sessions will be ended.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChangePasswordForm
            variant="card"
            submitLabel="Update password"
            onSuccess={() =>
              toast({
                title: "Password updated",
                description: "Other devices have been signed out.",
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            Forgot your current password?{" "}
            <Link
              href="/forgot-password"
              className="text-primary underline-offset-4 hover:underline"
              data-testid="link-forgot-password"
            >
              Reset it via email.
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
