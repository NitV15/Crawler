const { openDb, getActiveDealers, isSeenPost, markPostSeen, saveLead, addDealer, getLeads, getDealers } = require('../db');

describe('db', () => {
  let db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  test('seeds test dealer on first open', () => {
    const dealers = getActiveDealers(db);
    expect(dealers).toHaveLength(1);
    expect(dealers[0].name).toBe('Nitin Tanwar (Test)');
    expect(dealers[0].emails).toContain('tanwarnitin.v15@gmail.com');
  });

  test('isSeenPost returns false for unknown post', () => {
    expect(isSeenPost(db, 'abc123')).toBe(false);
  });

  test('markPostSeen makes isSeenPost return true', () => {
    markPostSeen(db, 'abc123');
    expect(isSeenPost(db, 'abc123')).toBe(true);
  });

  test('markPostSeen is idempotent', () => {
    markPostSeen(db, 'abc123');
    expect(() => markPostSeen(db, 'abc123')).not.toThrow();
  });

  test('saveLead stores a lead with all fields', () => {
    const dealer = getActiveDealers(db)[0];
    saveLead(db, {
      dealerId: dealer.id,
      redditPostId: 'post1',
      postTitle: 'I want to travel',
      postText: 'Planning a big trip',
      postUrl: 'https://reddit.com/r/india/comments/post1',
      subreddit: 'india',
      matchReason: 'User wants to travel',
      suggestedReply: 'We can help with your trip!',
    });
    const leads = getLeads(db);
    expect(leads).toHaveLength(1);
    expect(leads[0].post_title).toBe('I want to travel');
    expect(leads[0].dealer_name).toBe('Nitin Tanwar (Test)');
  });

  test('addDealer adds a new dealer', () => {
    addDealer(db, {
      name: 'Gym Corp',
      emails: 'gym@test.com',
      industry: 'Gym Equipment',
      description: 'We sell treadmills and dumbbells',
    });
    expect(getActiveDealers(db)).toHaveLength(2);
  });

  test('getDealers returns all dealers including inactive', () => {
    const all = getDealers(db);
    expect(all).toHaveLength(1);
  });
});
