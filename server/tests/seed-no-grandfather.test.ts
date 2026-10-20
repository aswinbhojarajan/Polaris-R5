/**
 * Source-level guard (Task #26): the boot-time seed must NOT call the
 * `backfillProjectMemberships` helper. That helper grandfathers every
 * non-admin org member onto every project and was the root cause of
 * new members silently seeing all projects after a server restart.
 *
 * The helper itself is preserved for opt-in CLI use, but no auto-run
 * path is allowed to invoke it. We assert the source of `seed.ts` and
 * `post_merge_setup.sh` to keep this contract loud and visible.
 *
 * Run with:    npx tsx --test server/tests/seed-no-grandfather.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

test("seed.ts does not call backfillProjectMemberships()", () => {
  const src = readFileSync(resolve("server/seed.ts"), "utf8");
  assert.ok(
    !/backfillProjectMemberships\s*\(/.test(src),
    "server/seed.ts must not invoke backfillProjectMemberships() — that re-introduces the silent grandfather leak.",
  );
  assert.ok(
    !/from\s+["'].*backfill-project-memberships["']/.test(src),
    "server/seed.ts must not import backfill-project-memberships at all.",
  );
});

test("seed.ts still stamps NULL ownerUserId via stampProjectOwners", () => {
  const src = readFileSync(resolve("server/seed.ts"), "utf8");
  assert.match(
    src,
    /stampProjectOwners\s*\(/,
    "stampProjectOwners() must still run — it is the safety fix-up that prevents legacy projects from being un-owned.",
  );
});

test("post_merge_setup.sh does not invoke the backfill script", () => {
  const path = resolve("post_merge_setup.sh");
  if (!existsSync(path)) return;
  const src = readFileSync(path, "utf8");
  assert.ok(
    !/backfill-project-memberships/.test(src),
    "post_merge_setup.sh must not auto-run backfill-project-memberships — that would re-grandfather access on every merge.",
  );
});

test("admin-users.ts registers per-user project-access endpoints", () => {
  const src = readFileSync(resolve("server/routes/admin-users.ts"), "utf8");
  assert.match(
    src,
    /\/api\/v1\/admin\/orgs\/:orgId\/users\/:userId\/project-access/,
    "Project-access endpoints must be registered.",
  );
  assert.match(src, /project\.member\.grant/, "Grant audit action must be emitted.");
  assert.match(src, /project\.member\.revoke/, "Revoke audit action must be emitted.");
});
