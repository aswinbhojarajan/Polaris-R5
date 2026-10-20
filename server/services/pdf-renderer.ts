import { chromium, Browser, BrowserContext } from 'playwright';
import { generateReportHTML, TemplateData, generateAppendixHTML, AppendixTemplateData } from './pdf-template';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getChromiumLaunchOptions } from '../utils/chromium-path';

export interface PDFRenderOptions {
  format?: 'Letter' | 'A4' | 'Legal';
  landscape?: boolean;
  margins?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
}

export interface PDFRenderResult {
  filePath: string;
  fileSize: number;
  generatedAt: string;
}

const DEFAULT_OPTIONS: PDFRenderOptions = {
  format: 'Letter',
  landscape: false,
  margins: {
    top: '0.75in',
    bottom: '1in',
    left: '0.75in',
    right: '0.75in',
  },
};

/**
 * Task #105 (R3) — Shared Chromium browser pool.
 *
 * Before this change every report rendered TWO PDFs and each render
 * launched its own `chromium` process (~200ms cold + ~100MB RSS) and
 * left a `/tmp/playwright_chromiumdev_profile-*` dir behind on SIGKILL.
 *
 * Now we keep a single Browser instance per process; each render gets
 * its own ephemeral `BrowserContext` (cheap, isolated cookie/storage
 * jar, no profile collisions). The browser is closed exactly once, on
 * SIGTERM via `closeSharedBrowser()` from the index.ts shutdown handler.
 *
 * Playwright manages its own per-launch temp profile automatically and
 * explicitly forbids passing `--user-data-dir` as a launch arg — that's
 * what `launchPersistentContext(userDataDir, ...)` is for. Since we
 * want a fresh, ephemeral profile (not a persisted one) we just let
 * Playwright pick a unique `/tmp/playwright_chromiumdev_profile-*` per
 * `chromium.launch()` call. Concurrent processes therefore never
 * collide on a profile lock.
 */
let sharedBrowser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

async function getOrCreateBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    const baseOptions = getChromiumLaunchOptions();
    const browser = await chromium.launch(baseOptions);
    browser.on('disconnected', () => {
      // If the browser dies (crash, OOM), drop the singleton so the next
      // render relaunches instead of timing out on a dead handle.
      if (sharedBrowser === browser) {
        sharedBrowser = null;
      }
    });
    sharedBrowser = browser;
    console.log(`[PDFRenderer] Shared Chromium browser ready`);
    return browser;
  })();

  try {
    return await browserPromise;
  } finally {
    browserPromise = null;
  }
}

/**
 * Closes the shared browser. Wired to SIGTERM in `server/index.ts` so a
 * graceful shutdown doesn't leak the chromium child process or its
 * temp profile dir.
 */
export async function closeSharedBrowser(): Promise<void> {
  const b = sharedBrowser;
  sharedBrowser = null;
  if (b) {
    try {
      await b.close();
    } catch {
      // best-effort
    }
  }
}

async function renderHtmlToPdf(
  html: string,
  outputPath: string,
  mergedOptions: PDFRenderOptions,
  errorPrefix: string,
): Promise<PDFRenderResult> {
  // Task #105 (R3) — render to a `.tmp` sibling first; only rename to the
  // final path on a successful write. Eliminates partial PDF files when
  // chromium crashes mid-write.
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp-${randomUUID()}`;

  const browser = await getOrCreateBrowser();
  const context: BrowserContext = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    await page.pdf({
      path: tmpPath,
      format: mergedOptions.format,
      landscape: mergedOptions.landscape,
      printBackground: true,
      preferCSSPageSize: true,
      margin: mergedOptions.margins,
    });

    await fs.rename(tmpPath, outputPath);
    const stats = await fs.stat(outputPath);
    return {
      filePath: outputPath,
      fileSize: stats.size,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Best-effort cleanup of any partial tmp file.
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during PDF rendering';
    throw new Error(`${errorPrefix}: ${errorMessage}`);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function renderReportToPDF(
  templateData: TemplateData,
  outputPath: string,
  options: PDFRenderOptions = {}
): Promise<PDFRenderResult> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const html = generateReportHTML(templateData);
  return renderHtmlToPdf(html, outputPath, mergedOptions, 'PDF rendering failed');
}

export async function renderAppendixToPDF(
  templateData: AppendixTemplateData,
  outputPath: string,
  options: PDFRenderOptions = {}
): Promise<PDFRenderResult> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const html = generateAppendixHTML(templateData);
  return renderHtmlToPdf(html, outputPath, mergedOptions, 'Appendix PDF rendering failed');
}

export async function cleanupOldPDFs(directory: string, maxAgeMs: number): Promise<number> {
  try {
    const files = await fs.readdir(directory);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.pdf')) continue;

      const filePath = path.join(directory, file);
      const stats = await fs.stat(filePath);

      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up old PDFs:', error);
    return 0;
  }
}
