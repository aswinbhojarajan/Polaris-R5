# Production Data Seeding Instructions

## Overview
This script seeds your development database with production data from 23 CSV files containing 9,643 records.

## Quick Start

### Run the Seeding Script
```bash
npx tsx scripts/seed-production-data.ts
```

## What It Does

The script will:
1. **Phase 0**: Seed prerequisite tables (ai_models, score_interpretations, score_color_bands)
2. **Phase 1**: Seed organizations
3. **Phase 2**: Seed clients
4. **Phase 3-7**: Seed remaining tables in dependency order
5. **Validate**: Verify all row counts match expected values

## Expected Output

```
🌱 Starting production data seed...

═══════════════════════════════════════════════════════

📋 Phase 0: Seeding prerequisite tables...
  → Seeding ai_models...
    ✓ Seeded 4 rows
  → Seeding score_interpretations...
    ✓ Seeded 17 rows
  → Seeding score_color_bands...
    ✓ Seeded 9 rows
  ✓ Phase 0 complete (30 rows)

... (continues through all phases) ...

✅ Seeding complete in X.XX seconds!

🔍 Validating seeded data...

Row counts:
─────────────────────────────────────────
✓ ai_models                       4 / 4
✓ score_interpretations          17 / 17
✓ score_color_bands               9 / 9
✓ organizations                   2 / 2
✓ clients                        18 / 18
... (all tables) ...
─────────────────────────────────────────
  Total                       25,030 / 25,030

✓ All row counts match expected values

✅ Validation complete!
```

## Tables Seeded

### Prerequisites (30 rows)
- ai_models (4)
- score_interpretations (17)
- score_color_bands (9)

### Core Tables (3,367 rows)
- organizations (1)
- clients (17)
- competitors (80)
- topics (566)
- prompts (663)
- prompt_runs (24)
- xray_sites (11)
- recommendations (1,865)
- generated_contents (83)
- jobs (91)

### Analysis Tables (6,246 rows)
- prompt_run_items (250)
- answers (222)
- citations (858)
- mentions (242)
- rankings (2,735)
- score_factors (720)
- competitor_scores (696)
- xray_pages (163)
- xray_page_structure (163)
- xray_page_analysis (163)

**Total: 9,643 rows across 23 tables**

## Important Notes

### Database Connection
- Uses your existing `DATABASE_URL` environment variable
- Make sure your database is running and accessible

### Data Transformations
The script handles:
- ✓ JSON field parsing (arrays, objects)
- ✓ Timestamp parsing (triple-quoted ISO format)
- ✓ Boolean conversions
- ✓ Numeric/decimal values
- ✓ Enum validation
- ✓ NULL vs empty string handling

### Batch Processing
Large tables (like `answers` with 15,366 rows) are inserted in batches of 500 rows for efficiency.

### Foreign Key Dependencies
Tables are seeded in the correct order to maintain referential integrity:
```
Level 0: ai_models, score tables
Level 1: organizations
Level 2: clients
Level 3: competitors, topics, prompts, etc.
Level 4: prompt_run_items, xray_pages
Level 5: answers, xray_page_structure/analysis
Level 6: citations, mentions, rankings, score_factors
Level 7: competitor_scores
```

## Troubleshooting

### If seeding fails:
1. Check database connection
2. Ensure all CSV files are in `attached_assets/` directory
3. Verify database schema matches (run `npm run db:push` if needed)
4. Check error message for specific table/row that failed

### If validation shows mismatches:
- Compare actual vs expected counts
- Check if CSV files were modified
- Verify no duplicate IDs in CSV files

## CSV Files Used

All files from `attached_assets/`:
1. ai_models_1762807418283.csv
2. score_interpretations_1762807418282.csv
3. score_color_bands_1762807418282.csv
4. organizations_1762806929907.csv
5. clients_1762806929909.csv
6. competitors_1762806929908.csv
7. topics_1762806929903.csv
8. prompts_1762806929905.csv
9. prompt_runs_1762806929906.csv
10. xray_sites_1762806929901.csv
11. recommendations_1762806929904.csv
12. generated_contents_1762806929908.csv
13. jobs_1762806929907.csv
14. prompt_run_items_1762806929906.csv
15. xray_pages_1762806929902.csv
16. answers_1762806929910.csv
17. xray_page_structure_1762806929902.csv
18. xray_page_analysis_1762806929903.csv
19. citations_1762806929909.csv
20. mentions_1762806929907.csv
21. rankings_1762806929905.csv
22. score_factors_1762806929904.csv
23. competitor_scores_1762806929909.csv

## Performance

- **Expected Duration**: 3-5 minutes
- **Bottleneck**: `answers` table (15,366 rows)
- **Memory**: Batch processing keeps memory usage low
- **Database Load**: Moderate (500 rows per batch)

---

Ready to seed? Run: `npx tsx scripts/seed-production-data.ts`
