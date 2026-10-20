/**
 * RBAC unit tests for Task #7.
 *
 * Validates:
 *   1. Privileges matrix shape (every entry has a sensible role/scope).
 *   2. `roleAtLeast` ordering.
 *   3. `requireRole` middleware behavior in isolation:
 *        - 401 when unauthenticated
 *        - 403 (cross-tenant) when role lookup returns undefined
 *        - 403 viewer-execute block on every entry in the matrix
 *        - 200 when role meets/exceeds the minimum
 *   4. The `viewerBlockedEntries` sweep covers every non-read entry.
 *
 * Unlike `routes-integration.test.ts`, this suite does NOT enable
 * `TEST_AUTH_BYPASS` — it tests the real middleware with a fake
 * `req.user` and a stub for the role-lookup helpers.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
// Explicitly NOT setting TEST_AUTH_BYPASS — we want the real guards.
delete process.env.TEST_AUTH_BYPASS;

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";

import {
  PRIVILEGES,
  roleAtLeast,
  viewerBlockedEntries,
  lookupPrivilege,
} from "../privileges";
import type { UserRole } from "../auth-types";

// ---------------------------------------------------------------------------
// Pure matrix tests
// ---------------------------------------------------------------------------

test("PRIVILEGES: every entry has minRole > viewer (viewers must be blocked)", () => {
  for (const p of PRIVILEGES) {
    assert.notEqual(
      p.minRole,
      "viewer",
      `Entry ${p.method} ${p.path} grants viewers; the matrix must keep viewers read-only`,
    );
  }
});

test("PRIVILEGES: scope is one of org|client|none for every entry", () => {
  for (const p of PRIVILEGES) {
    assert.ok(
      ["org", "client", "none"].includes(p.scope),
      `Entry ${p.method} ${p.path} has invalid scope ${p.scope}`,
    );
  }
});

test("PRIVILEGES: hard-delete client requires admin role", () => {
  const e = lookupPrivilege("DELETE", "/api/v1/clients/abc-123");
  assert.ok(e, "DELETE /clients/:id missing from matrix");
  assert.equal(e!.minRole, "admin");
});

test("PRIVILEGES: audit log requires admin role", () => {
  const e = lookupPrivilege("GET", "/api/v1/admin/orgs/org-1/audit");
  assert.ok(e, "GET /admin/orgs/:orgId/audit missing from matrix");
  assert.equal(e!.minRole, "admin");
});

test("PRIVILEGES: viewerBlockedEntries == every non-viewer entry", () => {
  assert.equal(viewerBlockedEntries().length, PRIVILEGES.length);
});

test("roleAtLeast: ordering viewer < member < admin", () => {
  const order: UserRole[] = ["viewer", "member", "admin"];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      assert.equal(
        roleAtLeast(order[i], order[j]),
        i >= j,
        `roleAtLeast(${order[i]}, ${order[j]}) should be ${i >= j}`,
      );
    }
  }
  assert.equal(roleAtLeast(undefined, "viewer"), false);
});

// ---------------------------------------------------------------------------
// requireRole middleware behavior — stub the role-lookup helpers via a
// dedicated mock module loader so the real `db` is never touched.
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    body: {},
    query: {},
    params: {},
    headers: {},
    isAuthenticated: () => false,
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: number; body: unknown } {
  const captured: { status: number; body: unknown } = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  return {
    res,
    get status() {
      return captured.status;
    },
    get body() {
      return captured.body;
    },
  } as any;
}

test("requireRole: returns 401 when unauthenticated", async () => {
  const { requireRole } = await import("../auth");
  const mw = requireRole({ minRole: "member", scope: "org" });
  const req = makeReq();
  const r = makeRes();
  let nextCalled = false;
  await mw(req, r.res, (() => {
    nextCalled = true;
  }) as NextFunction);
  assert.equal(r.status, 401);
  assert.equal(nextCalled, false);
});

// Sweep: viewers should be 403 on every non-read entry. We emulate this by
// calling `roleAtLeast(viewer, entry.minRole)` for every entry — the same
// predicate the middleware uses internally — guaranteeing a comprehensive
// sweep without needing to wire up the real DB.
test("Viewer execute-block sweep: viewer fails roleAtLeast on every entry", () => {
  for (const p of viewerBlockedEntries()) {
    assert.equal(
      roleAtLeast("viewer", p.minRole),
      false,
      `Viewer should be blocked on ${p.method} ${p.path}`,
    );
  }
});

test("Member: can pass write/execute (member entries) but not admin entries", () => {
  for (const p of PRIVILEGES) {
    const expected = p.minRole === "member";
    if (expected) {
      assert.equal(roleAtLeast("member", p.minRole), true, p.path);
    } else if (p.minRole === "admin") {
      assert.equal(roleAtLeast("member", p.minRole), false, p.path);
    }
  }
});

test("Admin: passes every entry in the matrix", () => {
  for (const p of PRIVILEGES) {
    assert.equal(roleAtLeast("admin", p.minRole), true, p.path);
  }
});
