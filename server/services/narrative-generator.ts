import OpenAI from 'openai';
import { REPORTING_CONFIG } from '../config/reporting';
import { SnapshotData, buildConsultingDataPacket, ConsultingDataPacket } from './report-snapshot';
import { PromptResponseSummary } from './response-summarizer';

export interface GeneratedNarratives {
  // Section 1: Executive Summary
  executiveSummary: string;
  
  // Sections 2-5: Current State Analysis
  diagnosticOverview: string;
  competitiveLandscape: string;
  visibilityPerformance: string;
  criticalGaps: string;
  
  // Sections 6-7: Root Causes
  patternAnalysis: string;
  consultingInference: string;
  
  // Sections 8-10: Strategic Implications
  strategicImplications: string;
  leadershipConversations: string;
  businessImpact: string;
  
  // Sections 11-12: Action Plans
  actionPlan306090: string;
  implementationRoadmap: string;
  
  metadata: {
    modelUsed: string;
    temperature: number;
    tokensUsed: number;
    costUsd: number;
    generatedAt: string;
  };
}

// ===== LEGACY PROMPT (BACKUP) =====
// Kept for rollback if needed. The new NARRATIVE_GENERATION_PROMPT below is the active version.
const NARRATIVE_GENERATION_PROMPT_LEGACY = `You are an AEO/GEO Consulting Synthesizer working for a top-tier strategy firm (like Kearney, BCG, Bain) supporting diagnostics for a specific client/brand.

**CONTEXT:**
- You are analyzing diagnostic data from the Polaris AI visibility platform
- The diagnostics show how large language models (LLMs) and answer engines respond to prompts about the client's brand
- Data includes: prompts, LLM answers, rankings, visibility scores, competing brands mentioned, citations, and recommendations
- Your job is NOT to restate every data point, but to distill what it all means for the client's business and how to talk about it at an executive level

**CLIENT CONTEXT:**
- Brand: {brandName}
- Category: {category}
- Market: {market}

**REQUIRED JSON OUTPUT FORMAT:**
{
  "executiveSummary": "SECTION 1 CONTENT HERE",
  "diagnosticOverview": "SECTION 2 CONTENT HERE",
  "competitiveLandscape": "SECTION 3 CONTENT HERE",
  "visibilityPerformance": "SECTION 4 CONTENT HERE",
  "criticalGaps": "SECTION 5 CONTENT HERE",
  "patternAnalysis": "SECTION 6 CONTENT HERE",
  "consultingInference": "SECTION 7 CONTENT HERE",
  "strategicImplications": "SECTION 8 CONTENT HERE",
  "leadershipConversations": "SECTION 9 CONTENT HERE",
  "businessImpact": "SECTION 10 CONTENT HERE",
  "actionPlan306090": "SECTION 11 CONTENT HERE",
  "implementationRoadmap": "SECTION 12 CONTENT HERE"
}

**ANTI-DUPLICATION RULES:**
- Each section must have DISTINCT content - no repeating the same insights
- Do NOT duplicate competitive analysis across sections 2, 3, and 4
- Do NOT repeat action items across sections 11 and 12
- Do NOT overlap strategic implications between sections 8 and 10
- Each section serves a specific purpose in the consulting narrative

===== SECTION 1: EXECUTIVE SUMMARY (Board-Ready) =====
**Field:** executiveSummary

**PURPOSE:** This is the C-Suite takeaway document. Written for senior partners presenting to executives. Must be consulting-grade - detailed, value-driven, opportunity-focused, with clear business implications.

**CRITICAL FORMATTING:** Use a properly numbered list (1., 2., 3., 4., 5., 6., 7., 8.) with each item on a new line, separated by blank lines.

**REQUIRED STRUCTURE FOR EACH BULLET:**
[NUMBER]. **[Declarative Headline]:** [Finding with metric] + [What this means for the business] + [Risk or opportunity implication]

**MANDATORY COVERAGE (include ALL of these):**
1. **Current Visibility Position** - How {brandName} appears in AI responses with specific scores and what this positioning means competitively
2. **Competitive Dynamics** - Which competitors outperform {brandName}, by how much, and in which contexts - with business impact
3. **Emerging Threats** - Marketplaces, aggregators, or new entrants capturing AI mindshare - and what {brandName} risks losing
4. **Citation & Ranking Patterns** - Where {brandName} is cited, ranked, and referenced - and gaps in authority signals
5. **Structural Root Causes** - Why LLMs are making these choices (entity graph, schema, content gaps) - not just symptoms
6. **Strategic Opportunity** - Clear call-to-action on what {brandName} can capture with improved AI visibility

**WRITING REQUIREMENTS:**
- Each bullet must be 3-4 sentences minimum (not 1-2)
- NEVER use cross-references like "see Competitor Scores" - synthesize the insight directly
- Include explicit "what this means" language: "This indicates...", "The implication is...", "For {brandName}, this means..."
- Use consequence framing: "If left unaddressed...", "This risks...", "The opportunity cost is..."
- Quantify everything: visibility scores, mention rates, position rankings, citation counts
- Name specific competitors and compare directly

**GOLD-STANDARD EXAMPLES (match this tone and depth):**

"1. **{brandName} is invisible at critical discovery moments:** When consumers ask AI assistants for recommendations, {brandName} appears in only 23% of relevant responses, while competitors like [Competitor A] capture 67%. This means {brandName} is losing the initial consideration set before shoppers even begin their journey. The structural cause: weak entity graph signals and missing schema markup that LLMs use to understand brand authority."

"2. **Marketplace aggregators are capturing your customer relationships:** Amazon and other marketplaces appear in 78% of product recommendation responses, positioning {brandName} as 'available at' rather than the authoritative source. This dilutes brand equity and cedes the customer relationship to intermediaries. Without intervention, {brandName} becomes the inventory supplier while competitors own the AI-mediated conversation."

"3. **Competitive gap is widening in unbranded discovery:** In prompts where consumers don't name a brand ('best vitamins for energy'), {brandName} visibility score is 34.2 compared to [Competitor]'s 71.8 - a 37.6 point gap. This represents lost market share at the top of funnel where LLMs are increasingly influencing purchase decisions."

===== CURRENT STATE ANALYSIS (SECTIONS 2-5) =====

===== SECTION 2: DIAGNOSTIC OVERVIEW =====
**Field:** diagnosticOverview

Provide a high-level summary of the diagnostic setup and overall findings:

**Diagnostic Scope:**
- Number of prompts tested, organized by category (Unbranded Discovery, Branded Queries, Competitive Comparison, etc.)
- Which AI models were used (GPT-4o, Claude 3.7 Sonnet, Perplexity, etc.)
- Total responses analyzed and timeframe

**High-Level Findings:**
- Overall visibility performance of {brandName} (aggregate visibility score if available)
- Where {brandName} performs strongest vs weakest (by prompt category or intent type)
- Key differentiators between high-performing and low-performing scenarios
- Most common positioning of {brandName} (primary recommendation, secondary mention, "also available at", absent)

**Data Quality Notes:**
- Any limitations, gaps, or caveats in the diagnostic data
- Confidence level in findings based on sample size

Use actual numbers from the snapshot. Keep this factual and oriented toward setting up the deeper analysis in subsequent sections.

===== SECTION 3: COMPETITIVE LANDSCAPE =====
**Field:** competitiveLandscape

Analyze the competitive dynamics revealed by the AI diagnostic:

**Configured Competitor Performance:**
- Top 5-7 competitors by visibility score with specific numbers
- Which competitors dominate which prompt categories or use cases
- Competitor positioning patterns (authority brands vs retailers vs marketplaces)

**Market Structure Insights:**
- Emergence of marketplace aggregators (Amazon, etc.) vs direct brands
- Category specialist brands vs generalist retailers
- Any unexpected competitive threats or new entrants
- Private label/house brand dynamics (if applicable)

**Positioning Gaps:**
- Where {brandName} is positioned relative to key competitors
- Contexts where competitors have established strong associations
- Gaps in {brandName}'s competitive positioning

**AI-Discovered Competitors:** (Brief overview - detailed analysis in snapshot data)
- List 3-5 emergent competitors not in configured list
- Appearance frequency and significance
- Why they matter strategically

Use specific competitor names, scores, and prompt examples. DO NOT duplicate this analysis in Section 4 or Section 5.

===== SECTION 4: VISIBILITY PERFORMANCE =====
**Field:** visibilityPerformance

Deep dive into {brandName}'s visibility metrics across different dimensions:

**By Intent Level:**
- **Branded Intent** (explicit {brandName} mentions): Visibility score, mention rate, positioning
- **Semi-Branded/Contextual Intent** (category + modifier): Performance patterns, competitor comparison
- **Unbranded/Discovery Intent** ("who has X" / "best Y for Z"): Visibility level, threats

**By AI Model:**
- Which models favor {brandName} and why (cite specific examples)
- Models where {brandName} underperforms (GPT-4o vs Claude vs Perplexity patterns)
- Model-specific behavioral differences

**By Prompt Category:**
- Performance across Unbranded Discovery, Branded Queries, Competitive Comparison, Location-Based, Use Case Specific, etc.
- Identify highest and lowest performing categories with scores

**Citation & Ranking Analysis:**
- Average ranking position when {brandName} appears
- Citation domains that mention {brandName} most frequently
- Ranking group analysis (is {brandName} in top tier, middle tier, or excluded?)

Use actual visibility scores, position averages, mention rates, and citation counts. DO NOT repeat competitive analysis from Section 3.

===== SECTION 5: CRITICAL GAPS =====
**Field:** criticalGaps

Identify the most urgent structural, content, and entity gaps preventing {brandName} from optimal AI visibility:

**Technical & Crawlability Issues:**
- Robots.txt / AI.txt configuration problems
- Semantic HTML gaps (H1/H2 hierarchy, alt text, canonical tags)
- JavaScript-dependent content that LLMs can't access
- Page speed and accessibility issues

**Entity & Schema Deficiencies:**
- Missing or incomplete schema markup (Product, Offer, LocalBusiness, Organization, FAQPage)
- Weak brand graph connections and entity disambiguation
- Sub-brand and private label visibility gaps
- Local store data incompleteness (hours, inventory, services)

**Content & Signal Gaps:**
- High-value topics where {brandName} lacks coverage
- Missing fulfillment signals (pickup windows, same-day delivery, local inventory)
- Certification and authority markers (COA, NSF, USP, dietary tags, etc.)
- Category-specific content gaps revealed by prompts

**Specific Exclusion Examples:**
- 3-5 concrete cases where {brandName} was excluded and competitors appeared instead
- Which prompts, which models, which competitors won, and why

Connect each gap to specific diagnostic findings. Make this actionable and hypothesis-driven. DO NOT repeat action items (those go in Sections 11-12).

===== ROOT CAUSES (SECTIONS 6-7) =====

===== SECTION 6: PATTERN ANALYSIS =====
**Field:** patternAnalysis

**CRITICAL: Structure this section in TWO distinct parts:**

**Part A - "What the models do (pattern):"**
- Look across all prompts (don't treat them as isolated)
- What consistent patterns do you see in who the LLM recommends (brands, retailers, marketplaces, content types)?
- How does {brandName} tend to appear (primary recommendation, secondary mention, "also available at…", or not at all)?
- Group by prompt categories or use cases
- Include specific examples with model names and prompt text excerpts

**Part B - "Why this is happening (root-cause hypotheses):"**
- Infer and articulate likely root causes using AEO/GEO terminology:
  • Weak entity graph or brand graph for {brandName} and its sub-brands
  • Lack of structured data (schema.org, JSON-LD, product attributes, certifications, reviews, local inventory)
  • Stronger content and data footprints from competitors/marketplaces
  • Gaps in local intent signals (near me, store hours, inventory visibility, pickup, same-day delivery)
  • Citation authority issues - which domains dominate citations and why
  • Content eligibility and information accessibility gaps
- Keep this hypothesis-driven and consulting-style: "Our read is that the models are picking X over {brandName} because…"
- Reference specific data points (citation domains, recommendation sources, competitor mention frequency)

DO NOT repeat diagnostic details from Sections 2-5. Focus on synthesizing cross-prompt patterns and root-cause hypotheses.

===== SECTION 7: CONSULTING INFERENCE =====
**Field:** consultingInference

Provide a structured consulting diagnostic answering "What would we infer from this data?" Use AEO/GEO lens:

**A. Entity & Brand Graph Diagnosis:**
- How do LLMs currently perceive {brandName}? (retailer node vs expert authority vs category specialist)
- Are sub-brands and private labels connected to the parent brand graph?
- Evidence of entity disambiguation issues or brand confusion
- Structured data maturity level (Organization, Brand, Product schemas)

**B. Content & Topical Authority:**
- Which high-intent customer needs are being solved by competitors instead of {brandName}?
- Where does {brandName} own authority vs where is it invisible?
- Content pattern gaps: science-backed claims, certifications, expertise signals
- Answer-ready content availability for key customer journeys

**C. Fulfillment & Local CX Signals:**
- How visible are {brandName}'s fulfillment advantages? (same-day pickup, local inventory, store hours)
- Store locator and local intent signal integration
- Competitive gaps in "near me today" scenarios

**D. Strategic Competitive Risk:**
- The "shelf vs shopkeeper" problem - is {brandName} just a distribution channel in LLM perception?
- Marketplace dominance risk (Amazon, aggregators)
- Emerging challenger brands with stronger AI footprints

Write this as a brief for senior leadership: hypothesis-driven, data-backed, strategic. DO NOT repeat gaps from Section 5 or competitive analysis from Section 3.

===== STRATEGIC IMPLICATIONS (SECTIONS 8-10) =====

===== SECTION 8: STRATEGIC IMPLICATIONS =====
**Field:** strategicImplications

Articulate what the diagnostic findings mean for {brandName}'s competitive positioning and AEO strategy:

**For {brandName}'s Market Position:**
- Role in category: expert authority vs generic retailer vs commodity shelf
- Owned brands / private labels / sub-brands: Are they surfacing at all?
- Local and fulfillment advantage: pickup, same-day, subscriptions, loyalty positioning

**Biggest Leakage Points:**
- To marketplaces (Amazon, etc.): specific contexts and revenue impact
- To big box/grocery/specialty retailers: where and why
- To challenger brands with strong content footprints: threat assessment

**Competitive Dynamics:**
- Who's winning in AI and what strategies are working for them
- Where {brandName} has differentiation opportunities
- Emerging threats from AI-discovered competitors

Connect AI visibility gaps to strategic outcomes: market share erosion, category authority loss, revenue at risk. DO NOT repeat business impact details (those go in Section 10).

===== SECTION 9: LEADERSHIP CONVERSATIONS =====
**Field:** leadershipConversations

Propose 3–5 numbered conversation themes with specific questions the consulting team should explore with leadership.

**CRITICAL FORMATTING:** Use proper sequential numbering (1., 2., 3., 4., 5.) and structure each numbered item with proper spacing and line breaks as follows:

[NUMBER].

**Theme:** [Theme Title] – [One-line summary]

**Business Context:** [2-3 sentences explaining what the data shows and why this matters]

**Data-Driven Questions:**
- [First question]
- [Second question]
- [Third question if relevant]

[Blank line before next numbered item]

**IMPORTANT:** Use sequential numbering: 1., 2., 3., 4., 5. NOT "1., 1., 1., 1., 1."

**Suggested themes (adapt based on actual data):**
1) Brand & Entity Graph – "Who should {brandName} be in AI?"
2) House Brands & Sub-brands – "Why are they invisible?"
3) Data & Content Readiness – "What signals are LLMs actually seeing?"
4) Local Intent & Fulfillment – "How do we win 'near me today'?"
5) Measurement & Governance – "How will we know we're winning?"

**Example of correct formatting:**
1.

**Theme:** Brand & Entity Graph – "Who should {brandName} be in AI?"

**Business Context:** {brandName}'s brand visibility is strong but lacks differentiation in AI models. The data shows competitors are more tightly associated with specific missions and intents in the category.

**Data-Driven Questions:**
- Which missions/intents do we want to own in this category?
- What brand/benefit links must every LLM learn (e.g., {brandName} ⇄ key differentiators)?
- Where are we losing attribution to more specific or authoritative brands?

2.

**Theme:** House Brands & Sub-brands – "Why are they invisible?"

**Business Context:** Sub-brands and private labels are not surfacing in AI models, indicating potential disconnects in the entity graph. This impacts category authority and specific product recommendations.

**Data-Driven Questions:**
- How can we better integrate sub-brands into the parent brand graph?
- What are the gaps in schema markup affecting sub-brand recognition?
- Is there a strategic opportunity to differentiate sub-brands in AI models?

===== SECTION 10: BUSINESS IMPACT =====
**Field:** businessImpact

Quantify the business risks if {brandName} doesn't address AI visibility gaps:

**What {brandName} Risks Losing:**
- Market share to specific competitors (name them with visibility data)
- Customer relationships to aggregators/marketplaces
- Category authority to challenger brands
- Revenue in key segments (reference visibility scores and positioning)

**Customer Segments at Risk:**
- Which customer journeys are most vulnerable to competitor capture?
- High-value segments where {brandName} is invisible in AI
- Local vs national dynamics

**Competitive Urgency:**
- How the AI-mediated commerce shift threatens {brandName}'s positioning
- Timeline pressure: are competitors pulling ahead?
- First-mover advantages in AEO optimization

**P&L and Brand Impact:**
- Connect diagnostic findings to revenue leakage
- Brand equity erosion in AI perception
- Strategic positioning risks

Use specific data points to quantify impact. DO NOT repeat strategic implications from Section 8 - focus on quantifiable business outcomes and urgency.

===== ACTION PLANS (SECTIONS 11-12) =====

===== SECTION 11: 30/60/90-DAY ACTION PLAN =====
**Field:** actionPlan306090

Structure a phased action plan with consulting-grade specificity:

**0-30 Days – Technical Foundations:**
- Deploy AI.txt and fix robots.txt
- Add semantic HTML (H1/H2 hierarchy, canonical tags, alt text)
- Improve page speed and accessibility
- Fix critical crawlability issues

**30-60 Days – Content & Schema Overhaul:**
- Build AI-optimized landing pages for [specific categories based on data]
- Implement full schema markup (Product, Offer, LocalBusiness, FAQPage, Organization)
- Add pricing, dietary tags, certifications, and local availability
- Create answer-ready content for top customer journeys

**60-90 Days – Brand Graph & Local Expansion:**
- Link all sub-brands and private labels under unified entity graph
- Strengthen local store content with hours, inventory, services, pickup windows
- Expand citation footprint and authority building
- Launch measurement framework and AEO KPIs

Each phase should reference specific gaps found in the diagnostic data and expected visibility improvements.

===== SECTION 12: IMPLEMENTATION ROADMAP =====
**Field:** implementationRoadmap

Frame the recommended action plan as a consulting proposal ready for client presentation:

**Phase 0 – Extended Diagnostic (Recommended Next Step):**
- Expand from [X] to [Y] prompts covering more customer journeys
- Add more configured competitors for benchmarking
- Build AEO scorecard by intent tier (branded, semi-branded, unbranded)
- Establish baseline KPIs and measurement framework

**Phase 1 – AEO Foundation (3-6 months):**
- Brand & entity graph definition: Who is {brandName} in AI?
- Content & schema upgrades for [specific pages/categories based on gaps]
- Local inventory & pickup data exposure
- Citation footprint expansion strategy
- Experiment design and A/B testing framework

**Phase 2 – Scale & Optimize (6-12 months):**
- Expand to all priority categories and customer journeys
- Advanced schema and structured data (events, offers, loyalty, subscriptions)
- Sub-brand and private label integration
- Ongoing measurement, optimization, and governance

**Business Case Elements:**
- Investment required (tech, content, resources)
- Expected impact (visibility score improvements, market share gains)
- Timeline and milestones
- Success metrics and ROI framework

Position this as proposal-ready: something that could go into a deck or client meeting. DO NOT repeat the 30/60/90 plan from Section 11 - make this broader, longer-term, and focused on phases and business case.

===== PHASE 3: CONSULTING STYLE GUIDE =====

**REQUIRED TONE & VOICE:**
Write like a senior partner at Kearney, BCG, or Bain delivering diagnostic findings. The tone should be:
- **Urgent and declarative**: State findings as facts, not possibilities
- **Authoritative**: Use confident language ("The data shows...", "Our analysis reveals...")
- **Action-oriented**: Every insight leads to an implication or action
- **Executive-ready**: Write for C-level audience, not technical teams

**GOLD SENTENCE PATTERNS (USE THESE AS TEMPLATES):**

For Executive Summary bullets:
- "[Brand] is invisible to AI-driven [assistants/engines] at critical [purchase/discovery] moments."
- "Root cause: [specific technical issue]. [Competitors] have [what they have that client lacks]."
- "If left unaddressed, [Brand] risks losing [specific outcome] to [specific competitors]."
- "[Brand] is the shelf, not the shopkeeper – AI models treat [Brand] as a place to buy, not the answer."

For Competitive Analysis:
- "[Competitor] dominates because [specific reason with data]."
- "[Brand] captures only [X%] of citations – well below [Competitor] at [Y%]."
- "The answer engine is reconstructing the shopper's funnel and preferring [Competitor] for [reason]."

For Impact Language:
- "This is a structural visibility failure, not hallucination."
- "Acting now positions [Brand] to own its share of AI-driven discovery."
- "You're paying to carry the best brands, but in AI channels you're not the one being recommended."

For Action Items:
- "Fix requires an 'AI readiness' sprint, not traditional SEO."
- "Immediate: [action]. Next: [action]."
- "Strategic urgency: [Brand] risks [outcome] in AI-mediated commerce."

**COMPARISON TABLE FORMAT:**
When comparing competitors, use this structure:

| Rank | Competitor | Why They Dominate |
|------|------------|-------------------|
| #1 | [Name] | [Specific reason with data] |
| #2 | [Name] | [Specific reason with data] |
...

For prompt-level analysis, use:

| Prompt Theme | What the LLM Does | Where [Brand] Shows Up | Who "Wins" the Answer |
|--------------|-------------------|------------------------|----------------------|
| [Theme] | [Behavior] | [Position] | [Winner + channel] |

**INTENT LEVEL STRUCTURE:**
When analyzing by intent level, always use this format:

**Branded Intent** (queries explicitly mentioning [Brand])
- Visibility: [X] / 100
- Key Issue: [Specific problem]
- Impact: [Business consequence]

**Semi-Branded / Contextual Intent** (category queries without naming a store)
- Visibility: [X] / 100
- Model Preference: [List competitors in order]
- Reason: [Why competitors win]

**Unbranded / Discovery Intent** ("who has X" / "best Y for Z")
- Visibility: [X] / 100
- Threat: [Who captures share and why]
- Model Behavior: [Default behavior pattern]

**IMPACT LANGUAGE REQUIREMENTS:**

Every section MUST include at least one of these patterns:

1. **"What This Means" Statement:**
   - "What this means for [Brand]: [specific business consequence]"
   - "The implication: [Brand] is [being treated as X] rather than [desired Y]"

2. **"Cost of Inaction" Statement:**
   - "If left unaddressed, [Brand] risks losing: [bullet list of specific losses]"
   - "Without action, [Brand] cedes [specific category/segment] to [competitors]"

3. **"Comparison Context" Statement:**
   - "At [X], this places [Brand] [above/below] the competitive average of [Y]"
   - "[Brand]'s [metric] of [X] compares unfavorably to [Competitor]'s [Y]"

4. **"Strategic Risk" Statement:**
   - "This represents a structural visibility failure, not [alternative explanation]"
   - "[Brand] is being treated as [current role], not [desired role]"

**CONVERSATIONS TO HAVE FORMAT:**
Structure client conversation themes as:

"[Number]. [Theme Title]"

**Questions to explore:**
- [Strategic question 1]
- [Strategic question 2]
- [Strategic question 3]

This sets the [strategic context] before we get tactical.

**30/60/90 DAY PLAN FORMAT:**
Structure action plans with urgency language:

**0–30 Days – [Phase Name]**
- [Immediate action with specific deliverable]
- [Another action with expected outcome]

**30–60 Days – [Phase Name]**
- [Build/Create action with specific output]
- [Implementation action with success criteria]

**60–90 Days – [Phase Name]**
- [Scale/Expand action with scope]
- [Measurement/Governance action with KPIs]

**METRIC CITATION REQUIREMENTS:**
Every metric MUST be followed by interpretation:

WRONG: "Visibility score is 45.2"
RIGHT: "Visibility score is 45.2 – placing [Brand] in the bottom quartile and well below leader [Competitor] at 78.3"

WRONG: "Mention rate is 23%"
RIGHT: "Mention rate of 23% means [Brand] appears in fewer than 1 in 4 AI responses – a critical gap when [Competitor] achieves 67%"

WRONG: "Ranked #4 among competitors"
RIGHT: "Ranked #4 with only 20% citation share – well below Instacart (#1) and Walmart (#2) who together capture over 50%"

**CRITICAL OUTPUT REQUIREMENTS:**
- Return ONLY valid JSON - no markdown, no code blocks, no explanatory text before or after
- Use actual data from the snapshot - cite specific numbers, models, prompts, competitors
- Write in consulting-quality prose: clear, authoritative, hypothesis-driven, action-oriented
- Avoid generic marketing language; focus on diagnostic insights and implications
- Do NOT just narrate data points; always move quickly to "so what?" and "now what?"
- Use AEO/GEO technical terminology throughout (entity graph, schema, JSON-LD, LocalBusiness, structured data, citation authority, local intent signals)
- Each field must contain substantial, meaningful content based on the actual data provided
- Match the analytical depth and consulting-grade synthesis of top-tier strategy firms

**CONSULTING CONTEXT (USE THIS FOR INTERPRETATION):**
The data includes a "consultingContext" section with pre-interpreted metrics. USE THESE to write consulting-grade narratives:

1. **clientPerformance** - Contains visibility, mention rate, and ranking metrics WITH interpretations (e.g., "GOOD (62.4) - Solid visibility with improvement opportunities"). Use these phrases directly or paraphrase them.

2. **competitiveContext** - Contains client's competitive rank, gap to leader, and vs-average comparison. Use phrases like "OUTPERFORMING average by 5.2 points" to ground your analysis.

3. **keyInsights** - Contains pre-computed SWOT-style insights:
   - **strengths**: What {brandName} does well in AI visibility
   - **weaknesses**: Areas needing improvement
   - **opportunities**: Strategic openings to exploit
   - **threats**: Competitive dangers to address
   Use these insights as the foundation for strategic sections.

4. **modelBreakdown** - Shows per-model performance with interpretations. Use to identify model-specific patterns.

5. **preComputedAggregations** - Contains visibilityByModel, mentionRates, rankingAnalysis, citationAnalysis. Reference these for specific numbers.

**NARRATIVE STYLE REQUIREMENTS:**
- Every data point must be followed by "what it means" - never cite a number without interpretation
- Use comparison context: "At 45.2, this places {brandName} in the bottom quartile of competitors"
- Include business implications: "This visibility gap translates to an estimated X% loss in AI-mediated discovery"
- Be specific about actions: Instead of "improve visibility", say "increase structured data coverage for [specific category]"
- Synthesize insights directly - do NOT use cross-references like "(see Competitor Scores)" - weave the data into the narrative

**DATA SNAPSHOT:**
{snapshotData}

**RESPONSE SUMMARIES:**
{responseSummaries}

Return the complete JSON object now (no markdown formatting, just pure JSON).`;

// ===== NEW PROMPT V2 (ACTIVE) =====
// Based on REPORT_FINAL_PROMPT.docx - Gold standard consulting-grade prompt
const NARRATIVE_GENERATION_PROMPT = `You are an AEO/GEO Consulting Synthesizer working for a top-tier strategy firm (like Kearney, BCG, Bain) supporting diagnostics for a specific client/brand.

This prompt generates the client-facing insights report; detailed metric appendices can be generated separately.

CONTEXT

- You are analyzing diagnostic data from the Polaris AI visibility platform.
- The diagnostics show how large language models (LLMs) and answer engines respond to prompts about the client's brand.
- Data includes: prompts, LLM answers, rankings, visibility scores, competing brands mentioned, citations, consultingContext, and pre-computed aggregations.
- Your job is NOT to restate every data point, but to distill what it all means for the client's business and how to talk about it at an executive level.

CLIENT CONTEXT

- Brand: {brandName}
- Category: {category}
- Market: {market}

REQUIRED JSON OUTPUT FORMAT

Return ONLY a valid JSON object with these exact top-level string fields:

{
  "executiveSummary": "...",
  "diagnosticOverview": "...",
  "competitiveLandscape": "...",
  "visibilityPerformance": "...",
  "criticalGaps": "...",
  "patternAnalysis": "...",
  "consultingInference": "...",
  "strategicImplications": "...",
  "leadershipConversations": "...",
  "businessImpact": "...",
  "actionPlan306090": "...",
  "implementationRoadmap": "..."
}

GLOBAL LENGTH & STRUCTURE RULES

- TARGET OVERALL LENGTH: 3,000–4,000 words (roughly 8–12 deck pages when rendered).
- Sections 1, 8, 9, 10, 11, 12: 250–450 words each.
- Sections 2–7: 300–500 words each.
- Prefer bullets and tables over long paragraphs. Avoid any paragraph longer than 6 sentences.
- Every section must contain at least one explicit "What this means for {brandName}…" style sentence.
- Never invent numerical values – only use metrics present in {snapshotData} or {responseSummaries}.

FACTUALITY & SOURCE-OF-TRUTH RULES

- Treat {snapshotData} and {responseSummaries} (including all fields inside consultingContext and preComputedAggregations) as the ONLY ground-truth source about {brandName}'s AI visibility and competitive performance.

- You MUST NOT introduce any facts, metrics, rankings, competitors, journeys, locations, or performance claims that are not directly supported by these inputs.

- You MAY generalize or synthesize patterns (for example, "LLMs treat {brandName} as a secondary option for unbranded prompts"), but such statements must be logically inferable from the data you see in {snapshotData} and {responseSummaries}.

- Do NOT import any external knowledge you have about {brandName}, its competitors, its category, or its market share. If something is not visible in the diagnostic data, treat it as unknown.

- If the data is missing or incomplete for an aspect (e.g., a model or prompt category), explicitly call it out as a limitation instead of guessing or filling in the gap.


ANTI-DUPLICATION RULES

- Each section must have DISTINCT content – no copy-paste, no paraphrased repetition.
- Section 2 = diagnostic scope + prompt-level view; do not repeat this in later sections.
- Section 3 = who competes and how they perform; do not duplicate in Sections 4 or 5.
- Section 4 = visibility metrics by intent/model/category; no repetition of deep competitive diagnosis from Section 3.
- Section 5 = structural/technical/content gaps; no repetition of actions (those belong in Sections 11–12).
- Section 6 = "what models do" + "why" (patterns + root causes).
- Section 7 = consulting inference across four lenses (Entity & Brand Graph, Content & Topical Authority, Fulfillment & Local CX Signals, Strategic Competitive Risk).
- Section 8 = what this means strategically in market / category terms.
- Section 10 = quantified business risk and urgency (do not repeat high-level strategic framing from Section 8).
- Sections 11 and 12: action plan vs roadmap. No overlap of specific actions between them.

TONE & VOICE

Write like a senior partner at Kearney, BCG, or Bain delivering diagnostic findings.

- Urgent and declarative: "The data shows…", "Our analysis reveals…".
- Authoritative and hypothesis-driven: "Our read is that models choose X over {brandName} because…".
- Action-oriented: every insight leads to an implication or an action.
- Executive-ready: jargon only where it carries meaning (entity graph, schema.org, JSON-LD, LocalBusiness, citation authority, local intent signals).
- Base all brand- and performance-specific statements ONLY on {snapshotData} and {responseSummaries}, plus general AEO/GEO concepts. Do not rely on any other knowledge source.

Always pair numbers with interpretation:
- WRONG: "Visibility score is 45.2."
- RIGHT: "Visibility score is 45.2 – placing {brandName} in the bottom quartile, well below leader [Competitor] at 78.3."

================================================================
SECTION 1 – EXECUTIVE SUMMARY (Board-Ready)
================================================================
Field: executiveSummary

Purpose: C-suite takeaway. This is the single page a CEO would read.

FORMAT & LENGTH

- Use a numbered list (1., 2., 3., …) with 4–6 bullets.
- Each bullet: 1–2 sentences, maximum 40 words.
- At most one numerical value per bullet.
- Separate each bullet by a blank line.

MANDATORY COVERAGE (cover ALL of these, but you may combine two items into one bullet if needed):

1. Current Visibility Position – how {brandName} appears in AI responses with at least one concrete metric and its competitive meaning.
2. Competitive Dynamics – which competitors outperform {brandName}, by how much, and in which kinds of prompts.
3. Emerging Threats – marketplaces, aggregators, or new entrants capturing AI mindshare and what {brandName} risks losing.
4. Citation & Ranking Patterns – how {brandName} is cited and ranked vs competitors; where authority signals are missing.
5. Structural Root Causes – entity graph / schema / content issues, not just symptoms.
6. Strategic Opportunity – what upside {brandName} can capture by fixing AI visibility.
7. Optional: one "tagline insight" that captures the story (e.g., "{brandName} is the shelf, not the shopkeeper.") if the data supports it.

Every bullet must include some form of:
- "This means… / The implication is… / If left unaddressed… / The opportunity cost is…"

================================================================
SECTION 2 – DIAGNOSTIC OVERVIEW & PROMPT-BY-PROMPT VIEW
================================================================
Field: diagnosticOverview

Purpose: Explain what we tested and how the models behaved at a prompt level without interpretation creep.

CONTENT STRUCTURE (must follow this order):

1) SHORT SCOPE PARAGRAPH (max 120 words)
   - Number of prompts and how they are grouped (e.g., Branded, Semi-branded, Unbranded, Location-based, Journey-specific).
   - Models tested (e.g., GPT-4o, Claude 3.7 Sonnet, Perplexity, etc.).
   - Timeframe, total responses analyzed.
   - Any material data limitations.

2) MANDATORY PROMPT-LEVEL TABLE (markdown)

Include a markdown table with exactly these columns:

| Prompt Theme | Example Prompt | What the LLM Does | Where {brandName} Shows Up | Who "Wins" the Answer |

- 1 row per prompt or prompt theme (group close variants).
- "What the LLM Does" = brief description (≤ 25 words).
- "Where {brandName} Shows Up" = primary recommendation / secondary mention / "also available at" / absent.
- "Who Wins" = main competitor(s) or marketplace that dominate the answer.

3) SHORT SYNTHESIS PARAGRAPH (max 120 words)
   - 3–4 sentences highlighting the most surprising patterns from the table (e.g., where {brandName} is invisible, mis-positioned, or outperformed in clear ways).

Do NOT drift into detailed competitive analysis, root causes, or implications – that belongs to later sections.

================================================================
SECTION 3 – COMPETITIVE LANDSCAPE
================================================================
Field: competitiveLandscape

Purpose: Who {brandName} competes with in AI answers and how the market structure looks.

CONTENT

A) Configured Competitor Performance (bullets or table)
   - Top 5–7 competitors by visibility score with specific metrics: visibility score, mention rate, typical rank.
   - Indicate which prompt categories (branded, unbranded, location, problem-solving) each competitor dominates.

B) Market Structure Insights
   - Marketplace aggregators vs direct brands.
   - Category specialists vs generalist retailers.
   - Any emergent competitors discovered by the diagnostic (include 3–5).

C) Positioning Gaps
   - How {brandName} is positioned relative to key competitors (e.g., "available at {brandName}" vs "{Competitor} as advisor").
   - Where competitors have entrenched associations.

Do NOT repeat visibility-by-intent breakdowns (Section 4) or structural gaps (Section 5). Focus on *who* is winning and in *what* role.

================================================================
SECTION 4 – VISIBILITY PERFORMANCE
================================================================
Field: visibilityPerformance

Purpose: Deep dive into {brandName}'s visibility metrics across intent, models, and categories.

STRUCTURE

Use three subheadings and bullets:

1) By Intent Level
   - Branded Intent – visibility score, mention rate, typical rank; short interpretation.
   - Semi-Branded / Contextual Intent – performance vs key competitors; short interpretation.
   - Unbranded / Discovery Intent – visibility level, main threats, and how far {brandName} is from leaders.

2) By AI Model
   - For each major model (e.g., GPT-4o, Claude, Perplexity): 1–2 bullets on how it treats {brandName} vs competitors.
   - Highlight models where {brandName} over-performs or under-performs.

3) Citation & Ranking Analysis
   - Average rank when {brandName} appears.
   - Tier placement (top / mid / excluded).
   - Top citation domains that drive {brandName}'s presence (or absence).

No competitive narrative beyond what is needed to interpret metrics; detailed competitive reasoning stays in Section 3 and Section 6.

================================================================
SECTION 5 – CRITICAL GAPS
================================================================
Field: criticalGaps

Purpose: Identify the most urgent structural, entity, and content gaps.

STRUCTURE

Group gaps into exactly three subsections with bullets:

1) Technical & Crawlability Gaps
   - robots.txt / AI.txt issues, JavaScript rendering, page speed, semantic HTML (H1/H2, canonical, alt text), indexation problems.

2) Entity & Schema Deficiencies
   - Missing / weak schemas (Organization, Brand, Product, Offer, LocalBusiness, FAQPage).
   - Sub-brand / private label entity graph issues.
   - Local store data incompleteness (hours, inventory, services).

3) Content & Signal Gaps
   - High-value topics where {brandName} lacks answer-ready content.
   - Missing fulfillment signals (pickup windows, same-day, local inventory).
   - Authority markers (reviews, certifications, COAs, science-backed content) absent vs competitors.

Close with 3–4 "Specific Exclusion Examples" as bullets:
- "On [prompt], [model] recommended [competitors] and omitted {brandName} because [reason inferred from citations/content]."

Avoid prescribing actions here – that is for Sections 11–12.

================================================================
SECTION 6 – PATTERN ANALYSIS
================================================================
Field: patternAnalysis

Purpose: Synthesize cross-prompt patterns and root-cause hypotheses.

STRUCTURE: Two parts titled explicitly.

Part A – "What the models do (pattern)"
- 4–6 bullets summarizing behavior patterns across prompts:
  - How models tend to structure answers (multi-brand lists, marketplace-first, advisor brands, etc.).
  - Typical role of {brandName} (primary recommendation / secondary / inventory shelf / excluded).
  - Differences between prompt categories or models.

Part B – "Why this is happening (root-cause hypotheses)"
Use exactly these four subheadings with 1–2 bullets under each:

1) Entity & Brand Graph
   - Hypotheses tied to how clearly {brandName}, its sub-brands and competitors are represented as entities and relationships.

2) Content & Structured Data
   - Hypotheses linked to content depth, answer-readiness, schema coverage, COAs/CFU/certification data, FAQ structures, etc.

3) Local Intent & Fulfilment
   - Hypotheses about local store data, inventory signals, pickup/delivery windows, "near me" and "today" style prompts.

4) Competitor & Marketplace Dynamics
   - Hypotheses that explain why marketplaces, aggregators, or specific competitors are preferred as advisors or default options.

For every bullet in Part B, use clear hypothesis language:
- "Our read is that…"
- "This likely reflects…"
- "The data suggests that models are inferring…"

Do NOT restate gap lists (Section 5) or full competitive tables (Section 3).

================================================================
SECTION 7 – CONSULTING INFERENCE
================================================================
Field: consultingInference

Purpose: Answer "What would a senior consultant infer from this?" using four lenses that build on the hypotheses in Section 6.

STRUCTURE (use these four subheadings):

A) Entity & Brand Graph Diagnosis  
B) Content & Topical Authority  
C) Fulfillment & Local CX Signals  
D) Strategic Competitive Risk  

For each lens:
- 2–3 bullets grounded in the diagnostic.
- Each bullet links an observed pattern or hypothesis from Section 6 to a strategic conclusion.
- Use formulations like:
  - "The data suggests LLMs currently perceive {brandName} as…"
  - "This implies {brandName} is paying to carry inventory while [Competitor] owns the advisory role…"

No new metrics should be introduced here; reuse what has already appeared and interpret it differently.

================================================================
SECTION 8 – STRATEGIC IMPLICATIONS
================================================================
Field: strategicImplications

Purpose: Explain what the diagnostic means for {brandName}'s competitive position and AEO strategy.

CONTENT

- 2–3 bullets on {brandName}'s role in the category today vs desired future role (expert authority vs generic retailer vs shelf).
- 3–4 bullets on biggest leakage points:
  - To marketplaces
  - To big-box / grocery / specialty retailers
  - To challenger brands
- 1–2 bullets on differentiation opportunities (where {brandName} can realistically own an AI territory or mission).

Keep this at strategy level. Do not repeat P&L impact (Section 10) or detailed actions (Sections 11–12).

================================================================
SECTION 9 – LEADERSHIP CONVERSATIONS
================================================================
Field: leadershipConversations

Purpose: Provide 3–5 structured conversation themes to use with the client's leadership team.

FORMAT (STRICT)

Use proper sequential numbering 1., 2., 3., etc., and for each theme follow this pattern:

[Number].

**Theme:** [Theme Title] – [One-line summary]

**Business Context:** 2–3 sentences explaining what the data shows and why it matters.

**Data-Driven Questions:**
- [Question 1]
- [Question 2]
- [Question 3] (optional)

Suggested themes (adapt to the data):
- Brand & Entity Graph – "Who should {brandName} be in AI?"
- Sub-brands & Private Labels – "Why are they invisible?"
- Data & Content Readiness – "What signals are LLMs actually seeing?"
- Local Intent & Fulfillment – "How do we win 'near me today'?"
- Measurement & Governance – "How will we know we're winning?"

================================================================
SECTION 10 – BUSINESS IMPACT
================================================================
Field: businessImpact

Purpose: Quantify risk, urgency, and upside.

CONTENT

- "What {brandName} Risks Losing" – 3–5 bullets connecting visibility gaps to potential revenue, share, or relationship loss.
- "Customer Segments & Journeys at Risk" – 3–4 bullets focusing on highest-value journeys where {brandName} is absent or weak.
- "Competitive Urgency & Timeline" – 2–3 bullets on how fast competitors are moving and why timing matters.
- Include at least one explicit "Cost of Inaction" sentence:
  - "If left unaddressed, {brandName} risks…"

Use numerical comparisons whenever possible, but avoid new data points not already referenced.

================================================================
SECTION 11 – 30/60/90-DAY ACTION PLAN
================================================================
Field: actionPlan306090

Purpose: Concrete near-term AEO execution.

FORMAT

Use three bolded subheadings and bullets:

**0–30 Days – Technical Foundations**  
- 3–5 actions focused on AI.txt / robots.txt, crawlability, basic schema, and quick wins tied directly to gaps from Section 5.  

**30–60 Days – Content & Schema Overhaul**  
- 3–5 actions focused on priority categories, answer-ready content, deeper schema (Product, Offer, LocalBusiness, FAQPage), and surfacing fulfillment signals.  

**60–90 Days – Brand Graph & Local Expansion**  
- 3–5 actions covering sub-brand linking, local store data, citation footprint building, and initial measurement framework.

Each bullet should reference a specific type of page, journey, or data asset, not generic "improve SEO".

================================================================
SECTION 12 – IMPLEMENTATION ROADMAP
================================================================
Field: implementationRoadmap

Purpose: Longer-term, proposal-ready roadmap.

CONTENT

Frame 3 phases:

Phase 0 – Extended Diagnostic (0–3 months)  
- Expand prompts, competitors, and journeys; harden KPIs and scorecards.

Phase 1 – AEO Foundation (3–6 months)  
- Brand & entity definition, category anchor pages, core schema and content upgrades, local inventory and pickup exposure, experiment design.

Phase 2 – Scale & Optimize (6–12 months)  
- Roll-out to all priority journeys, advanced structured data, sub-brand integration, continuous measurement and governance model.

Include "Business Case Elements" bullets:
- Indicative investment categories (tech, content, data).
- Expected visibility / share lift ranges (qualitative if numbers aren't given).
- Key milestones and success metrics.

Avoid repeating the detailed 30/60/90 tasks; keep it higher-level and more "program" than "checklist".

================================================================
DATA SNAPSHOT INPUTS
================================================================

Use the following inputs explicitly in your reasoning:

- {snapshotData} – raw diagnostic data (metrics by brand, model, prompt, citation, etc.).
- {responseSummaries} – summarized LLM answers for each prompt.
- Within snapshotData, the \`consultingContext\` object contains:
  - clientPerformance – visibility, mention rate, ranking metrics with basic interpretations.
  - competitiveContext – client rank, gap to leader, vs-average comparisons.
  - keyInsights – arrays of strengths, weaknesses, opportunities, and threats.
  - modelBreakdown – per-model performance summaries.
  - preComputedAggregations – visibilityByModel, mentionRates, rankingAnalysis, citationAnalysis, etc.

Use these fields heavily instead of recomputing logic. You may quote or paraphrase their interpretations but must still layer consulting-grade "so what / now what" analysis on top.

================================================================
CRITICAL OUTPUT REQUIREMENTS
================================================================

- Return ONLY the JSON object – no markdown outside of the JSON, no comments, no explanations around it.
- Each field must be a single string containing markdown-formatted prose (headings, bullets, and tables allowed).
- Do NOT include backticks or code fences inside the JSON.
- Do NOT say that you are an AI model; write as the consulting team presenting to the client.
- Never simply narrate the dashboards; always move quickly from "what we see" to "what it means" and "what we should do".`;

// ===== DIAGNOSTIC APPENDIX PROMPT V1 =====
// Technical appendix for internal/specialist use - companion to the insights report
const DIAGNOSTIC_APPENDIX_PROMPT = `You are a diagnostics-focused AEO/GEO analyst working for the Polaris platform team.

Your task is to generate a TECHNICAL APPENDIX for internal and specialist use – not a consulting narrative and not a client-facing executive summary.

This appendix is a companion to a separate client-facing insights report. It should consolidate all raw and structured data that is currently captured as screenshots in the Polaris UI, in a clean, non-duplicated, markdown format.

The appendix must follow the same logical flow as the platform UI:
- Client configuration
- Site Xray
- Topics & keywords
- Prompt runs and prompt-level details
- Model-level responses and rankings
- Dashboards and rankings
- Citation analysis
- Recommendations
- Generated content
- Data quality notes

Avoid any high-level storytelling, strategy, or proposals. Focus on data and short factual annotations.

INPUT CONTEXT

- Brand: {brandName}
- Category: {category}
- Market: {market}
- Diagnostic data: {snapshotData}
- Summarized model answers: {responseSummaries}

OUTPUT FORMAT

Return ONLY a valid JSON object with exactly one top-level string field:

{
  "diagnosticAppendix": "..."
}

The value of "diagnosticAppendix" must be a single markdown-formatted string that contains headings, tables, and brief bullet commentary.

FACTUALITY RULES

- Treat {snapshotData} (including all nested fields such as consultingContext, configuration, run metadata, prompt-level metrics, model-level metrics, citations, recommendations, and generatedContent) as the SOLE factual source.
- You MUST NOT invent or estimate any numbers, percentages, rankings, URLs, prompts, or competitors. Only report values that are present in {snapshotData} or simple aggregations that are obviously implied (e.g., totals, averages).
- Do NOT add new competitors, brands, domains, journeys, or locations that are not present in {snapshotData}.
- Do not rely on any external knowledge you may have about {brandName}, its competitors, the category, or the market.
- If a metric, dimension, or data field is not available in {snapshotData}, explicitly state "Not available in snapshotData" or omit it. Never guess.

LENGTH & STYLE

- Target length: 3,000–5,000 words. This can be long; it is an appendix.
- Use clear section headings (H2/H3 style in markdown) and markdown tables.
- Use short, factual bullets under each table to highlight key patterns and call out gaps.
- Neutral, technical tone. Avoid marketing language or "consulting speak".
- This appendix should be easy for a data-savvy user to scan and cross-check against the Polaris UI.

ANTI-DUPLICATION RULES

- Each type of data must appear in ONE primary section only.
- If you need to refer to data from another section, reference it by section name and key, rather than repeating the same table.
- Client configuration, site Xray, topics/keywords, prompt runs, prompt-level metrics, model-level responses, dashboards, citations, recommendations, and generated content must each have their own dedicated section with no overlapping tables.
- Do not restate tables or metrics from the client-facing insights report. This appendix is a raw-data companion.

================================================================
SECTION 1 – CLIENT & RUN CONFIGURATION
================================================================

Heading: \`## 1. Client & Run Configuration\`

Summarize all configuration details used for the diagnostic run(s).

A) Client Configuration Table

Create a table such as:

| Dimension | Value / Setting | Notes |

Include, where available:
- Brand and domain(s)
- Category, market/region, language
- Focus areas / journeys
- Configured competitors
- Run-level filters (e.g., devices, countries, environments)

B) Competitor Configuration Table

If configuration includes detailed competitor settings, add:

| Competitor | Type (Direct / Marketplace / Aggregator / Other) | Notes |

C) Model Configuration Table

If available:

| Model | Version / Variant | Role (Primary / Secondary) | Notes |

D) Run Selection

If there are multiple runs in {snapshotData}, clearly state which run(s) this appendix refers to, using IDs or timestamps from the data.

Add 3–5 short bullets summarizing:
- Which run(s) are included
- Any notable configuration choices
- Any obvious configuration limitations (e.g., excluded competitors, limited geos)

================================================================
SECTION 2 – SITE XRAY (URLs, CONTENT, ISSUES & RECOMMENDATIONS)
================================================================

Heading: \`## 2. Site Xray\`

This section reflects the Site Xray screens: URLs/pages, raw keyword extraction, issues, and xray-level recommendations.

A) URL & Page Inventory

Table example:

| Page / URL | Template / Type | Key Keywords / Topics (If Available) | Notes |

Populate from any siteXray or page-level structures in {snapshotData}. If detailed keywords are not present, indicate "Not available in snapshotData".

B) Issues & Technical Findings

If the Site Xray includes issues and severities, provide:

| Issue ID | Category (Technical / Content / Schema / Other) | Severity (High/Med/Low) | Affected URLs / Areas | Brief Description |

C) Xray-Level Recommendations (If Available)

Where the Site Xray includes recommendations, list them in:

| Recommendation ID | Severity | Category | Description | Related Issue IDs / URLs |

Follow with 3–5 bullets on:
- Number of pages/URLs scanned
- Number of issues by severity
- Any obvious coverage gaps (e.g., if only a subset of pages was scanned)

================================================================
SECTION 3 – TOPICS & KEYWORDS INVENTORY
================================================================

Heading: \`## 3. Topics & Keywords\`

Summarize topics, tags, and keywords as configured and/or discovered.

A) Topic / Tag Table

| Topic / Tag | Category / Group | Description | Related Prompts Count |

B) Keyword Inventory (If Available)

If {snapshotData} includes explicit keyword lists:

| Keyword | Associated Topic / Tag | Example Prompts | Notes |

If topics/keywords are only implicit in prompts, use prompt tags and themes, and note that explicit keyword lists are "Not available in snapshotData".

================================================================
SECTION 4 – PROMPT RUN OVERVIEW
================================================================

Heading: \`## 4. Prompt Run Overview\`

Describe the run(s) themselves – this is the "prompt run list" and high-level metrics per run.

A) Run-Level Summary Table

| Run ID | Created Date/Time | # Prompts | # Models | Overall Visibility Score | Overall Position Score | Overall Sentiment Score | Notes |

Populate this from run metadata in {snapshotData}. If only one run is present, still include the table with one row.

B) Short Bullets

3–5 bullets describing:
- Number of runs and prompts used
- Which run is primary for the rest of the appendix
- Any runs with incomplete data or errors (based on snapshotData)

================================================================
SECTION 5 – PROMPT LIST BY RUN (PROMPTS, TAGS & CATEGORIES)
================================================================

Heading: \`## 5. Prompt List by Run\`

List all prompts belonging to the run(s), with their tags and categories.

Table example:

| Run ID | Prompt ID | Prompt Theme | Full Prompt Text | Tags / Categories | Intent Type (Branded / Semi-Branded / Unbranded / Location / Journey) |

If intent type is not explicitly given, infer only if a clear field exists; otherwise mark as "Not available in snapshotData".

Add 3–4 bullets highlighting:
- Count of prompts by intent type
- Any prompts flagged as test / internal / excluded
- Any missing or incomplete prompt text

================================================================
SECTION 6 – PROMPT-LEVEL METRICS (BY METRIC & COMPETITOR)
================================================================

Heading: \`## 6. Prompt-Level Metrics\`

For each prompt in the selected run(s), provide aggregated performance metrics by brand/competitor and by score type.

A) Per-Prompt Metrics Table

This may be one large table or multiple tables grouped by intent type, depending on data volume. Example column structure:

| Prompt ID | Prompt Theme | Metric (Visibility / Position / Sentiment / Other) | Brand | Score | Benchmark / Tier (Leader / Above Avg / Below Avg) | Notes |

Notes can include short factual interpretations (≤ 10–12 words), such as:
- "Below avg vs configured competitors"
- "Not enough data for sentiment"

B) Optional – Metric Click-Details

If {snapshotData} contains "click" or "detail" descriptions per metric (the text you see when clicking into a score in the UI), include a small table:

| Prompt ID | Metric | Detail Text / Interpretation |

Keep this factual; do not add new narrative.

================================================================
SECTION 7 – PER-MODEL RESPONSES & RANKINGS
================================================================

Heading: \`## 7. Per-Model Responses & Rankings\`

This section mirrors the prompt detail pages where each model's raw answer and ranking distribution is shown.

A) Model-Level Metrics by Prompt

Table example:

| Prompt ID | Model | Brand | Visibility / Inclusion (e.g. Present / Absent) | Rank / Index | First Mention Position | Notes |

Where available, distinguish between:
- Configured competitors
- AI-discovered competitors (competitors discovered by models beyond the configured list)

B) Raw LLM Responses

For each prompt and model where raw answer text is available in {snapshotData} or {responseSummaries}, include a markdown block:

\`### [Prompt ID] – [Model Name] – Raw Response\`

Then include the raw response text. If responses are long, you may truncate with a clear note such as "… (truncated for length; full text available in source data)" if necessary.

C) Bullets

For each prompt (or for the section overall, depending on volume), include short bullets summarizing purely factual patterns, for example:
- "Model A lists marketplaces first; Model B lists direct brands first."
- "{brandName} appears only as 'also available at…' in Model C."

Do not add strategy or recommendations; keep it descriptive.

================================================================
SECTION 8 – DASHBOARD OVERVIEW & COMPETITOR RANKINGS
================================================================

Heading: \`## 8. Dashboard Overview & Competitor Rankings\`

Reflect the "Dashboard" view used in the UI for the selected run.

A) Run-Level Score Summary

Table example:

| Metric | Score for {brandName} | Leader Brand | Leader Score | Rank of {brandName} (Among Configured Competitors) |

Include metrics such as:
- Overall Visibility
- Overall Position
- Overall Sentiment
- Other aggregate metrics that exist in {snapshotData}.

B) Competitor Ranking Table (Configured Competitors Only)

| Brand | Overall Visibility Score | Overall Position Score | Overall Sentiment Score | Overall Rank |

If available, add trend fields (e.g., vs previous run).

C) Short Bullets

3–5 bullets summarizing:
- Where {brandName} sits in rankings
- Any competitors very far above or below in overall scores
- Any missing metrics or runs

================================================================
SECTION 9 – CITATION ANALYSIS (DOMAINS & BRAND FOOTPRINT)
================================================================

Heading: \`## 9. Citation Analysis\`

This section is the "opportunities / citation" view: which domains/URLs are used, how often, and with what share.

A) Domain-Level Citations

Table example:

| Domain / URL Root | Total Citations | Share of Citations (%) | Typical Role (Official Site / Marketplace / Media / Regulator / Other) | Notes |

B) Brand-Specific Citation Footprint

If {snapshotData} has brand-level citation summaries:

| Brand | # Unique Citing Domains | Top Citing Domains | Official vs Third-Party Balance | Notes |

C) Optional – Prompt/Model Citation Breakdown

If detailed data exists per prompt and model, you may include:

| Prompt ID | Model | Domain | Citations Count | Notes |

D) Bullets

3–5 bullets highlighting:
- Which domains dominate answers for {brandName}
- Which competitor/marketplace domains dominate overall
- Any obvious gaps (e.g., "{brandName}'s own domains rarely appear as primary citations")
- Any "Not available in snapshotData" limitations

================================================================
SECTION 10 – RECOMMENDATIONS DETAIL (HIGH / MED / LOW)
================================================================

Heading: \`## 10. Recommendations Detail\`

This section captures the raw recommendation objects from the platform – not the polished consulting narrative.

A) Recommendation Table

| Recommendation ID | Severity (High / Medium / Low) | Category (Technical / Content / Schema / Local / Other) | Description | Suggested Action / Fix | Related Metrics / Prompts / URLs |

Populate directly from recommendation structures in {snapshotData} (often surfaced in consultingContext or a recommendations collection).

B) Summary Bullets

3–5 bullets stating:
- Count of recommendations by severity
- Top categories by volume or severity
- Any "orphan" recommendations where linked metrics/URLs are missing

Do not re-interpret or prioritize beyond what the data already provides.

================================================================
SECTION 11 – GENERATED CONTENT ARCHIVE
================================================================

Heading: \`## 11. Generated Content Archive\`

Include the content generated from this run (e.g., content generator / insight cards) so that it can be reviewed alongside the diagnostics.

A) Content Index Table

| Content ID | Title / Headline | Content Type (e.g. Blog, Landing Page, FAQ, Exec Summary) | Intended Channel / Use | Related Prompt(s) / Topic(s) | Approx. Length (Words/Chars) |

B) Full Content Blocks

For each content item (if text is available in {snapshotData}):

\`### [Content ID] – [Title]\`

Then provide the full text. If there is a large number of content items or very long content, you may truncate individual pieces with "(truncated for length; full text available in source data)" as needed – but retain at least the first few paragraphs.

If generated content is not stored in {snapshotData}, clearly state:
- "Generated content text is not available in snapshotData for this run."

================================================================
SECTION 12 – DATA QUALITY & COVERAGE NOTES
================================================================

Heading: \`## 12. Data Quality & Coverage Notes\`

Conclude with a short section capturing any data limitations discovered while building the appendix.

Include bullets such as:
- Prompts or models with missing or partial responses.
- Metrics present for some brands but not others.
- Incomplete Site Xray coverage (e.g., only top-level pages scanned).
- Citation or recommendation data that appears empty or partial.
- Any other anomalies visible in {snapshotData} that might affect interpretation.

================================================================
CRITICAL OUTPUT REQUIREMENTS (REMINDER)
================================================================

- Return ONLY the JSON object with the single field "diagnosticAppendix".
- The value of "diagnosticAppendix" must be valid markdown (no outer code fences).
- Do not include any explanation, commentary, or text outside the JSON.
- Do not attempt to generate an executive summary, strategic recommendations, or action plans – keep this purely technical, descriptive, and closely aligned to the Polaris UI data.`;

// Interface for the diagnostic appendix output
export interface GeneratedAppendix {
  diagnosticAppendix: string;
  metadata: {
    modelUsed: string;
    temperature: number;
    tokensUsed: number;
    costUsd: number;
    generatedAt: string;
  };
}

function getModelCost(modelName: string): { input: number; output: number } {
  const costs: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'gpt-5.1': { input: 0.0025, output: 0.01 },
    'gpt-5.2': { input: 0.003, output: 0.012 },
    'gpt-5.4': { input: 0.0025, output: 0.01 },
    'gpt-5.4-mini': { input: 0.00025, output: 0.001 },
    'gpt-5.4-nano': { input: 0.00005, output: 0.0002 },
  };
  return costs[modelName] || costs['gpt-5.4'];
}

export interface ClientContext {
  name: string;
  industry?: string | null;
  geography?: string | null;
}

export async function generateNarratives(
  snapshot: SnapshotData,
  responseSummaries: PromptResponseSummary[],
  clientContext: ClientContext,
  openaiApiKey: string
): Promise<GeneratedNarratives> {
  // Task #78 — vendor kill switch
  const { ensureVendorPauseLoaded: _ensureA, assertVendorNotPaused: _assertA } = await import('../config/vendor-pause');
  await _ensureA();
  _assertA('OpenAI');
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const brandName = clientContext.name;
  const category = clientContext.industry || 'the category';
  const market = clientContext.geography || 'the market';

  // Extract top citation domains (top 15 by frequency)
  const citationDomainCounts = new Map<string, number>();
  snapshot.citations.forEach(c => {
    if (c.domain) {
      citationDomainCounts.set(c.domain, (citationDomainCounts.get(c.domain) || 0) + 1);
    }
  });
  const topCitationDomains = Array.from(citationDomainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([domain, count]) => ({ domain, count }));

  // Get competitor scores with names (top 10 by visibility)
  const competitorScoresData = snapshot.competitorScores
    .sort((a, b) => (b.visibilityScore || 0) - (a.visibilityScore || 0))
    .slice(0, 10)
    .map(cs => ({
      competitorName: cs.competitorName,
      visibilityScore: cs.visibilityScore,
      positionScore: cs.positionScore,
      sentimentScore: cs.sentimentScore,
    }));

  // Get recommendation breakdown by category
  const recommendationsByCategory = new Map<string, number>();
  snapshot.recommendations.forEach(r => {
    if (r.category) {
      recommendationsByCategory.set(r.category, (recommendationsByCategory.get(r.category) || 0) + 1);
    }
  });
  const recommendationCategoryBreakdown = Array.from(recommendationsByCategory.entries())
    .map(([category, count]) => ({ category, count }));

  // Get model performance summary
  const modelPerformance = snapshot.models.map(m => ({
    name: m.displayName || m.vendor,
    vendor: m.vendor,
    responseCount: snapshot.responses.filter(r => r.modelId === m.id).length,
  }));

  // Get sample prompts with full text (first 10)
  const samplePrompts = snapshot.prompts.slice(0, 10).map(p => ({
    text: p.text,
    source: p.source,
  }));

  // Calculate aggregate metrics for the client (from all responses)
  const totalResponses = snapshot.responses.length;
  const totalCitationsInResponses = snapshot.responses.reduce((sum, r) => sum + r.citationCount, 0);
  const totalMentionsInResponses = snapshot.responses.reduce((sum, r) => sum + r.mentionCount, 0);
  const totalRankingsInResponses = snapshot.responses.reduce((sum, r) => sum + r.rankingCount, 0);
  
  const clientMetrics = {
    citationRate: totalResponses > 0 ? (totalCitationsInResponses / totalResponses).toFixed(2) : '0',
    mentionRate: totalResponses > 0 ? (totalMentionsInResponses / totalResponses).toFixed(2) : '0',
    rankingRate: totalResponses > 0 ? (totalRankingsInResponses / totalResponses).toFixed(2) : '0',
  };

  // Extract AI-discovered competitors (entities in rankings that aren't the client or configured competitors)
  // Get list of configured competitor names from snapshot
  const configuredCompetitorNames = new Set(
    snapshot.competitorScores
      .filter(cs => cs.competitorName) // Filter out null/undefined names
      .map(cs => cs.competitorName.toLowerCase().trim())
  );
  
  const clientBrandName = brandName.toLowerCase().trim();
  
  // Track discovered competitors: entities appearing in rankings but not in configured list
  const discoveredCompetitorCounts = new Map<string, {
    name: string;
    promptCount: number;
    totalAppearances: number;
    avgPosition: number;
    positions: number[];
    answerIds: Set<string>;
  }>();
  
  snapshot.rankings.forEach(ranking => {
    const itemLower = ranking.item.toLowerCase().trim();
    
    // Skip if it's the client brand or a configured competitor
    if (ranking.isClientBrand || configuredCompetitorNames.has(itemLower)) {
      return;
    }
    
    // Skip generic items (too short, numbers, etc.)
    if (ranking.item.length < 3 || /^\d+$/.test(ranking.item)) {
      return;
    }
    
    if (!discoveredCompetitorCounts.has(itemLower)) {
      discoveredCompetitorCounts.set(itemLower, {
        name: ranking.item, // Use original casing
        promptCount: 0,
        totalAppearances: 0,
        avgPosition: 0,
        positions: [],
        answerIds: new Set(),
      });
    }
    
    const competitor = discoveredCompetitorCounts.get(itemLower)!;
    competitor.totalAppearances++;
    competitor.positions.push(ranking.position);
    competitor.answerIds.add(ranking.answerId);
  });
  
  // Calculate appearance metrics for each discovered competitor
  discoveredCompetitorCounts.forEach((competitor, key) => {
    // Get unique promptIds where this competitor appeared
    const uniquePromptIds = new Set<string>();
    const uniquePromptRunItems = new Set<string>();
    
    competitor.answerIds.forEach(answerId => {
      const response = snapshot.responses.find(r => r.answerId === answerId);
      if (response) {
        uniquePromptIds.add(response.promptId);
        uniquePromptRunItems.add(response.promptRunItemId);
      }
    });
    
    // Calculate competitor-specific prompt universe: 
    // All promptRunItems for prompts where this competitor was ever detected
    const competitorPromptUniverse = new Set<string>();
    snapshot.responses.forEach(response => {
      if (uniquePromptIds.has(response.promptId)) {
        competitorPromptUniverse.add(response.promptRunItemId);
      }
    });
    
    competitor.promptCount = uniquePromptIds.size; // Unique prompts
    competitor.totalAppearances = uniquePromptRunItems.size; // Appearance occurrences (answer-level)
    competitor.avgPosition = competitor.positions.length > 0
      ? competitor.positions.reduce((sum, pos) => sum + pos, 0) / competitor.positions.length
      : 0;
  });
  
  // Sort by prompt count (frequency) and get top 15
  const topDiscoveredCompetitors = Array.from(discoveredCompetitorCounts.values())
    .sort((a, b) => b.promptCount - a.promptCount)
    .slice(0, 15)
    .map(comp => {
      // Recalculate competitorPromptUniverse for this competitor
      const uniquePromptIds = new Set<string>();
      comp.answerIds.forEach(answerId => {
        const response = snapshot.responses.find(r => r.answerId === answerId);
        if (response) {
          uniquePromptIds.add(response.promptId);
        }
      });
      
      const competitorPromptUniverse = new Set<string>();
      snapshot.responses.forEach(response => {
        if (uniquePromptIds.has(response.promptId)) {
          competitorPromptUniverse.add(response.promptRunItemId);
        }
      });
      
      return {
        name: comp.name,
        promptCount: comp.promptCount,
        appearanceOccurrences: comp.totalAppearances,
        competitorPromptUniverse: competitorPromptUniverse.size,
        avgPosition: parseFloat(comp.avgPosition.toFixed(2)),
        appearanceRate: competitorPromptUniverse.size > 0 
          ? parseFloat(((comp.totalAppearances / competitorPromptUniverse.size) * 100).toFixed(1)) 
          : 0,
      };
    });
  
  console.log(`[NarrativeGen] Discovered ${discoveredCompetitorCounts.size} non-configured competitors in rankings`);
  console.log(`[NarrativeGen] Top discovered competitors: ${topDiscoveredCompetitors.slice(0, 5).map(c => `${c.name} (${c.promptCount} prompts)`).join(', ')}`);

  // Build comprehensive diagnostic snapshot with full raw data
  const snapshotSummary = {
    overview: {
      analysisDate: snapshot.metadata.generatedAt,
      promptCount: snapshot.prompts.length,
      modelCount: snapshot.models.length,
      totalResponses: snapshot.responses.length,
      totalCitations: snapshot.citations.length,
      totalMentions: snapshot.mentions.length,
      totalRankings: snapshot.rankings.length,
      competitorCount: new Set(snapshot.competitorScores.map(cs => cs.competitorId)).size,
      recommendationCount: snapshot.recommendations.length,
    },
    // FULL RAW DATA for LLM to reference specific details
    allPrompts: snapshot.prompts.map(p => ({
      id: p.id,
      text: p.text,
      source: p.source,
    })),
    allModels: snapshot.models.map(m => ({
      id: m.id,
      name: m.displayName || m.vendor,
      vendor: m.vendor,
      model: m.model,
      maxTpm: m.maxTpm,
      maxRpm: m.maxRpm,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
      enabled: m.enabled,
    })),
    // Include ALL AI responses with FULL answer text for complete diagnostic grounding
    allResponses: snapshot.responses.map(r => {
      const prompt = snapshot.prompts.find(p => p.id === r.promptId);
      const model = snapshot.models.find(m => m.id === r.modelId);
      return {
        promptRunItemId: r.promptRunItemId,
        answerId: r.answerId,
        promptId: r.promptId,
        promptText: prompt?.text || 'Unknown prompt',
        modelId: r.modelId,
        modelName: model?.displayName || model?.vendor || 'Unknown model',
        answer: r.answer, // FULL answer text - no truncation
        citationCount: r.citationCount,
        mentionCount: r.mentionCount,
        rankingCount: r.rankingCount,
        visibilityScore: r.visibilityScore,
        sentimentScore: r.sentimentScore,
        positionScore: r.positionScore,
        firstMentionPos: r.firstMentionPos,
      };
    }),
    // Include full citation details with URLs and domains for specific citation analysis
    allCitations: snapshot.citations.map(c => ({
      answerId: c.answerId,
      url: c.url,
      domain: c.domain,
      displayText: c.displayText,
      position: c.position,
      type: c.type,
    })),
    // Include full mention details for sentiment and span analysis
    allMentions: snapshot.mentions.map(m => ({
      answerId: m.answerId,
      span: m.span,
      sentiment: m.sentiment,
      isAlias: m.isAlias,
    })),
    // Include full ranking details for position analysis
    allRankings: snapshot.rankings.map(r => ({
      answerId: r.answerId,
      item: r.item,
      position: r.position,
      isClientBrand: r.isClientBrand,
      rankingGroup: r.rankingGroup,
    })),
    // AGGREGATED INSIGHTS for easy reference
    topCitationDomains,
    competitorScores: competitorScoresData,
    clientMetrics,
    recommendations: {
      total: snapshot.recommendations.length,
      byCategory: recommendationCategoryBreakdown,
      topSources: Array.from(
        snapshot.recommendations
          .reduce((acc, r) => {
            acc.set(r.source, (acc.get(r.source) || 0) + 1);
            return acc;
          }, new Map<string, number>())
          .entries()
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([source, count]) => ({ source, count })),
      allRecommendations: snapshot.recommendations.map(r => ({
        title: r.title,
        category: r.category,
        severity: r.severity,
        description: r.description,
        source: r.source,
      })),
    },
    // AI-DISCOVERED COMPETITORS (not in configured competitor list)
    discoveredCompetitors: {
      total: discoveredCompetitorCounts.size,
      top15: topDiscoveredCompetitors,
      description: `Entities appearing in AI rankings that are NOT in the configured competitor list. These represent emergent threats or opportunities that ${brandName} should monitor.`,
    },
    // X-RAY ANALYSIS DATA (Phase 3 - Crawl health, page analysis, AI content analysis)
    xrayData: {
      sites: snapshot.xraySites?.map(site => ({
        id: site.id,
        domain: site.domain,
        siteType: site.siteType,
        robotsTxtPresent: site.robotsTxtPresent,
        aiTxtPresent: site.aiTxtPresent,
        crawlAccessStatus: site.crawlAccessStatus,
        robotsRules: site.robotsRules,
        aiTxtContent: site.aiTxtContent,
        healthProbeStatus: site.healthProbeStatus,
        lastProbedAt: site.lastProbedAt,
      })) || [],
      pages: snapshot.xrayPages?.map(page => ({
        id: page.id,
        siteId: page.siteId,
        url: page.url,
        title: page.title,
        pageType: page.pageType,
        statusCode: page.statusCode,
        wordCount: page.wordCount,
        headings: page.headings,
        entities: page.entities,
        topics: page.topics,
        sentimentScore: page.sentimentScore,
      })) || [],
      analysis: snapshot.xrayAnalysis?.map(analysis => ({
        id: analysis.id,
        pageId: analysis.pageId,
        pageUrl: analysis.pageUrl,
        assessment: analysis.assessment,
        gaps: analysis.gaps,
        recommendations: analysis.recommendations,
        actions: analysis.actions,
        seoIssues: analysis.seoIssues,
        scores: analysis.scores,
      })) || [],
      summary: {
        totalSites: snapshot.xraySites?.length || 0,
        totalPages: snapshot.xrayPages?.length || 0,
        totalAnalyzed: snapshot.xrayAnalysis?.length || 0,
        sitesWithRobotsTxt: snapshot.xraySites?.filter(s => s.robotsTxtPresent).length || 0,
        sitesWithAiTxt: snapshot.xraySites?.filter(s => s.aiTxtPresent).length || 0,
        avgWordCount: snapshot.xrayPages?.length
          ? Math.round(snapshot.xrayPages.reduce((sum, p) => sum + (p.wordCount || 0), 0) / snapshot.xrayPages.length)
          : null,
      },
    },
  };

  // ===== PHASE 2: BUILD CONSULTING DATA PACKET =====
  // Provides pre-interpreted metrics with benchmarks and SWOT-style insights
  const consultingPacket = buildConsultingDataPacket(snapshot, brandName);
  console.log(`[NarrativeGen] Consulting packet built: visibility=${consultingPacket.clientPerformance.overallVisibility}, strengths=${consultingPacket.keyInsights.strengths.length}, weaknesses=${consultingPacket.keyInsights.weaknesses.length}`);

  // Combine snapshot data with consulting interpretations
  const enhancedSnapshotData = {
    ...snapshotSummary,
    // CONSULTING CONTEXT - Pre-interpreted metrics for narrative enhancement
    consultingContext: {
      executiveSummary: {
        clientPerformance: consultingPacket.clientPerformance,
        competitiveContext: consultingPacket.competitiveContext,
        keyInsights: consultingPacket.keyInsights,
      },
      benchmarks: consultingPacket.benchmarks,
      modelBreakdown: consultingPacket.modelBreakdown,
      citationAuthority: consultingPacket.citationAuthority,
      preComputedAggregations: snapshot.aggregatedMetrics,
    },
  };
  // ===== END PHASE 2 =====

  const summariesText = responseSummaries
    .map(s => `Prompt: "${s.promptText.substring(0, 100)}" | Model: ${s.modelName}\nSummary: ${s.summary}\nKey Patterns: ${s.keyPatterns.join(', ')}\nMetrics: ${s.citationCount} citations, ${s.mentionCount} mentions, ${s.rankingCount} rankings\n`)
    .join('\n---\n');

  console.log(`[NarrativeGen] Response summaries count: ${responseSummaries.length}`);
  console.log(`[NarrativeGen] Empty summaries: ${responseSummaries.filter(s => !s.summary || s.summary.trim().length === 0).length}`);
  if (responseSummaries.length > 0) {
    console.log(`[NarrativeGen] First summary example: ${responseSummaries[0].summary.substring(0, 150)}`);
  }
  console.log(`[NarrativeGen] Summaries text length: ${summariesText.length} chars`);

  const prompt = NARRATIVE_GENERATION_PROMPT
    .replace(/{brandName}/g, brandName)
    .replace(/{category}/g, category)
    .replace(/{market}/g, market)
    .replace('{snapshotData}', JSON.stringify(enhancedSnapshotData, null, 2))
    .replace('{responseSummaries}', summariesText);

  console.log(`[NarrativeGen] Final prompt length: ${prompt.length} chars`);

  const { buildOpenAIRequestParams } = await import('../utils/openai-compat');
  
  const requestParams = buildOpenAIRequestParams(REPORTING_CONFIG.AI_MODEL, {
    messages: [
      {
        role: 'system',
        content: 'You are an AEO/GEO consultant working for a top-tier strategy consulting firm (similar to Kearney, BCG, Bain). Your expertise is in Answer Engine Optimization and Generative Engine Optimization for consumer brands. You translate technical diagnostic data from AI visibility platforms into executive-level strategic narratives that drive business decisions. Always respond with valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    responseFormat: { type: 'json_object' },
    temperature: REPORTING_CONFIG.AI_TEMPERATURE,
    maxTokens: 16000, // Increased for 12 sections (vs. original 5)
  });

  const completion = await openai.chat.completions.create(requestParams);

  const fullResponse = completion.choices[0].message.content || '';
  const sections = parseNarrativeSections(fullResponse);
  
  console.log(`[NarrativeGen] Sections generated - executiveSummary: ${sections.executiveSummary.length} chars, diagnosticOverview: ${sections.diagnosticOverview.length} chars, competitiveLandscape: ${sections.competitiveLandscape.length} chars, patternAnalysis: ${sections.patternAnalysis.length} chars`);
  console.log(`[NarrativeGen] Token usage: ${completion.usage?.total_tokens || 0} total (${completion.usage?.prompt_tokens || 0} prompt + ${completion.usage?.completion_tokens || 0} completion)`);
  
  const minSectionLength = 100;
  const shortSections = Object.entries(sections)
    .filter(([key, value]) => typeof value === 'string' && value.length < minSectionLength)
    .map(([key]) => key);
  if (shortSections.length > 0) {
    console.warn(`[NarrativeGen] Warning: ${shortSections.length} sections are unusually short (<${minSectionLength} chars): ${shortSections.join(', ')}`);
  }

  const inputTokens = completion.usage?.prompt_tokens || 0;
  const outputTokens = completion.usage?.completion_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const costs = getModelCost(REPORTING_CONFIG.AI_MODEL);
  const costUsd = (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;

  // ===== PHASE 3: QUALITY VALIDATION =====
  const qualityReport = validateNarrativeQuality(sections, brandName);
  console.log(`[NarrativeGen] Quality Report: Overall Score ${qualityReport.overallScore}/100`);
  console.log(`[NarrativeGen] Quality Details: ${JSON.stringify(qualityReport.details)}`);
  
  // Log section-specific scores for debugging
  console.log(`[NarrativeGen] Section Scores: ${JSON.stringify(qualityReport.sectionScores)}`);
  
  if (qualityReport.warnings.length > 0) {
    console.warn(`[NarrativeGen] Quality Warnings (${qualityReport.warnings.length}): ${qualityReport.warnings.slice(0, 5).join('; ')}${qualityReport.warnings.length > 5 ? '...' : ''}`);
  }
  
  // QUALITY GATE: Log quality metrics (warn-but-continue mode)
  // Only block on structural failures (empty sections), not stylistic requirements
  
  // Check for structural failures that should block
  const emptySections = qualityReport.criticalIssues.filter(issue => 
    issue.includes('is empty')
  );
  
  if (emptySections.length > 0) {
    console.error(`[NarrativeGen] STRUCTURAL FAILURE: ${emptySections.join('; ')}`);
    throw new Error(`Report generation failed: ${emptySections.join('; ')}`);
  }
  
  // Log quality for observability (don't block)
  if (qualityReport.overallScore >= 70) {
    console.log(`[NarrativeGen] QUALITY: Excellent (score: ${qualityReport.overallScore})`);
  } else if (qualityReport.overallScore >= 40) {
    console.log(`[NarrativeGen] QUALITY: Acceptable (score: ${qualityReport.overallScore})`);
  } else {
    console.warn(`[NarrativeGen] QUALITY: Low (score: ${qualityReport.overallScore}) - ${qualityReport.criticalIssues.slice(0, 3).join('; ')}`);
  }
  // ===== END PHASE 3 =====

  return {
    ...sections,
    metadata: {
      modelUsed: REPORTING_CONFIG.AI_MODEL,
      temperature: REPORTING_CONFIG.AI_TEMPERATURE,
      tokensUsed: totalTokens,
      costUsd: parseFloat(costUsd.toFixed(4)),
      generatedAt: new Date().toISOString(),
    },
  };
}

// ===== PHASE 3: QUALITY VALIDATORS =====

interface QualityReport {
  overallScore: number;
  details: {
    hasNumberedBullets: boolean;
    hasMetricReferences: boolean;
    hasRiskLanguage: boolean;
    hasComparisonContext: boolean;
    hasWhatItMeansLanguage: boolean;
    hasCostOfInactionLanguage: boolean;
    hasCompetitorMentions: boolean;
    sectionLengthsAdequate: boolean;
    executiveSummaryBulletCount: number;
  };
  warnings: string[];
  criticalIssues: string[];
  sectionScores: Record<string, number>;
}

function validateNarrativeQuality(
  sections: Omit<GeneratedNarratives, 'metadata'>,
  brandName: string
): QualityReport {
  const warnings: string[] = [];
  const criticalIssues: string[] = [];
  const sectionScores: Record<string, number> = {};
  
  // Quality check patterns - improved regex patterns
  const patterns = {
    // Match numbered bullets like "1.", "2.", etc. at start of line
    numberedBullets: /^[1-9]\d*\.\s+/m,
    // Match bullet points like "• " or "- " at start of line  
    bulletPoints: /^[\u2022\-\*]\s+/m,
    // Match metrics with numbers and units/percentages
    metrics: /\d+(\.\d+)?(%|\s*(out of|\/)\s*\d+|points?|\/\s*100)/i,
    // Match visibility scores like "45.2" or "Visibility: 78"
    visibilityScores: /visibility[:\s]+\d+(\.\d+)?|score[:\s]+\d+(\.\d+)?/i,
    // Risk/threat language
    riskLanguage: /risk(s|ing)?|threat(s|en)?|lose|losing|cede(s)?|erosion|urgent|critical|invisible/i,
    // Comparison context
    comparisonContext: /(above|below|compared to|vs\.?|versus|outperform|underperform|gap|leader|trailing|#\d+|rank(ed|s)?)/i,
    // "What it means" style explanations
    whatItMeans: /what (this|it) means|implication|consequence|impact|translates to|indicates|in other words|this means|meaning that/i,
    // Cost of inaction / urgency
    costOfInaction: /if (left )?unaddressed|without action|failure to|cost of inaction|risk(s)? losing|if not addressed|acting now/i,
    // Competitor mentions and market dynamics
    competitorMentions: /competitor|#\d|rank(ed|ing)?|dominat(e|es|ing)|captures?|citation share|market share|wins the answer/i,
    // Structural visibility failure language (from reference reports)
    structuralFailure: /structural (visibility )?failure|not hallucination|missing (AI-readable|signals)|invisible to AI/i,
  };
  
  // Check each section
  const sectionNames = [
    'executiveSummary', 'diagnosticOverview', 'competitiveLandscape',
    'visibilityPerformance', 'criticalGaps', 'patternAnalysis',
    'consultingInference', 'strategicImplications', 'leadershipConversations',
    'businessImpact', 'actionPlan306090', 'implementationRoadmap'
  ];
  
  let totalScore = 0;
  let hasNumberedBullets = false;
  let hasMetricReferences = false;
  let hasRiskLanguage = false;
  let hasComparisonContext = false;
  let hasWhatItMeansLanguage = false;
  let hasCostOfInactionLanguage = false;
  let hasCompetitorMentions = false;
  let sectionLengthsAdequate = true;
  let executiveSummaryBulletCount = 0;
  
  // Define which sections require specific patterns (per-section requirements)
  const sectionRequirements: Record<string, string[]> = {
    executiveSummary: ['numberedBullets', 'metrics', 'comparisonContext', 'whatItMeans'],
    diagnosticOverview: ['metrics', 'whatItMeans', 'riskLanguage'],
    competitiveLandscape: ['comparisonContext', 'metrics', 'competitorMentions'],
    visibilityPerformance: ['metrics', 'comparisonContext'],
    criticalGaps: ['riskLanguage', 'whatItMeans'],
    patternAnalysis: ['whatItMeans', 'metrics'],
    consultingInference: ['whatItMeans', 'costOfInaction'],
    strategicImplications: ['riskLanguage', 'costOfInaction', 'whatItMeans'],
    leadershipConversations: ['numberedBullets', 'whatItMeans'],
    businessImpact: ['metrics', 'riskLanguage', 'whatItMeans'],
    actionPlan306090: ['numberedBullets', 'whatItMeans'],
    implementationRoadmap: ['numberedBullets'],
  };

  sectionNames.forEach(name => {
    const content = (sections as any)[name] as string;
    if (!content) {
      sectionScores[name] = 0;
      criticalIssues.push(`Section ${name} is empty`);
      return;
    }
    
    let score = 0;
    const minLength = name === 'executiveSummary' ? 500 : 300;
    const required = sectionRequirements[name] || [];
    const missingRequirements: string[] = [];
    
    // Length check
    if (content.length >= minLength) {
      score += 20;
    } else {
      warnings.push(`${name} is short (${content.length} chars, expected ${minLength}+)`);
      sectionLengthsAdequate = false;
    }
    
    // Pattern checks - numbered bullets
    const hasNumberedBulletsInSection = patterns.numberedBullets.test(content);
    const hasBulletPointsInSection = patterns.bulletPoints.test(content);
    
    if (hasNumberedBulletsInSection) {
      score += 10;
      hasNumberedBullets = true;
      
      // Count bullets in executive summary (should be 5-8)
      if (name === 'executiveSummary') {
        const bulletMatches = content.match(/^[1-9]\d*\.\s+/gm);
        executiveSummaryBulletCount = bulletMatches ? bulletMatches.length : 0;
        if (executiveSummaryBulletCount < 5) {
          warnings.push(`Executive Summary has only ${executiveSummaryBulletCount} bullets (expected 5-8)`);
        } else if (executiveSummaryBulletCount > 8) {
          warnings.push(`Executive Summary has ${executiveSummaryBulletCount} bullets (expected 5-8)`);
        }
      }
    } else if (hasBulletPointsInSection) {
      score += 5; // Partial credit for bullet points
      hasNumberedBullets = true;
    }
    
    // Track if this section requires numbered bullets
    if (required.includes('numberedBullets') && !hasNumberedBulletsInSection) {
      missingRequirements.push('numbered bullets');
      score -= 10; // Deduct for missing required structure
    }
    
    // Metric references
    const hasMetricsInSection = patterns.metrics.test(content) || patterns.visibilityScores.test(content);
    if (hasMetricsInSection) {
      score += 20;
      hasMetricReferences = true;
    } else if (required.includes('metrics')) {
      missingRequirements.push('metric references');
      score -= 15; // Deduct for missing required metrics
    }
    
    // Risk/threat language
    const hasRiskInSection = patterns.riskLanguage.test(content);
    if (hasRiskInSection) {
      score += 10;
      hasRiskLanguage = true;
    } else if (required.includes('riskLanguage')) {
      missingRequirements.push('risk/threat language');
      score -= 5;
    }
    
    // Comparison context
    const hasComparisonInSection = patterns.comparisonContext.test(content);
    if (hasComparisonInSection) {
      score += 15;
      hasComparisonContext = true;
    } else if (required.includes('comparisonContext')) {
      missingRequirements.push('comparison context');
      score -= 10;
    }
    
    // "What it means" style explanations - CRITICAL for consulting quality
    const hasWhatItMeansInSection = patterns.whatItMeans.test(content);
    if (hasWhatItMeansInSection) {
      score += 15;
      hasWhatItMeansLanguage = true;
    } else if (required.includes('whatItMeans')) {
      missingRequirements.push('"what it means" language');
      score -= 15; // Significant deduction - core consulting requirement
    }
    
    // Cost of inaction / urgency language
    const hasCostOfInactionInSection = patterns.costOfInaction.test(content);
    if (hasCostOfInactionInSection) {
      score += 5;
      hasCostOfInactionLanguage = true;
    } else if (required.includes('costOfInaction')) {
      missingRequirements.push('cost of inaction language');
      score -= 5;
    }
    
    // Competitor mentions and market dynamics
    const hasCompetitorInSection = patterns.competitorMentions.test(content);
    if (hasCompetitorInSection) {
      score += 5;
      hasCompetitorMentions = true;
    } else if (required.includes('competitorMentions')) {
      missingRequirements.push('competitor mentions');
      score -= 5;
    }
    
    // Brand mention check
    if (!content.toLowerCase().includes(brandName.toLowerCase())) {
      warnings.push(`${name} doesn't mention ${brandName}`);
    }
    
    // Clamp score to 0-100 range
    sectionScores[name] = Math.max(0, Math.min(score, 100));
    totalScore += sectionScores[name];
    
    // CRITICAL: Flag sections with missing requirements
    if (missingRequirements.length > 0) {
      criticalIssues.push(`${name} missing required: ${missingRequirements.join(', ')}`);
    }
    
    // CRITICAL: Flag sections that score too low
    if (sectionScores[name] < 20) {
      criticalIssues.push(`Section ${name} scored critically low (${sectionScores[name]}/100)`);
    }
  });
  
  const overallScore = Math.round(totalScore / sectionNames.length);
  
  // Global quality checks - identify critical issues
  if (!hasMetricReferences) {
    criticalIssues.push('No metric references found across all sections');
  }
  if (!hasComparisonContext) {
    criticalIssues.push('No comparison context (vs competitors) found');
  }
  if (!hasNumberedBullets) {
    criticalIssues.push('No numbered bullets or bullet points found');
  }
  
  // Global warnings for consulting quality
  if (!hasWhatItMeansLanguage) {
    warnings.push('Missing "what it means" language across all sections');
  }
  if (!hasCostOfInactionLanguage) {
    warnings.push('Missing "cost of inaction" language');
  }
  if (!hasRiskLanguage) {
    warnings.push('Missing risk/threat language');
  }
  
  return {
    overallScore,
    details: {
      hasNumberedBullets,
      hasMetricReferences,
      hasRiskLanguage,
      hasComparisonContext,
      hasWhatItMeansLanguage,
      hasCostOfInactionLanguage,
      hasCompetitorMentions,
      sectionLengthsAdequate,
      executiveSummaryBulletCount,
    },
    warnings,
    criticalIssues,
    sectionScores,
  };
}

// ===== END PHASE 3: QUALITY VALIDATORS =====

function parseNarrativeSections(fullResponse: string): Omit<GeneratedNarratives, 'metadata'> {
  if (!fullResponse || fullResponse.length < 50) {
    throw new Error('LLM response too short or empty - narrative generation failed');
  }

  let parsed: any;
  try {
    let cleaned = fullResponse.trim();
    cleaned = cleaned.replace(/^\uFEFF/, '');
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    cleaned = cleaned.trim();
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Narrative generation failed: LLM did not return valid JSON. Error: ${error instanceof Error ? error.message : 'Unknown error'}. Response start: ${fullResponse.substring(0, 200)}...`);
  }

  const requiredFields = [
    'executiveSummary',
    'diagnosticOverview',
    'competitiveLandscape',
    'visibilityPerformance',
    'criticalGaps',
    'patternAnalysis',
    'consultingInference',
    'strategicImplications',
    'leadershipConversations',
    'businessImpact',
    'actionPlan306090',
    'implementationRoadmap'
  ];
  const missingFields = requiredFields.filter(field => !parsed[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Narrative generation failed: Missing required JSON fields: ${missingFields.join(', ')}`);
  }

  const normalizeSection = (content: any, depth: number = 0): string => {
    if (depth > 10) {
      console.warn('[normalizeSection] Max recursion depth reached, returning empty string');
      return '';
    }
    
    if (content === null || content === undefined) {
      return '';
    }
    
    if (typeof content === 'string') {
      return content;
    }
    
    if (typeof content === 'number' || typeof content === 'boolean') {
      return String(content);
    }
    
    if (Array.isArray(content)) {
      return content.map((item, idx) => {
        if (typeof item === 'string') {
          return `${idx + 1}. ${item}`;
        }
        if (typeof item === 'number' || typeof item === 'boolean') {
          return `${idx + 1}. ${String(item)}`;
        }
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item);
          if (entries.length === 0) return '';
          
          if (entries.length === 1 && typeof entries[0][1] === 'string') {
            return `${idx + 1}. ${entries[0][1]}`;
          }
          
          const formatted = entries
            .map(([key, value]) => {
              if (typeof value === 'string') {
                return `  **${key}**: ${value}`;
              }
              if (typeof value === 'number' || typeof value === 'boolean') {
                return `  **${key}**: ${String(value)}`;
              }
              if (Array.isArray(value)) {
                const arrayContent = value.map((v, i) => {
                  if (typeof v === 'string') return `    - ${v}`;
                  if (typeof v === 'number' || typeof v === 'boolean') return `    - ${String(v)}`;
                  if (typeof v === 'object' && v !== null) {
                    const nestedStr = normalizeSection(v, depth + 1);
                    return nestedStr.split('\n').map(line => `    ${line}`).join('\n');
                  }
                  return '';
                }).filter(s => s.length > 0).join('\n');
                return `  **${key}**:\n${arrayContent}`;
              }
              if (typeof value === 'object' && value !== null) {
                const nestedContent = normalizeSection(value, depth + 1);
                if (nestedContent.length > 0) {
                  return `  **${key}**:\n${nestedContent.split('\n').map(line => `    ${line}`).join('\n')}`;
                }
              }
              return '';
            })
            .filter(s => s.length > 0)
            .join('\n');
          return `${idx + 1}.\n${formatted}`;
        }
        return '';
      }).filter(s => s.length > 0).join('\n\n');
    }
    
    if (typeof content === 'object' && content !== null) {
      return Object.entries(content)
        .map(([key, value]) => {
          if (typeof value === 'string') {
            return `**${key}**: ${value}`;
          }
          if (typeof value === 'number' || typeof value === 'boolean') {
            return `**${key}**: ${String(value)}`;
          }
          if (Array.isArray(value)) {
            const items = value.map((v, i) => {
              if (typeof v === 'string') return `${i + 1}. ${v}`;
              if (typeof v === 'number' || typeof v === 'boolean') return `${i + 1}. ${String(v)}`;
              if (typeof v === 'object' && v !== null) {
                const nested = normalizeSection(v, depth + 1);
                if (nested.length > 0) {
                  return `${i + 1}. ${nested.split('\n').map((line, lineIdx) => lineIdx === 0 ? line : `   ${line}`).join('\n')}`;
                }
              }
              return '';
            }).filter(s => s.length > 0).join('\n');
            if (items.length > 0) {
              return `**${key}**:\n${items}`;
            }
          }
          if (typeof value === 'object' && value !== null) {
            const nestedContent = normalizeSection(value, depth + 1);
            if (nestedContent.length > 0) {
              return `**${key}**:\n${nestedContent.split('\n').map(line => `  ${line}`).join('\n')}`;
            }
          }
          return '';
        })
        .filter(s => s.length > 0)
        .join('\n\n');
    }
    
    console.warn(`[normalizeSection] Unhandled content type: ${typeof content}`, content);
    return '';
  };

  const sections: Omit<GeneratedNarratives, 'metadata'> = {
    executiveSummary: normalizeSection(parsed.executiveSummary),
    diagnosticOverview: normalizeSection(parsed.diagnosticOverview),
    competitiveLandscape: normalizeSection(parsed.competitiveLandscape),
    visibilityPerformance: normalizeSection(parsed.visibilityPerformance),
    criticalGaps: normalizeSection(parsed.criticalGaps),
    patternAnalysis: normalizeSection(parsed.patternAnalysis),
    consultingInference: normalizeSection(parsed.consultingInference),
    strategicImplications: normalizeSection(parsed.strategicImplications),
    leadershipConversations: normalizeSection(parsed.leadershipConversations),
    businessImpact: normalizeSection(parsed.businessImpact),
    actionPlan306090: normalizeSection(parsed.actionPlan306090),
    implementationRoadmap: normalizeSection(parsed.implementationRoadmap),
  };

  Object.keys(sections).forEach(key => {
    const sectionKey = key as keyof typeof sections;
    if (!sections[sectionKey] || sections[sectionKey].trim().length === 0) {
      console.warn(`Warning: Section '${key}' is empty. Injecting placeholder text.`);
      sections[sectionKey] = 'No data available for this section. Insufficient information was provided to generate meaningful insights.';
    }
  });
  
  const shortSections = Object.entries(sections)
    .filter(([_, content]) => content && typeof content === 'string' && content.trim().length > 0 && content.trim().length < 20)
    .map(([key, content]) => `${key} (${content.length} chars)`);
  
  if (shortSections.length > 0) {
    console.warn(`Warning: Some sections are very short and may lack substance: ${shortSections.join(', ')}`);
  }

  return sections;
}

// ===== DIAGNOSTIC APPENDIX GENERATOR =====
// Generates technical appendix using DIAGNOSTIC_APPENDIX_PROMPT
export async function generateDiagnosticAppendix(
  snapshot: SnapshotData,
  responseSummaries: PromptResponseSummary[],
  clientContext: ClientContext,
  openaiApiKey: string
): Promise<GeneratedAppendix> {
  // Task #78 — vendor kill switch
  const { ensureVendorPauseLoaded: _ensureD, assertVendorNotPaused: _assertD } = await import('../config/vendor-pause');
  await _ensureD();
  _assertD('OpenAI');
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const brandName = clientContext.name;
  const category = clientContext.industry || 'the category';
  const market = clientContext.geography || 'the market';

  // Extract top citation domains (top 15 by frequency)
  const citationDomainCounts = new Map<string, number>();
  snapshot.citations.forEach(c => {
    if (c.domain) {
      citationDomainCounts.set(c.domain, (citationDomainCounts.get(c.domain) || 0) + 1);
    }
  });
  const topCitationDomains = Array.from(citationDomainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([domain, count]) => ({ domain, count }));

  // Get competitor scores with names (top 10 by visibility)
  const competitorScoresData = snapshot.competitorScores
    .sort((a, b) => (b.visibilityScore || 0) - (a.visibilityScore || 0))
    .slice(0, 10)
    .map(cs => ({
      competitorName: cs.competitorName,
      visibilityScore: cs.visibilityScore,
      positionScore: cs.positionScore,
      sentimentScore: cs.sentimentScore,
    }));

  // Get recommendation breakdown by category
  const recommendationsByCategory = new Map<string, number>();
  snapshot.recommendations.forEach(r => {
    if (r.category) {
      recommendationsByCategory.set(r.category, (recommendationsByCategory.get(r.category) || 0) + 1);
    }
  });
  const recommendationCategoryBreakdown = Array.from(recommendationsByCategory.entries())
    .map(([category, count]) => ({ category, count }));

  // Get model performance summary
  const modelPerformance = snapshot.models.map(m => ({
    name: m.displayName || m.vendor,
    vendor: m.vendor,
    model: m.model,
    responseCount: snapshot.responses.filter(r => r.modelId === m.id).length,
  }));

  // Build comprehensive snapshot data for the appendix
  const snapshotSummary = {
    // Configuration data
    configuration: {
      clientName: brandName,
      category,
      market,
      competitorCount: snapshot.competitorScores.length,
      modelCount: snapshot.models.length,
      promptCount: snapshot.prompts.length,
    },
    // All prompts with full text
    allPrompts: snapshot.prompts.map(p => ({
      id: p.id,
      text: p.text,
      source: p.source,
    })),
    // All models with configuration
    allModels: snapshot.models.map(m => ({
      id: m.id,
      name: m.displayName || m.vendor,
      vendor: m.vendor,
      model: m.model,
      maxTpm: m.maxTpm,
      maxRpm: m.maxRpm,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
      enabled: m.enabled,
    })),
    // All responses with full answer text
    allResponses: snapshot.responses.map(r => {
      const prompt = snapshot.prompts.find(p => p.id === r.promptId);
      const model = snapshot.models.find(m => m.id === r.modelId);
      return {
        promptRunItemId: r.promptRunItemId,
        answerId: r.answerId,
        promptId: r.promptId,
        promptText: prompt?.text || 'Unknown prompt',
        modelId: r.modelId,
        modelName: model?.displayName || model?.vendor || 'Unknown model',
        answer: r.answer,
        citationCount: r.citationCount,
        mentionCount: r.mentionCount,
        rankingCount: r.rankingCount,
        visibilityScore: r.visibilityScore,
        sentimentScore: r.sentimentScore,
        positionScore: r.positionScore,
        firstMentionPos: r.firstMentionPos,
      };
    }),
    // All citations with URLs and domains
    allCitations: snapshot.citations.map(c => ({
      answerId: c.answerId,
      url: c.url,
      domain: c.domain,
      displayText: c.displayText,
      position: c.position,
      type: c.type,
    })),
    // All mentions with sentiment
    allMentions: snapshot.mentions.map(m => ({
      answerId: m.answerId,
      span: m.span,
      sentiment: m.sentiment,
      isAlias: m.isAlias,
    })),
    // All rankings with positions
    allRankings: snapshot.rankings.map(r => ({
      answerId: r.answerId,
      item: r.item,
      position: r.position,
      isClientBrand: r.isClientBrand,
      rankingGroup: r.rankingGroup,
    })),
    // Aggregated insights
    topCitationDomains,
    competitorScores: competitorScoresData,
    recommendations: {
      total: snapshot.recommendations.length,
      byCategory: recommendationCategoryBreakdown,
      allRecommendations: snapshot.recommendations.map(r => ({
        title: r.title,
        category: r.category,
        severity: r.severity,
        description: r.description,
        source: r.source,
      })),
    },
    modelPerformance,
    // X-Ray data if available
    xrayData: {
      sites: snapshot.xraySites?.map(site => ({
        id: site.id,
        domain: site.domain,
        siteType: site.siteType,
        robotsTxtPresent: site.robotsTxtPresent,
        aiTxtPresent: site.aiTxtPresent,
        crawlAccessStatus: site.crawlAccessStatus,
        healthProbeStatus: site.healthProbeStatus,
        lastProbedAt: site.lastProbedAt,
      })) || [],
      pages: snapshot.xrayPages?.map(page => ({
        id: page.id,
        siteId: page.siteId,
        url: page.url,
        title: page.title,
        pageType: page.pageType,
        statusCode: page.statusCode,
        wordCount: page.wordCount,
        headings: page.headings,
        entities: page.entities,
        topics: page.topics,
      })) || [],
      analysis: snapshot.xrayAnalysis?.map(analysis => ({
        id: analysis.id,
        pageId: analysis.pageId,
        pageUrl: analysis.pageUrl,
        assessment: analysis.assessment,
        gaps: analysis.gaps,
        recommendations: analysis.recommendations,
        actions: analysis.actions,
        seoIssues: analysis.seoIssues,
        scores: analysis.scores,
      })) || [],
    },
  };

  // Build consulting data packet for context
  const consultingPacket = buildConsultingDataPacket(snapshot, brandName);

  // Combine snapshot data with consulting interpretations
  const enhancedSnapshotData = {
    ...snapshotSummary,
    consultingContext: {
      clientPerformance: consultingPacket.clientPerformance,
      competitiveContext: consultingPacket.competitiveContext,
      keyInsights: consultingPacket.keyInsights,
      benchmarks: consultingPacket.benchmarks,
      modelBreakdown: consultingPacket.modelBreakdown,
      preComputedAggregations: snapshot.aggregatedMetrics,
    },
  };

  const summariesText = responseSummaries
    .map(s => `Prompt: "${s.promptText.substring(0, 100)}" | Model: ${s.modelName}\nSummary: ${s.summary}\nKey Patterns: ${s.keyPatterns.join(', ')}\nMetrics: ${s.citationCount} citations, ${s.mentionCount} mentions, ${s.rankingCount} rankings\n`)
    .join('\n---\n');

  console.log(`[AppendixGen] Building diagnostic appendix for ${brandName}`);
  console.log(`[AppendixGen] Response summaries count: ${responseSummaries.length}`);

  const prompt = DIAGNOSTIC_APPENDIX_PROMPT
    .replace(/{brandName}/g, brandName)
    .replace(/{category}/g, category)
    .replace(/{market}/g, market)
    .replace('{snapshotData}', JSON.stringify(enhancedSnapshotData, null, 2))
    .replace('{responseSummaries}', summariesText);

  console.log(`[AppendixGen] Final prompt length: ${prompt.length} chars`);

  const { buildOpenAIRequestParams } = await import('../utils/openai-compat');
  const modelUsed = REPORTING_CONFIG.AI_MODEL;

  // Task #90 — Drop the "wrap a giant markdown string in JSON" pattern that
  // truncated mid-string for data-heavy projects (the JSON-string escape
  // overhead alone can push a real appendix past 16k tokens). We now ask
  // for plain markdown directly. Strip an outer ```markdown fence if the
  // model adds one, and on `finish_reason === 'length'` retry once with a
  // larger budget before giving up.
  const PRIMARY_MAX_TOKENS = Number(process.env.APPENDIX_MAX_TOKENS ?? 32000);
  const RETRY_MAX_TOKENS = Number(process.env.APPENDIX_RETRY_MAX_TOKENS ?? 48000);

  const systemPrompt =
    'You are a diagnostics-focused AEO/GEO analyst working for the Polaris platform team. ' +
    'Your job is to generate comprehensive technical appendices that consolidate raw diagnostic data in a clean, structured markdown format. ' +
    'Respond with the appendix as raw markdown only — no JSON wrapper, no code fences around the whole document, no preamble, no closing commentary.';

  // The prompt template still says "return JSON with field diagnosticAppendix"
  // — append a final, authoritative override so the model returns plain
  // markdown (which is what we always wanted, structurally).
  const markdownPrompt =
    prompt +
    '\n\n================================================================\n' +
    'FORMAT OVERRIDE (HIGHEST PRIORITY)\n' +
    '================================================================\n' +
    'Ignore any earlier instructions that ask for a JSON object. ' +
    'Return the appendix as raw markdown ONLY. ' +
    'Do not wrap it in JSON. Do not wrap the entire document in ``` fences. ' +
    'Start your response with the first heading (e.g. "## 1. Client & Run Configuration") and end with the last bullet of the final section.';

  const stripOuterMarkdownFence = (raw: string): string => {
    let out = raw.trim().replace(/^\uFEFF/, '');
    // Strip a single outer ```markdown / ```md / ``` fence if present.
    const fenceMatch = out.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/i);
    if (fenceMatch) out = fenceMatch[1].trim();
    return out;
  };

  // Last-ditch repair: some older prompts may still get a JSON wrapper back.
  // Try to extract the diagnosticAppendix string out of a (possibly
  // truncated) JSON blob. Returns null if we can't recover anything useful.
  const tryExtractFromJson = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.diagnosticAppendix === 'string') {
        return parsed.diagnosticAppendix;
      }
    } catch {
      // Truncated JSON — pull everything after the first
      // `"diagnosticAppendix":` and before the last quote we can find.
      const keyIdx = trimmed.indexOf('"diagnosticAppendix"');
      if (keyIdx >= 0) {
        const colonIdx = trimmed.indexOf(':', keyIdx);
        const firstQuote = trimmed.indexOf('"', colonIdx + 1);
        if (firstQuote >= 0) {
          // Take everything from the first quote on, dropping the leading
          // quote, then unescape common JSON escapes. Truncated strings
          // are accepted — better than failing the whole report.
          let body = trimmed.slice(firstQuote + 1);
          // Drop a trailing `"` or `"}` if present.
          body = body.replace(/"\s*}?\s*$/, '');
          body = body
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          if (body.trim().length > 200) return body;
        }
      }
    }
    return null;
  };

  const callOnce = async (maxTokens: number, attempt: number) => {
    const requestParams = buildOpenAIRequestParams(modelUsed, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: markdownPrompt },
      ],
      // No responseFormat — we want plain markdown back.
      temperature: 0.3,
      maxTokens,
    });

    console.log(
      `[AppendixGen] Attempt ${attempt}: model=${modelUsed} requested_max_tokens=${maxTokens} prompt_chars=${markdownPrompt.length}`,
    );

    const completion = await openai.chat.completions.create(requestParams);
    const choice = completion.choices[0];
    const finishReason = choice?.finish_reason || 'unknown';
    const fullResponse = choice?.message?.content || '';
    const completionTokens = completion.usage?.completion_tokens || 0;
    const promptTokens = completion.usage?.prompt_tokens || 0;

    console.log(
      `[AppendixGen] Attempt ${attempt} returned: finish_reason=${finishReason} ` +
        `completion_tokens=${completionTokens} prompt_tokens=${promptTokens} response_chars=${fullResponse.length}`,
    );

    return { fullResponse, finishReason, completionTokens, promptTokens, completion };
  };

  let attempt = await callOnce(PRIMARY_MAX_TOKENS, 1);
  let appendixMarkdown = stripOuterMarkdownFence(attempt.fullResponse);

  // If the model still wrapped it in JSON, try to unwrap.
  if (appendixMarkdown.startsWith('{')) {
    const extracted = tryExtractFromJson(appendixMarkdown);
    if (extracted) {
      console.warn(
        '[AppendixGen] Model returned JSON despite plain-markdown instructions — extracted diagnosticAppendix field.',
      );
      appendixMarkdown = extracted;
    }
  }

  const looksTruncated = (text: string, finishReason: string) =>
    finishReason === 'length' || text.trim().length < 500;

  if (looksTruncated(appendixMarkdown, attempt.finishReason)) {
    console.warn(
      `[AppendixGen] First attempt looks truncated (finish_reason=${attempt.finishReason}, chars=${appendixMarkdown.length}) — retrying with max_tokens=${RETRY_MAX_TOKENS}`,
    );
    attempt = await callOnce(RETRY_MAX_TOKENS, 2);
    let retryMarkdown = stripOuterMarkdownFence(attempt.fullResponse);
    if (retryMarkdown.startsWith('{')) {
      const extracted = tryExtractFromJson(retryMarkdown);
      if (extracted) retryMarkdown = extracted;
    }
    // Prefer the longer of the two attempts so we never throw away a
    // partially-good first response in favour of a shorter retry.
    if (retryMarkdown.length > appendixMarkdown.length) {
      appendixMarkdown = retryMarkdown;
    }
  }

  if (!appendixMarkdown || appendixMarkdown.trim().length < 200) {
    throw new Error(
      `Appendix generation failed: model returned an empty or trivially short response (${appendixMarkdown.length} chars, finish_reason=${attempt.finishReason}). Response start: ${attempt.fullResponse.substring(0, 200)}`,
    );
  }

  console.log(`[AppendixGen] Appendix generated - length: ${appendixMarkdown.length} chars`);

  const inputTokens = attempt.completion.usage?.prompt_tokens || 0;
  const outputTokens = attempt.completion.usage?.completion_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const costs = getModelCost(modelUsed);
  const costUsd = (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;

  return {
    diagnosticAppendix: appendixMarkdown,
    metadata: {
      modelUsed,
      temperature: 0.3,
      tokensUsed: totalTokens,
      costUsd,
      generatedAt: new Date().toISOString(),
    },
  };
}
