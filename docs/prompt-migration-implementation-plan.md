# Prompt Migration Implementation Plan
## "Prompts in DB + Logic in Code" Strategy

**Approach:** Database stores editable TEXT with `{{placeholders}}`, Code handles LOGIC and variable substitution

---

## 📋 **PHASE 0: Discovery & Analysis** ✅ COMPLETE

**Status:** Done  
**What we learned:**
- ~25-30 prompts across 10+ modules
- 3 patterns: Static constants, Dynamic builders, Inline templates
- Scoring-critical: Mention extraction, Sentiment ABSA, Ranking extraction
- Dual LLM: OpenAI (gpt-4-turbo, gpt-4o-mini) + Anthropic (claude-sonnet-4-5)

---

## 🏗️ **PHASE 1: Database Schema & Core Service**

**Duration:** 2 days  
**Goal:** Build foundation for prompt management

### Tasks:

#### 1.1 Database Schema
```sql
-- Simplified schema for prompt components
CREATE TABLE prompt_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100),
  description TEXT,
  
  -- The editable prompt text (with {{placeholders}})
  body TEXT NOT NULL,
  
  -- Metadata
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  impacts_scoring BOOLEAN DEFAULT false,
  
  -- Model support
  supported_models JSONB DEFAULT '["gpt-4-turbo", "gpt-4o-mini", "claude-sonnet-4-5"]',
  preferred_model VARCHAR(100),
  
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Version history
CREATE TABLE prompt_component_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id UUID REFERENCES prompt_components(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  changed_by VARCHAR(255),
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track usage in code
CREATE TABLE prompt_component_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id UUID REFERENCES prompt_components(id),
  module_name VARCHAR(255) NOT NULL,
  function_name VARCHAR(255) NOT NULL,
  position VARCHAR(50), -- 'START', 'MIDDLE', 'END'
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 1.2 Drizzle Schema Update (`shared/schema.ts`)
- Add `promptComponents` table definition
- Add `promptComponentHistory` table definition  
- Add `promptComponentUsage` table definition
- Create insert/select schemas with `drizzle-zod`

#### 1.3 Database Push
```bash
npm run db:push
```

#### 1.4 Prompt Manager Service (`server/services/prompt-manager.ts`)
```typescript
export class PromptManager {
  private static cache: Map<string, string> = new Map();
  
  // Get single component
  static async getText(name: string): Promise<string>
  
  // Get multiple components (batch)
  static async getComponents(names: string[]): Promise<Record<string, string>>
  
  // Update component (creates version)
  static async updateText(name: string, newBody: string, options?: UpdateOptions): Promise<void>
  
  // Rollback to previous version
  static async rollback(name: string, toVersion: number): Promise<void>
  
  // Clear cache
  static invalidateCache(name?: string): void
}
```

**Deliverables:**
- ✅ Database tables created
- ✅ Drizzle schema updated
- ✅ PromptManager service implemented
- ✅ Unit tests for PromptManager

---

## 🔄 **PHASE 2: Migrate Low-Risk Prompts**

**Duration:** 2 days  
**Goal:** Start with non-scoring prompts to validate approach

### 2.1 Global System Prompts (Day 1)

**Target:** `server/llm/client.ts`

```typescript
// BEFORE
const JSON_SYSTEM_PROMPT = `You are a precise data extraction assistant...`;

// AFTER
// DB Component:
{
  name: 'llm_json_system_prompt',
  body: 'You are a precise data extraction assistant...',
  impacts_scoring: false
}

// Code Update:
const systemPrompt = options?.systemPrompt || 
  await PromptManager.getText('llm_json_system_prompt');
```

**Components to migrate:**
- `llm_json_system_prompt` - JSON system instructions
- `llm_repair_prompt_suffix` - Repair attempt message

**Testing:**
- ✅ Verify JSON responses still validate
- ✅ Check repair logic still works
- ✅ No performance degradation

### 2.2 Onboarding Enrichment (Day 2)

**Target:** `server/services/onboarding-enrichment.ts`

**Components to migrate:**
- `onboarding_url_enrichment` - URL suggestion prompt
- `onboarding_profile_enrichment` - Industry/geo/alias suggestion
- `onboarding_competitor_discovery` - Competitor discovery prompt

**Testing:**
- ✅ Compare suggested URLs (old vs new)
- ✅ Compare profile suggestions
- ✅ Verify competitor quality

**Deliverables:**
- ✅ 5 components migrated to DB
- ✅ Code updated to use PromptManager
- ✅ All tests passing
- ✅ No regressions

---

## 📊 **PHASE 3: Migrate Medium-Risk Prompts**

**Duration:** 3 days  
**Goal:** Migrate content analysis prompts

### 3.1 X-Ray Content Analyzer (Day 1)

**Target:** `server/services/xray-content-analyzer.ts`

**Components to migrate:**
- `xray_system_role` - Content strategy expert role
- `xray_analysis_instructions` - Analysis instructions
- `xray_output_format` - JSON output structure

**Code pattern:**
```typescript
// Fetch components
const components = await PromptManager.getComponents([
  'xray_system_role',
  'xray_analysis_instructions',
  'xray_output_format'
]);

// Build with logic (stays in code)
return `${components.xray_system_role}

${components.xray_analysis_instructions}

PAGE DATA:
${JSON.stringify(page)}

${components.xray_output_format}`;
```

### 3.2 Content Recommendations (Day 2)

**Target:** `server/services/content-recommendation-analyzer.ts`

**Components to migrate:**
- `content_readiness_analysis` - LLM readiness check
- `content_seo_recommendations` - SEO analysis
- `content_gap_identification` - Gap analysis

### 3.3 Competitor Discovery (Day 3)

**Target:** `server/services/competitor-discovery.ts`

**Components to migrate:**
- `competitor_discovery_system` - System prompt
- `competitor_discovery_main` - Main discovery prompt

**Deliverables:**
- ✅ 8 components migrated
- ✅ X-Ray analysis works correctly
- ✅ Recommendations quality maintained
- ✅ Competitor discovery accurate

---

## 🎯 **PHASE 4: Migrate High-Risk Metadata Generation**

**Duration:** 3 days  
**Goal:** Migrate metadata generation (impacts topic/prompt creation)

### 4.1 Topic Generation from Website (Day 1-2)

**Target:** `server/openai-service.ts → generateClientMetadata()`

**Component to migrate:**
```sql
INSERT INTO prompt_components (name, body, impacts_scoring) VALUES (
  'metadata_generation_main',
  'You are a brand visibility analyst. Analyze the company "{{companyName}}" {{companyContext}}.

{{websiteAndFocusContext}}

Based on the website content above{{focusAreasNote}}, generate comprehensive metadata for testing AI assistant responses:

1. Generate 30+ diverse topics/keywords covering:
   - Product Features...
   - Use Cases...
   [full instructions with {{placeholders}}]
   
Return your response as JSON in this exact format:
{
  "topics": [...],
  "topTopics": [...],
  "prompts": [...]
}',
  true
);
```

**Code update:**
```typescript
async function generateClientMetadata(...) {
  const template = await PromptManager.getText('metadata_generation_main');
  
  // Build conditional values (logic in code)
  const companyContext = (industry ? ` in the ${industry} industry` : '') + 
                         (geography ? ` operating in ${geography}` : '');
  const focusAreasNote = focusAreas?.length > 0 ? ' and the client-specified focus areas' : '';
  
  // Replace placeholders
  const prompt = template
    .replace(/{{companyName}}/g, companyName)
    .replace(/{{companyContext}}/g, companyContext)
    .replace(/{{websiteAndFocusContext}}/g, websiteContext + focusAreasContext)
    .replace(/{{focusAreasNote}}/g, focusAreasNote);
  
  // ... rest of logic
}
```

### 4.2 AI Topics from Metadata (Day 3)

**Component:** `metadata_ai_topics_generation`

**Testing:**
- ✅ Generate topics for 10 test clients
- ✅ Compare topic quality (old vs new)
- ✅ Verify prompt generation works
- ✅ Check coverage and diversity

**Deliverables:**
- ✅ 2 major components migrated
- ✅ Topic quality validated
- ✅ Prompt generation verified

---

## ⚠️ **PHASE 5: Migrate CRITICAL Scoring Prompts**

**Duration:** 5 days  
**Goal:** Migrate scoring-critical prompts with extensive testing

### 5.1 Baseline Score Creation (Day 1)

**Before ANY migration:**
```typescript
// Create baseline dataset
const BASELINE_CLIENTS = ['client-1', 'client-2', 'client-3'];
const BASELINE_RUNS = 10; // Recent prompt runs per client

const baseline = await createScoreBaseline({
  clients: BASELINE_CLIENTS,
  promptRuns: BASELINE_RUNS,
  metrics: ['visibility', 'sentiment', 'position']
});

// Save to file for comparison
fs.writeFileSync('baseline-scores.json', JSON.stringify(baseline, null, 2));
```

### 5.2 Mention Extraction (Day 2)

**Target:** `server/services/mentionExtractor.llm.ts`

**Components:**
```sql
-- Base instructions
INSERT INTO prompt_components VALUES (
  'mention_extraction_instructions',
  'You are a precise entity mention detector. Your task is to find ALL mentions of specified brands/entities in the given text.

For each mention found, you must:
1. Extract the EXACT span text as it appears in the document
2. Provide precise character offsets [start, end)...

Rules:
- Character offsets must be accurate...
- Only include mentions that clearly refer to one of the specified brands...

Return your response as a JSON object with a "mentions" array.',
  true -- impacts_scoring
);

-- Output format
INSERT INTO prompt_components VALUES (
  'mention_extraction_output_format',
  'Return a JSON object in this exact format:
{
  "mentions": [
    {
      "span": "exact text from document",
      "start": 0,
      "end": 10,
      "canonical_id": "brand-id",
      "surface_type": "direct" | "alias",
      "confidence": 0.95
    }
  ]
}',
  true
);
```

**Code update:**
```typescript
async function buildExtractionPrompt(doc: DocumentInput, brands: BrandRecord[]): Promise<string> {
  const components = await PromptManager.getComponents([
    'mention_extraction_instructions',
    'mention_extraction_output_format'
  ]);
  
  const brandsInfo = brands.map(b => ({id: b.id, name: b.name, aliases: b.aliases}));
  
  return `${components.mention_extraction_instructions}

TEXT TO ANALYZE:
"""
${doc.text}
"""

BRANDS TO DETECT:
${JSON.stringify(brandsInfo, null, 2)}

${components.mention_extraction_output_format}`;
}
```

**Validation:**
```typescript
// Run with new prompts
const newScores = await runScoreValidation(baseline.runs);

// Compare
const drift = calculateScoreDrift(baseline.scores, newScores);

if (drift.maxDelta > 0.01) { // >1% change
  console.error('⚠️ SCORE DRIFT DETECTED - ROLLBACK!');
  await rollbackAllComponents();
  throw new Error('Score validation failed');
}
```

### 5.3 Sentiment ABSA (Day 3)

**Target:** `server/services/sentimentAbsa.llm.ts`

**Components:**
- `sentiment_absa_instructions` - ABSA analysis rules
- `sentiment_absa_output_format` - JSON format

**Validation:** Same score drift testing

### 5.4 Ranking Extraction (Day 4)

**Target:** `server/services/rankingExtractor.llm.ts`

**Components:**
- `ranking_system_role` - System role
- `ranking_instructions` - Extraction instructions  
- `ranking_rules_and_format` - Rules + output format

**Validation:** Same score drift testing

### 5.5 Final Validation (Day 5)

**Full system test:**
- ✅ Run 100 historical prompt runs
- ✅ Compare all scores (visibility, sentiment, position)
- ✅ Max drift < 1%
- ✅ Performance within 10% of baseline
- ✅ Error rates same or lower

**Deliverables:**
- ✅ All scoring prompts migrated
- ✅ Score consistency validated (<1% drift)
- ✅ Performance acceptable
- ✅ Rollback tested and working

---

## 🖥️ **PHASE 6: Admin UI**

**Duration:** 4 days  
**Goal:** Build admin interface for prompt management

### 6.1 Backend API (Day 1)

**Routes:**
```typescript
// List all components
GET /api/v1/admin/prompts

// Get component details
GET /api/v1/admin/prompts/:name

// Get version history
GET /api/v1/admin/prompts/:name/history

// Update component
PUT /api/v1/admin/prompts/:name

// Rollback to version
POST /api/v1/admin/prompts/:name/rollback

// Preview with sample data
POST /api/v1/admin/prompts/:name/preview

// Get usage information
GET /api/v1/admin/prompts/:name/usage
```

### 6.2 Frontend Components (Day 2-3)

**Pages:**
- `/admin/prompts` - List all prompt components
- `/admin/prompts/:name` - Edit component + preview
- `/admin/prompts/:name/history` - Version history

**Features:**
- ✅ Syntax highlighting for prompt text
- ✅ {{Placeholder}} validation
- ✅ Live preview with sample data
- ✅ Show where component is used (files + functions)
- ✅ Warning for scoring-critical prompts
- ✅ Test with real data before saving
- ✅ One-click rollback
- ✅ Diff view for version comparison

### 6.3 Testing & Polish (Day 4)

- ✅ Test all CRUD operations
- ✅ Verify preview accuracy
- ✅ Test rollback functionality
- ✅ Add user permissions (if auth exists)
- ✅ Mobile responsive
- ✅ Loading states

**Deliverables:**
- ✅ Full admin UI working
- ✅ All features tested
- ✅ User documentation

---

## ✅ **PHASE 7: Final Testing & Cleanup**

**Duration:** 2 days  
**Goal:** Production readiness

### 7.1 Integration Testing (Day 1)

**Test scenarios:**
- ✅ Edit non-scoring prompt → verify changes take effect
- ✅ Edit scoring prompt → verify no score drift
- ✅ Rollback prompt → verify old behavior restored
- ✅ Database failure → verify graceful degradation
- ✅ Cache invalidation → verify fresh data loaded
- ✅ Multi-user edits → verify no conflicts

### 7.2 Performance & Security (Day 1)

- ✅ Load test with 100 concurrent requests
- ✅ Cache hit rate >90%
- ✅ Latency <50ms for prompt fetch
- ✅ SQL injection prevention
- ✅ XSS prevention in admin UI
- ✅ Access control (admin only)

### 7.3 Documentation & Cleanup (Day 2)

**Create docs:**
- ✅ Admin user guide
- ✅ Developer guide for adding new prompts
- ✅ Troubleshooting guide
- ✅ Update replit.md with migration info

**Code cleanup:**
- ✅ Remove commented legacy prompts (keep for 30 days, then delete)
- ✅ Remove debugging logs
- ✅ Update type definitions
- ✅ Final code review

**Deliverables:**
- ✅ Production ready
- ✅ All documentation complete
- ✅ Team trained

---

## 📅 **Timeline Summary**

| Phase | Duration | Dependencies | Risk Level |
|-------|----------|--------------|------------|
| Phase 0: Discovery | ✅ Done | None | - |
| Phase 1: Schema & Service | 2 days | Phase 0 | Low |
| Phase 2: Low-Risk Migration | 2 days | Phase 1 | Low |
| Phase 3: Medium-Risk Migration | 3 days | Phase 2 tested | Medium |
| Phase 4: Metadata Generation | 3 days | Phase 3 tested | High |
| Phase 5: Scoring Prompts | 5 days | Phase 4 tested | **CRITICAL** |
| Phase 6: Admin UI | 4 days | Phase 5 stable | Low |
| Phase 7: Final Testing | 2 days | All phases | Low |

**Total: ~21 days (4 weeks)**

---

## 🚨 **Rollback Plan**

At ANY point, if issues occur:

### Immediate Rollback (< 5 minutes)
```sql
-- Deactivate all new components
UPDATE prompt_components SET is_active = false;

-- Code automatically falls back to legacy (commented code)
```

### Version Rollback (< 10 minutes)
```typescript
// Rollback specific component
await PromptManager.rollback('mention_extraction_instructions', previousVersion);
```

### Full System Rollback (< 30 minutes)
```bash
# Git revert code changes
git revert <migration-commit>

# Restore database backup
pg_restore -d polaris_dev backup_pre_migration.sql

# Restart application
npm run dev
```

---

## ✅ **Success Criteria**

Before considering migration complete:

- [ ] All 25-30 prompts migrated to database
- [ ] Score drift < 1% for all metrics
- [ ] Performance overhead < 10%
- [ ] Cache hit rate > 90%
- [ ] Admin UI fully functional
- [ ] All tests passing (unit + integration)
- [ ] Documentation complete
- [ ] Team trained on admin UI
- [ ] Rollback tested successfully
- [ ] Production deployment plan ready

---

## 🎯 **Next Steps**

**Ready to proceed?**

1. Review and approve this plan
2. I'll start Phase 1: Database Schema & Core Service
3. After each phase, we'll test and get your approval before proceeding
4. Phase-by-phase implementation ensures safety and rollback capability

**Any questions or changes to this plan?**
