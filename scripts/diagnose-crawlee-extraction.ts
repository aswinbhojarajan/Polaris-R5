import { CheerioCrawler } from 'crawlee';
import * as cheerio from 'cheerio';

async function diagnoseCrawleeExtraction() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  CRAWLEE EXTRACTION DIAGNOSTICS - Lululemon                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const websiteUrl = 'https://shop.lululemon.com/';
  
  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1, // Just homepage for diagnosis
    async requestHandler({ request, $, body }) {
      const url = request.loadedUrl || request.url;
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('1. RESPONSE OBJECT STRUCTURE');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      console.log('Request Object:');
      console.log('  • URL:', request.url);
      console.log('  • Loaded URL:', request.loadedUrl);
      console.log('  • Method:', request.method);
      console.log('  • Headers:', Object.keys(request.headers || {}).join(', '));
      
      console.log('\nResponse Data:');
      console.log('  • Body type:', typeof body);
      console.log('  • Body length:', body?.length || 0, 'characters');
      console.log('  • Cheerio loaded:', !!$);
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('2. HTML STRUCTURE ANALYSIS');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      // Check what's in the page
      const title = $('title').text();
      const h1Count = $('h1').length;
      const h2Count = $('h2').length;
      const pCount = $('p').length;
      const divCount = $('div').length;
      const mainExists = $('main').length > 0;
      const articleExists = $('article').length > 0;
      
      console.log('Page Elements:');
      console.log(`  • Title: "${title}"`);
      console.log(`  • <h1> tags: ${h1Count}`);
      console.log(`  • <h2> tags: ${h2Count}`);
      console.log(`  • <p> tags: ${pCount}`);
      console.log(`  • <div> tags: ${divCount}`);
      console.log(`  • <main> exists: ${mainExists}`);
      console.log(`  • <article> exists: ${articleExists}`);
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('3. CONTENT SELECTORS TEST');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      const selectors = [
        'main',
        'article', 
        '[role="main"]',
        '.main-content',
        '.content',
        '#content',
        'body'
      ];
      
      console.log('Testing each selector:\n');
      selectors.forEach(selector => {
        const element = $(selector);
        const exists = element.length > 0;
        const text = element.text().substring(0, 200).replace(/\s+/g, ' ').trim();
        console.log(`  ${selector}:`);
        console.log(`    • Exists: ${exists}`);
        console.log(`    • Text preview: "${text}${text.length >= 200 ? '...' : ''}"`);
        console.log();
      });
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('4. ACTUAL H1 AND H2 CONTENT');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      console.log('H1 Headlines:');
      $('h1').each((i, elem) => {
        const text = $(elem).text().trim();
        console.log(`  ${i + 1}. "${text}"`);
      });
      
      console.log('\nH2 Headlines:');
      $('h2').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) console.log(`  ${i + 1}. "${text}"`);
      });
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('5. SAMPLE PARAGRAPHS');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      let pCount2 = 0;
      $('p').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text && text.length > 20 && pCount2 < 5) {
          console.log(`  ${pCount2 + 1}. "${text}"`);
          pCount2++;
        }
      });
      
      if (pCount2 === 0) {
        console.log('  ⚠️ No meaningful paragraphs found!');
      }
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('6. WHY EXTRACTION IS FAILING');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      // Check for common issues
      const bodyText = $('body').text();
      const hasIconText = bodyText.includes('Icon') || bodyText.includes('icon');
      const hasNavText = bodyText.includes('menu') || bodyText.includes('search');
      const bodyLength = bodyText.length;
      const cleanText = bodyText.replace(/\s+/g, ' ').trim();
      
      console.log('Analysis:');
      console.log(`  • Body text length: ${bodyLength} characters`);
      console.log(`  • Contains "Icon" text: ${hasIconText}`);
      console.log(`  • Contains navigation text: ${hasNavText}`);
      console.log(`  • Paragraphs with content: ${pCount2}`);
      
      if (h1Count === 0 && h2Count === 0 && pCount2 === 0) {
        console.log('\n❌ PROBLEM IDENTIFIED:');
        console.log('  The page has NO semantic HTML (h1, h2, p tags).');
        console.log('  This is likely a JavaScript-rendered SPA (Single Page App).');
        console.log('  Cheerio sees only the initial HTML shell, not the rendered content.');
        console.log('\n✅ SOLUTION:');
        console.log('  Use Playwright crawler to execute JavaScript and render the page fully.');
      } else if (hasIconText && pCount2 < 3) {
        console.log('\n⚠️ PROBLEM IDENTIFIED:');
        console.log('  Most content appears to be icon labels and navigation.');
        console.log('  Real content might be:');
        console.log('    • Loaded via JavaScript after initial page load');
        console.log('    • Hidden in shadow DOM or custom elements');
        console.log('    • In non-semantic divs without proper classes');
      }
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('7. BODY TEXT PREVIEW (First 500 chars)');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      console.log(cleanText.substring(0, 500));
      console.log('\n...\n');
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('8. CRAWLEE RESPONSE OBJECT');
      console.log('─────────────────────────────────────────────────────────────────\n');
      
      console.log('The Crawlee requestHandler receives:');
      console.log(`
{
  request: {
    url: "${request.url}",
    loadedUrl: "${request.loadedUrl}",
    method: "${request.method}",
    headers: { ... },
    uniqueKey: "${request.uniqueKey}",
    id: "${request.id}",
    retryCount: ${request.retryCount}
  },
  
  $: CheerioAPI,  // Cheerio instance for parsing HTML
  
  body: string,    // Raw HTML response body
  
  enqueueLinks: async function(options) { ... },  // Function to add more URLs
  
  crawler: CheerioCrawler,  // Reference to crawler instance
  
  response: {
    url: string,
    statusCode: number,
    headers: { ... }
  }
}
      `);
    }
  });
  
  await crawler.run([websiteUrl]);
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  DIAGNOSTICS COMPLETE                                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

diagnoseCrawleeExtraction().catch((error) => {
  console.error('Diagnostic failed:', error);
  process.exit(1);
});
