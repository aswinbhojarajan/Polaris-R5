import { useSyncExternalStore } from "react";

const STORAGE_KEY = "current-client-id";
const EVENT_NAME = "selected-client-changed";

type Listener = () => void;

// Single notification path: subscribers listen for the custom in-tab event
// (dispatched by setSelectedClientId) and the cross-tab `storage` event.
// We intentionally do NOT also keep a parallel listener Set — that would
// fire each subscriber twice on every same-tab write.
function subscribe(listener: Listener): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  };
  const onCustom = () => listener();

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NAME, onCustom);
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NAME, onCustom);
    }
  };
}

function getSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

export function useSelectedClientId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getSelectedClientIdSnapshot(): string | null {
  return getSnapshot();
}

/**
 * Reads the `?clientId=` query string param on every render. Pages that need
 * to honour deep links / middle-clicked sidebar items (where localStorage may
 * be empty in the freshly-opened tab) should prefer this value over the
 * stored one until `ProtectedRoute`'s URL→store sync effect has run:
 *
 *     const urlClientId = useUrlClientId();
 *     const storedClientId = useSelectedClientId();
 *     const selectedClientId = urlClientId || storedClientId;
 *
 * Wouter's `useLocation()` only exposes the pathname, so the query string has
 * to be parsed off `window.location.search` directly. This is intentionally a
 * plain read (no subscription) — the parent route already re-renders on
 * navigation, and on first mount we just need the value that's in the URL
 * right now.
 */
export function useUrlClientId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("clientId");
}

export function setSelectedClientId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) {
      window.localStorage.setItem(STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage errors (private mode, quota, etc.)
  }
  try {
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // Ignore environments without Event constructor
  }
}
