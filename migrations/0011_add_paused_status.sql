-- Task #139: True Pause/Resume for prompt runs.
--
-- Adds a 'paused' value to the shared `status_enum` used by BOTH
-- `jobs.status` and `prompt_runs.status`. A paused run keeps its
-- checkpoint + completed items intact and is excluded from the queue
-- picker, the stale-job sweeps, and the stale prompt-run reaper, so it
-- can be resumed later without re-paying for already-completed items.
--
-- `ADD VALUE IF NOT EXISTS` is idempotent and cannot run inside a
-- transaction block; apply this statement standalone.

ALTER TYPE "status_enum" ADD VALUE IF NOT EXISTS 'paused';
