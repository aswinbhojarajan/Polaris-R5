import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Copy, Download, FileText, CheckCircle2, Loader2 } from "lucide-react";
import { OpportunityRunFilter } from "@/components/OpportunityRunFilter";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface GeneratedContent {
  id: string;
  citationSource: string;
  topic: string;
  content: string;
  generatedAt: string;
  format: string;
}

interface DeliverablesStatus {
  promptRunId: string;
  runStatus: string;
  status: "pending" | "generating" | "ready" | "needs_attention";
  errorSummary: string | null;
  recommendationCount: number;
  contentCount: number;
  targetContentCount: number;
}

export default function ContentGenerator() {
  const { toast } = useToast();
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: contents = [], isLoading } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/v1/opportunities/content", selectedClientId, selectedRunId],
    enabled: !!selectedClientId,
    queryFn: async () => {
      const url = new URL("/api/v1/opportunities/content", window.location.origin);
      if (selectedRunId) url.searchParams.set("promptRunId", selectedRunId);
      const response = await fetch(url.toString(), {
        headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch content");
      return response.json();
    },
  });

  const { data: deliverables } = useQuery<DeliverablesStatus>({
    queryKey: ["/api/v1/opportunities/deliverables/status", selectedClientId, selectedRunId],
    enabled: !!selectedClientId,
    queryFn: async () => {
      const url = new URL("/api/v1/opportunities/deliverables/status", window.location.origin);
      if (selectedRunId) url.searchParams.set("promptRunId", selectedRunId);
      const response = await fetch(url.toString(), {
        headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch deliverable status");
      return response.json();
    },
    refetchInterval: query => query.state.data?.status === "generating" ? 3000 : false,
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!deliverables?.promptRunId) throw new Error("Select a completed run first");
      const response = await apiRequest(
        "POST",
        "/api/v1/opportunities/deliverables/retry",
        { promptRunId: deliverables.promptRunId },
      );
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/v1/opportunities/content"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/v1/opportunities/deliverables/status"] }),
      ]);
      toast({ title: "Final deliverables updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not retry final deliverables",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      toast({ title: "Content copied to clipboard" });
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      toast({
        title: "Couldn't copy content",
        description:
          "Your browser blocked clipboard access. Select the text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = (content: string, topic: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${topic.replace(/\s+/g, "-").toLowerCase()}-content.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: "Content downloaded" });
  };

  return (
    <div className="p-6 space-y-6">
      <ActiveOperationsBanner clientId={selectedClientId} />
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-foreground">
            Content Generator
          </h1>
          <p className="text-gray-600 dark:text-muted-foreground mt-1">
            AI-generated world-class content optimized for AI assistant
            discoverability
          </p>
        </div>
        <OpportunityRunFilter
          selectedClientId={selectedClientId}
          selectedRunId={selectedRunId}
          onRunChange={setSelectedRunId}
        />
      </div>

      {deliverables?.status === "generating" && (
        <Card className="border-purple-200 bg-purple-50/60">
          <CardContent className="py-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-purple-700" />
            <div>
              <p className="font-medium">Finalizing run deliverables</p>
              <p className="text-sm text-muted-foreground">
                Generating recommendations and content drafts for this prompt run.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {deliverables?.status === "needs_attention" && (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 text-amber-700" />
              <div>
                <p className="font-medium">Prompt run complete — some deliverables need attention</p>
                <p className="text-sm text-muted-foreground">
                  {deliverables.errorSummary || "One or more final deliverables could not be generated."}
                </p>
              </div>
            </div>
            <Button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Retry missing deliverables
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">
            Loading generated content...
          </div>
        </div>
      ) : contents.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-foreground">
                  No content generated yet
                </h3>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {contents.map((item) => (
            <Card key={item.id} data-testid={`content-${item.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{item.topic}</CardTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline">{item.citationSource}</Badge>
                      <Badge variant="secondary">{item.format}</Badge>
                      <span className="text-xs text-gray-600 dark:text-muted-foreground">
                        {new Date(item.generatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(item.content, item.id)}
                      data-testid={`button-copy-${item.id}`}
                    >
                      {copiedId === item.id ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(item.content, item.topic)}
                      data-testid={`button-download-${item.id}`}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-muted rounded-lg p-4">
                  <Textarea
                    value={item.content}
                    readOnly
                    className="min-h-[200px] font-mono text-sm bg-transparent border-none resize-none"
                    data-testid={`text-content-${item.id}`}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
