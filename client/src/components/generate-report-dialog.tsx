import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useActiveItemOfKind, describeStarter, invalidateActivityQueries } from "@/hooks/use-client-activity";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";

interface PromptRun {
  id: string;
  name: string;
  createdAt: string;
  totalPrompts: number;
  modelCount: number;
}

interface GenerateReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}

export default function GenerateReportDialog({
  open,
  onOpenChange,
  clientId,
}: GenerateReportDialogProps) {
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  // Task #56: another user (or background job) may already be generating
  // a report for this client; don't let two collide. Soft-disable the
  // submit button when a report_generation activity is active and explain
  // *who* started it *when* in the tooltip.
  const activeReportItem = useActiveItemOfKind(clientId, "report_generation");
  const reportActive = !!activeReportItem;
  const { user } = useAuth();
  const reportTooltip = activeReportItem
    ? `${describeStarter(activeReportItem, user?.id ?? null)} started a report ${formatDistanceToNow(new Date(activeReportItem.startedAt), { addSuffix: true })}.`
    : undefined;

  const { data: runs = [], isLoading } = useQuery<PromptRun[]>({
    queryKey: [`/api/v1/prompt-runs/metadata?client_id=${clientId}`],
    enabled: open && !!clientId,
  });

  const generateMutation = useMutation({
    mutationFn: async (runId: string) => {
      return apiRequest("POST", "/api/v1/reports/generate", {
        clientId,
        runId,
      });
    },
    onSuccess: () => {
      toast({
        title: "Report generation started",
        description: "Your report is being generated in the background.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/v1/reports?clientId=${clientId}`] });
      invalidateActivityQueries(clientId);
      onOpenChange(false);
      setSelectedRunId("");
    },
    onError: (err) => {
      errorToast("Failed to start report generation", err);
    },
  });

  const handleGenerate = () => {
    if (!selectedRunId) {
      toast({
        title: "No run selected",
        description: "Please select a prompt run to generate a report",
        variant: "destructive",
      });
      return;
    }
    generateMutation.mutate(selectedRunId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]" data-testid="dialog-generate-report">
        <DialogHeader>
          <DialogTitle>Generate Executive Report</DialogTitle>
          <DialogDescription>
            Select a prompt run to include in your executive report. The report will
            analyze AI visibility across all prompts in the selected run.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading prompt runs...
              </span>
            </div>
          ) : runs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No completed prompt runs found.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Complete a prompt run first to generate a report.
              </p>
            </div>
          ) : (
            <>
              <Label className="text-sm font-medium">
                Select Prompt Run ({runs.length} available):
              </Label>
              <div className="mt-3 max-h-[320px] overflow-y-auto pr-2 border rounded-md">
                <RadioGroup
                  value={selectedRunId}
                  onValueChange={setSelectedRunId}
                  className="space-y-2 p-2"
                >
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <RadioGroupItem
                        value={run.id}
                        id={run.id}
                        className="mt-1"
                        data-testid={`radio-run-${run.id}`}
                      />
                      <Label
                        htmlFor={run.id}
                        className="flex-1 cursor-pointer space-y-1"
                      >
                        <div className="font-medium">{run.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(run.createdAt), "MMM d, yyyy h:mm a")} •{" "}
                          {run.totalPrompts} prompts • {run.modelCount} models
                        </div>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {selectedRunId && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {runs.find((r) => r.id === selectedRunId)?.totalPrompts || 0}{" "}
                      prompts
                    </span>{" "}
                    will be analyzed across{" "}
                    <span className="font-medium text-foreground">
                      {runs.find((r) => r.id === selectedRunId)?.modelCount || 0}{" "}
                      AI models
                    </span>
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!selectedRunId || generateMutation.isPending || runs.length === 0 || reportActive}
            data-testid="button-generate"
            title={reportTooltip}
          >
            {reportActive ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Already running…
              </>
            ) : generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate Report"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
