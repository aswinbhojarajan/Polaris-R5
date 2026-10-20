/**
 * Task #114 — Network-down / server-unreachable banner.
 *
 * Mounted ONCE at the app root in `App.tsx`. Listens to:
 *   - window `online` / `offline` events (browser connectivity)
 *   - a 30-second `/health/live` ping (server reachability)
 *
 * When the browser is offline OR `/health/live` has been failing for
 * >15s, a single dismissible amber bar appears at the top with a
 * "Retry now" button. Auto-clears when health returns.
 *
 * Pauses polling while `document.hidden` so background tabs don't burn
 * CPU. Uses `/health/live` (not `/health`) so we don't compound the
 * regular query load.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WifiOff, X, RefreshCw } from "lucide-react";

const PING_INTERVAL_MS = 30_000;
const FAIL_THRESHOLD_MS = 15_000;

async function ping(): Promise<boolean> {
  try {
    const res = await fetch("/health/live", {
      method: "GET",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function NetworkBanner() {
  const [offline, setOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [serverDown, setServerDown] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const firstFailAtRef = useRef<number | null>(null);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => {
      setOffline(true);
      setDismissed(false);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const inFlightRef = useRef<boolean>(false);
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    let degradeTimer: number | null = null;
    const clearDegradeTimer = () => {
      if (degradeTimer !== null) {
        window.clearTimeout(degradeTimer);
        degradeTimer = null;
      }
    };
    const tick = async () => {
      if (cancelled) return;
      if (inFlightRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      inFlightRef.current = true;
      try {
        const ok = await ping();
        if (cancelled) return;
        if (ok) {
          firstFailAtRef.current = null;
          clearDegradeTimer();
          setServerDown(false);
        } else {
          if (firstFailAtRef.current === null) {
            firstFailAtRef.current = Date.now();
            // Arm a deadline so we degrade exactly at FAIL_THRESHOLD_MS
            // rather than waiting for the next PING_INTERVAL_MS tick.
            clearDegradeTimer();
            degradeTimer = window.setTimeout(() => {
              if (cancelled) return;
              if (firstFailAtRef.current !== null) {
                setServerDown(true);
                setDismissed(false);
              }
            }, FAIL_THRESHOLD_MS);
          } else if (Date.now() - firstFailAtRef.current >= FAIL_THRESHOLD_MS) {
            setServerDown(true);
            setDismissed(false);
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    };
    tickRef.current = tick;
    void tick();
    const id = window.setInterval(tick, PING_INTERVAL_MS);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearDegradeTimer();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const degraded = offline || serverDown;
  if (!degraded || dismissed) return null;

  const handleRetry = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const ok = await ping();
      if (ok) {
        firstFailAtRef.current = null;
        setServerDown(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <div
      className="fixed top-0 inset-x-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center gap-3 text-sm"
      data-testid="network-banner"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        {offline
          ? "You're offline. Reconnect to keep working."
          : "Can't reach the server right now. We'll keep trying."}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={handleRetry}
        className="h-7 bg-white"
        data-testid="button-network-retry"
      >
        <RefreshCw className="h-3 w-3 mr-1" />
        Retry now
      </Button>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-900 hover:opacity-70"
        aria-label="Dismiss"
        data-testid="button-network-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
