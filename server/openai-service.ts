import OpenAI from "openai";
import { z } from "zod";
import { crawlWebsite, formatCrawledContentForLLM } from './services/website-crawler';
import { LLM_FUNCTIONS } from './config/llm-functions';
import { assertVendorNotPaused } from './config/vendor-pause';

export interface GeneratedMetadata {
  topics: Array<{
    topic: string;
    category: string;
    keywords: string[];
  }>;
  topTopics: Array<{
    category: string;
    topics: string[];
  }>;
  prompts: string[];
  crawlResults?: Array<{
    sourceUrl: string;  // Track which URL this crawl came from
    pages: any[];
    totalPages: number;
    crawlMethod: string;
  }>;
}

function getOpenAIClient(): OpenAI {
  // Task #78 — vendor kill switch
  assertVendorNotPaused('OpenAI');
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set. Please configure the API key to use metadata generation features.');
  }
  
  return new OpenAI({ apiKey });
}

export async function generateMetadataFromWebsite(
  websiteUrls: string | string[],
  companyName: string,
  industry?: string,
  geography?: string,
  focusAreas?: string[]
): Promise<GeneratedMetadata> {
  // Normalize URLs to array
  const urlsToProcess = Array.isArray(websiteUrls) ? websiteUrls : [websiteUrls];
  
  // Step 1: Crawl all websites to extract real content
  console.log(`Step 1: Crawling ${urlsToProcess.length} website(s) to extract content...`);
  
  const allCrawledPages: any[] = [];
  const successfulUrls: string[] = [];
  const failedUrls: string[] = [];
  const crawlResults: any[] = [];

  // Task #99 — Crawl URLs in parallel with a concurrency cap. The serial
  // version waited for each site to finish before starting the next, so a
  // single slow site stretched the whole metadata job by minutes. We keep
  // the same per-URL success/failure accounting and order semantics; the
  // only behaviour change is the wall-clock time. Cap of 3 keeps us under
  // the per-host politeness limits Crawlee enforces internally and keeps
  // RAM bounded when Playwright fallbacks fire on multiple sites at once.
  const CRAWL_CONCURRENCY = 3;
  const crawlStart = Date.now();

  async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let cursor = 0;
    const lanes = Math.max(1, Math.min(limit, items.length || 1));
    const workers: Promise<void>[] = [];
    for (let w = 0; w < lanes; w++) {
      workers.push(
        (async () => {
          while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            try {
              const value = await fn(items[i], i);
              results[i] = { status: "fulfilled", value };
            } catch (reason) {
              results[i] = { status: "rejected", reason };
            }
          }
        })(),
      );
    }
    await Promise.all(workers);
    return results;
  }

  type CrawlSuccess = { url: string; ok: true; crawledContent: Awaited<ReturnType<typeof crawlWebsite>> };
  type CrawlFailure = { url: string; ok: false; error: Error };
  type CrawlOutcome = CrawlSuccess | CrawlFailure;

  const settled = await runWithConcurrency<string, CrawlOutcome>(urlsToProcess, CRAWL_CONCURRENCY, async (url) => {
    console.log(`Crawling: ${url}`);
    try {
      const crawledContent = await crawlWebsite(url);
      return { url, ok: true, crawledContent };
    } catch (err) {
      // Re-shape sync throws into a fulfilled outcome carrying the URL so
      // failure accounting (failedUrls) stays accurate even when
      // crawlWebsite blows up unexpectedly.
      return { url, ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });

  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      // Should not happen now that the worker catches its own throws, but
      // guard in case of an OOM/abort — count it as a failure with no URL.
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.warn(`✗ Crawl worker rejected unexpectedly: ${reason}`);
      failedUrls.push("<unknown>");
      continue;
    }
    const value = outcome.value;
    if (!value.ok) {
      console.warn(`✗ Failed to crawl ${value.url}: ${value.error.message}`);
      failedUrls.push(value.url);
      continue;
    }
    const { url, crawledContent } = value;
    if (crawledContent.crawlMethod !== 'failed' && crawledContent.pages.length > 0) {
      console.log(`✓ Successfully crawled ${crawledContent.pages.length} pages from ${url} using ${crawledContent.crawlMethod}`);
      allCrawledPages.push(...crawledContent.pages);
      successfulUrls.push(url);
      crawlResults.push({
        sourceUrl: url,
        ...crawledContent,
      });
    } else {
      console.warn(`✗ Failed to crawl ${url}${crawledContent.error ? `: ${crawledContent.error}` : ''}`);
      failedUrls.push(url);
    }
  }

  const crawlElapsedSec = ((Date.now() - crawlStart) / 1000).toFixed(1);
  console.log(
    `[GenerateMetadata] crawled ${urlsToProcess.length} urls in ${crawlElapsedSec}s ` +
      `(parallel, ${Math.min(CRAWL_CONCURRENCY, urlsToProcess.length)}-in-flight, ` +
      `${successfulUrls.length} ok / ${failedUrls.length} failed)`,
  );
  
  // Step 2: Format content for GPT-4
  let websiteContext: string;
  if (allCrawledPages.length === 0) {
    console.warn(`Warning: Website crawl failed for all ${urlsToProcess.length} URLs. Falling back to URL-only approach.`);
    websiteContext = `Website URLs: ${urlsToProcess.join(', ')} (Note: Unable to extract website content, analyze based on company name and context)`;
  } else {
    console.log(`✓ Crawl summary: ${successfulUrls.length} successful, ${failedUrls.length} failed, ${allCrawledPages.length} total pages extracted`);
    if (failedUrls.length > 0) {
      console.log(`  Failed URLs: ${failedUrls.join(', ')}`);
    }
    
    websiteContext = formatCrawledContentForLLM({
      pages: allCrawledPages,
      totalPages: allCrawledPages.length,
      crawlMethod: 'multi-url' as any // Indicate this is from multiple URLs
    });
  }
  
  // Step 2.5: Add focus areas context if provided
  let focusAreasContext = '';
  if (focusAreas && focusAreas.length > 0) {
    focusAreasContext = `\n\nClient-Specified Focus Areas (use these as reference for relevant topics):\n${focusAreas.map((area, i) => `${i + 1}. ${area}`).join('\n')}`;
  }
  
  // Step 3: Generate metadata using GPT-4 with crawled content
  const prompt = `You are a brand visibility analyst. Analyze the company "${companyName}"${industry ? ` in the ${industry} industry` : ''}${geography ? ` operating in ${geography}` : ''}.

${websiteContext}${focusAreasContext}

Based on the website content above${focusAreas && focusAreas.length > 0 ? ' and the client-specified focus areas' : ''}, generate comprehensive metadata for testing AI assistant responses:

1. Generate 30+ diverse topics/keywords covering:
   - Product Features (specific features, capabilities, technical specs)
   - Use Cases (practical applications, scenarios, solutions)
   - Industry Applications (vertical markets, sectors served)
   - Technical Capabilities (technology stack, integrations, APIs)
   - Competitors (main competitors, alternatives)
   - Market Position (unique selling points, differentiators)
   - Customer Benefits (value propositions, outcomes)
   - Innovation (what makes them innovative, cutting-edge features)
   - Other (general brand topics, company info)

2. Identify the top 10 most important topic categories with key topics

3. Generate exactly 40 GENERIC test prompts that real users would ask:
   
   **CRITICAL REQUIREMENTS:**
   - DO NOT mention "${companyName}" or any company names in the prompts
   - Focus on topics, keywords, use cases, and problems that ${companyName} solves
   - Include ${industry ? `"${industry}"` : 'relevant industry terms'} and ${geography ? `"${geography}"` : 'location'} context where appropriate
   - Make each prompt complete, rich, and natural (how real users search/ask)
   - Each prompt should be detailed enough to get comprehensive AI responses
   - Prompts should test if AI assistants mention ${companyName} when answering generic queries
   
   **Prompt Categories to Cover:**
   - Product/Service Discovery: "What are the best [solutions] for [specific need]?"
   - Problem-Solving: "How can I [solve specific problem] for [use case]?"
   - Comparison/Ranking: "Top [number] [product category] for [target audience/industry]"
   - Feature Exploration: "Which [solutions] offer [specific features/capabilities]?"
   - Industry-Specific: "Best [category] for ${industry || '[industry]'} companies${geography ? ` in ${geography}` : ''}?"
   - Use Case: "What tools help with [specific use case] in ${industry || '[industry]'}?"
   - Recommendation: "Recommended [solutions] for [specific scenario/requirement]"
   - Evaluation: "How to choose [product category] for [specific criteria]?"
   
   **Example Generic Prompts (DO NOT copy these, create new ones):**
   - "What are the best project management tools for software development teams in 2024?"
   - "Top cloud-based CRM solutions for small businesses in North America"
   - "Which email marketing platforms offer advanced automation and analytics?"
   - "How can healthcare providers improve patient engagement and communication?"
   - "Recommended e-commerce platforms for businesses with high transaction volumes"

Return your response as JSON in this exact format:
{
  "topics": [
    {
      "topic": "Topic name",
      "category": "Product Features|Use Cases|Industry Applications|Technical Capabilities|Competitors|Market Position|Customer Benefits|Innovation|Other",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ],
  "topTopics": [
    {
      "category": "Category name",
      "topics": ["topic1", "topic2", "topic3"]
    }
  ],
  "prompts": [
    "Prompt text 1",
    "Prompt text 2"
  ]
}`;

  console.log(`Calling OpenAI API to generate metadata for: ${companyName}`);
  
  try {
    const openai = getOpenAIClient();
    const response = await Promise.race([
      openai.chat.completions.create({
        model: LLM_FUNCTIONS.metadata,
        messages: [
          {
            role: "system",
            content: "You are a brand visibility and competitive intelligence expert. Analyze companies and generate comprehensive test metadata for AI benchmarking."
        },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
      }, {
        timeout: 60000, // 60 second timeout
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API call timed out after 60 seconds')), 60000)
      )
    ]);

    console.log(`OpenAI API call successful for: ${companyName}`);
    
    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    console.log(`Parsed OpenAI response - topics: ${result.topics?.length || 0}, prompts: ${result.prompts?.length || 0}`);
    
    return {
      topics: result.topics || [],
      topTopics: result.topTopics || [],
      prompts: result.prompts || [],
      crawlResults: crawlResults.length > 0 ? crawlResults : undefined
    };
  } catch (error) {
    console.error("Error generating metadata with OpenAI:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      companyName,
      websiteUrls: urlsToProcess
    });
    throw new Error(`Failed to generate metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generates additional AI topics based on client metadata (without website content)
 * Topics are generic and do not include the client name
 */
export async function generateAITopicsFromMetadata(
  companyName: string,
  industry?: string,
  geographies?: string[],
  brandAliases?: string[],
  websites?: string[],
  focusAreas?: string[]
): Promise<GeneratedMetadata['topics']> {
  const aliasText = brandAliases && brandAliases.length > 0 ? ` (also known as: ${brandAliases.join(', ')})` : '';
  const geoText = geographies && geographies.length > 0 ? ` operating in ${geographies.join(', ')}` : '';
  const websiteText = websites && websites.length > 0 ? `\n- Websites: ${websites.join(', ')}` : '';
  const focusText = focusAreas && focusAreas.length > 0 ? `\n- Focus Areas: ${focusAreas.join(', ')}` : '';
  
  const prompt = `You are a brand visibility analyst. Analyze "${companyName}"${aliasText}${industry ? ` in the ${industry} industry` : ''}${geoText}.
${websiteText}${focusText}

Generate 15-20 ADDITIONAL diverse topics/keywords that complement website-based analysis. These should focus on:

**CRITICAL REQUIREMENTS:**
- DO NOT include "${companyName}" or any aliases in the topic text itself - keep topics GENERIC
- Focus on industry trends, use cases, and problems that companies like ${companyName} address
- Topics should be relevant to ${industry || 'the industry'} and ${geographies && geographies.length > 0 ? geographies.join('/') : 'the region'}
${focusAreas && focusAreas.length > 0 ? `- Consider these focus areas for context: ${focusAreas.join(', ')}\n` : ''}- These are supplementary topics that might not appear on the website but are relevant to the business

**Topic Categories to Cover:**
1. Industry Trends (emerging trends in ${industry || 'the industry'})
2. Use Cases (practical applications, scenarios relevant to ${industry || 'this sector'})
3. Market Challenges (pain points, problems in ${industry || 'the industry'}${geoText})
4. Technology Stack (technical capabilities, integrations common in ${industry || 'this field'})
5. Customer Needs (what ${industry || 'industry'} customers typically look for)
6. Competitive Landscape (general market positioning factors in ${industry || 'this space'})
7. Innovation Areas (where ${industry || 'this industry'} is innovating)

Return your response as JSON in this exact format:
{
  "topics": [
    {
      "topic": "Generic topic name (NO company names)",
      "category": "Product Features|Use Cases|Industry Applications|Technical Capabilities|Competitors|Market Position|Customer Benefits|Innovation|Other",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}`;

  console.log(`Generating AI topics for: ${companyName} (${industry || 'no industry'}, ${geographies?.join('/') || 'no geo'}, ${focusAreas?.length || 0} focus areas, ${websites?.length || 0} websites)`);
  
  try {
    const openai = getOpenAIClient();
    const response = await Promise.race([
      openai.chat.completions.create({
        model: LLM_FUNCTIONS.topics,
        messages: [
          {
            role: "system",
            content: "You are a brand visibility and competitive intelligence expert. Generate generic industry-relevant topics without mentioning specific company names."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API call timed out after 60 seconds')), 60000)
      )
    ]);

    console.log(`OpenAI AI topics generation successful for: ${companyName}`);
    
    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    console.log(`Generated ${result.topics?.length || 0} AI topics`);
    
    return result.topics || [];
  } catch (error) {
    console.error("Error generating AI topics with OpenAI:", error);
    throw new Error(`Failed to generate AI topics: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Task #89 — Realism-aware Prompt Library generator. Replaces the old
// `generatePromptsFromTopics` (which concatenated geography literally
// into the prompt template, producing unnatural "operating in <country>"
// phrasing). The new function:
//   * accepts a full project context envelope (persona, target market,
//     test location, language, brand aliases, focus areas, top
//     competitors, plus topics) and passes each on its own labeled line
//     instead of pre-mixing them into instructions;
//   * asks for ~18 prompts split across three intent tiers (Branded /
//     Semi-Branded / Unbranded) with a short diagnostic-focus label per
//     prompt;
//   * forbids inventing locations and resolves "near me" to a
//     configured test location when present;
//   * injects sector-specific exemplar hints when industry matches.
//
// Output: Array<{text, intentTier, diagnosticFocus, categoryHint}>.
// Malformed rows are dropped (with a console warn) rather than failing
// the whole refresh — the route handler still gets back a usable batch.

import { findSectorPattern } from "./services/prompt-sector-patterns";
import type { PromptIntentTier } from "@shared/schema";

export interface RealisticPromptInput {
  client: {
    name: string;
    industry?: string | null;
    customIndustry?: string | null;
    geography?: string | null;
    customGeography?: string | null;
    brandAliases?: unknown;
    focusAreas?: unknown;
    targetCustomerPersona?: string | null;
    targetMarketCountry?: string | null;
    primaryTestLocation?: string | null;
    primaryLanguage?: string | null;
  };
  topics: Array<{ label: string; category: string; keywords: string[] }>;
  competitors?: Array<{ name: string; website?: string | null }>;
  count?: number; // default 18 (~6 per tier)
}

export interface RealisticPrompt {
  text: string;
  intentTier: PromptIntentTier;
  diagnosticFocus: string;
  categoryHint: string | null;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

const VALID_TIERS: ReadonlySet<PromptIntentTier> = new Set([
  "branded",
  "semi_branded",
  "unbranded",
]);

function normaliseTier(raw: unknown): PromptIntentTier | null {
  if (typeof raw !== "string") return null;
  const t = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  // Accept "semi_branded", "semibranded", "semi-branded".
  const normalised = t === "semibranded" ? "semi_branded" : t;
  return VALID_TIERS.has(normalised as PromptIntentTier)
    ? (normalised as PromptIntentTier)
    : null;
}

export async function generateRealisticPrompts(
  input: RealisticPromptInput,
): Promise<RealisticPrompt[]> {
  const { client, topics, competitors = [], count = 18 } = input;

  const industry = (client.customIndustry || client.industry || "").trim();
  const geography = (client.customGeography || client.geography || "").trim();
  const brandAliases = asStringArray(client.brandAliases);
  const focusAreas = asStringArray(client.focusAreas);
  const persona = (client.targetCustomerPersona || "").trim();
  const targetCountry = (client.targetMarketCountry || "").trim();
  const testLocation = (client.primaryTestLocation || "").trim();
  const language = (client.primaryLanguage || "").trim() || "en-US";

  const sector = findSectorPattern(client.industry, client.customIndustry, client.focusAreas);

  // Build a labeled context block — each line is optional. The model is
  // instructed to consult fields naturally, never to concatenate them.
  const contextLines: string[] = [];
  contextLines.push(`Brand: ${client.name}`);
  if (brandAliases.length) contextLines.push(`Brand aliases: ${brandAliases.join(", ")}`);
  if (industry) contextLines.push(`Industry: ${industry}`);
  if (focusAreas.length) contextLines.push(`Focus areas: ${focusAreas.join(", ")}`);
  if (targetCountry) {
    contextLines.push(`Target market country: ${targetCountry}`);
  } else if (geography) {
    contextLines.push(`Operating regions: ${geography}`);
  }
  if (testLocation) contextLines.push(`Primary test location (use for "near me"): ${testLocation}`);
  contextLines.push(`Primary language: ${language}`);
  if (persona) contextLines.push(`Target customer persona: ${persona}`);
  if (competitors.length) {
    const top = competitors.slice(0, 5).map((c) => c.name).join(", ");
    contextLines.push(`Top competitors: ${top}`);
  }

  const topicLines = topics
    .slice(0, 30)
    .map((t) => `- ${t.label}${t.category ? ` (${t.category})` : ""}${t.keywords.length ? `: ${t.keywords.slice(0, 8).join(", ")}` : ""}`)
    .join("\n");

  const sectorHints = sector
    ? `\n**Sector exemplar patterns (${sector.label})** — use as inspiration only, not verbatim:\n${sector.hints.map((h) => `- ${h}`).join("\n")}\n`
    : "";

  const tierTargets = computeTierSplit(count);

  const systemPrompt = `You are simulating real consumers asking questions in a public ChatGPT-style assistant.
Follow these rules without exception:
1. Voice: write as the target customer would actually type or speak. No mention of "AEO", "GEO", "diagnostics", "test prompt", "AI benchmarking", or any meta language.
2. Location handling: never invent or infer a location from the server, IP, or hosting region. If the prompt needs a local cue, only use the value provided in "Primary test location" (this is what "near me" / "in my area" should resolve to). If no test location is provided, omit location entirely or phrase it abstractly ("the nearest store", "in the area I live").
3. Language, currency, regulatory context: write in the configured Primary language. Use the local currency of the Target market country (e.g. USD for US, AED for UAE, GBP for UK). Assume the legal/product/marketplace context of that country.
4. Time: treat every question as if asked today. Use realistic current-year framings ("this holiday season", "this weekend", "before Friday").
5. Tone: multi-constraint ("under $X", "by Friday", "with no annual fee"), goal-based ("help me choose…", "build a plan…"), conversational ("I'm new to this…", "my budget is around…"). Avoid robotic, formal, or list-like phrasing.
6. NEVER produce these literal strings: "operating in <country>", "in the <industry> industry", "[City]", "[ZIP]", "[State]", or any unfilled bracketed placeholder. Substitute concrete values from context, or omit.

You will return strict JSON only.`;

  const userPrompt = `Generate exactly ${count} realistic consumer prompts that test how AI assistants answer questions related to the brand's market. The brand name is provided so you know what NOT to mention in unbranded prompts — do not generate prompts whose only purpose is praising or describing the brand.

**Project context** (consult, do not concatenate):
${contextLines.join("\n")}

**Topics & keywords** (use these to choose what to ask about):
${topicLines || "(none provided — infer from industry and focus areas)"}
${sectorHints}
**Intent tier split** (must match exactly):
- ${tierTargets.branded} BRANDED prompts — brand name (or an alias) is explicitly used. Tests accuracy / NAP / schema. e.g. "What are ${client.name}'s holiday hours${testLocation ? ` near ${testLocation}` : ""}?"
- ${tierTargets.semi_branded} SEMI-BRANDED prompts — brand is implied via use case, location, or category leadership but not named. Tests contextual recall. e.g. "Best place to grab last-minute groceries under $50${testLocation ? ` near ${testLocation}` : ""}."
- ${tierTargets.unbranded} UNBRANDED prompts — brand is NOT named at all. Tests organic discoverability. e.g. "Plan a Thanksgiving dinner for 10 under $150 with pickup near me." (and "near me" resolves to the test location if provided).

For each prompt, also produce a short "diagnostic_focus" — 2 to 8 words describing what the prompt is testing (e.g. "store-hours accuracy", "comparison ranking", "loyalty-program awareness").

Return strict JSON in this exact shape (intent_tier MUST be one of the literal strings "branded", "semi_branded", or "unbranded"):
{
  "prompts": [
    {
      "text": "the consumer-voice prompt, in ${language}",
      "intent_tier": "branded",
      "diagnostic_focus": "short label",
      "category_hint": "optional one-word topical bucket like discovery, comparison, location, use_case, hyper_specific"
    }
  ]
}`;

  console.log(
    `[generateRealisticPrompts] brand=${client.name} topics=${topics.length} competitors=${competitors.length} sector=${sector?.key ?? "none"} target=${count}`,
  );

  const openai = getOpenAIClient();
  const response = await Promise.race([
    openai.chat.completions.create({
      model: LLM_FUNCTIONS.prompts,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OpenAI prompt-generation call timed out after 60 seconds")), 60000),
    ),
  ]);

  let parsed: any;
  try {
    parsed = JSON.parse(response.choices[0].message.content || "{}");
  } catch (e) {
    console.error("[generateRealisticPrompts] JSON parse failed:", e);
    throw new Error("Prompt generator returned invalid JSON");
  }

  const raw: any[] = Array.isArray(parsed.prompts) ? parsed.prompts : [];
  const cleaned: RealisticPrompt[] = [];
  let droppedNoText = 0;
  let droppedBadTier = 0;
  let droppedPlaceholder = 0;

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) {
      droppedNoText++;
      continue;
    }
    // Reject prompts that still contain unfilled placeholders or the
    // banned "operating in <country>" pattern. Belt-and-braces.
    if (
      /\[(City|ZIP|State|Country|Industry|Brand)\]/i.test(text) ||
      /operating in\s+/i.test(text) ||
      /\bin the .{1,40} industry\b/i.test(text)
    ) {
      droppedPlaceholder++;
      continue;
    }
    const tier = normaliseTier(row.intent_tier ?? row.intentTier);
    if (!tier) {
      droppedBadTier++;
      continue;
    }
    const diagnosticFocus =
      typeof row.diagnostic_focus === "string"
        ? row.diagnostic_focus.trim()
        : typeof row.diagnosticFocus === "string"
          ? row.diagnosticFocus.trim()
          : "";
    const categoryHint =
      typeof row.category_hint === "string" && row.category_hint.trim() !== ""
        ? row.category_hint.trim()
        : null;
    cleaned.push({
      text,
      intentTier: tier,
      diagnosticFocus: diagnosticFocus || tier.replace("_", "-"),
      categoryHint,
    });
  }

  console.log(
    `[generateRealisticPrompts] kept=${cleaned.length}/${raw.length} dropped(noText=${droppedNoText}, badTier=${droppedBadTier}, placeholder=${droppedPlaceholder})`,
  );

  // Per-tier balance check (Task #89 review follow-up). After
  // dropping malformed rows the batch can end up skewed or
  // undersized. We log a warning rather than throwing so the caller
  // still gets a usable batch, but the warning surfaces in server
  // logs for operators to inspect generator quality drift.
  const MIN_TOTAL = Math.min(15, count);
  const MIN_PER_TIER = Math.max(1, Math.floor(count / 6)); // ~1/3 of expected per tier
  const tierCounts: Record<string, number> = {
    branded: 0,
    semi_branded: 0,
    unbranded: 0,
  };
  for (const p of cleaned) tierCounts[p.intentTier]++;
  const skew =
    tierCounts.branded < MIN_PER_TIER ||
    tierCounts.semi_branded < MIN_PER_TIER ||
    tierCounts.unbranded < MIN_PER_TIER;
  if (cleaned.length < MIN_TOTAL || skew) {
    console.warn(
      `[generateRealisticPrompts] WARNING: under-target or skewed batch (total=${cleaned.length}/${count}, branded=${tierCounts.branded}, semi=${tierCounts.semi_branded}, unbranded=${tierCounts.unbranded})`,
    );
  }

  return cleaned;
}

function computeTierSplit(total: number): {
  branded: number;
  semi_branded: number;
  unbranded: number;
} {
  // Even three-way split, leftover prefers unbranded then semi.
  const base = Math.floor(total / 3);
  const remainder = total - base * 3;
  return {
    branded: base,
    semi_branded: base + (remainder >= 2 ? 1 : 0),
    unbranded: base + (remainder >= 1 ? 1 : 0),
  };
}

async function generateRecommendations(clientId: string, promptRunId?: string): Promise<any[]> {
  try {
    const openaiClient = getOpenAIClient();
    const { storage } = await import('./storage');
    
    // Get client data and top citations
    const client = await storage.getClient(clientId);
    const citations = await storage.getCitationAnalysis(clientId, promptRunId);
    
    if (!client || citations.length === 0) {
      return [];
    }

    const prompt = `Analyze the following citation data for ${client.name} and provide comprehensive recommendations for improving AI assistant visibility:

Top Citations:
${citations.slice(0, 5).map(c => `- ${c.domain} (${c.url}): Used ${c.frequency} times, ${c.usagePercentage.toFixed(1)}% usage`).join('\n')}

Industry: ${client.industry || 'Unknown'}
Geography: ${client.geography || 'Global'}

Provide recommendations in the following categories with real examples:
1. AI Crawling - how to make content more accessible to AI crawlers
2. Content Availability - ensuring content is publicly available
3. Content Eligibility - making content suitable for AI training
4. Content Relevance - improving topical relevance
5. Content Visibility - enhancing discoverability by AI bots

Return a JSON object with this structure:
{
  "recommendations": [
    {
      "id": "unique-id",
      "category": "AI Crawling|Content Availability|Content Eligibility|Content Relevance|Content Visibility",
      "title": "Brief recommendation title",
      "description": "Detailed explanation",
      "severity": "high|medium|low",
      "source": "citation",
      "example": {
        "citation": "source URL",
        "content": "example content snippet",
        "issue": "identified problem"
      },
      "actionItems": ["action 1", "action 2", "action 3"]
    }
  ]
}`;

    const { buildOpenAIRequestParams } = await import('./utils/openai-compat');
    const recModel = LLM_FUNCTIONS.recommendations;
    
    const recRequestParams = buildOpenAIRequestParams(recModel, {
      messages: [
        {
          role: "system",
          content: "You are an AI visibility and SEO expert specializing in optimizing content for AI assistant discoverability."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      maxTokens: 4000,
      responseFormat: { type: "json_object" },
    });

    const response = await Promise.race([
      openaiClient.chat.completions.create(recRequestParams),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API call timed out')), 60000)
      )
    ]);

    const result = JSON.parse(response.choices[0].message.content || "{}");
    return result.recommendations || [];
  } catch (error) {
    console.error("Error generating recommendations:", error);
    throw new Error(`Failed to generate recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

const optimizedContentSchema = z.object({
  content: z.object({
    citationSource: z.string().min(1),
    topic: z.string().min(1),
    content: z.string().min(200),
    format: z.enum(["Article", "FAQ", "Guide", "Overview"]).default("Article"),
    targetKeywords: z.array(z.string()).optional(),
  }),
});

async function generateOptimizedContent(
  clientId: string,
  draftNumber = 1,
  totalDrafts = 1,
  promptRunId?: string,
): Promise<any[]> {
  try {
    const openaiClient = getOpenAIClient();
    const { storage } = await import('./storage');
    
    // Get client and top citations
    const client = await storage.getClient(clientId);
    const citations = await storage.getCitationAnalysis(clientId, promptRunId);
    const topics = await storage.getTopics(clientId);
    
    if (!client || citations.length === 0) {
      return [];
    }

    const topCitations = citations.slice(0, 5);
    const topTopics = topics.filter(t => t.accepted).slice(0, 5);

    const prompt = `Generate exactly one world-class, AI-optimized content draft for ${client.name} to improve visibility across AI assistants (ChatGPT, Claude, Gemini, etc.).

Company: ${client.name}
Industry: ${client.industry || 'Unknown'}
Geography: ${client.geography || 'Global'}
Website: ${client.website || 'N/A'}
Draft: ${draftNumber} of ${totalDrafts}

Top Citation Sources:
${topCitations.map(c => `- ${c.domain}`).join('\n')}

Key Topics:
${topTopics.map(t => `- ${t.label} (${t.category})`).join('\n')}

Create one distinct 500-800 word content piece optimized for:
1. AI assistant crawlability and indexing
2. Clear, structured information architecture
3. Rich keyword density without keyword stuffing
4. Authoritative, factual tone
5. Easy extraction by LLMs

Return JSON with exactly this structure:
{
  "content": {
    "citationSource": "target citation source domain",
    "topic": "content topic/title",
    "content": "comprehensive, well-structured content (500-800 words)",
    "format": "Article|FAQ|Guide|Overview",
    "targetKeywords": ["keyword one", "keyword two"]
  }
}`;

    const { buildOpenAIRequestParams } = await import('./utils/openai-compat');
    const contentModel = LLM_FUNCTIONS.optimizedContent;
    
    const contentRequestParams = buildOpenAIRequestParams(contentModel, {
      messages: [
        {
          role: "system",
          content: "You are a world-class content strategist specializing in creating AI-optimized content that ranks highly in AI assistant responses."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8,
      maxTokens: 3000,
      responseFormat: { type: "json_object" },
    });

    const response = await openaiClient.chat.completions.create(
      contentRequestParams,
      { timeout: 120_000, maxRetries: 0 },
    );
    const choice = response.choices[0];
    if (!choice || choice.finish_reason !== "stop") {
      throw new Error(`Content response was incomplete (${choice?.finish_reason || "unknown finish reason"})`);
    }

    const parsed = JSON.parse(choice.message.content || "{}");
    const result = optimizedContentSchema.parse(parsed);
    return [result.content];
  } catch (error) {
    console.error("Error generating optimized content:", error);
    throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

const openaiService = {
  generateRecommendations,
  generateOptimizedContent
};

export { openaiService };
