import OpenAI from 'openai';
import { z } from 'zod';
import { LLM_FUNCTIONS } from '../config/llm-functions';
import { assertVendorNotPaused } from '../config/vendor-pause';

// Lazy initialization to avoid crash if API key is missing at startup
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  // Task #78 — vendor kill switch
  assertVendorNotPaused('OpenAI');
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for prompt classification');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

const CATEGORY_SLUGS = [
  'unbranded_discovery',
  'branded_queries',
  'competitive_comparison',
  'competitor_mention',
  'location_based',
  'use_case_specific',
  'hyper_specific'
] as const;

const ClassificationResultSchema = z.object({
  category: z.enum(CATEGORY_SLUGS),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

const CLASSIFICATION_SYSTEM_PROMPT = `You are a prompt classification expert. Analyze the given prompt and classify it into one of these categories.

Return your response as JSON with the following structure:
{
  "category": "category_slug",
  "confidence": 0.95,
  "reasoning": "optional explanation"
}

Categories:

1. **unbranded_discovery**: Generic queries with no brand mentions. Tests if AI recommends the client organically.
   Examples: "What are the best project management tools?", "Top 5 CRM solutions"

2. **branded_queries**: Queries explicitly mentioning the client's brand. Tests how AI responds when brand is named.
   Examples: "Tell me about [ClientName]", "How does [ClientName] work?"

3. **competitive_comparison**: Direct competitor comparisons. Tests positioning vs rivals.
   Examples: "Compare [ClientName] vs [Competitor]", "[ClientName] versus [Competitor]"

4. **competitor_mention**: Queries mentioning competitors but not the client. Tests if AI suggests client as alternative.
   Examples: "What are alternatives to [Competitor]?", "Tools similar to [Competitor]"

5. **location_based**: Geo-targeted queries. Tests local/regional visibility.
   Examples: "Best coworking spaces in Austin", "Top restaurants in Dallas"

6. **use_case_specific**: Queries about specific needs, budgets, or categories.
   Examples: "Affordable CRM for small teams under $50/month", "Best tools for remote teams"

7. **hyper_specific**: Queries with multiple precise constraints (location + time + specs + conditions).
   Examples: "Which grocery stores within 10 miles of ZIP 75201 have a 12-14 lb turkey in stock and can deliver before 5 PM today?"

Respond only with valid JSON matching the structure above.`;

export async function classifyPrompt(promptText: string): Promise<ClassificationResult> {
  try {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: LLM_FUNCTIONS.promptClassifier,
      messages: [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: `Classify this prompt:\n\n"${promptText}"` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content);
    const result = ClassificationResultSchema.parse(parsed);

    console.log(`[PromptClassifier] Classified as "${result.category}" (confidence: ${result.confidence})`);
    
    return result;
  } catch (error) {
    console.error('[PromptClassifier] Classification error:', error);
    
    return {
      category: 'unbranded_discovery',
      confidence: 0.5,
      reasoning: 'Fallback due to classification error',
    };
  }
}

export async function classifyPrompts(promptTexts: string[]): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  
  for (const text of promptTexts) {
    const result = await classifyPrompt(text);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}
