# AI Prompt Migration Plan
## Database-Driven Prompt Management System

**Status:** Planning Phase - Awaiting Approval
**Last Updated:** $(date)
**Goal:** Migrate all hardcoded AI prompts to database with zero downtime and full rollback capability

---

## 📋 PHASE 0: Discovery & Prompt Registry

### Discovered Prompts (Current Inventory)

#### 1. **LLM Client Layer** (`server/llm/`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `llm/client.ts:4-8` | JSON_SYSTEM_PROMPT | Global system prompt for JSON responses | None |
| `llm/client.ts:54-57` | REPAIR_PROMPT | JSON validation repair prompt | error details |

#### 2. **Mention Extraction** (`server/services/mentionExtractor.llm.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `mentionExtractor.llm.ts:7-24` | MENTION_EXTRACTION_PROMPT | Extract brand mentions from text | brands, text, doc |
| `mentionExtractor.llm.ts:35-70` | buildExtractionPrompt() | Dynamic mention extraction | brands[], document |

#### 3. **Ranking Extraction** (`server/services/rankingExtractor.llm.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `rankingExtractor.llm.ts:12-61` | buildRankingPrompt() | Extract rankings from responses | brand, document, text |

#### 4. **Sentiment Analysis** (`server/services/sentimentAbsa.llm.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `sentimentAbsa.llm.ts:7-24` | ABSA_SENTIMENT_PROMPT | Aspect-based sentiment analysis | mentions, context |
| `sentimentAbsa.llm.ts:61-100` | buildAbsaPrompt() | Dynamic ABSA prompt builder | mentions[], document |

#### 5. **Onboarding Enrichment** (`server/services/onboarding-enrichment.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `onboarding-enrichment.ts:40-57` | URL Enrichment Prompt | Suggest URLs and focus areas | clientName |
| `onboarding-enrichment.ts:76-100` | Profile Enrichment Prompt | Suggest industry/geo/aliases | name, urls, focusAreas |
| `onboarding-enrichment.ts:110-140` | Competitor Discovery Prompt | AI competitor suggestions | name, urls, industry |

#### 6. **Content Recommendation** (`server/services/content-recommendation-analyzer.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| Multiple inline prompts | LLM Readiness Analysis | Page content analysis | pageData |
| Multiple inline prompts | SEO Recommendations | SEO issue detection | structure |
| Multiple inline prompts | Content Gap Analysis | Gap identification | content |

#### 7. **X-Ray Content Analyzer** (`server/services/xray-content-analyzer.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `xray-content-analyzer.ts:56-70` | System Prompt | Content strategy analysis | None |
| `xray-content-analyzer.ts:buildAnalysisPrompt()` | Analysis Prompt | Page content analysis | page, structure, client |
| `xray-content-analyzer.ts:buildBatchPrompt()` | Batch Analysis Prompt | Multi-page batch analysis | pages[], client |

#### 8. **Metadata Generation** (`server/openai-service.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `openai-service.ts:90-155` | Metadata Generation Prompt | Generate topics/keywords/prompts | companyName, industry, geography, content |
| `openai-service.ts:166-168` | System Prompt | Brand visibility expert | None |

#### 9. **Competitor Discovery** (`server/services/competitor-discovery.ts`)
| Location | Prompt Type | Current Usage | Variables |
|----------|-------------|---------------|-----------|
| `competitor-discovery.ts:42-71` | Competitor Discovery Prompt | Find relevant competitors | client data, existing competitors |
| `competitor-discovery.ts:80-84` | System Prompt | Competitive intelligence expert | None |

### Total Prompt Count: **~25-30 unique prompts**

---

## 🏗️ PHASE 1: Database Schema Design

### Proposed Schema

```sql
-- Main prompt registry table
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL, -- 'extraction', 'analysis', 'generation', 'enrichment', 'system'
  description TEXT,
  current_version_id UUID REFERENCES prompt_versions(id),
  is_active BOOLEAN DEFAULT true,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Version control for prompts
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  body TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb, -- Array of variable names expected
  model VARCHAR(100), -- 'gpt-4o-mini', 'gpt-4-turbo', 'claude-sonnet-4-5'
  temperature DECIMAL(3,2),
  max_tokens INTEGER,
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(prompt_id, version_number)
);

-- Binding table: which code function uses which prompt
CREATE TABLE prompt_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
  module_name VARCHAR(255) NOT NULL, -- 'mentionExtractor', 'rankingExtractor', etc.
  function_name VARCHAR(255) NOT NULL, -- 'extractMentionsLLM', 'buildRankingPrompt', etc.
  environment VARCHAR(50) DEFAULT 'all', -- 'all', 'development', 'production'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(module_name, function_name)
);

-- Audit log for prompt changes
CREATE TABLE prompt_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'rolled_back', 'deactivated'
  old_version_id UUID REFERENCES prompt_versions(id),
  new_version_id UUID REFERENCES prompt_versions(id),
  changed_by VARCHAR(255),
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_prompts_category ON prompts(category);
CREATE INDEX idx_prompts_active ON prompts(is_active);
CREATE INDEX idx_bindings_module_function ON prompt_bindings(module_name, function_name);
CREATE INDEX idx_versions_prompt ON prompt_versions(prompt_id);
CREATE INDEX idx_audit_prompt ON prompt_audit_log(prompt_id);
```

### Drizzle Schema Addition (schema.ts)

```typescript
export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  category: varchar('category', { length: 100 }).notNull(),
  description: text('description'),
  currentVersionId: uuid('current_version_id').references(() => promptVersions.id),
  isActive: boolean('is_active').default(true),
  createdBy: varchar('created_by', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const promptVersions = pgTable('prompt_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptId: uuid('prompt_id').references(() => prompts.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  body: text('body').notNull(),
  variables: jsonb('variables').$type<string[]>().default([]),
  model: varchar('model', { length: 100 }),
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  maxTokens: integer('max_tokens'),
  notes: text('notes'),
  createdBy: varchar('created_by', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow()
}, (table) => ({
  uniqueVersionPerPrompt: uniqueIndex().on(table.promptId, table.versionNumber)
}));

export const promptBindings = pgTable('prompt_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptId: uuid('prompt_id').references(() => prompts.id, { onDelete: 'cascade' }),
  moduleName: varchar('module_name', { length: 255 }).notNull(),
  functionName: varchar('function_name', { length: 255 }).notNull(),
  environment: varchar('environment', { length: 50 }).default('all'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow()
}, (table) => ({
  uniqueBinding: uniqueIndex().on(table.moduleName, table.functionName)
}));

export const promptAuditLog = pgTable('prompt_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptId: uuid('prompt_id').references(() => prompts.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 50 }).notNull(),
  oldVersionId: uuid('old_version_id').references(() => promptVersions.id),
  newVersionId: uuid('new_version_id').references(() => promptVersions.id),
  changedBy: varchar('changed_by', { length: 255 }),
  changeReason: text('change_reason'),
  createdAt: timestamp('created_at').defaultNow()
});
```

---

## 🔧 PHASE 2: Prompt Service Layer

### New Service: `server/services/prompt-manager.ts`

```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { prompts, promptVersions, promptBindings, promptAuditLog } from '@shared/schema';

export class PromptManager {
  // In-memory cache for performance
  private static cache: Map<string, CachedPrompt> = new Map();
  private static cacheExpiry = 5 * 60 * 1000; // 5 minutes

  /**
   * Get prompt by module and function binding
   */
  static async getPrompt(
    moduleName: string,
    functionName: string,
    useCache = true
  ): Promise<PromptData | null> {
    const cacheKey = `${moduleName}:${functionName}`;

    // Check cache first
    if (useCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        console.log(`[PromptManager] Cache hit: ${cacheKey}`);
        return cached.data;
      }
    }

    // Fetch from database
    const binding = await db.query.promptBindings.findFirst({
      where: and(
        eq(promptBindings.moduleName, moduleName),
        eq(promptBindings.functionName, functionName),
        eq(promptBindings.isActive, true)
      ),
      with: {
        prompt: {
          with: {
            currentVersion: true
          }
        }
      }
    });

    if (!binding || !binding.prompt) {
      console.warn(`[PromptManager] No binding found for ${cacheKey}`);
      return null;
    }

    const promptData: PromptData = {
      id: binding.prompt.id,
      name: binding.prompt.name,
      body: binding.prompt.currentVersion?.body || '',
      variables: binding.prompt.currentVersion?.variables || [],
      model: binding.prompt.currentVersion?.model,
      temperature: binding.prompt.currentVersion?.temperature ? 
        parseFloat(binding.prompt.currentVersion.temperature) : undefined,
      maxTokens: binding.prompt.currentVersion?.maxTokens || undefined
    };

    // Update cache
    this.cache.set(cacheKey, {
      data: promptData,
      timestamp: Date.now()
    });

    return promptData;
  }

  /**
   * Render prompt with variables
   */
  static renderPrompt(
    promptBody: string,
    context: Record<string, any>
  ): string {
    let rendered = promptBody;

    // Replace {{variable}} with actual values
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, String(value));
    }

    return rendered;
  }

  /**
   * Invalidate cache for specific prompt or all
   */
  static invalidateCache(cacheKey?: string) {
    if (cacheKey) {
      this.cache.delete(cacheKey);
      console.log(`[PromptManager] Cache invalidated: ${cacheKey}`);
    } else {
      this.cache.clear();
      console.log('[PromptManager] All cache cleared');
    }
  }

  /**
   * Create new prompt version
   */
  static async createVersion(
    promptId: string,
    body: string,
    variables: string[],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      notes?: string;
      createdBy?: string;
    } = {}
  ): Promise<PromptVersion> {
    // Get latest version number
    const versions = await db.query.promptVersions.findMany({
      where: eq(promptVersions.promptId, promptId),
      orderBy: (versions, { desc }) => [desc(versions.versionNumber)]
    });

    const nextVersion = (versions[0]?.versionNumber || 0) + 1;

    const [newVersion] = await db.insert(promptVersions).values({
      promptId,
      versionNumber: nextVersion,
      body,
      variables,
      model: options.model,
      temperature: options.temperature?.toString(),
      maxTokens: options.maxTokens,
      notes: options.notes,
      createdBy: options.createdBy
    }).returning();

    // Update current version reference
    await db.update(prompts)
      .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
      .where(eq(prompts.id, promptId));

    // Log audit trail
    await db.insert(promptAuditLog).values({
      promptId,
      action: 'updated',
      oldVersionId: versions[0]?.id,
      newVersionId: newVersion.id,
      changedBy: options.createdBy,
      changeReason: options.notes
    });

    // Clear cache
    this.invalidateCache();

    return newVersion;
  }

  /**
   * Rollback to previous version
   */
  static async rollbackVersion(
    promptId: string,
    targetVersionId: string,
    reason: string,
    changedBy?: string
  ): Promise<void> {
    const currentPrompt = await db.query.prompts.findFirst({
      where: eq(prompts.id, promptId)
    });

    if (!currentPrompt) {
      throw new Error('Prompt not found');
    }

    await db.update(prompts)
      .set({ currentVersionId: targetVersionId, updatedAt: new Date() })
      .where(eq(prompts.id, promptId));

    // Log rollback
    await db.insert(promptAuditLog).values({
      promptId,
      action: 'rolled_back',
      oldVersionId: currentPrompt.currentVersionId!,
      newVersionId: targetVersionId,
      changedBy,
      changeReason: reason
    });

    // Clear cache
    this.invalidateCache();
  }
}

interface PromptData {
  id: string;
  name: string;
  body: string;
  variables: string[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface CachedPrompt {
  data: PromptData;
  timestamp: number;
}
```

---

## 🚀 PHASE 3: Phased Migration Strategy

### Migration Approach: One Module at a Time

**Order of Migration (Low Risk → High Risk):**

1. ✅ **Phase 3.1: JSON System Prompts** (Lowest Risk)
   - `llm/client.ts` - JSON_SYSTEM_PROMPT
   - Simple, global prompts with no variables
   - Easy rollback, minimal dependencies

2. ✅ **Phase 3.2: Onboarding Enrichment** (Low Risk)
   - URL enrichment
   - Profile enrichment  
   - Competitor discovery
   - Used in non-critical onboarding flow

3. ✅ **Phase 3.3: Content Analysis** (Medium Risk)
   - X-Ray content analyzer
   - Content recommendation analyzer
   - Used in Site X-Ray feature

4. ✅ **Phase 3.4: Core Extraction Services** (High Risk)
   - Mention extraction
   - Ranking extraction
   - Sentiment ABSA
   - **Critical for scoring - requires thorough testing**

5. ✅ **Phase 3.5: Metadata Generation** (High Risk)
   - OpenAI metadata service
   - Competitor discovery
   - **Core feature - requires careful migration**

### Per-Module Migration Checklist

For each module:

- [ ] **Backup**: Comment out existing prompt code (do not delete)
- [ ] **Database**: Seed prompt into database with version 1.0
- [ ] **Binding**: Create binding entry (module → function)
- [ ] **Code Update**: Replace hardcoded prompt with `PromptManager.getPrompt()`
- [ ] **Fallback**: Add environment toggle `USE_DYNAMIC_PROMPTS`
- [ ] **Testing**: Unit test with same inputs/outputs as before
- [ ] **Validation**: Compare LLM responses (old vs new)
- [ ] **Monitoring**: Log performance metrics
- [ ] **Rollback Plan**: Document rollback steps

---

## 🔄 PHASE 4: Environment Toggle & Fallback

### Environment Configuration

```typescript
// server/config/prompts.ts
export const PROMPT_CONFIG = {
  useDynamicPrompts: process.env.USE_DYNAMIC_PROMPTS === 'true',
  enableFallback: process.env.ENABLE_PROMPT_FALLBACK !== 'false',
  cacheEnabled: process.env.PROMPT_CACHE_ENABLED !== 'false',
  cacheTTL: parseInt(process.env.PROMPT_CACHE_TTL || '300000') // 5 min
};
```

### Migration Pattern (Example)

```typescript
// BEFORE (mentionExtractor.llm.ts)
const MENTION_EXTRACTION_PROMPT = `You are a precise entity mention detector...`;

export async function extractMentionsLLM(
  doc: DocumentInput,
  brands: BrandRecord[]
): Promise<EntityMention[]> {
  const prompt = buildExtractionPrompt(doc, brands);
  // ... use hardcoded MENTION_EXTRACTION_PROMPT
}

// AFTER (with migration)
import { PromptManager } from './prompt-manager';
import { PROMPT_CONFIG } from '../config/prompts';

// LEGACY - Keep for fallback (commented after successful migration)
const MENTION_EXTRACTION_PROMPT_LEGACY = `You are a precise entity mention detector...`;

export async function extractMentionsLLM(
  doc: DocumentInput,
  brands: BrandRecord[]
): Promise<EntityMention[]> {
  let systemPrompt: string;

  if (PROMPT_CONFIG.useDynamicPrompts) {
    // Try database first
    const dbPrompt = await PromptManager.getPrompt(
      'mentionExtractor',
      'extractMentionsLLM'
    );

    if (dbPrompt) {
      systemPrompt = dbPrompt.body;
      console.log('[Mention] Using dynamic prompt from database');
    } else if (PROMPT_CONFIG.enableFallback) {
      systemPrompt = MENTION_EXTRACTION_PROMPT_LEGACY;
      console.warn('[Mention] Fallback to legacy prompt');
    } else {
      throw new Error('No prompt found and fallback disabled');
    }
  } else {
    // Use legacy
    systemPrompt = MENTION_EXTRACTION_PROMPT_LEGACY;
    console.log('[Mention] Using legacy hardcoded prompt');
  }

  const prompt = buildExtractionPrompt(doc, brands, systemPrompt);
  // ... rest of logic
}
```

---

## 📊 PHASE 5: Admin UI for Prompt Management

### Routes & Components

**Backend Routes:**
```
GET    /api/v1/admin/prompts              - List all prompts
GET    /api/v1/admin/prompts/:id          - Get prompt details
GET    /api/v1/admin/prompts/:id/versions - Get version history
POST   /api/v1/admin/prompts              - Create new prompt
PUT    /api/v1/admin/prompts/:id          - Update prompt (new version)
POST   /api/v1/admin/prompts/:id/rollback - Rollback to version
DELETE /api/v1/admin/prompts/:id          - Deactivate prompt
GET    /api/v1/admin/prompts/:id/audit    - Get audit log
```

**Frontend Pages:**
- `/admin/prompts` - Prompt management dashboard
- `/admin/prompts/:id` - Prompt editor with version history
- `/admin/prompts/:id/test` - Prompt testing sandbox

---

## ✅ PHASE 6: Testing & Validation

### Test Strategy

1. **Unit Tests**: Each migrated function
2. **Integration Tests**: End-to-end prompt flows
3. **Regression Tests**: Compare old vs new outputs
4. **Performance Tests**: Latency benchmarks
5. **A/B Testing**: Run both systems in parallel

### Validation Criteria

✅ Output consistency: >99% match with legacy prompts
✅ Performance: <50ms overhead for prompt fetching
✅ Cache hit rate: >90% after warm-up
✅ Zero errors in fallback mechanism
✅ Audit trail completeness: 100% of changes logged

---

## 🗂️ PHASE 7: Cleanup & Deprecation

**Only after 2 weeks of stable production:**

1. Remove `USE_DYNAMIC_PROMPTS` toggle
2. Delete all `_LEGACY` prompt constants
3. Remove fallback logic
4. Set `useDynamicPrompts = true` permanently
5. Archive migration scripts and logs

---

## 📈 Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Prompts Migrated | 100% | 0% |
| Test Coverage | >90% | - |
| Performance Overhead | <50ms | - |
| Cache Hit Rate | >90% | - |
| Zero Downtime | ✅ | - |
| Rollback Success | 100% | - |

---

## 🚨 Risk Mitigation

### Identified Risks

1. **Prompt fetch latency** → Mitigated by: In-memory caching
2. **Database outage** → Mitigated by: Fallback to legacy prompts
3. **Wrong prompt version** → Mitigated by: Audit log + easy rollback
4. **Breaking changes** → Mitigated by: Phased migration + testing
5. **Variable mismatch** → Mitigated by: Schema validation

---

## 📅 Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 0: Discovery | ✅ Complete | None |
| Phase 1: DB Schema | 1 day | Phase 0 approval |
| Phase 2: Service Layer | 2 days | Phase 1 |
| Phase 3.1: JSON Prompts | 1 day | Phase 2 |
| Phase 3.2: Enrichment | 2 days | Phase 3.1 tested |
| Phase 3.3: Content Analysis | 2 days | Phase 3.2 tested |
| Phase 3.4: Extraction | 3 days | Phase 3.3 tested |
| Phase 3.5: Metadata Gen | 2 days | Phase 3.4 tested |
| Phase 5: Admin UI | 3 days | Phase 3.x stable |
| Phase 6: Full Testing | 2 days | All phases |
| Phase 7: Cleanup | 1 day | 2 weeks stable |

**Total Estimated Time: 3-4 weeks (with testing between phases)**

---

## ✋ NEXT STEPS (AWAITING APPROVAL)

**Please review and approve:**

1. ✅ Database schema design
2. ✅ Migration strategy (phased approach)
3. ✅ Fallback & rollback mechanisms
4. ✅ Timeline and resources

**Once approved, we will proceed phase by phase with:**
- Implementation
- Testing after each phase
- Your approval before moving to next phase

---

**Questions or modifications to this plan?** Please provide feedback before we begin implementation.
