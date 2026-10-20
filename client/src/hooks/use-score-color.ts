import { useQuery } from "@tanstack/react-query";

interface ColorBand {
  category: string;
  minScore: number;
  maxScore: number;
  color: string;
}

/**
 * Hook to get database-driven score colors for a specific category
 * @param category - The score category (Visibility, Sentiment, or Position)
 * @returns Object with getColor function and loading/error states
 */
export function useScoreColor(category: 'Visibility' | 'Sentiment' | 'Position') {
  const { data: colorBands, isLoading, error } = useQuery<ColorBand[]>({
    queryKey: ['/api/v1/score-colors', category],
    queryFn: async () => {
      const response = await fetch(`/api/v1/score-colors?category=${category}`);
      if (!response.ok) {
        throw new Error('Failed to fetch color bands');
      }
      return response.json();
    },
    staleTime: Infinity, // Color bands don't change often
    gcTime: 1000 * 60 * 60 // Cache for 1 hour
  });

  /**
   * Get the color for a specific score
   * @param score - The score value (0-100)
   * @returns Hex color string or default gray if not found
   */
  const getColor = (score: number): string => {
    if (!colorBands || !Array.isArray(colorBands) || colorBands.length === 0) {
      return '#6B7280'; // Default gray
    }

    const band = colorBands.find(
      (b: ColorBand) => score >= b.minScore && score <= b.maxScore
    );

    return band?.color || '#6B7280';
  };

  return {
    getColor,
    isLoading,
    error,
    colorBands
  };
}
