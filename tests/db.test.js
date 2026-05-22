const { openDb, addDealer, saveLead, getActiveDealers,
        addPayment, getPayments, verifyPayment, rejectPayment,
        getUnmatchedLeads, assignLead,
        incrementDealerLeadCount, resetDealerSubscription,
        activateDealerSubscription, getDealer } = require('../db');

let db;
const dealer = {
  name: 'Test Co', emails: 'a@b.com', industry_category: 'Furniture & Home Decor',
  services: 'chairs tables', target_customers: 'offices', keywords: 'chair,table',
  state: 'Haryana', city: 'Faridabad', service_areas: 'Sector 15', custom_subreddits: 'Faridabad'
};

beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); });

test('openDb creates dealers with new columns', () => {
  const cols = db.prepare('PRAGMA table_info(dealers)').all().map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining([
    'industry_category','services','target_customers','keywords','state','city',
    'service_areas','custom_subreddits','lead_count','subscription_status','subscription_expires_at'
  ]));
});

test('openDb creates leads with nullable dealer_id and new columns', () => {
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['what_to_sell','lead_category','post_location','status']));
});

test('openDb creates payments table', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  expect(tables).toContain('payments');
});

test('addDealer stores new fields', () => {
  addDealer(db, dealer);
  const d = db.prepare('SELECT * FROM dealers WHERE name = ?').get('Test Co');
  expect(d.industry_category).toBe('Furniture & Home Decor');
  expect(d.city).toBe('Faridabad');
  expect(d.state).toBe('Haryana');
  expect(d.service_areas).toBe('Sector 15');
  expect(d.lead_count).toBe(0);
  expect(d.subscription_status).toBe('free');
});

test('saveLead allows null dealer_id for unmatched leads', () => {
  saveLead(db, {
    dealerId: null, redditPostId: 'abc', postTitle: 'test',
    postText: 'body', postUrl: 'http://x.com', subreddit: 'india',
    matchReason: null, suggestedReply: 'hi', whatToSell: 'chairs',
    leadCategory: 'Furniture & Home Decor', postLocation: 'Faridabad', status: 'unmatched'
  });
  const lead = db.prepare('SELECT * FROM leads WHERE reddit_post_id = ?').get('abc');
  expect(lead.dealer_id).toBeNull();
  expect(lead.status).toBe('unmatched');
  expect(lead.what_to_sell).toBe('chairs');
});

test('getDealer returns dealer by id', () => {
  const result = addDealer(db, dealer);
  const d = getDealer(db, result.lastInsertRowid);
  expect(d.name).toBe('Test Co');
});

test('incrementDealerLeadCount increments lead_count', () => {
  const { lastInsertRowid: id } = addDealer(db, dealer);
  incrementDealerLeadCount(db, id);
  incrementDealerLeadCount(db, id);
  expect(getDealer(db, id).lead_count).toBe(2);
});

test('activateDealerSubscription sets status and resets lead_count', () => {
  const { lastInsertRowid: id } = addDealer(db, dealer);
  incrementDealerLeadCount(db, id);
  activateDealerSubscription(db, id);
  const d = getDealer(db, id);
  expect(d.subscription_status).toBe('active');
  expect(d.lead_count).toBe(0);
  expect(d.subscription_expires_at).toBeTruthy();
});

test('resetDealerSubscription resets to free', () => {
  const { lastInsertRowid: id } = addDealer(db, dealer);
  activateDealerSubscription(db, id);
  resetDealerSubscription(db, id);
  const d = getDealer(db, id);
  expect(d.subscription_status).toBe('free');
  expect(d.lead_count).toBe(0);
});

test('addPayment and getPayments', () => {
  const { lastInsertRowid: id } = addDealer(db, dealer);
  addPayment(db, { dealerId: id, utrNumber: 'UTR123' });
  const payments = getPayments(db);
  expect(payments[0].utr_number).toBe('UTR123');
  expect(payments[0].status).toBe('pending');
  expect(payments[0].dealer_name).toBe('Test Co');
});

test('verifyPayment sets status to verified', () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealer);
  const { lastInsertRowid: payId } = addPayment(db, { dealerId, utrNumber: 'UTR456' });
  verifyPayment(db, payId);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(payId);
  expect(p.status).toBe('verified');
  expect(p.verified_at).toBeTruthy();
});

test('rejectPayment sets status to rejected', () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealer);
  const { lastInsertRowid: payId } = addPayment(db, { dealerId, utrNumber: 'UTR789' });
  rejectPayment(db, payId);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(payId);
  expect(p.status).toBe('rejected');
});

test('getUnmatchedLeads returns only unmatched leads', () => {
  saveLead(db, {
    dealerId: null, redditPostId: 'u1', postTitle: 'unmatched', postText: '',
    postUrl: 'http://x.com', subreddit: 'india', matchReason: null,
    suggestedReply: 'hi', whatToSell: 'x', leadCategory: 'Other', postLocation: null, status: 'unmatched'
  });
  const leads = getUnmatchedLeads(db);
  expect(leads).toHaveLength(1);
  expect(leads[0].reddit_post_id).toBe('u1');
});

test('assignLead updates status and dealer_id', () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealer);
  saveLead(db, {
    dealerId: null, redditPostId: 'u2', postTitle: 'test', postText: '',
    postUrl: 'http://x.com', subreddit: 'india', matchReason: null,
    suggestedReply: 'hi', whatToSell: 'x', leadCategory: 'Other', postLocation: null, status: 'unmatched'
  });
  const lead = db.prepare("SELECT id FROM leads WHERE reddit_post_id = 'u2'").get();
  assignLead(db, lead.id, dealerId);
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
  expect(updated.dealer_id).toBe(dealerId);
  expect(updated.status).toBe('assigned');
});
