import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { canAccessInternalModels } from "../utils/internal-model-access";

function requestWith(
  tenantRole: "admin" | "member" | undefined,
  sessionAdmin: boolean,
): Request {
  return {
    currentClientRole: tenantRole,
    session: { isAdmin: sessionAdmin },
  } as unknown as Request;
}

test("current client admin can access internal models", () => {
  assert.equal(canAccessInternalModels(requestWith("admin", false)), true);
});

test("cross-org or stale session admin cannot access internal models", () => {
  assert.equal(canAccessInternalModels(requestWith("member", true)), false);
  assert.equal(canAccessInternalModels(requestWith(undefined, true)), false);
});

test("current demotion takes precedence over stale session metadata", () => {
  const req = requestWith("admin", true);
  assert.equal(canAccessInternalModels(req), true);
  (req as Request & { currentClientRole?: string }).currentClientRole = "member";
  assert.equal(canAccessInternalModels(req), false);
});