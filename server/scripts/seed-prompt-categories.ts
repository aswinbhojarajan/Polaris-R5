import { db } from '../db';
import { promptCategories } from '@shared/schema';
import { sql } from 'drizzle-orm';

const PROMPT_CATEGORIES = [
  {
    name: "Unbranded Discovery",
    slug: "unbranded_discovery",
    description: "Generic queries with no brand mentions - tests if AI recommends you organically"
  },
  {
    name: "Branded Queries",
    slug: "branded_queries",
    description: "Queries explicitly mentioning your brand - tests how AI responds when you're named"
  },
  {
    name: "Competitive Comparison",
    slug: "competitive_comparison",
    description: "Direct competitor comparisons - tests your positioning vs rivals"
  },
  {
    name: "Competitor Mention",
    slug: "competitor_mention",
    description: "Queries mentioning competitors but not you - tests if AI suggests you as alternative"
  },
  {
    name: "Location-Based",
    slug: "location_based",
    description: "Geo-targeted queries - tests local/regional visibility"
  },
  {
    name: "Use Case Specific",
    slug: "use_case_specific",
    description: "Queries about specific needs, budgets, or categories"
  },
  {
    name: "Hyper-Specific Queries",
    slug: "hyper_specific",
    description: "Queries with multiple precise constraints - location, time, specs, and conditions"
  }
];

async function seedPromptCategories() {
  console.log('Seeding prompt categories...');
  
  try {
    for (const category of PROMPT_CATEGORIES) {
      const existing = await db.select()
        .from(promptCategories)
        .where(sql`${promptCategories.slug} = ${category.slug}`)
        .limit(1);
      
      if (existing.length === 0) {
        await db.insert(promptCategories).values(category);
        console.log(`✓ Created category: ${category.name}`);
      } else {
        console.log(`- Category already exists: ${category.name}`);
      }
    }
    
    console.log('\n✅ Prompt categories seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding prompt categories:', error);
    process.exit(1);
  }
}

seedPromptCategories();
