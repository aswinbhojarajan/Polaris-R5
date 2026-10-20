/**
 * Task #114 — Returns `true` once a query has been actively fetching for
 * longer than `thresholdMs`. Use to swap the default skeleton for a
 * "Still working… this is taking longer than usual" message on slow
 * surfaces (dashboard load, X-Ray batch, report spinner).
 */
import { useEffect, useState } from "react";

export function useSlowQueryNotice(
  isFetching: boolean,
  thresholdMs: number = 10_000,
): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!isFetching) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), thresholdMs);
    return () => window.clearTimeout(id);
  }, [isFetching, thresholdMs]);

  return slow;
}
