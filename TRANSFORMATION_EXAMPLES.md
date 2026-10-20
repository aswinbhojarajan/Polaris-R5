# Data Transformation Examples

## Sample Code Snippets for CSV → Database

### 1. CSV Parsing Setup

```typescript
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

function readCSV(filePath: string) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    cast: false, // We'll handle type casting ourselves
  });
  return records;
}
```

### 2. Timestamp Transformation

```typescript
// Input: """2025-10-17T12:01:02.695Z"""
// Output: Date object

function parseTimestamp(csvTimestamp: string | null | undefined): Date | null {
  if (!csvTimestamp || csvTimestamp === '') return null;
  
  // Remove triple quotes if present
  const cleaned = csvTimestamp.replace(/^"""/, '').replace(/"""$/, '');
  
  return new Date(cleaned);
}

// Example usage:
const createdAt = parseTimestamp(row.created_at);
```

### 3. JSON Field Transformation

```typescript
// Input: "[{""url"":""https://example.com"",""category"":""primary""}]"
// Output: [{"url":"https://example.com","category":"primary"}]

function parseJSONField(csvJson: string | null | undefined): any | null {
  if (!csvJson || csvJson === '' || csvJson === '[]' || csvJson === '{}') {
    return null;
  }
  
  try {
    // CSV escapes quotes as double quotes
    // Parse will automatically handle this
    return JSON.parse(csvJson);
  } catch (error) {
    console.error('Failed to parse JSON:', csvJson);
    throw error;
  }
}

// Example usage:
const urls = parseJSONField(row.urls);
const focusAreas = parseJSONField(row.focus_areas);
```

### 4. Boolean Transformation

```typescript
function parseBoolean(csvBool: string | null | undefined, defaultValue = false): boolean {
  if (csvBool === null || csvBool === undefined || csvBool === '') {
    return defaultValue;
  }
  return csvBool === 'true' || csvBool === 't' || csvBool === '1';
}

// Example usage:
const isActive = parseBoolean(row.is_active, true);
```

### 5. Numeric Transformation

```typescript
function parseNumeric(csvNumber: string | null | undefined): number | null {
  if (!csvNumber || csvNumber === '') return null;
  const num = parseFloat(csvNumber);
  return isNaN(num) ? null : num;
}

// Example usage:
const visibilityScore = parseNumeric(row.visibility_score);
const positionScore = parseNumeric(row.position_score);
```

### 6. Integer Transformation

```typescript
function parseInteger(csvInt: string | null | undefined): number | null {
  if (!csvInt || csvInt === '') return null;
  const num = parseInt(csvInt, 10);
  return isNaN(num) ? null : num;
}

// Example usage:
const citationCount = parseInteger(row.citation_count);
const wordCount = parseInteger(row.word_count);
```

## Complete Transformer Examples

### Organizations Transformer

```typescript
import { organizations } from '../shared/schema';

interface OrganizationCSVRow {
  id: string;
  name: string;
  created_at: string;
}

function transformOrganization(row: OrganizationCSVRow) {
  return {
    id: row.id, // Keep as-is (can be "default-org" or UUID)
    name: row.name,
    createdAt: parseTimestamp(row.created_at),
  };
}

// Usage:
const orgRecords = readCSV('attached_assets/organizations_1762806929907.csv');
const transformedOrgs = orgRecords.map(transformOrganization);
await db.insert(organizations).values(transformedOrgs);
```

### Clients Transformer

```typescript
import { clients } from '../shared/schema';

interface ClientCSVRow {
  id: string;
  org_id: string;
  name: string;
  website?: string;
  urls?: string;
  focus_areas?: string;
  industry?: string;
  geography?: string;
  aliases?: string;
  brand_aliases?: string;
  selected_ai_model_ids?: string;
  onboarding_status?: string;
  created_at: string;
  is_active: string;
}

function transformClient(row: ClientCSVRow) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    website: row.website || null,
    urls: parseJSONField(row.urls),
    focusAreas: parseJSONField(row.focus_areas),
    industry: row.industry || null,
    geography: row.geography || null,
    aliases: parseJSONField(row.aliases),
    brandAliases: parseJSONField(row.brand_aliases),
    selectedAiModelIds: parseJSONField(row.selected_ai_model_ids),
    onboardingStatus: row.onboarding_status as 'draft' | 'inprogress' | 'completed' || 'draft',
    isActive: parseBoolean(row.is_active, true),
    createdAt: parseTimestamp(row.created_at),
  };
}
```

### Answers Transformer (High Volume)

```typescript
import { answers } from '../shared/schema';

interface AnswerCSVRow {
  id: string;
  prompt_run_item_id: string;
  raw_response: string;
  visibility_score?: string;
  first_mention_pos?: string;
  sentiment_score?: string;
  position_score?: string;
  citation_count?: string;
}

function transformAnswer(row: AnswerCSVRow) {
  return {
    id: row.id,
    promptRunItemId: row.prompt_run_item_id,
    rawResponse: row.raw_response,
    visibilityScore: parseNumeric(row.visibility_score),
    firstMentionPos: parseInteger(row.first_mention_pos),
    sentimentScore: parseNumeric(row.sentiment_score),
    positionScore: parseNumeric(row.position_score),
    citationCount: parseInteger(row.citation_count) || 0,
  };
}

// Batch processing for large table:
async function seedAnswers() {
  const records = readCSV('attached_assets/answers_1762806929910.csv');
  const batchSize = 500;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const transformed = batch.map(transformAnswer);
    
    await db.insert(answers).values(transformed);
    
    const progress = Math.min(i + batchSize, records.length);
    console.log(`Seeded ${progress}/${records.length} answers`);
  }
}
```

### XRay Page Structure Transformer (Complex JSON)

```typescript
import { xrayPageStructure } from '../shared/schema';

interface XRayPageStructureCSVRow {
  id: string;
  page_id: string;
  headings?: string;
  paragraphs?: string;
  lists?: string;
  tables?: string;
  entities?: string;
  focus_areas?: string;
  topics?: string;
  sentiment_score?: string;
  link_counts?: string;
  created_at: string;
}

function transformXRayPageStructure(row: XRayPageStructureCSVRow) {
  return {
    id: row.id,
    pageId: row.page_id,
    headings: parseJSONField(row.headings),
    paragraphs: parseJSONField(row.paragraphs),
    lists: parseJSONField(row.lists),
    tables: parseJSONField(row.tables),
    entities: parseJSONField(row.entities),
    focusAreas: parseJSONField(row.focus_areas),
    topics: parseJSONField(row.topics),
    sentimentScore: parseNumeric(row.sentiment_score),
    linkCounts: parseJSONField(row.link_counts),
    createdAt: parseTimestamp(row.created_at),
  };
}
```

### Recommendations Transformer (Complex JSON Arrays)

```typescript
import { recommendations } from '../shared/schema';

interface RecommendationCSVRow {
  id: string;
  client_id: string;
  prompt_run_id?: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  examples?: string;
  action_items?: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function transformRecommendation(row: RecommendationCSVRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    promptRunId: row.prompt_run_id || null,
    title: row.title,
    description: row.description,
    severity: row.severity,
    category: row.category,
    examples: parseJSONField(row.examples),
    actionItems: parseJSONField(row.action_items),
    source: row.source as 'crawl' | 'prompt_response' | 'citation' | 'ai_analysis' | 'manual',
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
}
```

## Manual Seed Data

### AI Models (Required Before Seeding)

```typescript
import { aiModels } from '../shared/schema';

async function seedAIModels() {
  const models = [
    {
      id: '4aa7b655-6aca-4985-8880-c4ad7f774690',
      vendor: 'OpenAI',
      model: 'gpt-4o',
      displayName: 'GPT-4o',
      maxTpm: 800000,
      maxRpm: 10000,
      costPer1kInput: '5.00',
      costPer1kOutput: '15.00',
      enabled: true,
    },
    {
      id: '4ea5cfb9-3192-4410-910e-f26897753f97',
      vendor: 'OpenAI',
      model: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      maxTpm: 2000000,
      maxRpm: 30000,
      costPer1kInput: '0.15',
      costPer1kOutput: '0.60',
      enabled: true,
    },
    {
      id: '9b98072b-483b-43d3-895c-da4471dba944',
      vendor: 'Anthropic',
      model: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      maxTpm: 400000,
      maxRpm: 4000,
      costPer1kInput: '3.00',
      costPer1kOutput: '15.00',
      enabled: true,
    },
  ];

  await db.insert(aiModels).values(models);
  console.log('Seeded 3 AI models');
}
```

### Score Interpretations

```typescript
import { scoreInterpretations } from '../shared/schema';

async function seedScoreInterpretations() {
  const interpretations = [
    // Position scores
    { category: 'Position', scoreMin: '0', scoreMax: '20', messageTemplate: 'Brand not mentioned or very low relevance' },
    { category: 'Position', scoreMin: '20', scoreMax: '40', messageTemplate: 'Brand mentioned but not prominently positioned' },
    { category: 'Position', scoreMin: '40', scoreMax: '60', messageTemplate: 'Brand has moderate positioning in response' },
    { category: 'Position', scoreMin: '60', scoreMax: '80', messageTemplate: 'Brand well-positioned in response' },
    { category: 'Position', scoreMin: '80', scoreMax: '100', messageTemplate: 'Brand is primary focus of response' },
    
    // Sentiment scores
    { category: 'Sentiment', scoreMin: '0', scoreMax: '30', messageTemplate: 'Predominantly negative mentions' },
    { category: 'Sentiment', scoreMin: '30', scoreMax: '45', messageTemplate: 'Mixed with negative bias' },
    { category: 'Sentiment', scoreMin: '45', scoreMax: '55', messageTemplate: 'Neutral or balanced mentions' },
    { category: 'Sentiment', scoreMin: '55', scoreMax: '70', messageTemplate: 'Mixed with positive bias' },
    { category: 'Sentiment', scoreMin: '70', scoreMax: '100', messageTemplate: 'Predominantly positive mentions' },
    
    // Visibility scores
    { category: 'Visibility', scoreMin: '0', scoreMax: '25', messageTemplate: 'Very low visibility in response' },
    { category: 'Visibility', scoreMin: '25', scoreMax: '50', messageTemplate: 'Low visibility in response' },
    { category: 'Visibility', scoreMin: '50', scoreMax: '75', messageTemplate: 'Good visibility in response' },
    { category: 'Visibility', scoreMin: '75', scoreMax: '100', messageTemplate: 'Excellent visibility in response' },
  ];

  await db.insert(scoreInterpretations).values(interpretations);
  console.log('Seeded score interpretations');
}
```

### Score Color Bands

```typescript
import { scoreColorBands } from '../shared/schema';

async function seedScoreColorBands() {
  const bands = [
    // Position bands
    { category: 'Position', bandName: 'Poor', colorHex: '#ef4444', scoreMin: '0', scoreMax: '33' },
    { category: 'Position', bandName: 'Fair', colorHex: '#f59e0b', scoreMin: '33', scoreMax: '66' },
    { category: 'Position', bandName: 'Good', colorHex: '#10b981', scoreMin: '66', scoreMax: '100' },
    
    // Sentiment bands
    { category: 'Sentiment', bandName: 'Negative', colorHex: '#ef4444', scoreMin: '0', scoreMax: '40' },
    { category: 'Sentiment', bandName: 'Neutral', colorHex: '#f59e0b', scoreMin: '40', scoreMax: '60' },
    { category: 'Sentiment', bandName: 'Positive', colorHex: '#10b981', scoreMin: '60', scoreMax: '100' },
    
    // Visibility bands
    { category: 'Visibility', bandName: 'Low', colorHex: '#ef4444', scoreMin: '0', scoreMax: '40' },
    { category: 'Visibility', bandName: 'Medium', colorHex: '#f59e0b', scoreMin: '40', scoreMax: '70' },
    { category: 'Visibility', bandName: 'High', colorHex: '#10b981', scoreMin: '70', scoreMax: '100' },
  ];

  await db.insert(scoreColorBands).values(bands);
  console.log('Seeded score color bands');
}
```

## Main Seeding Script Structure

```typescript
// scripts/seed-production-data.ts

import { db } from '../server/db';
import * as schema from '../shared/schema';

async function main() {
  console.log('🌱 Starting production data seed...\n');

  try {
    // Phase 1: Manual seeds (prerequisite data)
    console.log('📋 Phase 1: Seeding manual data...');
    await seedAIModels();
    await seedScoreInterpretations();
    await seedScoreColorBands();
    console.log('✓ Phase 1 complete\n');

    // Phase 2: Organizations (root level)
    console.log('📋 Phase 2: Seeding organizations...');
    await seedTable('organizations', transformOrganization);
    console.log('✓ Phase 2 complete\n');

    // Phase 3: Clients
    console.log('📋 Phase 3: Seeding clients...');
    await seedTable('clients', transformClient);
    console.log('✓ Phase 3 complete\n');

    // Phase 4: Level 3 tables (can be parallel)
    console.log('📋 Phase 4: Seeding level 3 tables...');
    await Promise.all([
      seedTable('competitors', transformCompetitor),
      seedTable('topics', transformTopic),
      seedTable('prompts', transformPrompt),
      seedTable('prompt_runs', transformPromptRun),
      seedTable('xray_sites', transformXraySite),
      seedTable('recommendations', transformRecommendation),
      seedTable('generated_contents', transformGeneratedContent),
    ]);
    console.log('✓ Phase 4 complete\n');

    // Continue through all levels...

    console.log('✅ Seeding complete! All production data imported.');
    
    // Final validation
    await validateData();
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

main();
```

## Validation Functions

```typescript
async function validateData() {
  console.log('\n🔍 Validating seeded data...\n');

  // Row count validation
  const counts = await db.execute(sql`
    SELECT 'organizations' as table_name, COUNT(*) as count FROM organizations
    UNION ALL SELECT 'clients', COUNT(*) FROM clients
    UNION ALL SELECT 'answers', COUNT(*) FROM answers
  `);
  
  console.log('Row counts:', counts);

  // Foreign key validation
  const orphanedClients = await db.execute(sql`
    SELECT COUNT(*) FROM clients WHERE org_id NOT IN (SELECT id FROM organizations)
  `);
  
  if (orphanedClients[0].count > 0) {
    throw new Error(`Found ${orphanedClients[0].count} orphaned clients!`);
  }

  console.log('✓ All validations passed\n');
}
```

---

These examples provide the exact code patterns needed for the seeding implementation.
