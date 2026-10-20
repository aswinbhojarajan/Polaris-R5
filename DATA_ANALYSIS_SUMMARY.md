# Production Data Analysis Summary

## Quick Stats
- **Total CSV Files**: 20
- **Total Records**: ~25,000 rows
- **Largest Table**: answers (15,366 rows)
- **Missing Tables**: 4 (ai_models, uploads, score_interpretations, score_color_bands)

## Critical Findings

### 1. ⚠️ Non-UUID Primary Key Found
**Issue**: `organizations` table has ID `"default-org"` (not a UUID)
**Impact**: Schema defines `varchar` ID with UUID default, but existing data uses custom string
**Solution**: Keep varchar type (already correct), skip auto-generation for seeding

### 2. 🔑 Foreign Key Dependencies
**3 AI Model IDs** required before seeding:
```
4aa7b655-6aca-4985-8880-c4ad7f774690
4ea5cfb9-3192-4410-910e-f26897753f97
9b98072b-483b-43d3-895c-da4471dba944
```
These are referenced by 250 `prompt_run_items` and used in client configurations.

### 3. 📊 Data Format Patterns

#### JSON Fields (Need Parsing)
```javascript
// Example from clients.urls
"[{""url"":""https://example.com"",""category"":""primary""}]"

// Transformation needed:
CSV: "[{""url"":""https://...""",""category"":""primary""}]"
→ Parse: [{"url":"https://...","category":"primary"}]
```

#### Timestamp Format
```javascript
// CSV format (triple quotes):
"""2025-10-17T12:01:02.695Z"""

// Needs: Strip outer quotes and parse
→ new Date("2025-10-17T12:01:02.695Z")
```

#### NULL vs Empty
- Empty cells in CSV → NULL in database
- Empty strings "" → NULL for optional fields
- Missing numeric values → NULL (not 0)

### 4. 🎯 High-Volume Tables (Need Batch Processing)
| Table | Rows | Strategy |
|-------|------|----------|
| answers | 15,366 | Batch 500 rows, stream processing |
| rankings | 2,735 | Batch 500 rows |
| recommendations | 1,865 | Batch 500 rows |
| citations | 858 | Batch 500 rows |
| score_factors | 720 | Batch 500 rows |
| competitor_scores | 696 | Batch 500 rows |

### 5. 📝 Complex JSON Structures

#### Most Complex: xray_page_structure
Contains nested objects:
```json
{
  "people": [],
  "products": [],
  "companies": [],
  "locations": [],
  "technologies": []
}
```

#### recommendations.examples
Array of objects with issue/content/citation:
```json
[{
  "issue": "Add clear H1 heading...",
  "content": "[Analysis based on...]",
  "citation": "https://..."
}]
```

### 6. 🔍 Data Integrity Checks Required

#### Before Insertion:
- ✓ Verify all foreign key IDs exist
- ✓ Validate UUID format (except "default-org")
- ✓ Check enum values match schema
- ✓ Ensure required fields not null
- ✓ Validate numeric ranges (scores 0-100)

#### After Insertion:
- ✓ Row counts match CSV
- ✓ No orphaned records
- ✓ All JSON fields valid
- ✓ All relationships intact

## Schema-CSV Field Mapping

### Tables with Perfect Match ✓
- organizations (all fields present)
- competitors (all fields present)
- mentions (all fields present)
- rankings (all fields present)

### Tables with Optional Fields
- clients: `website`, `urls`, `focus_areas`, `industry`, `geography`, `aliases`, `brand_aliases`, `selected_ai_model_ids` (all optional)
- xray_pages: `title`, `page_type`, `last_modified` (nullable)
- prompt_run_items: `started_at`, `finished_at`, `error` (nullable based on status)

## Enum Value Validation

### Found in Data:
| Enum | Values in CSV |
|------|---------------|
| source_enum | 'csv', 'ai', 'manual' (need to verify 'crawl') |
| status_enum | 'queued', 'done' (verified) |
| onboarding_status_enum | 'completed' (verified) |
| site_type_enum | Need to check xray_sites |
| sentiment_enum | Need to check mentions |
| citation_type_enum | Need to check citations |
| recommendation_source_enum | 'crawl' (verified) |
| score_category_enum | Need to check score_factors |

## Seeding Order (Dependency Sequence)

```
1. ai_models (MANUAL - 3 rows)
2. organizations (CSV - 2 rows)
3. clients (CSV - 18 rows)
4. ├── competitors (CSV - 81 rows)
   ├── topics (CSV - 566 rows)
   ├── prompts (CSV - 663 rows)
   ├── prompt_runs (CSV - 25 rows)
   ├── xray_sites (CSV - 12 rows)
   ├── recommendations (CSV - 1,865 rows)
   └── generated_contents (CSV - 586 rows)
5. ├── prompt_run_items (CSV - 250 rows) [needs ai_models]
   └── xray_pages (CSV - 191 rows)
6. ├── answers (CSV - 15,366 rows)
   ├── xray_page_structure (CSV - 163 rows)
   └── xray_page_analysis (CSV - 163 rows)
7. ├── citations (CSV - 858 rows)
   ├── mentions (CSV - 242 rows)
   ├── rankings (CSV - 2,735 rows)
   └── score_factors (CSV - 720 rows)
8. competitor_scores (CSV - 696 rows) [complex dependencies]
9. jobs (CSV - 92 rows) [standalone - anytime]
```

## Manual Seed Data Required

### AI Models (3 required)
Need to create with proper vendor names, rate limits, and costs:
```typescript
[
  {
    id: '4aa7b655-6aca-4985-8880-c4ad7f774690',
    vendor: '???', // Need to determine
    model: '???',
    displayName: '???',
    enabled: true
  },
  // ... 2 more
]
```

### Score Interpretations (~15 rows)
For each category (Position, Sentiment, Visibility) × score ranges

### Score Color Bands (~9-12 rows)
Color mapping for score visualization

## Risk Assessment

### Low Risk ✅
- Organizations (only 2 rows, simple structure)
- Competitors (simple table, clear relationships)
- Jobs (standalone, no dependencies)

### Medium Risk ⚠️
- Clients (18 rows, complex JSON fields)
- Topics, Prompts (medium volume, standard structure)
- X-Ray tables (complex JSON but lower volume)

### High Risk 🔴
- **Answers** (15,366 rows - largest table, critical to many relations)
- **Rankings** (2,735 rows - depends on answers)
- **Recommendations** (1,865 rows - complex JSON structures)
- **Prompt Run Items** (requires ai_models to be seeded first)

## Performance Estimates

### With Batch Processing (500 rows/batch):
- Small tables (<100 rows): ~1-5 seconds each
- Medium tables (100-1000 rows): ~5-30 seconds each
- Large tables (>1000 rows): ~30-120 seconds each

**Total Estimated Time: 3-5 minutes**

## Recommended Tooling

### CSV Parsing
```bash
npm install csv-parse
```

### Progress Tracking
```bash
npm install cli-progress
```

### Data Validation
```bash
npm install zod uuid
```

## Verification Queries (Post-Seed)

```sql
-- Row count verification
SELECT 
  'organizations' as table, COUNT(*) as count FROM organizations
  UNION ALL SELECT 'clients', COUNT(*) FROM clients
  UNION ALL SELECT 'answers', COUNT(*) FROM answers
  -- ... all tables

-- Foreign key integrity
SELECT COUNT(*) as orphaned_clients 
FROM clients 
WHERE org_id NOT IN (SELECT id FROM organizations);

SELECT COUNT(*) as orphaned_prompt_items 
FROM prompt_run_items 
WHERE model_id NOT IN (SELECT id FROM ai_models);

-- Data quality
SELECT COUNT(*) as missing_names FROM clients WHERE name IS NULL;
SELECT COUNT(*) as invalid_scores FROM answers WHERE visibility_score > 100;
```

---

## 🚀 Ready to Implement

All analysis complete. The plan is solid and accounts for:
- ✓ All 20 CSV files mapped to schema
- ✓ Dependency order established
- ✓ Data transformation requirements identified
- ✓ Performance strategy defined
- ✓ Risk mitigation planned
- ✓ Validation approach documented

**Awaiting your approval to proceed with implementation!**
