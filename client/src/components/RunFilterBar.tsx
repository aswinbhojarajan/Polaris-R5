import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar, RotateCcw, ChevronDown } from "lucide-react";
import { format } from "date-fns";

interface RunMetadata {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  totalPrompts: number;
  modelCount: number;
}

interface RunFilterBarProps {
  selectedClientId: string;
  selectedRunIds: string[];
  onRunSelect: (runIds: string[]) => void;
}

export function RunFilterBar({ selectedClientId, selectedRunIds, onRunSelect }: RunFilterBarProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [stagedRunIds, setStagedRunIds] = React.useState<string[]>(selectedRunIds);

  // Fetch lightweight run metadata
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

  const completedRuns = runs.filter(run => run.status === 'done');

  // Sync staged state when popover opens
  React.useEffect(() => {
    if (isOpen) {
      setStagedRunIds(selectedRunIds);
    }
  }, [isOpen, selectedRunIds]);

  const handleToggleRun = (runId: string) => {
    if (stagedRunIds.includes(runId)) {
      setStagedRunIds(stagedRunIds.filter(id => id !== runId));
    } else {
      setStagedRunIds([...stagedRunIds, runId]);
    }
  };

  const handleApply = () => {
    onRunSelect(stagedRunIds);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setStagedRunIds(selectedRunIds); // Reset to current selection
    setIsOpen(false);
  };

  const handleClearFilter = () => {
    onRunSelect([]);
    setStagedRunIds([]); // Also clear staged selection
    setIsOpen(false);
  };

  const handleSelectAll = () => {
    setStagedRunIds(completedRuns.map(run => run.id));
  };

  const handleClearSelection = () => {
    setStagedRunIds([]);
  };

  if (isLoading) {
    return (
      <div className="mb-6 p-4 bg-muted/30 rounded-lg border">
        <div className="loading-skeleton h-10 w-full max-w-md rounded" data-testid="filter-loading"></div>
      </div>
    );
  }

  if (completedRuns.length === 0) {
    return null; // Don't show filter if no completed runs
  }

  const getDisplayText = () => {
    if (selectedRunIds.length === 0) {
      return "Latest run (default)";
    } else if (selectedRunIds.length === 1) {
      const run = completedRuns.find(r => r.id === selectedRunIds[0]);
      return run ? run.name : "1 run selected";
    } else {
      return `${selectedRunIds.length} runs selected`;
    }
  };

  return (
    <div className="p-2.5 bg-muted/30 rounded-lg border" data-testid="run-filter-bar">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>View Dashboard For:</span>
        </div>
        
        <div className="flex flex-1 flex-col sm:flex-row gap-2 w-full">
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between bg-background h-9 text-sm"
                data-testid="select-runs"
              >
                <span className="truncate">{getDisplayText()}</span>
                {selectedRunIds.length > 0 && (
                  <Badge variant="secondary" className="ml-2 rounded-full">
                    {selectedRunIds.length}
                  </Badge>
                )}
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
              <div className="border-b p-3 flex items-center justify-between">
                <span className="text-sm font-medium">Select Prompt Runs</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAll}
                    className="h-7 text-xs"
                    data-testid="button-select-all"
                  >
                    Select All
                  </Button>
                  {stagedRunIds.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearSelection}
                      className="h-7 text-xs"
                      data-testid="button-clear-selection"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <div className="max-h-[300px] overflow-y-auto p-2">
                {completedRuns.map((run, index) => (
                  <div
                    key={run.id}
                    className="flex items-center space-x-2 rounded-sm px-2 py-2 hover:bg-accent cursor-pointer"
                    onClick={() => handleToggleRun(run.id)}
                    data-testid={`checkbox-run-${run.id}`}
                  >
                    <Checkbox
                      checked={stagedRunIds.includes(run.id)}
                      onCheckedChange={() => handleToggleRun(run.id)}
                    />
                    <div className="flex-1 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          #{completedRuns.length - index}
                        </span>
                        <span className="text-sm font-medium">{run.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(run.createdAt), 'MMM d, yyyy')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t p-3 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleApply}
                  data-testid="button-apply"
                >
                  Apply {stagedRunIds.length > 0 && `(${stagedRunIds.length})`}
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {selectedRunIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilter}
              className="w-full sm:w-auto h-9 text-sm"
              data-testid="button-reset-filter"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-2" />
              Reset to Latest
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
