import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../shared/schema';
import { eq, isNull } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function backfillProjectNames() {
  console.log('Starting project name backfill...');
  
  const clientsWithoutProjectName = await db
    .select()
    .from(schema.clients)
    .where(isNull(schema.clients.projectName));
  
  console.log(`Found ${clientsWithoutProjectName.length} clients without project names`);
  
  for (const client of clientsWithoutProjectName) {
    const projectName = `${client.name} - Main Project`;
    
    await db
      .update(schema.clients)
      .set({ projectName })
      .where(eq(schema.clients.id, client.id));
    
    console.log(`✓ Updated client ${client.id}: "${client.name}" → "${projectName}"`);
  }
  
  console.log('\nBackfill complete!');
  console.log(`Total clients updated: ${clientsWithoutProjectName.length}`);
  
  const allClients = await db.select().from(schema.clients);
  const clientsWithProjectName = allClients.filter(c => c.projectName);
  
  console.log(`\nVerification:`);
  console.log(`Total clients: ${allClients.length}`);
  console.log(`Clients with project names: ${clientsWithProjectName.length}`);
  console.log(`Clients without project names: ${allClients.length - clientsWithProjectName.length}`);
  
  if (clientsWithProjectName.length === allClients.length) {
    console.log('\n✅ All clients have project names!');
  } else {
    console.log('\n⚠️ Some clients still missing project names');
  }
}

backfillProjectNames()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error during backfill:', error);
    process.exit(1);
  });
