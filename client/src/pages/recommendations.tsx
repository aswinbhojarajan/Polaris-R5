import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Search,
  FileText,
  Eye,
  Bot,
  LayoutGrid,
  List,
  Plus,
} from "lucide-react";
import RecommendationsSummary from "@/components/recommendations-summary";
import { OpportunityRunFilter } from "@/components/OpportunityRunFilter";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";

interface Recommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  example?: {
    citation: string;
    content: string;
    issue: string;
  };
  actionItems: string[];
}

interface RecommendationResponse {
  recommendations: Recommendation[];
  generatedAt: string;
}

const manualRecommendationSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  severity: z.enum(["high", "medium", "low"]),
  category: z.string().min(1, "Category is required"),
  actionItems: z.string().min(1, "At least one action item is required"),
});

type ManualRecommendationForm = z.infer<typeof manualRecommendationSchema>;

export default function Recommendations() {
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  const [viewMode, setViewMode] = useState<"summary" | "detailed">("summary");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<ManualRecommendationForm>({
    resolver: zodResolver(manualRecommendationSchema),
    defaultValues: {
      title: "",
      description: "",
      severity: "medium",
      category: "",
      actionItems: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ManualRecommendationForm) => {
      const response = await fetch("/api/v1/opportunities/recommendations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(selectedClientId ? { "X-Client-Id": selectedClientId } : {}),
        },
        body: JSON.stringify({
          ...data,
          actionItems: data.actionItems.split("\n").map(item => item.trim()).filter(Boolean),
          examples: [],
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create recommendation");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Manual recommendation created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/opportunities/recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/opportunities/recommendations/summary"] });
      setShowCreateDialog(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create recommendation",
        variant: "destructive",
      });
    },
  });

  const { data: recommendationsData, isLoading } =
    useQuery<RecommendationResponse>({
      queryKey: ["/api/v1/opportunities/recommendations", selectedClientId, selectedRunId],
      enabled: !!selectedClientId && viewMode === "detailed",
      queryFn: async () => {
        const url = new URL("/api/v1/opportunities/recommendations", window.location.origin);
        if (selectedRunId) url.searchParams.set("promptRunId", selectedRunId);
        const response = await fetch(url.toString(), {
          headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
        });
        if (!response.ok) throw new Error("Failed to fetch recommendations");
        return response.json();
      },
    });

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

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "secondary";
    }
  };

  return (
    <div className="p-6 space-y-6">
      <ActiveOperationsBanner clientId={selectedClientId} />
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-foreground">
              Recommendations
            </h1>
            <p className="text-gray-600 dark:text-muted-foreground mt-1">
              AI-powered insights on content optimization for better AI assistant
              visibility
            </p>
          </div>
          <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "summary" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("summary")}
            data-testid="button-summary-view"
          >
            <List className="h-4 w-4 mr-2" />
            Summary
          </Button>
          <Button
            variant={viewMode === "detailed" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("detailed")}
            data-testid="button-detailed-view"
          >
            <LayoutGrid className="h-4 w-4 mr-2" />
            Detailed
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            data-testid="button-add-recommendation"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Manual
          </Button>
          </div>
        </div>
        <OpportunityRunFilter
          selectedClientId={selectedClientId}
          selectedRunId={selectedRunId}
          onRunChange={setSelectedRunId}
        />
      </div>

      {viewMode === "summary" ? (
        <RecommendationsSummary promptRunId={selectedRunId} />
      ) : isLoading ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">
            Loading recommendations...
          </div>
        </div>
      ) : !recommendationsData ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <Sparkles className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-foreground">
                  No recommendations yet
                </h3>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {recommendationsData.recommendations.map((rec) => (
            <Card key={rec.id} data-testid={`recommendation-${rec.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      {getCategoryIcon(rec.category)}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{rec.title}</CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline">{rec.category}</Badge>
                        <Badge variant={getSeverityColor(rec.severity)}>
                          {rec.severity} priority
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-gray-600 dark:text-muted-foreground">
                  {rec.description}
                </p>

                {rec.example && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <div className="space-y-2">
                        <div className="font-semibold text-gray-900 dark:text-foreground">
                          Example from your citations:
                        </div>
                        <div className="text-xs text-gray-600 dark:text-muted-foreground">
                          <strong>Source:</strong> {rec.example.citation}
                        </div>
                        <div className="text-sm bg-muted p-2 rounded">
                          {rec.example.content}
                        </div>
                        <div className="text-sm text-destructive">
                          <strong>Issue:</strong> {rec.example.issue}
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-foreground mb-2">
                    Action Items:
                  </h4>
                  <ul className="space-y-2">
                    {rec.actionItems.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-sm text-gray-600 dark:text-muted-foreground"
                      >
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Manual Creation Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Manual Recommendation</DialogTitle>
            <DialogDescription>
              Add a custom recommendation based on your insights
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Improve structured data markup"
                        {...field}
                        data-testid="input-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-category">
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="AI Crawling">AI Crawling</SelectItem>
                        <SelectItem value="Content Availability">Content Availability</SelectItem>
                        <SelectItem value="Content Eligibility">Content Eligibility</SelectItem>
                        <SelectItem value="Content Relevance">Content Relevance</SelectItem>
                        <SelectItem value="Content Visibility">Content Visibility</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Severity</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-severity">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Explain the issue and why it matters..."
                        className="min-h-[100px]"
                        {...field}
                        data-testid="textarea-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="actionItems"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Action Items (one per line)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add schema.org markup&#10;Update meta tags&#10;Test with AI crawlers"
                        className="min-h-[100px]"
                        {...field}
                        data-testid="textarea-action-items"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                  disabled={createMutation.isPending}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-create"
                >
                  {createMutation.isPending ? "Creating..." : "Create Recommendation"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
