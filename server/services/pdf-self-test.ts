import { chromium } from 'playwright';
import { getChromiumLaunchOptions, getSystemChromiumPath } from '../utils/chromium-path';

/**
 * Boot-time PDF rendering self-test (Task #104).
 *
 * Launches the same Chromium configuration the executive-report PDF
 * renderer uses, opens a blank page, and renders it to a tiny in-memory
 * PDF buffer. Logs success / failure so we catch a broken PDF environment
 * (wrong binary, missing system libs, sandbox issues) at server boot
 * instead of when a user clicks "Generate Report" and waits 3 minutes for
 * the rest of the pipeline before hitting `spawn EIO`.
 *
 * Fire-and-forget: never throws, never blocks startup. Skipped under
 * NODE_ENV=test / SESSION_STORE=memory (the same gate other boot
 * services use) so test runs and ephemeral envs don't pay the cost.
 */
export async function runPdfSelfTest(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.SESSION_STORE === 'memory') {
    return;
  }

  const path = getSystemChromiumPath() ?? '(playwright bundled)';
  const startedAt = Date.now();

  try {
    const browser = await chromium.launch(getChromiumLaunchOptions());
    try {
      const page = await browser.newPage();
      await page.setContent('<html><body>polaris pdf self-test</body></html>', {
        waitUntil: 'load',
        timeout: 10_000,
      });
      const buf = await page.pdf({ format: 'Letter' });
      const ms = Date.now() - startedAt;
      console.log(
        `[PDF Self-Test] OK using ${path} (${buf.length} bytes, ${ms}ms)`,
      );
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Single-line summary first so it's easy to grep, then the full
    // message in case there's a multi-line stack from Playwright.
    console.error(`[PDF Self-Test] FAILED using ${path}: ${message.split('\n')[0]}`);
    console.error(`[PDF Self-Test] Full error: ${message}`);
    console.error(
      '[PDF Self-Test] Executive-report PDF generation will fail until this is fixed. ' +
        'See server/utils/chromium-path.ts for the binary resolution order.',
    );
  }
}
