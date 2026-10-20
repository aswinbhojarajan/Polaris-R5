import { crawlWebsite, formatCrawledContentForLLM } from '../server/services/website-crawler';

async function showRawCrawledContent() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  RAW CRAWLED CONTENT - Before Sending to OpenAI                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const websiteUrl = 'https://shop.lululemon.com/';
  
  console.log(`Crawling: ${websiteUrl}`);
  console.log(`Max Pages: 10\n`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const result = await crawlWebsite(websiteUrl);
  
  console.log(`✓ Crawl Method Used: ${result.crawlMethod.toUpperCase()}`);
  console.log(`✓ Pages Extracted: ${result.totalPages}\n`);
  
  if (result.pages.length === 0) {
    console.log('❌ No pages were extracted\n');
    return;
  }
  
  // Show first 3 pages in detail
  const pagesToShow = Math.min(3, result.pages.length);
  
  for (let i = 0; i < pagesToShow; i++) {
    const page = result.pages[i];
    
    console.log(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    console.log(`┃  PAGE ${i + 1}: ${page.pageType.toUpperCase().padEnd(50)} ┃`);
    console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n`);
    
    console.log(`URL:    ${page.url}`);
    console.log(`Title:  ${page.title.substring(0, 80)}`);
    console.log(`Length: ${page.content.length} characters\n`);
    
    console.log('RAW CONTENT (Complete):');
    console.log('─────────────────────────────────────────────────────────────────');
    console.log(page.content);
    console.log('─────────────────────────────────────────────────────────────────\n');
  }
  
  // Show summary of remaining pages
  if (result.pages.length > pagesToShow) {
    console.log(`\n... and ${result.pages.length - pagesToShow} more pages:\n`);
    for (let i = pagesToShow; i < result.pages.length; i++) {
      const page = result.pages[i];
      console.log(`  ${i + 1}. ${page.pageType.toUpperCase()}: ${page.url} (${page.content.length} chars)`);
    }
  }
  
  console.log('\n\n═══════════════════════════════════════════════════════════════════\n');
  console.log('FORMATTED OUTPUT SENT TO OPENAI FOR TOPIC GENERATION');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const formattedForOpenAI = formatCrawledContentForLLM(result);
  
  console.log(formattedForOpenAI);
  
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`\nTotal characters sent to OpenAI: ${formattedForOpenAI.length.toLocaleString()}`);
  console.log(`Estimated tokens (rough): ~${Math.round(formattedForOpenAI.length / 4).toLocaleString()}\n`);
  
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  COMPLETE                                                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
}

showRawCrawledContent().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
