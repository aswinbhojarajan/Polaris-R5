import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Package, RefreshCw, Plus, Trash2, Eye, Download, X } from "lucide-react";
import { SlowQueryNotice } from "@/components/feedback/SlowQueryNotice";
import { RetryCard } from "@/components/feedback/RetryCard";
import { ApiError, throwIfResNotOk } from "@/lib/queryClient";
import { ErrorState } from "@/components/feedback/ErrorState";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";
import GenerateReportDialog from "@/components/generate-report-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";
import * as remarkGfmModule from "remark-gfm";

// Handle ESM default export - some bundlers resolve it differently
// In production builds, the default export might be nested under .default
const remarkGfm = (remarkGfmModule as any).default || remarkGfmModule;

// Create a stable reference to the remarkGfm plugin array
const remarkPlugins = [remarkGfm];

// Validate plugin loaded correctly (error only, no noise in production)
if (typeof remarkGfm !== 'function') {
  console.error('[Reports] remarkGfm plugin failed to load - markdown formatting may not work');
}

interface ReportSnapshot {
  id: string;
  clientId: string;
  projectId: string;
  runIds: string[];
  generatedAt: string;
  generatedBy: string;
  status: string;
  narrativeGenerated: boolean;
  // Task #90 — embedded latest job info from the LEFT JOIN in
  // GET /api/v1/reports so partial-success state is visible without
  // an extra per-row /job request after the generating window passes.
  jobStatus?: string | null;
  jobErrorMessage?: string | null;
  jobCurrentStep?: string | null;
  // Task #104 — per-asset availability flags from /api/v1/reports.
  // Source of truth: whether a `report_files` row exists for the snapshot.
  insightsPdfAvailable?: boolean;
  appendixPdfAvailable?: boolean;
  snapshotData?: {
    metadata?: {
      totalPrompts?: number;
      totalModels?: number;
      totalResponses?: number;
      totalCitations?: number;
      totalMentions?: number;
      totalRankings?: number;
    };
  };
}

interface ReportJob {
  id: string;
  snapshotId: string;
  status: string;
  progressPercent: number;
  progressMessage: string | null;
  currentStep: string | null;
  errorMessage: string | null;
}

// Helper function to format section names: executive_summary -> Executive Summary
function formatSectionName(name: string, clientName?: string): string {
  const formatted = name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  // Special case: add client name to "Why Llms Exclude"
  if (name === 'why_llms_exclude' && clientName) {
    return `Why LLMs Exclude ${clientName}`;
  }
  
  return formatted;
}

// Helper function to format camelCase field names: rootCauseHypotheses -> Root Cause Hypotheses
function formatFieldName(text: string): string {
  return text
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

// Pre-process content to format field names in markdown and ensure proper line breaks
// This is a client-side fallback for content that wasn't normalized during generation
function preprocessContent(content: string): string {
  if (!content) return content;
  
  let processed = content;
  
  // Convert any \n literals to actual newlines (if stored escaped)
  processed = processed.replace(/\\n/g, '\n');
  
  // STEP 1: Add bold to common heading patterns that LLM missed
  // First, protect already-bold headings from double-processing
  const boldHeadingPlaceholders: string[] = [];
  processed = processed.replace(/\*\*([^*]+?):\*\*/g, (match) => {
    boldHeadingPlaceholders.push(match);
    return `__BOLD_HEADING_${boldHeadingPlaceholders.length - 1}__`;
  });
  
  // Add bold to unformatted heading patterns (Title Case words followed by colon)
  // Examples: "Technical & Crawlability Issues:", "By Intent Level:", "What DHL Risks Losing:"
  processed = processed.replace(/^([A-Z][A-Za-z&\-\/\s]+?):\s/gm, '**$1:** ');
  processed = processed.replace(/\.\s+([A-Z][A-Za-z&\-\/\s]{3,50}?):\s/g, '.\n\n**$1:** ');
  
  // Restore protected bold headings
  boldHeadingPlaceholders.forEach((placeholder, index) => {
    processed = processed.replace(`__BOLD_HEADING_${index}__`, placeholder);
  });
  
  // STEP 2: Ensure numbered lists have line breaks before them (1., 2., etc.)
  processed = processed.replace(/([.!?])\s*(\d+\.\s+\*?\*?[A-Z])/g, '$1\n\n$2');
  
  // STEP 3: Ensure lettered list items have line breaks (A., B., C., etc.)
  processed = processed.replace(/([.!?])\s*([A-Z]\.\s+[A-Z])/g, '$1\n\n$2');
  
  // STEP 4: Ensure bullet points have line breaks before them
  processed = processed.replace(/([.!?])\s*([-*•]\s+)/g, '$1\n\n$2');
  
  // STEP 5: Ensure phase/time markers have line breaks
  processed = processed.replace(/([.!?:])(\s*)(Phase\s+\d+)/gi, '$1\n\n$3');
  processed = processed.replace(/([.!?:])(\s*)(\d+-\d+\s+Days?)/gi, '$1\n\n$3');
  
  // STEP 6: Ensure bold section markers have line breaks before them
  processed = processed.replace(/([.!?])\s*(\*\*[A-Z])/g, '$1\n\n$2');
  
  // STEP 7: Ensure "By X:" patterns are bold and on new lines  
  processed = processed.replace(/([.!?])\s*(By\s+[A-Za-z\s]+:)/g, '$1\n\n**$2**');
  
  // STEP 8: Format camelCase field names that appear as **fieldName**:
  processed = processed.replace(/\*\*([a-z][a-zA-Z]+)\*\*:/g, (match, fieldName) => {
    return `**${formatFieldName(fieldName)}**:`;
  });
  
  // STEP 9: Clean up any excessive newlines (more than 2 in a row)
  processed = processed.replace(/\n{3,}/g, '\n\n');
  
  // STEP 10: Fix orphaned numbers (number alone on line before heading)
  processed = processed.replace(/(\d+\.)\s*\n+\s*(\*\*)/g, '$1 $2');
  
  return processed.trim();
}

export default function Reports() {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [, navigate] = useLocation();
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [pollingReports, setPollingReports] = useState<Set<string>>(new Set());
  const [viewingReportId, setViewingReportId] = useState<string | null>(null);

  const { data: reportsData, isLoading, isError, error, refetch } = useQuery<{ reports: ReportSnapshot[] }>({
    queryKey: [`/api/v1/reports?clientId=${selectedClientId}`],
    enabled: !!selectedClientId,
  });
  const reportsQueryKey = [`/api/v1/reports?clientId=${selectedClientId}`];
  const reportsRequestId = error instanceof ApiError ? error.requestId : null;

  const reports = reportsData?.reports || [];

  // Fetch report sections when viewing
  const {
    data: sectionsData,
    isLoading: sectionsLoading,
    isError: sectionsError,
    error: sectionsErrorObj,
    refetch: refetchSections,
  } = useQuery({
    queryKey: ["/api/v1/reports", viewingReportId, "sections"],
    queryFn: async () => {
      if (!viewingReportId) return null;
      const response = await fetch(`/api/v1/reports/${viewingReportId}/sections?clientId=${selectedClientId}`);
      // Throws a typed ApiError (with requestId) on non-2xx so the
      // dialog's <ErrorState> can surface a useful message.
      await throwIfResNotOk(response);
      return response.json();
    },
    enabled: !!viewingReportId && !!selectedClientId,
  });

  const { data: clientData } = useQuery<{ client: { name: string } }>({
    queryKey: [`/api/v1/clients/${selectedClientId}`],
    enabled: !!selectedClientId,
  });

  // Poll for job status for generating reports
  const generatingReports = reports.filter(r => r.status === 'generating');
  
  useEffect(() => {
    if (generatingReports.length === 0 || !selectedClientId) return;

    const pollInterval = setInterval(async () => {
      for (const report of generatingReports) {
        if (pollingReports.has(report.id)) continue;
        
        try {
          setPollingReports(prev => new Set(prev).add(report.id));
          const response = await fetch(`/api/v1/reports/${report.id}/job?clientId=${selectedClientId}`);
          if (response.ok) {
            const { job } = await response.json();
            if (job.status === 'completed' || job.status === 'failed') {
              // Refetch reports to get updated status
              queryClient.invalidateQueries({ queryKey: [`/api/v1/reports?clientId=${selectedClientId}`] });
              
              if (job.status === 'completed') {
                // Task #104 — `currentStep === 'completed_partial'` means
                // the report saved but at least one PDF failed. Show a
                // warning toast (not destructive) and let the partial
                // banner on the row carry the detail.
                if (job.currentStep === 'completed_partial') {
                  toast({
                    title: "Report Ready (with warnings)",
                    description: "Some assets could not be generated — see the report row for details.",
                  });
                } else {
                  toast({
                    title: "Reports Ready",
                    description: "Both Insights Report and Technical Appendix are ready for download!",
                  });
                }
              } else if (job.status === 'failed') {
                // Task #104 — strip Playwright's verbose chromium command
                // line out of the toast (e.g. `spawn EIO --foo --bar …`).
                // Keep the leading message, drop everything from the first
                // ` --` flag onward; full text is still available in the
                // failure banner on the report card.
                const raw = job.errorMessage || "An error occurred";
                const cleaned = raw.split(/\s--/)[0].trim();
                errorToast(
                  "Report Generation Failed",
                  new Error(cleaned.length > 200 ? cleaned.slice(0, 200) + '…' : cleaned),
                );
              }
            }
          }
        } finally {
          setPollingReports(prev => {
            const newSet = new Set(prev);
            newSet.delete(report.id);
            return newSet;
          });
        }
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [generatingReports.length, selectedClientId]);

  // Fetch job details for generating reports
  const { data: jobsData } = useQuery({
    queryKey: ["/api/v1/reports/jobs", generatingReports.map(r => r.id), selectedClientId],
    queryFn: async () => {
      const jobs: Record<string, ReportJob> = {};
      for (const report of generatingReports) {
        try {
          const response = await fetch(`/api/v1/reports/${report.id}/job?clientId=${selectedClientId}`);
          if (response.ok) {
            const { job } = await response.json();
            jobs[report.id] = job;
          }
        } catch (error) {
          console.error(`Failed to fetch job for report ${report.id}:`, error);
        }
      }
      return jobs;
    },
    enabled: generatingReports.length > 0 && !!selectedClientId,
    refetchInterval: 3000,
  });

  // Task #90 — Retry the Technical Appendix when the Insights Report
  // shipped but the appendix half failed. Server reuses the stored
  // snapshot data, regenerates appendix + PDF, and clears errorMessage.
  const retryAppendixMutation = useMutation({
    mutationFn: async (reportId: string) => {
      return apiRequest(
        "POST",
        `/api/v1/reports/${reportId}/retry-appendix?clientId=${selectedClientId}`,
      );
    },
    onSuccess: () => {
      toast({
        title: "Technical Appendix regenerated",
        description: "Appendix is now available for download.",
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/v1/reports?clientId=${selectedClientId}`],
      });
    },
    onError: (err) => {
      errorToast("Retry failed", err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (reportId: string) => {
      return apiRequest("DELETE", `/api/v1/reports/${reportId}?clientId=${selectedClientId}`);
    },
    onSuccess: () => {
      toast({ title: "Report deleted successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/v1/reports?clientId=${selectedClientId}`] });
      setDeleteDialogOpen(false);
      setReportToDelete(null);
    },
    onError: (err) => {
      errorToast("Failed to delete report", err);
    },
  });

  const handleDownloadPDF = async (reportId: string) => {
    if (!selectedClientId) return;
    
    try {
      const response = await fetch(`/api/v1/reports/${reportId}/download/pdf?clientId=${selectedClientId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download PDF');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `report-${reportId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Insights Report downloaded successfully" });
    } catch (error) {
      console.error('Error downloading PDF:', error);
      errorToast("Download failed", error);
    }
  };

  const handleDownloadAppendixPDF = async (reportId: string) => {
    if (!selectedClientId) return;
    
    try {
      const response = await fetch(`/api/v1/reports/${reportId}/download/appendix?clientId=${selectedClientId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download Technical Appendix');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `technical-appendix-${reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Technical Appendix downloaded successfully" });
    } catch (error) {
      console.error('Error downloading appendix:', error);
      errorToast("Download failed", error);
    }
  };

  const handleDownloadExport = async (reportId: string) => {
    if (!selectedClientId) return;
    
    try {
      const response = await fetch(`/api/v1/reports/${reportId}/export?clientId=${selectedClientId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download export');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `polaris-export-${reportId}.zip`;
      
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Data export downloaded successfully" });
    } catch (error) {
      console.error('Error downloading export:', error);
      errorToast("Download failed", error);
    }
  };

  const confirmDelete = (reportId: string) => {
    setReportToDelete(reportId);
    setDeleteDialogOpen(true);
  };

  if (!selectedClientId) {
    return (
      <div className="page-content">
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-foreground mb-2">No Project Selected</h2>
          <p className="text-muted-foreground">Pick a project from the switcher in the top right to view reports.</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-content">
        <RetryCard
          error={error}
          onRetry={() => refetch()}
          title="Couldn't load reports"
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="page-content">
        <div className="loading-skeleton h-48 w-full rounded" data-testid="reports-loading"></div>
        <SlowQueryNotice
          loading={isLoading}
          queryKey={reportsQueryKey}
          requestId={reportsRequestId}
        />
      </div>
    );
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'ready':
      case 'complete':
        return 'default';
      case 'generating':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <div className="fade-in">
      <div className="page-content pt-4">
        {/* Task #56: hide report_generation here — Reports page already
            renders per-row generation status, so the banner would duplicate. */}
        <ActiveOperationsBanner
          clientId={selectedClientId}
          excludeKinds={["report_generation"]}
        />
      </div>
      {/* Header */}
      <div className="page-content border-b border-border bg-card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">Executive Reports</h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              AI visibility analysis reports with comprehensive data exports
            </p>
          </div>
          <div className="button-group-responsive flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              data-testid="button-refresh"
              className="w-full sm:w-auto"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              onClick={() => setGenerateDialogOpen(true)}
              data-testid="button-generate"
              className="w-full sm:w-auto"
            >
              <Plus className="mr-2 h-4 w-4" />
              Generate Report
            </Button>
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="page-content">
        {reports.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-semibold">No reports generated</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Generate your first executive report to analyze AI visibility
                </p>
                <Button
                  onClick={() => setGenerateDialogOpen(true)}
                  className="mt-4"
                  data-testid="button-generate-empty"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Generate Report
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => {
              const job = jobsData?.[report.id];
              const metadata = report.snapshotData?.metadata;
              
              return (
                <Card key={report.id} data-testid={`report-card-${report.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="h-5 w-5" />
                          Report {report.id.substring(0, 8)}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Generated {format(new Date(report.generatedAt), 'MMM d, yyyy h:mm a')}
                        </CardDescription>
                      </div>
                      <Badge variant={getStatusBadgeVariant(report.status)}>
                        {report.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Metadata Stats */}
                    {metadata && report.status !== 'generating' && (
                      <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="text-sm">
                          <span className="text-muted-foreground">Prompts:</span>
                          <span className="ml-1 font-medium">{metadata.totalPrompts || 0}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Models:</span>
                          <span className="ml-1 font-medium">{metadata.totalModels || 0}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Citations:</span>
                          <span className="ml-1 font-medium">{metadata.totalCitations || 0}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Mentions:</span>
                          <span className="ml-1 font-medium">{metadata.totalMentions || 0}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Rankings:</span>
                          <span className="ml-1 font-medium">{metadata.totalRankings || 0}</span>
                        </div>
                      </div>
                    )}

                    {/* Progress Bar for Generating Reports */}
                    {report.status === 'generating' && job && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">
                            {job.progressPercent}% Complete
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {job.currentStep || 'Processing...'}
                          </span>
                        </div>
                        <Progress value={job.progressPercent} className="h-2" />
                        {job.progressMessage && (
                          <p className="text-xs text-muted-foreground mt-2">
                            {job.progressMessage}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Error Message */}
                    {report.status === 'failed' && job?.errorMessage && (
                      <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <p className="text-sm text-destructive">{job.errorMessage}</p>
                      </div>
                    )}

                    {/* Task #90 + #104 — Partial-success row banner.
                        Concise user-facing message ("PDF rendering failed
                        — please try again or contact support.") with the
                        raw backend error tucked behind a <details>
                        accordion for admins. Per-asset hint copy is
                        derived from availability flags so insights-only
                        and appendix-only failures show the right guidance. */}
                    {(() => {
                      const isReady = report.status === 'ready' || report.status === 'complete';
                      if (!isReady || !report.jobErrorMessage) return null;
                      const insightsOk = report.insightsPdfAvailable !== false;
                      const appendixOk = report.appendixPdfAvailable === true;
                      const hint = !insightsOk && !appendixOk
                        ? 'Both PDFs are unavailable. The report sections are saved and viewable above.'
                        : !insightsOk
                          ? 'The Insights PDF is unavailable. The report sections are saved and viewable above; the Technical Appendix PDF is ready.'
                          : 'The Technical Appendix is unavailable. The Insights Report is complete and available below.';
                      return (
                        <div
                          className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg"
                          data-testid={`status-partial-${report.id}`}
                        >
                          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                            PDF rendering failed — please try again or contact support.
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">{hint}</p>
                          <details className="mt-2">
                            <summary
                              className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none"
                              data-testid={`button-error-details-${report.id}`}
                            >
                              Show technical details
                            </summary>
                            <pre
                              className="mt-2 p-2 bg-background/50 rounded text-xs whitespace-pre-wrap break-words text-muted-foreground max-h-40 overflow-auto"
                              data-testid={`text-error-details-${report.id}`}
                            >
                              {report.jobErrorMessage}
                            </pre>
                          </details>
                        </div>
                      );
                    })()}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="default"
                        onClick={() => setViewingReportId(report.id)}
                        disabled={report.status !== 'ready' && report.status !== 'complete'}
                        data-testid={`button-view-${report.id}`}
                        size="sm"
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View Report
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleDownloadPDF(report.id)}
                        disabled={
                          (report.status !== 'ready' && report.status !== 'complete') ||
                          // Task #104 — Insights PDF can independently fail.
                          // Disable the download when the file row is missing.
                          report.insightsPdfAvailable === false
                        }
                        title={report.insightsPdfAvailable === false ? 'Insights PDF unavailable for this report' : undefined}
                        data-testid={`button-download-pdf-${report.id}`}
                        size="sm"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {report.insightsPdfAvailable === false ? 'Insights Unavailable' : 'Insights Report'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleDownloadAppendixPDF(report.id)}
                        disabled={
                          (report.status !== 'ready' && report.status !== 'complete') ||
                          // Task #104 — drive from per-asset availability,
                          // not generic jobErrorMessage (which can fire for
                          // insights-only failures too).
                          report.appendixPdfAvailable !== true
                        }
                        title={report.appendixPdfAvailable !== true ? 'Technical Appendix unavailable for this report' : undefined}
                        data-testid={`button-download-appendix-${report.id}`}
                        size="sm"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {report.appendixPdfAvailable !== true ? 'Appendix Unavailable' : 'Technical Appendix'}
                      </Button>
                      {/* Task #90 + #104 — Retry only when appendix is the
                          ONLY missing piece. If the Insights PDF is also
                          missing, the API will refuse with 409 because the
                          regenerator would clear the error state and hide
                          the Insights failure. Mirror that gate here so we
                          don't even show the button. */}
                      {(report.status === 'ready' || report.status === 'complete') &&
                        report.insightsPdfAvailable === true &&
                        report.appendixPdfAvailable !== true && (
                          <Button
                            variant="outline"
                            onClick={() => retryAppendixMutation.mutate(report.id)}
                            disabled={retryAppendixMutation.isPending}
                            data-testid={`button-retry-appendix-${report.id}`}
                            size="sm"
                          >
                            <RefreshCw
                              className={`mr-2 h-4 w-4 ${
                                retryAppendixMutation.isPending && retryAppendixMutation.variables === report.id
                                  ? 'animate-spin'
                                  : ''
                              }`}
                            />
                            Retry Appendix
                          </Button>
                        )}
                      <Button
                        variant="outline"
                        onClick={() => handleDownloadExport(report.id)}
                        disabled={report.status !== 'ready' && report.status !== 'complete'}
                        data-testid={`button-download-export-${report.id}`}
                        size="sm"
                      >
                        <Package className="mr-2 h-4 w-4" />
                        Data Export
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => confirmDelete(report.id)}
                        data-testid={`button-delete-${report.id}`}
                        size="sm"
                        className="text-destructive hover:text-destructive border-[#EDE8FF] hover:border-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Generate Report Dialog */}
      <GenerateReportDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        clientId={selectedClientId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the report and associated files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => reportToDelete && deleteMutation.mutate(reportToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report Viewer Dialog */}
      <Dialog open={!!viewingReportId} onOpenChange={(open) => !open && setViewingReportId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Report Content Preview</DialogTitle>
            <DialogDescription>
              Review the narrative sections before downloading the PDF
            </DialogDescription>
          </DialogHeader>
          
          {sectionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading-skeleton h-64 w-full rounded"></div>
            </div>
          ) : sectionsError ? (
            <ErrorState
              compact
              error={sectionsErrorObj}
              onRetry={() => refetchSections()}
              title="Couldn't load report content"
            />
          ) : sectionsData?.sections?.length > 0 ? (
            <Tabs defaultValue="insights" className="w-full overflow-hidden">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="insights" data-testid="tab-insights-report">
                  Insights Report
                </TabsTrigger>
                <TabsTrigger value="appendix" data-testid="tab-diagnostic-appendix">
                  Diagnostic Appendix
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="insights" className="mt-4 overflow-hidden">
                <ScrollArea className="h-[60vh]">
                  <div className="space-y-4 pr-4">
                    {sectionsData.sections
                      .filter((section: any) => section.sectionName !== 'diagnostic_appendix')
                      .map((section: any) => {
                        const content = section.sectionContent || section.content || 'No content available';
                        const processedContent = preprocessContent(content);
                        const client = clientData?.client;
                        
                        return (
                          <Card key={section.id} className="overflow-hidden">
                            <CardHeader>
                              <CardTitle className="text-lg">
                                {formatSectionName(section.sectionName, client?.name)}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="overflow-hidden">
                              <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden [&_*]:max-w-full [&_p]:whitespace-normal [&_li]:whitespace-normal [&_pre]:bg-muted [&_pre]:text-foreground [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:bg-muted [&_code]:text-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_ul]:space-y-1 [&_ol]:space-y-1 [&_li]:my-1 [&_li_strong:first-child]:block [&_li_strong:first-child]:mb-1 [&_li_strong:first-child]:text-foreground [&_li_ul]:mt-2 [&_li_ol]:mt-2 [&_p]:my-2 [&_table]:w-full [&_table]:overflow-x-auto [&_table]:block">
                                <ReactMarkdown remarkPlugins={remarkPlugins}>
                                  {processedContent}
                                </ReactMarkdown>
                              </div>
                            </CardContent>
                          </Card>
                        );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="appendix" className="mt-4 overflow-hidden">
                <ScrollArea className="h-[60vh]">
                  <div className="space-y-4 pr-4">
                    {sectionsData.sections
                      .filter((section: any) => section.sectionName === 'diagnostic_appendix')
                      .map((section: any) => {
                        const content = section.sectionContent || section.content || 'No content available';
                        const processedContent = preprocessContent(content);
                        const client = clientData?.client;
                        
                        return (
                          <Card key={section.id} className="overflow-hidden">
                            <CardHeader>
                              <CardTitle className="text-lg">
                                {formatSectionName(section.sectionName, client?.name)}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="overflow-hidden">
                              <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden [&_*]:max-w-full [&_p]:whitespace-normal [&_li]:whitespace-normal [&_pre]:bg-muted [&_pre]:text-foreground [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:bg-muted [&_code]:text-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_ul]:space-y-1 [&_ol]:space-y-1 [&_li]:my-1 [&_li_strong:first-child]:block [&_li_strong:first-child]:mb-1 [&_li_strong:first-child]:text-foreground [&_li_ul]:mt-2 [&_li_ol]:mt-2 [&_p]:my-2 [&_table]:w-full [&_table]:overflow-x-auto [&_table]:block">
                                <ReactMarkdown remarkPlugins={remarkPlugins}>
                                  {processedContent}
                                </ReactMarkdown>
                              </div>
                            </CardContent>
                          </Card>
                        );
                    })}
                    {sectionsData.sections.filter((section: any) => section.sectionName === 'diagnostic_appendix').length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>No diagnostic appendix available for this report.</p>
                        <p className="text-sm mt-2">Generate a new report to include the technical appendix.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No report content available
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
