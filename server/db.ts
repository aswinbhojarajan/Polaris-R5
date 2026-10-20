import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from '@shared/schema';
import ws from 'ws';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// IMPORTANT: WebSocket polyfill required for Node.js environment
// Neon WebSocket driver needs this for server-side usage
import { neonConfig } from '@neondatabase/serverless';
neonConfig.webSocketConstructor = ws;

// Connection pool configuration
// WebSocket-based pool provides better reliability than HTTP driver
// and properly supports .returning() on INSERT/UPDATE operations
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  // Pool configuration for serverless environment
  max: 10,              // Maximum connections in pool
  idleTimeoutMillis: 30000,  // Close idle connections after 30s
  connectionTimeoutMillis: 10000,  // Timeout for new connections
});

// Initialize Drizzle ORM with WebSocket pool
export const db = drizzle({ client: pool, schema });

/**
 * Lightweight database connectivity check used by the /health endpoint.
 * Issues a trivial `SELECT 1` and returns true on success, false otherwise.
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1 AS ok');
    return result.rows?.[0]?.ok === 1;
  } catch (err) {
    console.error('[Database] Health ping failed:', err);
    return false;
  }
}

// Log database configuration for monitoring
console.log('[Database] WebSocket pool initialized (max 10 connections)');
console.log('[Database] Using drizzle-orm/neon-serverless driver');
console.log('[Database] Job concurrency: Max 3 concurrent jobs (configured in JobQueue)');
