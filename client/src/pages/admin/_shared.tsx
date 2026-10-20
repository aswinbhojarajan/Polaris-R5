import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AdminRole = "admin" | "member" | "viewer";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export interface StatTileSpec {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "blue" | "emerald" | "amber" | "purple" | "rose" | "slate";
  hint?: string;
  testid?: string;
}

const TONE_CLASSES: Record<NonNullable<StatTileSpec["tone"]>, string> = {
  blue: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
  emerald: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  purple: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
  rose: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
  slate: "text-slate-600 dark:text-slate-300 bg-slate-500/10",
};

export function StatTile({ label, value, icon: Icon, tone = "blue", hint, testid }: StatTileSpec) {
  return (
    <Card data-testid={testid ?? `stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("rounded-lg p-2 flex items-center justify-center", TONE_CLASSES[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1 truncate">{label}</div>
          {hint && (
            <div className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{hint}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatRow({ tiles }: { tiles: StatTileSpec[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {tiles.map((t) => (
        <StatTile key={t.label} {...t} />
      ))}
    </div>
  );
}

export function roleBadgeClass(r: AdminRole): string {
  if (r === "admin")
    return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30";
  if (r === "viewer")
    return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30";
  return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
}

export type StatusTone = "active" | "disabled" | "invited" | "warning" | "neutral";

const STATUS_CLASSES: Record<StatusTone, string> = {
  active:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  disabled: "bg-destructive/10 text-destructive border-destructive/30",
  invited:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  warning:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  neutral: "bg-muted text-muted-foreground border-transparent",
};

export function StatusBadge({
  tone,
  children,
  testid,
}: {
  tone: StatusTone;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_CLASSES[tone])} data-testid={testid}>
      {children}
    </Badge>
  );
}

export function AdminForbidden({ what, testid }: { what: string; testid?: string }) {
  return (
    <div className="p-6 text-sm text-muted-foreground" data-testid={testid ?? "text-admin-forbidden"}>
      You need an admin role in this organization to {what}.
    </div>
  );
}

export function AdminPageShell({ children }: { children: ReactNode }) {
  return <div className="p-6 space-y-6">{children}</div>;
}

interface EmptyOrLoadingProps {
  loading?: boolean;
  empty?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyText?: string;
  loadingText?: string;
  colSpan: number;
  Wrapper?: ComponentType<{ children: ReactNode }>;
}

export function TableState({
  loading,
  empty,
  error,
  onRetry,
  emptyText = "Nothing to show.",
  loadingText = "Loading…",
  colSpan,
}: EmptyOrLoadingProps) {
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const requestId =
      typeof error === "object" && error && "requestId" in error
        ? String((error as { requestId?: unknown }).requestId ?? "")
        : "";
    return (
      <tr data-testid="row-table-error">
        <td colSpan={colSpan} className="py-6">
          <div className="flex flex-col items-center gap-2 text-sm">
            <div className="text-destructive">Couldn't load data.</div>
            <div className="text-muted-foreground max-w-xl text-center text-xs">
              {message}
              {requestId ? <> · Reference: <code>{requestId}</code></> : null}
            </div>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
                data-testid="button-table-retry"
              >
                Retry
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }
  if (!loading && !empty) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-sm text-muted-foreground py-8">
        {loading ? loadingText : emptyText}
      </td>
    </tr>
  );
}
