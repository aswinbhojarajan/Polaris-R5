import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import AppLayout from "@/components/layout/app-layout";
import Login from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import ChangePasswordPage from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";
import PromptsTracker from "@/pages/prompts-tracker";
import ClientConfiguration from "@/pages/client-configuration";
import ClientCatalog from "@/pages/client-catalog";
import MetadataTopics from "@/pages/metadata-topics";
import MetadataPrompts from "@/pages/metadata-prompts";
import SiteXRay from "@/pages/site-xray";
import CitationAnalysis from "@/pages/citation-analysis";
import Recommendations from "@/pages/recommendations";
import ContentGenerator from "@/pages/content-generator";
import Reports from "@/pages/reports";
import AdminUsersPage from "@/pages/admin/admin-users";
import AdminProjectsPage from "@/pages/admin/admin-projects";
import AdminAuditPage from "@/pages/admin/admin-audit";
import AdminQueuePage from "@/pages/admin/admin-queue";
import AdminModelsPage from "@/pages/admin/admin-models";
import AdminDashboardPage from "@/pages/admin/admin-dashboard";
import AccountSessionsPage from "@/pages/account/sessions";
import ProfilePage from "@/pages/account/profile";
import ProtectedRoute from "@/components/protected-route";
import { useEffect } from "react";
import { installAuthBroadcastListener } from "@/lib/auth";
import { useBodyPointerEventsGuard } from "@/hooks/use-body-pointer-events-guard";
import { useSelectedClientId } from "@/hooks/use-selected-client-id";
import { ErrorBoundary } from "@/components/error-boundary";
import { NetworkBanner } from "@/components/feedback/NetworkBanner";

function AppRoutes() {
  const selectedClientId = useSelectedClientId();

  return (
    <AppLayout>
      <Switch>
        <Route path="/app">
          {selectedClientId ? <Redirect to="/app/dashboard" /> : <Redirect to="/app/clients" />}
        </Route>
        <Route path="/app/clients">
          <ProtectedRoute authOnly>
            <ClientCatalog />
          </ProtectedRoute>
        </Route>
        <Route path="/app/dashboard">
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        </Route>
        <Route path="/app/prompts">
          <ProtectedRoute>
            <PromptsTracker />
          </ProtectedRoute>
        </Route>
        <Route path="/app/client-config">
          <ProtectedRoute>
            <ClientConfiguration />
          </ProtectedRoute>
        </Route>
        <Route path="/app/site-xray">
          <ProtectedRoute>
            <SiteXRay />
          </ProtectedRoute>
        </Route>
        <Route path="/app/topics-keywords">
          <ProtectedRoute>
            <MetadataTopics />
          </ProtectedRoute>
        </Route>
        <Route path="/app/prompt-library">
          <ProtectedRoute>
            <MetadataPrompts />
          </ProtectedRoute>
        </Route>
        <Route path="/app/citation-analysis">
          <ProtectedRoute>
            <CitationAnalysis />
          </ProtectedRoute>
        </Route>
        <Route path="/app/recommendations">
          <ProtectedRoute>
            <Recommendations />
          </ProtectedRoute>
        </Route>
        <Route path="/app/content-generator">
          <ProtectedRoute>
            <ContentGenerator />
          </ProtectedRoute>
        </Route>
        <Route path="/app/reports">
          <ProtectedRoute>
            <Reports />
          </ProtectedRoute>
        </Route>
        <Route path="/app/admin">
          <ProtectedRoute authOnly>
            <AdminDashboardPage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/admin/users">
          <ProtectedRoute authOnly>
            <AdminUsersPage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/admin/projects">
          <ProtectedRoute authOnly>
            <AdminProjectsPage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/admin/audit">
          <ProtectedRoute authOnly>
            <AdminAuditPage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/admin/queue">
          <ProtectedRoute authOnly>
            <AdminQueuePage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/admin/models">
          <ProtectedRoute authOnly>
            <AdminModelsPage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/account/profile">
          <ProtectedRoute authOnly>
            <ProfilePage />
          </ProtectedRoute>
        </Route>
        <Route path="/app/account/sessions">
          <ProtectedRoute authOnly>
            <AccountSessionsPage />
          </ProtectedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  // Global guard: when a Radix Dialog/Sheet is opened from inside a
  // DropdownMenuItem, the cleanup race can leave `pointer-events: none`
  // stuck on <body>, freezing the page until reload. The hook watches
  // body's inline style and clears it whenever no Radix overlay is open.
  useBodyPointerEventsGuard();
  // Cross-tab logout coordination (Task #37). When any tab signs out (or
  // gets a 401 with a known revocation reason), every sibling tab clears
  // its query cache, surfaces a toast explaining why, and routes back to
  // /login. The reason taxonomy mirrors `requireAuth.destroyAndReject`.
  useEffect(() => {
    const reasonCopy: Record<string, string> = {
      idle_timeout: "Your session timed out due to inactivity.",
      absolute_timeout: "Your session reached its maximum age.",
      session_revoked: "Your session was ended remotely.",
      account_disabled: "Your account is no longer active.",
    };
    installAuthBroadcastListener({
      onLogout: () => {
        queryClient.clear();
        if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.replace("/login");
        }
      },
      onRevoked: (reason?: string) => {
        queryClient.clear();
        const description =
          (reason && reasonCopy[reason]) ||
          "Your session was ended in another tab.";
        // Best-effort toast — works on any page that has the Toaster
        // mounted (every authed page). Imported lazily so this listener
        // doesn't pull the toast surface into the login bundle.
        import("@/hooks/use-toast").then(({ toast }) => {
          toast({ title: "Signed out", description, variant: "destructive" });
        });
        if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.replace("/login");
        }
      },
    });
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {/* Task #114 — global network/server-down banner + render
            crash boundary. ErrorBoundary auto-resets on route change. */}
        <NetworkBanner />
        <ErrorBoundary>
        <Switch>
          <Route path="/">
            <Redirect to="/app/clients" />
          </Route>
          <Route path="/login" component={Login} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password/:token" component={ResetPasswordPage} />
          <Route path="/change-password" component={ChangePasswordPage} />
          {/* Anonymous wildcard: regexparam v3 (used by wouter v3) treats `:rest*` as
              optional SINGLE segment, so `/app/admin/users` would 404. `*?` is a true
              optional rest match and covers `/app`, `/app/x`, `/app/x/y`, etc. */}
          <Route path="/app/*?">
            <AppRoutes />
          </Route>
          <Route component={NotFound} />
        </Switch>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
