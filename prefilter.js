const INTENT_PHRASES = [
  'looking for', 'need a', 'need some', 'recommend', 'recommendations',
  'suggestions', 'budget', 'want to', 'planning to', 'best for',
  'where can i', 'how much', 'help me', 'which one', 'considering',
  'thinking of', 'thinking about', 'hire', 'buy', 'purchase',
  'cost of', 'price of', 'affordable', 'cheap', 'anyone know',
  'can you suggest', 'looking to',
];

const STOP_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'for', 'in', 'of', 'to', 'with',
  'is', 'are', 'was', 'it', 'i', 'we', 'my', 'our', 'your', 'by',
  'at', 'on', 'be', 'has', 'had', 'have', 'do', 'did', 'not', 'no',
]);

function extractDealerKeywords(dealers) {
  const keywords = new Set();
  for (const dealer of dealers) {
    const fields = [dealer.industry_category, dealer.services, dealer.keywords].join(' ');
    fields.toLowerCase().split(/[\s,&\/]+/).forEach(w => {
      if (w.length > 2 && !STOP_WORDS.has(w)) keywords.add(w);
    });
  }
  return [...keywords];
}

function shouldCheckPost(post, dealers) {
  const text = `${post.title || ''} ${post.text || ''}`.toLowerCase();
  const intentMatch = INTENT_PHRASES.some(phrase => text.includes(phrase));
  if (intentMatch) return true;
  const domainMatch = extractDealerKeywords(dealers).some(kw => text.includes(kw));
  return domainMatch;
}

module.exports = { shouldCheckPost, extractDealerKeywords, INTENT_PHRASES };
