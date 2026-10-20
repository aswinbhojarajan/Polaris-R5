import { Loader2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  activityKindLabel,
  activityItemHref,
} from "@/hooks/use-client-activity";
import type { ActivitySummary } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

/**
 * Task #56 — "N in progress" pill for project tiles on the catalog. Click
 * opens a popover listing each in-flight operation with its kind, who
 * started it, when it started, optional progress, and a deep link to the
 * page that owns the action. Renders nothing when the project has no
 * in-flight work.
 *
 * Uses the `items` returned by the catalog summary endpoint directly — no
 * per-tile activity poll. The single summary query already polls on the
 * shared cadence and includes everything the popover needs.
 */
export function ActivityChip({ summary }: { summary: ActivitySummary | undefined }) {
  if (!summary || summary.count === 0) return null;
  const items = summary.items ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="default"
          className="gap-1 bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
          data-testid={`chip-activity-${summary.clientId}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {summary.count} in progress
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        onClick={(e) => e.stopPropagation()}
        data-testid={`popover-activity-${summary.clientId}`}
      >
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Active operations ({summary.count})
          </div>
          {items.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {summary.kinds.map(activityKindLabel).join(", ")}
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const who =
                  item.startedByDisplayName ||
                  item.startedByEmail ||
                  "background";
                const when = item.startedAt
                  ? formatDistanceToNow(new Date(item.startedAt), { addSuffix: true })
                  : "just now";
                return (
                  <li
                    key={item.id}
                    className="text-xs space-y-0.5"
                    data-testid={`popover-item-${item.kind}-${item.refId ?? item.id}`}
                  >
                    <Link
                      href={activityItemHref(item)}
                      className="inline-flex items-center gap-1 font-medium hover:underline"
                    >
                      {activityKindLabel(item.kind)}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </Link>
                    <div className="text-muted-foreground">
                      by {who} · {when}
                      {item.progress != null && item.progress > 0
                        ? ` · ${Math.round(item.progress)}%`
                        : ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
