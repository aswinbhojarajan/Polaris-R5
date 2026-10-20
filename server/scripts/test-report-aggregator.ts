import { db } from '../db';
import { clients, promptRuns } from '@shared/schema';
import { ReportAggregator } from '../services/report-aggregator';
import { desc, eq } from 'drizzle-orm';

async function testReportAggregator() {
  console.log('Testing ReportAggregator with new category system...\n');

  try {
    const [client] = await db.select().from(clients).limit(1);
    if (!client) {
      console.error('❌ No clients found in database');
      process.exit(1);
    }

    const runs = await db.select()
      .from(promptRuns)
      .where(eq(promptRuns.clientId, client.id))
      .orderBy(desc(promptRuns.createdAt))
      .limit(3);

    if (runs.length === 0) {
      console.error('❌ No prompt runs found for client');
      process.exit(1);
    }

    console.log(`✓ Testing with client: ${client.name}`);
    console.log(`✓ Using ${runs.length} prompt runs\n`);

    const aggregator = new ReportAggregator(client.id, runs.map(r => r.id));

    console.log('1️⃣ Testing getPromptLibrary()...');
    const library = await aggregator.getPromptLibrary();
    console.log(`   Found ${library.length} prompts`);
    if (library.length > 0) {
      const samplePrompt = library[0];
      console.log(`   Sample: "${samplePrompt.text.substring(0, 50)}..."`);
      console.log(`   Category: ${samplePrompt.category}\n`);
    }

    console.log('2️⃣ Testing getPromptCategories()...');
    const promptIds = library.map(p => p.id);
    const categories = await aggregator.getPromptCategories(promptIds);
    console.log(`   Found ${categories.length} unique categories:`);
    categories.forEach(cat => console.log(`   - ${cat}`));
    console.log('');

    console.log('3️⃣ Testing getPromptsInCategory()...');
    for (const category of categories.slice(0, 3)) {
      const promptsInCategory = await aggregator.getPromptsInCategory(promptIds, category);
      console.log(`   ${category}: ${promptsInCategory.length} prompts`);
    }

    console.log('\n✅ All tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testReportAggregator();
