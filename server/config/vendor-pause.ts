import { storage } from "../storage";

const TTL_MS = 30_000;

let cache: Set<string> | null = null;
let lastLoadedAt = 0;
let cacheGeneration = 0;
let inflightLoad: Promise<void> | null = null;

const SKIP_DB = process.env.NODE_ENV === "test" || process.env.SESSION_STORE === "memory";

async function loadFromDb(): Promise<void> {
  if (SKIP_DB) {
    cache = new Set<string>();
    lastLoadedAt = Date.now();
    return;
  }
  const startGen = ++cacheGeneration;
  try {
    const rows = await storage.getAiVendorStatuses();
    if (startGen !== cacheGeneration) return;
    cache = new Set(rows.filter((r) => r.paused).map((r) => r.vendor.toLowerCase()));
    lastLoadedAt = Date.now();
  } catch (err) {
    console.error("[VendorPause] Failed to load vendor pause cache:", err);
    if (startGen !== cacheGeneration) return;
    cache = cache ?? new Set<string>();
    lastLoadedAt = Date.now();
  }
}

function maybeRefresh(): void {
  if (cache === null) return;
  if (Date.now() - lastLoadedAt < TTL_MS) return;
  if (inflightLoad) return;
  const tracked = loadFromDb().finally(() => {
    if (inflightLoad === tracked) inflightLoad = null;
  });
  inflightLoad = tracked;
}

export async function ensureVendorPauseLoaded(): Promise<void> {
  if (cache !== null && Date.now() - lastLoadedAt < TTL_MS) return;
  if (inflightLoad) {
    await inflightLoad;
    return;
  }
  const tracked = loadFromDb().finally(() => {
    if (inflightLoad === tracked) inflightLoad = null;
  });
  inflightLoad = tracked;
  await tracked;
}

// Force-reload the cache from the database. Used by the admin
// pause/unpause endpoint so the new state is observable on the very
// next request without waiting for the 30 s TTL.
//
// IMPORTANT: this MUST NOT null out `cache`. A null cache makes
// `isVendorPaused()` fail open (returns `false`) because `maybeRefresh`
// has no warm value to anchor to and the sync call cannot await a
// fresh load. Keeping the prior `cache` in place while we re-fetch
// guarantees no bypass window between an admin pause click and the
// next call to `assertVendorNotPaused`. Callers MUST `await` this.
export async function invalidateVendorPauseCache(): Promise<void> {
  cacheGeneration++;
  inflightLoad = null;
  lastLoadedAt = 0; // ensures next ensureVendorPauseLoaded() does a real fetch
  await ensureVendorPauseLoaded();
}

export function isVendorPaused(vendor: string): boolean {
  maybeRefresh();
  if (cache === null) return false;
  return cache.has(vendor.toLowerCase());
}

// Custom error so callers (executor, job queue, route handlers) can
// distinguish a deliberate kill-switch refusal from an upstream SDK
// failure when surfacing it to the user.
export class VendorPausedError extends Error {
  readonly statusCode = 503;
  readonly vendor: string;
  constructor(vendor: string) {
    super(`Vendor "${vendor}" is paused by an admin.`);
    this.name = 'VendorPausedError';
    this.vendor = vendor;
  }
}

// Synchronous guard used at every internal LLM SDK call site that
// bypasses `executePrompt` (narrative generator, competitor discovery,
// X-Ray analyzer, prompt classifier, content recommendation analyzer,
// LLM client wrappers). Relies on the cache; callers running in async
// context should `await ensureVendorPauseLoaded()` first if they cannot
// tolerate a cold-cache window. The admin pause endpoint invalidates
// the cache so a freshly-paused vendor takes effect on the very next
// SDK construction.
export function assertVendorNotPaused(vendor: string): void {
  if (isVendorPaused(vendor)) {
    throw new VendorPausedError(vendor);
  }
}
