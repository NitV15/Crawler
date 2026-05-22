const { buildSubredditList, CITY_SUBREDDIT_MAP, INDIA_FALLBACK_SUBREDDITS } = require('../subreddits');

const faridabadDealer = { city: 'Faridabad', state: 'Haryana', industry_category: 'Electronics & Gadgets', custom_subreddits: '' };
const mumbaiDealer = { city: 'Mumbai', state: 'Maharashtra', industry_category: 'Furniture & Home Decor', custom_subreddits: 'mumbaifoodies' };
const unknownCityDealer = { city: 'Vaishali', state: 'Bihar', industry_category: 'Other', custom_subreddits: '' };

test('maps known city to its subreddits', () => {
  const list = buildSubredditList([faridabadDealer]);
  expect(list).toContain('Faridabad');
});

test('NCR cities include DelhiNCR', () => {
  const list = buildSubredditList([faridabadDealer]);
  expect(list).toContain('DelhiNCR');
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
  const dealer = { city: 'Delhi', state: 'Delhi (NCT)', industry_category: 'Other', custom_subreddits: 'r/delhi, r/DelhiNCR' };
  const list = buildSubredditList([dealer]);
  expect(list).toContain('delhi');
  expect(list).not.toContain('r/delhi');
});

test('returns array for no dealers', () => {
  const list = buildSubredditList([]);
  expect(Array.isArray(list)).toBe(true);
});

test('adds category subreddits for Automotive', () => {
  const dealer = { city: 'Delhi', state: 'Delhi (NCT)', industry_category: 'Automotive', custom_subreddits: '' };
  const list = buildSubredditList([dealer]);
  expect(list).toContain('CarsIndia');
  expect(list).toContain('IndiaBikes');
});

test('adds category subreddits for Finance', () => {
  const dealer = { city: 'Mumbai', state: 'Maharashtra', industry_category: 'Finance & Insurance', custom_subreddits: '' };
  const list = buildSubredditList([dealer]);
  expect(list).toContain('IndiaInvestments');
  expect(list).toContain('personalfinanceindia');
});

test('adds category subreddits for Real Estate', () => {
  const dealer = { city: 'Pune', state: 'Maharashtra', industry_category: 'Real Estate', custom_subreddits: '' };
  const list = buildSubredditList([dealer]);
  expect(list).toContain('realestateindia');
});

test('includes IndianBuySell for all dealers', () => {
  const list = buildSubredditList([faridabadDealer]);
  expect(list).toContain('IndianBuySell');
});

test('maps multiple cities without duplicates', () => {
  const delhi = { city: 'Delhi', state: 'Delhi (NCT)', industry_category: 'Other', custom_subreddits: '' };
  const noida = { city: 'Noida', state: 'Uttar Pradesh', industry_category: 'Other', custom_subreddits: '' };
  const list = buildSubredditList([delhi, noida]);
  // DelhiNCR comes from both cities — should appear once
  expect(list.filter(s => s === 'DelhiNCR')).toHaveLength(1);
});
