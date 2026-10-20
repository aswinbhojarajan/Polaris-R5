import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Job } from "@shared/schema";

interface MetadataProgressOverlayProps {
  jobId: string;
  onComplete: () => void;
}

const MIN_POLL_INTERVAL = 3000; // Start at 3 seconds
const MAX_POLL_INTERVAL = 10000; // Max 10 seconds
const BACKOFF_MULTIPLIER = 1.5; // Increase by 50% each time if no progress

export function MetadataProgressOverlay({ jobId, onComplete }: MetadataProgressOverlayProps) {
  const [, setLocation] = useLocation();
  const [hasCompleted, setHasCompleted] = useState(false);
  const [pollInterval, setPollInterval] = useState(MIN_POLL_INTERVAL);
  const lastProgressRef = useRef<number>(0);
  const sameProgressCountRef = useRef<number>(0);

  const { data: job } = useQuery<Job>({
    queryKey: ['/api/v1/jobs', jobId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/jobs/${jobId}`);
      if (!response.ok) throw new Error('Failed to fetch job status');
      return response.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling if job is done, error, or cancelled
      if (status === 'done' || status === 'error' || status === 'cancelled') {
        return false;
      }
      return pollInterval;
    },
    enabled: !!jobId && !hasCompleted,
  });

  // Implement exponential backoff when progress is stale
  useEffect(() => {
    const currentProgress = job?.progress ?? 0;
    if (job?.progress !== undefined && job?.progress !== null) {
      if (currentProgress === lastProgressRef.current) {
        sameProgressCountRef.current++;
        // After 3 polls with no progress, start backing off
        if (sameProgressCountRef.current >= 3) {
          setPollInterval((prev) => Math.min(prev * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL));
        }
      } else {
        // Progress changed - reset to fast polling
        lastProgressRef.current = currentProgress;
        sameProgressCountRef.current = 0;
        setPollInterval(MIN_POLL_INTERVAL);
      }
    }
  }, [job?.progress]);

  useEffect(() => {
    if (job?.status === 'done' && !hasCompleted) {
      setHasCompleted(true);
      // Wait 1 second to show 100% completion, then redirect
      setTimeout(() => {
        onComplete();
        setLocation('/app/topics-keywords');
      }, 1000);
    }
  }, [job?.status, hasCompleted, onComplete, setLocation]);

  const progress = job?.progress || 0;
  const status = job?.status || 'queued';

  const isErrorState = status === 'error' || status === 'cancelled';

  const getStatusMessage = () => {
    if (status === 'done') return 'Metadata generation complete!';
    if (status === 'error') return 'Error generating metadata';
    if (status === 'cancelled') return 'Job was cancelled';
    if (status === 'running') {
      if (progress < 20) return 'Initializing...';
      if (progress < 60) return 'Analyzing website with AI...';
      if (progress < 70) return 'Processing response...';
      if (progress < 90) return 'Saving topics and keywords...';
      return 'Finalizing...';
    }
    return 'Starting metadata generation...';
  };

  const getTitle = () => {
    if (status === 'done') return 'Complete!';
    if (isErrorState) return 'Failed';
    return 'Generating Metadata';
  };

  const handleDismiss = () => {
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-500/30 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white dark:bg-card border border-border rounded-lg p-8 max-w-md w-full mx-4 shadow-xl">
        <div className="text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            {status === 'done' ? (
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            ) : isErrorState ? (
              <XCircle className="h-12 w-12 text-destructive" />
            ) : (
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
            )}
          </div>

          {/* Title */}
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-foreground">
              {getTitle()}
            </h2>
            <p className="text-gray-600 dark:text-muted-foreground mt-2">
              {getStatusMessage()}
            </p>
          </div>

          {/* Progress Bar - only show when not in error state */}
          {!isErrorState && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" data-testid="progress-bar" />
              <p className="text-sm text-gray-600 dark:text-muted-foreground">{progress}%</p>
            </div>
          )}

          {/* Error Message */}
          {isErrorState && job?.error && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{job.error}</p>
            </div>
          )}

          {/* Dismiss button for error states */}
          {isErrorState && (
            <Button 
              onClick={handleDismiss}
              variant="outline"
              data-testid="button-dismiss-error"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
