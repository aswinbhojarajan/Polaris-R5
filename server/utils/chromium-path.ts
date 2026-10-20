import { execSync } from 'child_process';
import { existsSync } from 'fs';

/**
 * Get the path to system-provided Chromium browser
 * This is required for NixOS-based systems like Replit where Playwright's
 * bundled browsers may be missing system libraries (e.g., libgbm.so.1)
 * 
 * Uses multiple detection strategies to work in both development and production:
 * 1. Check CHROMIUM_PATH environment variable (explicit override)
 * 2. Try `which chromium` command (works in interactive shells)
 * 3. Scan Nix store for chromium binaries (works in production VMs)
 * 4. Try common system paths
 * 
 * @returns Path to Chromium executable or undefined to use Playwright's bundled browser
 */
export function getSystemChromiumPath(): string | undefined {
  // Strategy 0: Replit-blessed Playwright-matched Chromium (Task #104).
  // Replit pre-installs the exact Chromium build that matches the bundled
  // Playwright version and exposes its path via this env var. Always
  // prefer it over a system Nix Chromium found by `which chromium`, which
  // is a different (and often protocol-incompatible) build that surfaces
  // as `spawn EIO` when Playwright tries to drive it.
  const replitChromium = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (replitChromium && existsSync(replitChromium)) {
    console.log(`[Chromium] Using REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE: ${replitChromium}`);
    return replitChromium;
  }

  // Strategy 1: Check environment variable (allows explicit override)
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    console.log(`[Chromium] Using CHROMIUM_PATH env: ${process.env.CHROMIUM_PATH}`);
    return process.env.CHROMIUM_PATH;
  }

  // Strategy 2: Try 'which chromium' command (works in interactive Nix shells)
  try {
    const chromiumPath = execSync('which chromium 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (chromiumPath && chromiumPath.length > 0 && existsSync(chromiumPath)) {
      console.log(`[Chromium] Found via 'which chromium': ${chromiumPath}`);
      return chromiumPath;
    }
  } catch {
    // 'which' command failed - continue to other strategies
  }

  // Strategy 3: Scan Nix store for chromium (works in production Reserved VMs)
  try {
    // Look for chromium binaries in the Nix store
    const nixStorePaths = execSync(
      'find /nix/store -maxdepth 2 -name "chromium" -type d 2>/dev/null | head -5',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim().split('\n').filter(Boolean);

    for (const dir of nixStorePaths) {
      const binPath = `${dir}/bin/chromium`;
      if (existsSync(binPath)) {
        console.log(`[Chromium] Found in Nix store: ${binPath}`);
        return binPath;
      }
    }

    // Also try to find chromium-* directories (version-suffixed)
    const chromiumDirs = execSync(
      'ls -d /nix/store/*-chromium-*/bin/chromium 2>/dev/null | head -1',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (chromiumDirs && existsSync(chromiumDirs)) {
      console.log(`[Chromium] Found versioned in Nix store: ${chromiumDirs}`);
      return chromiumDirs;
    }
  } catch {
    // Nix store scan failed - continue to other strategies
  }

  // Strategy 4: Check common system paths
  const commonPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      console.log(`[Chromium] Found at common path: ${path}`);
      return path;
    }
  }

  // No system Chromium found - Playwright will use bundled browser if available
  console.warn('[Chromium] No system Chromium found. Playwright will attempt to use bundled browser.');
  console.warn('[Chromium] If crawling fails, ensure Playwright browsers are installed or set CHROMIUM_PATH.');
  return undefined;
}

/**
 * Browser fingerprint profiles that have consistent UA and Sec-CH-* headers
 * This ensures the headers match the user-agent to avoid detection
 */
interface BrowserFingerprint {
  userAgent: string;
  secChUa: string;
  secChUaPlatform: string;
  secChUaMobile: string;
}

const BROWSER_FINGERPRINTS: BrowserFingerprint[] = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: '?0',
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    secChUa: '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: '?0',
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: '?0',
  },
];

let currentFingerprint: BrowserFingerprint | null = null;

/**
 * Get a consistent browser fingerprint for the current session
 * Called once per crawl session to ensure consistency
 */
export function getBrowserFingerprint(): BrowserFingerprint {
  if (!currentFingerprint) {
    currentFingerprint = BROWSER_FINGERPRINTS[Math.floor(Math.random() * BROWSER_FINGERPRINTS.length)];
    console.log(`[Chromium] Using fingerprint: ${currentFingerprint.userAgent.substring(0, 60)}...`);
  }
  return currentFingerprint;
}

/**
 * Reset the fingerprint for a new crawl session
 */
export function resetBrowserFingerprint(): void {
  currentFingerprint = null;
}

/**
 * Get common browser launch options for Playwright
 * Includes necessary flags for headless operation, NixOS compatibility,
 * and stealth configurations to avoid bot detection
 * Note: User-agent should be set via launchContext.userAgent, not via args
 */
export function getChromiumLaunchOptions() {
  const executablePath = getSystemChromiumPath();
  
  return {
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--ignore-certificate-errors',
      '--window-size=1920,1080',
    ],
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: 'true',
    },
  };
}

/**
 * Get stealth browser context options for better bot evasion
 * Uses consistent fingerprint for matching UA and Sec-CH-* headers
 */
export function getStealthContextOptions() {
  const fingerprint = getBrowserFingerprint();
  
  return {
    userAgent: fingerprint.userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'User-Agent': fingerprint.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': fingerprint.secChUa,
      'Sec-Ch-Ua-Mobile': fingerprint.secChUaMobile,
      'Sec-Ch-Ua-Platform': fingerprint.secChUaPlatform,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  };
}
