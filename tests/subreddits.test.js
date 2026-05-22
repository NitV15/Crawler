const { buildSubredditList, CITY_SUBREDDIT_MAP, INDIA_FALLBACK_SUBREDDITS } = require('../subreddits');

const faridabadDealer = { city: 'Faridabad', state: 'Haryana', custom_subreddits: '' };
const mumbaiDealer = { city: 'Mumbai', state: 'Maharashtra', custom_subreddits: 'mumbaifoodies' };
const unknownCityDealer = { city: 'Vaishali', state: 'Bihar', custom_subreddits: '' };

test('maps known city to its subreddits', () => {
  const list = buildSubredditList([faridabadDealer]);
  expect(list).toContain('Faridabad');
});

test('falls back to state subreddit for unknown city', () => {
  const list = buildSubredditList([unknownCityDealer]);
  expect(list).toContain('bihar');
});

test('includes dealer custom_subreddits', () => {
  const list = buildSubredditList([mumbaiDealer]);
  expect(list).toContain('mumbaifoodies');
});

test('deduplicates subreddits', () => {
  const list = buildSubredditList([faridabadDealer, faridabadDealer]);
  expect(list.filter(s => s === 'Faridabad')).toHaveLength(1);
});

test('appends India fallback subreddits', () => {
  const list = buildSubredditList([faridabadDealer]);
  for (const sub of INDIA_FALLBACK_SUBREDDITS) {
    expect(list).toContain(sub);
  }
});

test('strips r/ prefix from custom_subreddits', () => {
  const dealer = { city: 'Delhi', state: 'Delhi (NCT)', custom_subreddits: 'r/delhi, r/DelhiNCR' };
  const list = buildSubredditList([dealer]);
  expect(list).toContain('delhi');
  expect(list).not.toContain('r/delhi');
});

test('returns array for no dealers', () => {
  const list = buildSubredditList([]);
  expect(Array.isArray(list)).toBe(true);
});
