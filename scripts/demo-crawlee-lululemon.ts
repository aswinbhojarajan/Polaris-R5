import { crawlWebsite, formatCrawledContentForLLM } from '../server/services/website-crawler';

async function demoCrawleeLululemon() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  CRAWLEE DEMONSTRATION - Lululemon Website Crawling            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const websiteUrl = 'https://shop.lululemon.com/';
  
  console.log('📍 Target URL:', websiteUrl);
  console.log('⚙️  Max Pages: 10');
  console.log('🔄 Strategy: CheerioCrawler (fast) → PlaywrightCrawler (fallback)\n');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const startTime = Date.now();
  
  // STEP 1: Initiate crawl
  console.log('STEP 1: INITIATING CRAWL');
  console.log('─────────────────────────────────────────────────────────────────\n');
  
  const result = await crawlWebsite(websiteUrl);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // STEP 2: Show results summary
  console.log('STEP 2: CRAWL RESULTS SUMMARY');
  console.log('─────────────────────────────────────────────────────────────────\n');
  
  console.log(`✓ Crawl Method: ${result.crawlMethod.toUpperCase()}`);
  console.log(`✓ Total Pages Extracted: ${result.totalPages}`);
  console.log(`✓ Duration: ${duration}s`);
  
  if (result.error) {
    console.log(`✗ Error: ${result.error}`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // STEP 3: Show detailed page breakdown
  console.log('STEP 3: DETAILED PAGE BREAKDOWN');
  console.log('─────────────────────────────────────────────────────────────────\n');
  
  if (result.pages.length === 0) {
    console.log('No pages were extracted.');
  } else {
    // Group by page type
    const pagesByType: Record<string, any[]> = {};
    result.pages.forEach(page => {
      if (!pagesByType[page.pageType]) {
        pagesByType[page.pageType] = [];
      }
      pagesByType[page.pageType].push(page);
    });
    
    console.log('Pages by Type:');
    Object.entries(pagesByType).forEach(([type, pages]) => {
      console.log(`  • ${type.toUpperCase()}: ${pages.length} page(s)`);
    });
    
    console.log('\nDetailed Page Information:\n');
    
    result.pages.forEach((page, index) => {
      console.log(`┌─ Page ${index + 1}/${result.pages.length} ────────────────────────────────────────────────────`);
      console.log(`│ Type:    ${page.pageType.toUpperCase()}`);
      console.log(`│ Title:   ${page.title}`);
      console.log(`│ URL:     ${page.url}`);
      console.log(`│ Content: ${page.content.length} characters`);
      console.log(`│`);
      console.log(`│ Content Preview (first 300 chars):`);
      console.log(`│ ${page.content.substring(0, 300).replace(/\n/g, ' ')}...`);
      console.log(`└─────────────────────────────────────────────────────────────────\n`);
    });
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // STEP 4: Show LLM-formatted output
  console.log('STEP 4: LLM-FORMATTED OUTPUT');
  console.log('─────────────────────────────────────────────────────────────────\n');
  console.log('This is the formatted content that will be sent to GPT-4 for');
  console.log('generating topics, keywords, and prompts:\n');
  
  const formattedContent = formatCrawledContentForLLM(result);
  
  // Show first 2000 chars of formatted content
  console.log(formattedContent.substring(0, 2000));
  if (formattedContent.length > 2000) {
    console.log(`\n... [${formattedContent.length - 2000} more characters] ...\n`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // STEP 5: Show statistics
  console.log('STEP 5: EXTRACTION STATISTICS');
  console.log('─────────────────────────────────────────────────────────────────\n');
  
  if (result.pages.length > 0) {
    const totalContentLength = result.pages.reduce((sum, p) => sum + p.content.length, 0);
    const avgContentLength = Math.round(totalContentLength / result.pages.length);
    const minContentLength = Math.min(...result.pages.map(p => p.content.length));
    const maxContentLength = Math.max(...result.pages.map(p => p.content.length));
    
    console.log(`Total Content Extracted: ${totalContentLength.toLocaleString()} characters`);
    console.log(`Average per Page: ${avgContentLength.toLocaleString()} characters`);
    console.log(`Shortest Page: ${minContentLength.toLocaleString()} characters`);
    console.log(`Longest Page: ${maxContentLength.toLocaleString()} characters`);
    
    console.log('\nURL Patterns:');
    result.pages.forEach(page => {
      const url = new URL(page.url);
      console.log(`  • ${url.pathname || '/'} (${page.pageType})`);
    });
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // STEP 6: Next steps explanation
  console.log('STEP 6: WHAT HAPPENS NEXT');
  console.log('─────────────────────────────────────────────────────────────────\n');
  
  console.log('After crawling, this content would be used to:');
  console.log('');
  console.log('1. 🤖 AI Topic Generation (Crawl Topics)');
  console.log('   • Content is sent to GPT-4 Turbo');
  console.log('   • Extracts 15-20 topics based on actual website content');
  console.log('   • Tagged with source="crawl"');
  console.log('   • Examples: "Athletic wear product lines", "Sustainability practices"');
  console.log('');
  console.log('2. 🤖 AI Topic Generation (Generic Topics)');
  console.log('   • Based on client metadata (name, industry, geography)');
  console.log('   • Generates 15-20 generic industry topics');
  console.log('   • Tagged with source="ai"');
  console.log('   • Examples: "Emerging trends in athletic apparel"');
  console.log('');
  console.log('3. 🔑 Keyword Extraction');
  console.log('   • Extracts relevant keywords for each topic');
  console.log('   • Used for prompt variation and SEO analysis');
  console.log('');
  console.log('4. 📝 Prompt Generation');
  console.log('   • Creates test prompts from ALL topics (crawl + AI + manual)');
  console.log('   • 1 prompt per topic typically');
  console.log('   • Used to test AI model responses');
  console.log('');
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  DEMONSTRATION COMPLETE                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

// Run the demo
demoCrawleeLululemon().catch((error) => {
  console.error('\n❌ DEMO FAILED:', error);
  console.error(error);
  process.exit(1);
});
