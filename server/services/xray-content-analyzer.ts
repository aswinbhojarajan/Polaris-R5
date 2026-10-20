import OpenAI from 'openai';
import type { XRayPage, XRayPageStructure, Client } from '@shared/schema';
import { LLM_FUNCTIONS } from '../config/llm-functions';
import { assertVendorNotPaused } from '../config/vendor-pause';

// Follow same OpenAI client pattern as openai-service.ts for consistency
function getOpenAIClient(): OpenAI {
  // Task #78 — vendor kill switch
  assertVendorNotPaused('OpenAI');
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set.');
  }
  
  return new OpenAI({ apiKey });
}

// Response types for AI analysis
interface ContentGap {
  category: 'seo' | 'content' | 'structure' | 'brand' | 'accessibility';
  issue: string;
  severity: 'high' | 'medium' | 'low';
  location?: string;
}

interface Recommendation {
  effort: 'S' | 'M' | 'L'; // Small, Medium, Large
  impact: 'high' | 'medium' | 'low';
  action: string;
  rationale: string;
  category: 'seo' | 'content' | 'structure' | 'brand' | 'accessibility';
}

interface SEOIssue {
  type: 'meta' | 'heading' | 'keyword' | 'technical' | 'content';
  issue: string;
  priority: 'high' | 'medium' | 'low';
  fix: string;
}

export interface ContentAnalysis {
  assessment: string;
  gaps: ContentGap[];
  recommendations: Recommendation[];
  seoIssues: SEOIssue[];
}

/**
 * Analyze a single page's content using AI
 */
export async function analyzePageContent(
  page: XRayPage,
  structure: XRayPageStructure,
  client: Client
): Promise<ContentAnalysis> {
  const prompt = buildAnalysisPrompt(page, structure, client);
  const openai = getOpenAIClient();
  
  const { buildOpenAIRequestParams } = await import('../utils/openai-compat');
  const model = LLM_FUNCTIONS.xrayAnalyzer;
  
  const requestParams = buildOpenAIRequestParams(model, {
    messages: [
      {
        role: 'system',
        content: 'You are an expert content strategist and SEO analyst. Analyze web page content and provide actionable recommendations for improving brand visibility, SEO, and user experience. Return responses in valid JSON format.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.7,
    maxTokens: 2000,
    responseFormat: { type: 'json_object' }
  });

  const response = await openai.chat.completions.create(requestParams);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI API');
  }

  return parseAnalysisResponse(content);
}

/**
 * Analyze multiple pages in a single batch for efficiency
 */
export async function analyzeBatchPages(
  pages: Array<{ page: XRayPage; structure: XRayPageStructure }>,
  client: Client
): Promise<Map<string, ContentAnalysis>> {
  const results = new Map<string, ContentAnalysis>();
  const batchPrompt = buildBatchAnalysisPrompt(pages, client);
  const openai = getOpenAIClient();
  
  const { buildOpenAIRequestParams } = await import('../utils/openai-compat');
  const batchModel = LLM_FUNCTIONS.xrayBatch;
  
  const batchRequestParams = buildOpenAIRequestParams(batchModel, {
    messages: [
      {
        role: 'system',
        content: 'You are an expert content strategist and SEO analyst. Analyze multiple web pages and provide actionable recommendations for each. Return responses in valid JSON format with a "pages" array where each element has a "pageId" field matching the input.'
      },
      {
        role: 'user',
        content: batchPrompt
      }
    ],
    temperature: 0.7,
    maxTokens: 4000,
    responseFormat: { type: 'json_object' }
  });

  const response = await openai.chat.completions.create(batchRequestParams);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI API');
  }

  const parsed = JSON.parse(content);
  
  if (!parsed.pages || !Array.isArray(parsed.pages)) {
    throw new Error('Invalid response format: missing pages array');
  }
  
  for (const pageAnalysis of parsed.pages) {
    if (pageAnalysis.pageId) {
      results.set(pageAnalysis.pageId, {
        assessment: pageAnalysis.assessment || '',
        gaps: pageAnalysis.gaps || [],
        recommendations: pageAnalysis.recommendations || [],
        seoIssues: pageAnalysis.seoIssues || []
      });
    }
  }
  
  return results;
}

/**
 * Build AI prompt for single page analysis
 */
function buildAnalysisPrompt(
  page: XRayPage,
  structure: XRayPageStructure,
  client: Client
): string {
  // Extract structure data
  const headings = (structure.headings as any[]) || [];
  const paragraphs = (structure.paragraphs as any[]) || [];
  const lists = (structure.lists as any[]) || [];
  const entities = (structure.entities as any[]) || [];
  const topics = (structure.topics as any[]) || [];
  
  // Truncate content if too long (max ~6000 chars for prompt)
  const truncateParagraphs = paragraphs.slice(0, 20).map((p: any) => 
    p.text?.substring(0, 200) || ''
  );
  
  return `Analyze this web page for content quality, SEO, and brand visibility:

**Company:** ${client.name}
**Industry:** ${client.industry || 'Unknown'}
**Focus Areas:** ${Array.isArray(client.focusAreas) ? client.focusAreas.join(', ') : 'None specified'}

**Page Information:**
- URL: ${page.url}
- Title: ${page.title || 'Unknown'}
- Type: ${page.pageType || 'unknown'}
- Word Count: ${page.wordCount || 0}

**Content Structure:**
- Headings (${headings.length}): ${headings.slice(0, 10).map((h: any) => `${h.level}. ${h.text}`).join(', ')}
- Paragraphs: ${truncateParagraphs.length} paragraphs analyzed
- Lists: ${lists.length} lists
- Detected Entities: ${entities.map((e: any) => `${e.type}: ${e.text}`).join(', ').substring(0, 300)}
- Matched Topics: ${topics.map((t: any) => `${t.topic} (${t.relevanceScore}%)`).join(', ')}

**Sample Content:**
${truncateParagraphs.slice(0, 5).join(' ')}

**Analysis Request:**
Provide a JSON response with the following structure:
{
  "assessment": "2-3 sentence overall assessment of content quality and effectiveness",
  "gaps": [
    {
      "category": "seo|content|structure|brand|accessibility",
      "issue": "specific issue description",
      "severity": "high|medium|low",
      "location": "optional: where the issue occurs"
    }
  ],
  "recommendations": [
    {
      "effort": "S|M|L",
      "impact": "high|medium|low",
      "action": "specific actionable recommendation",
      "rationale": "why this matters",
      "category": "seo|content|structure|brand|accessibility"
    }
  ],
  "seoIssues": [
    {
      "type": "meta|heading|keyword|technical|content",
      "issue": "specific SEO problem",
      "priority": "high|medium|low",
      "fix": "how to fix it"
    }
  ]
}

Focus on:
1. Content alignment with company focus areas
2. SEO best practices (headings, keywords, meta)
3. Content depth and quality
4. Structural issues
5. Brand consistency

Provide 3-5 recommendations maximum. Be specific and actionable.`;
}

/**
 * Build AI prompt for batch page analysis
 */
function buildBatchAnalysisPrompt(
  pages: Array<{ page: XRayPage; structure: XRayPageStructure }>,
  client: Client
): string {
  const pagesData = pages.map(({ page, structure }) => {
    const headings = (structure.headings as any[]) || [];
    const paragraphs = (structure.paragraphs as any[]) || [];
    const entitiesRaw = structure.entities as any;
    const topics = (structure.topics as any[]) || [];
    
    // Flatten entities object into array
    let entitiesList: string[] = [];
    if (entitiesRaw && typeof entitiesRaw === 'object') {
      for (const [type, values] of Object.entries(entitiesRaw)) {
        if (Array.isArray(values)) {
          entitiesList.push(...values.slice(0, 5).map((v: any) => `${type}: ${v}`));
        }
      }
    }
    
    return {
      pageId: page.id,
      url: page.url,
      title: page.title || 'Unknown',
      type: page.pageType || 'unknown',
      wordCount: page.wordCount || 0,
      headings: headings.slice(0, 8).map((h: any) => `${h.level}. ${h.text}`),
      entities: entitiesList.slice(0, 15),
      topics: topics.map((t: any) => `${t.topic} (${t.relevanceScore}%)`),
      sampleContent: paragraphs.slice(0, 3).map((p: any) => p.text?.substring(0, 150)).join(' ')
    };
  });
  
  return `Analyze these ${pages.length} web pages for content quality, SEO, and brand visibility:

**Company:** ${client.name}
**Industry:** ${client.industry || 'Unknown'}
**Focus Areas:** ${Array.isArray(client.focusAreas) ? client.focusAreas.join(', ') : 'None specified'}

**Pages to Analyze:**
${JSON.stringify(pagesData, null, 2)}

**Analysis Request:**
Provide a JSON response with this structure:
{
  "pages": [
    {
      "pageId": "matching page ID from input",
      "assessment": "1-2 sentence assessment",
      "gaps": [
        {
          "category": "seo|content|structure|brand|accessibility",
          "issue": "specific issue",
          "severity": "high|medium|low"
        }
      ],
      "recommendations": [
        {
          "effort": "S|M|L",
          "impact": "high|medium|low",
          "action": "actionable recommendation",
          "rationale": "why this matters",
          "category": "seo|content|structure|brand|accessibility"
        }
      ],
      "seoIssues": [
        {
          "type": "meta|heading|keyword|technical|content",
          "issue": "SEO problem",
          "priority": "high|medium|low",
          "fix": "how to fix"
        }
      ]
    }
  ]
}

Focus on: SEO, content quality, brand alignment, structural issues.
Keep recommendations concise (2-4 per page max).`;
}

/**
 * Parse AI response into structured analysis
 * Throws on invalid JSON or malformed response - caller should retry
 */
function parseAnalysisResponse(content: string): ContentAnalysis {
  const parsed = JSON.parse(content); // Throws on invalid JSON
  
  // Validate required fields exist
  if (!parsed.assessment || typeof parsed.assessment !== 'string') {
    throw new Error('Invalid response format: missing or invalid assessment field');
  }
  
  return {
    assessment: parsed.assessment,
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    seoIssues: Array.isArray(parsed.seoIssues) ? parsed.seoIssues : []
  };
}

/**
 * Calculate priority score for pages (used for batch ordering)
 */
export function calculatePagePriority(page: XRayPage): number {
  let priority = 0;
  
  // Homepage gets highest priority
  if (page.pageType === 'home') {
    priority += 100;
  }
  
  // About/services pages are important
  if (page.pageType === 'about' || page.pageType === 'services') {
    priority += 50;
  }
  
  // Product pages
  if (page.pageType === 'product') {
    priority += 30;
  }
  
  // Pages with more content are more important
  if (page.wordCount) {
    priority += Math.min(page.wordCount / 100, 20);
  }
  
  // Other pages get base priority
  if (priority === 0) {
    priority = 10;
  }
  
  return priority;
}
