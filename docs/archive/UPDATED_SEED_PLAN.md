# Updated Database Seeding Plan - ALL Production Data Available!

## 🎉 Major Update: All CSV Files Now Available

### New Status
- **23 CSV files total** (20 original + 3 new)
- **ALL tables covered** except `uploads` (optional)
- **NO manual seeding required** - everything from production CSVs!

### New Files Added
| CSV File | Row Count | Impact |
|----------|-----------|--------|
| ai_models_1762807418283.csv | 4 | ✅ Critical - Required before prompt_run_items |
| score_interpretations_1762807418282.csv | 17 | ✅ Configuration for score display |
| score_color_bands_1762807418282.csv | 9 | ✅ UI color mapping for scores |

**Total Records: ~25,030 rows**

## Updated Dependency Tree (Insert Order)

```
Level 0 (Prerequisites - No dependencies):
├── ai_models (4 rows) ← NEW! From CSV
├── score_interpretations (17 rows) ← NEW! From CSV
└── score_color_bands (9 rows) ← NEW! From CSV

Level 1:
└── organizations (2 rows)

Level 2:
└── clients (18 rows) → references organizations

Level 3 (Can be parallel):
├── competitors (81 rows) → references clients
├── topics (566 rows) → references clients
├── prompts (663 rows) → references clients
├── prompt_runs (25 rows) → references clients
├── xray_sites (12 rows) → references clients
├── recommendations (1,865 rows) → references clients
└── generated_contents (586 rows) → references clients

Level 4:
├── prompt_run_items (250 rows) → references prompt_runs, prompts, ai_models ✓
└── xray_pages (191 rows) → references xray_sites

Level 5:
├── answers (15,366 rows) → references prompt_run_items
├── xray_page_structure (163 rows) → references xray_pages
└── xray_page_analysis (163 rows) → references xray_pages

Level 6 (Can be parallel):
├── citations (858 rows) → references answers
├── mentions (242 rows) → references answers
├── rankings (2,735 rows) → references answers
└── score_factors (720 rows) → references prompt_run_items

Level 7:
└── competitor_scores (696 rows) → references prompt_runs, prompts, competitors

Standalone:
└── jobs (92 rows) → no foreign keys, can insert anytime
```

## Key Changes from Original Plan

### ✅ Simplified Approach
1. **No manual data creation** - All data comes from production CSVs
2. **Exact production data** - AI models have real IDs, names, costs, limits
3. **Production configuration** - Score interpretations/color bands match production

### 🔍 Critical Findings from New CSVs

#### AI Models (4 models, not 3!)
```csv
ID: 4aa7b655-6aca-4985-8880-c4ad7f774690
  Vendor: OpenAI
  Model: gpt-4.1
  Display: GPT-4.1
  Limits: 40K TPM, 5K RPM
  Cost: $0.60/$1.20 per 1K tokens

ID: 4ea5cfb9-3192-4410-910e-f26897753f97
  Vendor: OpenAI
  Model: gpt-4o-mini
  Display: GPT-4o Mini
  Limits: 200K TPM, 10K RPM
  Cost: $0.15/$0.60 per 1K tokens

ID: 9b98072b-483b-43d3-895c-da4471dba944
  Vendor: Anthropic
  Model: claude-sonnet-4-5
  Display: Claude Sonnet 4.5
  Limits: 40K TPM, 5K RPM
  Cost: $0.75/$1.50 per 1K tokens

ID: b236df85-a766-4fd4-bf98-6bf3e4ecb913 ← NEW! Not in original data
  Vendor: Google
  Model: gemini-pro
  Display: Gemini Pro
  Limits: 32K TPM, 2K RPM
  Cost: $0.50/$1.00 per 1K tokens
```

**Note**: Found a 4th model (Gemini Pro) not referenced in the original 20 CSVs!

#### Score Interpretations (17 rows)
- Complex message templates with placeholders: `AA`, `BB`, `CC`, `X.X`
- Score ranges for each category (Position, Sentiment, Visibility)
- Example: "A score of X.X suggests Strong position — solid market standing..."

#### Score Color Bands (9 rows)
- 3 bands per category: Red (#EF4444), Amber (#F59E0B), Green (#10B981)
- Ranges: 0-30.01 (Red), 30.01-70.01 (Amber), 70.01-100.01 (Green)
- Note: Uses 100.01 as max (inclusive boundary handling)

## Updated Transformer Requirements

### New Transformers Needed

#### 1. AI Models Transformer
```typescript
interface AIModelCSVRow {
  id: string;
  vendor: string;
  model: string;
  display_name: string;
  max_tpm: string;
  max_rpm: string;
  cost_per_1k_input: string;
  cost_per_1k_output: string;
  enabled: string;
}

function transformAIModel(row: AIModelCSVRow) {
  return {
    id: row.id,
    vendor: row.vendor,
    model: row.model,
    displayName: row.display_name,
    maxTpm: parseInteger(row.max_tpm),
    maxRpm: parseInteger(row.max_rpm),
    costPer1kInput: row.cost_per_1k_input, // numeric type in DB
    costPer1kOutput: row.cost_per_1k_output, // numeric type in DB
    enabled: parseBoolean(row.enabled, true),
  };
}
```

#### 2. Score Interpretations Transformer
```typescript
interface ScoreInterpretationCSVRow {
  id: string;
  category: string;
  score_min: string;
  score_max: string;
  message_template: string;
}

function transformScoreInterpretation(row: ScoreInterpretationCSVRow) {
  return {
    id: row.id,
    category: row.category as 'Position' | 'Sentiment' | 'Visibility',
    scoreMin: row.score_min, // numeric type in DB
    scoreMax: row.score_max, // numeric type in DB
    messageTemplate: row.message_template,
  };
}
```

#### 3. Score Color Bands Transformer
```typescript
interface ScoreColorBandCSVRow {
  id: string;
  category: string;
  band_name: string;
  color_hex: string;
  score_min: string;
  score_max: string;
}

function transformScoreColorBand(row: ScoreColorBandCSVRow) {
  return {
    id: row.id,
    category: row.category as 'Position' | 'Sentiment' | 'Visibility',
    bandName: row.band_name,
    colorHex: row.color_hex,
    scoreMin: row.score_min, // numeric type in DB
    scoreMax: row.score_max, // numeric type in DB
  };
}
```

## Updated Implementation Plan

### Phase Structure

```typescript
async function main() {
  console.log('🌱 Starting production data seed...\n');

  try {
    // Phase 0: Prerequisites (NEW!)
    console.log('📋 Phase 0: Seeding prerequisite tables...');
    await seedTable('ai_models', 'ai_models_1762807418283.csv');
    await seedTable('score_interpretations', 'score_interpretations_1762807418282.csv');
    await seedTable('score_color_bands', 'score_color_bands_1762807418282.csv');
    console.log('✓ Phase 0 complete (30 rows)\n');

    // Phase 1: Organizations
    console.log('📋 Phase 1: Seeding organizations...');
    await seedTable('organizations', 'organizations_1762806929907.csv');
    console.log('✓ Phase 1 complete (2 rows)\n');

    // Phase 2: Clients
    console.log('📋 Phase 2: Seeding clients...');
    await seedTable('clients', 'clients_1762806929909.csv');
    console.log('✓ Phase 2 complete (18 rows)\n');

    // Phase 3: Level 3 tables (parallel)
    console.log('📋 Phase 3: Seeding level 3 tables...');
    await Promise.all([
      seedTable('competitors', 'competitors_1762806929908.csv'),
      seedTable('topics', 'topics_1762806929903.csv'),
      seedTable('prompts', 'prompts_1762806929905.csv'),
      seedTable('prompt_runs', 'prompt_runs_1762806929906.csv'),
      seedTable('xray_sites', 'xray_sites_1762806929901.csv'),
      seedTable('recommendations', 'recommendations_1762806929904.csv'),
      seedTable('generated_contents', 'generated_contents_1762806929908.csv'),
      seedTable('jobs', 'jobs_1762806929907.csv'), // Standalone
    ]);
    console.log('✓ Phase 3 complete (3,878 rows)\n');

    // Phase 4: Level 4 tables (parallel)
    console.log('📋 Phase 4: Seeding level 4 tables...');
    await Promise.all([
      seedTable('prompt_run_items', 'prompt_run_items_1762806929906.csv'),
      seedTable('xray_pages', 'xray_pages_1762806929902.csv'),
    ]);
    console.log('✓ Phase 4 complete (441 rows)\n');

    // Phase 5: Level 5 tables (parallel for structure/analysis, sequential for answers)
    console.log('📋 Phase 5: Seeding level 5 tables...');
    await seedTable('answers', 'answers_1762806929910.csv'); // Large table first
    await Promise.all([
      seedTable('xray_page_structure', 'xray_page_structure_1762806929902.csv'),
      seedTable('xray_page_analysis', 'xray_page_analysis_1762806929903.csv'),
    ]);
    console.log('✓ Phase 5 complete (15,692 rows)\n');

    // Phase 6: Level 6 tables (parallel)
    console.log('📋 Phase 6: Seeding level 6 tables...');
    await Promise.all([
      seedTable('citations', 'citations_1762806929909.csv'),
      seedTable('mentions', 'mentions_1762806929907.csv'),
      seedTable('rankings', 'rankings_1762806929905.csv'),
      seedTable('score_factors', 'score_factors_1762806929904.csv'),
    ]);
    console.log('✓ Phase 6 complete (4,555 rows)\n');

    // Phase 7: Final tables
    console.log('📋 Phase 7: Seeding competitor_scores...');
    await seedTable('competitor_scores', 'competitor_scores_1762806929909.csv');
    console.log('✓ Phase 7 complete (696 rows)\n');

    console.log('✅ Seeding complete! Total: ~25,030 rows imported.');
    
    // Validation
    await validateData();
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}
```

## Complete File Manifest (23 CSVs)

| # | CSV File | Table | Rows | Phase | Notes |
|---|----------|-------|------|-------|-------|
| 1 | ai_models_1762807418283.csv | ai_models | 4 | 0 | NEW - Prerequisites |
| 2 | score_interpretations_1762807418282.csv | score_interpretations | 17 | 0 | NEW - Prerequisites |
| 3 | score_color_bands_1762807418282.csv | score_color_bands | 9 | 0 | NEW - Prerequisites |
| 4 | organizations_1762806929907.csv | organizations | 2 | 1 | Root level |
| 5 | clients_1762806929909.csv | clients | 18 | 2 | Level 2 |
| 6 | competitors_1762806929908.csv | competitors | 81 | 3 | Parallel |
| 7 | topics_1762806929903.csv | topics | 566 | 3 | Parallel |
| 8 | prompts_1762806929905.csv | prompts | 663 | 3 | Parallel |
| 9 | prompt_runs_1762806929906.csv | prompt_runs | 25 | 3 | Parallel |
| 10 | xray_sites_1762806929901.csv | xray_sites | 12 | 3 | Parallel |
| 11 | recommendations_1762806929904.csv | recommendations | 1,865 | 3 | Parallel |
| 12 | generated_contents_1762806929908.csv | generated_contents | 586 | 3 | Parallel |
| 13 | jobs_1762806929907.csv | jobs | 92 | 3 | Parallel (standalone) |
| 14 | prompt_run_items_1762806929906.csv | prompt_run_items | 250 | 4 | Needs ai_models |
| 15 | xray_pages_1762806929902.csv | xray_pages | 191 | 4 | Parallel |
| 16 | answers_1762806929910.csv | answers | 15,366 | 5 | Largest table! |
| 17 | xray_page_structure_1762806929902.csv | xray_page_structure | 163 | 5 | Parallel |
| 18 | xray_page_analysis_1762806929903.csv | xray_page_analysis | 163 | 5 | Parallel |
| 19 | citations_1762806929909.csv | citations | 858 | 6 | Parallel |
| 20 | mentions_1762806929907.csv | mentions | 242 | 6 | Parallel |
| 21 | rankings_1762806929905.csv | rankings | 2,735 | 6 | Parallel |
| 22 | score_factors_1762806929904.csv | score_factors | 720 | 6 | Parallel |
| 23 | competitor_scores_1762806929909.csv | competitor_scores | 696 | 7 | Final |

**Missing**: Only `uploads` table (optional - file tracking, not critical for dev)

## Benefits of Updated Approach

### ✅ Advantages
1. **Production-identical data** - Exact IDs, configurations, and relationships
2. **Simpler implementation** - No manual data creation logic needed
3. **Faster execution** - Just CSV parsing + batch inserts
4. **Better validation** - Can verify against production exactly
5. **Complete coverage** - 23/24 tables (95.8%) from real data

### ⚡ Performance
- **Estimated time**: 3-5 minutes for 25K rows
- **Bottleneck**: answers table (15,366 rows)
- **Strategy**: 500-row batches with progress tracking

## Validation Updates

### Post-Seed Checks
```sql
-- Verify all tables populated
SELECT 
  'ai_models' as table, COUNT(*) as count, 4 as expected FROM ai_models
  UNION ALL SELECT 'score_interpretations', COUNT(*), 17 FROM score_interpretations
  UNION ALL SELECT 'score_color_bands', COUNT(*), 9 FROM score_color_bands
  UNION ALL SELECT 'organizations', COUNT(*), 2 FROM organizations
  UNION ALL SELECT 'clients', COUNT(*), 18 FROM clients
  -- ... all 23 tables
  
-- Check foreign key integrity for ai_models
SELECT COUNT(*) as orphaned_items
FROM prompt_run_items
WHERE model_id NOT IN (SELECT id FROM ai_models);

-- Should return 0
```

## Next Steps

Ready to implement the complete seeding script with:
- ✓ 23 CSV transformers (20 existing + 3 new)
- ✓ Proper dependency ordering (8 phases)
- ✓ Batch processing for large tables
- ✓ Progress tracking
- ✓ Comprehensive validation
- ✓ Error handling and rollback

**This is now a complete, production-ready seeding plan!**
