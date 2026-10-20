import { z } from "zod";
import { getClient } from "../llm/client";
import { probeUrls, type ReachabilityResult } from "./url-reachability";

// Schemas for AI-generated enrichments
const urlEnrichmentSchema = z.object({
  mainUrl: z.string().url(),
  otherUrls: z.array(z.string().url()).max(2),
  focusAreas: z.array(z.string()).min(3).max(8),
});

const profileEnrichmentSchema = z.object({
  industry: z.string(),
  geography: z.array(z.string()).min(1).max(3),
  brandAliases: z.array(z.string()).min(1).max(10),
});

const competitorSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  aliases: z.array(z.string()).max(10),
});

const competitorEnrichmentSchema = z.object({
  competitors: z.array(competitorSchema).max(10),
});

export type UrlEnrichment = z.infer<typeof urlEnrichmentSchema>;
export type ProfileEnrichment = z.infer<typeof profileEnrichmentSchema>;
export type CompetitorEnrichment = z.infer<typeof competitorEnrichmentSchema>;

// Task #99 — every enrichment response that includes URLs also returns an
// advisory reachability map so the wizard can flag obviously-dead links
// before the user moves on. The map is keyed by the URL string. The
// frontend treats a missing entry as "unknown" and never blocks on it.
export type UrlEnrichmentWithReachability = UrlEnrichment & {
  reachability: Record<string, ReachabilityResult>;
};
export type CompetitorEnrichmentWithReachability = CompetitorEnrichment & {
  reachability: Record<string, ReachabilityResult>;
};

export class OnboardingEnrichmentService {
  private async getLLMClient() {
    return await getClient();
  }

  async enrichUrls(clientName: string): Promise<UrlEnrichmentWithReachability> {
    const llmClient = await this.getLLMClient();
    const prompt = `Given the company name "${clientName}", suggest:
1. The most likely official website URL (mainUrl)
2. Up to 2 additional relevant URLs like docs, help center, blog, FAQ, or press pages (otherUrls)
3. 3-8 client-specific focus areas that represent their core products, services, or business capabilities (NOT generic page types like "About" or "Contact")

Focus areas should be specific to what ${clientName} does. For example:
- For a payment company: "Payment processing", "Checkout solutions", "Subscription billing"
- For an e-commerce platform: "Online stores", "Product management", "Inventory tracking"
- For a CRM company: "Customer management", "Sales automation", "Marketing campaigns"

Return valid, reachable URLs only. Focus areas must be business-specific, not website page types.

Example output:
{
  "mainUrl": "https://example.com",
  "otherUrls": ["https://docs.example.com", "https://blog.example.com"],
  "focusAreas": ["Cloud hosting", "Database services", "API management", "Security solutions", "Analytics platform", "Developer tools"]
}`;

    const result = await llmClient.generateJson(prompt, urlEnrichmentSchema, {
      temperature: 0.3,
      maxTokens: 500,
    });

    // Task #99 — advisory reachability probe on every URL the model
    // returned. Failures here never throw; we just leave the map empty.
    let reachability: Record<string, ReachabilityResult> = {};
    try {
      const all = [result.data.mainUrl, ...result.data.otherUrls].filter(Boolean);
      reachability = await probeUrls(all);
    } catch (err) {
      console.warn("[Onboarding] URL reachability probe failed:", err);
    }

    return { ...result.data, reachability };
  }

  async enrichProfile(input: {
    name: string;
    urls?: string[];
    focusAreas?: string[];
  }): Promise<ProfileEnrichment> {
    const llmClient = await this.getLLMClient();
    const urlContext = input.urls?.length ? `\nURLs: ${input.urls.join(", ")}` : "";
    const focusContext = input.focusAreas?.length ? `\nFocus areas: ${input.focusAreas.join(", ")}` : "";

    const prompt = `Given this company:
Name: ${input.name}${urlContext}${focusContext}

Suggest:
1. Industry (single best-fit from: Accounting, Advertising & Marketing, Aerospace & Defense, Agriculture, Artificial Intelligence, Automotive, Banking, Biotechnology, Blockchain & Cryptocurrency, Business Services, Chemicals, Construction, Consulting, Consumer Goods, Cybersecurity, E-commerce, Education, Energy & Utilities, Engineering, Entertainment & Media, Environmental Services, Financial Services, Food & Beverage, Gaming, Government & Public Sector, Healthcare, Hospitality, Human Resources, Information Technology, Insurance, Legal, Logistics & Transportation, Manufacturing, Non-Profit, Pharmaceuticals, Real Estate, Retail, SaaS & Software, Sports & Fitness, Telecommunications, Tourism & Travel, Other)
2. Geography (1-3 regions from: Global, Africa, Asia, Europe, North America, Oceania, South America, Central America, Middle East, Caribbean, Southeast Asia, Eastern Europe, Western Europe, Northern Europe, Southern Europe, East Asia, South Asia, Central Asia, Sub-Saharan Africa, North Africa, Latin America, Worldwide)
3. Brand aliases (1-10 variations, abbreviations, product brands - do NOT include the exact company name "${input.name}")

Keep aliases generic and avoid duplicating the main name.

Example output:
{
  "industry": "SaaS & Software",
  "geography": ["North America", "Global"],
  "brandAliases": ["ACME", "ACME Corp", "Acme Inc.", "ACME Software"]
}`;

    const result = await llmClient.generateJson(prompt, profileEnrichmentSchema, {
      temperature: 0.3,
      maxTokens: 600,
    });

    return result.data;
  }

  async enrichCompetitors(input: {
    name: string;
    urls?: string[];
    industry?: string;
    geography?: string[];
    brandAliases?: string[];
    focusAreas?: string[];
  }): Promise<CompetitorEnrichmentWithReachability> {
    const llmClient = await this.getLLMClient();
    const urlContext = input.urls?.length ? `\nURLs: ${input.urls.join(", ")}` : "";
    const industryContext = input.industry ? `\nIndustry: ${input.industry}` : "";
    const geoContext = input.geography?.length ? `\nGeography: ${input.geography.join(", ")}` : "";
    const aliasContext = input.brandAliases?.length ? `\nBrand aliases: ${input.brandAliases.join(", ")}` : "";
    const focusContext = input.focusAreas?.length ? `\nFocus areas: ${input.focusAreas.join(", ")}` : "";

    const prompt = `Given this company:
Name: ${input.name}${urlContext}${industryContext}${geoContext}${aliasContext}${focusContext}

Suggest up to 10 direct competitors with:
- name: Company name
- url: Official website URL
- reason: Brief explanation why they're a competitor (1 sentence)
- confidence: 0-1 score (how confident you are this is a direct competitor)
- aliases: Array of 2-5 common alternative names, abbreviations, or brand variations (e.g., ["IBM", "Big Blue"] for "International Business Machines")

Return only real, verifiable competitors with valid URLs. Prioritize direct competitors in the same industry and geography.

Example output:
{
  "competitors": [
    {
      "name": "Competitor Inc",
      "url": "https://competitor.com",
      "reason": "Direct competitor offering similar SaaS products in the same market",
      "confidence": 0.95,
      "aliases": ["Comp Inc", "Competitor", "Comp"]
    }
  ]
}`;

    const result = await llmClient.generateJson(prompt, competitorEnrichmentSchema, {
      temperature: 0.4,
      maxTokens: 1500,
    });

    // Task #99 — advisory reachability probe on every competitor URL.
    let reachability: Record<string, ReachabilityResult> = {};
    try {
      const urls = result.data.competitors.map((c) => c.url).filter(Boolean);
      reachability = await probeUrls(urls);
    } catch (err) {
      console.warn("[Onboarding] Competitor reachability probe failed:", err);
    }

    return { ...result.data, reachability };
  }
}
