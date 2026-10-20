export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function sigmoid(x: number, k: number = 1, x0: number = 0): number {
  return 1 / (1 + Math.exp(-k * (x - x0)));
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface Heading {
  text: string;
  level: number;
  position: number;
}

export function extractHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  
  const markdownPattern = /^(#{1,6})\s+(.+)$/gm;
  let match;
  
  while ((match = markdownPattern.exec(text)) !== null) {
    headings.push({
      text: match[2].trim(),
      level: match[1].length,
      position: match.index,
    });
  }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i].trim();
    const nextLine = lines[i + 1].trim();
    
    if (currentLine.length > 0) {
      if (/^=+$/.test(nextLine) && nextLine.length >= 3) {
        const position = text.indexOf(currentLine, i > 0 ? lines.slice(0, i).join('\n').length : 0);
        headings.push({
          text: currentLine,
          level: 1,
          position,
        });
      } else if (/^-+$/.test(nextLine) && nextLine.length >= 3) {
        const position = text.indexOf(currentLine, i > 0 ? lines.slice(0, i).join('\n').length : 0);
        headings.push({
          text: currentLine,
          level: 2,
          position,
        });
      }
    }
  }

  return headings.sort((a, b) => a.position - b.position);
}

export interface ListItem {
  text: string;
  type: 'numbered' | 'bulleted';
  position: number;
  number?: number;
}

export function extractLists(text: string): ListItem[] {
  const items: ListItem[] = [];

  const numberedPattern = /^(\d+)[.)]\s+(.+)$/gm;
  let match;
  
  while ((match = numberedPattern.exec(text)) !== null) {
    items.push({
      text: match[2].trim(),
      type: 'numbered',
      position: match.index,
      number: parseInt(match[1], 10),
    });
  }

  const bulletPattern = /^[-*•]\s+(.+)$/gm;
  
  while ((match = bulletPattern.exec(text)) !== null) {
    items.push({
      text: match[1].trim(),
      type: 'bulleted',
      position: match.index,
    });
  }

  return items.sort((a, b) => a.position - b.position);
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncateText(text: string, maxLength: number, ellipsis: string = '...'): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

export function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
