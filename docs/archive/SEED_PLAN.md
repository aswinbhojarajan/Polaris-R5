# Database Seeding Plan - Production Data Import

## Overview
Import 15,367+ rows of production data from 20 CSV files into development PostgreSQL database while maintaining referential integrity and handling complex data types.

## Data Inventory

### Available CSV Files (20 total)
| CSV File | Row Count | Size | Status |
|----------|-----------|------|--------|
| answers_1762806929910.csv | 15,367 | 781K | ✓ Ready |
| rankings_1762806929905.csv | 2,735 | 375K | ✓ Ready |
| recommendations_1762806929904.csv | 1,865 | 1.7M | ✓ Ready |
| citations_1762806929909.csv | 858 | 167K | ✓ Ready |
| score_factors_1762806929904.csv | 720 | 102K | ✓ Ready |
| competitor_scores_1762806929909.csv | 696 | 160K | ✓ Ready |
| prompts_1762806929905.csv | 663 | 150K | ✓ Ready |
| generated_contents_1762806929908.csv | 586 | 141K | ✓ Ready |
| topics_1762806929903.csv | 566 | 143K | ✓ Ready |
| prompt_run_items_1762806929906.csv | 250 | 58K | ✓ Ready |
| mentions_1762806929907.csv | 242 | 27K | ✓ Ready |
| xray_pages_1762806929902.csv | 191 | 546K | ✓ Ready |
| xray_page_structure_1762806929902.csv | 163 | 73K | ✓ Ready |
| xray_page_analysis_1762806929903.csv | 163 | 169K | ✓ Ready |
| jobs_1762806929907.csv | 92 | 22K | ✓ Ready |
| competitors_1762806929908.csv | 81 | 13K | ✓ Ready |
| prompt_runs_1762806929906.csv | 25 | 3.1K | ✓ Ready |
| clients_1762806929909.csv | 18 | 13K | ✓ Ready |
| xray_sites_1762806929901.csv | 12 | 62K | ✓ Ready |
| organizations_1762806929907.csv | 2 | 93 bytes | ✓ Ready |

**Total Records: ~25,000 rows across 20 tables**

### Missing Tables (No CSV Data - Requires Manual Seeding)
| Table | Why Missing | Action Required |
|-------|-------------|-----------------|
| ai_models | Core reference table | Create 3 models based on IDs found in data |
| uploads | File tracking table | Skip for now (not critical) |
| score_interpretations | Configuration table | Create default interpretations |
| score_color_bands | Configuration table | Create default color bands |

### Model IDs Found in Data
From `prompt_run_items` CSV, we need these 3 AI models:
1. `4aa7b655-6aca-4985-8880-c4ad7f774690`
2. `4ea5cfb9-3192-4410-910e-f26897753f97`
3. `9b98072b-483b-43d3-895c-da4471dba944`

## Database Schema Analysis

### Dependency Tree (Insert Order CRITICAL)
```
Level 1 (No dependencies):
├── organizations (2 rows)
└── ai_models (3 rows - MANUAL)

Level 2 (Depends on Level 1):
└── clients (18 rows) → references organizations

Level 3 (Depends on Level 2):
├── competitors (81 rows) → references clients
├── topics (566 rows) → references clients
├── prompts (663 rows) → references clients
├── prompt_runs (25 rows) → references clients
├── xray_sites (12 rows) → references clients
├── recommendations (1,865 rows) → references clients
└── generated_contents (586 rows) → references clients

Level 4 (Depends on Level 3):
├── prompt_run_items (250 rows) → references prompt_runs, prompts, ai_models
└── xray_pages (191 rows) → references xray_sites

Level 5 (Depends on Level 4):
├── answers (15,367 rows!) → references prompt_run_items
├── xray_page_structure (163 rows) → references xray_pages
└── xray_page_analysis (163 rows) → references xray_pages

Level 6 (Depends on Level 5):
├── citations (858 rows) → references answers
├── mentions (242 rows) → references answers
├── rankings (2,735 rows) → references answers
└── score_factors (720 rows) → references prompt_run_items

Level 7 (Depends on Level 3 & Level 4):
└── competitor_scores (696 rows) → references prompt_runs, prompts, competitors

Standalone (No foreign keys):
└── jobs (92 rows) → can be inserted anytime
```

## Data Transformation Challenges

### 1. JSON Fields (Multiple tables have JSONB columns)
**Format in CSV**: Escaped JSON strings
**Examples**:
- `clients.urls`: `"[{""url"":""https://example.com"",""category"":""primary""}]"`
- `clients.focus_areas`: `"[""Area 1"",""Area 2""]"`
- `xray_page_structure.headings`: Complex nested JSON

**Solution**: Parse escaped JSON strings and validate structure

### 2. Timestamp Fields
**Format in CSV**: ISO 8601 with extra quotes
**Example**: `"""2025-10-17T12:01:02.695Z"""`

**Solution**: Strip extra quotes and parse as Date objects

### 3. Enum Values
**9 Custom Enums**:
- `source_enum`: 'crawl', 'manual', 'csv', 'ai'
- `status_enum`: 'queued', 'running', 'done', 'error', 'cancelled'
- `citation_type_enum`: 'hard', 'soft'
- `sentiment_enum`: 'positive', 'neutral', 'negative'
- `upload_kind_enum`: 'csv_topics', 'csv_prompts'
- `onboarding_status_enum`: 'draft', 'inprogress', 'completed'
- `site_type_enum`: 'internal', 'third_party'
- `crawl_access_status_enum`: 'ok', 'blocked', 'rate_limited', 'captcha'
- `effort_enum`: 'S', 'M', 'L'
- `score_category_enum`: 'Position', 'Sentiment', 'Visibility'
- `recommendation_source_enum`: 'crawl', 'prompt_response', 'citation', 'ai_analysis', 'manual'

**Solution**: Validate enum values match schema definitions

### 4. Numeric/Decimal Fields
**Schema**: `numeric(precision, scale)` - e.g., `numeric(5, 2)` for scores
**CSV Format**: Plain numbers or empty strings

**Solution**: Parse numbers, handle nulls for optional fields

### 5. Boolean Fields
**CSV Format**: `true`, `false`, or empty
**Schema**: PostgreSQL boolean

**Solution**: Convert string booleans to actual boolean values

### 6. Large Text Fields
**Concerns**:
- `answers.raw_response`: 15,367 rows with potentially large text
- `xray_pages.raw_html`: Full HTML content (191 rows)
- `xray_pages.raw_text`: Extracted text content

**Solution**: Stream processing for memory efficiency

## Proposed Implementation Strategy

### Phase 1: Prerequisites
1. **Create AI Models** (Manual - no CSV data)
   - Insert 3 models with specific UUIDs found in data
   - Use vendors: OpenAI, Anthropic, etc.
   - Set realistic rate limits and costs

2. **Create Score Interpretations** (Manual - lookup table)
   - Define messages for Position/Sentiment/Visibility categories
   - Set score ranges (0-100)

3. **Create Score Color Bands** (Manual - configuration)
   - Define color bands (red/yellow/green) per category
   - Set min/max ranges

### Phase 2: CSV Parsing Utility
1. **CSV Parser Function**
   - Use Node.js `csv-parse` or similar
   - Handle quoted fields correctly
   - Stream large files

2. **Data Transformer**
   - Clean timestamp formats (remove extra quotes)
   - Parse JSON fields
   - Convert data types (boolean, numeric)
   - Validate enum values
   - Handle nulls vs empty strings

3. **Validator**
   - Check foreign key references exist
   - Validate UUIDs format
   - Ensure required fields present
   - Verify enum values

### Phase 3: Seeding Script Structure
```typescript
// scripts/seed-production-data.ts

import { db } from '../server/db';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as schema from '../shared/schema';

async function seedTable(tableName, csvPath, transformer) {
  // 1. Read CSV file
  // 2. Parse with csv-parse
  // 3. Transform each row
  // 4. Batch insert (chunks of 100-500 rows)
  // 5. Report progress
}

async function main() {
  console.log('Starting production data seed...');
  
  // Phase 1: Manual tables
  await seedAIModels();
  await seedScoreInterpretations();
  await seedScoreColorBands();
  
  // Phase 2: Level 1
  await seedTable('organizations', 'organizations_1762806929907.csv', transformOrg);
  
  // Phase 3: Level 2
  await seedTable('clients', 'clients_1762806929909.csv', transformClient);
  
  // Phase 4: Level 3
  await Promise.all([
    seedTable('competitors', 'competitors_1762806929908.csv', transformCompetitor),
    seedTable('topics', 'topics_1762806929903.csv', transformTopic),
    seedTable('prompts', 'prompts_1762806929905.csv', transformPrompt),
    seedTable('prompt_runs', 'prompt_runs_1762806929906.csv', transformPromptRun),
    seedTable('xray_sites', 'xray_sites_1762806929901.csv', transformXraySite),
    // ... more Level 3 tables
  ]);
  
  // Continue through all levels...
  
  console.log('Seeding complete!');
}

main().catch(console.error);
```

### Phase 4: Batch Insert Strategy
**For large tables (answers: 15,367 rows)**:
- Use batch inserts (500 rows per batch)
- Use transactions for atomicity
- Show progress bar
- Handle errors gracefully

**Example**:
```typescript
// Chunk array into batches
for (let i = 0; i < data.length; i += 500) {
  const batch = data.slice(i, i + 500);
  await db.insert(schema.answers).values(batch);
  console.log(`Inserted ${i + batch.length}/${data.length} answers`);
}
```

### Phase 5: Validation & Verification
After seeding, run validation queries:
```sql
-- Check row counts match CSV
SELECT 'organizations' as table, COUNT(*) FROM organizations
UNION ALL
SELECT 'clients', COUNT(*) FROM clients
-- ... for all tables

-- Verify foreign keys
SELECT COUNT(*) FROM clients WHERE org_id NOT IN (SELECT id FROM organizations);
SELECT COUNT(*) FROM prompt_run_items WHERE model_id NOT IN (SELECT id FROM ai_models);

-- Check for NULL critical fields
SELECT COUNT(*) FROM clients WHERE name IS NULL;
```

## Data Quality Concerns to Handle

### 1. Empty vs NULL
- CSV empty cells should map to NULL in database
- Some fields have defaults (e.g., `is_active: true`)

### 2. Character Encoding
- Ensure UTF-8 encoding
- Handle special characters in text fields

### 3. Duplicate IDs
- UUIDs should be unique
- Verify no duplicate primary keys in CSV

### 4. Orphaned Records
- Ensure all foreign keys reference valid IDs
- Script should validate before inserting

### 5. Data Consistency
- Scores should be in valid ranges (0-100)
- Enum values must match schema
- Timestamps should be valid dates

## Script Execution Plan

### File Structure
```
scripts/
├── seed-production-data.ts (main script)
├── transformers/
│   ├── organizations.ts
│   ├── clients.ts
│   ├── answers.ts
│   └── ... (one per table)
├── utils/
│   ├── csv-parser.ts
│   ├── batch-insert.ts
│   └── validators.ts
└── manual-seeds/
    ├── ai-models.ts
    ├── score-interpretations.ts
    └── score-color-bands.ts
```

### Error Handling
- Log all transformation errors to file
- Continue on non-critical errors
- Abort on foreign key violations
- Provide summary report

### Performance Considerations
- Use database transactions per batch
- Disable indexes during bulk insert (optional)
- Stream large CSV files
- Use prepared statements
- Estimated time: 2-5 minutes for 25K rows

## Rollback Strategy

### Before Seeding
```sql
-- Backup development database
pg_dump $DATABASE_URL > backup-before-seed.sql
```

### If Seeding Fails
```typescript
// Script should use transaction
try {
  await db.transaction(async (tx) => {
    // All inserts here
  });
} catch (error) {
  // Transaction auto-rolls back
  console.error('Seeding failed, rolled back');
}
```

## Success Criteria

### ✓ All 20 CSV files imported
### ✓ 4 manual tables created (ai_models, score_interpretations, score_color_bands, uploads skipped)
### ✓ Total row count matches CSV totals (~25,000 rows)
### ✓ No foreign key constraint violations
### ✓ All JSON fields properly parsed
### ✓ All enum values valid
### ✓ No data loss or corruption

## Next Steps (When Approved)

1. Create TypeScript seeding script with proper structure
2. Implement CSV parsing and transformation utilities
3. Add manual seed data for AI models and score tables
4. Implement batch insertion with progress tracking
5. Add comprehensive error handling and validation
6. Test on small subset first
7. Run full production data import
8. Verify data integrity with SQL queries
9. Document any data quality issues found

---

**Ready for implementation when you give the go-ahead!**
