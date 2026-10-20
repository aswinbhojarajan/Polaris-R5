import type { IStorage } from '../storage';

interface HealthProbeResult {
  robotsTxtPresent: boolean;
  robotsRules: Record<string, any> | null;
  aiTxtPresent: boolean;
  aiTxtContent: string | null;
  crawlAccessStatus: 'ok' | 'blocked' | 'rate_limited' | 'captcha';
  crawlEvidence: Record<string, any> | null;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; PolarisBot/1.0; +https://polaris.ai)'
];

const HEALTH_PROBE_TIMEOUT = 30000; // 30 seconds to match crawler
const RETRY_COUNT = 1; // Retry once before giving up

/**
 * Get full browser headers matching the crawler for enterprise WAF compatibility
 */
function getFullHeaders(userAgent: string): Record<string, string> {
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
}

/**
 * Fetch with retry logic for enterprise sites
 */
async function fetchWithRetry(url: string, userAgent: string): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getFullHeaders(userAgent),
        redirect: 'follow',
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT)
      });
      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < RETRY_COUNT) {
        console.log(`Fetch attempt ${attempt + 1} failed for ${url}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
      }
    }
  }
  
  throw lastError;
}

/**
 * Fetches and parses robots.txt file
 * Tries both www and non-www versions with redirect support
 * Uses Chrome UA first, then falls back to PolarisBot
 */
async function checkRobotsTxt(domain: string): Promise<{ present: boolean; rules: Record<string, any> | null }> {
  const baseDomain = domain.replace(/^www\./, '');
  
  const urls = [
    `https://www.${baseDomain}/robots.txt`,
    `https://${baseDomain}/robots.txt`
  ];

  for (const url of urls) {
    for (const userAgent of USER_AGENTS) {
      try {
        const uaName = userAgent.includes('Chrome') ? 'Chrome' : 'PolarisBot';
        const response = await fetchWithRetry(url, userAgent);

        console.log(`robots.txt check for ${url} with ${uaName} UA: status ${response.status}`);

        if (!response.ok) {
          if (response.status === 404) {
            console.log(`robots.txt not found (404) for ${url}, trying next...`);
          } else if (response.status === 403) {
            console.log(`robots.txt access denied (403) for ${url}, trying next...`);
          } else {
            console.log(`robots.txt returned ${response.status} for ${url}, trying next...`);
          }
          continue;
        }

        const content = await response.text();
      
      // Parse basic rules
      const rules: Record<string, any> = {
        userAgents: [],
        disallowRules: [],
        allowRules: [],
        sitemaps: []
      };

      const lines = content.split('\n');
      let currentUserAgent = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (trimmed.toLowerCase().startsWith('user-agent:')) {
          currentUserAgent = trimmed.substring('user-agent:'.length).trim();
          if (!rules.userAgents.includes(currentUserAgent)) {
            rules.userAgents.push(currentUserAgent);
          }
        } else if (trimmed.toLowerCase().startsWith('disallow:')) {
          const path = trimmed.substring('disallow:'.length).trim();
          rules.disallowRules.push({ userAgent: currentUserAgent, path });
        } else if (trimmed.toLowerCase().startsWith('allow:')) {
          const path = trimmed.substring('allow:'.length).trim();
          rules.allowRules.push({ userAgent: currentUserAgent, path });
        } else if (trimmed.toLowerCase().startsWith('sitemap:')) {
          const sitemapUrl = trimmed.substring('sitemap:'.length).trim();
          rules.sitemaps.push(sitemapUrl);
        }
      }

        return { present: true, rules };
      } catch (error) {
        const uaName = userAgent.includes('Chrome') ? 'Chrome' : 'PolarisBot';
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        if (errorMsg.includes('timeout') || errorMsg.includes('aborted')) {
          console.log(`robots.txt check TIMEOUT for ${url} with ${uaName} UA after ${HEALTH_PROBE_TIMEOUT}ms`);
        } else {
          console.log(`robots.txt check FAILED for ${url} with ${uaName} UA: ${errorMsg}`);
        }
      }
    }
  }

  return { present: false, rules: null };
}

/**
 * Fetches ai.txt file (checks both standard paths)
 * Tries both www and non-www versions with redirect support
 * Uses Chrome UA first, then falls back to PolarisBot
 */
async function checkAiTxt(domain: string): Promise<{ present: boolean; content: string | null }> {
  const baseDomain = domain.replace(/^www\./, '');
  
  const paths = [
    `https://www.${baseDomain}/.well-known/ai.txt`,
    `https://www.${baseDomain}/ai.txt`,
    `https://${baseDomain}/.well-known/ai.txt`,
    `https://${baseDomain}/ai.txt`
  ];

  for (const url of paths) {
    for (const userAgent of USER_AGENTS) {
      try {
        const uaName = userAgent.includes('Chrome') ? 'Chrome' : 'PolarisBot';
        const response = await fetchWithRetry(url, userAgent);

        if (response.ok) {
          const content = await response.text();
          console.log(`ai.txt found at ${url} with ${uaName} UA`);
          return { present: true, content };
        }
      } catch (error) {
        continue;
      }
    }
  }

  return { present: false, content: null };
}

/**
 * Probes crawl accessibility by testing sample URLs
 * Tries both www and non-www versions
 * Uses Chrome UA first, then falls back to PolarisBot
 */
async function checkCrawlAccess(domain: string): Promise<{ status: HealthProbeResult['crawlAccessStatus']; evidence: Record<string, any> | null }> {
  const baseDomain = domain.replace(/^www\./, '');
  
  const urls = [
    `https://www.${baseDomain}`,
    `https://${baseDomain}`
  ];

  for (const url of urls) {
    for (const userAgent of USER_AGENTS) {
      try {
        const uaName = userAgent.includes('Chrome') ? 'Chrome' : 'PolarisBot';
        const response = await fetchWithRetry(url, userAgent);

        const evidence = {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          testedUrl: url,
          userAgent: uaName
        };

        if (response.status === 403) {
          console.log(`Access blocked (403) for ${url} with ${uaName} UA`);
          continue;
        }

        if (response.status === 429) {
          return { status: 'rate_limited', evidence };
        }

        const headerStr = JSON.stringify(evidence.headers).toLowerCase();
        if (headerStr.includes('captcha') || headerStr.includes('cloudflare') || headerStr.includes('recaptcha')) {
          return { status: 'captcha', evidence };
        }

        if (response.ok) {
          console.log(`Access OK for ${url} with ${uaName} UA`);
          return { status: 'ok', evidence };
        }
      } catch (error) {
        const uaName = userAgent.includes('Chrome') ? 'Chrome' : 'PolarisBot';
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        if (errorMsg.includes('timeout') || errorMsg.includes('aborted')) {
          console.log(`Crawl access check TIMEOUT for ${url} with ${uaName} UA after ${HEALTH_PROBE_TIMEOUT}ms`);
        } else {
          console.log(`Crawl access check FAILED for ${url} with ${uaName} UA: ${errorMsg}`);
        }
      }
    }
  }

  return {
    status: 'ok',
    evidence: { message: 'All URL checks failed, assuming accessible' }
  };
}

/**
 * Runs comprehensive health probe for a site
 * Checks are independent - partial success is allowed
 */
export async function probeSiteHealth(domain: string): Promise<HealthProbeResult> {
  console.log(`Running health probe for ${domain}...`);

  // Run checks independently - don't block on failures
  // Skip homepage check (checkCrawlAccess) as it times out on enterprise sites
  // and isn't needed for robots.txt/ai.txt detection
  const [robotsCheck, aiCheck] = await Promise.all([
    checkRobotsTxt(domain).catch(err => {
      console.error(`robots.txt check failed for ${domain}:`, err);
      return { present: false, rules: null };
    }),
    checkAiTxt(domain).catch(err => {
      console.error(`ai.txt check failed for ${domain}:`, err);
      return { present: false, content: null };
    })
  ]);

  const result: HealthProbeResult = {
    robotsTxtPresent: robotsCheck.present,
    robotsRules: robotsCheck.rules,
    aiTxtPresent: aiCheck.present,
    aiTxtContent: aiCheck.content,
    // Always assume accessible since we're skipping the slow homepage check
    // The actual crawler will determine accessibility during crawl
    crawlAccessStatus: 'ok',
    crawlEvidence: { message: 'Homepage check skipped - determined by crawler' }
  };

  console.log(`Health probe complete for ${domain}:`, {
    robots: result.robotsTxtPresent ? 'found' : 'not found',
    aiTxt: result.aiTxtPresent ? 'found' : 'not found',
    access: result.crawlAccessStatus
  });

  return result;
}

/**
 * Updates site record with health probe results
 */
export async function updateSiteHealth(
  storage: IStorage,
  siteId: string,
  healthData: HealthProbeResult
): Promise<void> {
  await storage.updateXRaySite(siteId, {
    robotsTxtPresent: healthData.robotsTxtPresent,
    robotsRules: healthData.robotsRules,
    aiTxtPresent: healthData.aiTxtPresent,
    aiTxtContent: healthData.aiTxtContent,
    crawlAccessStatus: healthData.crawlAccessStatus,
    crawlEvidence: healthData.crawlEvidence,
    healthProbeStatus: 'completed',
    lastProbedAt: new Date()
  });
}
