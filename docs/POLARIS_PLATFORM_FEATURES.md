# Polaris AI Platform
## Comprehensive Feature Documentation

**Document Purpose:** Executive overview of platform capabilities for senior leadership  
**Version:** 2.0  
**Last Updated:** June 2026

> **Note (May 2026, Task #38):** Polaris now defaults to the GPT-5.4 family
> (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`), Claude Sonnet 4.5, Claude Opus
> 4.1, Gemini 2.5 Pro/Flash, and Sonar Pro. Each of the 14 internal AI call
> sites is independently routable via `LLM_<FUNCTION>_MODEL` env vars (single
> source of truth: `server/config/llm-functions.ts`). See
> `audits/LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md` for the full inventory.

---

## Executive Summary

Polaris AI is a **Brand Visibility & Competitive Intelligence Platform** designed to analyze how AI language models (GPT-4, Claude, Gemini, Perplexity) respond to prompts about companies and their competitors. 

The platform provides actionable intelligence on **AI-mediated brand presence**, helping businesses understand and improve how they appear in AI-generated recommendations, enabling strategic content optimization for the AI-first search landscape.

### Core Value Proposition

| Capability | Business Impact |
|------------|-----------------|
| Multi-Model Testing | Understand brand perception across all major AI platforms simultaneously |
| Competitive Benchmarking | Quantify competitive gaps with score-based rankings |
| Citation Tracking | Identify which sources AI models cite when recommending (or excluding) your brand |
| Score Explainability | Understand WHY specific visibility scores are received |
| Content Optimization | Get AI-powered recommendations for improving brand presence |
| Executive Reporting | Generate consulting-ready PDF reports for stakeholder communication |

---

# Table of Contents

1. [Setup & Configuration](#1-setup--configuration)
2. [Metadata Generation](#2-metadata-generation)
3. [Prompt Execution](#3-prompt-execution)
4. [Dashboard & Analytics](#4-dashboard--analytics)
5. [Opportunities](#5-opportunities)
6. [Executive Reports](#6-executive-reports)

---

# 1. Setup & Configuration

## 1.1 Client Catalog

**Purpose:** Central repository of all client/brand profiles being analyzed.

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Multi-Client Management** | Support for multiple brands/clients per organization | Agencies can manage multiple client accounts from single platform |
| **Quick Client Selection** | One-click switching between client contexts | Efficient workflow for analysts managing multiple brands |
| **Onboarding Status Tracking** | Visual indicators for setup completion (Draft → In Progress → Completed) | Clear visibility into readiness for analysis |
| **Guided Setup Wizard (resume)** | The step-by-step new-project wizard can also be re-opened for an *existing* project, pre-filled with its current details, to review or update setup. Re-running it updates the same project — it never creates a duplicate. | Walk back through guided setup to fix or extend a project without starting over |

---

## 1.2 Client Configuration

**Purpose:** Define all parameters needed for comprehensive brand analysis.

### 1.2.1 Project Identification

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Project Name** | Custom naming for analysis campaigns (e.g., "Q1 2025 Brand Campaign") | Organize analyses by business initiative |
| **Company/Brand Name** | Primary brand identifier used in AI model queries | Accurate brand matching in AI responses |
| **Industry Classification** | Industry category for contextual analysis | Industry-specific benchmarking and insights |

### 1.2.2 Website URLs (Multi-URL Support)

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Primary URL** | Main company website | Core source for content crawling and analysis |
| **Secondary URLs** | Additional owned properties (up to 3 total) | Comprehensive coverage of brand's web presence |
| **Third-Party URLs** | External presence (LinkedIn, Crunchbase, etc.) | Understand external brand perception and citations |
| **URL Categorization** | Automatic classification of owned vs. external properties | Accurate domain attribution in citation analysis |

### 1.2.3 Focus Areas

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Strategic Focus Topics** | Up to 10 client-specific products, services, or capabilities | Guide prompt generation toward business-critical areas |
| **Custom Keyword Targeting** | Fine-tune analysis focus | Ensure AI queries align with business priorities |

### 1.2.4 Geography Targeting

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Regional Selection** | 1-3 target regions | Location-specific brand visibility analysis |
| **Multi-Region Support** | Analyze presence across different markets | Global brand consistency measurement |

### 1.2.5 Brand Aliases

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Alternative Names** | Up to 10 brand variations (abbreviations, product names) | Capture all brand mentions regardless of naming variation |
| **Automatic Matching** | System recognizes all aliases in AI responses | More accurate mention detection and scoring |
| **Example:** | "AJIO" matches "AJIO", "AJIO Luxe", "Ajio Fashion" | No missed brand mentions due to naming differences |

### 1.2.6 Competitor Management

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Competitor Profiles** | Add/edit competitor details (name, website, aliases) | Track competitive landscape accurately |
| **Competitor Scoring** | Same scoring methodology applied to competitors | Fair, consistent benchmarking |
| **Competitive Rankings** | Side-by-side visibility comparison | Clear competitive positioning insights |

### 1.2.7 AI Model Selection

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Multi-Vendor Support** | OpenAI (GPT-4, GPT-4o), Anthropic (Claude 3.5), Google (Gemini), Perplexity | Understand brand perception across all major AI platforms |
| **Core Models** | Pre-selected essential models for baseline coverage | Quick setup with industry-standard AI engines |
| **Additional Models** | Extended selection for comprehensive testing | Future-proof coverage as new models emerge |
| **Per-Client Configuration** | Each client can have different model selections | Tailored analysis based on client needs |

---

# 2. Metadata Generation

**Purpose:** Build the foundation of topics, keywords, and prompts that drive brand visibility analysis.

## 2.1 Site X-Ray

**Purpose:** AI-powered analysis of client website content quality, SEO health, and optimization opportunities.

### 2.1.1 Intelligent Website Crawling

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Multi-Page Extraction** | Crawl entire website structure, not just homepage | Comprehensive content discovery |
| **Stealth Crawling** | Advanced anti-detection with 15+ evasion techniques | Successfully crawl protected enterprise sites |
| **Content Aggregation** | Combine content from all client URLs | Complete picture of brand's web presence |
| **Source URL Tracking** | Track which page each content element came from | Trace insights back to specific pages |
| **Isolated Storage** | Separate crawl storage per job | Prevent cross-contamination between concurrent jobs |

**Stealth Technology Details:**
- Webdriver flag removal
- Chrome runtime patching
- Navigator override spoofing
- Plugin spoofing
- Consistent browser profiles (User-Agent matching Sec-CH-* headers)
- Human-like delays (1-3 seconds between requests)
- Reduced concurrency to evade bot protection

### 2.1.2 AI Content Analysis

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Content Quality Scoring** | GPT-4 analysis with numerical quality scores | Quantify content effectiveness objectively |
| **SEO Health Evaluation** | Technical SEO issue detection | Discover crawlability problems affecting AI indexing |
| **Structure Analysis** | Heading hierarchy, schema markup, meta tags | Identify structural issues limiting AI comprehension |
| **Batch Processing** | Analyze multiple pages efficiently | Scalable analysis for large websites |
| **Retry Logic** | Automatic retry on failures with backoff | Reliable analysis completion |

### 2.1.3 Health Probe System

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **robots.txt Detection** | Check AI crawler access permissions | Identify if AI models are blocked from indexing |
| **ai.txt Detection** | Check AI-specific access files | Understand AI-specific crawl policies |
| **Dual-UA Strategy** | Chrome first, PolarisBot fallback | Accurate detection even on enterprise sites |
| **Manual Refresh Endpoint** | Force re-probe on demand | Get updated status immediately |
| **Stale Data Refresh** | Automatic re-probe after 24 hours | Always current access status |
| **lastProbedAt Tracking** | Timestamp of last health check | Know how fresh the data is |

### 2.1.4 Site X-Ray Dashboard

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Page-by-Page Analysis** | Individual assessment of each crawled page | Prioritize which pages need attention |
| **Quality Scores** | Content, SEO, and Structure scores per page | Multi-dimensional quality assessment |
| **Actionable Recommendations** | Specific suggestions per page | Clear next steps for content teams |
| **Accordion Drill-Down** | Expand pages to see detailed recommendations | Manage information complexity |
| **Internal vs Third-Party** | Separate views for owned vs external content | Focus on controllable improvements |

### 2.1.5 Site X-Ray API Endpoints (7 RESTful APIs)

| Endpoint | Purpose |
|----------|---------|
| **GET /xray/sites** | List all crawled sites for client |
| **GET /xray/sites/:id** | Get detailed site analysis |
| **GET /xray/pages** | List analyzed pages with scores |
| **GET /xray/pages/:id/recommendations** | Get page-specific recommendations |
| **POST /xray/analyze** | Trigger batch analysis job |
| **POST /xray/health-probe/refresh** | Force health probe refresh |
| **GET /xray/summary** | Aggregated X-Ray statistics |

---

## 2.2 Topics & Keywords

**Purpose:** Generate and manage strategic topics that drive prompt creation.

### 2.2.1 Dual-Source Topic Generation

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **AI-Generated Topics** | GPT-4 Turbo analysis of website content | Discover topics you may have overlooked |
| **Crawl-Extracted Topics** | Topics derived from actual website content | Ensure coverage of existing content themes |
| **Manual Topic Entry** | User-defined strategic topics | Include business priorities not on website |

### 2.2.2 Topic Management

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Category Classification** | Product, Service, Industry categories | Organize topics by business function |
| **Keyword Association** | Related keywords per topic | Enrich topic coverage for prompt generation |
| **Accept/Reject Workflow** | Curate AI-generated topics | Quality control over analysis focus |
| **Bulk CSV Upload** | Import topics from external sources | Quick setup from existing keyword research |

### 2.2.3 Metadata Generation Job

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Background Processing** | Non-blocking metadata generation | Continue working while analysis runs |
| **Progress Tracking** | Real-time status updates | Visibility into generation progress |
| **Optional X-Ray Integration** | Trigger Site X-Ray during metadata generation | Streamlined single-action setup |

---

## 2.3 Prompt Library

**Purpose:** Manage the bank of questions/prompts used to test AI models.

### 2.3.1 Prompt Sources

| Source | Description | Business Value |
|--------|-------------|----------------|
| **AI-Generated** | Prompts created by GPT-4 based on topics | Intelligent prompt variety beyond human brainstorming |
| **Crawl-Derived** | Prompts based on website content analysis | Test AI visibility for actual content themes |
| **Manual Entry** | Custom strategic prompts | Test specific competitive scenarios |
| **CSV Upload** | Bulk import from spreadsheets | Efficient setup from existing prompt banks |

### 2.3.2 Prompt Categorization System

**7-Category Taxonomy for Measuring AI Visibility:**

| Category | Description | Example Prompt | Why It Matters |
|----------|-------------|----------------|----------------|
| **Unbranded Discovery** | Generic category queries | "Best fashion e-commerce sites in India" | Tests organic discovery without brand mention |
| **Branded Queries** | Direct brand searches | "Tell me about AJIO" | Tests brand recognition and sentiment |
| **Competitive Comparison** | Head-to-head comparisons | "AJIO vs Myntra - which is better?" | Tests competitive positioning |
| **Competitor Mention** | Competitor-focused queries | "What are alternatives to Myntra?" | Tests if brand appears as alternative |
| **Location-Based** | Geographic queries | "Best online shopping in Mumbai" | Tests regional visibility |
| **Use Case Specific** | Functional queries | "Where to buy designer clothes online?" | Tests use-case matching |
| **Hyper-Specific** | Niche queries | "AJIO Luxe discount codes" | Tests deep brand knowledge |

### 2.3.3 Prompt Management

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Accept/Reject Workflow** | Curate prompts before testing | Quality control over test coverage |
| **Category Assignment** | Automatic AI classification | Understand visibility by prompt type |
| **Backfill Existing Prompts** | Retroactively categorize prompts | Apply taxonomy to historical data |

---

# 3. Prompt Execution

**Purpose:** Execute prompts against selected AI models and track results.

## 3.1 Prompt Run Management

### 3.1.1 Starting a New Run

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Prompt Selection** | Choose which prompts to include | Focused testing on specific areas |
| **Model Selection** | Override default model selection per run | Test specific AI platforms |
| **Run Naming** | Custom name for tracking | Organize runs by campaign or date |
| **Batch Execution** | Test N prompts × M models simultaneously | Comprehensive coverage in single action |

### 3.1.2 Progress Tracking

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Real-Time Status** | Live updates as prompts execute | Monitor analysis progress |
| **4-Stage Status Model** | Queued → Running → Benchmarking → Done | Clear understanding of execution phase |
| **Progress Percentage** | Visual progress bar | Estimate completion time |
| **Per-Prompt Status** | Individual prompt tracking | Identify which prompts are complete |

### 3.1.3 Run Controls

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Stop Run** | Cancel running execution | Abort if incorrect parameters detected |
| **Delete Run** | Remove run and all associated data | Clean up test or incorrect runs |
| **Rename Run** | Update run name | Better organization post-execution |

### 3.1.4 Reliability Features

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Checkpoint System** | Save progress at each execution stage | Resume after server restarts or interruptions |
| **Heartbeat Monitoring** | 30-second heartbeat proves job is alive | Detect stalled executions within 5 minutes |
| **Auto-Resume** | Automatic restart of stalled jobs (max 3 attempts) | Reliable completion without manual intervention |
| **Dynamic Timeouts** | 15 min base + 30s per item (max 60 min) | Appropriate timeout for job complexity |
| **Rate Limit Handling** | Per-model delays (5s for Gemini) | Avoid API throttling failures |

### 3.1.5 Job Queue Architecture

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Background Processing** | Non-blocking job execution | Users can continue working during runs |
| **Concurrency Limiting** | Max 3 concurrent jobs | Prevent database/API overload |
| **15-Second Polling** | Regular job status checks | Balance responsiveness with efficiency |
| **Frontend Exponential Backoff** | Poll interval 3s → 10s | Reduce server load during long runs |
| **Connection Gating** | Max 20 concurrent HTTP requests | Prevent Neon database overload |

### 3.1.6 Checkpoint & Recovery System

**Checkpoint Data Stored:**
- Completed item IDs (skip on resume)
- Current execution stage (execution → benchmarking)
- Last heartbeat timestamp

**Stale Detection Logic:**
1. Job heartbeats every 30 seconds during execution
2. If no heartbeat for 5 minutes → job marked stale
3. Stale jobs auto-resume instead of failing
4. Max 3 resume attempts before marking as failed
5. Checkpoint cleared on successful completion

**Business Value:** Prevents production stalls when application left idle; ensures expensive AI API calls aren't wasted on restarts.

---

## 3.2 Run Results View

### 3.2.1 Per-Prompt Results

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **AI Response Display** | Full text of each AI model's response | See exactly what AI models say about brand |
| **Score Breakdown** | V/S/P scores per prompt per model | Granular visibility into performance |
| **Collapsible Sections** | Expand/collapse response details | Manage information density |

### 3.2.2 Mention Detection

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Brand Mention Highlighting** | Visual highlight of brand mentions | Quickly spot where brand appears |
| **Alias Detection** | Finds all brand name variations | Complete mention coverage |
| **Mention Count** | Total mentions per response | Quantify brand presence |
| **First Mention Position** | Where brand first appears in response | Early mention = higher visibility |

### 3.2.3 Ranking Detection

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **LLM-Powered Extraction** | GPT-4o-mini detects ranked lists | Accurate ranking detection across formats |
| **Multi-Format Support** | Numbers, letters, bullets, roman numerals | Works with any list style |
| **"YOU" Badge** | Visual indicator when client appears in rankings | Instantly see client position |
| **Competitor Identification** | Recognize competitors in rankings | Competitive position awareness |
| **Tie-Breaking Logic** | Consistent ordering for tied positions | Fair ranking comparisons |

### 3.2.4 Citation Analysis

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **URL Extraction** | Identify all cited URLs in responses | Know what sources AI models reference |
| **De-Duplication** | Remove duplicate citations | Clean citation counts |
| **Domain Grouping** | Group by root domain | Understand citation patterns |
| **Self-Citation Detection** | Identify when AI cites client URLs | Track earned citations |

---

# 4. Dashboard & Analytics

**Purpose:** Aggregate view of brand visibility performance with actionable insights.

## 4.1 Overall Performance Metrics

### 4.1.1 Core Scores

| Score | What It Measures | Scale | Impact |
|-------|------------------|-------|--------|
| **Visibility Score** | How prominently brand appears in AI responses | 0-100 | Higher = more visible to AI users |
| **Sentiment Score** | Positive vs. negative brand perception | 0-100 | Higher = more favorable mentions |
| **Position Score** | Where brand ranks in competitive lists | 0-100 | Higher = better ranking position |
| **Overall Score** | Weighted combination (50% V + 30% S + 20% P) | 0-100 | Single benchmark metric |

### 4.1.2 Visibility Scoring System (V2)

**Feature Flag:** Controlled by `VISIBILITY_SCORING_VERSION` environment variable

| Version | Description | Key Difference |
|---------|-------------|----------------|
| **V1 (Legacy)** | Original scoring with unnormalized weights | Weights don't sum to 1.0 |
| **V2 (Current)** | Normalized weights summing to 1.0 | Mathematically correct percentages |

**V2 Visibility Score Factors:**

| Factor | Weight | Formula | What It Measures |
|--------|--------|---------|------------------|
| **Mention Rate** | 40% | (mentions ÷ tokens) × 100 | How frequently brand is mentioned relative to text length |
| **First Position** | 30% | 1 - (first_char_pos ÷ text_len) | How early brand first appears (inverted: early = high) |
| **Heading Bonus** | 15% | min(1, heading_hits ÷ 5) | Mentions in headings, lists, numbered items (capped at 5) |
| **Coverage** | 15% | bins_with_mentions ÷ 10 | Distribution across 10 equal text sections |

**Shifted Sigmoid Scaling:**
- Raw score passed through sigmoid function
- Ensures: 0 mentions = 0% score (not 50%)
- Natural ceiling near 100% for high visibility
- Prevents extreme scores for edge cases

### 4.1.3 Position Scoring (nDCG)

**Group-Aware LLM Ranking Detection:**

| Feature | Description |
|---------|-------------|
| **Multi-Format Detection** | Numbers, letters, roman numerals, bullets |
| **Entity vs Feature Distinction** | Separates "5 features of X" from "Top 5 companies" |
| **Ranking Group Identification** | Handles multiple lists in single response |
| **Tie-Breaking Logic** | Appearance order breaks ties for consistent scoring |

**nDCG (Normalized Discounted Cumulative Gain) Formula:**

```
DCG = Σ (relevance / log₂(1 + position))
nDCG = DCG / Ideal_DCG × 100
```

Position 1 = highest score, diminishing returns for lower positions.

### 4.1.5 Sentiment Scoring

**Aspect-Based Sentiment Analysis (ABSA):**

| Feature | Description |
|---------|-------------|
| **LLM-Powered Analysis** | GPT-4o-mini analyzes sentiment per entity mention |
| **Probability Distribution** | Returns p_pos, p_neu, p_neg for each mention |
| **Confidence Weighting** | Higher confidence mentions weighted more |
| **Fallback Scoring** | Regex-based analysis if entity mentions empty |

**Sentiment Score Formula:**
```
raw_sentiment = p_positive - p_negative  (range: -1 to +1)
weighted_sentiment = Σ(raw × confidence) / Σ(confidence)
final_score = (weighted_sentiment + 1) × 50  (range: 0-100)
```

**Positive/Negative Term Detection:**
- Positive: excellent, outstanding, best, leading, innovative, trusted, quality
- Negative: poor, terrible, disappointing, problematic, avoid, overpriced

### 4.1.6 Score Interpretation

| Score Range | Interpretation | Recommended Action |
|-------------|----------------|-------------------|
| 80-100 | Excellent visibility | Maintain current strategy |
| 60-79 | Good visibility | Minor optimization needed |
| 40-59 | Average visibility | Significant improvement needed |
| 0-39 | Poor visibility | Urgent action required |

---

## 4.2 Results by AI Model

### 4.2.1 Model Comparison

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Per-Model Scores** | V/S/P breakdown by AI platform | Identify which AI models favor/exclude brand |
| **Cross-Model Patterns** | Compare performance across models | Discover platform-specific issues |
| **Model-Specific Insights** | Why certain models score differently | Targeted optimization strategies |

### 4.2.2 Collapsible Detail View

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Expand/Collapse** | Show/hide detailed metrics per model | Manage dashboard information density |
| **Mention Details** | See exact mention text and positions | Understand how AI describes brand |
| **Ranking Details** | See full ranked lists with positions | Competitive context for each response |

---

## 4.3 Competitor Rankings

### 4.3.1 Competitive Leaderboard

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Ranked Competitor List** | All competitors sorted by overall score | Clear competitive hierarchy |
| **Score Comparison** | Side-by-side V/S/P comparison | Identify competitive advantages/gaps |
| **"YOU" Indicator** | Highlight client position in rankings | Instant competitive position awareness |
| **Gap to Leader** | Quantified difference from top competitor | Know how much improvement needed |

### 4.3.2 Consistent Competitor Scoring

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Same Methodology** | Identical scoring applied to competitors | Fair, apples-to-apples comparison |
| **Same Weighting** | 50/30/20 weights for all entities | Consistent benchmark metrics |
| **Latest Run Focus** | Only current run data (no historical mixing) | Accurate point-in-time comparison |

---

## 4.4 Historical Analysis

### 4.4.1 Time Series Charts

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Visibility Trend** | Score over time across runs | Track improvement trajectory |
| **Sentiment Trend** | Sentiment changes over time | Monitor perception shifts |
| **Position Trend** | Ranking changes over time | Track competitive movement |

### 4.4.2 Run Filter Bar

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Historical Run Selection** | View dashboard for any past run | Compare performance across time periods |
| **Date-Based Filtering** | Select runs by date range | Analyze specific campaign periods |
| **Baseline Comparison** | Compare current vs. historical | Measure impact of optimization efforts |

---

# 5. Opportunities

**Purpose:** Actionable insights and content recommendations to improve AI visibility.

## 5.1 Citation Analysis

### 5.1.1 Citation Sources Dashboard

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Ranked Citation Sources** | All domains cited by AI models, ranked by frequency | Know which sources AI trusts |
| **Domain Grouping** | Group by root domain (all Wikipedia URLs = "wikipedia.org") | Clear source-level patterns |
| **Citation Frequency** | How often each source is cited | Prioritize partnership/content opportunities |
| **Usage Percentage** | What % of responses cite each source | Understand AI's source preferences |

### 5.1.2 Client Domain Detection

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Self-Citation Identification** | Highlight when AI cites client domains | Track earned visibility |
| **"YOU" Badge** | Visual indicator on client domains | Instantly see self-citations |
| **Multi-Domain Support** | Recognize all client URLs | Complete self-citation coverage |

### 5.1.3 Drill-Down Analysis

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Domain Expansion** | Click domain to see all specific URLs | Understand exactly which pages are cited |
| **URL-Level Frequency** | Citation count per specific page | Identify most valuable content |
| **External Link** | Direct access to cited pages | Review competitor/source content |

### 5.1.4 Run Filtering

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Per-Run Citation Analysis** | Filter citations by specific prompt run | Analyze citation patterns over time |
| **Historical Comparison** | Compare citation sources across runs | Track citation improvements |

---

## 5.2 Recommendations

### 5.2.1 AI-Powered Recommendations

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Content Recommendations** | Suggestions based on gap analysis | Specific actions to improve visibility |
| **Priority Classification** | High/Medium/Low priority rating | Focus on highest-impact actions first |
| **Category Classification** | Content, Technical, Partnership, etc. | Route recommendations to right teams |

### 5.2.2 Source Attribution

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Multi-Source Tracking** | Know where each recommendation originated | Understand recommendation basis |
| **Sources Include:** | Crawl, Prompt, Citation, AI Analysis, Manual | Comprehensive recommendation coverage |
| **De-Duplication** | Remove duplicate recommendations | Clean, actionable list |

### 5.2.3 Recommendation Management

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Summary Table View** | Scannable list with key info | Quick identification of high-priority items |
| **Detailed Card View** | Full recommendation details | Complete context for implementation |
| **Filtering & Sorting** | Filter by category, priority, source | Focus on relevant recommendations |
| **Pagination** | Manageable page sizes | Navigate large recommendation sets |
| **Manual Entry** | Add custom recommendations | Include strategic initiatives |

### 5.2.4 Run Filtering

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Per-Run Recommendations** | View recommendations from specific runs | Track recommendation evolution |
| **All Runs View** | Aggregate recommendations across runs | Complete action list |

---

## 5.3 Content Generator

### 5.3.1 AI-Generated Content

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Optimized Content Creation** | GPT-4 generated content for AI discoverability | Ready-to-use content templates |
| **Citation-Based Topics** | Content based on what AI models cite | Target proven AI-preferred topics |
| **Multiple Formats** | Blog posts, FAQs, descriptions | Flexible content types |

### 5.3.2 Content Management

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Copy to Clipboard** | One-click content copy | Quick content transfer |
| **Download as File** | Export content as text file | Archive generated content |
| **Topic Attribution** | Know which topic generated each content | Connect content to strategy |

### 5.3.3 Run Filtering

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Per-Run Content** | Filter generated content by prompt run | Track content creation over time |

---

# 6. Executive Reports

**Purpose:** Generate consulting-ready PDF reports for stakeholder communication, matching Kroger and Vitamin Shoppe consulting quality standards.

## 6.1 Unified Dual-Report Generation

**Single background job generates two parallel PDF reports:**

| Report Type | Purpose | Audience | File Type |
|-------------|---------|----------|-----------|
| **Insights Report** | Strategic narrative with 12 consulting sections | Senior Leadership, Board, C-Suite | `insights_pdf` |
| **Diagnostic Appendix** | Detailed metrics and technical analysis | Marketing/Content Teams, Implementation | `appendix_pdf` |

**Parallel Generation:** Both reports generated simultaneously using Promise.all for optimal performance.

### 6.1.1 Report Generation Pipeline

**8-Step Unified Progress Tracking:**

| Step | Action | What Happens |
|------|--------|--------------|
| 1 | Data Aggregation | Collect all prompt run data, scores, citations, rankings |
| 2 | Metrics Calculation | Compute aggregated visibility, sentiment, position metrics |
| 3 | Consulting Context | Build benchmarks, SWOT insights, competitive analysis |
| 4 | Insights Narrative | GPT-4o generates 12 consulting sections |
| 5 | Diagnostic Content | GPT-4o generates technical appendix |
| 6 | Quality Validation | Quality gate checks all sections |
| 7 | PDF Rendering | Convert markdown to consulting-grade PDFs |
| 8 | File Storage | Save both PDFs with tracking metadata |

### 6.1.2 Report Aggregation System (3-Phase)

**Phase 1 - Data Foundation:**
| Function | Purpose |
|----------|---------|
| `calculateVisibilityByModel()` | V/S/P breakdown per AI model |
| `calculateMentionRates()` | Mention frequency analysis |
| `calculateRankingAnalysis()` | Position and nDCG metrics |
| `calculateCitationAnalysis()` | Citation source patterns |
| `calculateTopCompetitors()` | Competitive landscape ranking |

**Phase 2 - Narrative Enhancement:**
| Component | Content |
|-----------|---------|
| **Consulting Benchmarks** | Excellent/Good/Average/Poor thresholds |
| **Score Interpretations** | "What it means" for each metric |
| **Competitive Context** | Rank, gap to leader, vs-average comparison |
| **SWOT Insights** | Strengths, weaknesses, opportunities, threats |
| **Per-Model Breakdown** | Model-specific performance analysis |

**Phase 3 - Quality Gate:**
| Validation | Action |
|------------|--------|
| Style Guide Check | Verify tone (urgent, declarative, authoritative) |
| Pattern Validation | Check for required patterns per section |
| Score Calculation | Numeric quality score per section |
| Critical Issue Detection | Flag empty sections, missing patterns |
| Blocking Decision | Reject reports below quality threshold |

## 6.2 Report Sections (16 Consulting Narrative Sections)

### 6.2.1 Core Sections (5)

| Section | Content | Consulting Value |
|---------|---------|------------------|
| **Executive Summary** | Key findings, top 3 metrics, competitive position | 30-second leadership overview |
| **Patterns & Root Causes** | Why visibility scores are what they are | Strategic understanding of gaps |
| **Strategic Implications** | Business impact of current visibility | Connect insights to revenue |
| **Leadership Conversations** | Talking points for stakeholder discussions | Prepared for board questions |
| **Next Steps** | Prioritized 3-5 action recommendations | Clear path forward |

### 6.2.2 Kroger-Inspired Sections (5)

| Section | Content | Consulting Value |
|---------|---------|------------------|
| **Intent Level Performance** | Performance by 7 prompt categories | Visibility by query type |
| **Key Structural Issues** | Technical/content problems affecting visibility | Specific fix targets |
| **Why LLMs Exclude Brand** | Root causes of exclusion from recommendations | Actionable improvement areas |
| **30/60/90-Day Plan** | Phased improvement roadmap | Time-bound action plan |
| **Strategic Implications for Business** | Revenue/growth impact analysis | Business case for investment |

### 6.2.3 Vitamin Shoppe-Inspired Sections (5)

| Section | Content | Consulting Value |
|---------|---------|------------------|
| **What Prompts Tell Us** | Insights from prompt analysis patterns | Query-level strategic insights |
| **Cross-Prompt Themes** | Common patterns across all prompts | Identify systemic issues |
| **Consulting Inference** | Expert interpretation of data | Value-added analysis beyond metrics |
| **Client Conversations** | Recommended stakeholder talking points | Communication guidance |
| **Next Steps Positioning** | Strategic positioning recommendations | Long-term competitive strategy |

### 6.2.4 AI-Discovered Insights (1)

| Section | Content | Consulting Value |
|---------|---------|------------------|
| **Emergent Competitor Analysis** | Competitors discovered from rankings data | Uncover unexpected competitive threats |

## 6.3 Quality Gate System

### 6.3.1 Style Guide Injection

**Required Tone:**
- Urgent and declarative
- Authoritative and confident
- Data-grounded assertions
- Gold sentence patterns from Kroger/Vitamin Shoppe reports

### 6.3.2 Per-Section Requirements

| Section | Required Patterns |
|---------|-------------------|
| **Executive Summary** | Numbered bullets, metrics, comparison context, "what it means" |
| **Patterns & Root Causes** | Data citations, causal analysis, actionable insights |
| **30/60/90-Day Plan** | Time-phased actions, measurable outcomes, owner assignments |
| **All Sections** | No empty content, minimum word count, business implications |

### 6.3.3 Quality Scoring

| Validation | Point Deduction |
|------------|-----------------|
| Missing metrics | -15 points |
| Missing "what it means" | -15 points |
| Missing comparison context | -10 points |
| Empty section | Critical issue flag |
| Score below 20 | Critical issue flag |

### 6.3.4 Authoritative Blocking

**Report generation fails if:**
- Any critical issues exist
- Overall score < 40
- Any section scores < 20

**Business Value:** Ensures every delivered report meets consulting-grade standards.

## 6.4 Report Management

### 6.4.1 Background Job Processing

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Non-Blocking Execution** | Reports generate in background | Continue working during generation |
| **8-Step Progress** | "Step X of 8: [action]" updates | Real-time visibility into progress |
| **Combined Token/Cost Tracking** | Track AI usage per report | Cost management and optimization |
| **Full Lifecycle Management** | Create → Process → Complete/Error | Reliable job state tracking |

### 6.4.2 Report Downloads

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Insights PDF Download** | `/api/v1/reports/:id/download?type=insights_pdf` | Strategic report for leadership |
| **Appendix PDF Download** | `/api/v1/reports/:id/download?type=appendix_pdf` | Technical report for teams |
| **Legacy Support** | `type=pdf` falls back to insights | Backward compatibility |
| **Independent Downloads** | Each report downloadable separately | Right content for right audience |

### 6.4.3 Report Preview

| Feature | Description | Business Value |
|---------|-------------|----------------|
| **Tabbed Interface** | Separate tabs for Insights and Appendix | Easy navigation between reports |
| **Markdown Rendering** | Formatted preview with proper styling | See final appearance before download |
| **Enhanced Formatting** | Consulting-grade markdown-to-HTML | Professional presentation |
| **Section Navigation** | Jump to specific sections | Quick access to key insights |

### 6.4.4 Report API Endpoints (5)

| Endpoint | Purpose |
|----------|---------|
| **POST /reports/generate** | Trigger new report generation |
| **GET /reports/:id** | Get report status and metadata |
| **GET /reports/:id/preview** | Get formatted preview content |
| **GET /reports/:id/download** | Download PDF (type param for insights/appendix) |
| **GET /reports** | List all reports for client |

## 6.5 Data Snapshot System

### 6.5.1 Virtual Snapshot Aggregation

| Data Captured | Source |
|---------------|--------|
| **Run Metadata** | Selected prompt runs, timestamps, model selection |
| **Score Aggregates** | Visibility, sentiment, position by model and overall |
| **Citation Data** | All citations with domain grouping |
| **Ranking Data** | All extracted rankings with positions |
| **Competitor Scores** | Competitive benchmark data |
| **Aggregated Metrics** | Pre-computed analytics for narrative |

### 6.5.2 Snapshot Persistence

| Feature | Description |
|---------|-------------|
| **Database Storage** | Snapshots saved to `report_snapshots` table |
| **Immutable Data** | Snapshot represents point-in-time analysis |
| **Report Linkage** | Each report tied to specific snapshot |
| **Historical Access** | Regenerate reports from past snapshots |

**Business Value:** Reports always reflect the data state at generation time, even if underlying data changes.

---

# Appendix: Technical Differentiators

## A.1 LLM-Only Extraction

| Feature | Description | Why It Matters |
|---------|-------------|----------------|
| **No Regex/Heuristics** | All extraction via GPT-4o-mini | Higher accuracy across AI response formats |
| **Structured Output** | JSON-validated LLM responses | Reliable data extraction |
| **Hallucination Prevention** | Strict validation against source text | Trustworthy metrics |

## A.2 Multi-Provider Support

| Provider | Models Supported |
|----------|-----------------|
| **OpenAI** | GPT-4 Turbo, GPT-4o, GPT-4o Mini |
| **Anthropic** | Claude 3 Opus, Claude 3.5 Sonnet |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 3 Pro |
| **Perplexity** | Llama-based models |

## A.3 Enterprise Reliability

| Feature | Description |
|---------|-------------|
| **Checkpoint System** | Resume from any execution stage |
| **Heartbeat Monitoring** | Detect and recover stalled jobs |
| **Rate Limit Handling** | Intelligent API throttling |
| **Connection Gating** | Prevent database overload |

## A.4 Visibility Scoring V2

| Feature | Description |
|---------|-------------|
| **Normalized Weights** | Sum to 1.0 for mathematical correctness |
| **Shifted Sigmoid** | 0 mentions = 0% score (not 50%) |
| **Self-Citation Bonus** | Credit for earned citations |
| **Feature Flag Control** | Toggle between V1/V2 |

---

# Summary: Platform Value Proposition

| Business Challenge | Polaris Solution |
|-------------------|-----------------|
| "How visible is our brand in AI recommendations?" | Quantified Visibility Score across all major AI models |
| "Why don't AI assistants recommend us?" | Root cause analysis with actionable fixes |
| "How do we compare to competitors?" | Side-by-side competitive benchmarking |
| "What content should we create?" | AI-powered content recommendations |
| "How do we report this to leadership?" | Consulting-ready PDF reports |
| "How do we improve over time?" | Historical tracking and trend analysis |

---

---

# Appendix B: Complete API Reference

## B.1 Core API Endpoints

| Category | Endpoint | Method | Purpose |
|----------|----------|--------|---------|
| **Clients** | `/api/v1/clients` | GET/POST | List/create clients |
| **Clients** | `/api/v1/clients/:id` | GET/PATCH/DELETE | Manage specific client |
| **Competitors** | `/api/v1/competitors` | GET/POST | Manage competitors |
| **AI Models** | `/api/v1/ai-models` | GET | List available AI models |
| **Topics** | `/api/v1/topics` | GET/POST | Manage topics |
| **Prompts** | `/api/v1/prompts` | GET/POST | Manage prompts |
| **Prompt Runs** | `/api/v1/prompt-runs` | GET/POST | List/create runs |
| **Prompt Runs** | `/api/v1/prompt-runs/:id` | GET/DELETE | Manage specific run |
| **Prompt Runs** | `/api/v1/prompt-runs/:id/stop` | POST | Stop running execution |
| **Prompt Runs** | `/api/v1/prompt-runs/:id/results` | GET | Get run results |
| **Prompt Runs** | `/api/v1/prompt-runs/:id/logs` | GET | Get execution logs |
| **Dashboard** | `/api/v1/dashboard/stats` | GET | Aggregated statistics |
| **Dashboard** | `/api/v1/dashboard/competitor-rankings` | GET | Competitive leaderboard |
| **Dashboard** | `/api/v1/dashboard/historical-scores` | GET | Time series data |
| **Opportunities** | `/api/v1/opportunities/citations` | GET | Citation analysis |
| **Opportunities** | `/api/v1/opportunities/citations/:domain` | GET | Domain drill-down |
| **Opportunities** | `/api/v1/opportunities/recommendations` | GET/POST | Recommendations |
| **Opportunities** | `/api/v1/opportunities/content` | GET | Generated content |
| **Reports** | `/api/v1/reports` | GET/POST | List/generate reports |
| **Reports** | `/api/v1/reports/:id` | GET | Report status |
| **Reports** | `/api/v1/reports/:id/download` | GET | Download PDF |
| **Jobs** | `/api/v1/jobs` | GET | List background jobs |
| **Jobs** | `/api/v1/jobs/:id` | GET | Job status |

---

# Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Visibility Score** | 0-100 metric measuring how prominently a brand appears in AI responses |
| **Sentiment Score** | 0-100 metric measuring positive vs negative brand perception |
| **Position Score** | 0-100 nDCG-based metric for ranking position in competitive lists |
| **nDCG** | Normalized Discounted Cumulative Gain - information retrieval metric |
| **ABSA** | Aspect-Based Sentiment Analysis - per-mention sentiment detection |
| **Prompt Run** | Batch execution of prompts across selected AI models |
| **Citation** | URL referenced by AI model in its response |
| **Mention** | Instance of brand/alias appearing in AI response |
| **Ranking** | Ordered list extracted from AI response (e.g., "Top 5 companies") |
| **Site X-Ray** | AI-powered website content analysis feature |
| **Health Probe** | robots.txt and ai.txt accessibility check |

---

**Document maintained by:** Polaris AI Platform Team  
**For questions:** Contact platform administrators  
**Version History:**
- v1.0 (February 2026): Initial comprehensive documentation
