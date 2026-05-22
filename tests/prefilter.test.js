const { shouldCheckPost, extractDealerKeywords } = require('../prefilter');

const furnitureDealer = {
  industry_category: 'Furniture & Home Decor',
  services: 'office chairs wooden tables modular wardrobes',
  keywords: 'chair,sofa,wardrobe,table,furniture'
};

test('passes post with intent phrase', () => {
  expect(shouldCheckPost({ title: 'Looking for a good laptop', text: '' }, [])).toBe(true);
});

test('passes post with dealer domain keyword', () => {
  expect(shouldCheckPost({ title: 'My new sofa arrived', text: '' }, [furnitureDealer])).toBe(true);
});

test('blocks pure discussion post with no dealers', () => {
  expect(shouldCheckPost({ title: 'Modi government did X today', text: '' }, [])).toBe(false);
});

test('blocks status update', () => {
  expect(shouldCheckPost({ title: 'Just came back from vacation!', text: 'Had a great time.' }, [])).toBe(false);
});

test('passes hiring post so Gemini can detect is_hiring_post=true', () => {
  expect(shouldCheckPost({ title: 'Looking for a software developer', text: '' }, [])).toBe(true);
});

test('checks post text as well as title', () => {
  expect(shouldCheckPost({ title: 'Help needed', text: 'I want to buy a chair for my office' }, [furnitureDealer])).toBe(true);
});

test('extractDealerKeywords returns lowercase terms from service fields', () => {
  const kws = extractDealerKeywords([furnitureDealer]);
  expect(kws).toEqual(expect.arrayContaining(['chair', 'sofa', 'wardrobe', 'table', 'furniture']));
});

test('extractDealerKeywords strips short stop-words', () => {
  const kws = extractDealerKeywords([furnitureDealer]);
  expect(kws).not.toContain('a');
  expect(kws).not.toContain('or');
});
