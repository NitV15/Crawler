jest.mock('@anthropic-ai/sdk');
const Anthropic = require('@anthropic-ai/sdk');
const { matchDealers, searchDealers } = require('../dealer-matcher');
const { openDb, addDealer } = require('../db');

let db;
beforeEach(() => {
  db = openDb(':memory:');
  jest.clearAllMocks();
});
afterEach(() => db.close());

function mockClaudeResponse(matched_dealer_ids) {
  const mockCreate = jest.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ matched_dealer_ids }) }]
  });
  Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));
  return mockCreate;
}

const dealerData = {
  name: 'Furniture Co', emails: 'a@b.com', industry_category: 'Furniture & Home Decor',
  services: 'chairs', keywords: 'chair', state: 'Haryana', city: 'Faridabad',
  service_areas: 'Sector 15', custom_subreddits: ''
};

test('returns matched dealer ids from Claude response', async () => {
  const { lastInsertRowid: id } = addDealer(db, dealerData);
  mockClaudeResponse([id]);
  const ids = await matchDealers(
    { lead_category: 'Furniture & Home Decor', post_location: 'Faridabad', what_to_sell: 'wardrobe', subreddit: 'Faridabad' },
    db
  );
  expect(ids).toEqual([id]);
});

test('returns empty array when no dealers match', async () => {
  mockClaudeResponse([]);
  const ids = await matchDealers(
    { lead_category: 'Automotive', post_location: 'Mumbai', what_to_sell: 'car', subreddit: 'mumbai' },
    db
  );
  expect(ids).toEqual([]);
});

test('searchDealers filters by category', () => {
  addDealer(db, {
    name: 'Travel Co', emails: 'a@b.com', industry_category: 'Travel & Tourism',
    services: 'tours', keywords: 'travel', state: 'Delhi (NCT)', city: 'Delhi',
    service_areas: '', custom_subreddits: ''
  });
  const results = searchDealers(db, { category: 'Travel & Tourism' });
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('Travel Co');
});

test('searchDealers filters by city', () => {
  addDealer(db, {
    name: 'Local Co', emails: 'a@b.com', industry_category: 'Other',
    services: 'misc', keywords: 'misc', state: 'Haryana', city: 'Faridabad',
    service_areas: '', custom_subreddits: ''
  });
  const results = searchDealers(db, { city: 'Faridabad' });
  expect(results[0].name).toBe('Local Co');
});
