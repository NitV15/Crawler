jest.mock('../db');
jest.mock('../matcher');
jest.mock('../mailer');
jest.mock('../prefilter');
jest.mock('../subreddits');
jest.mock('../indiamart-fetcher');
jest.mock('../instagram-fetcher');

const { startCrawler, stopCrawler, getCrawlerStatus, checkSubscription } = require('../crawler');
const db = require('../db');
const { processPostBatch } = require('../matcher');
const { sendLeadEmail } = require('../mailer');
const { shouldCheckPost } = require('../prefilter');
const { buildSubredditList } = require('../subreddits');
const { fetchIndiaMartLeads } = require('../indiamart-fetcher');
const { fetchInstagramLeads } = require('../instagram-fetcher');

const fakeDb = {};
const freeDealer = {
  id: 1, name: 'Travel Co', emails: 'a@b.com',
  industry_category: 'Travel & Tourism', lead_count: 0,
  subscription_status: 'free', subscription_expires_at: null,
};

function mockFetch(posts) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      data: {
        children: posts.map(p => ({
          data: {
            id: p.id || 'testid',
            title: p.title || '',
            selftext: p.text || '',
            permalink: `/r/india/${p.id || 'testid'}`,
            created_utc: p.created_utc !== undefined ? p.created_utc : Math.floor(Date.now() / 1000),
          },
        })),
      },
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.openDb.mockReturnValue(fakeDb);
  db.getActiveDealers.mockReturnValue([freeDealer]);
  db.getDealer.mockReturnValue(freeDealer);
  db.saveLead.mockImplementation(() => {});
  db.saveFetchedPost.mockImplementation(() => {});
  db.incrementDealerLeadCount.mockImplementation(() => {});
  db.resetDealerSubscription.mockImplementation(() => {});
  db.isSeenPost.mockReturnValue(false);
  db.markPostSeen.mockImplementation(() => {});
  sendLeadEmail.mockResolvedValue();
  shouldCheckPost.mockReturnValue(true);
  buildSubredditList.mockReturnValue(['india']);
  processPostBatch.mockResolvedValue([]);
  fetchIndiaMartLeads.mockResolvedValue([]);
  fetchInstagramLeads.mockResolvedValue([]);
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
  test('returns skip for lead_count 3', () => {
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

describe('getCrawlerStatus', () => {
  test('returns object with required fields', () => {
    const status = getCrawlerStatus();
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('postsCollected');
    expect(status).toHaveProperty('leadsFound');
    expect(status).toHaveProperty('emailsSent');
    expect(status).toHaveProperty('lastBatchAt');
    expect(status).toHaveProperty('currentSource');
  });
});

describe('startCrawler + stopCrawler', () => {
  test('sets running to false after stopCrawler is called', async () => {
    mockFetch([]);
    processPostBatch.mockImplementation(async () => { stopCrawler(); return []; });
    await startCrawler(fakeDb);
    expect(getCrawlerStatus().running).toBe(false);
  });

  test('skips posts older than 5 days', async () => {
    const oldUtc = Math.floor(Date.now() / 1000) - 6 * 86400;
    mockFetch([{ id: 'old1', title: 'Old post', created_utc: oldUtc }]);
    processPostBatch.mockImplementation(async (posts) => { stopCrawler(); return []; });
    await startCrawler(fakeDb);
    const allPostArgs = processPostBatch.mock.calls.flatMap(call => call[0] || []);
    expect(allPostArgs.find(p => p.post_id === 'reddit_old1')).toBeUndefined();
  });

  test('skips already seen posts via isSeenPost', async () => {
    db.isSeenPost.mockReturnValue(true);
    mockFetch([{ id: 'seen1', title: 'Already seen' }]);
    processPostBatch.mockImplementation(async () => { stopCrawler(); return []; });
    await startCrawler(fakeDb);
    const allPostArgs = processPostBatch.mock.calls.flatMap(call => call[0] || []);
    expect(allPostArgs.find(p => p.post_id === 'reddit_seen1')).toBeUndefined();
  });

  test('calls markPostSeen for new posts', async () => {
    mockFetch([{ id: 'p1', title: 'Fresh post' }]);
    processPostBatch.mockImplementation(async () => { stopCrawler(); return []; });
    await startCrawler(fakeDb);
    expect(db.markPostSeen).toHaveBeenCalledWith(fakeDb, 'reddit_p1');
  });

  test('calls saveFetchedPost for new posts', async () => {
    mockFetch([{ id: 'p2', title: 'Fresh post 2' }]);
    processPostBatch.mockImplementation(async () => { stopCrawler(); return []; });
    await startCrawler(fakeDb);
    expect(db.saveFetchedPost).toHaveBeenCalled();
  });

  test('sends email and increments lead_count for matched free-tier lead', async () => {
    mockFetch([{ id: 'x1', title: 'Need wardrobe' }]);
    processPostBatch.mockImplementation(async (posts) => {
      stopCrawler();
      return [{
        post_id: posts[0].post_id,
        is_lead: true, is_hiring_post: false,
        lead_category: 'Furniture & Home Decor',
        what_to_sell: 'wardrobe', post_location: 'Faridabad',
        suggested_reply: 'We can help', matched_dealer_ids: [1],
      }];
    });
    await startCrawler(fakeDb);
    expect(sendLeadEmail).toHaveBeenCalledWith(expect.objectContaining({ includeSubscribeFooter: false }));
    expect(db.incrementDealerLeadCount).toHaveBeenCalledWith(fakeDb, 1);
  });

  test('sends email with subscribe footer when lead_count is 2', async () => {
    db.getDealer.mockReturnValue({ ...freeDealer, lead_count: 2 });
    mockFetch([{ id: 'x2', title: 'Need sofa' }]);
    processPostBatch.mockImplementation(async (posts) => {
      stopCrawler();
      return [{
        post_id: posts[0].post_id,
        is_lead: true, is_hiring_post: false,
        lead_category: 'Furniture & Home Decor',
        what_to_sell: 'sofa', post_location: null,
        suggested_reply: 'We have sofas', matched_dealer_ids: [1],
      }];
    });
    await startCrawler(fakeDb);
    expect(sendLeadEmail).toHaveBeenCalledWith(expect.objectContaining({ includeSubscribeFooter: true }));
  });

  test('saves unmatched lead when matched_dealer_ids is empty', async () => {
    mockFetch([{ id: 'u1', title: 'Need wardrobe' }]);
    processPostBatch.mockImplementation(async (posts) => {
      stopCrawler();
      return [{
        post_id: posts[0].post_id,
        is_lead: true, is_hiring_post: false,
        lead_category: 'Furniture & Home Decor',
        what_to_sell: 'wardrobe', post_location: null,
        suggested_reply: 'We can help', matched_dealer_ids: [],
      }];
    });
    await startCrawler(fakeDb);
    expect(db.saveLead).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ status: 'unmatched', dealerId: null }));
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });

  test('discards hiring posts without saving lead or emailing', async () => {
    mockFetch([{ id: 'h1', title: 'Hiring developers' }]);
    processPostBatch.mockImplementation(async (posts) => {
      stopCrawler();
      return [{ post_id: posts[0].post_id, is_lead: true, is_hiring_post: true }];
    });
    await startCrawler(fakeDb);
    expect(db.saveLead).not.toHaveBeenCalled();
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });

  test('resets expired subscription and saves lead as unmatched', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    db.getDealer.mockReturnValue({ ...freeDealer, subscription_status: 'active', subscription_expires_at: past, lead_count: 5 });
    mockFetch([{ id: 'e1', title: 'Need gym' }]);
    processPostBatch.mockImplementation(async (posts) => {
      stopCrawler();
      return [{
        post_id: posts[0].post_id,
        is_lead: true, is_hiring_post: false,
        lead_category: 'Fitness & Gym', what_to_sell: 'membership',
        post_location: null, suggested_reply: 'Join us', matched_dealer_ids: [1],
      }];
    });
    await startCrawler(fakeDb);
    expect(db.resetDealerSubscription).toHaveBeenCalledWith(fakeDb, 1);
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });
});
