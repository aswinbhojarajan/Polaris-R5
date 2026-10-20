/**
 * Task #114 — Card-shaped wrapper around `ErrorState` for use in
 * dashboard / list pages where the section already lives inside a Card.
 */
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "./ErrorState";

interface Props {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function RetryCard({ error, onRetry, title }: Props) {
  return (
    <Card data-testid="retry-card">
      <CardContent className="pt-6">
        <ErrorState error={error} onRetry={onRetry} title={title} />
      </CardContent>
    </Card>
  );
}
