export interface Citation {
  url?: string;
  domain?: string;
  displayText?: string;
  position: number;
  type: 'hard' | 'soft';
  anchorText?: string;
  isSelfCitation?: boolean;
}

/**
 * Validates if a citation URL belongs to the client
 */
function isSelfCitation(citationUrl: string, clientUrls: string[]): boolean {
  if (!citationUrl || clientUrls.length === 0) return false;
  
  try {
    const citationDomain = normalizeToRootDomain(new URL(citationUrl).hostname);
    
    for (const clientUrl of clientUrls) {
      try {
        const clientDomain = normalizeToRootDomain(new URL(clientUrl).hostname);
        if (citationDomain === clientDomain) {
          return true;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return false;
  }
  
  return false;
}

export function extractCitations(rawResponse: string, clientUrls: string[] = []): Citation[] {
  const citations: Citation[] = [];
  let position = 0;
  
  // Track seen URLs/domains to prevent duplicates
  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();
  const seenSources = new Set<string>();

  // Extract hard citations (URLs)
  // Regex allows parentheses in URLs (for Wikipedia, etc.) but we clean unbalanced ones later
  const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_\+.~#?&/=]*/g;
  let urlMatch;
  
  while ((urlMatch = urlRegex.exec(rawResponse)) !== null) {
    let url = urlMatch[0];
    
    // Clean trailing punctuation that's commonly used after URLs in text
    // Remove trailing . , : ; ! ? if they appear at the end
    url = url.replace(/[.,;:!?]+$/, '');
    
    // Handle unbalanced parentheses (e.g., from markdown links [text](url))
    // Count opening and closing parentheses in the URL
    const openParens = (url.match(/\(/g) || []).length;
    const closeParens = (url.match(/\)/g) || []).length;
    
    // If there are more closing parens than opening, remove the extras from the end
    // This handles: [text](https://example.com) -> https://example.com
    // But preserves: https://en.wikipedia.org/wiki/AI_(computing)
    if (closeParens > openParens) {
      const extraClosing = closeParens - openParens;
      for (let i = 0; i < extraClosing; i++) {
        url = url.replace(/\)(?=[^\)]*$)/, ''); // Remove last closing paren
      }
    }
    
    // Final cleanup: remove any trailing punctuation again
    url = url.replace(/[.,;:!?]+$/, '');
    
    // Normalize URL: remove trailing slash from URLs (except for root paths)
    // https://example.com/ → https://example.com
    // https://example.com/page/ → https://example.com/page
    url = normalizeUrl(url);
    
    // Skip duplicate URLs (case-insensitive comparison)
    const urlKey = url.toLowerCase();
    if (seenUrls.has(urlKey)) {
      continue;
    }
    seenUrls.add(urlKey);
    
    const domain = extractDomain(url);
    const selfCitation = isSelfCitation(url, clientUrls);
    
    citations.push({
      url,
      domain,
      position: position++,
      type: 'hard',
      anchorText: url,
      isSelfCitation: selfCitation
    });
  }

  // Extract soft citations (domain names without URLs)
  const domainRegex = /\b(?:according to|from|via|source:|per)\s+([a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|io|ai))\b/gi;
  let domainMatch;
  
  while ((domainMatch = domainRegex.exec(rawResponse)) !== null) {
    const domain = domainMatch[1].toLowerCase();
    
    // Skip duplicate domains
    if (seenDomains.has(domain)) {
      continue;
    }
    seenDomains.add(domain);
    
    citations.push({
      domain,
      position: position++,
      type: 'soft',
      displayText: domainMatch[0]
    });
  }

  // Extract named source citations
  const namedSourceRegex = /\b(?:according to|from|via|reports)\s+([A-Z][a-zA-Z\s&]+(?:Inc|Corp|LLC|Company|Institute|Foundation|News|Times|Post|Report))\b/g;
  let namedMatch;
  
  while ((namedMatch = namedSourceRegex.exec(rawResponse)) !== null) {
    const sourceName = namedMatch[1].trim();
    const sourceKey = sourceName.toLowerCase();
    
    // Skip duplicate named sources
    if (seenSources.has(sourceKey)) {
      continue;
    }
    seenSources.add(sourceKey);
    
    citations.push({
      displayText: sourceName,
      position: position++,
      type: 'soft',
      anchorText: namedMatch[0]
    });
  }

  return citations;
}

/**
 * Normalizes a URL by removing trailing slashes
 * Examples:
 *   - https://example.com/ → https://example.com
 *   - https://example.com/page/ → https://example.com/page
 *   - https://example.com → https://example.com (no change)
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash from pathname (unless it's just "/")
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    // If pathname is just "/", remove it for cleaner URLs
    if (urlObj.pathname === '/' && !urlObj.search && !urlObj.hash) {
      return `${urlObj.protocol}//${urlObj.host}`;
    }
    return urlObj.toString();
  } catch {
    return url; // Return original if parsing fails
  }
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    // Preserve www subdomain - don't strip it
    const hostname = urlObj.hostname;
    return normalizeToRootDomain(hostname);
  } catch {
    return '';
  }
}

/**
 * Normalizes a domain to its root/registrable domain
 * Examples:
 *   - blog.example.com → example.com
 *   - docs.stripe.com → stripe.com
 *   - www.example.com → example.com (strips www)
 *   - example.co.uk → example.co.uk (preserves multi-part TLDs)
 *   - example.com → example.com
 */
export function normalizeToRootDomain(domain: string): string {
  if (!domain) return '';
  
  // First, remove www subdomain
  let cleanDomain = domain.toLowerCase();
  if (cleanDomain.startsWith('www.')) {
    cleanDomain = cleanDomain.substring(4);
  }
  
  const parts = cleanDomain.split('.');
  
  // If it's already a root domain (2 parts or less), return as-is
  if (parts.length <= 2) {
    return cleanDomain;
  }
  
  // Check for multi-part TLDs (co.uk, com.au, com.qa, etc.)
  const lastTwo = parts.slice(-2).join('.');
  const multiPartTLDs = [
    // UK and Commonwealth
    'co.uk', 'co.nz', 'co.za', 'co.in', 'co.jp', 
    'ac.uk', 'gov.uk', 'org.uk',
    // Americas
    'com.au', 'com.br', 'com.cn', 'com.mx',
    // Middle East
    'com.qa', 'com.sa', 'com.ae', 'com.kw', 'com.bh', 'com.om',
    'co.ae', 'co.sa',
    // Asia Pacific
    'com.my', 'com.sg', 'com.hk', 'com.tw', 'com.ph', 'com.vn',
    'co.id', 'co.th', 'co.kr',
    // Others
    'com.eg', 'com.pk', 'com.bd', 'com.np'
  ];
  
  if (multiPartTLDs.includes(lastTwo)) {
    // Return last 3 parts (example.co.uk)
    return parts.slice(-3).join('.');
  }
  
  // Default: return last 2 parts (example.com)
  return parts.slice(-2).join('.');
}

/**
 * Extracts brand domain for grouping multi-country domains
 * Examples:
 *   - alrajhibank.com.my → alrajhibank
 *   - alrajhibank.com.sa → alrajhibank  
 *   - qib.com.qa → qib
 *   - example.com → example.com (no grouping needed)
 */
export function extractBrandDomain(domain: string): string {
  if (!domain) return '';
  
  const parts = domain.split('.');
  
  // Check if it has a multi-part country TLD
  const lastTwo = parts.slice(-2).join('.');
  const countryTLDs = [
    // UK and Commonwealth
    'co.uk', 'co.nz', 'co.za', 'co.in', 'co.jp', 
    'ac.uk', 'gov.uk', 'org.uk',
    // Americas
    'com.au', 'com.br', 'com.cn', 'com.mx',
    // Middle East
    'com.qa', 'com.sa', 'com.ae', 'com.kw', 'com.bh', 'com.om',
    'co.ae', 'co.sa',
    // Asia Pacific
    'com.my', 'com.sg', 'com.hk', 'com.tw', 'com.ph', 'com.vn',
    'co.id', 'co.th', 'co.kr',
    // Others
    'com.eg', 'com.pk', 'com.bd', 'com.np'
  ];
  
  if (countryTLDs.includes(lastTwo) && parts.length >= 3) {
    // Extract brand name (part before country TLD)
    return parts.slice(-3, -2)[0];
  }
  
  // Not a multi-country domain, return as-is
  return domain;
}
