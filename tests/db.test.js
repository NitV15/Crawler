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

// ─── Candidates ────────────────────────────────────────────────────────────────

const candidateData = {
  name: 'Mitesh', emails: 'm@test.com', role: 'Backend Developer',
  skills: 'Node.js, SQL', experience_level: '3-5 yr',
  city: 'Ahmedabad', state: 'GJ', preferred_locations: 'Remote,Mumbai',
};

test('addCandidate returns id, getCandidate finds it', () => {
  const id = db.addCandidate(candidateData);
  const c = db.getCandidate(id);
  expect(c.name).toBe('Mitesh');
  expect(c.subscription_status).toBe('free');
  expect(c.active).toBe(1);
  expect(c.lead_count).toBe(0);
});

test('getActiveCandidates filters by active=1', () => {
  const id1 = db.addCandidate(candidateData);
  db.addCandidate({ ...candidateData, name: 'Krishan', emails: 'k@test.com' });
  expect(db.getActiveCandidates()).toHaveLength(2);
  db.toggleCandidate(id1, false);
  expect(db.getActiveCandidates()).toHaveLength(1);
});

test('updateCandidate changes fields', () => {
  const id = db.addCandidate(candidateData);
  db.updateCandidate(id, { ...candidateData, city: 'Surat' });
  expect(db.getCandidate(id).city).toBe('Surat');
});

test('deleteCandidate removes row', () => {
  const id = db.addCandidate(candidateData);
  db.deleteCandidate(id);
  expect(db.getCandidate(id)).toBeNull();
});

test('incrementCandidateLeadCount increments by 1', () => {
  const id = db.addCandidate(candidateData);
  db.incrementCandidateLeadCount(id);
  expect(db.getCandidate(id).lead_count).toBe(1);
});

test('activateCandidateSubscription sets active status, resets lead_count', () => {
  const id = db.addCandidate(candidateData);
  db.incrementCandidateLeadCount(id);
  db.activateCandidateSubscription(id);
  const c = db.getCandidate(id);
  expect(c.subscription_status).toBe('active');
  expect(c.lead_count).toBe(0);
  expect(new Date(c.subscription_expires_at) > new Date()).toBe(true);
});

test('resetCandidateSubscription clears subscription', () => {
  const id = db.addCandidate(candidateData);
  db.activateCandidateSubscription(id);
  db.resetCandidateSubscription(id);
  expect(db.getCandidate(id).subscription_status).toBe('free');
  expect(db.getCandidate(id).subscription_expires_at).toBe('');
});

// ─── Leads ─────────────────────────────────────────────────────────────────────

test('saveLead deduplicates by dealer_id + reddit_post_id', () => {
  db.saveLead({ dealerId: '1', redditPostId: 'r1', postTitle: 'T', postText: '', postUrl: 'u', subreddit: 's', matchReason: '', suggestedReply: '', whatToSell: '', leadCategory: '', postLocation: '', status: 'matched' });
  db.saveLead({ dealerId: '1', redditPostId: 'r1', postTitle: 'Dup', postText: '', postUrl: 'u', subreddit: 's', matchReason: '', suggestedReply: '', whatToSell: '', leadCategory: '', postLocation: '', status: 'matched' });
  expect(db.getLeads()).toHaveLength(1);
});

test('getLeads returns matched/assigned only', () => {
  db.saveLead({ dealerId: '1', redditPostId: 'r1', postTitle: '', postText: '', postUrl: '', subreddit: '', matchReason: '', suggestedReply: '', whatToSell: '', leadCategory: '', postLocation: '', status: 'matched' });
  db.saveLead({ dealerId: '1', redditPostId: 'r2', postTitle: '', postText: '', postUrl: '', subreddit: '', matchReason: '', suggestedReply: '', whatToSell: '', leadCategory: '', postLocation: '', status: 'unmatched' });
  expect(db.getLeads()).toHaveLength(1);
});

test('assignLead updates dealer_id and status', () => {
  db.saveLead({ dealerId: '1', redditPostId: 'r1', postTitle: '', postText: '', postUrl: '', subreddit: '', matchReason: '', suggestedReply: '', whatToSell: '', leadCategory: '', postLocation: '', status: 'unmatched' });
  const lead = db.getUnmatchedLeads()[0];
  db.assignLead(lead.id, '2');
  expect(db.getLead(lead.id).status).toBe('assigned');
  expect(db.getLead(lead.id).dealer_id).toBe('2');
});

// ─── Payments ──────────────────────────────────────────────────────────────────

test('addPayment and getPayment', () => {
  const id = db.addPayment({ dealerId: '1', utrNumber: 'UTR123' });
  const p = db.getPayment(id);
  expect(p.utr_number).toBe('UTR123');
  expect(p.status).toBe('pending');
});

test('verifyPayment sets status and verified_at', () => {
  const id = db.addPayment({ dealerId: '1', utrNumber: 'UTR456' });
  db.verifyPayment(id);
  expect(db.getPayment(id).status).toBe('verified');
});

test('rejectPayment sets status to rejected', () => {
  const id = db.addPayment({ dealerId: '1', utrNumber: 'UTR789' });
  db.rejectPayment(id);
  expect(db.getPayment(id).status).toBe('rejected');
});

// ─── Candidate Payments ────────────────────────────────────────────────────────

test('addCandidatePayment and verifyCandidatePayment', () => {
  const id = db.addCandidatePayment({ candidateId: '1', utrNumber: 'CUTR1' });
  db.verifyCandidatePayment(id);
  expect(db.getCandidatePayment(id).status).toBe('verified');
});

// ─── Fetched Posts ─────────────────────────────────────────────────────────────

test('saveFetchedPost deduplicates by post_id', () => {
  db.saveFetchedPost({ postId: 'p1', postTitle: 'T', postText: '', postUrl: 'u', subreddit: 'r' });
  db.saveFetchedPost({ postId: 'p1', postTitle: 'Dup', postText: '', postUrl: 'u', subreddit: 'r' });
  expect(db.getFetchedPosts()).toHaveLength(1);
  expect(db.isSeenPost('p1')).toBe(true);
});

test('getFetchedPost finds by id', () => {
  db.saveFetchedPost({ postId: 'p2', postTitle: 'T2', postText: '', postUrl: 'u', subreddit: 'r' });
  const posts = db.getFetchedPosts();
  expect(db.getFetchedPost(posts[0].id)).toBeTruthy();
});

// ─── Fetched Jobs ──────────────────────────────────────────────────────────────

test('saveFetchedJob deduplicates by job_id', () => {
  db.saveFetchedJob({ jobId: 'j1', jobTitle: 'Dev', company: 'Co', location: 'MH', jobUrl: 'u', snippet: 's' });
  db.saveFetchedJob({ jobId: 'j1', jobTitle: 'Dup', company: 'Co', location: 'MH', jobUrl: 'u', snippet: 's' });
  expect(db.getFetchedJobs()).toHaveLength(1);
  expect(db.isSeenFetchedJob('j1')).toBe(true);
});

test('batchSaveFetchedJobs inserts multiple, skips duplicates', () => {
  db.batchSaveFetchedJobs([
    { jobId: 'j1', jobTitle: 'A', company: 'Co', location: 'L', jobUrl: 'u', snippet: '' },
    { jobId: 'j2', jobTitle: 'B', company: 'Co', location: 'L', jobUrl: 'u', snippet: '' },
    { jobId: 'j1', jobTitle: 'Dup', company: 'Co', location: 'L', jobUrl: 'u', snippet: '' },
  ]);
  expect(db.getFetchedJobs()).toHaveLength(2);
});

test('getFetchedJobs(0) returns all rows, getFetchedJobs(1) returns 1', () => {
  db.saveFetchedJob({ jobId: 'j1', jobTitle: '', company: '', location: '', jobUrl: '', snippet: '' });
  db.saveFetchedJob({ jobId: 'j2', jobTitle: '', company: '', location: '', jobUrl: '', snippet: '' });
  expect(db.getFetchedJobs(0)).toHaveLength(2);
  expect(db.getFetchedJobs(1)).toHaveLength(1);
});

// ─── Job Matches ───────────────────────────────────────────────────────────────

test('saveJobMatch deduplicates by candidate_id + indeed_job_id', () => {
  db.saveJobMatch({ candidateId: '1', indeedJobId: 'jx', jobTitle: 'Dev', company: 'Co', location: 'L', jobUrl: 'u', snippet: '', suggestedTip: '', status: 'matched' });
  db.saveJobMatch({ candidateId: '1', indeedJobId: 'jx', jobTitle: 'Dup', company: 'Co', location: 'L', jobUrl: 'u', snippet: '', suggestedTip: '', status: 'matched' });
  expect(db.getJobMatches()).toHaveLength(1);
  expect(db.isSeenJob('jx', '1')).toBe(true);
});

test('isSeenJob is per-candidate — different candidates can see same job', () => {
  db.saveJobMatch({ candidateId: '1', indeedJobId: 'jy', jobTitle: '', company: '', location: '', jobUrl: '', snippet: '', suggestedTip: '', status: 'matched' });
  expect(db.isSeenJob('jy', '2')).toBe(false);
  db.markJobSeen('jy', '2');
  expect(db.isSeenJob('jy', '2')).toBe(true);
});

test('getCandidateJobMatches paginates', () => {
  for (let i = 0; i < 5; i++) {
    db.saveJobMatch({ candidateId: '1', indeedJobId: `job${i}`, jobTitle: `J${i}`, company: '', location: '', jobUrl: '', snippet: '', suggestedTip: '', status: 'matched' });
  }
  const page1 = db.getCandidateJobMatches('1', 1, 3);
  expect(page1.items).toHaveLength(3);
  expect(page1.total).toBe(5);
  expect(page1.pages).toBe(2);
});

// ─── cleanupOldData ────────────────────────────────────────────────────────────

test('cleanupOldData deletes fetched_posts older than 5 days', () => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  const fresh = new Date().toISOString();
  db._getDb().prepare("INSERT INTO fetched_posts (post_id,fetched_at) VALUES ('old1',?)").run(old);
  db._getDb().prepare("INSERT INTO fetched_posts (post_id,fetched_at) VALUES ('new1',?)").run(fresh);
  const result = db.cleanupOldData();
  expect(result.deleted_fetched_posts).toBe(1);
  expect(result.deleted_fetched_jobs).toBe(0);
  expect(db.getFetchedPosts()).toHaveLength(1);
  expect(db.isSeenPost('old1')).toBe(false);
  expect(db.isSeenPost('new1')).toBe(true);
});

test('cleanupOldData deletes fetched_jobs older than 5 days', () => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  db._getDb().prepare("INSERT INTO fetched_jobs (job_id,fetched_at) VALUES ('oldjob',?)").run(old);
  db._getDb().prepare("INSERT INTO fetched_jobs (job_id,fetched_at) VALUES ('newjob',?)").run(new Date().toISOString());
  const result = db.cleanupOldData();
  expect(result.deleted_fetched_jobs).toBe(1);
  expect(db.isSeenFetchedJob('oldjob')).toBe(false);
  expect(db.isSeenFetchedJob('newjob')).toBe(true);
});

test('cleanupOldData deletes unmatched leads older than 90 days', () => {
  const old = new Date(Date.now() - 91 * 86400000).toISOString();
  db._getDb().prepare("INSERT INTO leads (dealer_id,reddit_post_id,status,emailed_at) VALUES ('1','r1','unmatched',?)").run(old);
  db._getDb().prepare("INSERT INTO leads (dealer_id,reddit_post_id,status,emailed_at) VALUES ('1','r2','matched',?)").run(old);
  const result = db.cleanupOldData();
  expect(result.deleted_unmatched_leads).toBe(1);
  expect(db.getAllLeads()).toHaveLength(1);
});
