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
  // placeholder — implemented in Task 2
  return [];
}

module.exports = { fetchInstagramLeads, buildDealerHashtags, LIFE_EVENT_KEYWORDS };
