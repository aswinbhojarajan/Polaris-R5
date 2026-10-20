export function normalizeIndustry(industry: string | null | undefined): string | undefined {
  if (!industry) return undefined;
  return industry.trim().slice(0, 100);
}

export function normalizeGeographies(geography: string | string[] | null | undefined): string[] {
  if (!geography) return [];
  
  const arr = typeof geography === 'string' 
    ? geography.split(',').map(g => g.trim()) 
    : geography;
  
  return Array.from(new Set(arr))
    .filter(g => g.length > 0)
    .slice(0, 3)
    .map(g => g.slice(0, 100));
}

export function formatGeographyForPrompt(geographies: string[]): string {
  if (geographies.length === 0) return '';
  if (geographies.length === 1) return geographies[0];
  return geographies.join('/');
}
