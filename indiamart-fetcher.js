const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const SEARCH_BASE = 'https://www.indiamart.com/buy-requirements/?searchkey=';
const REQUEST_DELAY = 3500;

function buildQueries(dealers) {
  const seen = new Set();
  const queries = [];
  for (const dealer of dealers) {
    const city = (dealer.city || '').trim();
    if (!city) continue;

    const category = (dealer.industry_category || '').split('&')[0].trim();
    if (category) {
      const key = `${category}|${city}`.toLowerCase();
      if (!seen.has(key)) { seen.add(key); queries.push(`${category} ${city}`); }
    }

    if (dealer.keywords) {
      for (const kw of dealer.keywords.split(',').slice(0, 2)) {
        const k = kw.trim();
        if (!k) continue;
        const key = `${k}|${city}`.toLowerCase();
        if (!seen.has(key)) { seen.add(key); queries.push(`${k} ${city}`); }
      }
    }
  }
  return queries;
}

async function extractLeads(page) {
  return page.evaluate(() => {
    // Selector strategies in priority order — update these if IndiaMART changes their HTML
    const containers = [
      ...document.querySelectorAll('.buy-req-box'),
      ...document.querySelectorAll('.byr-info'),
      ...document.querySelectorAll('[class*="buy-req"]'),
      ...document.querySelectorAll('.reqList .lst'),
      ...document.querySelectorAll('li[class*="byr"]'),
    ];

    const unique = [...new Map(containers.map(el => [el, el])).keys()];

    return unique.map(card => {
      const titleEl = card.querySelector('h3 a, h3, [class*="title"] a, [class*="title"], a[href*="proddetail"]');
      const descEl = card.querySelector('[class*="desc"], [class*="req-desc"], p');
      const locEl = card.querySelector('[class*="loc"], [class*="city"], [class*="location"]');
      const linkEl = card.querySelector('a[href*="indiamart.com"], a[href*="proddetail"]') || card.querySelector('a');

      const title = (titleEl?.textContent || '').trim();
      const text = (descEl?.textContent || '').trim();
      const location = (locEl?.textContent || '').trim();
      const href = linkEl?.href || '';

      const idMatch = href.match(/[A-Z0-9]{8,}/i);
      const id = idMatch ? idMatch[0] : title.slice(0, 40).toLowerCase().replace(/\W+/g, '-');

      return { id, title, text, location, href };
    }).filter(l => l.title.length > 4);
  });
}

async function fetchIndiaMartLeads(dealers, maxLeads = 100) {
  const queries = buildQueries(dealers);
  if (!queries.length) return [];

  let browser;
  const results = [];
  const seenIds = new Set();

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    for (const query of queries) {
      if (results.length >= maxLeads) break;

      const url = SEARCH_BASE + encodeURIComponent(query);
      console.log(`[indiamart] Searching: "${query}"`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, REQUEST_DELAY + Math.random() * 2000));

        const leads = await extractLeads(page);

        let added = 0;
        for (const lead of leads) {
          const uid = `im_${lead.id}`;
          if (!seenIds.has(uid)) {
            seenIds.add(uid);
            const postText = [lead.text, lead.location ? `Location: ${lead.location}` : '']
              .filter(Boolean).join(' ');
            results.push({
              id: uid,
              title: lead.title,
              selftext: postText,
              permalink: lead.href || url,
              _subreddit: 'indiamart',
            });
            added++;
          }
        }
        console.log(`[indiamart]   → found ${leads.length} listings, added ${added} new`);
      } catch (err) {
        console.error(`[indiamart] Error on "${query}": ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[indiamart] Browser launch failed: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`[indiamart] Total collected: ${results.length}`);
  return results;
}

module.exports = { fetchIndiaMartLeads, buildQueries };
