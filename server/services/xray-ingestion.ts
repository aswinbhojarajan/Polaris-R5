import type { IStorage } from '../storage';
import type { InsertXRaySite, InsertXRayPage } from '@shared/schema';

interface CrawledPage {
  url: string;
  title: string;
  content: string;
  pageType: 'homepage' | 'about' | 'features' | 'pricing' | 'products' | 'services' | 'solutions' | 'other';
}

interface CrawledWebsiteContent {
  pages: CrawledPage[];
  totalPages: number;
  crawlMethod: 'cheerio' | 'playwright' | 'failed';
  error?: string;
}

interface IngestionResult {
  success: boolean;
  sitesCreated: number;
  pagesIngested: number;
  errors: string[];
}

/**
 * Maps crawler page types to X-Ray page types
 */
function mapPageType(crawlerType: CrawledPage['pageType']): InsertXRayPage['pageType'] {
  const mapping: Record<CrawledPage['pageType'], InsertXRayPage['pageType']> = {
    'homepage': 'home',
    'about': 'about',
    'features': 'product',
    'pricing': 'pricing',
    'products': 'product',
    'services': 'service',
    'solutions': 'service',
    'other': 'other'
  };
  
  return mapping[crawlerType] || 'other';
}

/**
 * Extracts root domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Calculates word count from text content
 */
function calculateWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Ingests crawled website data into X-Ray tables
 */
export async function ingestCrawlResults(
  storage: IStorage,
  clientId: string,
  crawlData: CrawledWebsiteContent,
  siteType: InsertXRaySite['siteType'] = 'internal'
): Promise<IngestionResult> {
  const result: IngestionResult = {
    success: true,
    sitesCreated: 0,
    pagesIngested: 0,
    errors: []
  };

  // Handle failed crawls
  if (crawlData.crawlMethod === 'failed' || crawlData.pages.length === 0) {
    result.success = false;
    result.errors.push(crawlData.error || 'Crawl failed with no pages');
    return result;
  }

  try {
    // Group pages by domain
    const pagesByDomain = new Map<string, CrawledPage[]>();
    
    for (const page of crawlData.pages) {
      const domain = extractDomain(page.url);
      if (!domain) {
        result.errors.push(`Invalid URL: ${page.url}`);
        continue;
      }
      
      if (!pagesByDomain.has(domain)) {
        pagesByDomain.set(domain, []);
      }
      pagesByDomain.get(domain)!.push(page);
    }

    // Process each domain
    for (const [domain, pages] of Array.from(pagesByDomain.entries())) {
      try {
        // Get or create site record (upsert logic)
        const existingSites = await storage.getXRaySitesByClient(clientId);
        let site = existingSites.find(s => s.domain === domain);
        
        if (!site) {
          const siteData: InsertXRaySite = {
            clientId,
            domain,
            siteType,
            robotsTxtPresent: false,
            aiTxtPresent: false,
            crawlAccessStatus: 'ok',
            robotsRules: null,
            aiTxtContent: null,
            crawlEvidence: null
          };
          site = await storage.createXRaySite(siteData);
          result.sitesCreated++;
          console.log(`Created new X-Ray site for domain: ${domain}`);
        } else {
          // Reset health probe data when reusing existing site to prevent stale cache
          await storage.resetHealthProbeData(site.id);
          console.log(`Reusing existing X-Ray site for domain: ${domain} (health probe reset, pages will accumulate)`);
        }

        // Ingest all pages for this site
        for (const page of pages) {
          try {
            const wordCount = calculateWordCount(page.content);
            
            const pageData: InsertXRayPage = {
              siteId: site.id,
              url: page.url,
              title: page.title || 'Untitled',
              pageType: mapPageType(page.pageType),
              rawHtml: null, // We don't have raw HTML from current crawler
              rawText: page.content,
              wordCount,
              statusCode: 200, // Crawler only returns successful pages
              lastModified: null
            };

            await storage.createXRayPage(pageData);
            result.pagesIngested++;
          } catch (pageError) {
            const errorMsg = `Failed to ingest page ${page.url}: ${pageError instanceof Error ? pageError.message : String(pageError)}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
          }
        }
      } catch (siteError) {
        const errorMsg = `Failed to process domain ${domain}: ${siteError instanceof Error ? siteError.message : String(siteError)}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    console.log(`X-Ray ingestion complete: ${result.sitesCreated} sites, ${result.pagesIngested} pages`);
    
  } catch (error) {
    result.success = false;
    const errorMsg = `X-Ray ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMsg);
    result.errors.push(errorMsg);
  }

  return result;
}
