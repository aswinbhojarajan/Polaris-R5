import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Topic } from "@shared/schema";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";

export default function MetadataTopTopics() {
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;

  const { data: topics = [], isLoading } = useQuery<Topic[]>({
    queryKey: ['/api/v1/topics', selectedClientId],
    enabled: !!selectedClientId,
  });

  const topicsByCategory = topics.reduce((acc, topic) => {
    const category = topic.category || "Uncategorized";
    if (!acc[category]) acc[category] = [];
    acc[category].push(topic);
    return acc;
  }, {} as Record<string, Topic[]>);

  const topCategories = Object.entries(topicsByCategory)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 10);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading top topics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Top 10 Topics Summary</h1>
        <p className="text-muted-foreground mt-1">
          Summarized view of the most prominent topic categories
        </p>
      </div>

      <div className="grid gap-4">
        {topCategories.map(([category, categoryTopics], index) => (
          <Card key={category} data-testid={`card-top-category-${index}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">
                  {index + 1}. {category}
                </CardTitle>
                <Badge variant="secondary" data-testid={`badge-count-${index}`}>
                  {categoryTopics.length} topics
                </Badge>
              </div>
              <CardDescription>
                Key topics and keywords in this category
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {categoryTopics.slice(0, 5).map((topic) => (
                  <Badge 
                    key={topic.id} 
                    variant="outline" 
                    className="px-3 py-1"
                    data-testid={`badge-topic-${topic.id}`}
                  >
                    {topic.label}
                  </Badge>
                ))}
                {categoryTopics.length > 5 && (
                  <Badge variant="outline" className="px-3 py-1 text-muted-foreground">
                    +{categoryTopics.length - 5} more
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {topCategories.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No topics available. Add topics in the Topics & Keywords section.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
