import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CategoryDashboardTiles from "@/components/category-dashboard-tiles";
import { useSelectedClientId } from "@/hooks/use-selected-client-id";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  Bot,
  FileText,
  Eye,
  Sparkles,
  Link2,
  MessageSquare,
  FileSearch,
  BrainCircuit,
} from "lucide-react";

interface SummaryRecommendation {
  id: string;
  title: string;
  category: string;
  highLevelCategory: string;
  subCategory: string;
  severity: "high" | "medium" | "low";
  source: "crawl" | "prompt_response" | "citation" | "ai_analysis" | "manual";
  duplicateCount: number;
  examplesCount: number;
  promptRunId: string | null;
  createdAt: string;
}

interface RecommendationDetail {
  id: string;
  title: string;
  category: string;
  severity: "high" | "medium" | "low";
  description: string;
  source: "crawl" | "prompt_response" | "citation" | "ai_analysis" | "manual";
  examples?: Array<{
    citation: string;
    content: string;
    issue: string;
  }>;
  actionItems: string[];
  createdAt: string;
}

interface SummaryResponse {
  items: SummaryRecommendation[];
  total: number;
  page: number;
  pageSize: number;
}

interface RecommendationsSummaryProps {
  promptRunId?: string | null;
}

export default function RecommendationsSummary({ promptRunId }: RecommendationsSummaryProps = {}) {
  const selectedClientId = useSelectedClientId();
  const [location, setLocation] = useLocation();
  const tableRef = useRef<HTMLDivElement>(null);

  // Initialize state from URL params
  const getInitialState = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      page: parseInt(params.get("page") || "1"),
      search: params.get("search") || "",
      category: params.get("category") || "all",
      highLevelCategory: params.get("highLevelCategory") || "all",
      severity: params.get("severity") || "all",
      source: params.get("source") || "all",
      sortBy: params.get("sortBy") || "severity",
      sortDir: (params.get("sortDir") || "desc") as "asc" | "desc",
    };
  };

  const initialState = getInitialState();
  const [page, setPage] = useState(initialState.page);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState(initialState.search);
  const [categoryFilter, setCategoryFilter] = useState<string>(initialState.category);
  const [highLevelCategoryFilter, setHighLevelCategoryFilter] = useState<string>(initialState.highLevelCategory);
  const [severityFilter, setSeverityFilter] = useState<string>(initialState.severity);
  const [sourceFilter, setSourceFilter] = useState<string>(initialState.source);
  const [sortBy, setSortBy] = useState<string>(initialState.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialState.sortDir);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Handler for tile click - scrolls to table and filters
  const handleTileClick = (category: string) => {
    setHighLevelCategoryFilter(category);
    setPage(1); // Reset to first page
    
    // Smooth scroll to table
    setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Sync state to URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (page !== 1) params.set("page", page.toString());
    if (search) params.set("search", search);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (highLevelCategoryFilter !== "all") params.set("highLevelCategory", highLevelCategoryFilter);
    if (severityFilter !== "all") params.set("severity", severityFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (sortBy !== "severity") params.set("sortBy", sortBy);
    if (sortDir !== "desc") params.set("sortDir", sortDir);

    const newSearch = params.toString();
    const currentPath = window.location.pathname;
    const newUrl = newSearch ? `${currentPath}?${newSearch}` : currentPath;
    
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState({}, "", newUrl);
    }
  }, [page, search, categoryFilter, highLevelCategoryFilter, severityFilter, sourceFilter, sortBy, sortDir]);

  // Fetch summary data
  const { data: summaryData, isLoading } = useQuery<SummaryResponse>({
    queryKey: [
      "/api/v1/opportunities/recommendations/summary",
      selectedClientId,
      page,
      pageSize,
      search,
      categoryFilter,
      highLevelCategoryFilter,
      severityFilter,
      sourceFilter,
      sortBy,
      sortDir,
      promptRunId,
    ],
    enabled: !!selectedClientId,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        sortBy,
        sortDir,
        ...(search && { search }),
        ...(categoryFilter !== "all" && { category: categoryFilter }),
        ...(highLevelCategoryFilter !== "all" && { highLevelCategory: highLevelCategoryFilter }),
        ...(severityFilter !== "all" && { severity: severityFilter }),
        ...(sourceFilter !== "all" && { source: sourceFilter }),
        ...(promptRunId && { promptRunId }),
      });

      const response = await fetch(
        `/api/v1/opportunities/recommendations/summary?${params}`,
        {
          headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
        }
      );
      if (!response.ok) throw new Error("Failed to fetch summary");
      return response.json();
    },
  });

  // Fetch detail for selected recommendation
  const { data: detailData } = useQuery<{ recommendations: RecommendationDetail[] }>({
    queryKey: ["/api/v1/opportunities/recommendations", selectedClientId, selectedId],
    enabled: !!selectedClientId && !!selectedId,
    queryFn: async () => {
      const response = await fetch(
        `/api/v1/opportunities/recommendations?id=${selectedId}`,
        {
          headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
        }
      );
      if (!response.ok) throw new Error("Failed to fetch detail");
      return response.json();
    },
  });

  const selectedDetail = detailData?.recommendations?.[0];

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="h-4 w-4" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-4 w-4" />
    ) : (
      <ArrowDown className="h-4 w-4" />
    );
  };

  const getSeverityColor = (severity: string): { variant: any; className: string } => {
    switch (severity) {
      case "high":
        return { variant: "outline", className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800" };
      case "medium":
        return { variant: "outline", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800" };
      case "low":
        return { variant: "outline", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800" };
      default:
        return { variant: "outline", className: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800" };
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case "crawl":
        return <Bot className="h-3 w-3" />;
      case "prompt_response":
        return <MessageSquare className="h-3 w-3" />;
      case "citation":
        return <Link2 className="h-3 w-3" />;
      case "ai_analysis":
        return <BrainCircuit className="h-3 w-3" />;
      case "manual":
        return <FileSearch className="h-3 w-3" />;
      default:
        return <Sparkles className="h-3 w-3" />;
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "crawl":
        return "Crawl";
      case "prompt_response":
        return "Prompt";
      case "citation":
        return "Citation";
      case "ai_analysis":
        return "AI Analysis";
      case "manual":
        return "Manual";
      default:
        return source;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case "ai crawling":
        return <Bot className="h-4 w-4" />;
      case "content availability":
        return <FileText className="h-4 w-4" />;
      case "content eligibility":
        return <CheckCircle2 className="h-4 w-4" />;
      case "content relevance":
        return <Search className="h-4 w-4" />;
      case "content visibility":
        return <Eye className="h-4 w-4" />;
      default:
        return <Sparkles className="h-4 w-4" />;
    }
  };

  const totalPages = summaryData ? Math.ceil(summaryData.total / pageSize) : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Category Dashboard Tiles */}
      {selectedClientId && (
        <CategoryDashboardTiles
          clientId={selectedClientId}
          onTileClick={handleTileClick}
          selectedCategory={highLevelCategoryFilter !== "all" ? highLevelCategoryFilter : undefined}
          promptRunId={promptRunId || undefined}
        />
      )}

      {/* Table Section */}
      <div ref={tableRef}>
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4">
              <CardTitle>Detailed Recommendations</CardTitle>
            <div className="flex flex-wrap xl:flex-nowrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search recommendations..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-8"
                  data-testid="input-search-recommendations"
                />
              </div>
              <Select
                value={highLevelCategoryFilter}
                onValueChange={(value) => {
                  setHighLevelCategoryFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="AI Crawling">AI Crawling</SelectItem>
                  <SelectItem value="Content Availability">Content Availability</SelectItem>
                  <SelectItem value="Content Eligibility">Content Eligibility</SelectItem>
                  <SelectItem value="Content Relevance">Content Relevance</SelectItem>
                  <SelectItem value="Content Visibility">Content Visibility</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={severityFilter}
                onValueChange={(value) => {
                  setSeverityFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]" data-testid="select-severity-filter">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sourceFilter}
                onValueChange={(value) => {
                  setSourceFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]" data-testid="select-source-filter">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="crawl">Crawl</SelectItem>
                  <SelectItem value="prompt_response">Prompt</SelectItem>
                  <SelectItem value="citation">Citation</SelectItem>
                  <SelectItem value="ai_analysis">AI Analysis</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted-foreground">Loading summary...</div>
            </div>
          ) : !summaryData || summaryData.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <Sparkles className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <h3 className="font-semibold text-gray-900 dark:text-foreground">
                  No recommendations found
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Try adjusting your filters
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">
                        <Button
                          variant="ghost"
                          onClick={() => handleSort("title")}
                          className="h-8 px-2"
                          data-testid="button-sort-title"
                        >
                          Recommendation
                          {getSortIcon("title")}
                        </Button>
                      </TableHead>
                      <TableHead className="w-[15%]">
                        <Button
                          variant="ghost"
                          onClick={() => handleSort("category")}
                          className="h-8 px-2"
                          data-testid="button-sort-category"
                        >
                          Category
                          {getSortIcon("category")}
                        </Button>
                      </TableHead>
                      <TableHead className="w-[12%]">
                        <Button
                          variant="ghost"
                          onClick={() => handleSort("severity")}
                          className="h-8 px-2"
                          data-testid="button-sort-severity"
                        >
                          Severity
                          {getSortIcon("severity")}
                        </Button>
                      </TableHead>
                      <TableHead className="w-[12%]">
                        <Button
                          variant="ghost"
                          onClick={() => handleSort("source")}
                          className="h-8 px-2"
                          data-testid="button-sort-source"
                        >
                          Source
                          {getSortIcon("source")}
                        </Button>
                      </TableHead>
                      <TableHead className="w-[10%] text-center">Duplicates</TableHead>
                      <TableHead className="w-[11%] text-center">Examples</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData.items.map((rec) => (
                      <TableRow
                        key={rec.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedId(rec.id)}
                        data-testid={`row-recommendation-${rec.id}`}
                      >
                        <TableCell className="font-medium">
                          <div className="line-clamp-2">{rec.title}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="whitespace-nowrap">
                            {rec.highLevelCategory}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={getSeverityColor(rec.severity).variant}
                            className={getSeverityColor(rec.severity).className}
                          >
                            {rec.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className="gap-1 whitespace-nowrap"
                          >
                            {getSourceIcon(rec.source)}
                            {getSourceLabel(rec.source)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {rec.duplicateCount > 1 ? (
                            <Badge variant="outline">{rec.duplicateCount}</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {rec.examplesCount > 0 ? (
                            <Badge variant="outline">{rec.examplesCount}</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to{" "}
                  {Math.min(page * pageSize, summaryData.total)} of{" "}
                  {summaryData.total} results
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    data-testid="button-first-page"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(totalPages)}
                    disabled={page >= totalPages}
                    data-testid="button-last-page"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={() => setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedDetail ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">
                  {selectedDetail.title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-8 mt-6">
                {/* Description Section */}
                <div className="bg-muted/30 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-sm uppercase tracking-wide text-gray-900 dark:text-foreground">
                      Description
                    </h4>
                  </div>
                  <div className="h-px bg-border mb-3" />
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                    {selectedDetail.description}
                  </p>
                </div>

                {/* Real Examples Section */}
                {selectedDetail.examples && selectedDetail.examples.length > 0 && (
                  <div className="bg-muted/30 p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Eye className="h-4 w-4 text-primary" />
                      <h4 className="font-bold text-sm uppercase tracking-wide text-gray-900 dark:text-foreground">
                        Real Examples ({selectedDetail.examples.length})
                      </h4>
                    </div>
                    <div className="h-px bg-border mb-4" />
                    <div className="space-y-4">
                      {selectedDetail.examples.map((example, idx) => (
                        <div key={idx} className="bg-background p-3 rounded border border-border">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                              {idx + 1}
                            </div>
                            <div className="flex-1 space-y-2">
                              <div className="text-sm text-gray-700 dark:text-gray-300">
                                {example.content || example.issue}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                                <span className="font-medium">Source:</span>
                                <code className="px-2 py-0.5 bg-muted rounded text-xs break-all">
                                  {example.citation}
                                </code>
                                <Badge variant="outline" className="gap-1">
                                  {getSourceIcon(selectedDetail.source)}
                                  {getSourceLabel(selectedDetail.source)}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Items Section */}
                <div className="bg-muted/30 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-sm uppercase tracking-wide text-gray-900 dark:text-foreground">
                      Action Items
                    </h4>
                  </div>
                  <div className="h-px bg-border mb-4" />
                  {selectedDetail.actionItems && selectedDetail.actionItems.length > 0 ? (
                    <div className="space-y-3">
                      {selectedDetail.actionItems.map((item, idx) => (
                        <div key={idx} className="bg-background p-3 rounded border border-border">
                          <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                              {idx + 1}
                            </span>
                            <div className="flex-1">
                              <p className="text-sm text-gray-700 dark:text-gray-300 font-medium mb-1">
                                {item}
                              </p>
                              <p className="text-xs text-muted-foreground italic">
                                Example: Review {selectedDetail.examples?.[0]?.citation || 'the content'} and implement this change
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Review the description and examples to determine appropriate actions
                    </p>
                  )}
                </div>

                {/* Footer Info */}
                <div className="pt-4 border-t-2 border-muted">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Severity:</span>
                      <Badge 
                        variant={getSeverityColor(selectedDetail.severity).variant}
                        className={getSeverityColor(selectedDetail.severity).className}
                      >
                        {selectedDetail.severity}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground">|</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Category:</span>
                      <span className="font-medium text-gray-900 dark:text-foreground">
                        {summaryData?.items.find(item => item.id === selectedId)?.highLevelCategory || selectedDetail.category}
                      </span>
                    </div>
                    <span className="text-muted-foreground">|</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Sub-category:</span>
                      <span className="font-medium text-gray-900 dark:text-foreground">
                        {summaryData?.items.find(item => item.id === selectedId)?.subCategory || selectedDetail.category}
                      </span>
                    </div>
                    <span className="text-muted-foreground">|</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Source:</span>
                      <Badge variant="outline" className="gap-1">
                        {getSourceIcon(selectedDetail.source)}
                        {getSourceLabel(selectedDetail.source)}
                      </Badge>
                    </div>
                    {summaryData?.items.find(item => item.id === selectedId) && 
                     summaryData.items.find(item => item.id === selectedId)!.duplicateCount > 1 && (
                      <>
                        <span className="text-muted-foreground">|</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Found in</span>
                          <Badge variant="secondary">
                            {summaryData.items.find(item => item.id === selectedId)!.duplicateCount} locations
                          </Badge>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted-foreground">Loading details...</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
