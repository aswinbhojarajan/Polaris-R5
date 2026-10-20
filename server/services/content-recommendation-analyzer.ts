import OpenAI from 'openai';
import { LLM_FUNCTIONS } from '../config/llm-functions';
import { assertVendorNotPaused } from '../config/vendor-pause';

interface PageData {
  url: string;
  title?: string;
  wordCount?: number;
  structure: {
    headings?: any[];
    paragraphs?: any[];
    entities?: any[];
    topics?: any[];
    sentimentScore?: number;
  };
  site: {
    robotsTxt?: boolean;
    aiTxt?: boolean;
    crawlAccessStatus?: string;
  };
  seoIssues?: any[];
}

interface Recommendation {
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  category: string;
  actionItems: string[];
}

export class ContentRecommendationAnalyzer {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * Analyze content for LLM readiness - how well structured is the content for AI understanding
   */
  analyzeLLMReadiness(pageData: PageData): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const headings = pageData.structure.headings || [];
    const paragraphs = pageData.structure.paragraphs || [];
    const entities = pageData.structure.entities || [];

    // Check heading structure
    const h1Count = headings.filter((h: any) => h.level === 1).length;
    if (h1Count === 0) {
      recommendations.push({
        title: 'Add clear H1 heading for AI comprehension',
        description: 'Page lacks a primary H1 heading. AI models rely on heading hierarchy to understand content structure and main topics.',
        severity: 'high',
        category: 'LLM Readiness',
        actionItems: ['Add a descriptive H1 heading that clearly states the page\'s main topic']
      });
    } else if (h1Count > 1) {
      recommendations.push({
        title: 'Use single H1 heading for better AI parsing',
        description: `Page has ${h1Count} H1 headings. Multiple H1s confuse AI models about the primary topic. Use H2-H6 for subsections.`,
        severity: 'medium',
        category: 'LLM Readiness',
        actionItems: ['Keep only one H1 heading', 'Use H2-H6 for subsections']
      });
    }

    // Check heading hierarchy
    const hasProperHierarchy = this.checkHeadingHierarchy(headings);
    if (!hasProperHierarchy) {
      recommendations.push({
        title: 'Fix heading hierarchy for AI content mapping',
        description: 'Heading levels skip (e.g., H1 → H3). AI models use hierarchical structure to understand content relationships.',
        severity: 'medium',
        category: 'LLM Readiness',
        actionItems: ['Ensure headings follow proper sequence (H1 → H2 → H3)', 'Don\'t skip heading levels']
      });
    }

    // Check for semantic richness
    if (entities.length < 3 && pageData.wordCount && pageData.wordCount > 200) {
      recommendations.push({
        title: 'Add more specific entities and terminology',
        description: 'Content lacks specific named entities (companies, products, technologies). AI models rely on entities for context and citations.',
        severity: 'medium',
        category: 'LLM Readiness',
        actionItems: ['Include specific product/service names', 'Reference relevant companies and technologies', 'Use industry-specific terminology']
      });
    }

    // Check paragraph depth
    const shortParas = paragraphs.filter((p: any) => p.text && p.text.length < 100).length;
    if (paragraphs.length > 0 && shortParas / paragraphs.length > 0.7) {
      recommendations.push({
        title: 'Expand content depth for better AI understanding',
        description: 'Most paragraphs are very short. AI models need substantial content to extract meaningful information and generate accurate citations.',
        severity: 'medium',
        category: 'LLM Readiness',
        actionItems: ['Expand key paragraphs with more detail', 'Provide concrete examples and use cases', 'Add data, statistics, or specific outcomes']
      });
    }

    return recommendations;
  }

  /**
   * Analyze content accessibility for AI crawlers
   */
  analyzeContentAccessibility(pageData: PageData): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const paragraphs = pageData.structure.paragraphs || [];
    const headings = pageData.structure.headings || [];

    // Check if content is JavaScript-heavy
    if (pageData.wordCount && pageData.wordCount < 100 && paragraphs.length < 3) {
      recommendations.push({
        title: 'Ensure content is accessible without JavaScript',
        description: 'Page appears to have minimal HTML content. AI crawlers may not execute JavaScript, missing your content entirely.',
        severity: 'high',
        category: 'Content Accessibility',
        actionItems: ['Implement server-side rendering (SSR) for critical content', 'Use progressive enhancement', 'Ensure key information is in HTML source']
      });
    }

    // Check for proper semantic HTML
    const hasSemanticContent = headings.length > 0 && paragraphs.length > 0;
    if (!hasSemanticContent) {
      recommendations.push({
        title: 'Use semantic HTML structure',
        description: 'Content lacks proper semantic elements (headings, paragraphs). AI models rely on HTML structure to understand content.',
        severity: 'high',
        category: 'Content Accessibility',
        actionItems: ['Use proper HTML5 semantic elements', 'Structure content with headings and paragraphs', 'Avoid putting all content in divs or spans']
      });
    }

    // Check word count
    if (!pageData.wordCount || pageData.wordCount < 150) {
      recommendations.push({
        title: 'Add more substantial content',
        description: 'Page has minimal text content. AI models need sufficient content to understand your offering and generate meaningful responses.',
        severity: 'high',
        category: 'Content Accessibility',
        actionItems: ['Expand content to at least 300-500 words', 'Describe products/services in detail', 'Include benefits, features, and use cases']
      });
    }

    return recommendations;
  }

  /**
   * Analyze crawlability for AI discovery
   */
  analyzeCrawlability(pageData: PageData): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Check robots.txt
    if (!pageData.site.robotsTxt) {
      recommendations.push({
        title: 'Add robots.txt for crawler guidance',
        description: 'Site lacks robots.txt file. While not blocking AI, it helps guide crawlers to important content.',
        severity: 'low',
        category: 'Crawlability',
        actionItems: ['Create robots.txt file', 'Specify allowed/disallowed paths', 'Include sitemap reference']
      });
    }

    // Check AI.txt
    if (!pageData.site.aiTxt) {
      recommendations.push({
        title: 'Consider adding AI.txt for AI crawler permissions',
        description: 'Site lacks AI.txt file. This emerging standard helps AI crawlers understand your content usage preferences.',
        severity: 'low',
        category: 'Crawlability',
        actionItems: ['Create AI.txt file', 'Specify AI crawler permissions', 'Define content usage terms']
      });
    }

    // Check crawl access
    if (pageData.site.crawlAccessStatus === 'blocked') {
      recommendations.push({
        title: 'Fix crawler blocking issues',
        description: 'Page appears to be blocked for crawlers. AI models cannot access blocked content.',
        severity: 'high',
        category: 'Crawlability',
        actionItems: ['Review robots.txt rules', 'Check meta robots tags', 'Ensure AI crawlers are allowed']
      });
    } else if (pageData.site.crawlAccessStatus === 'rate_limited') {
      recommendations.push({
        title: 'Reduce aggressive rate limiting',
        description: 'Crawlers are being rate limited. While protecting your server, this may prevent AI models from fully indexing your content.',
        severity: 'medium',
        category: 'Crawlability',
        actionItems: ['Review rate limiting rules', 'Allow reasonable crawler access', 'Consider separate limits for AI crawlers']
      });
    } else if (pageData.site.crawlAccessStatus === 'captcha') {
      recommendations.push({
        title: 'Remove CAPTCHA for verified AI crawlers',
        description: 'CAPTCHAs block AI crawlers completely. AI models cannot solve CAPTCHAs and will skip your content.',
        severity: 'high',
        category: 'Crawlability',
        actionItems: ['Whitelist known AI crawler user agents', 'Implement alternative bot detection', 'Allow access for legitimate AI crawlers']
      });
    }

    return recommendations;
  }

  /**
   * Analyze sentiment and positioning
   */
  analyzeSentiment(pageData: PageData): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const sentiment = pageData.structure.sentimentScore;

    if (sentiment !== undefined && sentiment !== null) {
      if (sentiment < -0.3) {
        recommendations.push({
          title: 'Improve content tone to be more positive',
          description: `Content sentiment is negative (${sentiment.toFixed(2)}). AI models may hesitate to recommend your services when content seems pessimistic or critical.`,
          severity: 'medium',
          category: 'Sentiment & Positioning',
          actionItems: ['Reframe negative statements positively', 'Focus on solutions rather than problems', 'Highlight successes and positive outcomes']
        });
      } else if (sentiment > -0.1 && sentiment < 0.1) {
        recommendations.push({
          title: 'Add more engaging, positive language',
          description: `Content sentiment is neutral (${sentiment.toFixed(2)}). More positive, enthusiastic language can improve AI recommendations.`,
          severity: 'low',
          category: 'Sentiment & Positioning',
          actionItems: ['Add customer success stories', 'Use more action-oriented language', 'Highlight unique value propositions']
        });
      }
    }

    return recommendations;
  }

  /**
   * Analyze prompt responses to identify visibility gaps
   */
  async analyzePromptResponse(promptText: string, responseText: string, clientName: string, competitorNames: string[]): Promise<Recommendation[]> {
    try {
      const analysisPrompt = `Analyze this AI model's response to identify visibility and positioning issues for ${clientName}.

PROMPT: "${promptText}"

AI RESPONSE: "${responseText}"

CLIENT: ${clientName}
COMPETITORS: ${competitorNames.join(', ')}

Identify specific issues:
1. Is ${clientName} mentioned? If not, why might they be missing?
2. If mentioned, how prominently? (position in response)
3. Are competitors mentioned instead? Which ones and why?
4. What qualities/attributes are being discussed that ${clientName} should highlight?
5. What specific gaps in the response suggest content improvements?

Return JSON array of recommendations with structure:
{
  "title": "specific actionable title",
  "description": "detailed explanation with evidence from the response",
  "severity": "high|medium|low",
  "category": "Prompt Response Analysis",
  "actionItems": ["specific action 1", "specific action 2"]
}`;

      // Task #78 — vendor kill switch
      assertVendorNotPaused('OpenAI');
      const completion = await this.openai.chat.completions.create({
        model: LLM_FUNCTIONS.contentRecommendation,
        messages: [
          {
            role: 'system',
            content: 'You are an AI visibility analyst. Analyze AI responses to identify why companies are or aren\'t being mentioned, and what they can do to improve their AI visibility.'
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      });

      const result = JSON.parse(completion.choices[0].message.content || '{"recommendations": []}');
      return result.recommendations || [];
    } catch (error) {
      console.error('Error analyzing prompt response:', error);
      return [];
    }
  }

  private checkHeadingHierarchy(headings: any[]): boolean {
    if (headings.length === 0) return true;

    const levels = headings.map((h: any) => h.level).sort((a: number, b: number) => a - b);
    
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        return false; // Gap in hierarchy
      }
    }
    
    return true;
  }
}
