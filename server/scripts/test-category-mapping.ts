import { db } from '../db';
import { promptCategories } from '@shared/schema';
import { classifyPrompt } from '../services/prompt-classifier';

async function testCategoryMapping() {
  console.log('Testing category mapping...\n');
  
  // Get all categories from database
  const categories = await db.select().from(promptCategories);
  console.log('Database categories:');
  categories.forEach(c => {
    console.log(`  - ID: ${c.id}, Name: ${c.name}, Slug: ${c.slug}`);
  });
  
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));
  console.log(`\nCategory map has ${categoryMap.size} entries`);
  
  // Test classification
  const testPrompt = "What are the best project management tools?";
  console.log(`\nClassifying test prompt: "${testPrompt}"`);
  
  const classification = await classifyPrompt(testPrompt);
  console.log(`Classifier returned:`);
  console.log(`  - Category: ${classification.category}`);
  console.log(`  - Confidence: ${classification.confidence}`);
  
  const categoryId = categoryMap.get(classification.category);
  console.log(`\nMapping lookup:`);
  console.log(`  - Looking up slug: "${classification.category}"`);
  console.log(`  - Found categoryId: ${categoryId || 'NOT FOUND'}`);
  
  if (categoryId) {
    const category = categories.find(c => c.id === categoryId);
    console.log(`  - Category name: ${category?.name}`);
  }
  
  process.exit(0);
}

testCategoryMapping();
