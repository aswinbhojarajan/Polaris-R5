import { db } from './db';
import { organizations, aiModels, auditLog, scoreColorBands, scoreInterpretations, users, userOrgMemberships } from '@shared/schema';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { hashPassword } from './auth';
import { stampProjectOwners } from './scripts/stamp-project-owners';

/**
 * Models flagged "core" in the UI — surfaced as the default selection in the
 * client wizard and in the configuration screen accordion. Everything else
 * present in `ai_models` is shown under "Additional".
 */
export const CORE_MODEL_IDS = [
  // Final validated catalog policy: exactly one current flagship model from
  // each generation vendor belongs in Core. Every other selectable model is
  // Additional.
  'gpt-5.6-terra',
  'claude-sonnet-5',
  'gemini-3.7-flash',
] as const;

/**
 * Models still awaiting validation. The current candidate cohort completed
 * real-path validation, so fresh databases should no longer hide or disable
 * them. Add future unvalidated rows here until their test window is complete.
 */
export const CANDIDATE_MODEL_IDS = [] as const;

/**
 * Models that have been deprecated and should be disabled on boot. Existing
 * runs that referenced these IDs are preserved for historical accuracy.
 */
export const DEPRECATED_MODEL_IDS = [
  'claude-3-5-haiku-20241022',
  'gemini-1.5-pro',
] as const;

interface ModelSeed {
  vendor: string;
  model: string;
  displayName: string;
  maxTpm: number;
  maxRpm: number;
  costPer1kInput: string;
  costPer1kOutput: string;
}

const MODEL_CATALOG: ModelSeed[] = [
  { vendor: 'OpenAI',     model: 'gpt-5.4',                  displayName: 'GPT-5.4',            maxTpm: 200000, maxRpm: 10000, costPer1kInput: '2.50',  costPer1kOutput: '10.00' },
  { vendor: 'OpenAI',     model: 'gpt-5.4-mini',             displayName: 'GPT-5.4 Mini',       maxTpm: 200000, maxRpm: 10000, costPer1kInput: '0.25',  costPer1kOutput: '1.00'  },
  { vendor: 'OpenAI',     model: 'gpt-5.4-nano',             displayName: 'GPT-5.4 Nano',       maxTpm: 200000, maxRpm: 10000, costPer1kInput: '0.05',  costPer1kOutput: '0.20'  },
  { vendor: 'OpenAI',     model: 'gpt-5.2',                  displayName: 'GPT-5.2',            maxTpm: 100000, maxRpm: 8000,  costPer1kInput: '3.00',  costPer1kOutput: '12.00' },
  { vendor: 'OpenAI',     model: 'gpt-4.1',                  displayName: 'GPT-4.1',            maxTpm: 40000,  maxRpm: 5000,  costPer1kInput: '0.60',  costPer1kOutput: '1.20'  },
  { vendor: 'Anthropic',  model: 'claude-sonnet-4-5',        displayName: 'Claude Sonnet 4.5',  maxTpm: 40000,  maxRpm: 5000,  costPer1kInput: '0.003', costPer1kOutput: '0.015' },
  { vendor: 'Anthropic',  model: 'claude-opus-4-1',          displayName: 'Claude Opus 4.1',    maxTpm: 10000,  maxRpm: 4000,  costPer1kInput: '0.015', costPer1kOutput: '0.075' },
  { vendor: 'Google',     model: 'gemini-2.5-pro',           displayName: 'Gemini 2.5 Pro',     maxTpm: 60000,  maxRpm: 10000, costPer1kInput: '0.35',  costPer1kOutput: '1.05'  },
  { vendor: 'Google',     model: 'gemini-2.5-flash',         displayName: 'Gemini 2.5 Flash',   maxTpm: 100000, maxRpm: 10000, costPer1kInput: '0.075', costPer1kOutput: '0.30'  },
  { vendor: 'Google',     model: 'gemini-2.5-flash-lite',    displayName: 'Gemini 2.5 Flash-Lite', maxTpm: 100000, maxRpm: 10000, costPer1kInput: '0.04', costPer1kOutput: '0.15' },
  { vendor: 'Perplexity', model: 'sonar-pro',                displayName: 'Sonar Pro',          maxTpm: 50000,  maxRpm: 5000,  costPer1kInput: '0.10',  costPer1kOutput: '0.30'  },
  // Task #25 — new candidate rows. Seeded disabled (see CANDIDATE_MODEL_IDS);
  // pricing/limits mirror the current provider tier of each family and can be
  // tuned by admins without being clobbered on boot.
  { vendor: 'OpenAI',     model: 'gpt-5.6-terra',            displayName: 'GPT-5.6 Terra',      maxTpm: 200000, maxRpm: 10000, costPer1kInput: '2.50',  costPer1kOutput: '10.00' },
  { vendor: 'OpenAI',     model: 'gpt-5.6-luna',             displayName: 'GPT-5.6 Luna',       maxTpm: 200000, maxRpm: 10000, costPer1kInput: '0.25',  costPer1kOutput: '1.00'  },
  { vendor: 'Anthropic',  model: 'claude-sonnet-5',          displayName: 'Claude Sonnet 5',    maxTpm: 40000,  maxRpm: 5000,  costPer1kInput: '0.003', costPer1kOutput: '0.015' },
  { vendor: 'Anthropic',  model: 'claude-opus-5',            displayName: 'Claude Opus 5',      maxTpm: 10000,  maxRpm: 4000,  costPer1kInput: '0.015', costPer1kOutput: '0.075' },
  { vendor: 'Google',     model: 'gemini-3.7-flash',         displayName: 'Gemini 3.7 Flash',   maxTpm: 100000, maxRpm: 10000, costPer1kInput: '0.075', costPer1kOutput: '0.30'  },
  { vendor: 'Google',     model: 'gemini-3.5-flash-lite',    displayName: 'Gemini 3.5 Flash-Lite', maxTpm: 100000, maxRpm: 10000, costPer1kInput: '0.04', costPer1kOutput: '0.15' },
  // Deprecated rows are seeded so historical run references resolve even on a
  // fresh DB. They are inserted as `enabled = false` and disableDeprecatedModels()
  // keeps them disabled on every boot.
  { vendor: 'Anthropic',  model: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku (deprecated)', maxTpm: 40000, maxRpm: 5000,  costPer1kInput: '0.001', costPer1kOutput: '0.005' },
  { vendor: 'Google',     model: 'gemini-1.5-pro',            displayName: 'Gemini 1.5 Pro (deprecated)',   maxTpm: 60000, maxRpm: 10000, costPer1kInput: '0.35',  costPer1kOutput: '1.05'  },
];

const DEPRECATED_SET = new Set<string>(DEPRECATED_MODEL_IDS as readonly string[]);
const CANDIDATE_SET = new Set<string>(CANDIDATE_MODEL_IDS as readonly string[]);
export const VALIDATED_CATALOG_CUTOVER_MARKER = 'validated-model-catalog-2026-08-20';

const VALIDATED_CATALOG_MODEL_IDS = [
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.4',
  'gpt-5.2',
  'gpt-4.1',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-sonnet-4-5',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;

function categoryFor(modelId: string): 'core' | 'additional' {
  return (CORE_MODEL_IDS as readonly string[]).includes(modelId) ? 'core' : 'additional';
}

/**
 * Historical backfill of `category` on existing rows. As of Task #39 admins
 * can flip Core/Additional from the UI, so this sweep is no longer called on
 * every boot — running it would silently revert admin choices. New rows
 * inserted via `upsertMissingModels()` still pick up their initial category
 * from `CORE_MODEL_IDS` via `categoryFor()`. Kept as an exported helper for
 * one-shot CLI use if a future migration ever needs to rebuild categories
 * from scratch.
 */
export async function syncModelCategories() {
  const rows = await db.select().from(aiModels);
  let updated = 0;
  for (const row of rows) {
    const desired = categoryFor(row.model);
    if (row.category !== desired) {
      await db.update(aiModels).set({ category: desired }).where(eq(aiModels.id, row.id));
      updated++;
    }
  }
  if (updated > 0) console.log(`✓ Synced model categories (${updated} updated)`);
}

/**
 * Insert any models from MODEL_CATALOG that don't already exist (matched by
 * `model` column). Existing rows are left untouched so user-tuned TPM/RPM/
 * pricing isn't clobbered on every boot.
 */
async function upsertMissingModels() {
  const existing = await db.select().from(aiModels);
  const existingIds = new Set(existing.map((m) => m.model));
  const missing = MODEL_CATALOG.filter((m) => !existingIds.has(m.model));
  if (missing.length === 0) return;
  await db.insert(aiModels).values(
    missing.map((m) => ({
      ...m,
      enabled: !DEPRECATED_SET.has(m.model) && !CANDIDATE_SET.has(m.model),
      // Task #29 — candidates seed as internal-only so a later enablement
      // for a validation window never exposes them to normal users.
      internalOnly: CANDIDATE_SET.has(m.model),
      category: categoryFor(m.model),
    })),
  );
  console.log(`✓ Inserted ${missing.length} missing model(s): ${missing.map((m) => m.model).join(', ')}`);
}

/**
 * Applies the owner-approved catalog cutover exactly once per database.
 *
 * Existing deployments intentionally do not replay migration SQL files and
 * normal seeding does not overwrite administrator choices. The durable audit
 * marker makes this release cutover run once after Publish applies the schema
 * diff, while preserving any later admin changes on subsequent restarts.
 */
export async function applyValidatedModelCatalogCutover(): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Prevent two application instances starting together from both applying
    // the cutover before either has written the marker.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${VALIDATED_CATALOG_CUTOVER_MARKER}))`);

    const existing = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(
        eq(auditLog.action, 'system.ai_model_catalog.cutover'),
        eq(auditLog.targetId, VALIDATED_CATALOG_CUTOVER_MARKER),
      ))
      .limit(1);
    if (existing.length > 0) return false;

    await tx
      .update(aiModels)
      .set({
        enabled: true,
        internalOnly: false,
        disabledAt: null,
        disabledByUserId: null,
        disabledReason: null,
      })
      .where(inArray(aiModels.model, [...VALIDATED_CATALOG_MODEL_IDS]));

    await tx
      .update(aiModels)
      .set({ category: 'core' })
      .where(inArray(aiModels.model, [...CORE_MODEL_IDS]));

    await tx
      .update(aiModels)
      .set({ category: 'additional' })
      .where(notInArray(aiModels.model, [...CORE_MODEL_IDS]));

    await tx.insert(auditLog).values({
      action: 'system.ai_model_catalog.cutover',
      targetType: 'ai_model_catalog',
      targetId: VALIDATED_CATALOG_CUTOVER_MARKER,
      metadata: {
        releasedModels: VALIDATED_CATALOG_MODEL_IDS,
        coreModels: CORE_MODEL_IDS,
      },
    });

    return true;
  });
}

/**
 * Disable any deprecated models in-place. We don't delete rows so that
 * historical runs that reference them continue to render correctly.
 *
 * As of Task #67 admins can flip `enabled` from the UI, so this sweep is no
 * longer called on every boot — running it would silently revert admin
 * choices (e.g. an admin re-enabling a model that's still in `DEPRECATED_MODEL_IDS`
 * for historical reasons). New rows inserted via `upsertMissingModels()`
 * still pick up `enabled = !DEPRECATED_SET.has(...)` for their initial value.
 * Kept as an exported helper for one-shot CLI use if a future migration ever
 * needs to bulk-disable a vendor-deprecated model again.
 */
export async function disableDeprecatedModels() {
  if (DEPRECATED_MODEL_IDS.length === 0) return;
  const rows = await db
    .select()
    .from(aiModels)
    .where(inArray(aiModels.model, DEPRECATED_MODEL_IDS as unknown as string[]));
  const stillEnabled = rows.filter((r) => r.enabled);
  if (stillEnabled.length === 0) return;
  await db
    .update(aiModels)
    .set({ enabled: false })
    .where(inArray(aiModels.model, stillEnabled.map((r) => r.model)));
  console.log(`✓ Disabled ${stillEnabled.length} deprecated ai_model row(s): ${stillEnabled.map((r) => r.model).join(', ')}`);
}

export async function seedDatabase() {
  try {
    // Seed default organization
    const existingOrg = await db.select().from(organizations).where(eq(organizations.id, 'default-org'));
    
    if (existingOrg.length === 0) {
      await db.insert(organizations).values({
        id: 'default-org',
        name: 'Default Organization',
      });
      console.log('✓ Seeded default organization');
    }

    // Seed default admin user (configurable via env vars)
    const defaultAdminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@polaris.local').toLowerCase().trim();
    const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD;
    const existingAdmin = await db.select().from(users).where(eq(users.email, defaultAdminEmail));
    if (existingAdmin.length === 0) {
      if (!defaultAdminPassword) {
        throw new Error('Set DEFAULT_ADMIN_PASSWORD in Replit Secrets before creating the bootstrap admin.');
      }
      const passwordHash = await hashPassword(defaultAdminPassword);
      const [admin] = await db.insert(users).values({
        email: defaultAdminEmail,
        passwordHash,
        displayName: 'Default Admin',
      }).returning();
      await db.insert(userOrgMemberships).values({
        userId: admin.id,
        orgId: 'default-org',
        role: 'admin',
      });
      console.log(`✓ Seeded default admin user: ${defaultAdminEmail}`);
    } else {
      // Make sure existing admin still has a membership in default-org.
      const membership = await db.select().from(userOrgMemberships)
        .where(eq(userOrgMemberships.userId, existingAdmin[0].id));
      const hasDefaultOrg = membership.some(m => m.orgId === 'default-org');
      if (!hasDefaultOrg) {
        await db.insert(userOrgMemberships).values({
          userId: existingAdmin[0].id,
          orgId: 'default-org',
          role: 'admin',
        });
      }
    }

    // Seed one sample user per role in default-org so each role can be
    // exercised without going through the invitation flow. New sample users
    // require SAMPLE_USER_PASSWORD in Secrets. Only inserts users that don't
    // already exist, and only attaches the membership if missing.
    const sampleUsers: Array<{
      email: string;
      displayName: string;
      role: 'admin' | 'member' | 'viewer';
    }> = [
      { email: 'adminuser@polaris.local', displayName: 'Sample Admin',  role: 'admin'  },
      { email: 'member@polaris.local',    displayName: 'Sample Member', role: 'member' },
      { email: 'viewer@polaris.local',    displayName: 'Sample Viewer', role: 'viewer' },
    ];
    const samplePassword = process.env.SAMPLE_USER_PASSWORD;
    const samplePasswordHash = samplePassword ? await hashPassword(samplePassword) : undefined;
    for (const u of sampleUsers) {
      // Skip the bootstrap admin row (already seeded above).
      if (u.email === defaultAdminEmail) continue;
      const existing = await db.select().from(users).where(eq(users.email, u.email));
      let userId: string;
      if (existing.length === 0) {
        if (!samplePasswordHash) {
          console.log(`Skipped sample account ${u.email}: SAMPLE_USER_PASSWORD is not configured.`);
          continue;
        }
        const [created] = await db.insert(users).values({
          email: u.email,
          passwordHash: samplePasswordHash,
          displayName: u.displayName,
        }).returning();
        userId = created.id;
        console.log(`✓ Seeded sample ${u.role}: ${u.email}`);
      } else {
        userId = existing[0].id;
      }
      const existingMembership = await db.select().from(userOrgMemberships)
        .where(eq(userOrgMemberships.userId, userId));
      const hasDefaultOrg = existingMembership.some(m => m.orgId === 'default-org');
      if (!hasDefaultOrg) {
        await db.insert(userOrgMemberships).values({
          userId,
          orgId: 'default-org',
          role: u.role,
        });
      }
    }

    // Seed / sync AI models — idempotent: insert only missing rows, disable
    // deprecated IDs in place. Note: `syncModelCategories()` is intentionally
    // NOT called here (Task #39) so admin-set Core/Additional choices are not
    // reverted on every boot. New rows still get their initial category from
    // `CORE_MODEL_IDS` via `upsertMissingModels()` → `categoryFor()`.
    await upsertMissingModels();
    const catalogCutoverApplied = await applyValidatedModelCatalogCutover();
    if (catalogCutoverApplied) {
      console.log('✓ Applied validated AI model catalog cutover');
    }
    // Note: `disableDeprecatedModels()` is intentionally NOT called here
    // (Task #67) so admin-set Enabled choices are not reverted on every
    // boot. New rows still get their initial `enabled` flag from
    // `DEPRECATED_SET` via `upsertMissingModels()`.

    const existingColorBands = await db.select().from(scoreColorBands);
    if (existingColorBands.length === 0) {
      await db.insert(scoreColorBands).values([
        { category: "Visibility", bandName: "Red", colorHex: "#EF4444", scoreMin: "0.00", scoreMax: "30.01" },
        { category: "Visibility", bandName: "Amber", colorHex: "#F59E0B", scoreMin: "30.01", scoreMax: "70.01" },
        { category: "Visibility", bandName: "Green", colorHex: "#10B981", scoreMin: "70.01", scoreMax: "100.01" },
        { category: "Sentiment", bandName: "Red", colorHex: "#EF4444", scoreMin: "0.00", scoreMax: "30.01" },
        { category: "Sentiment", bandName: "Amber", colorHex: "#F59E0B", scoreMin: "30.01", scoreMax: "70.01" },
        { category: "Sentiment", bandName: "Green", colorHex: "#10B981", scoreMin: "70.01", scoreMax: "100.01" },
        { category: "Position", bandName: "Red", colorHex: "#EF4444", scoreMin: "0.00", scoreMax: "30.01" },
        { category: "Position", bandName: "Amber", colorHex: "#F59E0B", scoreMin: "30.01", scoreMax: "70.01" },
        { category: "Position", bandName: "Green", colorHex: "#10B981", scoreMin: "70.01", scoreMax: "100.01" },
      ]);
      console.log('✓ Seeded score color bands');
    }

    const existingInterpretations = await db.select().from(scoreInterpretations);
    if (existingInterpretations.length === 0) {
      await db.insert(scoreInterpretations).values([
        { category: "Visibility", scoreMin: "0.00", scoreMax: "10.00", messageTemplate: "A score of X.X suggests Minimal visibility — the brand has very limited presence in AI-generated responses against benchmark, with AA mentions and BB heading hits indicating negligible awareness or differentiation." },
        { category: "Visibility", scoreMin: "10.00", scoreMax: "25.00", messageTemplate: "A score of X.X suggests Low visibility — the brand is emerging in relevant spaces, gaining limited traction with select audiences against benchmark, supported by AA mentions and BB heading hits reflecting initial reach." },
        { category: "Visibility", scoreMin: "25.00", scoreMax: "35.00", messageTemplate: "A score of X.X suggests Developing visibility — gaining moderate recognition within specific channels or audience segments against benchmark, driven by AA mentions and BB heading hits showing early growth in awareness." },
        { category: "Visibility", scoreMin: "35.00", scoreMax: "55.00", messageTemplate: "A score of X.X suggests Emerging visibility — gaining some traction; moderate recognition in select audiences or channels against benchmark, driven by AA mentions and BB heading hits showing healthy reach." },
        { category: "Visibility", scoreMin: "55.00", scoreMax: "75.00", messageTemplate: "A score of X.X suggests Strong visibility — consistent brand presence across channels with high engagement and recall against benchmark, supported by AA mentions and BB heading hits reflecting sustained reach and influence." },
        { category: "Visibility", scoreMin: "75.00", scoreMax: "100.01", messageTemplate: "A score of X.X suggests Dominant visibility — leading share of attention and strong recognition across markets and media against benchmark, driven by AA mentions and BB heading hits indicating extensive reach and top-tier prominence." },
        { category: "Sentiment", scoreMin: "0.00", scoreMax: "10.00", messageTemplate: "A score of X.X suggests Severely negative sentiment — overall discussion around the brand is unfavorable, dominated by criticism or dissatisfaction against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions indicating strong negativity." },
        { category: "Sentiment", scoreMin: "10.00", scoreMax: "25.00", messageTemplate: "A score of X.X suggests Predominantly negative sentiment — brand perception skews negative, though occasional neutral or positive mentions appear against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions reflecting weak advocacy." },
        { category: "Sentiment", scoreMin: "25.00", scoreMax: "35.00", messageTemplate: "A score of X.X suggests Cautious sentiment — mixed reactions with a noticeable tilt toward negative tone, highlighting underlying concerns against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions showing a balance leaning negative." },
        { category: "Sentiment", scoreMin: "35.00", scoreMax: "55.00", messageTemplate: "A score of X.X suggests Balanced sentiment — opinions are mixed, with comparable positive and negative mentions against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions indicating a neutral-to-slightly-positive perception." },
        { category: "Sentiment", scoreMin: "55.00", scoreMax: "75.00", messageTemplate: "A score of X.X suggests Positive sentiment — favorable discussion dominates, showing growing trust and satisfaction against benchmark, driven by AA positive mentions, BB neutral mentions, and CC negative mentions reflecting supportive tone." },
        { category: "Sentiment", scoreMin: "75.00", scoreMax: "100.01", messageTemplate: "A score of X.X suggests Highly positive sentiment — brand enjoys strong advocacy and goodwill across audiences against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions highlighting overwhelmingly positive perception." },
        { category: "Position", scoreMin: "0.00", scoreMax: "10.00", messageTemplate: "A score of X.X suggests Minimal market presence — the brand ranks very low against peers with limited visibility or differentiation, supported by AA relevance and a position score of BB, indicating low competitive standing." },
        { category: "Position", scoreMin: "10.00", scoreMax: "25.00", messageTemplate: "A score of X.X suggests Weak positioning — limited traction versus competitors and low association with key themes; with AA relevance and a position score of BB reflect the need for stronger market alignment." },
        { category: "Position", scoreMin: "25.00", scoreMax: "35.00", messageTemplate: "A score of X.X suggests Developing position — emerging competitiveness and improving visibility in select areas; with AA relevance and a position score of BB show gradual movement toward category recognition." },
        { category: "Position", scoreMin: "35.00", scoreMax: "55.00", messageTemplate: "A score of X.X suggests Moderate positioning — stable but not leading, with consistent presence across key themes; with AA relevance and a position score of BB highlight steady but improvable market alignment." },
        { category: "Position", scoreMin: "55.00", scoreMax: "75.00", messageTemplate: "A score of X.X suggests Strong position — solid market standing and clear association with key topics; with AA relevance and a position score of BB indicate favorable differentiation and competitive strength." },
        { category: "Position", scoreMin: "75.00", scoreMax: "100.01", messageTemplate: "A score of X.X suggests Leading position — the brand ranks among top performers with dominant presence and strong relevance across strategic areas; with AA relevance and a position score of BB signal clear market leadership." },
      ]);
      console.log('✓ Seeded score interpretations');
    }

    // Per-project access control (Task #26): only stamp NULL ownerUserId on
    // legacy projects so they always have a fallback owner. We intentionally
    // DO NOT grandfather org members onto every project — new members must be
    // explicitly granted access via the admin Project Access UI or the
    // per-project sharing dialog. The legacy "grandfather all members" pass
    // remains available as an opt-in CLI:
    //   tsx server/scripts/backfill-project-memberships.ts
    try {
      const r = await stampProjectOwners();
      if (r.ownersStamped > 0) {
        console.log(`✓ Stamped owner on ${r.ownersStamped} legacy project(s)`);
      }
    } catch (err) {
      console.error('Owner-stamp pass failed (non-fatal):', err);
    }
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}
