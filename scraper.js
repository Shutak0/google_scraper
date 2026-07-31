const axios = require('axios');
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
/**
 * Search aggregator.
 *   1. Google via SerpAPI (reliable, structured JSON, fast)
 *   2. DuckDuckGo via Playwright (fallback)
 *
 * @param {string} query
 * @returns {Promise<Array>} Array of {title, url, snippet}
 */
async function scrapeGoogle(query) {
  // === Google via SerpAPI ===
  const google = await trySerpApi(query);
  if (google && google.length > 0) {
    console.log(`SerpAPI (Google): ${google.length} results`);
    return google;
  }

  // === DuckDuckGo fallback ===
  console.log('SerpAPI failed → DuckDuckGo fallback');
  return await tryDuckDuckGo(query);
}

// ============================ SERPAPI (Google) ==============================
async function trySerpApi(query) {
  try {
    const resp = await axios.get('https://serpapi.com/search', {
      params: {
        q: query,
        api_key: SERPAPI_KEY,
        engine: 'google',
        hl: 'cs',
        gl: 'cz',
        num: 20,
      },
      timeout: 15000,
    });

    const data = resp.data;

    // Organic results
    if (data.organic_results && Array.isArray(data.organic_results)) {
      return data.organic_results.map((r) => ({
        title: r.title || '',
        url: r.link || '',
        snippet: (r.snippet || '').substring(0, 500),
      }));
    }

    return [];
  } catch (e) {
    console.log('SerpAPI error:', e.message);
    return null;
  }
}

// ============================ DUCKDUCKGO (Playwright + stealth) =============
async function tryDuckDuckGo(query) {
  let browser, ctx, page;
  try {
    const { chromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium.use(StealthPlugin());

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });

    ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'cs-CZ',
      viewport: { width: 1920, height: 1080 },
    });
    page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    // Try DDG Lite first (less likely to block)
    console.log('Trying DDG Lite...');
    await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=cz-cs`, {
      waitUntil: 'domcontentloaded', timeout: 10000,
    });
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body').catch(() => '');
    if (!bodyText.includes('error') && !bodyText.includes('support email')) {
      const results = await page.evaluate(() => {
        const out = [], seen = new Set();

        // DDG Lite: find result rows (<tr> with result-link)
        const rows = document.querySelectorAll('tr');

        for (const row of rows) {
          // Skip ad/sponsored rows
          const rowText = row.textContent.toLowerCase();
          if (rowText.includes('ad') || rowText.includes('sponsored') || rowText.includes('shop ')) continue;

          const link = row.querySelector('a.result-link, a[rel="nofollow"]');
          if (!link) continue;

          const title = link.textContent.trim();
          if (title.length < 3) continue;

          let url = link.href;
          if (!url) continue;

          // Skip ad redirects (Bing ads, y.js, etc.)
          if (url.includes('duckduckgo.com/y.js') || url.includes('bing.com/aclick') || url.includes('ad_domain=') || url.includes('ad_provider=')) continue;

          try {
            const real = new URL(url).searchParams.get('uddg');
            if (real) url = decodeURIComponent(real);
          } catch {}

          if (!url.startsWith('http') || seen.has(url)) continue;
          seen.add(url);

          const sn = row.querySelector('.result-snippet')?.textContent || '';
          out.push({ title, url, snippet: sn.substring(0, 500) });
        }

        return out;
      });
      if (results.length > 0) return results;
    }

    // Try regular DDG with stealth
    console.log('DDG Lite failed → trying DDG main...');
    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=cz-cs&ia=web`, {
      waitUntil: 'domcontentloaded', timeout: 10000,
    });
    await page.waitForTimeout(3000);

    return await page.evaluate(() => {
      const out = [], seen = new Set();
      for (const a of document.querySelectorAll('article[data-testid="result"]')) {
        const link = a.querySelector('a[data-testid="result-title-a"]') || a.querySelector('h2 a');
        if (!link) continue;
        const url = link.href;
        if (!url?.startsWith('http') || seen.has(url)) continue;
        seen.add(url);
        out.push({
          title: link.textContent.trim(),
          url,
          snippet: (a.querySelector('[data-testid="result-snippet"]')?.textContent || '').substring(0, 500),
        });
      }
      return out;
    });
  } catch (e) {
    console.log('DuckDuckGo error:', e.message);
    return [];
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { scrapeGoogle };