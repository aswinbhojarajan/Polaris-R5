import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { queryClient, apiRequest, apiClient } from "@/lib/queryClient";
import { Play, Loader2, AlertCircle, Search, ChevronDown, ChevronRight } from "lucide-react";
import { useClientActivityItems, invalidateActivityQueries } from "@/hooks/use-client-activity";
import { compareCatalogModels } from "@/lib/model-catalog-order";
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

interface StartRunDialogProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
}

export function StartRunDialog({ isOpen, onClose, clientId }: StartRunDialogProps) {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [runName, setRunName] = useState('');
  const [promptSearch, setPromptSearch] = useState('');
  const [promptSourceFilter, setPromptSourceFilter] = useState<'all' | 'ai' | 'manual'>('all');
  const [coreModelsOpen, setCoreModelsOpen] = useState(true);
  const [additionalModelsOpen, setAdditionalModelsOpen] = useState(false);
  // Task #56: warn (don't block) when another prompt run with an
  // *overlapping* (promptId × modelId) selection is already in flight for
  // this project. We fetch each active run's selection lazily so we only
  // warn on a real overlap, not on any concurrent run.
  const [confirmConcurrentOpen, setConfirmConcurrentOpen] = useState(false);
  const activityItems = useClientActivityItems(clientId);
  const activePromptRunIds = useMemo(
    () => activityItems.filter((i) => i.kind === "prompt_run" && i.refId).map((i) => i.refId as string),
    [activityItems],
  );
  const activeRunSelectionsQueries = useQueries({
    queries: activePromptRunIds.map((runId) => ({
      queryKey: ["/api/v1/prompt-runs", runId, "selections"],
      queryFn: async () => {
        const res = await fetch(`/api/v1/prompt-runs/${runId}/selections`, { credentials: "include" });
        if (!res.ok) return { runId, promptIds: [] as string[], modelIds: [] as string[] };
        return res.json() as Promise<{ runId: string; promptIds: string[]; modelIds: string[] }>;
      },
      enabled: !!runId && isOpen,
      staleTime: 10_000,
    })),
  });
  const overlappingRunId = useMemo(() => {
    if (selectedPrompts.length === 0 || selectedModels.length === 0) return null;
    const wantPrompts = new Set(selectedPrompts);
    const wantModels = new Set(selectedModels);
    for (const q of activeRunSelectionsQueries) {
      const data = q.data;
      if (!data) continue;
      const pOverlap = data.promptIds.some((id) => wantPrompts.has(id));
      const mOverlap = data.modelIds.some((id) => wantModels.has(id));
      if (pOverlap && mOverlap) return data.runId;
    }
    return null;
  }, [activeRunSelectionsQueries, selectedPrompts, selectedModels]);
  const promptRunActive = !!overlappingRunId;

  const { data: prompts = [], isLoading: promptsLoading } = useQuery<any[]>({
    queryKey: ['/api/v1/prompts', clientId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/prompts?client_id=${clientId}`, {
        headers: { 'X-Client-Id': clientId }
      });
      if (!response.ok) throw new Error('Failed to fetch prompts');
      return response.json();
    },
    enabled: !!clientId && isOpen
  });

  const { data: allModels = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['/api/v1/ai-models', clientId],
    queryFn: async () => {
      // Typed client generated from /openapi.json — see client/src/lib/api-client.ts.
      const { data, error } = await apiClient.GET('/api/v1/ai-models');
      if (error || !data) throw new Error('Failed to fetch AI models');
      return data;
    },
    enabled: !!clientId && isOpen
  });

  // Project's saved model selection (project settings) — used to pre-tick
  // models when the dialog opens. The user can still change them per run.
  const { data: clientModels = [] } = useQuery<{ id: string }[]>({
    queryKey: ['/api/v1/clients', clientId, 'models'],
    queryFn: async () => {
      const response = await fetch(`/api/v1/clients/${clientId}/models`, { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!clientId && isOpen
  });

  // Pre-select the project's saved models each time the dialog opens,
  // but never after the user has touched the model checkboxes in this
  // dialog session (userTouchedModels), and only with models that are
  // actually rendered in this dialog (latest-version, key available) so
  // prefill, checkboxes and select-all always operate on the same set.
  const prefillDone = useRef(false);
  const userTouchedModels = useRef(false);

  // Filter prompts based on search and source filter
  const filteredPrompts = useMemo(() => {
    let filtered = prompts;

    // Apply source filter
    if (promptSourceFilter !== 'all') {
      filtered = filtered.filter(p => p.source === promptSourceFilter);
    }

    // Apply search filter
    if (promptSearch.trim()) {
      const searchLower = promptSearch.toLowerCase();
      filtered = filtered.filter(p => 
        p.text.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [prompts, promptSearch, promptSourceFilter]);

  // Task #25 — the popup catalog deliberately retains multiple versions per
  // model family (e.g. GPT-5.4 and GPT-5.2 both selectable under Additional),
  // so the old "keep only the latest version per display-name family"
  // heuristic is gone: it silently hid retained fallback models. The server
  // already returns only enabled, non-vendor-paused consumer models. Group
  // them by category, then show vendors in the agreed OpenAI → Anthropic →
  // Google → Perplexity order with current models first inside each vendor.
  const { coreModels, additionalModels, models } = useMemo(() => {
    const sorted = [...allModels].sort(compareCatalogModels);
    const core = sorted.filter(m => m.category === 'core');
    const additional = sorted.filter(m => m.category === 'additional');
    return { coreModels: core, additionalModels: additional, models: sorted };
  }, [allModels]);

  // Prefill from the project's saved selection, once per dialog open.
  useEffect(() => {
    if (!isOpen) { prefillDone.current = false; userTouchedModels.current = false; return; }
    if (prefillDone.current || userTouchedModels.current) return;
    if (clientModels.length === 0 || models.length === 0) return;
    const visible = new Set(models.filter((m: any) => m.isKeyAvailable).map((m: any) => m.id));
    const preselect = clientModels.map(m => m.id).filter(id => visible.has(id));
    if (preselect.length > 0) {
      setSelectedModels(preselect);
    }
    prefillDone.current = true;
  }, [isOpen, clientModels, models]);

  const startRunMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/v1/prompt-runs', {
        clientId,
        promptIds: selectedPrompts,
        modelIds: selectedModels,
        createdBy: 'user',
        name: runName.trim() || undefined
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Run execution is in progress",
        description: `Testing ${selectedPrompts.length} prompts against ${selectedModels.length} models. Carry on to explore the platform, we'll notify you once done.`,
        duration: 5000,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', clientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', clientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/historical-scores', clientId] });
      invalidateActivityQueries(clientId);
      handleClose();
    },
    onError: (err) => {
      errorToast("Failed to start run", err);
    }
  });

  const handlePromptToggle = (promptId: string) => {
    setSelectedPrompts(prev => 
      prev.includes(promptId) 
        ? prev.filter(id => id !== promptId)
        : [...prev, promptId]
    );
  };

  const handleModelToggle = (modelId: string) => {
    userTouchedModels.current = true;
    setSelectedModels(prev => 
      prev.includes(modelId) 
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    );
  };

  const handleSelectAllPrompts = () => {
    // Select all filtered prompts
    if (selectedPrompts.length === filteredPrompts.length) {
      setSelectedPrompts([]);
    } else {
      setSelectedPrompts(filteredPrompts.map(p => p.id));
    }
  };

  const handleSelectAllModels = () => {
    userTouchedModels.current = true;
    const availableCoreModels = coreModels.filter(m => m.isKeyAvailable);
    const availableAdditionalModels = additionalModels.filter(m => m.isKeyAvailable);
    const allAvailableModels = [...availableCoreModels, ...availableAdditionalModels];
    if (selectedModels.length === allAvailableModels.length) {
      setSelectedModels([]);
    } else {
      setSelectedModels(allAvailableModels.map(m => m.id));
    }
  };

  const handleClose = () => {
    setSelectedPrompts([]);
    setSelectedModels([]);
    setRunName('');
    setPromptSearch('');
    setPromptSourceFilter('all');
    setCoreModelsOpen(true);
    setAdditionalModelsOpen(false);
    onClose();
  };

  const totalCombinations = selectedPrompts.length * selectedModels.length;
  const canStart = selectedPrompts.length > 0 && selectedModels.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-[95vw] max-w-[95vw] sm:w-[90vw] sm:max-w-[40rem] md:w-[85vw] md:max-w-[56rem] lg:w-[80vw] lg:max-w-[80vw] xl:w-[75vw] xl:max-w-[75vw] 2xl:max-w-[1400px] max-h-[90vh] flex flex-col" data-testid="dialog-start-run">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-lg sm:text-xl mb-1">Start New Prompt Run</DialogTitle>
              <DialogDescription className="text-sm">
                Select the prompts and AI models to run. Each prompt will be tested against each selected model.
              </DialogDescription>
            </div>
            <div className="w-[200px] shrink-0 mr-8">
              <Input
                id="run-name"
                placeholder="Run name (optional)"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                maxLength={200}
                className="text-sm h-8"
                data-testid="input-run-name"
              />
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-3 flex-1 min-h-0 py-2 overflow-hidden">
          {/* Prompts Selection */}
          <Card className="flex flex-col min-h-0 overflow-hidden">
            <CardHeader className="pb-1 pt-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <CardTitle className="text-sm font-medium">
                  Prompts ({selectedPrompts.length} selected)
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAllPrompts}
                  data-testid="button-select-all-prompts"
                >
                  {selectedPrompts.length === filteredPrompts.length && filteredPrompts.length > 0 ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              
              {/* Search Input */}
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search prompts..."
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  className="pl-9 h-8"
                  data-testid="input-search-prompts"
                />
              </div>

              {/* Source Filter */}
              <div className="flex gap-2 mb-2">
                <Button
                  variant={promptSourceFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPromptSourceFilter('all')}
                  className="flex-1"
                  data-testid="button-filter-all"
                >
                  All
                  <Badge variant="secondary" className="ml-1.5">{prompts.length}</Badge>
                </Button>
                <Button
                  variant={promptSourceFilter === 'ai' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPromptSourceFilter('ai')}
                  className="flex-1"
                  data-testid="button-filter-ai"
                >
                  AI Generated
                  <Badge variant="secondary" className="ml-1.5">
                    {prompts.filter(p => p.source === 'ai').length}
                  </Badge>
                </Button>
                <Button
                  variant={promptSourceFilter === 'manual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPromptSourceFilter('manual')}
                  className="flex-1"
                  data-testid="button-filter-manual"
                >
                  Manual
                  <Badge variant="secondary" className="ml-1.5">
                    {prompts.filter(p => p.source === 'manual').length}
                  </Badge>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-hidden pb-2">
              <ScrollArea className="h-full pr-4">
                {promptsLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : prompts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No prompts available. Create some prompts first.
                  </p>
                ) : filteredPrompts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No prompts match your search or filter criteria.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredPrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className="flex items-start space-x-2 p-2 rounded-md hover:bg-accent"
                        data-testid={`prompt-item-${prompt.id}`}
                      >
                        <Checkbox
                          checked={selectedPrompts.includes(prompt.id)}
                          onCheckedChange={() => handlePromptToggle(prompt.id)}
                          data-testid={`checkbox-prompt-${prompt.id}`}
                        />
                        <p 
                          className="text-sm flex-1 line-clamp-2 cursor-pointer" 
                          onClick={() => handlePromptToggle(prompt.id)}
                        >
                          {prompt.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Models Selection */}
          <Card className="flex flex-col min-h-0 overflow-hidden">
            <CardHeader className="pb-1 pt-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium">
                  Models ({selectedModels.length})
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAllModels}
                  className="h-6 px-1.5 text-[10px]"
                  data-testid="button-select-all-models"
                >
                  {selectedModels.length === [...coreModels, ...additionalModels].filter(m => m.isKeyAvailable).length && selectedModels.length > 0 ? 'Clear' : 'All'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-hidden pt-2 pb-2">
              <ScrollArea className="h-full pr-3">
                {modelsLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : models.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No AI models available.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Core Models - Collapsible, open by default */}
                    {coreModels.length > 0 && (
                      <Collapsible open={coreModelsOpen} onOpenChange={setCoreModelsOpen}>
                        <CollapsibleTrigger className="flex items-center gap-1 w-full py-1 text-left hover:bg-accent/50 rounded-md px-1">
                          {coreModelsOpen ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Core ({coreModels.length})
                          </p>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 mt-1">
                            {coreModels.map((model) => {
                              const isDisabled = !model.isKeyAvailable;
                              return (
                                <TooltipProvider key={model.id}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div
                                        className={`flex items-center space-x-2 p-1.5 rounded-md ${
                                          isDisabled 
                                            ? 'opacity-50 cursor-not-allowed' 
                                            : 'hover:bg-accent cursor-pointer'
                                        }`}
                                        data-testid={`model-item-${model.id}`}
                                      >
                                        <Checkbox
                                          checked={selectedModels.includes(model.id)}
                                          onCheckedChange={() => !isDisabled && handleModelToggle(model.id)}
                                          onClick={(e) => e.stopPropagation()}
                                          disabled={isDisabled}
                                          className="h-4 w-4 pointer-events-auto"
                                          data-testid={`checkbox-model-${model.id}`}
                                        />
                                        <div 
                                          className="flex-1 min-w-0"
                                          onClick={() => !isDisabled && handleModelToggle(model.id)}
                                        >
                                          <div className="flex items-center gap-1.5">
                                            <p className="text-xs font-medium truncate">{model.displayName}</p>
                                            {isDisabled && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                                          </div>
                                          <p className="text-[10px] text-muted-foreground truncate">{model.vendor}</p>
                                        </div>
                                      </div>
                                    </TooltipTrigger>
                                    {isDisabled && (
                                      <TooltipContent>
                                        <p>API key not configured for {model.vendor}</p>
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Additional Models - Collapsible */}
                    {additionalModels.length > 0 && (
                      <Collapsible open={additionalModelsOpen} onOpenChange={setAdditionalModelsOpen}>
                        <CollapsibleTrigger className="flex items-center gap-1 w-full py-1 text-left hover:bg-accent/50 rounded-md px-1">
                          {additionalModelsOpen ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Additional ({additionalModels.length})
                          </p>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 mt-1">
                            {additionalModels.map((model) => {
                              const isDisabled = !model.isKeyAvailable;
                              return (
                                <TooltipProvider key={model.id}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div
                                        className={`flex items-center space-x-2 p-1.5 rounded-md ${
                                          isDisabled 
                                            ? 'opacity-50 cursor-not-allowed' 
                                            : 'hover:bg-accent cursor-pointer'
                                        }`}
                                        data-testid={`model-item-${model.id}`}
                                      >
                                        <Checkbox
                                          checked={selectedModels.includes(model.id)}
                                          onCheckedChange={() => !isDisabled && handleModelToggle(model.id)}
                                          onClick={(e) => e.stopPropagation()}
                                          disabled={isDisabled}
                                          className="h-4 w-4 pointer-events-auto"
                                          data-testid={`checkbox-model-${model.id}`}
                                        />
                                        <div 
                                          className="flex-1 min-w-0"
                                          onClick={() => !isDisabled && handleModelToggle(model.id)}
                                        >
                                          <div className="flex items-center gap-1.5">
                                            <p className="text-xs font-medium truncate">{model.displayName}</p>
                                            {isDisabled && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                                          </div>
                                          <p className="text-[10px] text-muted-foreground truncate">{model.vendor}</p>
                                        </div>
                                      </div>
                                    </TooltipTrigger>
                                    {isDisabled && (
                                      <TooltipContent>
                                        <p>API key not configured for {model.vendor}</p>
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="flex items-center justify-between mt-4 shrink-0">
          <div className="text-sm text-muted-foreground">
            {canStart && (
              <span>
                {selectedPrompts.length} prompt{selectedPrompts.length === 1 ? '' : 's'} × {selectedModels.length} model{selectedModels.length === 1 ? '' : 's'} = {totalCombinations} combination{totalCombinations === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={startRunMutation.isPending}
              data-testid="button-cancel-run"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (promptRunActive) {
                  setConfirmConcurrentOpen(true);
                } else {
                  startRunMutation.mutate();
                }
              }}
              disabled={!canStart || startRunMutation.isPending}
              data-testid="button-start-run"
            >
              {startRunMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Run
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmConcurrentOpen} onOpenChange={setConfirmConcurrentOpen}>
        <AlertDialogContent data-testid="dialog-confirm-concurrent-run">
          <AlertDialogHeader>
            <AlertDialogTitle>Overlapping run already in progress</AlertDialogTitle>
            <AlertDialogDescription>
              Another prompt run for this project is already executing some of the
              same prompts and models you've selected — possibly started by another
              user. Starting now will run in parallel and consume additional API
              credits. Continue anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-concurrent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-concurrent"
              onClick={() => {
                setConfirmConcurrentOpen(false);
                startRunMutation.mutate();
              }}
            >
              Start anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
