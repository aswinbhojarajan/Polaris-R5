import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Loader2, Eye, EyeOff, KeyRound, Lock } from "lucide-react";
import { useAuth, useLogin } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import polarisWordmark from "@assets/Polaris_wordmark_+_compass_logo_1778616793927.svg";
import kearneyIgnite from "@assets/Icon_-_Kearney_Ignite_1778616793927.svg";
import floralMotif from "@assets/Floral_Motif_21cd9196e9d1590723e1a7c44a04a36090f7a1e9_1778617279069.jpg";

const ENABLE_SSO = import.meta.env.VITE_ENABLE_SSO === "true";
const REQUEST_ACCESS_EMAIL = import.meta.env.VITE_REQUEST_ACCESS_EMAIL as
  | string
  | undefined;

const BRAND_INK = "#2C2665";
const BRAND_LAVENDER = "hsl(255, 65%, 93%)";

export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const login = useLogin();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation("/app/clients");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email: email.trim(), password, rememberMe });
      setLocation("/app/clients");
    } catch (err: any) {
      const message = err?.message || "Login failed";
      const cleaned = message.replace(/^\d+:\s*/, "");
      try {
        const parsed = JSON.parse(cleaned);
        setError(parsed.message || cleaned);
      } catch {
        setError(cleaned);
      }
    }
  };

  const onRequestAccess = (e: React.MouseEvent) => {
    if (REQUEST_ACCESS_EMAIL) return;
    e.preventDefault();
    toast({
      title: "Request access",
      description:
        "Contact your organization admin for an invitation to Polaris.",
    });
  };

  return (
    <div
      className="relative min-h-screen grid lg:grid-cols-2"
      style={{
        backgroundColor: BRAND_LAVENDER,
        backgroundImage: `url(${floralMotif})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <aside
        className="relative hidden lg:flex overflow-hidden"
        data-testid="panel-brand"
      >
        <div className="relative flex flex-1 flex-col items-center justify-center px-10 text-center">
          <img
            src={polarisWordmark}
            alt="Polaris"
            className="w-[420px] max-w-full h-auto"
            data-testid="img-polaris-wordmark"
          />
          <h2
            className="mt-10 text-3xl font-semibold"
            style={{ color: BRAND_INK }}
            data-testid="text-brand-tagline"
          >
            Search Leadership for the AI Era
          </h2>
          <p
            className="mt-3 text-base"
            style={{ color: "hsl(252, 30%, 38%)" }}
            data-testid="text-brand-subtitle"
          >
            Secure access for authorised teams
          </p>
        </div>

        <div className="absolute bottom-8 left-10">
          <img
            src={kearneyIgnite}
            alt="Kearney Ignite"
            className="h-10 w-auto"
            data-testid="img-kearney-ignite"
          />
        </div>
      </aside>

      <main
        className="relative flex items-center justify-center p-6 sm:p-10"
        style={{
          background: `linear-gradient(135deg, hsla(255, 55%, 88%, 0.92) 0%, hsla(255, 70%, 96%, 0.94) 45%, hsla(0, 0%, 100%, 0.96) 100%)`,
        }}
      >
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1
              className="text-3xl font-bold tracking-tight"
              style={{ color: BRAND_INK }}
              data-testid="text-login-title"
            >
              Welcome back
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: "hsl(252, 20%, 45%)" }}
            >
              Sign in to continue to your Polaris workspace.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-sm font-semibold"
                style={{ color: BRAND_INK }}
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
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-sm font-semibold"
                style={{ color: BRAND_INK }}
              >
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-lg bg-white border-transparent shadow-sm pr-10 placeholder:text-[hsl(252,15%,60%)]"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded text-[hsl(252,20%,45%)] hover:text-[hsl(252,55%,18%)]"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: BRAND_INK }}
              >
                <Checkbox
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMe(v === true)}
                  className="h-[18px] w-[18px] rounded-[4px] bg-white border-[hsl(252,20%,70%)] data-[state=checked]:bg-[#2C2665] data-[state=checked]:border-[#2C2665] data-[state=checked]:text-white"
                  data-testid="checkbox-remember-me"
                />
                Keep me signed in
              </label>
              <a
                href="/forgot-password"
                className="text-sm font-semibold hover:underline text-[#2C2665]"
                data-testid="link-forgot-password"
              >
                Forgot password?
              </a>
            </div>

            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "hsl(252, 20%, 45%)" }}
              data-testid="text-auth-badge"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Protected by enterprise-grade authentication
            </div>

            {error && (
              <p
                className="text-sm text-destructive"
                data-testid="text-login-error"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full h-12 rounded-lg text-white font-semibold bg-[#2C2665] hover:bg-[#1F1B4A]"
              disabled={login.isPending}
              data-testid="button-submit-login"
            >
              {login.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Sign in
            </Button>

            {ENABLE_SSO && (
              <>
                <div className="relative py-1">
                  <Separator />
                  <span
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-3 text-xs uppercase tracking-wider"
                    style={{
                      backgroundColor: "hsl(255, 70%, 96%)",
                      color: "hsl(252, 20%, 45%)",
                    }}
                  >
                    or
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 rounded-lg bg-white"
                  onClick={() =>
                    toast({
                      title: "SSO coming soon",
                      description:
                        "Single sign-on isn't enabled for this workspace yet.",
                    })
                  }
                  data-testid="button-sso"
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  Continue with SSO
                </Button>
              </>
            )}

            <p
              className="text-center text-sm pt-2"
              style={{ color: "hsl(252, 20%, 45%)" }}
            >
              Need access?{" "}
              <a
                href={
                  REQUEST_ACCESS_EMAIL
                    ? `mailto:${REQUEST_ACCESS_EMAIL}?subject=Polaris%20access%20request`
                    : "#"
                }
                onClick={onRequestAccess}
                className="font-semibold hover:underline text-[#2C2665]"
                data-testid="link-request-access"
              >
                Request access
              </a>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
