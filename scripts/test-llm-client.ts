import { z } from 'zod';
import { getClient, generateJsonWithRepair } from '../server/llm/client';

const simpleSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  timestamp: z.number().optional(),
});

async function testLLMClient() {
  console.log('\n=== Testing LLM Client ===\n');

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    console.log('⏭️  Skipping: No API keys found (OPENAI_API_KEY or ANTHROPIC_API_KEY)');
    console.log('   This is expected in development without API keys configured.');
    return;
  }

  const providers: Array<'openai' | 'anthropic'> = [];
  if (hasOpenAI) providers.push('openai');
  if (hasAnthropic) providers.push('anthropic');

  for (const provider of providers) {
    try {
      console.log(`\n--- Testing ${provider.toUpperCase()} ---`);
      
      const client = await getClient(provider);
      console.log(`Provider: ${client.provider}`);
      console.log(`Model: ${client.model}`);

      const prompt = `Generate a simple JSON response with the following fields:
- ok: true
- message: "Test successful"
- timestamp: current unix timestamp in milliseconds

Return only the JSON object.`;

      const result = await generateJsonWithRepair(client, prompt, simpleSchema);

      console.log(`✅ Success!`);
      console.log(`   Latency: ${result.latencyMs}ms`);
      console.log(`   Tokens: ${result.tokensUsed || 'N/A'}`);
      console.log(`   Repair attempted: ${result.repairAttempted}`);
      console.log(`   Response:`, JSON.stringify(result.data, null, 2));

      if (!result.data.ok) {
        console.log('⚠️  Warning: Response ok field is false');
      }
    } catch (error) {
      console.error(`❌ ${provider.toUpperCase()} test failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log('\n=== Test Complete ===\n');
}

testLLMClient().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
