process.env.DB_PATH = ':memory:';

let db;
beforeEach(() => {
  // Reset global test DB so each test starts with a clean slate
  if (global.__testDb) { global.__testDb = null; }
  jest.resetModules();
  db = require('../db');
  db.initDb();
});

test('initDb creates all 8 tables', () => {
  const tables = db._getDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  expect(tables).toEqual(expect.arrayContaining([
    'candidate_payments','candidates','dealers','fetched_jobs',
    'fetched_posts','job_matches','leads','payments',
  ]));
});

test('initDb seeds seenPosts/seenJobs/seenFetchedJobs from existing rows', () => {
  db._getDb().prepare("INSERT INTO fetched_posts (post_id,fetched_at) VALUES ('p1','2026-01-01')").run();
  db._getDb().prepare("INSERT INTO job_matches (candidate_id,indeed_job_id,emailed_at) VALUES ('1','j1','2026-01-01')").run();
  db._getDb().prepare("INSERT INTO fetched_jobs (job_id,fetched_at) VALUES ('fj1','2026-01-01')").run();
  jest.resetModules();
  const db2 = require('../db');
  db2.initDb();
  expect(db2.isSeenPost('p1')).toBe(true);
  expect(db2.isSeenJob('j1', '1')).toBe(true);
  expect(db2.isSeenFetchedJob('fj1')).toBe(true);
});

// ─── Dealers ───────────────────────────────────────────────────────────────────

const dealerData = {
  name: 'TravelCo', emails: 'a@test.com', industry_category: 'Travel',
  services: 'Tours', target_customers: 'Families', keywords: 'travel',
  state: 'MH', city: 'Mumbai', service_areas: '', custom_subreddits: '',
};

test('addDealer returns id, getDealer finds it', () => {
  const id = db.addDealer(dealerData);
  const d = db.getDealer(id);
  expect(d.name).toBe('TravelCo');
  expect(d.subscription_status).toBe('free');
  expect(d.active).toBe(1);
  expect(d.lead_count).toBe(0);
});

test('getDealers returns all, getActiveDealers filters by active=1', () => {
  db.addDealer(dealerData);
  db.addDealer({ ...dealerData, name: 'Other' });
  expect(db.getDealers()).toHaveLength(2);
  expect(db.getActiveDealers()).toHaveLength(2);
  db.toggleDealer(1, false);
  expect(db.getActiveDealers()).toHaveLength(1);
});

test('updateDealer changes fields', () => {
  const id = db.addDealer(dealerData);
  db.updateDealer(id, { ...dealerData, city: 'Pune' });
  expect(db.getDealer(id).city).toBe('Pune');
});

test('deleteDealer removes row', () => {
  const id = db.addDealer(dealerData);
  db.deleteDealer(id);
  expect(db.getDealer(id)).toBeNull();
});

test('incrementDealerLeadCount increments by 1', () => {
  const id = db.addDealer(dealerData);
  db.incrementDealerLeadCount(id);
  db.incrementDealerLeadCount(id);
  expect(db.getDealer(id).lead_count).toBe(2);
});

test('activateDealerSubscription sets active status and resets lead_count', () => {
  const id = db.addDealer(dealerData);
  db.incrementDealerLeadCount(id);
  db.activateDealerSubscription(id);
  const d = db.getDealer(id);
  expect(d.subscription_status).toBe('active');
  expect(d.lead_count).toBe(0);
  expect(new Date(d.subscription_expires_at) > new Date()).toBe(true);
});

test('resetDealerSubscription clears subscription', () => {
  const id = db.addDealer(dealerData);
  db.activateDealerSubscription(id);
  db.resetDealerSubscription(id);
  const d = db.getDealer(id);
  expect(d.subscription_status).toBe('free');
  expect(d.subscription_expires_at).toBe('');
});
