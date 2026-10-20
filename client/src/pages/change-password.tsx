import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export default function ChangePasswordPage() {
  const [, setLocation] = useLocation();
  const { user, session, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) {
    setLocation("/login");
    return null;
  }

  const forced = !!session?.mustChangePassword;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-change-title">
            {forced ? "Set a new password to continue" : "Change your password"}
          </h1>
          {forced && (
            <p className="text-sm text-muted-foreground mt-2">
              Your account is using a temporary or admin-issued password — please choose a permanent one before continuing.
            </p>
          )}
        </div>

        <ChangePasswordForm
          variant="page"
          onSuccess={() => setLocation("/app")}
        />
      </div>
    </div>
  );
}
