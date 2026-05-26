const { spawn } = require('child_process');
const path = require('path');

const LIFE_EVENT_KEYWORDS = [
  'just moved', 'moving to', 'relocated to', 'shifting to',
  'planning a trip', 'planning to visit', 'booked my trip',
  'just got my license', 'buying a car', 'first car',
  'house hunting', 'looking for a flat', 'renting in',
  'getting married', 'wedding planning', 'engaged',
  'new job', 'joining office', 'starting work',
  'gym membership', 'want to lose weight', 'fitness journey',
  'baby on the way', 'expecting', 'new born',
];

const STOP_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'for', 'in', 'of', 'to',
  'with', 'is', 'are', 'it', 'we', 'my', 'by', 'at', 'on',
]);

function buildDealerHashtags(dealers) {
  const seen = new Set();
  const hashtags = [];
  for (const dealer of dealers) {
    if (!dealer) continue;
    const fields = [String(dealer.industry_category || ''), String(dealer.keywords || '')].join(' ');
    fields.toLowerCase().split(/[\s,&\/]+/).forEach(word => {
      const w = word.trim();
      if (w.length > 2 && !STOP_WORDS.has(w) && !seen.has(w)) {
        seen.add(w);
        hashtags.push(w);
      }
    });
  }
  return hashtags;
}

async function fetchInstagramLeads(dealers, maxLeads = 80) {
  const keywords = LIFE_EVENT_KEYWORDS.join(',');
  const hashtags = buildDealerHashtags(dealers).slice(0, 15).join(',');

  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'instagram_scraper.py');
    const child = spawn('python3', [
      scriptPath,
      '--keywords', keywords,
      '--hashtags', hashtags,
      '--max', String(maxLeads),
    ]);

    const lines = [];
    let stderr = '';

    child.stdout.on('data', chunk => {
      chunk.toString().split('\n').filter(Boolean).forEach(l => lines.push(l));
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        console.error(`[instagram] Script exited ${code}: ${stderr.slice(0, 300)}`);
        return resolve([]);
      }
      const posts = [];
      for (const line of lines) {
        try {
          const post = JSON.parse(line);
          if (post.id && post._subreddit === 'instagram') posts.push(post);
        } catch { /* skip malformed lines */ }
      }
      console.log(`[instagram] Total collected: ${posts.length}`);
      resolve(posts);
    });

    child.on('error', err => {
      console.error(`[instagram] Spawn error: ${err.message}`);
      resolve([]);
    });
  });
}

module.exports = { fetchInstagramLeads, buildDealerHashtags, LIFE_EVENT_KEYWORDS };
