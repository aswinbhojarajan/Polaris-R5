import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Monitor, Smartphone, Tablet, ShieldOff } from "lucide-react";

/**
 * Active sessions page (Task #37).
 *
 *   - Lists every session the server has on file for the signed-in user.
 *   - Highlights the row matching the current browser tab's session.
 *   - Lets the user revoke individual sessions or all of the others in
 *     one click (which bumps the user's session epoch server-side).
 *
 * The user-agent string is parsed via a tiny inline regex helper (no
 * import) so the dependency does not bloat the main bundle.
 */

interface SessionRow {
  sessionId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface SessionsResponse {
  currentSessionId: string;
  sessions: SessionRow[];
}

const QK = ["/api/v1/auth/sessions"] as const;

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return iso;
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function deviceIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("mobile") || l.includes("phone")) return Smartphone;
  if (l.includes("tablet") || l.includes("ipad")) return Tablet;
  return Monitor;
}

function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  let browser = "Unknown browser";
  // Order matters: Edge UAs contain "Chrome", Chrome contain "Safari".
  const browserMatchers: Array<[RegExp, string]> = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+).*Safari/, "Safari"],
  ];
  for (const [re, name] of browserMatchers) {
    const m = ua.match(re);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X (\d+[._]\d+)/.test(ua)) {
    const m = ua.match(/Mac OS X (\d+[._]\d+)/);
    os = `macOS ${m?.[1]?.replace("_", ".") ?? ""}`.trim();
  } else if (/Android (\d+)/.test(ua)) {
    os = `Android ${ua.match(/Android (\d+)/)?.[1] ?? ""}`.trim();
  } else if (/(iPhone|iPad).*OS (\d+_\d+)/.test(ua)) {
    const m = ua.match(/OS (\d+_\d+)/);
    os = `iOS ${m?.[1]?.replace("_", ".") ?? ""}`.trim();
  } else if (/Linux/.test(ua)) os = "Linux";
  let device = "desktop";
  if (/Mobile|iPhone|Android.*Mobile/.test(ua)) device = "mobile";
  else if (/Tablet|iPad/.test(ua)) device = "tablet";
  return { browser, os, device };
}

export default function AccountSessionsPage() {
  const { toast } = useToast();
  const [parsed, setParsed] = useState<Record<string, { browser: string; os: string; device: string }>>({});
  const [confirmCurrentRevokeId, setConfirmCurrentRevokeId] = useState<string | null>(null);

  const sessionsQuery = useQuery<SessionsResponse>({ queryKey: QK });

  // Tiny inline UA parser. We only need a friendly "Browser on OS"
  // label for the sessions list — pulling in ua-parser-js@2.x (AGPL)
  // or any other heavy dep is overkill and a license risk.
  useEffect(() => {
    const data = sessionsQuery.data;
    if (!data) return;
    const next: Record<string, { browser: string; os: string; device: string }> = {};
    for (const row of data.sessions) {
      if (!row.userAgent) continue;
      next[row.sessionId] = parseUserAgent(row.userAgent);
    }
    setParsed(next);
  }, [sessionsQuery.data]);

  const revokeOne = useMutation({
    mutationFn: async (args: { sessionId: string; current: boolean }) => {
      await apiRequest("DELETE", `/api/v1/auth/sessions/${args.sessionId}`);
      return args;
    },
    onSuccess: (args) => {
      queryClient.invalidateQueries({ queryKey: QK });
      toast({ title: "Session revoked" });
      // Revoking the current session also clears this tab's cookie
      // server-side. Bounce to /login so the UI matches.
      if (args.current && typeof window !== "undefined") {
        window.location.assign("/login");
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed to revoke", description: err?.message, variant: "destructive" });
    },
  });

  const signOutOthers = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/v1/auth/sessions/sign-out-others");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK });
      toast({ title: "Signed out everywhere else" });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    },
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const otherCount = useMemo(() => sessions.filter((s) => !s.current).length, [sessions]);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Card data-testid="card-sessions">
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>
            Sessions currently signed in to your account. Revoke any you don't recognize.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground" data-testid="text-session-count">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={otherCount === 0 || signOutOthers.isPending}
              onClick={() => signOutOthers.mutate()}
              data-testid="button-sign-out-others"
            >
              {signOutOthers.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldOff className="mr-2 h-4 w-4" />
              )}
              Sign out of all other sessions
            </Button>
          </div>

          {sessionsQuery.isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!sessionsQuery.isLoading && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No active sessions on record.</p>
          )}

          <div className="divide-y rounded-md border">
            {sessions.map((s) => {
              const meta = parsed[s.sessionId];
              const label = meta ? `${meta.browser} on ${meta.os}` : s.userAgent || "Unknown device";
              const Icon = deviceIcon(meta?.device || label);
              return (
                <div
                  key={s.sessionId}
                  className="flex items-center justify-between p-4"
                  data-testid={`row-session-${s.sessionId}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-1 h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium" data-testid={`text-session-label-${s.sessionId}`}>
                          {label}
                        </p>
                        {s.current && (
                          <Badge variant="secondary" data-testid={`badge-current-${s.sessionId}`}>
                            This device
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.ipAddress ? `${s.ipAddress} · ` : ""}signed in {relativeTime(s.createdAt)} · last seen{" "}
                        {relativeTime(s.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revokeOne.isPending}
                    onClick={() => {
                      if (s.current) {
                        setConfirmCurrentRevokeId(s.sessionId);
                        return;
                      }
                      revokeOne.mutate({ sessionId: s.sessionId, current: s.current });
                    }}
                    data-testid={`button-revoke-${s.sessionId}`}
                  >
                    {s.current ? "Sign out this device" : "Revoke"}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmCurrentRevokeId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmCurrentRevokeId(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-revoke-current">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out this device?</AlertDialogTitle>
            <AlertDialogDescription>
              Revoking this device will sign you out here. You'll need to sign in
              again to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revoke-current">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmCurrentRevokeId) {
                  revokeOne.mutate({ sessionId: confirmCurrentRevokeId, current: true });
                }
                setConfirmCurrentRevokeId(null);
              }}
              data-testid="button-confirm-revoke-current"
            >
              Sign out this device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
