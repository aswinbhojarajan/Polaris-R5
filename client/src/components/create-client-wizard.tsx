import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverContentInline,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Building,
  Globe,
  User,
  Users,
  Bot,
  X,
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isPermissionError, permissionMessage } from "@/lib/api-errors";
import { setSelectedClientId } from "@/hooks/use-selected-client-id";
import type { AiModel, Client, Competitor } from "@shared/schema";
import { useDebounce } from "@/hooks/use-debounce";
import { INDUSTRIES, GEOGRAPHIES, isCustomIndustry, isCustomGeography, normalizeCustomValue } from "@/lib/industry-geography-options";
import { Pencil } from "lucide-react";

// Step schemas
const step1Schema = z.object({
  projectName: z
    .string()
    .min(1, "Project name is required")
    .max(100, "Project name too long"),
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name too long"),
});

const step2Schema = z.object({
  urls: z.array(z.string().url()).max(3, "Maximum 3 URLs"),
  focusAreas: z.array(z.string()).max(10, "Maximum 10 focus areas"),
});

const step3Schema = z.object({
  industry: z.string().min(1, "Industry is required"),
  geography: z
    .array(z.string())
    .min(1, "At least one geography required")
    .max(3, "Maximum 3 geographies"),
  brandAliases: z.array(z.string()).max(10, "Maximum 10 brand aliases"),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step3Data = z.infer<typeof step3Schema>;

interface ClientUrl {
  url: string;
  category: "primary" | "secondary" | "thirdparty";
}

interface CompetitorData {
  id: string;
  name: string;
  website: string;
  aliases: string[];
}

// Task #99 — Advisory URL reachability state. Keyed by URL string. A
// missing entry means "unknown" (e.g. user-typed URL that hasn't been
// probed yet); we never block Next on this — it's a hint only.
interface ReachabilityResult {
  url: string;
  reachable: boolean;
  status?: number;
  reason?: string;
}

// Task #99 — explicit-state advisory chip. Three states:
//   • "Checking…"            (probe in flight for this URL)
//   • "Reachable"            (HEAD/GET returned <400)
//   • "Couldn't reach this URL" (everything else, with tooltip reason)
// Clicking the warning state re-runs the probe for THIS url only, so the
// user can fix a typo and immediately re-verify without re-running the
// global Re-check button. Always advisory — never blocks Next.
function ReachabilityChip({
  url,
  result,
  checking,
  onRecheck,
}: {
  url: string;
  result?: ReachabilityResult;
  checking: boolean;
  onRecheck: (url: string) => void;
}) {
  if (checking) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
        data-testid="url-reachability-checking"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking…
      </span>
    );
  }
  if (!result) {
    return (
      <button
        type="button"
        onClick={() => onRecheck(url)}
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80"
        title="Click to check whether this URL is reachable"
        data-testid="url-reachability-unknown"
      >
        Not checked
      </button>
    );
  }
  if (result.reachable) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
        title={`Reachable${result.status ? ` (HTTP ${result.status})` : ""}`}
        data-testid="url-reachability-ok"
      >
        ✓ Reachable
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onRecheck(url)}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-950/60"
      title={`${result.reason || "Unreachable"} — click to re-check. You can still continue.`}
      data-testid="url-reachability-bad"
    >
      ⚠ Couldn't reach this URL
    </button>
  );
}

// Extract a clean, user-facing message from a failed apiRequest. The
// ApiError thrown by queryClient keeps a legacy "<status>: <message>"
// shape on `.message`; strip the leading status code so the toast reads
// naturally.
function wizardErrorMessage(error: unknown): string {
  if (isPermissionError(error)) {
    return permissionMessage(
      error,
      "You don't have permission to do this. Ask an org admin to upgrade your role.",
    );
  }
  if (error instanceof Error && error.message) {
    return error.message.replace(/^\d{3}:\s*/, "");
  }
  return "Something went wrong. Please try again.";
}

const CREATE_PROJECT_PERMISSION_MESSAGE =
  "You don't have permission to create projects. Ask an org admin to upgrade your role.";

interface CreateClientWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  // Task #133 — when set, the wizard opens in "resume" mode against an
  // existing project: it hydrates every step from that project's saved data
  // instead of creating a fresh draft, and the final save updates the
  // existing project rather than creating a duplicate.
  existingClientId?: string | null;
}


export default function CreateClientWizard({
  open,
  onClose,
  onComplete,
  existingClientId = null,
}: CreateClientWizardProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [clientId, setClientId] = useState<string | null>(null);
  // Task #90 — track which Step 1 values have already been persisted to the
  // server so back/forward navigation can skip the duplicate-name POST.
  const [savedStep1, setSavedStep1] = useState<{ projectName: string; name: string } | null>(null);
  // Task #90 — guard auto-AI-enrichment so it only runs the first time the
  // user enters a step. Manual "Re-run AI" buttons are unaffected.
  const [enrichedSteps, setEnrichedSteps] = useState<{ urls: boolean; profile: boolean; competitors: boolean }>({
    urls: false,
    profile: false,
    competitors: false,
  });

  // Step 1 state
  const [clientName, setClientName] = useState("");
  const [projectNameError, setProjectNameError] = useState("");
  const [isValidatingProjectName, setIsValidatingProjectName] = useState(false);

  // Step 2 state
  const [urls, setUrls] = useState<ClientUrl[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [urlCategory, setUrlCategory] = useState<
    "primary" | "secondary" | "thirdparty"
  >("primary");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [focusAreaInput, setFocusAreaInput] = useState("");
  const [isEnrichingUrls, setIsEnrichingUrls] = useState(false);

  // Step 3 state
  const [industry, setIndustry] = useState("");
  const [geographies, setGeographies] = useState<string[]>([]);
  const [geographyPopoverOpen, setGeographyPopoverOpen] = useState(false);
  const [industryPopoverOpen, setIndustryPopoverOpen] = useState(false);
  const [brandAliases, setBrandAliases] = useState<string[]>([]);
  const [brandAliasInput, setBrandAliasInput] = useState("");
  const [isEnrichingProfile, setIsEnrichingProfile] = useState(false);
  
  // Custom industry/geography state
  const [customIndustry, setCustomIndustry] = useState<string | null>(null);
  const [customGeography, setCustomGeography] = useState<string | null>(null);
  const [showCustomIndustryInput, setShowCustomIndustryInput] = useState(false);
  const [showCustomGeographyInput, setShowCustomGeographyInput] = useState(false);
  const [customIndustryInput, setCustomIndustryInput] = useState("");
  const [customGeographyInput, setCustomGeographyInput] = useState("");
  const [editingCustomIndustry, setEditingCustomIndustry] = useState(false);
  const [editingCustomGeography, setEditingCustomGeography] = useState(false);

  // Step 4 state
  const [competitors, setCompetitors] = useState<CompetitorData[]>([]);
  const [competitorAliasInputs, setCompetitorAliasInputs] = useState<{
    [key: string]: string;
  }>({});
  const [isEnrichingCompetitors, setIsEnrichingCompetitors] = useState(false);
  const [expandedCompetitors, setExpandedCompetitors] = useState<string[]>([]);

  // Step 5 state
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  // Task #99 — advisory URL reachability state, populated from enrich-urls /
  // enrich-competitors responses and refreshed by the "Re-check" button.
  const [urlReachability, setUrlReachability] = useState<
    Record<string, ReachabilityResult>
  >({});
  const [isRecheckingUrls, setIsRecheckingUrls] = useState(false);
  // Per-URL "checking…" state so the chip can show its own spinner when
  // the user clicks the warning chip to re-probe a single URL.
  const [checkingUrls, setCheckingUrls] = useState<Set<string>>(new Set());

  // Task #133 — resume mode. `hydratedClientRef` tracks which project we have
  // already pulled into the form so re-opening re-pulls fresh data, and
  // `existingCompetitorIdsRef` remembers the project's current competitor rows
  // so the final save can reconcile removals (delete-then-recreate) rather
  // than only adding.
  const isResumeMode = !!existingClientId;
  const hydratedClientRef = useRef<string | null>(null);
  const existingCompetitorIdsRef = useRef<string[]>([]);
  // True while the resume-mode hydration fetch is in flight. Used to gate
  // Step 1 so we never POST a duplicate project before the existing one has
  // loaded.
  const [isHydratingResume, setIsHydratingResume] = useState(false);

  const step1Form = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      projectName: "",
      name: "",
    },
  });

  // Debounced project name validation
  const validateProjectName = useDebounce(async (value: string) => {
    if (!value.trim()) {
      setProjectNameError("");
      return;
    }

    setIsValidatingProjectName(true);
    try {
      // Task #90 — when a draft already exists for this wizard session,
      // exclude it from the duplicate check. Otherwise the user's own
      // draft name is reported as a conflict the moment they edit it.
      const excludeParam = clientId
        ? `&excludeId=${encodeURIComponent(clientId)}`
        : "";
      const response = await fetch(
        `/api/v1/clients/validate-project-name?` +
          `projectName=${encodeURIComponent(value)}&` +
          `orgId=default-org${excludeParam}`,
      );

      if (!response.ok) {
        throw new Error("Validation failed");
      }

      const result = await response.json();

      if (!result.available) {
        setProjectNameError(
          "This project name is already in use. Please choose another.",
        );
      } else {
        setProjectNameError("");
      }
    } catch (error) {
      console.error("Failed to validate project name:", error);
    } finally {
      setIsValidatingProjectName(false);
    }
  }, 500);

  // Task #133 — hydrate every step from an existing project when resuming.
  // Runs once per (open × project); marking all steps as already-enriched
  // prevents the AI auto-enrichment from overwriting the user's saved data.
  useEffect(() => {
    if (!open || !existingClientId) return;
    if (hydratedClientRef.current === existingClientId) return;
    hydratedClientRef.current = existingClientId;

    setIsHydratingResume(true);
    (async () => {
      try {
        const [clientRes, compsRes, modelsRes] = await Promise.all([
          apiRequest("GET", `/api/v1/clients/${existingClientId}`),
          apiRequest("GET", `/api/v1/competitors?client_id=${existingClientId}`),
          apiRequest("GET", `/api/v1/clients/${existingClientId}/models`),
        ]);
        const client = (await clientRes.json()) as Client;
        const comps = (await compsRes.json()) as Competitor[];
        const models = (await modelsRes.json()) as AiModel[];

        // Identity (Step 1)
        setClientId(client.id);
        setClientName(client.name);
        setSavedStep1({ projectName: client.projectName || "", name: client.name });
        step1Form.reset({
          projectName: client.projectName || "",
          name: client.name,
        });

        // URLs (Step 2) — tolerate legacy string[] / single-website shapes.
        if (Array.isArray(client.urls) && client.urls.length > 0) {
          const first = client.urls[0] as unknown;
          if (typeof first === "string") {
            setUrls(
              (client.urls as unknown as string[]).map((url, idx) => ({
                url,
                category: idx === 0 ? ("primary" as const) : ("secondary" as const),
              })),
            );
          } else {
            setUrls(client.urls as unknown as ClientUrl[]);
          }
        } else if (client.website) {
          setUrls([{ url: client.website, category: "primary" }]);
        } else {
          setUrls([]);
        }
        setFocusAreas(
          Array.isArray(client.focusAreas) ? (client.focusAreas as string[]) : [],
        );

        // Profile (Step 3)
        setIndustry(client.industry || "");
        if (client.geography && typeof client.geography === "string") {
          setGeographies(
            client.geography
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        } else if (Array.isArray(client.geography)) {
          setGeographies(client.geography as unknown as string[]);
        } else {
          setGeographies([]);
        }
        setBrandAliases(
          Array.isArray(client.brandAliases) ? (client.brandAliases as string[]) : [],
        );
        setCustomIndustry(client.customIndustry || null);
        setCustomGeography(client.customGeography || null);

        // Competitors (Step 4) — keep the real DB ids so the step-4 UI keys
        // correctly, and remember them so the final save can reconcile.
        existingCompetitorIdsRef.current = comps.map((c) => c.id);
        setCompetitors(
          comps.map((c) => ({
            id: c.id,
            name: c.name,
            website: c.website || "",
            aliases: Array.isArray(c.aliases) ? (c.aliases as string[]) : [],
          })),
        );

        // AI models (Step 5)
        if (
          Array.isArray(client.selectedAiModelIds) &&
          client.selectedAiModelIds.length > 0
        ) {
          setSelectedModels(client.selectedAiModelIds as string[]);
        } else {
          setSelectedModels(models.map((m) => m.id));
        }

        // Existing project already has data — never auto-overwrite it with AI
        // enrichment. The manual "Re-run AI" buttons still work.
        setEnrichedSteps({ urls: true, profile: true, competitors: true });
        setCurrentStep(1);
      } catch (error) {
        toast({
          title: "Couldn't load this project",
          description: wizardErrorMessage(error),
          variant: "destructive",
        });
        // Allow a retry on next open.
        hydratedClientRef.current = null;
      } finally {
        setIsHydratingResume(false);
      }
    })();
  }, [open, existingClientId, step1Form, toast]);

  // Fetch AI models
  const { data: allAiModels = [] } = useQuery<AiModel[]>({
    queryKey: ["/api/v1/ai-models"],
    enabled: open && currentStep === 5,
  });

  // Filter to keep only latest version and enabled models
  const aiModels = allAiModels.filter((m) => m.enabled);

  // Step 1: Create draft client
  const createDraftMutation = useMutation({
    mutationFn: async (data: Step1Data) => {
      const response = await apiRequest("POST", "/api/v1/clients", {
        projectName: data.projectName,
        name: data.name,
        orgId: "default-org",
        onboardingStatus: "inprogress",
      });
      return response.json() as Promise<Client>;
    },
    onSuccess: (client, vars) => {
      setClientId(client.id);
      setClientName(client.name);
      setSavedStep1({ projectName: vars.projectName, name: vars.name });
      setCurrentStep(2);
      // Trigger AI enrichment for step 2 (first entry only — handler re-checks
      // enrichedSteps.urls so subsequent re-entries skip auto-enrichment).
      if (!enrichedSteps.urls) {
        setEnrichedSteps((s) => ({ ...s, urls: true }));
        enrichUrlsAndFocusAreas(client.name);
      }
    },
    onError: (error) => {
      if (isPermissionError(error)) {
        toast({
          title: "You don't have permission",
          description: permissionMessage(error, CREATE_PROJECT_PERMISSION_MESSAGE),
          variant: "destructive",
        });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : "";
      if (
        errorMessage.includes("409") ||
        errorMessage.includes("already exists")
      ) {
        toast({
          title: "Duplicate project name",
          description:
            "This project name is already in use. Please choose another.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't create project",
          description: wizardErrorMessage(error),
          variant: "destructive",
        });
      }
    },
  });

  // AI Enrichment: URLs & Focus Areas
  const enrichUrlsAndFocusAreas = async (name: string) => {
    setIsEnrichingUrls(true);
    try {
      const response = await apiRequest(
        "POST",
        "/api/v1/onboarding/enrich-urls",
        { name },
      );
      const result = (await response.json()) as {
        mainUrl: string;
        otherUrls: string[];
        focusAreas: string[];
        reachability?: Record<string, ReachabilityResult>;
      };

      const allUrls: ClientUrl[] = [];
      if (result.mainUrl) {
        allUrls.push({ url: result.mainUrl, category: "primary" });
      }
      result.otherUrls.forEach((url) => {
        if (url) {
          allUrls.push({ url, category: "secondary" });
        }
      });
      setUrls(allUrls);
      setFocusAreas(result.focusAreas);
      if (result.reachability) {
        setUrlReachability((prev) => ({ ...prev, ...result.reachability }));
      }
    } catch (error) {
      console.error("Failed to enrich URLs:", error);
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to generate AI suggestions";
      toast({
        title: "AI Enrichment Failed",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsEnrichingUrls(false);
    }
  };

  // AI Enrichment: Profile
  const enrichProfile = async () => {
    if (!clientName) return;
    setIsEnrichingProfile(true);
    try {
      const response = await apiRequest(
        "POST",
        "/api/v1/onboarding/enrich-profile",
        {
          name: clientName,
          urls: urls.map((u) => u.url),
          focusAreas,
        },
      );
      const result = (await response.json()) as {
        industry: string;
        geography: string[];
        brandAliases: string[];
      };

      setIndustry(result.industry);
      setGeographies(result.geography);
      setBrandAliases(result.brandAliases);
    } catch (error) {
      console.error("Failed to enrich profile:", error);
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to generate AI suggestions";
      toast({
        title: "AI Enrichment Failed",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsEnrichingProfile(false);
    }
  };

  // AI Enrichment: Competitors
  const enrichCompetitors = async () => {
    if (!clientName) return;
    setIsEnrichingCompetitors(true);
    try {
      const response = await apiRequest(
        "POST",
        "/api/v1/onboarding/enrich-competitors",
        {
          name: clientName,
          urls: urls.map((u) => u.url),
          industry,
          geography: geographies,
          brandAliases,
          focusAreas,
        },
      );
      const result = (await response.json()) as {
        competitors: Array<{
          name: string;
          url: string;
          reason: string;
          confidence: number;
          aliases: string[];
        }>;
        reachability?: Record<string, ReachabilityResult>;
      };
      if (result.reachability) {
        setUrlReachability((prev) => ({ ...prev, ...result.reachability }));
      }

      // Sort by confidence and take top 5
      const topCompetitors = result.competitors
        .sort((a: any, b: any) => b.confidence - a.confidence)
        .slice(0, 5)
        .map((c: any) => ({
          id: crypto.randomUUID(),
          name: c.name,
          website: c.url,
          aliases: c.aliases || [],
        }));

      setCompetitors(topCompetitors);
    } catch (error) {
      console.error("Failed to enrich competitors:", error);
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to generate AI suggestions";
      toast({
        title: "AI Enrichment Failed",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsEnrichingCompetitors(false);
    }
  };

  // Task #99 — re-probe a single URL (used when the user clicks an
  // unreachable / not-checked chip). Tracks per-URL checking state so the
  // chip can show its own spinner without affecting the global button.
  const recheckSingleUrl = async (url: string) => {
    if (!url) return;
    setCheckingUrls((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
    try {
      const response = await apiRequest("POST", "/api/v1/onboarding/probe-urls", {
        urls: [url],
      });
      const result = (await response.json()) as {
        reachability: Record<string, ReachabilityResult>;
      };
      setUrlReachability((prev) => ({ ...prev, ...result.reachability }));
    } catch (error) {
      console.error("Failed to re-check URL:", error);
    } finally {
      setCheckingUrls((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  };

  // Task #99 — manual reachability re-check for URLs the user has typed
  // or edited themselves. Calls the standalone probe endpoint without
  // re-running the (slow, paid) AI enrichment. Pulls in any competitor
  // websites so the user can verify those too in one click.
  const recheckUrls = async () => {
    const targets = Array.from(
      new Set([
        ...urls.map((u) => u.url),
        ...competitors.map((c) => c.website).filter((w): w is string => !!w),
      ]),
    );
    if (targets.length === 0) return;
    setIsRecheckingUrls(true);
    try {
      const response = await apiRequest("POST", "/api/v1/onboarding/probe-urls", {
        urls: targets,
      });
      const result = (await response.json()) as {
        reachability: Record<string, ReachabilityResult>;
      };
      setUrlReachability((prev) => ({ ...prev, ...result.reachability }));
    } catch (error) {
      console.error("Failed to re-check URLs:", error);
      toast({
        title: "URL re-check failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRecheckingUrls(false);
    }
  };

  // Update client mutation
  const updateClientMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!clientId) throw new Error("No client ID");
      return apiRequest("PUT", `/api/v1/clients/${clientId}`, data);
    },
  });

  // Task #99 — completion-path idempotency. Three independent layers
  // protect against duplicate state on retries / fast double-clicks:
  //   1) Button `disabled={completeOnboardingMutation.isPending}` blocks
  //      the obvious double-click case.
  //   2) `hasCompletedRef` is flipped inside the mutationFn the moment
  //      it starts, so even a programmatic re-mutate (e.g. a stale onClick
  //      handler firing after isPending toggles) short-circuits.
  //   3) `POST /api/v1/competitors` is server-side de-duplicated by
  //      (clientId, lower(name)) so a retried network call after a partial
  //      failure won't insert the same competitor twice; the PUT to
  //      /api/v1/clients/:id is naturally idempotent.
  const hasCompletedRef = useRef(false);
  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("No client ID");
      if (hasCompletedRef.current) {
        // Belt-and-suspenders: a previous run already finished/started.
        return;
      }
      hasCompletedRef.current = true;

      try {
        // Save selected AI models and mark onboarding as complete (PUT
        // is idempotent server-side).
        await apiRequest("PUT", `/api/v1/clients/${clientId}`, {
          selectedAiModelIds: selectedModels,
          onboardingStatus: "completed",
        });

        // Task #133 — when resuming an existing project, reconcile
        // competitors so edits/removals made in the wizard take effect. We
        // delete the project's previously-loaded competitor rows, then
        // recreate from the current list below. The ref is cleared after a
        // successful delete so a retry (which re-enters this block) won't
        // double-delete.
        if (existingClientId && existingCompetitorIdsRef.current.length > 0) {
          await Promise.all(
            existingCompetitorIdsRef.current.map((id) =>
              apiRequest("DELETE", `/api/v1/competitors/${id}`, {}),
            ),
          );
          existingCompetitorIdsRef.current = [];
        }

        // Create all competitors in parallel for better performance.
        // Server endpoint dedupes by (clientId, lower(name)), so a partial
        // failure followed by a retry will not duplicate rows.
        const competitorPromises = competitors
          .filter((comp) => comp.name.trim())
          .map((comp) =>
            apiRequest("POST", "/api/v1/competitors", {
              clientId,
              name: comp.name,
              website: comp.website || null,
              aliases: comp.aliases || [],
            }),
          );

        await Promise.all(competitorPromises);
      } catch (err) {
        // Allow the user to retry on transient failures by clearing the
        // guard. Server-side dedup keeps the retry safe.
        hasCompletedRef.current = false;
        throw err;
      }
    },
    onSuccess: () => {
      toast({
        title: isResumeMode
          ? "Project setup updated!"
          : "Client created successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/clients"] });
      if (clientId) {
        // Refresh the specific project's cached data so Project Settings (and
        // any other open view) reflects the saved changes immediately.
        queryClient.invalidateQueries({ queryKey: ["/api/v1/clients", clientId] });
        queryClient.invalidateQueries({
          queryKey: ["/api/v1/clients", clientId, "models"],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/v1/competitors", clientId],
        });
        // Make the freshly-created / edited project the selected one so the
        // topbar and every page that lands next show it instead of
        // "No Client Selected" or the previously-selected project.
        setSelectedClientId(clientId);
      }
      onComplete();
      handleClose();
    },
    onError: (error: unknown) => {
      if (isPermissionError(error)) {
        toast({
          title: "You don't have permission",
          description: permissionMessage(error, CREATE_PROJECT_PERMISSION_MESSAGE),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Couldn't finish setup",
        description: wizardErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  // Step handlers
  const handleStep1Next = () => {
    step1Form.handleSubmit((data) => {
      // Task #90 — Step 1 is idempotent. Only POST a brand-new client the
      // first time. On Back→Next without changes, just advance. If only the
      // name fields changed, PUT the rename so we don't try to re-create.
      if (clientId && savedStep1) {
        const unchanged =
          savedStep1.projectName === data.projectName &&
          savedStep1.name === data.name;
        if (unchanged) {
          setCurrentStep(2);
          if (!enrichedSteps.urls) {
            setEnrichedSteps((s) => ({ ...s, urls: true }));
            enrichUrlsAndFocusAreas(data.name);
          }
          return;
        }
        updateClientMutation.mutate(
          { projectName: data.projectName, name: data.name },
          {
            onSuccess: () => {
              setClientName(data.name);
              setSavedStep1({ projectName: data.projectName, name: data.name });
              setCurrentStep(2);
              if (!enrichedSteps.urls) {
                setEnrichedSteps((s) => ({ ...s, urls: true }));
                enrichUrlsAndFocusAreas(data.name);
              }
            },
            onError: (error: unknown) => {
              if (isPermissionError(error)) {
                toast({
                  title: "You don't have permission",
                  description: permissionMessage(error, CREATE_PROJECT_PERMISSION_MESSAGE),
                  variant: "destructive",
                });
                return;
              }
              const m = error instanceof Error ? error.message : "";
              if (m.includes("409") || m.includes("already exists")) {
                toast({
                  title: "Duplicate project name",
                  description:
                    "This project name is already in use. Please choose another.",
                  variant: "destructive",
                });
              } else {
                toast({
                  title: "Couldn't update project",
                  description: wizardErrorMessage(error),
                  variant: "destructive",
                });
              }
            },
          },
        );
        return;
      }
      // Task #133 — resume mode must NEVER create a new project. If we got
      // here without a hydrated clientId (hydration still loading or it
      // failed), abort with a clear message instead of POSTing a duplicate.
      if (isResumeMode) {
        toast({
          title: isHydratingResume ? "Still loading this project" : "Couldn't load this project",
          description: isHydratingResume
            ? "Please wait a moment and try again."
            : "Close the wizard and reopen it to try again.",
          variant: "destructive",
        });
        return;
      }
      createDraftMutation.mutate(data);
    })();
  };

  const handleStep2Next = async () => {
    if (!clientId) return;

    // Save step 2 data. If the save fails, surface a clear error and stay
    // on this step so the user can retry — never silently freeze on "Next"
    // (Task #132).
    try {
      await updateClientMutation.mutateAsync({
        urls,
        focusAreas,
      });
    } catch (error) {
      toast({
        title: "Couldn't save your changes",
        description: wizardErrorMessage(error),
        variant: "destructive",
      });
      return;
    }

    setCurrentStep(3);
    // Trigger AI enrichment for step 3 (first entry only).
    if (!enrichedSteps.profile) {
      setEnrichedSteps((s) => ({ ...s, profile: true }));
      enrichProfile();
    }
  };

  const handleStep3Next = async () => {
    if (!clientId) return;

    // Save step 3 data. Same fail-loud guard as step 2 (Task #132).
    try {
      await updateClientMutation.mutateAsync({
        industry,
        geography: geographies.join(", "),
        brandAliases,
        customIndustry: customIndustry || null,
        customGeography: customGeography || null,
      });
    } catch (error) {
      toast({
        title: "Couldn't save your changes",
        description: wizardErrorMessage(error),
        variant: "destructive",
      });
      return;
    }

    setCurrentStep(4);
    // Trigger AI enrichment for step 4 (first entry only — re-runs require
    // the explicit "Re-run AI" button so user-edited competitors aren't
    // silently overwritten on Back→Next).
    if (!enrichedSteps.competitors) {
      setEnrichedSteps((s) => ({ ...s, competitors: true }));
      enrichCompetitors();
    }
  };

  const handleStep4Next = () => {
    setCurrentStep(5);
  };

  const handleFinalSubmit = () => {
    completeOnboardingMutation.mutate();
  };

  const handleClose = () => {
    setCurrentStep(1);
    setClientId(null);
    setSavedStep1(null);
    // Task #133 — reset resume-mode bookkeeping so a subsequent open
    // re-hydrates fresh from the server.
    hydratedClientRef.current = null;
    existingCompetitorIdsRef.current = [];
    setEnrichedSteps({ urls: false, profile: false, competitors: false });
    setUrlReachability({});
    setCheckingUrls(new Set());
    hasCompletedRef.current = false;
    setClientName("");
    setUrls([]);
    setUrlInput("");
    setFocusAreas([]);
    setFocusAreaInput("");
    setIndustry("");
    setGeographies([]);
    setBrandAliases([]);
    setBrandAliasInput("");
    setCompetitors([]);
    setSelectedModels([]);
    setCustomIndustry(null);
    setCustomGeography(null);
    setShowCustomIndustryInput(false);
    setShowCustomGeographyInput(false);
    setCustomIndustryInput("");
    setCustomGeographyInput("");
    setEditingCustomIndustry(false);
    setEditingCustomGeography(false);
    step1Form.reset();
    onClose();
  };
  
  // Custom industry handlers
  const handleAddCustomIndustry = () => {
    const value = normalizeCustomValue(customIndustryInput);
    if (value) {
      setCustomIndustry(value);
      setIndustry(value);
      setShowCustomIndustryInput(false);
      setCustomIndustryInput("");
      setEditingCustomIndustry(false);
    }
  };
  
  const handleEditCustomIndustry = () => {
    if (customIndustry) {
      setCustomIndustryInput(customIndustry);
      setEditingCustomIndustry(true);
      setShowCustomIndustryInput(true);
    }
  };
  
  const handleDeleteCustomIndustry = () => {
    if (industry === customIndustry) {
      setIndustry("");
    }
    setCustomIndustry(null);
    setCustomIndustryInput("");
    setEditingCustomIndustry(false);
    setShowCustomIndustryInput(false);
  };
  
  // Custom geography handlers
  const handleAddCustomGeography = () => {
    const value = normalizeCustomValue(customGeographyInput);
    if (value && geographies.length < 3) {
      setCustomGeography(value);
      setGeographies([...geographies, value]);
      setShowCustomGeographyInput(false);
      setCustomGeographyInput("");
      setEditingCustomGeography(false);
    }
  };
  
  const handleEditCustomGeography = () => {
    if (customGeography) {
      setCustomGeographyInput(customGeography);
      setEditingCustomGeography(true);
      setShowCustomGeographyInput(true);
    }
  };
  
  const handleSaveEditCustomGeography = () => {
    const value = normalizeCustomValue(customGeographyInput);
    if (value && customGeography) {
      const newGeographies = geographies.map(g => g === customGeography ? value : g);
      setGeographies(newGeographies);
      setCustomGeography(value);
      setShowCustomGeographyInput(false);
      setCustomGeographyInput("");
      setEditingCustomGeography(false);
    }
  };
  
  const handleDeleteCustomGeography = () => {
    if (customGeography) {
      setGeographies(geographies.filter(g => g !== customGeography));
    }
    setCustomGeography(null);
    setCustomGeographyInput("");
    setEditingCustomGeography(false);
    setShowCustomGeographyInput(false);
  };

  // URL management
  const addUrl = () => {
    if (!urlInput.trim()) return;
    try {
      new URL(urlInput);
      if (urls.length < 3 && !urls.some((u) => u.url === urlInput)) {
        setUrls([...urls, { url: urlInput, category: urlCategory }]);
        setUrlInput("");
      }
    } catch {
      toast({ title: "Invalid URL", variant: "destructive" });
    }
  };

  const removeUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  // Focus area management
  const addFocusArea = () => {
    const value = focusAreaInput.trim();
    if (!value) return;
    if (focusAreas.length < 10 && !focusAreas.includes(value)) {
      setFocusAreas([...focusAreas, value]);
      setFocusAreaInput("");
    }
  };

  const removeFocusArea = (index: number) => {
    setFocusAreas(focusAreas.filter((_, i) => i !== index));
  };

  // Brand alias management
  const addBrandAlias = () => {
    const value = brandAliasInput.trim();
    if (!value) return;
    if (brandAliases.length < 10 && !brandAliases.includes(value)) {
      setBrandAliases([...brandAliases, value]);
      setBrandAliasInput("");
    }
  };

  const removeBrandAlias = (index: number) => {
    setBrandAliases(brandAliases.filter((_, i) => i !== index));
  };

  // Geography toggle
  const toggleGeography = (geo: string) => {
    if (geographies.includes(geo)) {
      setGeographies(geographies.filter((g) => g !== geo));
    } else if (geographies.length < 3) {
      setGeographies([...geographies, geo]);
    }
  };

  // Competitor management
  const addCompetitor = () => {
    if (competitors.length < 5) {
      const newCompetitor: CompetitorData = {
        id: crypto.randomUUID(),
        name: "",
        website: "",
        aliases: [],
      };
      setCompetitors([...competitors, newCompetitor]);
    }
  };

  const removeCompetitor = (id: string) => {
    setCompetitors(competitors.filter((c) => c.id !== id));
    setExpandedCompetitors(expandedCompetitors.filter((cid) => cid !== id));
  };

  const updateCompetitor = (
    id: string,
    field: keyof Omit<CompetitorData, "id">,
    value: string,
  ) => {
    const updated = competitors.map((c) =>
      c.id === id ? { ...c, [field]: value } : c,
    );
    setCompetitors(updated);
  };

  const addCompetitorAlias = (competitorId: string, alias: string) => {
    if (!alias.trim()) return;
    const competitor = competitors.find((c) => c.id === competitorId);
    if (!competitor) return;

    const currentAliases = competitor.aliases || [];
    if (currentAliases.length >= 10) {
      toast({ title: "Maximum 10 aliases allowed", variant: "destructive" });
      return;
    }
    if (!currentAliases.includes(alias.trim())) {
      const updated = competitors.map((c) =>
        c.id === competitorId
          ? { ...c, aliases: [...currentAliases, alias.trim()] }
          : c,
      );
      setCompetitors(updated);
      // Clear input after adding
      setCompetitorAliasInputs({
        ...competitorAliasInputs,
        [competitorId]: "",
      });
    }
  };

  const removeCompetitorAlias = (competitorId: string, aliasIndex: number) => {
    const updated = competitors.map((c) =>
      c.id === competitorId
        ? { ...c, aliases: c.aliases.filter((_, i) => i !== aliasIndex) }
        : c,
    );
    setCompetitors(updated);
  };

  const handleCompetitorAliasKeyDown = (
    e: React.KeyboardEvent,
    competitorId: string,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const input = competitorAliasInputs[competitorId] || "";
      addCompetitorAlias(competitorId, input);
    }
  };

  // Expand/collapse all competitors
  const expandAllCompetitors = () => {
    setExpandedCompetitors(competitors.map((c) => c.id));
  };

  const collapseAllCompetitors = () => {
    setExpandedCompetitors([]);
  };

  // Model toggle
  const handleModelToggle = (modelId: string, checked: boolean) => {
    if (checked) {
      setSelectedModels([...selectedModels, modelId]);
    } else {
      setSelectedModels(selectedModels.filter((id) => id !== modelId));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5 text-primary" />
            <span>{isResumeMode ? "Set Up Project" : "Create Project/Client"}</span>
          </DialogTitle>
          <DialogDescription>
            {isResumeMode
              ? "Review and update this project's setup step by step"
              : "AI-powered onboarding to set up your client in minutes"}
          </DialogDescription>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-8">
          {[
            { num: 1, label: "Name", icon: Building },
            { num: 2, label: "URLs", icon: Globe },
            { num: 3, label: "Profile", icon: User },
            { num: 4, label: "Competitors", icon: Users },
            { num: 5, label: "AI Models", icon: Bot },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.num} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      currentStep > step.num
                        ? "bg-primary text-primary-foreground"
                        : currentStep === step.num
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {currentStep > step.num ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <span className="text-xs mt-2 font-medium">{step.label}</span>
                </div>
                {index < 4 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 transition-colors ${
                      currentStep > step.num ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step 1: Client Name */}
        {currentStep === 1 && (
          <Form {...step1Form}>
            <form className="space-y-6">
              <FormField
                control={step1Form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Q1 2025 Brand Campaign"
                        {...field}
                        data-testid="wizard-input-project-name"
                        autoFocus
                        onChange={(e) => {
                          field.onChange(e);
                          validateProjectName(e.target.value);
                        }}
                        onBlur={() => {
                          field.onBlur();
                          validateProjectName.flush();
                        }}
                        className={projectNameError ? "border-destructive" : ""}
                      />
                    </FormControl>
                    <FormDescription>
                      A unique identifier for this project in your catalog
                    </FormDescription>
                    {isValidatingProjectName && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking availability...
                      </p>
                    )}
                    {projectNameError && (
                      <p className="text-xs text-destructive">
                        ⚠️ {projectNameError}
                      </p>
                    )}
                    {!projectNameError &&
                      field.value &&
                      !isValidatingProjectName && (
                        <p className="text-xs text-green-600">
                          ✓ Project name is available
                        </p>
                      )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={step1Form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client/Company/Brand Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Tesla, Microsoft, Airbnb"
                        {...field}
                        data-testid="wizard-input-name"
                      />
                    </FormControl>
                    <FormDescription>
                      The brand name used in analysis and scoring
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        )}

        {/* Step 2: URLs & Focus Areas */}
        {currentStep === 2 && (
          <div className="space-y-6">
            {isEnrichingUrls && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>AI is analyzing {clientName}...</span>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Website URLs (up to 3)
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={recheckUrls}
                    disabled={isRecheckingUrls || urls.length === 0}
                    data-testid="wizard-recheck-urls"
                    title="Re-check URL reachability"
                  >
                    {isRecheckingUrls ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : null}
                    Re-check
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => enrichUrlsAndFocusAreas(clientName)}
                    disabled={isEnrichingUrls}
                    data-testid="wizard-rerun-url-ai"
                  >
                    <Sparkles className="h-4 w-4 mr-1" />
                    Re-run AI
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex space-x-2">
                  <Select
                    value={urlCategory}
                    onValueChange={(
                      value: "primary" | "secondary" | "thirdparty",
                    ) => setUrlCategory(value)}
                  >
                    <SelectTrigger
                      className="w-[140px]"
                      data-testid="wizard-select-url-category"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primary">Primary</SelectItem>
                      <SelectItem value="secondary">Secondary</SelectItem>
                      <SelectItem value="thirdparty">Third Party</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="url"
                    placeholder="https://example.com"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addUrl())
                    }
                    disabled={urls.length >= 3}
                    className="flex-1"
                    data-testid="wizard-input-url"
                  />
                  <Button
                    type="button"
                    onClick={addUrl}
                    disabled={urls.length >= 3 || !urlInput}
                    data-testid="wizard-add-url"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px]">
                  {urls.map((urlObj, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="px-3 py-1 flex items-center gap-2"
                      data-testid={`wizard-url-${index}`}
                    >
                      <span className="text-xs font-medium uppercase text-muted-foreground">
                        {urlObj.category}
                      </span>
                      <span className="text-foreground">{urlObj.url}</span>
                      <ReachabilityChip
                        url={urlObj.url}
                        result={urlReachability[urlObj.url]}
                        checking={checkingUrls.has(urlObj.url)}
                        onRecheck={recheckSingleUrl}
                      />
                      <button
                        type="button"
                        onClick={() => removeUrl(index)}
                        className="ml-1 hover:text-destructive"
                        data-testid={`wizard-remove-url-${index}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Focus Areas (up to 10)
              </label>
              <p className="text-sm text-muted-foreground mb-3">
                Client-specific products, services, or business capabilities
              </p>
              <div className="space-y-2">
                <div className="flex space-x-2">
                  <Input
                    placeholder="e.g., Cloud hosting, API management"
                    value={focusAreaInput}
                    onChange={(e) => setFocusAreaInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addFocusArea())
                    }
                    disabled={focusAreas.length >= 10}
                    data-testid="wizard-input-focus-area"
                  />
                  <Button
                    type="button"
                    onClick={addFocusArea}
                    disabled={focusAreas.length >= 10 || !focusAreaInput}
                    data-testid="wizard-add-focus-area"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px]">
                  {focusAreas.map((area, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="px-3 py-1"
                      data-testid={`wizard-focus-area-${index}`}
                    >
                      {area}
                      <button
                        type="button"
                        onClick={() => removeFocusArea(index)}
                        className="ml-2 hover:text-destructive"
                        data-testid={`wizard-remove-focus-area-${index}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Profile */}
        {currentStep === 3 && (
          <div className="space-y-6">
            {isEnrichingProfile && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>AI is building the profile...</span>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Industry *
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={enrichProfile}
                  disabled={isEnrichingProfile}
                  data-testid="wizard-rerun-profile-ai"
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  Re-run AI
                </Button>
              </div>
              <Popover open={industryPopoverOpen} onOpenChange={setIndustryPopoverOpen} modal={false}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                    data-testid="wizard-select-industry"
                  >
                    <span className={industry ? "" : "text-muted-foreground"}>
                      {industry || "Select industry"}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContentInline className="w-[350px] p-4 max-h-[350px]" align="start">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-medium">Select Industry</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIndustryPopoverOpen(false)}
                      data-testid="wizard-close-industry-popover"
                    >
                      Done
                    </Button>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto space-y-1 pr-2">
                    {INDUSTRIES.map((ind) => (
                      <div
                        key={ind}
                        className={`flex items-center justify-between px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted ${industry === ind ? "bg-muted" : ""}`}
                        onClick={() => { setIndustry(ind); setIndustryPopoverOpen(false); }}
                        data-testid={`wizard-industry-option-${ind.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        <span className="flex items-center gap-2">
                          {industry === ind && <Check className="h-4 w-4" />}
                          {industry !== ind && <span className="w-4" />}
                          {ind}
                        </span>
                      </div>
                    ))}
                    {customIndustry && (
                      <>
                        <div className="border-t my-2" />
                        <div
                          className={`flex items-center justify-between px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted ${industry === customIndustry ? "bg-muted" : ""}`}
                          onClick={() => { setIndustry(customIndustry); setIndustryPopoverOpen(false); }}
                          data-testid="wizard-industry-option-custom"
                        >
                          <span className="flex items-center gap-2">
                            {industry === customIndustry && <Check className="h-4 w-4" />}
                            {industry !== customIndustry && <span className="w-4" />}
                            <Badge variant="outline" className="text-xs">Custom</Badge>
                            {customIndustry}
                          </span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleEditCustomIndustry(); }}
                              className="p-1 hover:bg-background rounded"
                              data-testid="wizard-edit-custom-industry"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDeleteCustomIndustry(); }}
                              className="p-1 hover:bg-background hover:text-destructive rounded"
                              data-testid="wizard-delete-custom-industry"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                    {!customIndustry && !showCustomIndustryInput && (
                      <>
                        <div className="border-t my-2" />
                        <button
                          type="button"
                          onClick={() => setShowCustomIndustryInput(true)}
                          className="w-full px-2 py-1.5 text-sm text-left hover:bg-muted rounded flex items-center gap-2"
                          data-testid="wizard-add-custom-industry"
                        >
                          <Plus className="h-4 w-4" />
                          Add custom industry...
                        </button>
                      </>
                    )}
                    {showCustomIndustryInput && (
                      <div className="flex gap-2 mt-2">
                        <Input
                          value={customIndustryInput}
                          onChange={(e) => setCustomIndustryInput(e.target.value)}
                          placeholder="Enter custom industry"
                          className="flex-1 h-8"
                          data-testid="wizard-custom-industry-input"
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          onClick={handleAddCustomIndustry}
                          disabled={!customIndustryInput.trim()}
                          data-testid="wizard-save-custom-industry"
                        >
                          {editingCustomIndustry ? "Update" : "Add"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => {
                            setShowCustomIndustryInput(false);
                            setCustomIndustryInput("");
                            setEditingCustomIndustry(false);
                          }}
                          data-testid="wizard-cancel-custom-industry"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </PopoverContentInline>
              </Popover>
            </div>

            <div>
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Geography (1-3 regions) *
              </label>
              <p className="text-sm text-muted-foreground mb-3">
                Select up to 3 geographic regions
              </p>
              <Popover
                open={geographyPopoverOpen}
                onOpenChange={setGeographyPopoverOpen}
                modal={false}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                    data-testid="wizard-geography-dropdown"
                  >
                    <span className="text-muted-foreground">
                      {geographies.length === 0 && "Select regions..."}
                      {geographies.length === 1 && geographies[0]}
                      {geographies.length > 1 &&
                        `${geographies.length} regions selected`}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContentInline
                  className="w-[400px] p-4 max-h-[350px]"
                  align="start"
                >
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-sm font-medium">Select Regions</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setGeographyPopoverOpen(false)}
                      data-testid="wizard-close-geography-popover"
                    >
                      Done
                    </Button>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto space-y-2 pr-2">
                    {GEOGRAPHIES.map((geo) => (
                      <div key={geo} className="flex items-center space-x-2">
                        <Checkbox
                          id={`geo-${geo}`}
                          checked={geographies.includes(geo)}
                          onCheckedChange={(checked) => {
                            toggleGeography(geo);
                          }}
                          disabled={
                            !geographies.includes(geo) &&
                            geographies.length >= 3
                          }
                          data-testid={`wizard-geo-checkbox-${geo}`}
                        />
                        <label
                          htmlFor={`geo-${geo}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                        >
                          {geo}
                        </label>
                      </div>
                    ))}
                    
                    {/* Custom geography section */}
                    <div className="border-t my-2 pt-2">
                      {customGeography && (
                        <div className="flex items-center space-x-2 mb-2">
                          <Checkbox
                            id="geo-custom"
                            checked={geographies.includes(customGeography)}
                            onCheckedChange={(checked) => {
                              if (checked && geographies.length < 3) {
                                setGeographies([...geographies, customGeography]);
                              } else if (!checked) {
                                setGeographies(geographies.filter(g => g !== customGeography));
                              }
                            }}
                            disabled={
                              !geographies.includes(customGeography) &&
                              geographies.length >= 3
                            }
                            data-testid="wizard-geo-checkbox-custom"
                          />
                          <span className="flex items-center gap-2 flex-1">
                            <Badge variant="outline" className="text-xs">Custom</Badge>
                            <span className="text-sm font-medium">{customGeography}</span>
                          </span>
                          <button
                            type="button"
                            onClick={handleEditCustomGeography}
                            className="p-1 hover:bg-muted rounded"
                            data-testid="wizard-edit-custom-geography"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteCustomGeography}
                            className="p-1 hover:bg-muted hover:text-destructive rounded"
                            data-testid="wizard-delete-custom-geography"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      
                      {!customGeography && !showCustomGeographyInput && (
                        <button
                          type="button"
                          onClick={() => setShowCustomGeographyInput(true)}
                          className="w-full py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2 rounded px-2"
                          data-testid="wizard-add-custom-geography"
                        >
                          <Plus className="h-4 w-4" />
                          Add custom region...
                        </button>
                      )}
                      
                      {showCustomGeographyInput && (
                        <div className="flex gap-2 mt-2">
                          <Input
                            value={customGeographyInput}
                            onChange={(e) => setCustomGeographyInput(e.target.value)}
                            placeholder="Enter custom region"
                            className="flex-1 h-8"
                            data-testid="wizard-custom-geography-input"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={editingCustomGeography ? handleSaveEditCustomGeography : handleAddCustomGeography}
                            disabled={!customGeographyInput.trim() || (!editingCustomGeography && geographies.length >= 3)}
                            data-testid="wizard-save-custom-geography"
                          >
                            {editingCustomGeography ? "Update" : "Add"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => {
                              setShowCustomGeographyInput(false);
                              setCustomGeographyInput("");
                              setEditingCustomGeography(false);
                            }}
                            data-testid="wizard-cancel-custom-geography"
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </PopoverContentInline>
              </Popover>
              {geographies.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {geographies.map((geo, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="px-3 py-1"
                    >
                      {geo}
                      <button
                        type="button"
                        onClick={() => toggleGeography(geo)}
                        className="ml-2 hover:text-destructive"
                        data-testid={`wizard-remove-geo-${index}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Brand Aliases (up to 10)
              </label>
              <p className="text-sm text-muted-foreground mb-3">
                Alternative names, abbreviations, or product brands
              </p>
              <div className="space-y-2">
                <div className="flex space-x-2">
                  <Input
                    placeholder="e.g., ACME, Acme Corp"
                    value={brandAliasInput}
                    onChange={(e) => setBrandAliasInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addBrandAlias())
                    }
                    disabled={brandAliases.length >= 10}
                    data-testid="wizard-input-brand-alias"
                  />
                  <Button
                    type="button"
                    onClick={addBrandAlias}
                    disabled={brandAliases.length >= 10 || !brandAliasInput}
                    data-testid="wizard-add-brand-alias"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px]">
                  {brandAliases.map((alias, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="px-3 py-1"
                      data-testid={`wizard-brand-alias-${index}`}
                    >
                      {alias}
                      <button
                        type="button"
                        onClick={() => removeBrandAlias(index)}
                        className="ml-2 hover:text-destructive"
                        data-testid={`wizard-remove-brand-alias-${index}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Competitors */}
        {currentStep === 4 && (
          <div className="space-y-6">
            {isEnrichingCompetitors && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>AI is finding competitors...</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Competitors (up to 5)</h3>
                <p className="text-sm text-muted-foreground">
                  Track competitor brand visibility
                </p>
              </div>
              <div className="flex space-x-2">
                {competitors.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={expandAllCompetitors}
                      data-testid="wizard-expand-all-competitors"
                    >
                      Expand All
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={collapseAllCompetitors}
                      data-testid="wizard-collapse-all-competitors"
                    >
                      Collapse All
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={enrichCompetitors}
                  disabled={isEnrichingCompetitors}
                  data-testid="wizard-rerun-competitors-ai"
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  Re-run AI
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCompetitor}
                  disabled={competitors.length >= 5}
                  data-testid="wizard-add-competitor"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {competitors.length > 0 && (
              <Accordion
                type="multiple"
                value={expandedCompetitors}
                onValueChange={setExpandedCompetitors}
                className="space-y-2"
              >
                {competitors.map((competitor, index) => (
                  <AccordionItem
                    key={competitor.id}
                    value={competitor.id}
                    className="border border-border rounded-lg overflow-hidden"
                    data-testid={`wizard-competitor-accordion-${index}`}
                  >
                    <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent/50">
                      <div className="flex items-center justify-between w-full pr-2">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium">
                            {competitor.name || `Competitor ${index + 1}`}
                          </span>
                          {competitor.website && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                              {competitor.website}
                              <ReachabilityChip
                                url={competitor.website}
                                result={urlReachability[competitor.website]}
                                checking={checkingUrls.has(competitor.website)}
                                onRecheck={recheckSingleUrl}
                              />
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCompetitor(competitor.id);
                          }}
                          className="text-destructive h-8 w-8 p-0"
                          data-testid={`wizard-remove-competitor-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
                      <Input
                        placeholder="Company name"
                        value={competitor.name}
                        onChange={(e) =>
                          updateCompetitor(
                            competitor.id,
                            "name",
                            e.target.value,
                          )
                        }
                        data-testid={`wizard-competitor-name-${index}`}
                      />
                      <Input
                        type="url"
                        placeholder="Website (optional)"
                        value={competitor.website}
                        onChange={(e) =>
                          updateCompetitor(
                            competitor.id,
                            "website",
                            e.target.value,
                          )
                        }
                        data-testid={`wizard-competitor-website-${index}`}
                      />

                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          Brand Aliases (up to 10)
                        </label>
                        <div className="flex items-center gap-2 mt-2">
                          <Input
                            placeholder="Add alternative name"
                            value={competitorAliasInputs[competitor.id] || ""}
                            onChange={(e) =>
                              setCompetitorAliasInputs({
                                ...competitorAliasInputs,
                                [competitor.id]: e.target.value,
                              })
                            }
                            onKeyDown={(e) =>
                              handleCompetitorAliasKeyDown(e, competitor.id)
                            }
                            disabled={competitor.aliases.length >= 10}
                            data-testid={`wizard-competitor-alias-input-${index}`}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              addCompetitorAlias(
                                competitor.id,
                                competitorAliasInputs[competitor.id] || "",
                              )
                            }
                            disabled={
                              !competitorAliasInputs[competitor.id]?.trim() ||
                              competitor.aliases.length >= 10
                            }
                            data-testid={`wizard-add-competitor-alias-${index}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        {competitor.aliases.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {competitor.aliases.map((alias, aliasIdx) => (
                              <Badge
                                key={aliasIdx}
                                variant="secondary"
                                className="px-3 py-1"
                              >
                                {alias}
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeCompetitorAlias(
                                      competitor.id,
                                      aliasIdx,
                                    )
                                  }
                                  className="ml-2 hover:text-destructive"
                                  data-testid={`wizard-remove-competitor-alias-${index}-${aliasIdx}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}

            {competitors.length === 0 && (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                <p>No competitors added yet</p>
                <p className="text-sm">
                  Click "Add" or "Re-run AI" to get started
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 5: AI Models */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Models ({selectedModels.length})</h3>
                <p className="text-sm text-muted-foreground">
                  Choose which AI models to include in your analysis runs
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const allModelIds = aiModels.map(m => m.id);
                  if (selectedModels.length === allModelIds.length) {
                    setSelectedModels([]);
                  } else {
                    setSelectedModels(allModelIds);
                  }
                }}
                data-testid="wizard-select-all-models"
              >
                {selectedModels.length === aiModels.length ? "Clear All" : "All"}
              </Button>
            </div>

            {(() => {
              const coreModels = aiModels.filter(m => m.category === 'core');
              const additionalModels = aiModels.filter(m => m.category === 'additional');
              
              return (
                <Accordion type="multiple" defaultValue={["core"]} className="w-full">
                  {/* Core Models */}
                  <AccordionItem value="core" className="border-none">
                    <AccordionTrigger className="hover:no-underline py-2" data-testid="wizard-accordion-core">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        CORE ({coreModels.length})
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {coreModels.map((model) => (
                          <label
                            key={model.id}
                            className="flex items-start space-x-3 p-4 border border-border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                            data-testid={`wizard-model-${model.id}`}
                          >
                            <Checkbox
                              checked={selectedModels.includes(model.id)}
                              onCheckedChange={(checked) =>
                                handleModelToggle(model.id, checked as boolean)
                              }
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-foreground">
                                {model.displayName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {model.vendor}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {model.model === 'gpt-5.4' && "Flagship GPT-5.4 — strong reasoning and citations"}
                                {model.model === 'gpt-5.4-mini' && "Cost-effective GPT-5.4 variant for high-volume analysis"}
                                {model.model === 'gpt-5.4-nano' && "Cheapest GPT-5.4 variant — fast classification & summaries"}
                                {model.model === 'gpt-5.2' && "Enhanced reasoning and task completion"}
                                {model.model === 'gpt-4.1' && "Advanced reasoning and analysis capabilities"}
                                {model.model === 'claude-sonnet-4-5' && "Excellent for nuanced brand analysis and citations"}
                                {model.model === 'claude-opus-4-1' && "Highest-quality Anthropic model for deep analysis"}
                                {model.model === 'gemini-2.5-pro' && "Multimodal Gemini with strong reasoning"}
                                {model.model === 'gemini-2.5-flash' && "Fast Gemini variant for high-throughput tasks"}
                                {model.model === 'sonar-pro' && "Real-time web search with AI synthesis"}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Additional Models */}
                  <AccordionItem value="additional" className="border-none">
                    <AccordionTrigger className="hover:no-underline py-2" data-testid="wizard-accordion-additional">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        ADDITIONAL ({additionalModels.length})
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {additionalModels.map((model) => (
                          <label
                            key={model.id}
                            className="flex items-start space-x-3 p-4 border border-border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                            data-testid={`wizard-model-${model.id}`}
                          >
                            <Checkbox
                              checked={selectedModels.includes(model.id)}
                              onCheckedChange={(checked) =>
                                handleModelToggle(model.id, checked as boolean)
                              }
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-foreground">
                                {model.displayName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {model.vendor}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              );
            })()}

            {selectedModels.length === 0 && (
              <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md">
                Select at least one AI model to analyze your brand visibility
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-6 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={
              currentStep === 1
                ? handleClose
                : () => setCurrentStep(currentStep - 1)
            }
            data-testid="wizard-button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {currentStep === 1 ? "Cancel" : "Back"}
          </Button>

          {currentStep === 1 && (
            <Button
              type="button"
              onClick={handleStep1Next}
              disabled={createDraftMutation.isPending || isHydratingResume}
              data-testid="wizard-button-next"
            >
              {createDraftMutation.isPending || isHydratingResume ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isHydratingResume ? "Loading..." : "Creating..."}
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          )}

          {currentStep === 2 && (
            <Button
              type="button"
              onClick={handleStep2Next}
              disabled={updateClientMutation.isPending || urls.length === 0}
              data-testid="wizard-button-next"
            >
              {updateClientMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          )}

          {currentStep === 3 && (
            <Button
              type="button"
              onClick={handleStep3Next}
              disabled={
                updateClientMutation.isPending ||
                !industry ||
                geographies.length === 0
              }
              data-testid="wizard-button-next"
            >
              {updateClientMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          )}

          {currentStep === 4 && (
            <Button
              type="button"
              onClick={handleStep4Next}
              data-testid="wizard-button-next"
            >
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}

          {currentStep === 5 && (
            <Button
              type="button"
              onClick={handleFinalSubmit}
              disabled={
                completeOnboardingMutation.isPending ||
                selectedModels.length === 0
              }
              data-testid="wizard-button-create"
            >
              {completeOnboardingMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  Complete Setup
                  <Check className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
