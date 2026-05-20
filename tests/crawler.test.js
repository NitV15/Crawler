jest.mock('snoowrap');
jest.mock('../db');
jest.mock('../matcher');
jest.mock('../mailer');

const Snoowrap = require('snoowrap');
const { runCrawl } = require('../crawler');
const db = require('../db');
const { matchPost } = require('../matcher');
const { sendLeadEmail } = require('../mailer');

const fakeDb = {};
const fakeDealer = { id: 1, name: 'Travel Co', industry: 'Travel', emails: 'test@test.com', description: 'Travel packages' };

function mockRedditPosts(posts) {
  Snoowrap.mockImplementation(() => ({
    getSubreddit: () => ({ getNew: jest.fn().mockResolvedValue(posts) }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  db.openDb.mockReturnValue(fakeDb);
  db.getActiveDealers.mockReturnValue([fakeDealer]);
  db.isSeenPost.mockReturnValue(false);
  db.markPostSeen.mockImplementation(() => {});
  db.saveLead.mockImplementation(() => {});
  sendLeadEmail.mockResolvedValue();
});

describe('runCrawl', () => {
  test('skips all subreddits when no active dealers', async () => {
    db.getActiveDealers.mockReturnValue([]);
    const mockGetSubreddit = jest.fn();
    Snoowrap.mockImplementation(() => ({ getSubreddit: mockGetSubreddit }));

    await runCrawl();
    expect(mockGetSubreddit).not.toHaveBeenCalled();
  });

  test('marks each new post as seen', async () => {
    mockRedditPosts([{ id: 'abc', title: 'Test', selftext: 'body', permalink: '/r/test/abc' }]);
    matchPost.mockResolvedValue({ matched: false });

    await runCrawl();
    expect(db.markPostSeen).toHaveBeenCalledWith(fakeDb, 'abc');
  });

  test('skips posts already in seen_posts', async () => {
    db.isSeenPost.mockReturnValue(true);
    mockRedditPosts([{ id: 'old', title: 'Old', selftext: 'body', permalink: '/r/test/old' }]);

    await runCrawl();
    expect(matchPost).not.toHaveBeenCalled();
  });

  test('saves lead and sends email when AI returns a match', async () => {
    mockRedditPosts([{ id: 'xyz', title: 'Love travelling', selftext: 'big trip planned', permalink: '/r/india/xyz' }]);
    matchPost.mockResolvedValue({ matched: true, dealer_id: 1, reason: 'Travel intent', suggested_reply: 'We can help!' });

    await runCrawl();

    expect(db.saveLead).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      dealerId: 1,
      redditPostId: 'xyz',
      subreddit: expect.any(String),
    }));
    expect(sendLeadEmail).toHaveBeenCalledWith(expect.objectContaining({
      dealer: fakeDealer,
      matchReason: 'Travel intent',
      suggestedReply: 'We can help!',
    }));
  });

  test('does not send email when no match', async () => {
    mockRedditPosts([{ id: 'nomatch', title: 'What is 2+2', selftext: '', permalink: '/r/AskReddit/nomatch' }]);
    matchPost.mockResolvedValue({ matched: false });

    await runCrawl();
    expect(sendLeadEmail).not.toHaveBeenCalled();
  });

  test('continues to next post if matcher throws', async () => {
    mockRedditPosts([
      { id: 'bad', title: 'Error post', selftext: '', permalink: '/r/test/bad' },
      { id: 'good', title: 'Good post', selftext: 'I want to travel', permalink: '/r/india/good' },
    ]);
    matchPost
      .mockRejectedValueOnce(new Error('Gemini timeout'))
      .mockResolvedValueOnce({ matched: false });

    await expect(runCrawl()).resolves.not.toThrow();
    expect(matchPost).toHaveBeenCalledTimes(2);
  });
});
