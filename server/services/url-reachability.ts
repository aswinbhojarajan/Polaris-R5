import { lookup } from "node:dns/promises";

// Task #99 — Lightweight URL reachability probe used as an advisory signal
// in the Create-Project wizard. We do NOT block submission on this; the
// only goal is to give users early feedback when an AI-suggested URL or a
// competitor website is obviously dead so they can fix it before kicking
// off the (slow, expensive) crawl + metadata pipeline.
//
// Strategy:
//   1. HEAD with a 3s AbortSignal.timeout, follow redirects.
//   2. If HEAD returns 405 / 501 OR throws a network error, fall back to a
//      tiny GET with `Range: bytes=0-0` so we don't pull the whole page.
//   3. `reachable === true` iff the final status < 400. Anything else
//      (timeouts, DNS failures, 4xx, 5xx) is reported as unreachable with a
//      short reason string for the UI tooltip.
//
// All probes run via Promise.allSettled so one slow/dead URL never holds
// up the rest. Skipped under NODE_ENV=test / SESSION_STORE=memory to keep
// the test suite hermetic.

export interface ReachabilityResult {
  url: string;
  reachable: boolean;
  status?: number;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 3000;

function shouldSkip(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.SESSION_STORE === "memory"
  );
}

// SSRF guardrail. The probe is reachable from an authenticated browser
// session, so we must refuse to fetch anything that could be used to scan
// the internal network: non-http(s) schemes, localhost/loopback,
// link-local, and RFC1918 private ranges. Hostnames that resolve to one
// of those at DNS time are caught by the underlying fetch failing
// (different IP per request), but the literal-IP and obvious-name cases
// below are the high-value blocks.
function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  // IPv4 literal?
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true;
  }
  // IPv6 — block fc00::/7 (ULA) and fe80::/10 (link-local) by prefix.
  if (h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe8") || h.startsWith("[fe9") || h.startsWith("[fea") || h.startsWith("[feb")) return true;
  return false;
}

function isAllowedTarget(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Unsupported scheme" };
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, reason: "Private/internal host blocked" };
  }
  return { ok: true };
}

// Check if a resolved IP literal falls in a private/loopback/link-local
// range. Reuses isPrivateOrLoopbackHost for IPv4; for IPv6 we wrap in
// brackets so the prefix check matches the URL.hostname format.
function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return isPrivateOrLoopbackHost(address);
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    return isPrivateOrLoopbackHost(`[${lower}]`);
  }
  return false;
}

// Resolve the hostname and reject if any returned address is private.
// This is the DNS-rebinding / SSRF-by-public-name guardrail: a hostname
// like `evil.example.com` that points to 10.x.x.x must not be probed.
// IP literals skip lookup (they were already validated by
// isPrivateOrLoopbackHost upstream).
async function assertAllowedTarget(
  url: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sync = isAllowedTarget(url);
  if (!sync.ok) return sync;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  // Skip DNS for literal IPs — already covered by the sync check.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) {
    return { ok: true };
  }
  try {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateAddress(a.address, a.family)) {
        return { ok: false, reason: "Private/internal host blocked" };
      }
    }
  } catch {
    return { ok: false, reason: "DNS lookup failed" };
  }
  return { ok: true };
}

// Manual single-redirect follower. fetch's `redirect: 'follow'` would
// chase any number of hops; we cap at 1 and re-validate the redirect
// target against the SSRF allowlist so a public host can't bounce us
// onto an internal one.
async function tryFetch(
  url: string,
  init: RequestInit & { method: "HEAD" | "GET" },
  timeoutMs: number,
): Promise<Response> {
  const headers = {
    "User-Agent": "PolarisAI-URLProbe/1.0 (+advisory reachability check)",
    ...(init.headers || {}),
  };
  const first = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  // Not a redirect — return as-is.
  if (first.status < 300 || first.status >= 400) return first;
  const location = first.headers.get("location");
  if (!location) return first;
  // Resolve relative redirects against the original URL.
  let target: string;
  try {
    target = new URL(location, url).toString();
  } catch {
    return first;
  }
  const allowed = await assertAllowedTarget(target);
  if (!allowed.ok) {
    // Refuse to follow into a private/internal/non-http(s) target.
    throw new Error(`Redirect blocked: ${allowed.reason}`);
  }
  // Single follow only — no further redirects.
  return await fetch(target, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
}

export async function probeUrlReachability(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ReachabilityResult> {
  if (shouldSkip()) {
    return { url, reachable: true };
  }

  // Validate up-front so we can return a clean error without a fetch hop,
  // and refuse to probe internal/private targets (SSRF guardrail). The
  // async variant additionally resolves the hostname via DNS and rejects
  // if any returned address is private — defeats the case where a public
  // hostname like `evil.example.com` resolves to 10.x.x.x.
  const allowed = await assertAllowedTarget(url);
  if (!allowed.ok) {
    return { url, reachable: false, reason: allowed.reason };
  }

  let firstError: string | undefined;
  let firstStatus: number | undefined;

  // 1) HEAD attempt
  try {
    const res = await tryFetch(url, { method: "HEAD" }, timeoutMs);
    if (res.status < 400) {
      return { url, reachable: true, status: res.status };
    }
    firstStatus = res.status;
    // Some servers reject HEAD with these codes — fall through to GET.
    if (res.status !== 405 && res.status !== 501) {
      return {
        url,
        reachable: false,
        status: res.status,
        reason: `HTTP ${res.status}`,
      };
    }
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }

  // 2) GET fallback with Range so we don't download the whole body.
  try {
    const res = await tryFetch(
      url,
      { method: "GET", headers: { Range: "bytes=0-0" } },
      timeoutMs,
    );
    if (res.status < 400) {
      return { url, reachable: true, status: res.status };
    }
    return {
      url,
      reachable: false,
      status: res.status,
      reason: `HTTP ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = firstError || msg;
    return {
      url,
      reachable: false,
      status: firstStatus,
      reason: /aborted|timeout/i.test(reason) ? "Timeout" : reason,
    };
  }
}

export async function probeUrls(
  urls: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, ReachabilityResult>> {
  // De-duplicate to avoid probing the same URL multiple times when a
  // competitor's website happens to equal one of the AI-suggested URLs.
  const unique = Array.from(new Set(urls.filter((u) => typeof u === "string" && u.length > 0)));
  const results = await Promise.allSettled(
    unique.map((u) => probeUrlReachability(u, timeoutMs)),
  );
  const out: Record<string, ReachabilityResult> = {};
  results.forEach((r, i) => {
    const url = unique[i];
    if (r.status === "fulfilled") {
      out[url] = r.value;
    } else {
      out[url] = {
        url,
        reachable: false,
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    }
  });
  return out;
}

// Dev-only self-check: `localtest.me` is a public hostname that resolves
// to 127.0.0.1, so probing it must be rejected by the DNS-resolution
// guardrail (not just by the literal-IP check). Runs once at import,
// fire-and-forget, and only logs on failure. Skipped in tests / prod.
if (
  process.env.NODE_ENV !== "test" &&
  process.env.NODE_ENV !== "production" &&
  process.env.SESSION_STORE !== "memory"
) {
  void (async () => {
    try {
      const r = await probeUrlReachability("http://localtest.me", 1500);
      if (r.reachable || r.reason !== "Private/internal host blocked") {
        console.warn(
          "[url-reachability] SSRF DNS guardrail self-check failed:",
          r,
        );
      }
    } catch {
      // Self-check is best-effort; ignore errors (e.g. no DNS in CI).
    }
  })();
}
