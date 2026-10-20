-- Task #89: Realism-aware Prompt Library generator. Adds the
-- intent-tier axis (orthogonal to the 7-category taxonomy) and the
-- four optional project-context fields used to generate realistic,
-- in-market prompts ("near me" -> primary_test_location, persona
-- shapes voice, target_market_country sets currency / regulatory
-- framing, primary_language sets prompt language).
--
-- All ALTERs are idempotent so re-running after `drizzle-kit push`
-- cutover is safe. New columns are nullable so legacy/manually-added
-- prompts and pre-existing client rows continue to work — the
-- Prompt Library renders an em-dash badge when intent_tier is NULL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prompt_intent_tier') THEN
    CREATE TYPE "prompt_intent_tier" AS ENUM ('branded', 'semi_branded', 'unbranded');
  END IF;
END $$;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "target_customer_persona" text;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "target_market_country" text;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "primary_test_location" text;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "primary_language" text;

ALTER TABLE "prompts"
  ADD COLUMN IF NOT EXISTS "intent_tier" "prompt_intent_tier";

ALTER TABLE "prompts"
  ADD COLUMN IF NOT EXISTS "diagnostic_focus" text;
