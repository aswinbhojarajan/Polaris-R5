import polarisWordmark from "@assets/Polaris_wordmark_+_compass_logo_1778616793927.svg";
import kearneyIgnite from "@assets/Icon_-_Kearney_Ignite_1778616793927.svg";
import floralMotif from "@assets/Floral_Motif_21cd9196e9d1590723e1a7c44a04a36090f7a1e9_1778617279069.jpg";

const BRAND_INK = "#2C2665";
const BRAND_LAVENDER = "hsl(255, 65%, 93%)";

export const AUTH_BRAND_INK = BRAND_INK;

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
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
              data-testid="text-auth-title"
            >
              {title}
            </h1>
            {subtitle && (
              <p
                className="text-sm mt-1"
                style={{ color: "hsl(252, 20%, 45%)" }}
                data-testid="text-auth-subtitle"
              >
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
