import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { Trash2, Plus, Save, Sparkles, X, Check, ChevronDown, Pencil, AlertTriangle, Wand2 } from "lucide-react";
import CreateClientWizard from "@/components/create-client-wizard";
import { apiRequest, queryClient as appQueryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useActiveItemOfKind, describeStarter, invalidateActivityQueries } from "@/hooks/use-client-activity";
import { formatDistanceToNow } from "date-fns";
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
import { INDUSTRIES, GEOGRAPHIES, normalizeCustomValue } from "@/lib/industry-geography-options";
import { MetadataProgressOverlay } from "@/components/metadata-progress-overlay";
import type { Client, AiModel, Competitor } from "@shared/schema";
import { useLocation } from "wouter";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { useIsKindActive } from "@/components/activity/active-operations-banner";
import { useDebounce } from "@/hooks/use-debounce";

const configSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  name: z.string().min(1, "Company name is required"),
  industry: z.string().min(1, "Industry is required"),
});

type ConfigFormData = z.infer<typeof configSchema>;

interface CompetitorFormData {
  name: string;
  website: string;
  aliases: string;
}

export default function ClientConfiguration() {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  
  // Prefer `?clientId=` over the stored value so deep links / middle-clicked
  // sidebar items work even when localStorage is empty in the freshly-opened
  // tab. See `useUrlClientId` for the rationale.
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();

  const selectedClientId = urlClientId || storedClientId;
  // Task #56: surface another user's in-flight metadata generation so we
  // can soft-disable the trigger button below. Admins additionally get a
  // confirm-modal override so they can re-trigger if they know what they
  // are doing (e.g. the original run is wedged).
  const activeMetadataItem = useActiveItemOfKind(selectedClientId, "metadata_generation");
  const metadataGenerationActive = !!activeMetadataItem;
  const { session, user } = useAuth();
  const isAdmin = (session?.memberships ?? []).some((m) => m.role === "admin");
  const [confirmMetadataOverrideOpen, setConfirmMetadataOverrideOpen] = useState(false);
  const metadataActiveStarter = activeMetadataItem
    ? describeStarter(activeMetadataItem, user?.id ?? null)
    : null;
  const metadataActiveAgo = activeMetadataItem
    ? formatDistanceToNow(new Date(activeMetadataItem.startedAt), { addSuffix: true })
    : null;
  const metadataTooltip = activeMetadataItem
    ? `${metadataActiveStarter} started a metadata run ${metadataActiveAgo}.${
        isAdmin ? " Admins can override." : ""
      }`
    : undefined;

  // URL → store sync is handled centrally in ProtectedRoute. Keep the
  // store → URL backfill so refreshing /app/client-config (no query param)
  // produces a shareable link with the current selection.
  useEffect(() => {
    if (selectedClientId && !urlClientId) {
      const newUrl = `/app/client-config?clientId=${selectedClientId}`;
      window.history.replaceState(null, '', newUrl);
    }
  }, [selectedClientId, urlClientId]);
  
  const [competitors, setCompetitors] = useState<CompetitorFormData[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  // Task #15 — legacy projects with no saved model selection get a persisted
  // core-model default on the server. Remember that this project loaded
  // without a saved selection so we can show a "review & save" banner until
  // the user explicitly confirms a selection (saving clears it).
  const [legacySelectionNotice, setLegacySelectionNotice] = useState(false);
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const [enableSiteXRay, setEnableSiteXRay] = useState<boolean>(false);
  // Task #133 — re-launch the guided onboarding wizard for THIS existing
  // project, pre-filled with its saved data. Available regardless of
  // onboarding status.
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [projectNameError, setProjectNameError] = useState("");
  const [isValidatingProjectName, setIsValidatingProjectName] = useState(false);
  
  // URL interface
  interface ClientUrl {
    url: string;
    category: 'primary' | 'secondary' | 'thirdparty';
  }

  // Additional state for onboarding data
  const [urls, setUrls] = useState<ClientUrl[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [urlCategory, setUrlCategory] = useState<'primary' | 'secondary' | 'thirdparty'>('primary');
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [focusAreaInput, setFocusAreaInput] = useState("");
  const [geographies, setGeographies] = useState<string[]>([]);
  const [geographyPopoverOpen, setGeographyPopoverOpen] = useState(false);
  const [industryPopoverOpen, setIndustryPopoverOpen] = useState(false);
  const [brandAliases, setBrandAliases] = useState<string[]>([]);
  const [brandAliasInput, setBrandAliasInput] = useState("");

  // Task #89 — AI Visibility Context. Four optional fields used by the
  // realism-aware Prompt Library generator. Persona shapes voice; target
  // market sets currency/regulatory framing; test location resolves
  // "near me"; language sets the prompt language. All blank = generator
  // falls back to the legacy industry/geography envelope.
  const [targetCustomerPersona, setTargetCustomerPersona] = useState("");
  const [targetMarketCountry, setTargetMarketCountry] = useState("");
  const [primaryTestLocation, setPrimaryTestLocation] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("");
  
  // Custom industry/geography state
  const [customIndustry, setCustomIndustry] = useState<string | null>(null);
  const [customGeography, setCustomGeography] = useState<string | null>(null);
  const [showCustomIndustryInput, setShowCustomIndustryInput] = useState(false);
  const [showCustomGeographyInput, setShowCustomGeographyInput] = useState(false);
  const [customIndustryInput, setCustomIndustryInput] = useState("");
  const [customGeographyInput, setCustomGeographyInput] = useState("");
  const [editingCustomIndustry, setEditingCustomIndustry] = useState(false);
  const [editingCustomGeography, setEditingCustomGeography] = useState(false);

  // Fetch client data
  const { data: client } = useQuery<Client>({
    queryKey: ['/api/v1/clients', selectedClientId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/clients/${selectedClientId}`);
      if (!response.ok) throw new Error('Failed to fetch client');
      return response.json();
    },
    enabled: !!selectedClientId
  });

  // Fetch AI models
  const { data: allAiModels = [] } = useQuery<AiModel[]>({
    queryKey: ['/api/v1/ai-models'],
    queryFn: async () => {
      const response = await fetch('/api/v1/ai-models');
      if (!response.ok) throw new Error('Failed to fetch AI models');
      return response.json();
    }
  });

  // Task #10 — show every enabled model (matches the setup wizard). Model
  // families can have multiple selectable versions (e.g. Claude Opus 4.1 and
  // 4.5); collapsing to the latest version hid saved older-version selections.
  const aiModels = useMemo(() => allAiModels.filter((m) => m.enabled), [allAiModels]);

  // Fetch client models
  const { data: clientModels = [] } = useQuery<AiModel[]>({
    queryKey: ['/api/v1/clients', selectedClientId, 'models'],
    queryFn: async () => {
      const response = await fetch(`/api/v1/clients/${selectedClientId}/models`);
      if (!response.ok) throw new Error('Failed to fetch client models');
      return response.json();
    },
    enabled: !!selectedClientId
  });

  // Fetch competitors
  const { data: existingCompetitors = [] } = useQuery<Competitor[]>({
    queryKey: ['/api/v1/competitors', selectedClientId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/competitors?client_id=${selectedClientId}`);
      if (!response.ok) throw new Error('Failed to fetch competitors');
      return response.json();
    },
    enabled: !!selectedClientId
  });

  const form = useForm<ConfigFormData>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      projectName: "",
      name: "",
      industry: "",
    }
  });

  // Debounced project name validation
  const validateProjectName = useDebounce(async (value: string) => {
    if (!value.trim() || !selectedClientId || !client) {
      setProjectNameError("");
      return;
    }
    
    setIsValidatingProjectName(true);
    try {
      const response = await fetch(
        `/api/v1/clients/validate-project-name?` +
        `projectName=${encodeURIComponent(value)}&` +
        `orgId=${client.orgId}&` +
        `excludeId=${selectedClientId}`
      );
      
      if (!response.ok) {
        throw new Error('Validation failed');
      }
      
      const result = await response.json();
      
      if (!result.available) {
        setProjectNameError("This project name is already in use");
      } else {
        setProjectNameError("");
      }
    } catch (error) {
      console.error("Validation failed:", error);
    } finally {
      setIsValidatingProjectName(false);
    }
  }, 500);

  // Update form when client data loads
  useEffect(() => {
    if (client) {
      form.reset({
        projectName: client.projectName || "",
        name: client.name,
        industry: client.industry || "",
      });
      
      // Populate URLs (handle both old string[] format and new ClientUrl[] format)
      if (Array.isArray(client.urls) && client.urls.length > 0) {
        const firstUrl = client.urls[0];
        if (typeof firstUrl === 'string') {
          // Legacy format: convert string[] to ClientUrl[]
          setUrls(client.urls.map((url: string, idx: number) => ({ 
            url, 
            category: idx === 0 ? 'primary' as const : 'secondary' as const 
          })));
        } else {
          // New format: already ClientUrl[]
          setUrls(client.urls as ClientUrl[]);
        }
      } else if (client.website) {
        // Very old format: single website field
        setUrls([{ url: client.website, category: 'primary' }]);
      } else {
        setUrls([]);
      }
      
      // Populate focus areas
      if (Array.isArray(client.focusAreas)) {
        setFocusAreas(client.focusAreas as string[]);
      }
      
      // Populate geographies
      if (client.geography) {
        if (typeof client.geography === 'string') {
          setGeographies(client.geography.split(',').map(s => s.trim()));
        } else if (Array.isArray(client.geography)) {
          setGeographies(client.geography);
        }
      }
      
      // Populate brand aliases
      if (Array.isArray(client.brandAliases)) {
        setBrandAliases(client.brandAliases as string[]);
      }
      
      // Populate custom industry/geography
      if (client.customIndustry) {
        setCustomIndustry(client.customIndustry);
      }
      if (client.customGeography) {
        setCustomGeography(client.customGeography);
      }

      // Task #89 — populate AI Visibility Context fields
      setTargetCustomerPersona(client.targetCustomerPersona || "");
      setTargetMarketCountry(client.targetMarketCountry || "");
      setPrimaryTestLocation(client.primaryTestLocation || "");
      setPrimaryLanguage(client.primaryLanguage || "");
    }
  }, [client, form]);

  // Update competitors when data loads
  useEffect(() => {
    if (existingCompetitors.length > 0) {
      setCompetitors(existingCompetitors.map(comp => ({
        name: comp.name,
        website: comp.website || "",
        aliases: Array.isArray(comp.aliases) ? comp.aliases.join(", ") : "",
      })));
    }
  }, [existingCompetitors]);

  // Task #15 — flag projects that loaded without a saved selection.
  useEffect(() => {
    if (client && !Array.isArray(client.selectedAiModelIds)) {
      setLegacySelectionNotice(true);
    }
  }, [client]);

  // Reset the notice when switching projects.
  useEffect(() => {
    setLegacySelectionNotice(false);
  }, [selectedClientId]);

  // Update selected models when client data loads
  useEffect(() => {
    if (client?.selectedAiModelIds && Array.isArray(client.selectedAiModelIds)) {
      setSelectedModels(client.selectedAiModelIds as string[]);
    } else if (clientModels.length > 0) {
      // Fallback to clientModels if selectedAiModelIds is not set
      setSelectedModels(clientModels.map(model => model.id));
    }
  }, [client, clientModels]);

  const updateClientMutation = useMutation({
    mutationFn: async (data: ConfigFormData) => {
      return apiRequest('PUT', `/api/v1/clients/${selectedClientId}`, {
        ...data,
        urls,
        focusAreas,
        geography: geographies.join(", "),
        brandAliases,
        // Task #10 — model selection is saved exclusively through
        // PUT /clients/:id/models (validated + written atomically there).
        customIndustry: customIndustry || null,
        customGeography: customGeography || null,
        // Task #89 — persist AI Visibility Context (all optional)
        targetCustomerPersona: targetCustomerPersona.trim() || null,
        targetMarketCountry: targetMarketCountry.trim() || null,
        primaryTestLocation: primaryTestLocation.trim() || null,
        primaryLanguage: primaryLanguage.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/clients', selectedClientId] });
    },
    onError: (err) => {
      errorToast("Failed to update client", err);
    }
  });

  const updateModelsMutation = useMutation({
    mutationFn: async (modelIds: string[]) => {
      return apiRequest('PUT', `/api/v1/clients/${selectedClientId}/models`, {
        model_ids: modelIds
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/clients', selectedClientId, 'models'] });
      // Task #15 — the saved selection also lives on the client row
      // (selectedAiModelIds); refetch it so the missing-selection banner is
      // driven by current server state, and clear the local notice now that
      // the user explicitly confirmed a selection.
      queryClient.invalidateQueries({ queryKey: ['/api/v1/clients', selectedClientId] });
      setLegacySelectionNotice(false);
    },
    onError: (err) => {
      errorToast("Failed to update AI models", err);
    }
  });

  const saveCompetitorsMutation = useMutation({
    mutationFn: async (competitorsData: CompetitorFormData[]) => {
      // Delete all existing competitors first
      if (existingCompetitors.length > 0) {
        await Promise.all(
          existingCompetitors.map(comp => 
            apiRequest('DELETE', `/api/v1/competitors/${comp.id}`, {})
          )
        );
      }
      
      // Create new competitors
      if (competitorsData.length > 0) {
        await Promise.all(
          competitorsData
            .filter(comp => comp.name.trim() !== '') // Only save competitors with names
            .map(comp => 
              apiRequest('POST', '/api/v1/competitors', {
                clientId: selectedClientId,
                name: comp.name,
                website: comp.website || null,
                aliases: comp.aliases ? comp.aliases.split(',').map(s => s.trim()) : []
              })
            )
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/competitors', selectedClientId] });
    }
  });

  const generateMetadataMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/v1/clients/${selectedClientId}/generate-metadata`, {
        enableSiteXRay
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      // Set the job ID to show the progress overlay
      setGeneratingJobId(data.jobId);
      invalidateActivityQueries(selectedClientId);
    },
    onError: (err) => {
      errorToast("Failed to generate metadata", err);
    }
  });

  const onSubmit = async (data: ConfigFormData) => {
    try {
      await updateClientMutation.mutateAsync(data);
      await saveCompetitorsMutation.mutateAsync(competitors);
      await updateModelsMutation.mutateAsync(selectedModels);
      
      // The topbar reads the client by ID via React Query; invalidating that
      // query is enough for the renamed project name to appear in the header.
      if (selectedClientId) {
        queryClient.invalidateQueries({ queryKey: ['/api/v1/clients', selectedClientId] });
      }

      toast({ title: "Configuration saved successfully" });
    } catch (error) {
      errorToast("Failed to save configuration", error);
    }
  };

  const addCompetitor = () => {
    setCompetitors([...competitors, { name: "", website: "", aliases: "" }]);
  };

  const removeCompetitor = (index: number) => {
    setCompetitors(competitors.filter((_, i) => i !== index));
  };

  const updateCompetitor = (index: number, field: keyof CompetitorFormData, value: string) => {
    const updated = [...competitors];
    updated[index] = { ...updated[index], [field]: value };
    setCompetitors(updated);
  };

  const handleModelToggle = (modelId: string, checked: boolean) => {
    if (checked) {
      setSelectedModels([...selectedModels, modelId]);
    } else {
      setSelectedModels(selectedModels.filter(id => id !== modelId));
    }
  };

  // URL helpers
  const addUrl = () => {
    if (urlInput.trim() && urls.length < 3) {
      setUrls([...urls, { url: urlInput.trim(), category: urlCategory }]);
      setUrlInput("");
    }
  };

  const removeUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  // Focus area helpers
  const addFocusArea = () => {
    if (focusAreaInput.trim() && focusAreas.length < 10) {
      setFocusAreas([...focusAreas, focusAreaInput.trim()]);
      setFocusAreaInput("");
    }
  };

  const removeFocusArea = (index: number) => {
    setFocusAreas(focusAreas.filter((_, i) => i !== index));
  };

  // Geography helpers
  const toggleGeography = (geo: string) => {
    if (geographies.includes(geo)) {
      setGeographies(geographies.filter(g => g !== geo));
    } else if (geographies.length < 3) {
      setGeographies([...geographies, geo]);
    }
  };

  // Brand alias helpers
  const addBrandAlias = () => {
    if (brandAliasInput.trim() && brandAliases.length < 10) {
      setBrandAliases([...brandAliases, brandAliasInput.trim()]);
      setBrandAliasInput("");
    }
  };

  const removeBrandAlias = (index: number) => {
    setBrandAliases(brandAliases.filter((_, i) => i !== index));
  };

  // Custom industry handlers
  const handleAddCustomIndustry = () => {
    const value = normalizeCustomValue(customIndustryInput);
    if (value) {
      setCustomIndustry(value);
      form.setValue("industry", value);
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
    if (form.getValues("industry") === customIndustry) {
      form.setValue("industry", "");
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

  if (!selectedClientId) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-foreground mb-2">No Project Selected</h2>
          <p className="text-muted-foreground">Pick a project from the switcher in the top right to open its settings.</p>
        </div>
      </div>
    );
  }

  return (
    // Task #91 — `relative` is intentional. It makes this wrapper the
    // containing block for absolutely-positioned descendants (notably
    // the hidden Radix Checkbox `<input style="position:absolute">`
    // proxies in the AI Models card). Without it, those inputs escape
    // `<main>`'s overflow-auto box and balloon `<html>`'s scrollHeight,
    // producing a second document-level scrollbar next to `<main>`'s.
    <div className="fade-in relative">
      {/* Task #79 — One-time banners for any models an admin disabled
          while this user was away. Each banner can be dismissed
          independently and the underlying entry on the client row is
          cleared on dismiss. */}
      <DisabledModelBanners
        clientId={selectedClientId}
        notifications={
          (Array.isArray(client?.disabledModelNotifications)
            ? (client?.disabledModelNotifications as Array<{
                id: string;
                modelId: string;
                modelName: string;
                vendor: string;
                disabledAt: string;
              }>)
            : []) || []
        }
      />
      {/* Header */}
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Project Settings</h2>
            <p className="text-muted-foreground mt-1">Configure project details and analysis settings</p>
          </div>
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-2 mr-2">
              <Checkbox 
                id="enable-xray"
                checked={enableSiteXRay}
                onCheckedChange={(checked) => setEnableSiteXRay(checked === true)}
                data-testid="checkbox-enable-xray"
              />
              <label 
                htmlFor="enable-xray" 
                className="text-sm text-muted-foreground cursor-pointer"
                data-testid="label-enable-xray"
              >
                Site X-Ray Analysis
              </label>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowSetupWizard(true)}
              disabled={!selectedClientId}
              data-testid="button-launch-setup-wizard"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Launch setup wizard
            </Button>
            <Button
              onClick={() => {
                if (metadataGenerationActive && isAdmin) {
                  setConfirmMetadataOverrideOpen(true);
                } else {
                  generateMetadataMutation.mutate();
                }
              }}
              disabled={
                urls.length === 0 ||
                generateMetadataMutation.isPending ||
                (metadataGenerationActive && !isAdmin)
              }
              variant="outline"
              data-testid="button-generate-metadata"
              title={metadataTooltip}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {metadataGenerationActive
                ? isAdmin ? 'Override running…' : 'Already running…'
                : generateMetadataMutation.isPending ? 'Generating...' : 'Generate Metadata'}
            </Button>
            <AlertDialog open={confirmMetadataOverrideOpen} onOpenChange={setConfirmMetadataOverrideOpen}>
              <AlertDialogContent data-testid="dialog-confirm-metadata-override">
                <AlertDialogHeader>
                  <AlertDialogTitle>Overwrite the metadata run already in progress?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {metadataActiveStarter && metadataActiveAgo
                      ? `${metadataActiveStarter === "you" ? "You" : metadataActiveStarter} started a metadata generation ${metadataActiveAgo}.`
                      : "Another metadata generation is currently running for this project."}{" "}
                    Triggering a new one will run in parallel and may overwrite their results.
                    Continue anyway?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-metadata-override">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="button-confirm-metadata-override"
                    onClick={() => {
                      setConfirmMetadataOverrideOpen(false);
                      generateMetadataMutation.mutate();
                    }}
                  >
                    Override and start
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button 
              onClick={form.handleSubmit(onSubmit)}
              disabled={updateClientMutation.isPending || updateModelsMutation.isPending || saveCompetitorsMutation.isPending}
              data-testid="button-save-config"
            >
              <Save className="mr-2 h-4 w-4" />
              {(updateClientMutation.isPending || updateModelsMutation.isPending || saveCompetitorsMutation.isPending) ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="p-6 max-w-4xl">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Project Identification */}
            <Card>
              <CardHeader>
                <CardTitle>Project Identification</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="projectName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Name *</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="e.g., Q1 2025 Brand Campaign"
                          data-testid="input-project-name" 
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
                      <p className="text-sm text-muted-foreground">
                        Unique identifier for this project. Not used in analysis or scoring.
                      </p>
                      {isValidatingProjectName && (
                        <p className="text-xs text-muted-foreground">
                          Checking availability...
                        </p>
                      )}
                      {projectNameError && (
                        <p className="text-xs text-destructive">
                          ⚠️ {projectNameError}
                        </p>
                      )}
                      {!projectNameError && form.getValues('projectName') && !isValidatingProjectName && (
                        <p className="text-xs text-green-600">
                          ✓ Project name is available
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company/Brand Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-company-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <Popover open={industryPopoverOpen} onOpenChange={setIndustryPopoverOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="w-full justify-between"
                              data-testid="select-industry"
                            >
                              <span className={field.value ? "" : "text-muted-foreground"}>
                                {field.value || "Select industry"}
                              </span>
                              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[350px] p-4" align="start">
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-sm font-medium">Select Industry</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setIndustryPopoverOpen(false)}
                              data-testid="config-close-industry-popover"
                            >
                              Done
                            </Button>
                          </div>
                          <div className="max-h-[300px] overflow-y-auto space-y-1">
                            {INDUSTRIES.map((ind) => (
                              <div
                                key={ind}
                                className={`flex items-center justify-between px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted ${field.value === ind ? "bg-muted" : ""}`}
                                onClick={() => { field.onChange(ind); setIndustryPopoverOpen(false); }}
                                data-testid={`config-industry-option-${ind.toLowerCase().replace(/\s+/g, '-')}`}
                              >
                                <span className="flex items-center gap-2">
                                  {field.value === ind && <Check className="h-4 w-4" />}
                                  {field.value !== ind && <span className="w-4" />}
                                  {ind}
                                </span>
                              </div>
                            ))}
                            {customIndustry && (
                              <>
                                <div className="border-t my-2" />
                                <div
                                  className={`flex items-center justify-between px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-muted ${field.value === customIndustry ? "bg-muted" : ""}`}
                                  onClick={() => { field.onChange(customIndustry); setIndustryPopoverOpen(false); }}
                                  data-testid="config-industry-option-custom"
                                >
                                  <span className="flex items-center gap-2">
                                    {field.value === customIndustry && <Check className="h-4 w-4" />}
                                    {field.value !== customIndustry && <span className="w-4" />}
                                    <Badge variant="outline" className="text-xs">Custom</Badge>
                                    {customIndustry}
                                  </span>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleEditCustomIndustry(); }}
                                      className="p-1 hover:bg-background rounded"
                                      data-testid="config-edit-custom-industry"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteCustomIndustry(); }}
                                      className="p-1 hover:bg-background hover:text-destructive rounded"
                                      data-testid="config-delete-custom-industry"
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
                                  data-testid="config-add-custom-industry"
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
                                  data-testid="config-custom-industry-input"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8"
                                  onClick={handleAddCustomIndustry}
                                  disabled={!customIndustryInput.trim()}
                                  data-testid="config-save-custom-industry"
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
                                  data-testid="config-cancel-custom-industry"
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

              </CardContent>
            </Card>

            {/* Website URLs */}
            <Card>
              <CardHeader>
                <CardTitle>Website URLs</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Primary and secondary URLs to analyze (up to 3)
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex space-x-2">
                    <Select value={urlCategory} onValueChange={(value: 'primary' | 'secondary' | 'thirdparty') => setUrlCategory(value)}>
                      <SelectTrigger className="w-[140px]" data-testid="select-url-category">
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
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUrl())}
                      disabled={urls.length >= 3}
                      className="flex-1"
                      data-testid="input-url"
                    />
                    <Button
                      type="button"
                      onClick={addUrl}
                      disabled={urls.length >= 3 || !urlInput}
                      data-testid="button-add-url"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 min-h-[40px]">
                    {urls.map((urlObj, index) => (
                      <Badge key={index} variant="secondary" className="px-3 py-1 flex items-center gap-2" data-testid={`badge-url-${index}`}>
                        <span className="text-xs font-medium uppercase text-muted-foreground">{urlObj.category}</span>
                        <span className="text-foreground">{urlObj.url}</span>
                        <button
                          type="button"
                          onClick={() => removeUrl(index)}
                          className="ml-1 hover:text-destructive"
                          data-testid={`button-remove-url-${index}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Focus Areas */}
            <Card>
              <CardHeader>
                <CardTitle>Focus Areas</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Client-specific products, services, or business capabilities (up to 10)
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex space-x-2">
                    <Input
                      placeholder="e.g., Cloud hosting, API management"
                      value={focusAreaInput}
                      onChange={(e) => setFocusAreaInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFocusArea())}
                      disabled={focusAreas.length >= 10}
                      data-testid="input-focus-area"
                    />
                    <Button
                      type="button"
                      onClick={addFocusArea}
                      disabled={focusAreas.length >= 10 || !focusAreaInput}
                      data-testid="button-add-focus-area"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 min-h-[40px]">
                    {focusAreas.map((area, index) => (
                      <Badge key={index} variant="secondary" className="px-3 py-1" data-testid={`badge-focus-area-${index}`}>
                        {area}
                        <button
                          type="button"
                          onClick={() => removeFocusArea(index)}
                          className="ml-2 hover:text-destructive"
                          data-testid={`button-remove-focus-area-${index}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Geography */}
            <Card>
              <CardHeader>
                <CardTitle>Geography</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Select target regions (1-3 regions)
                </p>
              </CardHeader>
              <CardContent>
                <Popover open={geographyPopoverOpen} onOpenChange={setGeographyPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                      data-testid="config-geography-dropdown"
                    >
                      <span className="text-muted-foreground">
                        {geographies.length === 0 && "Select regions..."}
                        {geographies.length === 1 && geographies[0]}
                        {geographies.length > 1 && `${geographies.length} regions selected`}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-[400px] p-4 pointer-events-auto" 
                    align="start"
                  >
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-sm font-medium">Select Regions</span>
                      <Button variant="ghost" size="sm" onClick={() => setGeographyPopoverOpen(false)} data-testid="config-close-geography-popover">
                        Done
                      </Button>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
                      {GEOGRAPHIES.map((geo) => (
                        <div key={geo} className="flex items-center space-x-2">
                          <Checkbox
                            id={`config-geo-${geo}`}
                            checked={geographies.includes(geo)}
                            onCheckedChange={(checked) => {
                              toggleGeography(geo);
                            }}
                            disabled={!geographies.includes(geo) && geographies.length >= 3}
                            data-testid={`config-geo-checkbox-${geo}`}
                          />
                          <label
                            htmlFor={`config-geo-${geo}`}
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
                              id="config-geo-custom"
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
                              data-testid="config-geo-checkbox-custom"
                            />
                            <span className="flex items-center gap-2 flex-1">
                              <Badge variant="outline" className="text-xs">Custom</Badge>
                              <span className="text-sm font-medium">{customGeography}</span>
                            </span>
                            <button
                              type="button"
                              onClick={handleEditCustomGeography}
                              className="p-1 hover:bg-muted rounded"
                              data-testid="config-edit-custom-geography"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={handleDeleteCustomGeography}
                              className="p-1 hover:bg-muted hover:text-destructive rounded"
                              data-testid="config-delete-custom-geography"
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
                            data-testid="config-add-custom-geography"
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
                              data-testid="config-custom-geography-input"
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-8"
                              onClick={editingCustomGeography ? handleSaveEditCustomGeography : handleAddCustomGeography}
                              disabled={!customGeographyInput.trim() || (!editingCustomGeography && geographies.length >= 3)}
                              data-testid="config-save-custom-geography"
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
                              data-testid="config-cancel-custom-geography"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                {geographies.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {geographies.map((geo, index) => (
                      <Badge key={index} variant="secondary" className="px-3 py-1">
                        {geo}
                        <button
                          type="button"
                          onClick={() => toggleGeography(geo)}
                          className="ml-2 hover:text-destructive"
                          data-testid={`config-remove-geo-${index}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Brand Aliases */}
            <Card>
              <CardHeader>
                <CardTitle>Brand Aliases</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Alternative names, abbreviations, or product brands (up to 10)
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex space-x-2">
                    <Input
                      placeholder="e.g., ACME, Acme Corp"
                      value={brandAliasInput}
                      onChange={(e) => setBrandAliasInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addBrandAlias())}
                      disabled={brandAliases.length >= 10}
                      data-testid="input-brand-alias"
                    />
                    <Button
                      type="button"
                      onClick={addBrandAlias}
                      disabled={brandAliases.length >= 10 || !brandAliasInput}
                      data-testid="button-add-brand-alias"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 min-h-[40px]">
                    {brandAliases.map((alias, index) => (
                      <Badge key={index} variant="secondary" className="px-3 py-1" data-testid={`badge-brand-alias-${index}`}>
                        {alias}
                        <button
                          type="button"
                          onClick={() => removeBrandAlias(index)}
                          className="ml-2 hover:text-destructive"
                          data-testid={`button-remove-brand-alias-${index}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Task #89 — AI Visibility Context. All four fields are
                optional. The realism-aware Prompt Library generator
                consults them to set persona voice, currency / regulatory
                framing, the value of "near me", and the prompt
                language. */}
            <Card>
              <CardHeader>
                <CardTitle>AI Visibility Context</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Optional. Helps the prompt generator write realistic, in-market questions.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Target customer persona
                    </label>
                    <Input
                      placeholder="e.g., Busy parent shopping for the family"
                      value={targetCustomerPersona}
                      onChange={(e) => setTargetCustomerPersona(e.target.value)}
                      data-testid="input-target-customer-persona"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Shapes the voice of generated prompts.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Target market country
                    </label>
                    <Input
                      placeholder="e.g., United States, United Arab Emirates"
                      value={targetMarketCountry}
                      onChange={(e) => setTargetMarketCountry(e.target.value)}
                      data-testid="input-target-market-country"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Sets currency, regulatory framing, and locale.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Primary test location
                    </label>
                    <Input
                      placeholder='e.g., Chicago, IL — used as "near me"'
                      value={primaryTestLocation}
                      onChange={(e) => setPrimaryTestLocation(e.target.value)}
                      data-testid="input-primary-test-location"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Concrete city/area used when prompts say "near me".
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Primary language
                    </label>
                    <Input
                      placeholder="e.g., en-US, ar-AE, en-GB"
                      value={primaryLanguage}
                      onChange={(e) => setPrimaryLanguage(e.target.value)}
                      data-testid="input-primary-language"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Language and locale tag for prompt generation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Competitors */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Competitors</CardTitle>
                  <Button type="button" variant="outline" onClick={addCompetitor} data-testid="button-add-competitor">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Competitor
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {competitors.map((competitor, index) => (
                  <div key={index} className="border border-border rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Competitor Name
                        </label>
                        <Input
                          value={competitor.name}
                          onChange={(e) => updateCompetitor(index, 'name', e.target.value)}
                          data-testid={`input-competitor-name-${index}`}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Website
                        </label>
                        <Input
                          type="url"
                          value={competitor.website}
                          onChange={(e) => updateCompetitor(index, 'website', e.target.value)}
                          data-testid={`input-competitor-website-${index}`}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeCompetitor(index)}
                          className="text-destructive"
                          data-testid={`button-remove-competitor-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Aliases
                      </label>
                      <Input
                        value={competitor.aliases}
                        onChange={(e) => updateCompetitor(index, 'aliases', e.target.value)}
                        placeholder="TechCorp, TC Inc"
                        data-testid={`input-competitor-aliases-${index}`}
                      />
                    </div>
                  </div>
                ))}
                {competitors.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No competitors added yet. Click "Add Competitor" to get started.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Models */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>AI Models ({selectedModels.length} selected)</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Select which AI models to include in your analysis runs.
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
                    data-testid="config-select-all-models"
                  >
                    {selectedModels.length === aiModels.length ? "Clear All" : "All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {legacySelectionNotice && (
                  <div
                    className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                    data-testid="banner-no-model-selection"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This project doesn't have a saved AI model selection yet, so runs
                      default to the core models. Review the selection below and save to
                      confirm which models should run.
                    </span>
                  </div>
                )}
                {(() => {
                  const coreModels = aiModels.filter(m => m.category === 'core');
                  const additionalModels = aiModels.filter(m => m.category === 'additional');
                  
                  return (
                    <Accordion type="multiple" defaultValue={["core"]} className="w-full">
                      {/* Core Models */}
                      <AccordionItem value="core" className="border-none">
                        <AccordionTrigger className="hover:no-underline py-2" data-testid="config-accordion-core">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            CORE ({coreModels.length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {coreModels.map((model) => (
                              <label
                                key={model.id}
                                className="flex items-start space-x-3 p-4 border border-border rounded-lg hover:bg-accent cursor-pointer"
                                data-testid={`model-option-${model.id}`}
                              >
                                <Checkbox
                                  checked={selectedModels.includes(model.id)}
                                  onCheckedChange={(checked) => handleModelToggle(model.id, checked as boolean)}
                                  className="mt-1"
                                />
                                <div className="flex-1">
                                  <div className="font-medium text-foreground">{model.displayName}</div>
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
                        <AccordionTrigger className="hover:no-underline py-2" data-testid="config-accordion-additional">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            ADDITIONAL ({additionalModels.length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {additionalModels.map((model) => (
                              <label
                                key={model.id}
                                className="flex items-start space-x-3 p-4 border border-border rounded-lg hover:bg-accent cursor-pointer"
                                data-testid={`model-option-${model.id}`}
                              >
                                <Checkbox
                                  checked={selectedModels.includes(model.id)}
                                  onCheckedChange={(checked) => handleModelToggle(model.id, checked as boolean)}
                                  className="mt-1"
                                />
                                <div className="flex-1">
                                  <div className="font-medium text-foreground">{model.displayName}</div>
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
              </CardContent>
            </Card>
          </form>
        </Form>
      </div>
      
      {/* Metadata Progress Overlay */}
      {generatingJobId && (
        <MetadataProgressOverlay
          jobId={generatingJobId}
          onComplete={() => {
            setGeneratingJobId(null);
            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['/api/v1/topics', selectedClientId] });
            queryClient.invalidateQueries({ queryKey: ['/api/v1/prompts', selectedClientId] });
          }}
        />
      )}

      {/* Task #133 — re-launch onboarding for this existing project. The
          wizard hydrates from the project's saved data and saves back to the
          same project (no duplicate). On complete we refresh this page's
          queries so edits show up immediately. */}
      {showSetupWizard && selectedClientId && (
        <CreateClientWizard
          open={showSetupWizard}
          existingClientId={selectedClientId}
          onClose={() => setShowSetupWizard(false)}
          onComplete={() => {
            setShowSetupWizard(false);
            queryClient.invalidateQueries({ queryKey: ['/api/v1/clients', selectedClientId] });
            queryClient.invalidateQueries({ queryKey: ['/api/v1/clients', selectedClientId, 'models'] });
            queryClient.invalidateQueries({ queryKey: ['/api/v1/competitors', selectedClientId] });
          }}
        />
      )}
    </div>
  );
}

// Task #79 — Renders one dismissible amber banner per disabled-model
// notification queued onto `clients.disabledModelNotifications`. Dismiss
// fires the per-notification dismiss endpoint and refreshes the client
// query so the banner disappears.
type DisabledNotification = {
  id: string;
  modelId: string;
  modelName: string;
  vendor: string;
  disabledAt: string;
  reason?: string | null;
};

function DisabledModelBanners({
  clientId,
  notifications,
}: {
  clientId: string | null;
  notifications: DisabledNotification[];
}) {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const dismiss = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!clientId) return;
      await apiRequest(
        "POST",
        `/api/v1/clients/${clientId}/disabled-model-notifications/${notificationId}/dismiss`,
        {},
      );
    },
    onSuccess: () => {
      if (clientId) {
        appQueryClient.invalidateQueries({ queryKey: ["/api/v1/clients", clientId] });
      }
    },
    onError: (err) => {
      errorToast("Couldn't dismiss notification", err);
    },
  });

  if (!notifications.length || !clientId) return null;

  return (
    <div className="px-6 pt-4 space-y-2" data-testid="disabled-model-banners">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
          data-testid={`banner-disabled-model-${n.modelId}`}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              {n.modelName} ({n.vendor}) was removed by an administrator on{" "}
              {new Date(n.disabledAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </div>
            <div className="text-muted-foreground text-xs mt-0.5">
              It has been removed from this project's selected models. Pick a
              replacement under AI Models below.
              {n.reason ? <> Reason: <em>{n.reason}</em></> : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismiss.mutate(n.id)}
            disabled={dismiss.isPending}
            data-testid={`button-dismiss-banner-${n.id}`}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
