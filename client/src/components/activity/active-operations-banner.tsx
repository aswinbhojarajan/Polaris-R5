import { Loader2, Activity, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  useClientActivityItems,
  activityKindLabel,
  activityItemHref,
} from "@/hooks/use-client-activity";
import type { ActivityItem, ActivityKind } from "@shared/schema";
import { useAuth } from "@/lib/auth";

/**
 * Task #56 — Shown at the top of project-scoped pages so every viewer of the
 * same project sees in-flight work started by anyone (themselves or another
 * user). Polls every 5s via {@link useClientActivityItems} (slows to 30s
 * when the project is idle); renders nothing when the project is idle so
 * it never adds visual noise.
 *
 * `excludeKinds` lets a page suppress its own kind (e.g. the Reports page
 * already has a per-row report-generation status, so it passes
 * `excludeKinds={['report_generation']}`).
 */
export function ActiveOperationsBanner({
  clientId,
  excludeKinds = [],
}: {
  clientId: string | null | undefined;
  excludeKinds?: ActivityKind[];
}) {
  const items = useClientActivityItems(clientId);
  const auth = useAuth();
  const myId = auth?.user?.id;
  const filtered = items.filter((i) => !excludeKinds.includes(i.kind));
  if (!clientId || filtered.length === 0) return null;

  return (
    <Alert className="mb-4 border-primary/40 bg-primary/5" data-testid="banner-active-operations">
      <Activity className="h-4 w-4 text-primary" />
      <AlertTitle className="flex items-center gap-2">
        Active operations
        <Badge variant="outline" className="text-xs">{filtered.length}</Badge>
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-1 text-sm">
          {filtered.map((item) => {
            const startedAgo = formatStartedAgo(item.startedAt);
            return (
              <li
                key={item.id}
                className="flex flex-col gap-1"
                data-testid={`activity-item-${item.kind}-${item.refId ?? item.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                  <Link
                    href={activityItemHref(item)}
                    className="font-medium hover:underline inline-flex items-center gap-1"
                    data-testid={`link-activity-${item.kind}-${item.refId ?? item.id}`}
                  >
                    {activityKindLabel(item.kind)}
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </Link>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`text-activity-attribution-${item.kind}-${item.refId ?? item.id}`}
                  >
                    {attribution(item, myId)}
                    {startedAgo ? ` ${startedAgo}` : ""}
                  </span>
                  {item.progress != null && item.progress > 0 && (
                    <span className="text-xs text-muted-foreground">
                      · {Math.round(item.progress)}%
                    </span>
                  )}
                </div>
                {item.progress != null && item.progress > 0 && item.progress < 100 && (
                  <Progress
                    value={item.progress}
                    className="h-1 ml-5"
                    data-testid={`progress-activity-${item.kind}-${item.refId ?? item.id}`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function attribution(item: ActivityItem, myId: string | undefined): string {
  if (item.startedByUserId && myId && item.startedByUserId === myId) {
    return "started by you";
  }
  const name = item.startedByDisplayName || item.startedByEmail;
  if (name) return `started by ${name}`;
  return "started in background";
}

function formatStartedAgo(startedAt: string | Date | null | undefined): string {
  if (!startedAt) return "";
  try {
    const d = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
    if (Number.isNaN(d.getTime())) return "";
    return `· ${formatDistanceToNow(d, { addSuffix: true })}`;
  } catch {
    return "";
  }
}

/**
 * Returns true when any in-flight activity for this project matches the
 * given kind. Used by pages to soft-disable their own trigger button(s)
 * (e.g. hide the "Refresh Prompts" CTA when one is already running).
 */
export function useIsKindActive(
  clientId: string | null | undefined,
  kind: ActivityKind,
): boolean {
  const items = useClientActivityItems(clientId);
  return items.some((i) => i.kind === kind);
}
