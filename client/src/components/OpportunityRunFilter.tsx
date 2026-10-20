import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "lucide-react";
import { format } from "date-fns";

interface RunMetadata {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  totalPrompts: number;
}

interface OpportunityRunFilterProps {
  selectedClientId: string | null;
  selectedRunId: string | null;
  onRunChange: (runId: string | null) => void;
}

export function OpportunityRunFilter({ 
  selectedClientId, 
  selectedRunId, 
  onRunChange 
}: OpportunityRunFilterProps) {
  const { data: runs = [], isLoading } = useQuery<RunMetadata[]>({
    queryKey: ["/api/v1/prompt-runs/metadata", selectedClientId],
    queryFn: async () => {
      const response = await fetch("/api/v1/prompt-runs/metadata", {
        headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch run metadata");
      return response.json();
    },
    enabled: !!selectedClientId,
  });

  const completedRuns = runs.filter(
    run => run.status === 'done' || run.status === 'completed_with_errors',
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span>Loading runs...</span>
      </div>
    );
  }

  if (completedRuns.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2" data-testid="opportunity-run-filter">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedRunId || "all"}
        onValueChange={(value) => onRunChange(value === "all" ? null : value)}
      >
        <SelectTrigger className="w-[280px]" data-testid="select-run-filter">
          <SelectValue placeholder="All Runs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" data-testid="option-all-runs">
            All Runs (Cumulative)
          </SelectItem>
          <SelectItem value="historical" data-testid="option-historical">
            Historical (Pre-filter)
          </SelectItem>
          {completedRuns.map((run) => (
            <SelectItem 
              key={run.id} 
              value={run.id}
              data-testid={`option-run-${run.id}`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate max-w-[180px]">{run.name}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(run.createdAt), "MMM d, yyyy")}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
