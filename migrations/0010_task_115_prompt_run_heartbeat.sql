-- Task #115 — Mid-life zombie prompt-run reaping.
--
-- The boot-time reaper from Task #59 only catches zombies on restart.
-- Adding `heartbeat_at` lets a periodic in-process sweep reap stuck
-- runs even when the workflow is healthy. The executor touches this
-- column every ~30s while it has an item in flight; the sweep treats
-- `heartbeat_at IS NULL OR heartbeat_at < NOW() - <stale window>` as
-- stale (combined with the existing `createdAt` floor so a freshly-
-- enqueued run isn't reaped before its first heartbeat).
ALTER TABLE "prompt_runs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
