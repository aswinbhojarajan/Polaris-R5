import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Edit, Play, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { RetryCard } from "@/components/feedback/RetryCard";
import { ApiErrorMessage } from "@/components/feedback/ErrorState";
import type { Prompt, PromptCategory, PromptIntentTier } from "@shared/schema";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";
import { useActiveItemOfKind, describeStarter, invalidateActivityQueries } from "@/hooks/use-client-activity";
import { useAuth } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";

// Task #89 — visual styling for intent-tier badges in the Prompt
// Library table. The tier classifies who the prompt is asked by /
// how branded it is (orthogonal to the topical category).
const TIER_LABEL: Record<PromptIntentTier, string> = {
  branded: "Branded",
  semi_branded: "Semi-Branded",
  unbranded: "Unbranded",
};
const TIER_CLASS: Record<PromptIntentTier, string> = {
  branded: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  semi_branded: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  unbranded: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};
const TIER_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All tiers" },
  { value: "branded", label: "Branded" },
  { value: "semi_branded", label: "Semi-Branded" },
  { value: "unbranded", label: "Unbranded" },
  { value: "none", label: "Unspecified" },
];

export default function MetadataPrompts() {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [newPromptText, setNewPromptText] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");

  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  // Task #56: soft-disable Refresh Prompts when another user (or this
  // user from another tab) already has it running for the same project.
  const activeRefreshItem = useActiveItemOfKind(selectedClientId, "refresh_prompts");
  const refreshActive = !!activeRefreshItem;
  const { user: refreshUser } = useAuth();
  const refreshTooltip = activeRefreshItem
    ? `${describeStarter(activeRefreshItem, refreshUser?.id ?? null)} started a prompt refresh ${formatDistanceToNow(new Date(activeRefreshItem.startedAt), { addSuffix: true })}.`
    : undefined;

  const { data: prompts = [], isLoading, isError, error, refetch } = useQuery<Prompt[]>({
    queryKey: ['/api/v1/prompts', selectedClientId],
    enabled: !!selectedClientId,
  });

  const {
    data: categories = [],
    isError: categoriesError,
    error: categoriesErrorObj,
    refetch: refetchCategories,
  } = useQuery<PromptCategory[]>({
    queryKey: ['/api/v1/prompt-categories'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { text: string; categoryId: string | null }) => {
      return apiRequest('POST', '/api/v1/prompts', {
        clientId: selectedClientId,
        text: data.text,
        categoryId: data.categoryId,
        source: 'manual',
        accepted: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompts', selectedClientId] });
      toast({ title: "Prompt added successfully" });
      setIsAddDialogOpen(false);
      setNewPromptText("");
      setSelectedCategoryId(null);
    },
    onError: (err) => {
      errorToast("Failed to add prompt", err);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; text: string; categoryId: string | null }) => {
      return apiRequest('PUT', `/api/v1/prompts/${data.id}`, {
        text: data.text,
        categoryId: data.categoryId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompts', selectedClientId] });
      toast({ title: "Prompt updated successfully" });
      setEditingPrompt(null);
      setNewPromptText("");
      setSelectedCategoryId(null);
    },
    onError: (err) => {
      errorToast("Failed to update prompt", err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/v1/prompts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompts', selectedClientId] });
      toast({ title: "Prompt deleted successfully" });
    },
    onError: (err) => {
      errorToast("Failed to delete prompt", err);
    },
  });

  const refreshPromptsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/v1/clients/${selectedClientId}/refresh-prompts`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompts', selectedClientId] });
      invalidateActivityQueries(selectedClientId);
      toast({ 
        title: "Prompts refreshed successfully", 
        description: "New prompts have been generated from your topics and keywords" 
      });
    },
    onError: (err) => {
      errorToast("Failed to refresh prompts", err);
    },
  });

  const handleAdd = () => {
    if (!newPromptText.trim()) {
      toast({ title: "Please enter a prompt", variant: "destructive" });
      return;
    }
    createMutation.mutate({ text: newPromptText, categoryId: selectedCategoryId });
  };

  const handleUpdate = () => {
    if (!editingPrompt || !newPromptText.trim()) {
      toast({ title: "Please enter a prompt", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id: editingPrompt.id, text: newPromptText, categoryId: selectedCategoryId });
  };

  const openEditDialog = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setNewPromptText(prompt.text);
    setSelectedCategoryId(prompt.categoryId || null);
  };

  const getCategoryName = (categoryId: string | null) => {
    if (!categoryId) return 'Others';
    const category = categories.find(c => c.id === categoryId);
    return category?.name || 'Others';
  };

  // Task #89 — deterministic order: tier (branded → semi → unbranded
  // → unspecified) then createdAt ascending. Keeps the table stable
  // across HMR and avoids relying on backend return order.
  const TIER_SORT_ORDER: Record<string, number> = {
    branded: 0,
    semi_branded: 1,
    unbranded: 2,
  };
  const filteredPrompts = prompts
    .filter(prompt => {
      if (!prompt.text.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (tierFilter === "all") return true;
      if (tierFilter === "none") return prompt.intentTier == null;
      return prompt.intentTier === tierFilter;
    })
    .slice()
    .sort((a, b) => {
      const ta = a.intentTier ? TIER_SORT_ORDER[a.intentTier] : 3;
      const tb = b.intentTier ? TIER_SORT_ORDER[b.intentTier] : 3;
      if (ta !== tb) return ta - tb;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ca - cb;
    });

  if (isError) {
    return (
      <div className="p-8">
        <RetryCard error={error} onRetry={() => refetch()} title="Couldn't load prompts" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading prompts...</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <ActiveOperationsBanner clientId={selectedClientId} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Prompt Library</h1>
          <p className="text-muted-foreground mt-1">
            Manage prompts for AI model testing around topics and keywords
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => refreshPromptsMutation.mutate()} 
            disabled={refreshPromptsMutation.isPending || refreshActive}
            data-testid="button-refresh-prompts" 
            variant="outline"
            title={refreshTooltip}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${(refreshPromptsMutation.isPending || refreshActive) ? 'animate-spin' : ''}`} />
            {refreshPromptsMutation.isPending || refreshActive ? 'Refreshing...' : 'Refresh Prompts'}
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-prompt" variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Prompt
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search prompts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
          data-testid="input-search-prompts"
        />
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-intent-tier-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIER_FILTERS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TooltipProvider delayDuration={200}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Prompt Text</TableHead>
            <TableHead className="w-[140px]">Intent</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredPrompts.map((prompt, index) => (
            <TableRow key={prompt.id}>
              <TableCell className="text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="font-medium max-w-lg" data-testid={`text-prompt-${prompt.id}`}>
                <div className="line-clamp-2">{prompt.text}</div>
                {prompt.diagnosticFocus && (
                  <div
                    className="text-xs text-muted-foreground mt-1 line-clamp-1"
                    data-testid={`text-diagnostic-focus-${prompt.id}`}
                  >
                    Tests: {prompt.diagnosticFocus}
                  </div>
                )}
              </TableCell>
              <TableCell data-testid={`text-intent-tier-${prompt.id}`}>
                {prompt.intentTier ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block">
                        <Badge variant="outline" className={`${TIER_CLASS[prompt.intentTier]} border-0`}>
                          {TIER_LABEL[prompt.intentTier]}
                        </Badge>
                      </span>
                    </TooltipTrigger>
                    {prompt.diagnosticFocus && (
                      <TooltipContent>
                        <span className="text-xs">Tests: {prompt.diagnosticFocus}</span>
                      </TooltipContent>
                    )}
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground" data-testid={`text-category-${prompt.id}`}>
                {getCategoryName(prompt.categoryId)}
              </TableCell>
              <TableCell className="text-muted-foreground capitalize">
                {prompt.source}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(prompt)}
                    data-testid={`button-edit-${prompt.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(prompt.id)}
                    data-testid={`button-delete-${prompt.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </TooltipProvider>

      {filteredPrompts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No prompts found. Add your first prompt to get started.
        </div>
      )}

      <Dialog open={isAddDialogOpen || !!editingPrompt} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          setEditingPrompt(null);
          setNewPromptText("");
          setSelectedCategoryId(null);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPrompt ? "Edit Prompt" : "Add New Prompt"}</DialogTitle>
            <DialogDescription>
              {editingPrompt ? "Update the prompt text below" : "Add a new prompt for AI model testing"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prompt-text">Prompt Text</Label>
              <Textarea
                id="prompt-text"
                placeholder="Enter prompt text..."
                value={newPromptText}
                onChange={(e) => setNewPromptText(e.target.value)}
                rows={6}
                data-testid="input-prompt-text"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category (Optional)</Label>
              {categoriesError && (
                <div
                  className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
                  data-testid="error-categories"
                >
                  <p className="text-xs text-destructive">
                    Couldn't load categories — <ApiErrorMessage error={categoriesErrorObj} />
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchCategories()}
                    data-testid="button-retry-categories"
                  >
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                    Retry
                  </Button>
                </div>
              )}
              <Select 
                value={selectedCategoryId || "uncategorized"} 
                onValueChange={(value) => setSelectedCategoryId(value === "uncategorized" ? null : value)}
              >
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uncategorized">Others (Uncategorized)</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Leave uncategorized to auto-classify using AI later
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={editingPrompt ? handleUpdate : handleAdd}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-prompt"
            >
              {editingPrompt ? "Update" : "Add"} Prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
