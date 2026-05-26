jest.mock('../db');
jest.mock('../matcher');
jest.mock('../dealer-matcher');
jest.mock('../mailer');
jest.mock('../prefilter');
jest.mock('../subreddits');
jest.mock('../instagram-fetcher');

const { runCrawl, checkSubscription } = require('../crawler');
const db = require('../db');
const { identifyLead } = require('../matcher');
const { fetchInstagramLeads } = require('../instagram-fetcher');
const { matchDealers } = require('../dealer-matcher');
const { sendLeadEmail } = require('../mailer');
const { shouldCheckPost } = require('../prefilter');
const { buildSubredditList } = require('../subreddits');

const fakeDb = {};
const freeDealer = {
  id: 1, name: 'Travel Co', emails: 'a@b.com',
  industry_category: 'Travel & Tourism', lead_count: 0,
  subscription_status: 'free', subscription_expires_at: null
};

function mockFetch(posts) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { children: posts.map(p => ({ data: p })) } }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.openDb.mockReturnValue(fakeDb);
  db.getActiveDealers.mockReturnValue([freeDealer]);
  db.getDealer.mockReturnValue(freeDealer);
  db.isSeenPost.mockReturnValue(false);
  db.markPostSeen.mockImplementation(() => {});
  db.saveLead.mockImplementation(() => {});
  db.incrementDealerLeadCount.mockImplementation(() => {});
  db.resetDealerSubscription.mockImplementation(() => {});
  sendLeadEmail.mockResolvedValue();
  shouldCheckPost.mockReturnValue(true);
  buildSubredditList.mockReturnValue(['india']);
  identifyLead.mockResolvedValue({ is_lead: false, is_hiring_post: false });
  fetchInstagramLeads.mockResolvedValue([]);
  matchDealers.mockResolvedValue([]);
});

describe('checkSubscription', () => {
  test('returns send for lead_count 0', () => {
    expect(checkSubscription({ lead_count: 0, subscription_status: 'free', subscription_expires_at: null })).toBe('send');
  });
  test('returns send for lead_count 1', () => {
    expect(checkSubscription({ lead_count: 1, subscription_status: 'free', subscription_expires_at: null })).toBe('send');
  });
  test('returns send_with_footer for lead_count 2', () => {
    expect(checkSubscription({ lead_count: 2, subscription_status: 'free', subscription_expires_at: null })).toBe('send_with_footer');
  });
  test('returns skip for lead_count 3 on free tier', () => {
    expect(checkSubscription({ lead_count: 3, subscription_status: 'free', subscription_expires_at: null })).toBe('skip');
  });
  test('returns send for active unexpired subscription', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(checkSubscription({ lead_count: 99, subscription_status: 'active', subscription_expires_at: future })).toBe('send');
  });
  test('returns expired for active but expired subscription', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(checkSubscription({ lead_count: 5, subscription_status: 'active', subscription_expires_at: past })).toBe('expired');
  });
});

describe('runCrawl', () => {
  test('returns early with zero counts when no active dealers', async () => {
    db.getActiveDealers.mockReturnValue([]);
    global.fetch = jest.fn();
    const result = await runCrawl(fakeDb);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.fetched).toBe(0);
  });

  test('marks posts seen even when not a lead', async () => {
    mockFetch([{ id: 'abc', title: 'Hello', selftext: '', permalink: '/r/india/abc' }]);
    await runCrawl(fakeDb);
    expect(db.markPostSeen).toHaveBeenCalledWith(fakeDb, 'abc');
  });

  test('skips already seen posts', async () => {
    db.isSeenPost.mockReturnValue(true);
    mockFetch([{ id: 'old', title: 'Old', selftext: '', permalink: '/r/india/old' }]);
    await runCrawl(fakeDb);
    expect(identifyLead).not.toHaveBeenCalled();
  });

  test('discards hiring posts', async () => {
    mockFetch([{ id: 'h1', title: 'Hiring devs', selftext: '', permalink: '/r/india/h1' }]);
    identifyLead.mockResolvedValue({ is_lead: true, is_hiring_post: true });
    await runCrawl(fakeDb);
    expect(matchDealers).not.toHaveBeenCalled();
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });

  test('saves unmatched lead when no dealers matched', async () => {
    mockFetch([{ id: 'u1', title: 'Need wardrobe', selftext: '', permalink: '/r/india/u1' }]);
    identifyLead.mockResolvedValue({
      is_lead: true, is_hiring_post: false,
      lead_category: 'Furniture & Home Decor', what_to_sell: 'wardrobe',
      suggested_reply: 'We can help', post_location: null
    });
    matchDealers.mockResolvedValue([]);
    await runCrawl(fakeDb);
    expect(db.saveLead).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ status: 'unmatched', dealerId: null }));
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });

  test('sends email and increments lead_count for free tier send', async () => {
    mockFetch([{ id: 'x1', title: 'Need wardrobe', selftext: '', permalink: '/r/Faridabad/x1' }]);
    identifyLead.mockResolvedValue({
      is_lead: true, is_hiring_post: false,
      lead_category: 'Furniture & Home Decor', what_to_sell: 'wardrobe',
      suggested_reply: 'We can help', post_location: 'Faridabad'
    });
    matchDealers.mockResolvedValue([1]);
    await runCrawl(fakeDb);
    expect(sendLeadEmail).toHaveBeenCalledWith(expect.objectContaining({ includeSubscribeFooter: false }));
    expect(db.incrementDealerLeadCount).toHaveBeenCalledWith(fakeDb, 1);
  });

  test('sends email with subscribe footer at lead_count 2', async () => {
    const dealer2 = { ...freeDealer, lead_count: 2 };
    db.getDealer.mockReturnValue(dealer2);
    matchDealers.mockResolvedValue([1]);
    mockFetch([{ id: 'x2', title: 'Need sofa', selftext: '', permalink: '/r/india/x2' }]);
    identifyLead.mockResolvedValue({
      is_lead: true, is_hiring_post: false, lead_category: 'Furniture & Home Decor',
      what_to_sell: 'sofa', suggested_reply: 'We have sofas', post_location: null
    });
    await runCrawl(fakeDb);
    expect(sendLeadEmail).toHaveBeenCalledWith(expect.objectContaining({ includeSubscribeFooter: true }));
  });

  test('saves as unmatched and resets when subscription expired', async () => {
    const expiredDealer = { ...freeDealer, lead_count: 5, subscription_status: 'active', subscription_expires_at: new Date(Date.now() - 1000).toISOString() };
    db.getDealer.mockReturnValue(expiredDealer);
    matchDealers.mockResolvedValue([1]);
    mockFetch([{ id: 'x3', title: 'Need gym', selftext: '', permalink: '/r/india/x3' }]);
    identifyLead.mockResolvedValue({
      is_lead: true, is_hiring_post: false, lead_category: 'Fitness & Gym',
      what_to_sell: 'membership', suggested_reply: 'Join us', post_location: null
    });
    await runCrawl(fakeDb);
    expect(db.resetDealerSubscription).toHaveBeenCalledWith(fakeDb, 1);
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });

  test('returns summary object', async () => {
    mockFetch([]);
    const result = await runCrawl(fakeDb);
    expect(result).toEqual(expect.objectContaining({ fetched: 0, filtered: 0, leads: 0, emails: 0, unmatched: 0 }));
  });

  test('passes source=instagram to identifyLead for Instagram posts', async () => {
    const igPost = {
      id: 'ig_001', title: '', selftext: 'Just moved to Delhi!',
      permalink: 'https://www.instagram.com/p/abc/', _subreddit: 'instagram',
    };
    fetchInstagramLeads.mockResolvedValue([igPost]);
    mockFetch([]);
    identifyLead.mockResolvedValue({ is_lead: false, is_hiring_post: false });
    await runCrawl(fakeDb);
    expect(identifyLead).toHaveBeenCalledWith(expect.objectContaining({ source: 'instagram' }));
  });
});
