-- Final validated AI model catalog cutover.
--
-- This migration is intentionally idempotent. It supports existing databases
-- that already contain the validation-history rows as well as environments
-- where drizzle-kit push has already added internal_only.

ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "internal_only" boolean NOT NULL DEFAULT false;

-- The 13 validated prompt-run models are released for normal-user selection.
-- Disable-attribution fields are cleared because these rows are enabled.
UPDATE "ai_models"
SET
  "enabled" = true,
  "internal_only" = false,
  "disabled_at" = NULL,
  "disabled_by_user_id" = NULL,
  "disabled_reason" = NULL
WHERE "model" IN (
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
  'gemini-2.5-flash-lite'
);

-- Exactly one current flagship from each generation vendor is Core.
UPDATE "ai_models"
SET "category" = 'core'
WHERE "model" IN (
  'gpt-5.6-terra',
  'claude-sonnet-5',
  'gemini-3.7-flash'
);

-- Every other model, whether enabled or retained for history, is Additional.
UPDATE "ai_models"
SET "category" = 'additional'
WHERE "model" NOT IN (
  'gpt-5.6-terra',
  'claude-sonnet-5',
  'gemini-3.7-flash'
);