import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { AlertCircle, Eye, FileText, Bot, Sparkles } from "lucide-react";

interface CategoryStat {
  category: string;
  total: number;
  high: number;
  medium: number;
  low: number;
}

interface CategoryDashboardTilesProps {
  clientId: string;
  onTileClick: (category: string) => void;
  selectedCategory?: string;
  promptRunId?: string;
}

const CATEGORY_CONFIG = {
  "AI Crawling": {
    icon: Bot,
    color: "from-blue-500 to-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
  "Content Availability": {
    icon: FileText,
    color: "from-purple-500 to-purple-600",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-800",
  },
  "Content Eligibility": {
    icon: AlertCircle,
    color: "from-orange-500 to-orange-600",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    borderColor: "border-orange-200 dark:border-orange-800",
  },
  "Content Relevance": {
    icon: Sparkles,
    color: "from-green-500 to-green-600",
    bgColor: "bg-green-50 dark:bg-green-950/30",
    borderColor: "border-green-200 dark:border-green-800",
  },
  "Content Visibility": {
    icon: Eye,
    color: "from-indigo-500 to-indigo-600",
    bgColor: "bg-indigo-50 dark:bg-indigo-950/30",
    borderColor: "border-indigo-200 dark:border-indigo-800",
  },
} as const;

export default function CategoryDashboardTiles({
  clientId,
  onTileClick,
  selectedCategory,
  promptRunId,
}: CategoryDashboardTilesProps) {
  const { data: stats = [], isLoading } = useQuery<CategoryStat[]>({
    queryKey: ["/api/v1/opportunities/recommendations/stats", clientId, promptRunId],
    enabled: !!clientId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (promptRunId) params.set('promptRunId', promptRunId);
      const url = `/api/v1/opportunities/recommendations/stats${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url, {
        headers: clientId ? { "X-Client-Id": clientId } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        {[...Array(5)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <div className="p-6 space-y-4">
              <div className="h-6 bg-muted rounded w-3/4" />
              <div className="h-10 bg-muted rounded w-1/2" />
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded" />
                <div className="h-4 bg-muted rounded" />
                <div className="h-4 bg-muted rounded" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // Ensure all categories are present (even with 0 count)
  const allCategories = Object.keys(CATEGORY_CONFIG);
  const statsMap = new Map(stats.map((s: CategoryStat) => [s.category, s]));
  const completeStats: CategoryStat[] = allCategories.map(category => 
    statsMap.get(category) || { category, total: 0, high: 0, medium: 0, low: 0 }
  );

  return (
    <div className="mb-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-foreground">
          Strategic Insights
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Click a category to view detailed recommendations
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {completeStats.map((stat) => {
          const config = CATEGORY_CONFIG[stat.category as keyof typeof CATEGORY_CONFIG];
          const Icon = config.icon;
          const isSelected = selectedCategory === stat.category;

          return (
            <Card
              key={stat.category}
              className={`
                group cursor-pointer transition-all duration-200 border-2
                ${isSelected 
                  ? `${config.borderColor} ring-2 ring-offset-2 ring-offset-background` 
                  : 'border-muted-foreground/20 hover:border-muted-foreground/40'
                }
                hover:shadow-lg hover:-translate-y-0.5
              `}
              onClick={() => onTileClick(stat.category)}
              data-testid={`tile-category-${stat.category.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="p-5 rounded-lg">
                {/* Header with Icon and Total */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 leading-tight">
                      {stat.category}
                    </h3>
                    <div className="text-3xl font-bold text-gray-900 dark:text-foreground">
                      {stat.total}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg border-2 border-gray-200 dark:border-gray-700 shrink-0">
                    <Icon className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                  </div>
                </div>

                {/* Severity Breakdown */}
                <div className="space-y-1.5 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-gray-600 dark:text-gray-400">High</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-foreground" data-testid={`count-high-${stat.category.toLowerCase().replace(/\s+/g, '-')}`}>
                      {stat.high}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-yellow-500" />
                      <span className="text-gray-600 dark:text-gray-400">Medium</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-foreground" data-testid={`count-medium-${stat.category.toLowerCase().replace(/\s+/g, '-')}`}>
                      {stat.medium}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-gray-600 dark:text-gray-400">Low</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-foreground" data-testid={`count-low-${stat.category.toLowerCase().replace(/\s+/g, '-')}`}>
                      {stat.low}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
