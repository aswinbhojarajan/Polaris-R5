import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface ScoreExplanationData {
  score: number;
  interpretation: string;
  colorClass: string;
  colorHex: string;
  factors: {
    // Position
    totalRankings?: number;
    bestPosition?: number | null;
    averagePosition?: number | null;
    // Sentiment
    positiveMentions?: number;
    neutralMentions?: number;
    negativeMentions?: number;
    // Visibility
    mentionsCount?: number;
    headingHitsCount?: number;
  };
}

interface ScoreExplainabilityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptRunId: string | null;
  promptId?: string | null;
  category: 'Visibility' | 'Sentiment' | 'Position' | null;
}

export function ScoreExplainabilityModal({
  open,
  onOpenChange,
  promptRunId,
  promptId,
  category
}: ScoreExplainabilityModalProps) {
  const { data, isLoading, error } = useQuery<ScoreExplanationData>({
    queryKey: ['/api/v1/prompt-runs', promptRunId, 'score-explanation', category, promptId],
    queryFn: async () => {
      const url = promptId 
        ? `/api/v1/prompt-runs/${promptRunId}/score-explanation/${category}?promptId=${promptId}`
        : `/api/v1/prompt-runs/${promptRunId}/score-explanation/${category}`;
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch score explanation');
      }
      return response.json();
    },
    enabled: open && !!promptRunId && !!category
  });

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'Visibility':
        return '👁️';
      case 'Sentiment':
        return '💭';
      case 'Position':
        return '📊';
      default:
        return '';
    }
  };

  const getMetricDescription = () => {
    switch (category) {
      case 'Visibility':
        return 'Visibility measures how frequently your brand appears in AI-generated responses. A higher score indicates stronger brand presence and recall across AI models, with mentions appearing in both content body and prominent heading positions.';
      case 'Sentiment':
        return 'Sentiment evaluates the tone and context of brand mentions in AI responses. This score reflects whether your brand is portrayed positively, neutrally, or negatively, helping you understand how AI models perceive and communicate about your brand.';
      case 'Position':
        return 'Position tracks your brand\'s ranking in AI-generated lists and recommendations. A higher score means your brand consistently appears in top positions when AI models provide comparative recommendations or rankings.';
      default:
        return '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
                        <span>{category} Score Explanation</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : 'Failed to load score explanation'}
              </p>
            </div>
          )}

          {data && (
            <>
              {/* Score Badge */}
              <div className="flex items-center justify-center">
                <div 
                  className="inline-flex flex-col items-center justify-center rounded-xl border-2 px-8 py-6"
                  style={{ 
                    borderColor: data.colorHex,
                    backgroundColor: `${data.colorHex}15`
                  }}
                >
                  <span className="text-4xl font-bold" style={{ color: data.colorHex }}>
                    {data.score.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">out of 100</span>
                </div>
              </div>

              {/* What This Means - Hardcoded Description */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground">What This Means</h4>
                <p className="text-sm leading-relaxed bg-muted/30 border border-border rounded-lg p-4">
                  {getMetricDescription()}
                </p>
              </div>

              {/* Interpretation - Templated Message */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground">Interpretation</h4>
                <p className="text-sm leading-relaxed bg-muted/30 border border-border rounded-lg p-4">
                  {data.interpretation}
                </p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
