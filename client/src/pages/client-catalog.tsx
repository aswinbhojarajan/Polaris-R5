import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Building, Trash2, Calendar, Copy, Loader2, CheckCircle, FileText, Tag, Filter, ArrowUpDown, X, Share2 } from "lucide-react";
import { ProjectSharingDialog } from "@/components/project-sharing-dialog";
import { Progress } from "@/components/ui/progress";
import type { Client } from "@shared/schema";
import { setSelectedClientId, getSelectedClientIdSnapshot } from "@/hooks/use-selected-client-id";
import { useClientsActivitySummary, describeStarter, invalidateActivityQueries } from "@/hooks/use-client-activity";
import { useAuth } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import { ActivityChip } from "@/components/activity/activity-chip";
import { useLocation } from "wouter";
import CreateClientWizard from "@/components/create-client-wizard";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { format } from "date-fns";
import { clientMatchesQuery } from "@/lib/client-search";

// Task #144 — the catalog listing includes the caller's per-project
// "last opened" timestamp (null when never opened).
type CatalogClient = Client & { lastOpenedAt?: string | null };

export default function ClientCatalog() {
  const [, setLocation] = useLocation();

  // Open the create wizard when the URL carries `?create=1` (used by
  // the top-nav switcher's "Create project" action).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") === "1") {
      setShowWizard(true);
      params.delete("create");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        `/app/clients${qs ? `?${qs}` : ""}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [clientToCopy, setClientToCopy] = useState<Client | null>(null);
  const [clientToShare, setClientToShare] = useState<Client | null>(null);
  const [copyJobId, setCopyJobId] = useState<string | null>(null);
  const [copyProgress, setCopyProgress] = useState(0);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [copyResult, setCopyResult] = useState<{ clientId: string; copied: { competitors: number; topics: number; prompts: number } } | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const { user: me } = useAuth();

  // Filter state
  const [filterField, setFilterField] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<{ field: string; value: string; dateFrom?: string; dateTo?: string } | null>(null);

  // Sort state — Task #144: default to the caller's most-recently-opened
  // projects; never-opened projects fall back to created-date ordering.
  const [sortField, setSortField] = useState<string>("lastOpenedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [sortPopoverOpen, setSortPopoverOpen] = useState(false);

  // Task #56: cross-user activity summary across all visible projects.
  // Polls every 5s while the tab is visible; the chip renders nothing
  // for idle projects so existing layouts are unaffected.
  const { data: activityData } = useClientsActivitySummary("default-org");
  const activityByClient = useMemo(() => {
    const map = new Map<string, NonNullable<typeof activityData>["summaries"][number]>();
    (activityData?.summaries ?? []).forEach((s) => map.set(s.clientId, s));
    return map;
  }, [activityData]);

  const { data: clients = [], isLoading, refetch } = useQuery<CatalogClient[]>({
    queryKey: ['/api/v1/clients'],
    queryFn: async () => {
      const response = await fetch('/api/v1/clients?org_id=default-org');
      if (!response.ok) throw new Error('Failed to fetch clients');
      return response.json();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const response = await fetch(`/api/v1/clients/${clientId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete client');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/clients'] });
      if (getSelectedClientIdSnapshot() === clientToDelete?.id) {
        setSelectedClientId(null);
      }
      toast({
        title: "Client deleted",
        description: `${clientToDelete?.name || 'Client'} and all related data have been permanently deleted.`,
      });
      setClientToDelete(null);
    },
    onError: (err) => {
      errorToast("Failed to delete client", err);
    },
  });

  const copyMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const response = await fetch(`/api/v1/clients/${clientId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error('Failed to copy client');
      return response.json();
    },
    onSuccess: (data) => {
      // Start polling for job progress
      setCopyJobId(data.jobId);
      setCopyStatus('running');
      setCopyProgress(0);
      invalidateActivityQueries();
    },
    onError: (err) => {
      errorToast("Failed to start project duplication", err);
      resetCopyState();
    },
  });

  // Poll for copy job progress
  useEffect(() => {
    if (!copyJobId || copyStatus !== 'running') return;

    const pollProgress = async () => {
      try {
        const response = await fetch(`/api/v1/jobs/${copyJobId}`);
        if (!response.ok) return;
        
        const job = await response.json();
        setCopyProgress(job.progress || 0);
        
        if (job.status === 'done') {
          setCopyStatus('done');
          setCopyProgress(100);
          const result = job.payload?.result;
          if (result) {
            setCopyResult(result);
          }
          queryClient.invalidateQueries({ queryKey: ['/api/v1/clients'] });
          
          // Auto-close after 2 seconds
          setTimeout(() => {
            toast({
              title: "Project duplicated",
              description: `Successfully copied ${result?.copied?.competitors || 0} competitors, ${result?.copied?.topics || 0} topics, and ${result?.copied?.prompts || 0} prompts.`,
            });
            resetCopyState();
          }, 1500);
        } else if (job.status === 'failed') {
          setCopyStatus('failed');
          errorToast(
            "Error",
            new Error(job.error || "Failed to duplicate project."),
          );
          setTimeout(() => resetCopyState(), 2000);
        }
      } catch (error) {
        console.error('Failed to poll job status:', error);
      }
    };

    // Poll every 500ms
    pollingRef.current = setInterval(pollProgress, 500);
    pollProgress(); // Initial poll

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [copyJobId, copyStatus]);

  const resetCopyState = () => {
    setClientToCopy(null);
    setCopyJobId(null);
    setCopyProgress(0);
    setCopyStatus('idle');
    setCopyResult(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
  };

  const getProgressLabel = (progress: number) => {
    if (progress < 10) return "Starting...";
    if (progress < 30) return "Copying client configuration...";
    if (progress < 50) return "Copying competitors...";
    if (progress < 70) return "Copying topics...";
    if (progress < 90) return "Copying prompts...";
    if (progress < 100) return "Copying site analysis...";
    return "Complete!";
  };

  // Get unique values for filter dropdowns
  const uniqueIndustries = useMemo(() => {
    const industries = clients.map(c => c.industry).filter(Boolean) as string[];
    return Array.from(new Set(industries)).sort();
  }, [clients]);

  const uniqueGeographies = useMemo(() => {
    const geographies = clients.map(c => c.geography).filter(Boolean) as string[];
    return Array.from(new Set(geographies)).sort();
  }, [clients]);

  // Apply filter
  const applyFilter = () => {
    if (filterField === "createdAt" && (filterDateFrom || filterDateTo)) {
      setActiveFilter({ field: filterField, value: "", dateFrom: filterDateFrom, dateTo: filterDateTo });
    } else if (filterField && filterValue) {
      setActiveFilter({ field: filterField, value: filterValue });
    }
    setFilterPopoverOpen(false);
  };

  // Clear filter
  const clearFilter = () => {
    setFilterField("");
    setFilterValue("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setActiveFilter(null);
  };

  // Get filter display text
  const getFilterDisplayText = () => {
    if (!activeFilter) return null;
    if (activeFilter.field === "createdAt") {
      const from = activeFilter.dateFrom ? format(new Date(activeFilter.dateFrom), "MMM d") : "";
      const to = activeFilter.dateTo ? format(new Date(activeFilter.dateTo), "MMM d") : "";
      if (from && to) return `Date: ${from} - ${to}`;
      if (from) return `Date: from ${from}`;
      if (to) return `Date: to ${to}`;
    }
    const fieldLabel = activeFilter.field === "industry" ? "Industry" : "Geography";
    return `${fieldLabel}: ${activeFilter.value}`;
  };

  // Get sort display text
  const getSortDisplayText = () => {
    const fieldLabels: Record<string, string> = {
      projectName: "Project",
      name: "Client",
      industry: "Industry",
      createdAt: "Date",
      lastOpenedAt: "Last Opened"
    };
    const directionLabel = sortDirection === "asc" ? "↑" : "↓";
    return `${fieldLabels[sortField] || sortField} ${directionLabel}`;
  };

  const filteredClients = useMemo(() => {
    let result = clients.filter((c) => clientMatchesQuery(c, searchQuery));

    // Apply active filter
    if (activeFilter) {
      if (activeFilter.field === "industry" && activeFilter.value) {
        result = result.filter(c => c.industry === activeFilter.value);
      } else if (activeFilter.field === "geography" && activeFilter.value) {
        result = result.filter(c => c.geography === activeFilter.value);
      } else if (activeFilter.field === "createdAt") {
        if (activeFilter.dateFrom) {
          const fromDate = new Date(activeFilter.dateFrom);
          result = result.filter(c => new Date(c.createdAt) >= fromDate);
        }
        if (activeFilter.dateTo) {
          const toDate = new Date(activeFilter.dateTo);
          toDate.setHours(23, 59, 59, 999);
          result = result.filter(c => new Date(c.createdAt) <= toDate);
        }
      }
    }

    // Apply sort
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === "lastOpenedAt") {
        // Never-opened projects fall back to their created date so new
        // projects still surface sensibly among the opened ones.
        const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : new Date(a.createdAt).getTime();
        const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : new Date(b.createdAt).getTime();
        comparison = aTime - bTime;
      } else if (sortField === "createdAt") {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === "projectName") {
        comparison = (a.projectName || "").localeCompare(b.projectName || "");
      } else if (sortField === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === "industry") {
        comparison = (a.industry || "").localeCompare(b.industry || "");
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [clients, searchQuery, activeFilter, sortField, sortDirection]);

  const handleSelectClient = (client: CatalogClient) => {
    setSelectedClientId(client.id);
    // Task #144 — record the open (fire-and-forget; sort freshness is
    // best-effort and must never block navigation).
    apiRequest('POST', `/api/v1/clients/${client.id}/open`).catch(() => {});
    // Fully set-up projects land on the Dashboard; projects still in
    // draft/in-progress setup keep landing on the configuration flow.
    // URL is authoritative: include clientId so the destination page always
    // loads the clicked project, even if the shared localStorage selection is
    // stale or overwritten by another tab.
    const path = client.onboardingStatus === 'completed' ? '/app/dashboard' : '/app/client-config';
    setLocation(`${path}?clientId=${encodeURIComponent(client.id)}`);
  };

  const handleWizardComplete = () => {
    setShowWizard(false);
    refetch();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="page-content border-b border-border bg-card">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex-1">
              <h1 className="responsive-title">Project Catalog</h1>
              <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                Manage your clients and track brand visibility across AI platforms
              </p>
            </div>
            <Button onClick={() => setShowWizard(true)} data-testid="button-create-client" className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Create New Client</span>
              <span className="sm:hidden">New Client</span>
            </Button>
          </div>

          {/* Search, Filter, and Sort Bar */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects, clients, industry..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-clients"
              />
            </div>

            {/* Filter Popover */}
            <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1" data-testid="button-filter">
                  <Filter className="h-4 w-4" />
                  Filter
                  {activeFilter && <span className="ml-1 h-2 w-2 rounded-full bg-primary" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-4" align="start">
                <div className="space-y-4">
                  <div className="font-medium text-sm">Filter Clients</div>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Field</label>
                    <Select value={filterField} onValueChange={(v) => { setFilterField(v); setFilterValue(""); }}>
                      <SelectTrigger data-testid="select-filter-field">
                        <SelectValue placeholder="Select field..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="industry">Industry</SelectItem>
                        <SelectItem value="geography">Geography</SelectItem>
                        <SelectItem value="createdAt">Created Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {filterField === "industry" && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Value</label>
                      <Select value={filterValue} onValueChange={setFilterValue}>
                        <SelectTrigger data-testid="select-filter-value">
                          <SelectValue placeholder="Select industry..." />
                        </SelectTrigger>
                        <SelectContent>
                          {uniqueIndustries.map(ind => (
                            <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {filterField === "geography" && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Value</label>
                      <Select value={filterValue} onValueChange={setFilterValue}>
                        <SelectTrigger data-testid="select-filter-geo-value">
                          <SelectValue placeholder="Select geography..." />
                        </SelectTrigger>
                        <SelectContent>
                          {uniqueGeographies.map(geo => (
                            <SelectItem key={geo} value={geo}>{geo}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {filterField === "createdAt" && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Date Range</label>
                      <div className="flex gap-2">
                        <Input
                          type="date"
                          value={filterDateFrom}
                          onChange={(e) => setFilterDateFrom(e.target.value)}
                          className="flex-1 text-xs"
                          placeholder="From"
                          data-testid="input-filter-date-from"
                        />
                        <Input
                          type="date"
                          value={filterDateTo}
                          onChange={(e) => setFilterDateTo(e.target.value)}
                          className="flex-1 text-xs"
                          placeholder="To"
                          data-testid="input-filter-date-to"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between pt-2">
                    <Button variant="ghost" size="sm" onClick={clearFilter} data-testid="button-clear-filter">
                      Clear
                    </Button>
                    <Button size="sm" onClick={applyFilter} disabled={!filterField || (filterField !== "createdAt" && !filterValue) || (filterField === "createdAt" && !filterDateFrom && !filterDateTo)} data-testid="button-apply-filter">
                      Apply
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Sort Popover */}
            <Popover open={sortPopoverOpen} onOpenChange={setSortPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1" data-testid="button-sort">
                  <ArrowUpDown className="h-4 w-4" />
                  Sort
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-4" align="start">
                <div className="space-y-4">
                  <div className="font-medium text-sm">Sort By</div>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Field</label>
                    <Select value={sortField} onValueChange={setSortField}>
                      <SelectTrigger data-testid="select-sort-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lastOpenedAt">Last Opened</SelectItem>
                        <SelectItem value="projectName">Project Name</SelectItem>
                        <SelectItem value="name">Client Name</SelectItem>
                        <SelectItem value="industry">Industry</SelectItem>
                        <SelectItem value="createdAt">Created Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Direction</label>
                    <Select value={sortDirection} onValueChange={(v) => setSortDirection(v as "asc" | "desc")}>
                      <SelectTrigger data-testid="select-sort-direction">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sortField === "createdAt" || sortField === "lastOpenedAt" ? (
                          <>
                            <SelectItem value="desc">Newest First</SelectItem>
                            <SelectItem value="asc">Oldest First</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="asc">A to Z</SelectItem>
                            <SelectItem value="desc">Z to A</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button size="sm" variant="outline" className="w-full" onClick={() => setSortPopoverOpen(false)} data-testid="button-close-sort">
                    Done
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Active Filter/Sort Chips */}
          {(activeFilter || sortField !== "lastOpenedAt" || sortDirection !== "desc") && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {activeFilter && (
                <Badge variant="secondary" className="text-xs px-2 py-1 gap-1" data-testid="chip-active-filter">
                  {getFilterDisplayText()}
                  <button onClick={clearFilter} className="ml-1 hover:text-destructive" data-testid="button-clear-filter-chip">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {(sortField !== "lastOpenedAt" || sortDirection !== "desc") && (
                <Badge variant="outline" className="text-xs px-2 py-1 gap-1" data-testid="chip-active-sort">
                  Sort: {getSortDisplayText()}
                  <button onClick={() => { setSortField("lastOpenedAt"); setSortDirection("desc"); }} className="ml-1 hover:text-destructive" data-testid="button-clear-sort-chip">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Client Cards */}
      <div className="page-content overflow-x-hidden">
        <div className="max-w-7xl mx-auto w-full">
          {isLoading ? (
            <div className="responsive-grid">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="loading-skeleton h-32 rounded-lg"></div>
              ))}
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-12">
              <Building className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {searchQuery ? 'No clients found' : 'No clients yet'}
              </h3>
              <p className="text-muted-foreground mb-6">
                {searchQuery
                  ? 'Try adjusting your search terms'
                  : 'Get started by creating your first client'}
              </p>
              {!searchQuery && (
                <Button onClick={() => setShowWizard(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Client
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="responsive-grid mb-8">
                {filteredClients.map((client) => {
                  const activity = activityByClient.get(client.id);
                  const copyInFlight = activity?.kinds.includes("project_copy") ?? false;
                  const copyItem = activity?.items.find((it) => it.kind === "project_copy");
                  const copyTooltip = copyItem
                    ? `${describeStarter(copyItem, me?.id ?? null)} started a duplicate ${formatDistanceToNow(new Date(copyItem.startedAt), { addSuffix: true })}.`
                    : "Duplicate project";
                  return (
                  <Card 
                    key={client.id} 
                    className="hover:shadow-lg hover:bg-[#EDE8FF] transition-all cursor-pointer group min-w-0 h-full"
                    onClick={() => handleSelectClient(client)}
                    data-testid={`client-card-${client.id}`}
                  >
                    <CardContent className="p-3 min-w-0 h-full flex flex-col">
                      <div className="flex-1 min-h-[80px]">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="text-base font-semibold text-foreground line-clamp-2 flex-1">
                            {client.projectName}
                          </h3>
                          <ActivityChip summary={activity} />
                        </div>

                        <p className="text-sm text-muted-foreground mb-1.5 truncate flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          <span>Client: {client.name}</span>
                        </p>

                        {client.industry && (
                          <div className="flex items-center text-xs text-muted-foreground mb-1">
                            <Tag className="h-3 w-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{client.industry}</span>
                          </div>
                        )}

                        {client.geography && (
                          <div className="mb-1.5">
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                              {client.geography}
                            </Badge>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border mt-auto">
                        <div className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span className="truncate">
                            Created {format(new Date(client.createdAt), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClientToShare(client);
                            }}
                            data-testid={`button-share-${client.id}`}
                            title="Share project"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClientToCopy(client);
                            }}
                            disabled={copyMutation.isPending || copyInFlight}
                            data-testid={`button-copy-${client.id}`}
                            title={copyTooltip}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClientToDelete(client);
                            }}
                            data-testid={`button-delete-${client.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Per-project sharing dialog (owner / org-admin only — server enforces) */}
      {clientToShare && (
        <ProjectSharingDialog
          clientId={clientToShare.id}
          projectName={clientToShare.projectName}
          open={!!clientToShare}
          onOpenChange={(open) => !open && setClientToShare(null)}
        />
      )}

      {/* Create Client Wizard Modal */}
      {showWizard && (
        <CreateClientWizard 
          open={showWizard} 
          onClose={() => setShowWizard(false)}
          onComplete={handleWizardComplete}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!clientToDelete} onOpenChange={() => setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{clientToDelete?.name}</strong>? 
              This will permanently delete all data including topics, prompts, analysis runs, and results. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clientToDelete && deleteMutation.mutate(clientToDelete.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete Client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Copy Confirmation Dialog */}
      <Dialog open={!!clientToCopy} onOpenChange={(open) => copyStatus === 'idle' && !open && setClientToCopy(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {copyStatus === 'done' ? "Duplication Complete!" : 
               copyStatus === 'running' ? "Duplicating Project..." : 
               copyStatus === 'failed' ? "Duplication Failed" :
               "Duplicate Project"}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {copyStatus === 'done' ? (
                  <div className="flex flex-col items-center py-6 gap-3">
                    <CheckCircle className="h-12 w-12 text-green-500" />
                    <p className="text-center font-medium">Successfully duplicated!</p>
                    {copyResult && (
                      <p className="text-sm text-muted-foreground text-center">
                        Copied {copyResult.copied.competitors} competitors, {copyResult.copied.topics} topics, and {copyResult.copied.prompts} prompts
                      </p>
                    )}
                  </div>
                ) : copyStatus === 'running' || copyMutation.isPending ? (
                  <div className="flex flex-col py-6 gap-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
                      <p className="text-sm">{getProgressLabel(copyProgress)}</p>
                    </div>
                    <div className="space-y-2">
                      <Progress value={copyProgress} className="h-3" />
                      <p className="text-center text-sm font-medium">{copyProgress}%</p>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      Copying <strong>{clientToCopy?.projectName}</strong>
                    </p>
                  </div>
                ) : copyStatus === 'failed' ? (
                  <div className="flex flex-col items-center py-6 gap-3">
                    <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                      <span className="text-destructive text-xl">!</span>
                    </div>
                    <p className="text-center text-muted-foreground">
                      There was an error duplicating the project. Please try again.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="mb-4">Create a duplicate of <strong>{clientToCopy?.projectName}</strong>?</p>
                    <p>This will copy all configuration, competitors, topics, prompts, and site analysis data 
                    to a new independent project. Previous analysis runs and results will not be copied.</p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          {copyStatus === 'idle' && !copyMutation.isPending && (
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setClientToCopy(null)}
                data-testid="button-cancel-copy"
              >
                Cancel
              </Button>
              <Button
                onClick={() => clientToCopy && copyMutation.mutate(clientToCopy.id)}
                data-testid="button-confirm-copy"
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
