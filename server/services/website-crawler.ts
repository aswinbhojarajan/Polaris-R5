import { CheerioCrawler, PlaywrightCrawler, Configuration } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { getChromiumLaunchOptions, getStealthContextOptions, resetBrowserFingerprint } from '../utils/chromium-path';

// Initialize stealth plugin for playwright-extra
chromium.use(StealthPlugin());

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

const MAX_PAGES = 10;
const REQUEST_TIMEOUT = 30000;

function determinePageType(url: string): CrawledPage['pageType'] {
  const path = new URL(url).pathname.toLowerCase();
  
  if (path === '/' || path === '') return 'homepage';
  if (path.includes('about') || path.includes('who-we-are') || path.includes('our-story')) return 'about';
  if (path.includes('feature') || path.includes('capability')) return 'features';
  if (path.includes('pricing') || path.includes('plans')) return 'pricing';
  if (path.includes('product')) return 'products';
  if (path.includes('service')) return 'services';
  if (path.includes('solution')) return 'solutions';
  
  return 'other';
}

function extractCleanContent($: any, maxLength: number = 5000): string {
  $('script, style, nav, footer, header, iframe, noscript').remove();
  $('.nav, .navigation, .footer, .header, .sidebar, .menu, .cookie-banner, .popup').remove();
  
  const contentSelectors = ['main', 'article', '[role="main"]', '.main-content', '.content', '#content', 'body'];
  
  let content = '';
  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      content = element.text();
      break;
    }
  }
  
  if (!content) {
    content = $('body').text();
  }
  
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
  
  if (content.length > maxLength) {
    content = content.substring(0, maxLength) + '...';
  }
  
  return content;
}

function isRelevantUrl(url: string, baseUrl: string): boolean {
  try {
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);
    
    const urlDomain = urlObj.hostname.replace(/^www\./, '');
    const baseDomain = baseUrlObj.hostname.replace(/^www\./, '');
    
    // Allow exact domain match or subdomain (e.g., docs.example.com for example.com)
    const isExactMatch = urlDomain === baseDomain;
    const isSubdomain = urlDomain.endsWith('.' + baseDomain);
    
    if (!isExactMatch && !isSubdomain) {
      return false;
    }
    
    const path = urlObj.pathname.toLowerCase();
    
    // Exclude file extensions and non-content URLs
    const excludeExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.css', '.js', '.xml', '.json', '.zip', '.tar', '.gz'];
    if (excludeExtensions.some(ext => path.endsWith(ext))) {
      return false;
    }
    
    // Exclude common non-content paths
    const excludePatterns = [
      '/blog/', '/news/', '/press/', '/events/', '/careers/', '/jobs/',
      '/legal/', '/privacy/', '/terms/', '/cookie', '/login/', '/signin/', '/signup/', '/register/',
      '/contact/', '/support/', '/help/', '/faq/', '/download/', '/downloads/',
      '/cart/', '/checkout/', '/account/', '/profile/', '/search/', '/tag/', '/category/',
      '/wp-admin/', '/wp-content/', '/admin/'
    ];
    
    if (excludePatterns.some(pattern => path.includes(pattern))) {
      return false;
    }
    
    // Accept key content pages (use includes/startsWith for flexibility)
    const priorityKeywords = [
      'about', 'feature', 'pricing', 'price', 'plan', 'product', 'service', 
      'solution', 'capability', 'overview', 'technology', 'platform',
      'benefit', 'advantage', 'why', 'how-it-works', 'use-case'
    ];
    
    if (path === '/' || path === '' || path === '/index' || path === '/home') {
      return true;
    }
    
    if (priorityKeywords.some(keyword => path.includes(keyword))) {
      return true;
    }
    
    // Accept top-level pages (1-2 segments)
    const pathSegments = path.split('/').filter(s => s.length > 0);
    if (pathSegments.length <= 2) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

async function crawlWithCheerio(websiteUrl: string): Promise<CrawledWebsiteContent> {
  const pages: CrawledPage[] = [];
  const crawledUrls = new Set<string>();
  
  const crawlId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const storageDir = `./storage/crawl-${crawlId}`;
  
  console.log(`Starting Cheerio crawl for: ${websiteUrl} (storage: ${storageDir})`);
  
  const config = new Configuration({
    storageClientOptions: {
      localDataDirectory: storageDir,
    },
    purgeOnStart: false,
  });
  
  try {
    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl: MAX_PAGES,
      requestHandlerTimeoutSecs: REQUEST_TIMEOUT / 1000,
      maxConcurrency: 2,
      sessionPoolOptions: {
        persistStateKey: `SESSION_POOL_${crawlId}`,
        maxPoolSize: 10,
      },
      preNavigationHooks: [
        async ({ request }) => {
          request.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
            'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", "Not-A.Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
          };
        }
      ],
      async requestHandler({ request, $, enqueueLinks, response }) {
        const url = request.loadedUrl || request.url;
        
        // Skip if already crawled
        if (crawledUrls.has(url)) {
          return;
        }
        crawledUrls.add(url);
        
        console.log(`Crawling: ${url}`);
        
        // Validate $ is a valid Cheerio function (prevents bot detection crashes)
        if (!$ || typeof $ !== 'function') {
          console.warn(`⚠️  Bot protection detected for ${url} - Cheerio object invalid (likely blocked by anti-bot measures)`);
          return;
        }
        
        // Detect common bot blocking responses (use specific phrases to avoid false positives)
        const bodyText = $('body').text().toLowerCase();
        const botBlockingPhrases = [
          'you have been blocked',
          'you are blocked',
          'access denied',
          'bot detected',
          'please verify you are human',
          'security check required',
          'solve the captcha',
          'enable javascript and cookies',
          'this page requires javascript'
        ];
        
        if (botBlockingPhrases.some(phrase => bodyText.includes(phrase))) {
          console.warn(`⚠️  Bot protection detected for ${url} - response contains anti-bot challenge`);
          return;
        }
        
        // Extract page data
        const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
        const content = extractCleanContent($);
        const pageType = determinePageType(url);
        
        if (content && content.length > 100) {
          pages.push({
            url,
            title,
            content,
            pageType
          });
          
          console.log(`Extracted ${content.length} chars from ${pageType} page: ${title}`);
        }
        
        // Enqueue relevant links if we haven't hit the max
        if (pages.length < MAX_PAGES) {
          await enqueueLinks({
            globs: ['**'],
            transformRequestFunction: (req) => {
              if (!isRelevantUrl(req.url, websiteUrl)) {
                return false;
              }
              return req;
            }
          });
        }
        
        // Add human-like random delay between requests (300-800ms)
        await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
      },
      failedRequestHandler({ request, error }) {
        console.warn(`Cheerio failed to crawl ${request.url}:`, error instanceof Error ? error.message : String(error));
      }
    }, config);
    
    await crawler.run([websiteUrl]);
    
    console.log(`Cheerio crawl completed. Extracted ${pages.length} pages.`);
    
    return {
      pages,
      totalPages: pages.length,
      crawlMethod: 'cheerio'
    };
  } catch (error) {
    console.error('Cheerio crawl error:', error);
    throw error;
  } finally {
    await rm(storageDir, { recursive: true, force: true }).catch((err) => {
      console.warn(`Failed to clean up Cheerio storage directory ${storageDir}:`, err.message);
    });
  }
}

/**
 * Crawls a website using PlaywrightCrawler (browser automation - fallback)
 */
async function crawlWithPlaywright(websiteUrl: string): Promise<CrawledWebsiteContent> {
  const pages: CrawledPage[] = [];
  const crawledUrls = new Set<string>();
  
  const crawlId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const storageDir = `./storage/crawl-${crawlId}`;
  
  console.log(`Starting Playwright crawl for: ${websiteUrl} (storage: ${storageDir})`);
  
  const config = new Configuration({
    storageClientOptions: {
      localDataDirectory: storageDir,
    },
    purgeOnStart: false,
  });
  
  try {
    const stealthOptions = getStealthContextOptions();
    const launchOptions = getChromiumLaunchOptions();
    
    console.log(`[Playwright-Stealth] Using playwright-extra with stealth plugin. UA: ${stealthOptions.userAgent.substring(0, 60)}...`);
    
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: MAX_PAGES,
      requestHandlerTimeoutSecs: REQUEST_TIMEOUT / 1000,
      maxConcurrency: 1,
      minConcurrency: 1,
      navigationTimeoutSecs: 30,
      sessionPoolOptions: {
        persistStateKey: `SESSION_POOL_${crawlId}`,
        maxPoolSize: 1,
      },
      launchContext: {
        // Use playwright-extra with stealth plugin as the launcher
        launcher: chromium,
        launchOptions,
        userAgent: stealthOptions.userAgent,
      },
      browserPoolOptions: {
        useFingerprints: false,
        operationTimeoutSecs: 60,
      },
      preNavigationHooks: [
        async ({ page, request }) => {
          // Set custom headers and viewport (stealth plugin handles navigator overrides)
          await page.setExtraHTTPHeaders(stealthOptions.extraHTTPHeaders);
          await page.setViewportSize(stealthOptions.viewport);
          
          console.log(`[Playwright-Stealth] Navigating to: ${request.url}`);
        },
      ],
      async requestHandler({ request, page, enqueueLinks }) {
        const url = request.loadedUrl || request.url;
        
        const delay = 1000 + Math.random() * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Skip if already crawled
        if (crawledUrls.has(url)) {
          return;
        }
        crawledUrls.add(url);
        
        console.log(`Crawling with browser: ${url}`);
        
        // Wait for page to be fully loaded
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
          console.log('Network idle timeout, continuing anyway...');
        });
        
        // Extract page data
        const title = await page.title() || 'Untitled';
        const bodyHTML = await page.content();
        const $ = cheerio.load(bodyHTML);
        const content = extractCleanContent($);
        const pageType = determinePageType(url);
        
        if (content && content.length > 100) {
          pages.push({
            url,
            title,
            content,
            pageType
          });
          
          console.log(`Extracted ${content.length} chars from ${pageType} page: ${title}`);
        }
        
        // Enqueue relevant links if we haven't hit the max
        if (pages.length < MAX_PAGES) {
          await enqueueLinks({
            globs: ['**'],
            transformRequestFunction: (req) => {
              if (!isRelevantUrl(req.url, websiteUrl)) {
                return false;
              }
              return req;
            }
          });
        }
      },
      failedRequestHandler({ request, error }) {
        console.warn(`Playwright failed to crawl ${request.url}:`, error instanceof Error ? error.message : String(error));
      }
    }, config);
    
    await crawler.run([websiteUrl]);
    
    console.log(`Playwright crawl completed. Extracted ${pages.length} pages.`);
    
    return {
      pages,
      totalPages: pages.length,
      crawlMethod: 'playwright'
    };
  } catch (error) {
    console.error('Playwright crawl error:', error);
    throw error;
  } finally {
    await rm(storageDir, { recursive: true, force: true }).catch((err) => {
      console.warn(`Failed to clean up Playwright storage directory ${storageDir}:`, err.message);
    });
  }
}

/**
 * Main function to crawl a website with fallback logic
 * 1. Try CheerioCrawler (fast)
 * 2. Fallback to PlaywrightCrawler if Cheerio fails or gets no content
 * 3. Return error if both fail
 */
export async function crawlWebsite(websiteUrl: string): Promise<CrawledWebsiteContent> {
  console.log(`\n=== Starting website crawl: ${websiteUrl} ===`);
  
  resetBrowserFingerprint();
  
  // Validate URL
  try {
    new URL(websiteUrl);
  } catch {
    return {
      pages: [],
      totalPages: 0,
      crawlMethod: 'failed',
      error: 'Invalid URL provided'
    };
  }
  
  // Try CheerioCrawler first (fast)
  let cheerioResult: CrawledWebsiteContent | null = null;
  
  try {
    cheerioResult = await crawlWithCheerio(websiteUrl);
    
    // Accept result if we got multiple pages with good content
    if (cheerioResult.pages.length >= 3) {
      console.log(`✓ Cheerio crawl successful: ${cheerioResult.pages.length} pages extracted`);
      return cheerioResult;
    }
    
    // If we only got 1-2 pages, it's likely a JavaScript-heavy site
    // Try Playwright to get more comprehensive coverage
    console.log(`Cheerio crawl returned only ${cheerioResult.pages.length} page(s) (likely JavaScript-heavy site), trying Playwright for better coverage...`);
  } catch (error) {
    console.log('Cheerio crawl failed, trying Playwright...', error);
  }
  
  // Fallback to PlaywrightCrawler
  try {
    const playwrightResult = await crawlWithPlaywright(websiteUrl);
    
    if (playwrightResult.pages.length > 0) {
      console.log(`✓ Playwright crawl successful: ${playwrightResult.pages.length} pages extracted`);
      return playwrightResult;
    }
    
    console.log('Playwright crawl returned no content');
    
    // If Playwright failed but Cheerio got some content, use Cheerio result
    if (cheerioResult && cheerioResult.pages.length > 0) {
      console.log(`✓ Falling back to Cheerio result: ${cheerioResult.pages.length} page(s)`);
      return cheerioResult;
    }
    
    // Both methods failed to get any content
    return {
      pages: [],
      totalPages: 0,
      crawlMethod: 'failed',
      error: 'No content could be extracted from the website'
    };
  } catch (error) {
    console.error('Playwright crawl error:', error);
    
    // If Playwright threw an error but Cheerio got some content, use Cheerio result
    if (cheerioResult && cheerioResult.pages.length > 0) {
      console.log(`✓ Playwright failed, falling back to Cheerio result: ${cheerioResult.pages.length} page(s)`);
      return cheerioResult;
    }
    
    // Both methods failed
    return {
      pages: [],
      totalPages: 0,
      crawlMethod: 'failed',
      error: error instanceof Error ? error.message : 'Unknown crawl error'
    };
  }
}

/**
 * Formats crawled content for LLM consumption
 */
export function formatCrawledContentForLLM(crawledContent: CrawledWebsiteContent): string {
  if (crawledContent.pages.length === 0) {
    return 'No website content could be extracted.';
  }
  
  let formatted = `Website Content (${crawledContent.totalPages} pages crawled):\n\n`;
  
  // Group pages by type for better organization
  const pagesByType = crawledContent.pages.reduce((acc, page) => {
    if (!acc[page.pageType]) {
      acc[page.pageType] = [];
    }
    acc[page.pageType].push(page);
    return acc;
  }, {} as Record<string, CrawledPage[]>);
  
  // Present in logical order
  const typeOrder: CrawledPage['pageType'][] = ['homepage', 'about', 'features', 'products', 'services', 'solutions', 'pricing', 'other'];
  
  for (const type of typeOrder) {
    const pagesOfType = pagesByType[type];
    if (!pagesOfType || pagesOfType.length === 0) continue;
    
    for (const page of pagesOfType) {
      formatted += `--- ${page.pageType.toUpperCase()}: ${page.title} ---\n`;
      formatted += `URL: ${page.url}\n`;
      formatted += `${page.content.substring(0, 3000)}\n\n`; // Limit each page to 3000 chars
    }
  }
  
  return formatted;
}
