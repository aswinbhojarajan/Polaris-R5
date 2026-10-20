import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRole } from "@/hooks/use-role";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Sparkles,
  Layers,
  PowerOff,
  KeyRound,
  KeySquare,
  AlertTriangle,
  RotateCcw,
  Cog,
  Pause,
  Server,
  History,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { AdminForbidden, AdminPageShell, PageHeader, StatRow, TableState } from "./_shared";
import type { AiModel } from "@shared/schema";

type ModelUsage = {
  projectCount: number;
  inFlightItemCount: number;
  projectNames: string[];
};

type AiModelRow = AiModel & { isKeyAvailable?: boolean; isVendorPaused?: boolean };

// Mirror of the GET /api/v1/admin/providers response.
type ProviderRow = {
  vendor: string;
  envVar: string | null;
  keyConfigured: boolean;
  paused: boolean;
  pausedAt: string | null;
  pausedByUserId: string | null;
  pauseReason: string | null;
  modelCount: number;
  enabledModelCount: number;
  lastSuccessAt: string | null;
  inFlightItemCount: number;
  // Task #115 — rolling-24h error rate
  last24hErrorRate: number | null;
  last24hTotalCount: number;
  last24hErrorCount: number;
};

// Mirror of `ResolvedFunctionEntry` in `server/config/llm-functions.ts`.
type LlmFunctionRow = {
  functionKey: string;
  description: string;
  resolvedModel: string;
  source: "override" | "env" | "default";
  envVar: string;
  defaultModel: string;
  envModel: string | null;
  allowedVendors: string[];
  overrideModelId: string | null;
  overrideModelDisplayName: string | null;
  overrideModel: string | null;
  overrideActive: boolean;
  overrideUpdatedAt: string | null;
  overrideUpdatedBy: string | null;
};

const ADMIN_MODELS_KEY = ["/api/v1/admin/ai-models"] as const;
const ADMIN_LLM_FUNCTIONS_KEY = ["/api/v1/admin/llm-functions"] as const;
const ADMIN_PROVIDERS_KEY = ["/api/v1/admin/providers"] as const;

export default function AdminModelsPage() {
  const { canAdmin } = useRole();
  const { toast } = useToast();
  const errorToast = useErrorToast();
  // Task #73 — When the admin clicks the Enabled switch to OFF we first
  // fetch the model's live "blast radius" (active projects that selected
  // it + in-flight prompt_run_items). Zero/zero disables proceed
  // immediately with no dialog (per acceptance criteria). Non-zero usage
  // opens a confirm dialog with the impact summary so the admin can back
  // out. `pendingDisable` carries both the row and its fetched usage so
  // the dialog renders without re-fetching.
  const [pendingDisable, setPendingDisable] = useState<
    | { model: AiModelRow; usage: ModelUsage }
    | null
  >(null);
  const [checkingUsageId, setCheckingUsageId] = useState<string | null>(null);
  // Task #79 — Optional reason captured in the disable confirm dialog;
  // reset every time the dialog opens so a stale string from a prior
  // disable doesn't leak into the next one.
  const [disableReason, setDisableReason] = useState("");

  const modelsQuery = useQuery<AiModelRow[]>({
    queryKey: ADMIN_MODELS_KEY,
    enabled: canAdmin,
  });

  const categoryMutation = useMutation({
    mutationFn: async (vars: { id: string; category: "core" | "additional" }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/v1/admin/ai-models/${vars.id}/category`,
        { category: vars.category },
      );
      return (await res.json()) as AiModel;
    },
    onMutate: async ({ id, category }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_MODELS_KEY });
      const previous = queryClient.getQueryData<AiModelRow[]>(ADMIN_MODELS_KEY);
      if (previous) {
        queryClient.setQueryData<AiModelRow[]>(
          ADMIN_MODELS_KEY,
          previous.map((m) => (m.id === id ? { ...m, category } : m)),
        );
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ADMIN_MODELS_KEY, ctx.previous);
      }
      errorToast("Failed to update model", err);
    },
    onSuccess: (updated) => {
      toast({
        title: "Category updated",
        description: `${updated.displayName} is now ${updated.category === "core" ? "Core" : "Additional"}.`,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_MODELS_KEY });
      // Also bust the consumer-facing list so the wizard / configuration
      // accordion / start-run dialog re-fetch on next focus.
      queryClient.invalidateQueries({ queryKey: ["/api/v1/ai-models"] });
    },
  });

  const enabledMutation = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean; reason?: string }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/v1/admin/ai-models/${vars.id}/enabled`,
        { enabled: vars.enabled, reason: vars.reason },
      );
      return (await res.json()) as AiModel & {
        cancellation?: { items: number; runs: number; jobs: number };
        affectedClientCount?: number;
      };
    },
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_MODELS_KEY });
      const previous = queryClient.getQueryData<AiModelRow[]>(ADMIN_MODELS_KEY);
      if (previous) {
        queryClient.setQueryData<AiModelRow[]>(
          ADMIN_MODELS_KEY,
          previous.map((m) => (m.id === id ? { ...m, enabled } : m)),
        );
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ADMIN_MODELS_KEY, ctx.previous);
      }
      errorToast("Failed to update model", err);
    },
    onSuccess: (updated) => {
      // Task #79 — Surface the cascading impact (cancelled runs / swept
      // projects) in the success toast so the admin sees the side-effects
      // they just triggered without having to dig into the audit log.
      if (!updated.enabled) {
        const c = updated.cancellation ?? { items: 0, runs: 0, jobs: 0 };
        const swept = updated.affectedClientCount ?? 0;
        const parts: string[] = [];
        if (c.items > 0) parts.push(`${c.items} in-flight item${c.items === 1 ? "" : "s"} cancelled`);
        if (c.runs > 0) parts.push(`${c.runs} run${c.runs === 1 ? "" : "s"} errored`);
        if (swept > 0) parts.push(`${swept} project${swept === 1 ? "" : "s"} notified`);
        toast({
          title: "Model disabled",
          description: parts.length
            ? `${updated.displayName} disabled. ${parts.join(", ")}.`
            : `${updated.displayName} is hidden from project configuration and run dialogs.`,
        });
      } else {
        toast({
          title: "Model enabled",
          description: `${updated.displayName} is available again in project configuration.`,
        });
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_MODELS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/ai-models"] });
      // Disabling a model can degrade an existing function override, so
      // refetch the Functions tab too.
      queryClient.invalidateQueries({ queryKey: ADMIN_LLM_FUNCTIONS_KEY });
      // Task #79 — Audit history for this model has a new entry now.
      if (vars?.id) {
        queryClient.invalidateQueries({
          queryKey: ["/api/v1/admin/ai-models", vars.id, "audit"],
        });
      }
    },
  });

  const models = useMemo(() => {
    const list = [...(modelsQuery.data ?? [])];
    list.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.category !== b.category) return a.category === "core" ? -1 : 1;
      if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
      return a.displayName.localeCompare(b.displayName);
    });
    return list;
  }, [modelsQuery.data]);

  const enabledModels = models.filter((m) => m.enabled);
  const coreCount = enabledModels.filter((m) => m.category === "core").length;
  const additionalCount = enabledModels.length - coreCount;
  const disabledCount = models.length - enabledModels.length;

  if (!canAdmin) {
    return <AdminForbidden what="manage AI model categories" />;
  }

  return (
    <AdminPageShell>
      <PageHeader
        title="AI Models"
        subtitle="Manage which models appear in the project wizard and pin which model each internal LLM call uses."
      />

      <StatRow
        tiles={[
          {
            label: "Core models",
            value: coreCount,
            icon: Sparkles,
            tone: "purple",
            hint: "Shown by default in the wizard",
            testid: "stat-core-models",
          },
          {
            label: "Additional models",
            value: additionalCount,
            icon: Layers,
            tone: "blue",
            hint: "Hidden under the Additional accordion",
            testid: "stat-additional-models",
          },
          {
            label: "Disabled models",
            value: disabledCount,
            icon: PowerOff,
            tone: "amber",
            hint: "Hidden everywhere except this page",
            testid: "stat-disabled-models",
          },
        ]}
      />

      <ProvidersPanel />

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList data-testid="tabs-admin-models">
          <TabsTrigger value="catalog" data-testid="tab-catalog">
            Models
          </TabsTrigger>
          <TabsTrigger value="functions" data-testid="tab-functions">
            Functions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Catalog</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>API Key</TableHead>
                    <TableHead className="w-[140px]">Core</TableHead>
                    <TableHead className="w-[140px]">Enabled</TableHead>
                    <TableHead className="w-[80px]">History</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableState
                    loading={modelsQuery.isLoading}
                    empty={!modelsQuery.isLoading && !modelsQuery.isError && models.length === 0}
                    error={modelsQuery.isError ? modelsQuery.error : undefined}
                    onRetry={() => modelsQuery.refetch()}
                    emptyText="No AI models found."
                    colSpan={7}
                  />
                  {models.map((m) => {
                    const isCore = m.category === "core";
                    const hasKey = m.isKeyAvailable === true;
                    const categoryPending =
                      categoryMutation.isPending &&
                      categoryMutation.variables?.id === m.id;
                    const enabledPending =
                      enabledMutation.isPending &&
                      enabledMutation.variables?.id === m.id;
                    return (
                      <TableRow
                        key={m.id}
                        data-testid={`row-model-${m.id}`}
                        className={!m.enabled ? "opacity-60" : undefined}
                      >
                        <TableCell>
                          <div className="font-medium" data-testid={`text-model-name-${m.id}`}>
                            {m.displayName}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {m.model}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm" data-testid={`text-model-vendor-${m.id}`}>
                              {m.vendor}
                            </span>
                            {m.isVendorPaused && (
                              <Badge
                                variant="outline"
                                className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 gap-1 w-fit"
                                data-testid={`badge-vendor-paused-${m.id}`}
                                title="This vendor is paused — runs using any of its models will be refused with HTTP 503."
                              >
                                <Pause className="h-3 w-3" />
                                Vendor paused
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              isCore
                                ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"
                                : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                            }
                            data-testid={`badge-category-${m.id}`}
                          >
                            {isCore ? "Core" : "Additional"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {hasKey ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1"
                              data-testid={`badge-key-${m.id}`}
                            >
                              <KeyRound className="h-3 w-3" />
                              Key configured
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1"
                              data-testid={`badge-key-${m.id}`}
                              title="No API key set for this provider — runs using this model will fail until the key is added."
                            >
                              <KeySquare className="h-3 w-3" />
                              No key
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={isCore}
                            disabled={categoryPending || !m.enabled}
                            onCheckedChange={(checked) => {
                              if (checked && !hasKey) {
                                toast({
                                  title: "Heads up: no API key for this provider",
                                  description: `${m.displayName} will appear as a Core option, but prompt runs using it will fail until the ${m.vendor} API key is configured.`,
                                });
                              }
                              categoryMutation.mutate({
                                id: m.id,
                                category: checked ? "core" : "additional",
                              });
                            }}
                            aria-label={`Mark ${m.displayName} as Core`}
                            data-testid={`switch-core-${m.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={m.enabled}
                            disabled={
                              enabledPending ||
                              checkingUsageId === m.id ||
                              m.isVendorPaused === true
                            }
                            title={
                              m.isVendorPaused
                                ? `${m.vendor} is paused — un-pause the vendor in the Providers panel above to change this.`
                                : undefined
                            }
                            onCheckedChange={async (checked) => {
                              if (checked) {
                                enabledMutation.mutate({ id: m.id, enabled: true });
                                return;
                              }
                              // Disabling: fetch live usage (bypassing the
                              // global staleTime: Infinity default so we
                              // always get a fresh count). If nothing uses
                              // the model, disable straight away. Otherwise
                              // open the confirm dialog with the impact.
                              setCheckingUsageId(m.id);
                              try {
                                const usage = await queryClient.fetchQuery<ModelUsage>({
                                  queryKey: [
                                    "/api/v1/admin/ai-models",
                                    m.id,
                                    "usage",
                                  ],
                                  staleTime: 0,
                                });
                                if (
                                  usage.projectCount === 0 &&
                                  usage.inFlightItemCount === 0
                                ) {
                                  enabledMutation.mutate({ id: m.id, enabled: false });
                                } else {
                                  setPendingDisable({ model: m, usage });
                                }
                              } catch (err) {
                                // Usage check failed — fall back to showing a
                                // dialog with no impact summary so the admin
                                // can still proceed deliberately.
                                setPendingDisable({
                                  model: m,
                                  usage: {
                                    projectCount: -1,
                                    inFlightItemCount: -1,
                                    projectNames: [],
                                  },
                                });
                              } finally {
                                setCheckingUsageId(null);
                              }
                            }}
                            aria-label={`Enable ${m.displayName}`}
                            data-testid={`switch-enabled-${m.id}`}
                          />
                          {!m.enabled && m.disabledAt && (
                            <div
                              className="text-[11px] text-muted-foreground mt-1"
                              data-testid={`text-disabled-meta-${m.id}`}
                              title={m.disabledReason ?? undefined}
                            >
                              Disabled {new Date(m.disabledAt).toLocaleDateString()}
                              {m.disabledReason ? ` — ${m.disabledReason}` : ""}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <ModelHistoryPopover modelId={m.id} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="functions">
          <FunctionsTab enabledModels={enabledModels} />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={!!pendingDisable}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDisable(null);
            setDisableReason("");
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-disable-model">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Disable {pendingDisable?.model.displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Disabling hides this model from the project wizard, the
                  configuration page, and the run dialog. Existing project
                  configurations are not changed, but the model will be
                  silently skipped on their next scheduled run.
                </p>
                {pendingDisable && pendingDisable.usage.projectCount < 0 ? (
                  <p className="text-destructive">
                    Couldn't load current usage. You can still proceed, but
                    you won't see the impact summary.
                  </p>
                ) : pendingDisable ? (
                  <div
                    className="rounded-md border bg-muted/40 p-3 space-y-2"
                    data-testid="text-disable-impact"
                  >
                    <p className="font-medium">Impact:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      {pendingDisable.usage.projectCount > 0 && (
                        <li>
                          <span data-testid="text-impact-projects">
                            {pendingDisable.usage.projectCount}
                          </span>{" "}
                          active{" "}
                          {pendingDisable.usage.projectCount === 1
                            ? "project has"
                            : "projects have"}{" "}
                          this model selected
                          {pendingDisable.usage.projectNames.length > 0 && (
                            <>
                              {" "}
                              ({pendingDisable.usage.projectNames.join(", ")}
                              {pendingDisable.usage.projectCount >
                              pendingDisable.usage.projectNames.length
                                ? ", …"
                                : ""}
                              )
                            </>
                          )}
                          . Future runs will silently skip it.
                        </li>
                      )}
                      {pendingDisable.usage.inFlightItemCount > 0 && (
                        <li>
                          <span data-testid="text-impact-in-flight">
                            {pendingDisable.usage.inFlightItemCount}
                          </span>{" "}
                          in-flight prompt{" "}
                          {pendingDisable.usage.inFlightItemCount === 1
                            ? "item is"
                            : "items are"}{" "}
                          currently running against this model and will fail
                          mid-flight.
                        </li>
                      )}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <label
                    htmlFor="input-disable-reason"
                    className="text-xs font-medium"
                  >
                    Reason (optional, recorded in the audit log and shown to
                    affected projects)
                  </label>
                  <Textarea
                    id="input-disable-reason"
                    value={disableReason}
                    onChange={(e) => setDisableReason(e.target.value)}
                    placeholder="e.g. provider deprecated this model, replaced by gpt-5.4-mini"
                    maxLength={500}
                    rows={3}
                    className="mt-1"
                    data-testid="input-disable-reason"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-disable">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-disable"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDisable) {
                  enabledMutation.mutate({
                    id: pendingDisable.model.id,
                    enabled: false,
                    reason: disableReason.trim() || undefined,
                  });
                  setPendingDisable(null);
                  setDisableReason("");
                }
              }}
            >
              Disable model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPageShell>
  );
}

// ---------------------------------------------------------------------------
// Providers panel — Task #78
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ProvidersPanel() {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const providersQuery = useQuery<ProviderRow[]>({
    queryKey: ADMIN_PROVIDERS_KEY,
  });
  const [pendingPause, setPendingPause] = useState<ProviderRow | null>(null);
  const [pauseReason, setPauseReason] = useState("");

  const pauseMutation = useMutation({
    mutationFn: async (vars: {
      vendor: string;
      paused: boolean;
      reason?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/v1/admin/providers/${encodeURIComponent(vars.vendor)}`,
        { paused: vars.paused, reason: vars.reason },
      );
      return await res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: vars.paused ? "Vendor paused" : "Vendor resumed",
        description: vars.paused
          ? `${vars.vendor} models are hidden from the wizard and any new run will be refused.`
          : `${vars.vendor} models are available again.`,
      });
      queryClient.invalidateQueries({ queryKey: ADMIN_PROVIDERS_KEY });
      queryClient.invalidateQueries({ queryKey: ADMIN_MODELS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/ai-models"] });
    },
    onError: (err) => {
      errorToast("Failed to update vendor", err);
    },
  });

  const rows = providersQuery.data ?? [];

  return (
    <Card data-testid="card-providers-panel">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4" />
          Providers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Per-vendor health and kill switch. Pausing a vendor hides its
          models from the project wizard and refuses any new prompt-run
          dispatch with HTTP 503 — useful during a provider outage or to
          enforce a budget cap. Existing per-model enable flags are
          untouched, so un-pausing restores prior state.
        </p>

        {providersQuery.isError ? (
          <ErrorState
            error={providersQuery.error}
            onRetry={() => providersQuery.refetch()}
            title="Couldn't load providers"
          />
        ) : providersQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading providers…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No providers found. Seed the AI model catalog first.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.every((p) => !p.keyConfigured) && (
              <div
                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm space-y-2"
                data-testid="empty-no-keys"
              >
                <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
                  <KeySquare className="h-4 w-4" />
                  No provider API keys are configured
                </div>
                <p className="text-amber-800/90 dark:text-amber-200/90">
                  Every vendor below is missing its API key, so all prompt-run
                  dispatches will fail. Set the matching env var on the server
                  and restart, then this banner will go away.
                </p>
                <ul className="font-mono text-xs text-amber-900 dark:text-amber-100 list-disc pl-5 space-y-0.5">
                  {rows.map((p) => (
                    <li key={p.vendor} data-testid={`text-missing-env-${p.vendor.toLowerCase()}`}>
                      {p.vendor} → {p.envVar ?? "(no env var mapping)"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {rows.map((p) => {
              const pending =
                pauseMutation.isPending &&
                pauseMutation.variables?.vendor === p.vendor;
              return (
                <div
                  key={p.vendor}
                  className={`rounded-md border p-3 space-y-2 ${
                    p.paused ? "border-rose-500/40 bg-rose-500/5" : "bg-card"
                  }`}
                  data-testid={`card-provider-${p.vendor.toLowerCase()}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium" data-testid={`text-provider-name-${p.vendor.toLowerCase()}`}>
                      {p.vendor}
                    </div>
                    {p.keyConfigured ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1"
                        data-testid={`badge-provider-key-${p.vendor.toLowerCase()}`}
                      >
                        <KeyRound className="h-3 w-3" />
                        Key configured
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1"
                        data-testid={`badge-provider-key-${p.vendor.toLowerCase()}`}
                        title={
                          p.envVar
                            ? `Set ${p.envVar} in the environment to enable this provider.`
                            : "No env var mapping for this vendor."
                        }
                      >
                        <KeySquare className="h-3 w-3" />
                        No key
                      </Badge>
                    )}
                  </div>

                  <dl className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <dt>Models</dt>
                      <dd
                        className="font-mono text-foreground"
                        data-testid={`text-provider-models-${p.vendor.toLowerCase()}`}
                      >
                        {p.enabledModelCount} enabled / {p.modelCount} total
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Last successful call</dt>
                      <dd
                        className="font-mono text-foreground"
                        data-testid={`text-provider-last-success-${p.vendor.toLowerCase()}`}
                      >
                        {formatRelativeTime(p.lastSuccessAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>24h error rate</dt>
                      <dd
                        className={`font-mono ${
                          p.last24hErrorRate === null
                            ? "text-muted-foreground"
                            : p.last24hErrorRate >= 0.25
                              ? "text-rose-600 dark:text-rose-400"
                              : p.last24hErrorRate >= 0.05
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                        }`}
                        data-testid={`text-provider-error-rate-${p.vendor.toLowerCase()}`}
                        title={
                          p.last24hErrorRate === null
                            ? "No traffic in the last 24 hours"
                            : `${p.last24hErrorCount} errors / ${p.last24hTotalCount} items`
                        }
                      >
                        {p.last24hErrorRate === null
                          ? "no traffic"
                          : `${(p.last24hErrorRate * 100).toFixed(p.last24hErrorRate < 0.1 ? 1 : 0)}% (${p.last24hErrorCount}/${p.last24hTotalCount})`}
                      </dd>
                    </div>
                  </dl>

                  {p.paused && (
                    <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-800 dark:text-rose-200 space-y-1">
                      <div className="font-medium">Paused</div>
                      {p.pauseReason && (
                        <div data-testid={`text-provider-reason-${p.vendor.toLowerCase()}`}>
                          {p.pauseReason}
                        </div>
                      )}
                      {p.pausedAt && (
                        <div className="opacity-80">
                          since {formatRelativeTime(p.pausedAt)}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <label
                      className="text-xs font-medium"
                      htmlFor={`switch-pause-${p.vendor.toLowerCase()}`}
                    >
                      Pause vendor
                    </label>
                    <Switch
                      id={`switch-pause-${p.vendor.toLowerCase()}`}
                      checked={p.paused}
                      disabled={pending}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setPauseReason("");
                          setPendingPause(p);
                        } else {
                          pauseMutation.mutate({
                            vendor: p.vendor,
                            paused: false,
                          });
                        }
                      }}
                      data-testid={`switch-pause-${p.vendor.toLowerCase()}`}
                    />
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={!!pendingPause}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPause(null);
            setPauseReason("");
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-pause-vendor">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Pause className="h-5 w-5 text-rose-500" />
              Pause {pendingPause?.vendor}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  All {pendingPause?.modelCount ?? 0} {pendingPause?.vendor}{" "}
                  models will be hidden from the project wizard and the
                  run dialog. Any executor call to this vendor will be
                  refused with HTTP 503 until you un-pause.
                </p>
                {pendingPause && pendingPause.inFlightItemCount > 0 && (
                  <div
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200 flex gap-2"
                    data-testid="text-pause-in-flight-warning"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <strong data-testid="text-pause-in-flight-count">
                        {pendingPause.inFlightItemCount}
                      </strong>{" "}
                      prompt-run{" "}
                      {pendingPause.inFlightItemCount === 1
                        ? "item is"
                        : "items are"}{" "}
                      currently in flight against {pendingPause.vendor}{" "}
                      models and will fail mid-flight with a 503 the next
                      time the executor dispatches them.
                    </div>
                  </div>
                )}
                <div>
                  <label
                    htmlFor="input-pause-reason"
                    className="text-xs font-medium"
                  >
                    Reason (optional, shown to other admins)
                  </label>
                  <Textarea
                    id="input-pause-reason"
                    value={pauseReason}
                    onChange={(e) => setPauseReason(e.target.value)}
                    placeholder="e.g. OpenAI status page reports incident #1234"
                    maxLength={500}
                    rows={3}
                    className="mt-1"
                    data-testid="input-pause-reason"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-pause">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-pause"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingPause) {
                  pauseMutation.mutate({
                    vendor: pendingPause.vendor,
                    paused: true,
                    reason: pauseReason.trim() || undefined,
                  });
                  setPendingPause(null);
                  setPauseReason("");
                }
              }}
            >
              Pause vendor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History popover — Task #79. Shows the last 25 audit entries for one
// model, lazily fetched on first open so the table render doesn't fan
// out one network call per row.
// ---------------------------------------------------------------------------

type ModelAuditEntry = {
  id: string;
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

function formatAuditAction(action: string): string {
  if (action === "ai_model.disabled.update") return "Disabled";
  if (action === "ai_model.enabled.update") return "Enabled";
  if (action === "ai_model.category.update") return "Category changed";
  if (action === "llm_function.override.set") return "Override set";
  if (action === "llm_function.override.clear") return "Override cleared";
  return action;
}

function renderBeforeAfter(
  action: string,
  metadata: Record<string, unknown> | null,
): { from: string; to: string } | null {
  if (!metadata) return null;
  if (
    action === "ai_model.enabled.update" ||
    action === "ai_model.disabled.update"
  ) {
    const from = metadata.from;
    const to = metadata.to;
    if (typeof from === "boolean" && typeof to === "boolean") {
      return { from: from ? "enabled" : "disabled", to: to ? "enabled" : "disabled" };
    }
  }
  if (action === "ai_model.category.update") {
    const from = (metadata.from as string | undefined) ?? "—";
    const to = (metadata.to as string | undefined) ?? "—";
    return { from, to };
  }
  if (
    action === "llm_function.override.set" ||
    action === "llm_function.override.clear"
  ) {
    const fromObj = (metadata.from as Record<string, unknown> | undefined) ?? {};
    const toObj = (metadata.to as Record<string, unknown> | undefined) ?? {};
    const fn = (metadata.functionKey as string | undefined) ?? "function";
    const fromLabel =
      (fromObj.overrideModelLabel as string | undefined) ??
      (fromObj.model as string | undefined) ??
      "default";
    const toLabel =
      (toObj.overrideModelLabel as string | undefined) ??
      (toObj.model as string | undefined) ??
      "default";
    return { from: `${fn}: ${fromLabel}`, to: `${fn}: ${toLabel}` };
  }
  return null;
}

function ModelHistoryPopover({ modelId }: { modelId: string }) {
  const [open, setOpen] = useState(false);
  const auditQuery = useQuery<ModelAuditEntry[]>({
    queryKey: ["/api/v1/admin/ai-models", modelId, "audit"],
    enabled: open,
  });
  const entries = auditQuery.data ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`button-history-${modelId}`}
          aria-label="View change history"
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 max-h-96 overflow-y-auto p-0"
        data-testid={`popover-history-${modelId}`}
      >
        <div className="border-b px-3 py-2 text-sm font-medium">
          Change history
        </div>
        {auditQuery.isError ? (
          <div className="px-3 py-4">
            <ErrorState
              error={auditQuery.error}
              onRetry={() => auditQuery.refetch()}
              title="Couldn't load history"
            />
          </div>
        ) : auditQuery.isLoading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div
            className="px-3 py-4 text-sm text-muted-foreground"
            data-testid={`text-history-empty-${modelId}`}
          >
            No changes recorded for this model yet.
          </div>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => {
              const reason = (e.metadata?.reason as string | null) ?? null;
              const cancelledItems =
                (e.metadata?.cancelledItems as number | undefined) ?? 0;
              const cancelledRuns =
                (e.metadata?.cancelledRuns as number | undefined) ?? 0;
              const affectedClients =
                (e.metadata?.affectedClientCount as number | undefined) ?? 0;
              const actor =
                e.actorDisplayName ?? e.actorEmail ?? "system";
              return (
                <li
                  key={e.id}
                  className="px-3 py-2 text-xs space-y-1"
                  data-testid={`row-history-${e.id}`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {formatAuditAction(e.action)}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">by {actor}</div>
                  {(() => {
                    const ba = renderBeforeAfter(e.action, e.metadata);
                    if (!ba) return null;
                    return (
                      <div
                        className="text-foreground/90"
                        data-testid={`text-history-beforeafter-${e.id}`}
                      >
                        <span className="text-muted-foreground">{ba.from}</span>
                        {" → "}
                        <span className="font-medium">{ba.to}</span>
                      </div>
                    );
                  })()}
                  {reason && (
                    <div
                      className="italic text-foreground/80"
                      data-testid={`text-history-reason-${e.id}`}
                    >
                      “{reason}”
                    </div>
                  )}
                  {(cancelledItems > 0 ||
                    cancelledRuns > 0 ||
                    affectedClients > 0) && (
                    <div className="text-muted-foreground">
                      {cancelledItems > 0 && `${cancelledItems} item(s) cancelled`}
                      {cancelledRuns > 0 && ` · ${cancelledRuns} run(s) errored`}
                      {affectedClients > 0 && ` · ${affectedClients} project(s) notified`}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Functions tab — Task #77
// ---------------------------------------------------------------------------

function sourceBadge(row: LlmFunctionRow) {
  if (row.source === "override") {
    return (
      <Badge
        variant="outline"
        className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"
        data-testid={`badge-source-${row.functionKey}`}
      >
        DB override
      </Badge>
    );
  }
  if (row.source === "env") {
    return (
      <Badge
        variant="outline"
        className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
        data-testid={`badge-source-${row.functionKey}`}
      >
        Env var
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30"
      data-testid={`badge-source-${row.functionKey}`}
    >
      Default
    </Badge>
  );
}

function FunctionsTab({ enabledModels }: { enabledModels: AiModelRow[] }) {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const functionsQuery = useQuery<LlmFunctionRow[]>({
    queryKey: ADMIN_LLM_FUNCTIONS_KEY,
  });

  const overrideMutation = useMutation({
    mutationFn: async (vars: { fn: string; modelId: string | null }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/v1/admin/llm-functions/${vars.fn}`,
        { modelId: vars.modelId },
      );
      return (await res.json()) as LlmFunctionRow;
    },
    onSuccess: (updated) => {
      toast({
        title:
          updated.source === "override"
            ? "Override saved"
            : "Override cleared",
        description: `${updated.functionKey} now uses ${updated.resolvedModel}.`,
      });
      queryClient.invalidateQueries({ queryKey: ADMIN_LLM_FUNCTIONS_KEY });
    },
    onError: (err) => {
      errorToast("Failed to update function", err);
    },
  });

  const rows = functionsQuery.data ?? [];
  const stale = rows.filter(
    (r) => r.overrideModelId !== null && !r.overrideActive,
  );

  // Group enabled models by vendor so the picker is easier to scan. The
  // grouping is shared; per-row we filter by the function's allowed
  // vendors so an OpenAI-only function never shows Anthropic options.
  const modelsByVendor = useMemo(() => {
    const grouped = new Map<string, AiModelRow[]>();
    for (const m of enabledModels) {
      const list = grouped.get(m.vendor) ?? [];
      list.push(m);
      grouped.set(m.vendor, list);
    }
    return Array.from(grouped.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [enabledModels]);

  function vendorsAllowedFor(row: LlmFunctionRow): [string, AiModelRow[]][] {
    const allowed = new Set(
      (row.allowedVendors ?? []).map((v) => v.toLowerCase()),
    );
    return modelsByVendor.filter(([vendor]) => allowed.has(vendor.toLowerCase()));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Cog className="h-4 w-4" />
          Function → Model assignments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pin which model each internal LLM call uses. Choices persist
          immediately and the next call site read picks them up — no server
          restart required. Clearing an override falls back to the env var
          (if set) or the default.
        </p>

        {stale.length > 0 && (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2"
            data-testid="banner-stale-overrides"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>
                {stale.length}{" "}
                {stale.length === 1 ? "override points" : "overrides point"}
              </strong>{" "}
              at a model that has since been disabled. Those functions are
              now resolving to the default — pick a new model or clear the
              override below.
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Function</TableHead>
              <TableHead>Resolved model</TableHead>
              <TableHead className="w-[120px]">Source</TableHead>
              <TableHead className="w-[280px]">Override</TableHead>
              <TableHead className="w-[80px]">Reset</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              loading={functionsQuery.isLoading}
              empty={!functionsQuery.isLoading && !functionsQuery.isError && rows.length === 0}
              error={functionsQuery.isError ? functionsQuery.error : undefined}
              onRetry={() => functionsQuery.refetch()}
              emptyText="No LLM functions registered."
              colSpan={5}
            />
            {rows.map((row) => {
              const pending =
                overrideMutation.isPending &&
                overrideMutation.variables?.fn === row.functionKey;
              const stale =
                row.overrideModelId !== null && !row.overrideActive;
              return (
                <TableRow
                  key={row.functionKey}
                  data-testid={`row-fn-${row.functionKey}`}
                >
                  <TableCell>
                    <div
                      className="font-medium font-mono text-xs"
                      data-testid={`text-fn-key-${row.functionKey}`}
                    >
                      {row.functionKey}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-md">
                      {row.description}
                    </div>
                    <div className="text-[11px] text-muted-foreground/70 font-mono mt-1">
                      env: {row.envVar}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div
                      className="font-mono text-xs"
                      data-testid={`text-fn-resolved-${row.functionKey}`}
                    >
                      {row.resolvedModel}
                    </div>
                    {stale && (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Override points at a disabled model
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{sourceBadge(row)}</TableCell>
                  <TableCell>
                    <Select
                      disabled={pending}
                      value={row.overrideModelId ?? "__none__"}
                      onValueChange={(value) => {
                        const modelId = value === "__none__" ? null : value;
                        if (modelId === row.overrideModelId) return;
                        overrideMutation.mutate({
                          fn: row.functionKey,
                          modelId,
                        });
                      }}
                    >
                      <SelectTrigger
                        className="h-8"
                        data-testid={`select-override-${row.functionKey}`}
                      >
                        <SelectValue placeholder="Use env / default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value="__none__"
                          data-testid={`select-override-${row.functionKey}-none`}
                        >
                          Use env / default
                        </SelectItem>
                        {vendorsAllowedFor(row).map(([vendor, list]) => (
                          <SelectGroup key={vendor}>
                            <SelectLabel>{vendor}</SelectLabel>
                            {list.map((m) => (
                              <SelectItem
                                key={m.id}
                                value={m.id}
                                data-testid={`select-override-${row.functionKey}-${m.id}`}
                              >
                                <span className="font-mono text-xs">
                                  {m.model}
                                </span>{" "}
                                <span className="text-muted-foreground">
                                  — {m.displayName}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {row.overrideModelId !== null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          overrideMutation.mutate({
                            fn: row.functionKey,
                            modelId: null,
                          })
                        }
                        data-testid={`button-reset-${row.functionKey}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
