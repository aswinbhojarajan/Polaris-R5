import { db } from '../server/db';
import * as schema from '../shared/schema';
import { readCSV, batchArray } from './utils';
import * as transformers from './transformers';

interface TableConfig {
  name: string;
  csvFile: string;
  transformer: (row: any) => any;
  table: any;
}

const BATCH_SIZE = 500;

// Cache CSV record counts to avoid re-parsing during validation
const csvRecordCounts: Record<string, number> = {};

/**
 * Seed a table from CSV with batch processing
 */
async function seedTable(config: TableConfig) {
  const { name, csvFile, transformer, table } = config;
  
  console.log(`  → Seeding ${name}...`);
  
  try {
    const records = readCSV(csvFile);
    
    // Cache the record count for validation
    csvRecordCounts[name] = records.length;
    
    if (records.length === 0) {
      console.log(`    ⚠️  No records found in ${csvFile}`);
      return;
    }
    
    const batches = batchArray(records, BATCH_SIZE);
    let totalInserted = 0;
    
    for (const batch of batches) {
      const transformed = batch.map(transformer);
      await db.insert(table).values(transformed);
      totalInserted += batch.length;
      
      if (batches.length > 1) {
        console.log(`    → ${totalInserted}/${records.length} rows`);
      }
    }
    
    console.log(`    ✓ Seeded ${totalInserted} rows`);
  } catch (error: any) {
    console.error(`    ✗ Failed to seed ${name}:`, error.message);
    throw error;
  }
}

/**
 * Clear all tables before seeding
 */
async function clearDatabase() {
  console.log('🗑️  Clearing existing data...\n');
  
  try {
    // Delete in reverse dependency order to avoid foreign key violations
    await db.delete(schema.competitorScores);
    await db.delete(schema.scoreFactors);
    await db.delete(schema.rankings);
    await db.delete(schema.mentions);
    await db.delete(schema.citations);
    await db.delete(schema.xrayPageAnalysis);
    await db.delete(schema.xrayPageStructure);
    await db.delete(schema.answers);
    await db.delete(schema.xrayPages);
    await db.delete(schema.promptRunItems);
    await db.delete(schema.generatedContents);
    await db.delete(schema.recommendations);
    await db.delete(schema.jobs);
    await db.delete(schema.xraySites);
    await db.delete(schema.promptRuns);
    await db.delete(schema.prompts);
    await db.delete(schema.topics);
    await db.delete(schema.competitors);
    await db.delete(schema.clients);
    await db.delete(schema.organizations);
    await db.delete(schema.scoreColorBands);
    await db.delete(schema.scoreInterpretations);
    await db.delete(schema.aiModels);
    
    console.log('  ✓ All tables cleared\n');
  } catch (error: any) {
    console.error('  ✗ Failed to clear database:', error.message);
    throw error;
  }
}

/**
 * Main seeding function
 */
async function main() {
  console.log('🌱 Starting production data seed...\n');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const startTime = Date.now();
  
  try {
    // Clear existing data first
    await clearDatabase();
    // Phase 0: Prerequisites (tables with no dependencies)
    console.log('📋 Phase 0: Seeding prerequisite tables...');
    await seedTable({
      name: 'ai_models',
      csvFile: 'attached_assets/ai_models_1762807418283.csv',
      transformer: transformers.transformAIModel,
      table: schema.aiModels,
    });
    await seedTable({
      name: 'score_interpretations',
      csvFile: 'attached_assets/score_interpretations_1762807418282.csv',
      transformer: transformers.transformScoreInterpretation,
      table: schema.scoreInterpretations,
    });
    await seedTable({
      name: 'score_color_bands',
      csvFile: 'attached_assets/score_color_bands_1762807418282.csv',
      transformer: transformers.transformScoreColorBand,
      table: schema.scoreColorBands,
    });
    console.log('  ✓ Phase 0 complete (30 rows)\n');

    // Phase 1: Organizations (root level)
    console.log('📋 Phase 1: Seeding organizations...');
    await seedTable({
      name: 'organizations',
      csvFile: 'attached_assets/organizations_1762806929907.csv',
      transformer: transformers.transformOrganization,
      table: schema.organizations,
    });
    console.log('  ✓ Phase 1 complete\n');

    // Phase 2: Clients
    console.log('📋 Phase 2: Seeding clients...');
    await seedTable({
      name: 'clients',
      csvFile: 'attached_assets/clients_1762806929909.csv',
      transformer: transformers.transformClient,
      table: schema.clients,
    });
    console.log('  ✓ Phase 2 complete\n');

    // Phase 3: Level 3 tables (can be parallel)
    console.log('📋 Phase 3: Seeding level 3 tables...');
    await Promise.all([
      seedTable({
        name: 'competitors',
        csvFile: 'attached_assets/competitors_1762806929908.csv',
        transformer: transformers.transformCompetitor,
        table: schema.competitors,
      }),
      seedTable({
        name: 'topics',
        csvFile: 'attached_assets/topics_1762806929903.csv',
        transformer: transformers.transformTopic,
        table: schema.topics,
      }),
      seedTable({
        name: 'prompts',
        csvFile: 'attached_assets/prompts_1762806929905.csv',
        transformer: transformers.transformPrompt,
        table: schema.prompts,
      }),
      seedTable({
        name: 'prompt_runs',
        csvFile: 'attached_assets/prompt_runs_1762806929906.csv',
        transformer: transformers.transformPromptRun,
        table: schema.promptRuns,
      }),
      seedTable({
        name: 'xray_sites',
        csvFile: 'attached_assets/xray_sites_1762806929901.csv',
        transformer: transformers.transformXraySite,
        table: schema.xraySites,
      }),
      seedTable({
        name: 'recommendations',
        csvFile: 'attached_assets/recommendations_1762806929904.csv',
        transformer: transformers.transformRecommendation,
        table: schema.recommendations,
      }),
      seedTable({
        name: 'generated_contents',
        csvFile: 'attached_assets/generated_contents_1762806929908.csv',
        transformer: transformers.transformGeneratedContent,
        table: schema.generatedContents,
      }),
      seedTable({
        name: 'jobs',
        csvFile: 'attached_assets/jobs_1762806929907.csv',
        transformer: transformers.transformJob,
        table: schema.jobs,
      }),
    ]);
    console.log('  ✓ Phase 3 complete\n');

    // Phase 4: Level 4 tables
    console.log('📋 Phase 4: Seeding level 4 tables...');
    await Promise.all([
      seedTable({
        name: 'prompt_run_items',
        csvFile: 'attached_assets/prompt_run_items_1762806929906.csv',
        transformer: transformers.transformPromptRunItem,
        table: schema.promptRunItems,
      }),
      seedTable({
        name: 'xray_pages',
        csvFile: 'attached_assets/xray_pages_1762806929902.csv',
        transformer: transformers.transformXrayPage,
        table: schema.xrayPages,
      }),
    ]);
    console.log('  ✓ Phase 4 complete\n');

    // Phase 5: Level 5 tables (answers is large, do it first)
    console.log('📋 Phase 5: Seeding level 5 tables...');
    await seedTable({
      name: 'answers',
      csvFile: 'attached_assets/answers_1762806929910.csv',
      transformer: transformers.transformAnswer,
      table: schema.answers,
    });
    await Promise.all([
      seedTable({
        name: 'xray_page_structure',
        csvFile: 'attached_assets/xray_page_structure_1762806929902.csv',
        transformer: transformers.transformXrayPageStructure,
        table: schema.xrayPageStructure,
      }),
      seedTable({
        name: 'xray_page_analysis',
        csvFile: 'attached_assets/xray_page_analysis_1762806929903.csv',
        transformer: transformers.transformXrayPageAnalysis,
        table: schema.xrayPageAnalysis,
      }),
    ]);
    console.log('  ✓ Phase 5 complete\n');

    // Phase 6: Level 6 tables (can be parallel)
    console.log('📋 Phase 6: Seeding level 6 tables...');
    await Promise.all([
      seedTable({
        name: 'citations',
        csvFile: 'attached_assets/citations_1762806929909.csv',
        transformer: transformers.transformCitation,
        table: schema.citations,
      }),
      seedTable({
        name: 'mentions',
        csvFile: 'attached_assets/mentions_1762806929907.csv',
        transformer: transformers.transformMention,
        table: schema.mentions,
      }),
      seedTable({
        name: 'rankings',
        csvFile: 'attached_assets/rankings_1762806929905.csv',
        transformer: transformers.transformRanking,
        table: schema.rankings,
      }),
      seedTable({
        name: 'score_factors',
        csvFile: 'attached_assets/score_factors_1762806929904.csv',
        transformer: transformers.transformScoreFactor,
        table: schema.scoreFactors,
      }),
    ]);
    console.log('  ✓ Phase 6 complete\n');

    // Phase 7: Final tables
    console.log('📋 Phase 7: Seeding competitor_scores...');
    await seedTable({
      name: 'competitor_scores',
      csvFile: 'attached_assets/competitor_scores_1762806929909.csv',
      transformer: transformers.transformCompetitorScore,
      table: schema.competitorScores,
    });
    console.log('  ✓ Phase 7 complete\n');

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Seeding complete in ${duration} seconds!\n`);
    
    // Run validation
    await validateData();
    
  } catch (error: any) {
    console.error('\n❌ Seeding failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Validate seeded data
 */
async function validateData() {
  console.log('🔍 Validating seeded data...\n');
  
  try {
    // Use cached CSV record counts from seeding (avoids re-parsing all CSVs)
    const counts = await Promise.all([
      db.select().from(schema.aiModels).then(r => ({ table: 'ai_models', count: r.length, expected: csvRecordCounts.ai_models })),
      db.select().from(schema.scoreInterpretations).then(r => ({ table: 'score_interpretations', count: r.length, expected: csvRecordCounts.score_interpretations })),
      db.select().from(schema.scoreColorBands).then(r => ({ table: 'score_color_bands', count: r.length, expected: csvRecordCounts.score_color_bands })),
      db.select().from(schema.organizations).then(r => ({ table: 'organizations', count: r.length, expected: csvRecordCounts.organizations })),
      db.select().from(schema.clients).then(r => ({ table: 'clients', count: r.length, expected: csvRecordCounts.clients })),
      db.select().from(schema.competitors).then(r => ({ table: 'competitors', count: r.length, expected: csvRecordCounts.competitors })),
      db.select().from(schema.topics).then(r => ({ table: 'topics', count: r.length, expected: csvRecordCounts.topics })),
      db.select().from(schema.prompts).then(r => ({ table: 'prompts', count: r.length, expected: csvRecordCounts.prompts })),
      db.select().from(schema.promptRuns).then(r => ({ table: 'prompt_runs', count: r.length, expected: csvRecordCounts.prompt_runs })),
      db.select().from(schema.promptRunItems).then(r => ({ table: 'prompt_run_items', count: r.length, expected: csvRecordCounts.prompt_run_items })),
      db.select().from(schema.answers).then(r => ({ table: 'answers', count: r.length, expected: csvRecordCounts.answers })),
      db.select().from(schema.citations).then(r => ({ table: 'citations', count: r.length, expected: csvRecordCounts.citations })),
      db.select().from(schema.mentions).then(r => ({ table: 'mentions', count: r.length, expected: csvRecordCounts.mentions })),
      db.select().from(schema.rankings).then(r => ({ table: 'rankings', count: r.length, expected: csvRecordCounts.rankings })),
      db.select().from(schema.competitorScores).then(r => ({ table: 'competitor_scores', count: r.length, expected: csvRecordCounts.competitor_scores })),
      db.select().from(schema.jobs).then(r => ({ table: 'jobs', count: r.length, expected: csvRecordCounts.jobs })),
      db.select().from(schema.recommendations).then(r => ({ table: 'recommendations', count: r.length, expected: csvRecordCounts.recommendations })),
      db.select().from(schema.generatedContents).then(r => ({ table: 'generated_contents', count: r.length, expected: csvRecordCounts.generated_contents })),
      db.select().from(schema.xraySites).then(r => ({ table: 'xray_sites', count: r.length, expected: csvRecordCounts.xray_sites })),
      db.select().from(schema.xrayPages).then(r => ({ table: 'xray_pages', count: r.length, expected: csvRecordCounts.xray_pages })),
      db.select().from(schema.xrayPageStructure).then(r => ({ table: 'xray_page_structure', count: r.length, expected: csvRecordCounts.xray_page_structure })),
      db.select().from(schema.xrayPageAnalysis).then(r => ({ table: 'xray_page_analysis', count: r.length, expected: csvRecordCounts.xray_page_analysis })),
      db.select().from(schema.scoreFactors).then(r => ({ table: 'score_factors', count: r.length, expected: csvRecordCounts.score_factors })),
    ]);
    
    console.log('Row counts:');
    console.log('─────────────────────────────────────────');
    
    let totalCount = 0;
    let totalExpected = 0;
    let mismatches = 0;
    
    for (const { table, count, expected } of counts) {
      totalCount += count;
      totalExpected += expected;
      const status = count === expected ? '✓' : '✗';
      const padding = ' '.repeat(30 - table.length);
      console.log(`${status} ${table}${padding}${count.toLocaleString()} / ${expected.toLocaleString()}`);
      
      if (count !== expected) {
        mismatches++;
      }
    }
    
    console.log('─────────────────────────────────────────');
    console.log(`  Total${' '.repeat(24)}${totalCount.toLocaleString()} / ${totalExpected.toLocaleString()}`);
    console.log('');
    
    if (mismatches > 0) {
      console.log(`⚠️  Found ${mismatches} table(s) with row count mismatches\n`);
    } else {
      console.log('✓ All row counts match expected values\n');
    }
    
    console.log('✅ Validation complete!\n');
    
  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
    throw error;
  }
}

// Run the seeding
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
