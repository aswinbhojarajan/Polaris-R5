import { db } from '../db';
import { prompts, promptCategories } from '@shared/schema';
import { classifyPrompt } from '../services/prompt-classifier';
import { eq, isNull } from 'drizzle-orm';

async function backfillPromptCategories() {
  console.log('Starting prompt category backfill...\n');
  
  try {
    const categories = await db.select().from(promptCategories);
    const categoryMap = new Map(categories.map(c => [c.slug, c.id]));
    
    console.log(`Found ${categories.length} categories in database`);
    
    const uncategorizedPrompts = await db.select()
      .from(prompts)
      .where(isNull(prompts.categoryId));
    
    console.log(`Found ${uncategorizedPrompts.length} prompts to classify\n`);
    
    if (uncategorizedPrompts.length === 0) {
      console.log('✅ All prompts already categorized!');
      process.exit(0);
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < uncategorizedPrompts.length; i++) {
      const prompt = uncategorizedPrompts[i];
      const progress = `[${i + 1}/${uncategorizedPrompts.length}]`;
      
      try {
        console.log(`${progress} Classifying: "${prompt.text.substring(0, 60)}..."`);
        
        const classification = await classifyPrompt(prompt.text);
        const categoryId = categoryMap.get(classification.category);
        
        if (!categoryId) {
          console.error(`  ❌ Category not found: ${classification.category}`);
          errorCount++;
          continue;
        }
        
        await db.update(prompts)
          .set({ categoryId })
          .where(eq(prompts.id, prompt.id));
        
        console.log(`  ✓ Classified as: ${classification.category} (confidence: ${classification.confidence.toFixed(2)})`);
        successCount++;
        
        if ((i + 1) % 50 === 0) {
          console.log(`\n📊 Progress: ${i + 1}/${uncategorizedPrompts.length} (${Math.round((i + 1) / uncategorizedPrompts.length * 100)}%) - Success: ${successCount}, Errors: ${errorCount}\n`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`  ❌ Error classifying prompt:`, error);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Backfill completed!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Total: ${uncategorizedPrompts.length}`);
    console.log('='.repeat(50));
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Fatal error during backfill:', error);
    process.exit(1);
  }
}

backfillPromptCategories();
