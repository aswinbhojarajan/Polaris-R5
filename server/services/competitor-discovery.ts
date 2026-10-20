import OpenAI from "openai";
import type { Client, Competitor } from "@shared/schema";
import { LLM_FUNCTIONS } from "../config/llm-functions";
import { assertVendorNotPaused } from "../config/vendor-pause";

export interface DiscoveredCompetitor {
  name: string;
  website?: string;
  aliases: string[];
}

/**
 * Parse aliases from various formats: string[], comma-separated string, or null
 */
function parseAliases(aliases: unknown): string[] {
  if (Array.isArray(aliases)) {
    return aliases as string[];
  } else if (typeof aliases === 'string') {
    return aliases.split(',').map(a => a.trim()).filter(a => a.length > 0);
  }
  return [];
}

function getOpenAIClient(): OpenAI {
  // Task #78 — vendor kill switch
  assertVendorNotPaused('OpenAI');
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set. Please configure the API key to use competitor discovery features.');
  }
  
  return new OpenAI({ apiKey });
}

/**
 * Discovers relevant competitors using OpenAI based on client industry, geography,
 * and existing competitors. Returns up to 5 total competitors (including existing ones).
 */
export async function discoverCompetitors(
  client: Client,
  existingCompetitors: Competitor[]
): Promise<DiscoveredCompetitor[]> {
  const maxCompetitors = 5;
  
  // If we already have 5 or more competitors, return existing ones
  if (existingCompetitors.length >= maxCompetitors) {
    return existingCompetitors.map(comp => ({
      name: comp.name,
      website: comp.website || undefined,
      aliases: parseAliases(comp.aliases)
    }));
  }

  const existingNames = existingCompetitors.map(c => c.name).join(", ");
  const needCount = maxCompetitors - existingCompetitors.length;

  const prompt = `You are a competitive intelligence analyst. Analyze the following company and discover relevant competitors.

Company: ${client.name}
Website: ${client.website || 'N/A'}
Industry: ${client.industry || 'N/A'}
Geography: ${client.geography || 'Global'}
Known Competitors: ${existingNames || 'None'}

Task: Discover ${needCount} additional relevant competitors that:
1. Operate in the same industry or adjacent markets
2. Serve similar customer segments
3. Are in the same geographic region (${client.geography || 'or globally'})
4. Are close in market position (size, maturity, target market)
5. Are NOT already in the known competitors list

For each competitor, provide:
- Name (official company name)
- Website (official website URL if known)
- Aliases (common alternative names, abbreviations, or how they might be mentioned)

Return your response as JSON in this exact format:
{
  "competitors": [
    {
      "name": "Company Name",
      "website": "https://example.com",
      "aliases": ["Alias1", "Alias2"]
    }
  ]
}`;

  console.log(`Discovering competitors for: ${client.name}`);
  
  try {
    const openai = getOpenAIClient();
    const response = await Promise.race([
      openai.chat.completions.create({
        model: LLM_FUNCTIONS.competitorDiscovery,
        messages: [
          {
            role: "system",
            content: "You are a competitive intelligence expert specialized in identifying relevant market competitors based on industry, geography, and market positioning."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
      }, {
        timeout: 30000, // 30 second timeout
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API call timed out after 30 seconds')), 30000)
      )
    ]);

    console.log(`OpenAI competitor discovery successful for: ${client.name}`);
    
    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    const discovered: DiscoveredCompetitor[] = result.competitors || [];
    console.log(`Discovered ${discovered.length} new competitors for ${client.name}`);
    
    // Combine existing and discovered competitors, limit to maxCompetitors
    const allCompetitors: DiscoveredCompetitor[] = [
      ...existingCompetitors.map(comp => ({
        name: comp.name,
        website: comp.website || undefined,
        aliases: parseAliases(comp.aliases)
      })),
      ...discovered
    ];
    
    return allCompetitors.slice(0, maxCompetitors);
  } catch (error) {
    console.error("Error discovering competitors with OpenAI:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      clientName: client.name
    });
    
    // Fall back to just returning existing competitors if API fails
    return existingCompetitors.map(comp => ({
      name: comp.name,
      website: comp.website || undefined,
      aliases: parseAliases(comp.aliases)
    }));
  }
}
