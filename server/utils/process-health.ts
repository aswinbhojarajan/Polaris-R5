/**
 * Task #113 — Process-level health snapshot.
 *
 * Extracted from `server/index.ts` so route modules (e.g.
 * `server/routes/admin.ts`) can import it without creating a
 * `index.ts → routes/index.ts → routes/admin.ts → index.ts` cycle.
 *
 * The handlers themselves still live in `server/index.ts`; they just
 * mutate the exported snapshot here.
 */
export const processHealth = {
  lastUnhandledRejectionAt: null as string | null,
  lastUnhandledRejectionMessage: null as string | null,
  unhandledRejectionCount: 0,
  lastUncaughtExceptionAt: null as string | null,
  lastUncaughtExceptionMessage: null as string | null,
  uncaughtExceptionCount: 0,
};
