import { CheerioCrawler, PlaywrightCrawler } from 'crawlee';
import * as cheerio from 'cheerio';

interface CrawledPage {
  url: string;
  title: string;
  content: string;
  pageType: 'homepage' | 'about' | 'features' | 'pricing' | 'products' | 'services' | 'solutions' | 'other';
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
    
    const isExactMatch = urlDomain === baseDomain;
    const isSubdomain = urlDomain.endsWith('.' + baseDomain);
    
    if (!isExactMatch && !isSubdomain) {
      return false;
    }
    
    const path = urlObj.pathname.toLowerCase();
    
    const excludeExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.css', '.js', '.xml', '.json', '.zip'];
    if (excludeExtensions.some(ext => path.endsWith(ext))) {
      return false;
    }
    
    const excludePatterns = [
      '/blog/', '/news/', '/press/', '/events/', '/careers/', '/jobs/',
      '/legal/', '/privacy/', '/terms/', '/cookie', '/login/', '/signin/', '/signup/', '/register/',
      '/contact/', '/support/', '/help/', '/faq/', '/download/', '/downloads/',
      '/cart/', '/checkout/', '/account/', '/profile/', '/search/', '/tag/', '/category/'
    ];
    
    if (excludePatterns.some(pattern => path.includes(pattern))) {
      return false;
    }
    
    const priorityKeywords = [
      'about', 'feature', 'pricing', 'price', 'plan', 'product', 'service', 
      'solution', 'capability', 'overview', 'technology', 'platform'
    ];
    
    if (path === '/' || path === '' || path === '/index' || path === '/home') {
      return true;
    }
    
    if (priorityKeywords.some(keyword => path.includes(keyword))) {
      return true;
    }
    
    const pathSegments = path.split('/').filter(s => s.length > 0);
    if (pathSegments.length <= 2) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

async function crawlWithCheerio(websiteUrl: string): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  const crawledUrls = new Set<string>();
  
  console.log(`\n🔷 Starting CHEERIO crawl...`);
  
  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: MAX_PAGES,
    requestHandlerTimeoutSecs: REQUEST_TIMEOUT / 1000,
    async requestHandler({ request, $, enqueueLinks }) {
      const url = request.loadedUrl || request.url;
      
      if (crawledUrls.has(url)) {
        return;
      }
      crawledUrls.add(url);
      
      const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
      const content = extractCleanContent($);
      const pageType = determinePageType(url);
      
      if (content && content.length > 100) {
        pages.push({ url, title, content, pageType });
        console.log(`   ✓ Extracted ${content.length} chars from ${url}`);
      }
      
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
    }
  });
  
  await crawler.run([websiteUrl]);
  console.log(`\n✅ Cheerio crawl completed: ${pages.length} pages\n`);
  
  return pages;
}

async function crawlWithPlaywright(websiteUrl: string): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  const crawledUrls = new Set<string>();
  
  console.log(`\n🔶 Starting PLAYWRIGHT crawl...`);
  
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: MAX_PAGES,
    requestHandlerTimeoutSecs: REQUEST_TIMEOUT / 1000,
    launchContext: {
      launchOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    },
    async requestHandler({ request, page, enqueueLinks }) {
      const url = request.loadedUrl || request.url;
      
      if (crawledUrls.has(url)) {
        return;
      }
      crawledUrls.add(url);
      
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      
      const title = await page.title() || 'Untitled';
      const bodyHTML = await page.content();
      const $ = cheerio.load(bodyHTML);
      const content = extractCleanContent($);
      const pageType = determinePageType(url);
      
      if (content && content.length > 100) {
        pages.push({ url, title, content, pageType });
        console.log(`   ✓ Extracted ${content.length} chars from ${url}`);
      }
      
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
    }
  });
  
  await crawler.run([websiteUrl]);
  console.log(`\n✅ Playwright crawl completed: ${pages.length} pages\n`);
  
  return pages;
}

function formatCrawledContentForLLM(pages: CrawledPage[]): string {
  if (pages.length === 0) {
    return 'No website content could be extracted.';
  }
  
  let formatted = `Website Content (${pages.length} pages crawled):\n\n`;
  
  const pagesByType = pages.reduce((acc, page) => {
    if (!acc[page.pageType]) {
      acc[page.pageType] = [];
    }
    acc[page.pageType].push(page);
    return acc;
  }, {} as Record<string, CrawledPage[]>);
  
  const typeOrder: CrawledPage['pageType'][] = ['homepage', 'about', 'features', 'products', 'services', 'solutions', 'pricing', 'other'];
  
  for (const type of typeOrder) {
    const pagesOfType = pagesByType[type];
    if (!pagesOfType || pagesOfType.length === 0) continue;
    
    for (const page of pagesOfType) {
      formatted += `--- ${page.pageType.toUpperCase()}: ${page.title} ---\n`;
      formatted += `URL: ${page.url}\n`;
      formatted += `${page.content.substring(0, 3000)}\n\n`;
    }
  }
  
  return formatted;
}

async function compareMethodsDemo() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  CRAWL METHOD COMPARISON - Cheerio vs Playwright              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const websiteUrl = 'https://shop.lululemon.com/';
  
  console.log('Target URL:', websiteUrl);
  console.log('Max Pages: 10 per method\n');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Crawl with Cheerio
  const cheerioPages = await crawlWithCheerio(websiteUrl);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Crawl with Playwright
  const playwrightPages = await crawlWithPlaywright(websiteUrl);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Display detailed comparison
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  RAW CRAWLED CONTENT - PAGE BY PAGE COMPARISON                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const maxPages = Math.max(cheerioPages.length, playwrightPages.length);
  
  for (let i = 0; i < maxPages; i++) {
    console.log(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    console.log(`┃  PAGE ${i + 1}/${maxPages}                                                     ┃`);
    console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n`);
    
    // Cheerio version
    if (cheerioPages[i]) {
      const page = cheerioPages[i];
      console.log('🔷 CHEERIO METHOD:');
      console.log('─────────────────────────────────────────────────────────────────');
      console.log(`URL:       ${page.url}`);
      console.log(`Title:     ${page.title}`);
      console.log(`Page Type: ${page.pageType}`);
      console.log(`Length:    ${page.content.length} characters`);
      console.log('\nRAW CONTENT (first 800 chars):');
      console.log('┌─────────────────────────────────────────────────────────────┐');
      console.log(page.content.substring(0, 800).split('\n').map(line => `│ ${line}`).join('\n'));
      if (page.content.length > 800) {
        console.log(`│ ... [${page.content.length - 800} more characters]`);
      }
      console.log('└─────────────────────────────────────────────────────────────┘\n');
    } else {
      console.log('🔷 CHEERIO METHOD: No page crawled at this position\n');
    }
    
    // Playwright version
    if (playwrightPages[i]) {
      const page = playwrightPages[i];
      console.log('🔶 PLAYWRIGHT METHOD:');
      console.log('─────────────────────────────────────────────────────────────────');
      console.log(`URL:       ${page.url}`);
      console.log(`Title:     ${page.title}`);
      console.log(`Page Type: ${page.pageType}`);
      console.log(`Length:    ${page.content.length} characters`);
      console.log('\nRAW CONTENT (first 800 chars):');
      console.log('┌─────────────────────────────────────────────────────────────┐');
      console.log(page.content.substring(0, 800).split('\n').map(line => `│ ${line}`).join('\n'));
      if (page.content.length > 800) {
        console.log(`│ ... [${page.content.length - 800} more characters]`);
      }
      console.log('└─────────────────────────────────────────────────────────────┘\n');
    } else {
      console.log('🔶 PLAYWRIGHT METHOD: No page crawled at this position\n');
    }
    
    // Comparison
    if (cheerioPages[i] && playwrightPages[i]) {
      const cheerioLen = cheerioPages[i].content.length;
      const playwrightLen = playwrightPages[i].content.length;
      const diff = playwrightLen - cheerioLen;
      const pctDiff = ((diff / cheerioLen) * 100).toFixed(1);
      
      console.log('📊 COMPARISON:');
      console.log('─────────────────────────────────────────────────────────────────');
      console.log(`Content Length Difference: ${diff > 0 ? '+' : ''}${diff} chars (${pctDiff}%)`);
      console.log(`Playwright extracted ${diff > 0 ? 'MORE' : 'LESS'} content than Cheerio`);
      console.log('');
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Show formatted output for OpenAI
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  FORMATTED FOR OPENAI - What Gets Sent for Topic Generation   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log('🔷 CHEERIO OUTPUT TO OPENAI:');
  console.log('─────────────────────────────────────────────────────────────────\n');
  const cheerioFormatted = formatCrawledContentForLLM(cheerioPages);
  console.log(cheerioFormatted.substring(0, 2000));
  console.log(`\n... [Total length: ${cheerioFormatted.length} characters]\n`);
  
  console.log('\n🔶 PLAYWRIGHT OUTPUT TO OPENAI:');
  console.log('─────────────────────────────────────────────────────────────────\n');
  const playwrightFormatted = formatCrawledContentForLLM(playwrightPages);
  console.log(playwrightFormatted.substring(0, 2000));
  console.log(`\n... [Total length: ${playwrightFormatted.length} characters]\n`);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Final Statistics
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL STATISTICS                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log('CHEERIO:');
  console.log(`  • Pages crawled: ${cheerioPages.length}`);
  console.log(`  • Total content: ${cheerioPages.reduce((sum, p) => sum + p.content.length, 0).toLocaleString()} chars`);
  console.log(`  • Average per page: ${Math.round(cheerioPages.reduce((sum, p) => sum + p.content.length, 0) / cheerioPages.length).toLocaleString()} chars`);
  
  console.log('\nPLAYWRIGHT:');
  console.log(`  • Pages crawled: ${playwrightPages.length}`);
  console.log(`  • Total content: ${playwrightPages.reduce((sum, p) => sum + p.content.length, 0).toLocaleString()} chars`);
  console.log(`  • Average per page: ${Math.round(playwrightPages.reduce((sum, p) => sum + p.content.length, 0) / playwrightPages.length).toLocaleString()} chars`);
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  COMPARISON COMPLETE                                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

compareMethodsDemo().catch((error) => {
  console.error('\n❌ Comparison failed:', error);
  process.exit(1);
});
