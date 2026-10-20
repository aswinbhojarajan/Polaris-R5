import { crawlWebsite, formatCrawledContentForLLM } from '../server/services/website-crawler';
import * as fs from 'fs';
import * as path from 'path';

interface RawDataDump {
  timestamp: string;
  websiteUrl: string;
  crawlResult: {
    pages: Array<{
      url: string;
      title: string;
      content: string;
      contentLength: number;
      pageType: string;
    }>;
    totalPages: number;
    crawlMethod: string;
    error?: string;
  };
  llmFormattedContent: string;
  llmFormattedContentLength: number;
  analysis: {
    totalCharacters: number;
    averagePageLength: number;
    pageTypes: Record<string, number>;
    longestPage: { url: string; length: number };
    shortestPage: { url: string; length: number };
  };
}

async function dumpCrawlData(websiteUrl: string) {
  console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  RAW CRAWL DATA DUMP                                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Website: ${websiteUrl}\n`);

  // Crawl the website
  console.log(`🔍 Starting crawl...\n`);
  const crawlResult = await crawlWebsite(websiteUrl);
  
  if (crawlResult.pages.length === 0) {
    console.error(`❌ No content extracted. Error: ${crawlResult.error || 'Unknown'}`);
    process.exit(1);
  }

  console.log(`✅ Crawl completed: ${crawlResult.pages.length} pages extracted\n`);

  // Format for LLM
  const llmFormattedContent = formatCrawledContentForLLM(crawlResult);

  // Calculate analysis
  const totalCharacters = crawlResult.pages.reduce((sum, p) => sum + p.content.length, 0);
  const averagePageLength = totalCharacters / crawlResult.pages.length;
  
  const pageTypes: Record<string, number> = {};
  crawlResult.pages.forEach(p => {
    pageTypes[p.pageType] = (pageTypes[p.pageType] || 0) + 1;
  });

  const sortedByLength = [...crawlResult.pages].sort((a, b) => a.content.length - b.content.length);
  const shortestPage = sortedByLength[0];
  const longestPage = sortedByLength[sortedByLength.length - 1];

  // Create the dump object
  const dump: RawDataDump = {
    timestamp: new Date().toISOString(),
    websiteUrl,
    crawlResult: {
      pages: crawlResult.pages.map(p => ({
        url: p.url,
        title: p.title,
        content: p.content,
        contentLength: p.content.length,
        pageType: p.pageType
      })),
      totalPages: crawlResult.totalPages,
      crawlMethod: crawlResult.crawlMethod,
      error: crawlResult.error
    },
    llmFormattedContent,
    llmFormattedContentLength: llmFormattedContent.length,
    analysis: {
      totalCharacters,
      averagePageLength: Math.round(averagePageLength),
      pageTypes,
      longestPage: { url: longestPage.url, length: longestPage.content.length },
      shortestPage: { url: shortestPage.url, length: shortestPage.content.length }
    }
  };

  // Ensure storage directory exists
  const storageDir = path.join(process.cwd(), 'storage');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // Write JSON dump
  const jsonPath = path.join(storageDir, 'raw-crawl-dump.json');
  fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2));
  console.log(`📄 JSON dump saved to: ${jsonPath}`);

  // Write human-readable text file
  const txtPath = path.join(storageDir, 'raw-crawl-dump.txt');
  const txtContent = `
╔═══════════════════════════════════════════════════════════════════╗
║  RAW WEBSITE CRAWL DATA DUMP                                      ║
╚═══════════════════════════════════════════════════════════════════╝

TIMESTAMP: ${dump.timestamp}
WEBSITE:   ${dump.websiteUrl}
METHOD:    ${dump.crawlResult.crawlMethod}
PAGES:     ${dump.crawlResult.totalPages}

═══════════════════════════════════════════════════════════════════
ANALYSIS
═══════════════════════════════════════════════════════════════════

Total Characters:     ${dump.analysis.totalCharacters.toLocaleString()}
Average Page Length:  ${dump.analysis.averagePageLength.toLocaleString()} chars
Longest Page:         ${dump.analysis.longestPage.url} (${dump.analysis.longestPage.length.toLocaleString()} chars)
Shortest Page:        ${dump.analysis.shortestPage.url} (${dump.analysis.shortestPage.length.toLocaleString()} chars)

Page Types:
${Object.entries(dump.analysis.pageTypes).map(([type, count]) => `  • ${type}: ${count} page(s)`).join('\n')}

═══════════════════════════════════════════════════════════════════
RAW PAGE CONTENT (Page by Page)
═══════════════════════════════════════════════════════════════════

${dump.crawlResult.pages.map((page, idx) => `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  PAGE ${idx + 1}: ${page.pageType.toUpperCase().padEnd(54)} ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

URL:    ${page.url}
Title:  ${page.title}
Length: ${page.contentLength.toLocaleString()} characters

RAW CONTENT:
─────────────────────────────────────────────────────────────────
${page.content}
─────────────────────────────────────────────────────────────────
`).join('\n')}

═══════════════════════════════════════════════════════════════════
LLM-FORMATTED CONTENT (What Gets Sent to OpenAI)
═══════════════════════════════════════════════════════════════════

Length: ${dump.llmFormattedContentLength.toLocaleString()} characters (~${Math.round(dump.llmFormattedContentLength / 4)} tokens)

${dump.llmFormattedContent}

═══════════════════════════════════════════════════════════════════
END OF DUMP
═══════════════════════════════════════════════════════════════════
`;

  fs.writeFileSync(txtPath, txtContent);
  console.log(`📄 Text dump saved to: ${txtPath}`);

  // Print summary
  console.log(`\n╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  SUMMARY                                                          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`✅ Crawled ${dump.crawlResult.totalPages} pages using ${dump.crawlResult.crawlMethod}`);
  console.log(`✅ Total content: ${dump.analysis.totalCharacters.toLocaleString()} characters`);
  console.log(`✅ LLM format: ${dump.llmFormattedContentLength.toLocaleString()} characters (~${Math.round(dump.llmFormattedContentLength / 4)} tokens)`);
  console.log(`\n📁 Files saved to ./storage/`);
  console.log(`   • raw-crawl-dump.json (structured data)`);
  console.log(`   • raw-crawl-dump.txt (human-readable)`);
  console.log(`\n📥 Download these files to analyze the raw crawled content\n`);
}

// Get URL from command line
const url = process.argv[2];

if (!url) {
  console.error(`❌ Error: No URL provided`);
  console.log(`\nUsage: npx tsx scripts/dump-crawl-raw-data.ts <website-url>`);
  console.log(`\nExample: npx tsx scripts/dump-crawl-raw-data.ts https://shop.lululemon.com`);
  process.exit(1);
}

dumpCrawlData(url).catch(error => {
  console.error(`❌ Error:`, error);
  process.exit(1);
});
