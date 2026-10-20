import * as cheerio from 'cheerio';

export interface Heading {
  level: number;
  text: string;
  position: number;
}

export interface Paragraph {
  text: string;
  wordCount: number;
}

export interface List {
  type: 'ul' | 'ol';
  items: string[];
}

export interface Table {
  headers: string[];
  rowCount: number;
}

export interface LinkCounts {
  internal: number;
  external: number;
  total: number;
}

export interface PageStructure {
  headings: Heading[];
  paragraphs: Paragraph[];
  lists: List[];
  tables: Table[];
  linkCounts: LinkCounts;
}

/**
 * Parse HTML content to extract structured elements
 */
export function parsePageStructure(html: string, baseUrl?: string): PageStructure {
  const $ = cheerio.load(html);
  
  // Extract headings (H1-H6)
  const headings: Heading[] = [];
  $('h1, h2, h3, h4, h5, h6').each((index, element) => {
    const $el = $(element);
    const tagName = element.tagName.toLowerCase();
    const level = parseInt(tagName.charAt(1));
    const text = $el.text().trim();
    
    if (text) {
      headings.push({
        level,
        text: text.substring(0, 500), // Limit to 500 chars
        position: index
      });
    }
  });

  // Extract paragraphs
  const paragraphs: Paragraph[] = [];
  $('p').each((_, element) => {
    const text = $(element).text().trim();
    if (text && text.length > 20) { // Skip very short paragraphs
      const wordCount = text.split(/\s+/).length;
      paragraphs.push({
        text: text.substring(0, 1000), // Limit to 1000 chars
        wordCount
      });
    }
  });

  // Extract lists
  const lists: List[] = [];
  $('ul, ol').each((_, element) => {
    const $el = $(element);
    const type = element.tagName.toLowerCase() as 'ul' | 'ol';
    const items: string[] = [];
    
    $el.children('li').each((_, li) => {
      const text = $(li).text().trim();
      if (text) {
        items.push(text.substring(0, 300)); // Limit item length
      }
    });
    
    if (items.length > 0) {
      lists.push({ type, items: items.slice(0, 50) }); // Max 50 items per list
    }
  });

  // Extract tables
  const tables: Table[] = [];
  $('table').each((_, element) => {
    const $table = $(element);
    const headers: string[] = [];
    
    // Extract headers
    $table.find('thead th, thead td').each((_, th) => {
      const text = $(th).text().trim();
      if (text) {
        headers.push(text.substring(0, 200));
      }
    });
    
    // Count rows
    const rowCount = $table.find('tbody tr').length || $table.find('tr').length;
    
    if (headers.length > 0 || rowCount > 0) {
      tables.push({
        headers: headers.slice(0, 20), // Max 20 headers
        rowCount
      });
    }
  });

  // Count links
  const linkCounts: LinkCounts = {
    internal: 0,
    external: 0,
    total: 0
  };

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      linkCounts.total++;
      
      // Determine if internal or external
      if (baseUrl) {
        try {
          const linkUrl = new URL(href, baseUrl);
          const baseHostname = new URL(baseUrl).hostname;
          
          if (linkUrl.hostname === baseHostname) {
            linkCounts.internal++;
          } else {
            linkCounts.external++;
          }
        } catch {
          // Relative links or malformed URLs count as internal
          if (!href.startsWith('http')) {
            linkCounts.internal++;
          }
        }
      } else {
        // Without baseUrl, guess based on href format
        if (href.startsWith('http') || href.startsWith('//')) {
          linkCounts.external++;
        } else {
          linkCounts.internal++;
        }
      }
    }
  });

  return {
    headings,
    paragraphs,
    lists,
    tables,
    linkCounts
  };
}

/**
 * Calculate total word count from page structure
 */
export function calculateTotalWordCount(structure: PageStructure): number {
  let total = 0;
  
  // Headings
  for (const heading of structure.headings) {
    total += heading.text.split(/\s+/).length;
  }
  
  // Paragraphs
  for (const paragraph of structure.paragraphs) {
    total += paragraph.wordCount;
  }
  
  // Lists
  for (const list of structure.lists) {
    for (const item of list.items) {
      total += item.split(/\s+/).length;
    }
  }
  
  return total;
}

/**
 * Extract plain text content from page structure
 */
export function extractPlainText(structure: PageStructure): string {
  const parts: string[] = [];
  
  // Headings
  for (const heading of structure.headings) {
    parts.push(heading.text);
  }
  
  // Paragraphs
  for (const paragraph of structure.paragraphs) {
    parts.push(paragraph.text);
  }
  
  // Lists
  for (const list of structure.lists) {
    parts.push(...list.items);
  }
  
  return parts.join(' ');
}
