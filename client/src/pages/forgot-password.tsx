import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { AuthLayout, AUTH_BRAND_INK } from "@/components/layout/auth-layout";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (input: { email: string }) => {
      const res = await apiRequest("POST", "/api/v1/auth/forgot-password", input);
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
  });

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter the email associated with your account. If we find a match, we'll send a reset link."
    >
      {submitted ? (
        <Alert
          className="bg-white border-transparent shadow-sm"
          data-testid="alert-forgot-submitted"
        >
          <AlertDescription style={{ color: AUTH_BRAND_INK }}>
            If that email is on file, a reset link is on its way. Check your
            inbox (and spam) — links expire after one hour.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({ email });
          }}
        >
          <div className="space-y-2">
            <Label
              htmlFor="email"
              className="text-sm font-semibold"
              style={{ color: AUTH_BRAND_INK }}
            >
              Work email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="yourname@company.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-lg bg-white border-transparent shadow-sm placeholder:text-[hsl(252,15%,60%)]"
              data-testid="input-forgot-email"
            />
          </div>
          <Button
            type="submit"
            className="w-full h-12 rounded-lg text-white font-semibold bg-[#2C2665] hover:bg-[#1F1B4A]"
            disabled={mutation.isPending || !email}
            data-testid="button-forgot-submit"
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Send reset link
          </Button>
        </form>
      )}

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
