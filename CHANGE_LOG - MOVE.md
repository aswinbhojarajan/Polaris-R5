# Change Log - Fork to Main Merge Tracking

This document tracks all changes made in this forked instance for easy merging back to the main application.

---

## Change Categories

### 1. CRITICAL FIXES (Must Merge)
Changes that fix bugs affecting core functionality.

### 2. NEW FEATURES (Should Merge)
New functionality that enhances the application.

### 3. DOCUMENTATION ONLY (Optional Merge)
Documentation updates that don't affect code.

---

## Completed Changes

### Fix: Neon HTTP Driver ESM Bug
**Category**: CRITICAL FIX  
**Date**: February 2, 2026  
**Status**: Completed & Tested

#### Problem
The Neon HTTP driver (`drizzle-orm/neon-http`) has ESM compatibility bugs:
1. INSERT/UPDATE with `.returning()` returned empty results
2. Complex SELECT queries with `and()` + `ilike()` crashed

#### Solution
Switched from HTTP driver to WebSocket pool driver.

#### Files Changed

| File | Lines | Change Description |
|------|-------|-------------------|
| `server/db.ts` | 1-32 (entire file) | Replaced HTTP driver with WebSocket pool driver |
| `server/db-storage.ts` | 2 | Added `ne`, `ilike` imports |
| `server/db-storage.ts` | 67-81 | Restored proper ILIKE query in `findClientByProjectName` |
| `package.json` | (dependencies) | Added `ws` and `@types/ws` packages |
| `replit.md` | 17-20, 59-76 | Updated documentation |

#### Code Snippets for Manual Merge

**server/db.ts** (REPLACE ENTIRE FILE):
```typescript
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from '@shared/schema';
import ws from 'ws';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

import { neonConfig } from '@neondatabase/serverless';
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle({ client: pool, schema });

console.log('[Database] WebSocket pool initialized (max 10 connections)');
console.log('[Database] Using drizzle-orm/neon-serverless driver');
console.log('[Database] Job concurrency: Max 3 concurrent jobs (configured in JobQueue)');
```

**package.json** (ADD TO DEPENDENCIES):
```json
"ws": "^8.x.x",
"@types/ws": "^8.x.x"
```

---

### Feature: Custom Industry/Geography Options
**Category**: NEW FEATURE  
**Date**: February 2, 2026  
**Status**: Completed

#### Description
Allows users to add one custom option each for Industry and Geography dropdowns when the predefined options don't fit their needs. Custom options can be edited and deleted.

#### Files Changed

| File | Lines | Change Description |
|------|-------|-------------------|
| `shared/schema.ts` | 60-61 | Added `customIndustry` and `customGeography` text fields to clients table |
| `client/src/lib/industry-geography-options.ts` | NEW FILE | Shared constants for INDUSTRIES (43 options) and GEOGRAPHIES (22 options), plus helper functions |
| `client/src/components/create-client-wizard.tsx` | 67 | Added import for shared options and Pencil icon |
| `client/src/components/create-client-wizard.tsx` | 113-181 (REMOVED) | Removed local INDUSTRIES and GEOGRAPHIES constants |
| `client/src/components/create-client-wizard.tsx` | 151-159 | Added custom industry/geography state variables (8 new useState hooks) |
| `client/src/components/create-client-wizard.tsx` | 499-581 | Added reset logic for custom fields and handler functions for add/edit/delete |
| `client/src/components/create-client-wizard.tsx` | 466-472 | Updated save mutation to include customIndustry and customGeography |
| `client/src/components/create-client-wizard.tsx` | 1039-1127 | Updated Industry dropdown with custom option UI (add/edit/delete, inline input) |
| `client/src/components/create-client-wizard.tsx` | 1197-1270 | Updated Geography popover with custom region section |
| `client/src/pages/client-configuration.tsx` | 21-23 | Added imports for shared options, Pencil icon, normalizeCustomValue |
| `client/src/pages/client-configuration.tsx` | 86-94 | Added custom industry/geography state variables (8 new useState hooks) |
| `client/src/pages/client-configuration.tsx` | 280-286 | Added loading of customIndustry/customGeography from client data |
| `client/src/pages/client-configuration.tsx` | 320-321 | Updated save mutation to include customIndustry and customGeography |
| `client/src/pages/client-configuration.tsx` | 444-449 (REMOVED) | Removed local GEOGRAPHIES constant |
| `client/src/pages/client-configuration.tsx` | 478-548 | Added handler functions for custom industry/geography (add/edit/delete) |
| `client/src/pages/client-configuration.tsx` | 694-787 | Replaced hardcoded industry SelectItems with dynamic INDUSTRIES + custom option UI |
| `client/src/pages/client-configuration.tsx` | 963-1040 | Updated Geography popover with custom region section |
| `server/utils/industry-geography-helpers.ts` | NEW FILE | Server-side normalization helpers for industry/geography values |

#### Database Migration Required
Run `npm run db:push` to add the new columns:
- `clients.custom_industry` (text, nullable)
- `clients.custom_geography` (text, nullable)

#### Key Implementation Details

1. **Per-client custom options**: Each client can have one custom industry and one custom geography stored in the database
2. **Max 1 custom per dropdown**: Only one custom option allowed per dropdown type
3. **Edit/Delete support**: Custom values can be edited inline or deleted
4. **Backward compatible**: All AI services continue to work with custom values (they just use `client.industry` and `client.geography` as strings)
5. **Normalization**: Custom values are trimmed and limited to 100 characters

#### Code Snippets for Manual Merge

**shared/schema.ts** (ADD after line 56):
```typescript
customIndustry: text("custom_industry"),
customGeography: text("custom_geography"),
```

**client/src/lib/industry-geography-options.ts** (NEW FILE):
```typescript
export const INDUSTRIES = [
  "Accounting", "Advertising & Marketing", "Aerospace & Defense",
  // ... (43 industries total)
  "Other",
];

export const GEOGRAPHIES = [
  "Global", "Africa", "Asia", "Europe", "North America",
  // ... (22 regions total)
  "Worldwide",
];

export function isCustomIndustry(value: string): boolean {
  return value.length > 0 && !INDUSTRIES.includes(value);
}

export function isCustomGeography(value: string): boolean {
  return value.length > 0 && !GEOGRAPHIES.includes(value);
}

export function normalizeCustomValue(value: string): string {
  return value.trim().slice(0, 100);
}
```

**server/utils/industry-geography-helpers.ts** (NEW FILE):
```typescript
export function normalizeIndustry(industry: string | null | undefined): string | undefined {
  if (!industry) return undefined;
  return industry.trim().slice(0, 100);
}

export function normalizeGeographies(geography: string | string[] | null | undefined): string[] {
  if (!geography) return [];
  const arr = typeof geography === 'string' 
    ? geography.split(',').map(g => g.trim()) 
    : geography;
  return Array.from(new Set(arr))
    .filter(g => g.length > 0)
    .slice(0, 3)
    .map(g => g.slice(0, 100));
}

export function formatGeographyForPrompt(geographies: string[]): string {
  if (geographies.length === 0) return '';
  if (geographies.length === 1) return geographies[0];
  return geographies.join('/');
}
```

---

## How to Merge Changes

1. **For Critical Fixes**: Apply changes to the exact file paths listed
2. **For New Features**: 
   - Run database migration first: `npm run db:push`
   - Copy new files
   - Apply edits to existing files
3. **Test After Merge**: 
   - Client creation wizard (all steps including custom industry/geography)
   - Client configuration page (edit custom values)
   - Prompt run creation (verify AI uses custom values)
4. **Verify Database Operations**: Ensure `.returning()` works correctly

---
