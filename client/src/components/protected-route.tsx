import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSelectedClientId, setSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** When true, just require authentication, not a selected client. */
  authOnly?: boolean;
}

export default function ProtectedRoute({ children, authOnly = false }: ProtectedRouteProps) {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading, session } = useAuth();
  const selectedClientId = useSelectedClientId();

  // Force the change-password interstitial whenever the session carries
  // `mustChangePassword=true` (admin-issued temp password, etc.).
  const mustChange = !!session?.mustChangePassword;

  // Treat a deep-linked `?clientId=` as satisfying the "client selected"
  // gate so first-load deep links to /app/client-config?clientId=<id>,
  // /app/site-xray?clientId=<id>, etc. don't bounce to /app/clients
  // before the page's URL→storage reconciliation effect runs.
  const urlClientId = useUrlClientId();
  const hasClientContext = !!(selectedClientId || urlClientId);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    if (mustChange && location !== "/change-password") {
      setLocation("/change-password");
      return;
    }
    if (!authOnly && !hasClientContext) {
      setLocation("/app/clients");
    }
  }, [isAuthenticated, isLoading, authOnly, hasClientContext, mustChange, location, setLocation]);

  // Centralized URL → canonical-store reconciliation. Any protected page
  // visited with `?clientId=<id>` writes that id into the shared store so
  // the topbar, sidebar, and every page that reads `useSelectedClientId()`
  // immediately reflect the URL — even on first load with empty storage
  // (deep links, middle-clicked sidebar links, etc.).
  useEffect(() => {
    if (!isAuthenticated || authOnly) return;
    if (urlClientId && urlClientId !== selectedClientId) {
      setSelectedClientId(urlClientId);
    }
  }, [isAuthenticated, authOnly, urlClientId, selectedClientId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) return null;
  if (mustChange) return null;
  if (!authOnly && !hasClientContext) return null;

  return <>{children}</>;
}
