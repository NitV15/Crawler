const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'crawler.db');

let db;

function getDb() {
  if (!db) {
    if (DB_PATH === ':memory:') {
      // In test mode, reuse a global connection so jest.resetModules() doesn't lose data
      if (!global.__testDb) {
        global.__testDb = new Database(':memory:');
        global.__testDb.pragma('journal_mode = WAL');
        global.__testDb.pragma('foreign_keys = ON');
      }
      db = global.__testDb;
    } else {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    }
  }
  return db;
}

const seenPosts = new Set();
const seenJobs = new Set();
const seenFetchedJobs = new Set();

function _getDb() { return getDb(); }
function _resetDb() {
  if (db && DB_PATH !== ':memory:') { db.close(); }
  db = null;
  if (DB_PATH === ':memory:') { global.__testDb = null; }
  seenPosts.clear(); seenJobs.clear(); seenFetchedJobs.clear();
}

function initDb() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS dealers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      emails TEXT NOT NULL DEFAULT '',
      industry TEXT DEFAULT '',
      description TEXT DEFAULT '',
      industry_category TEXT DEFAULT '',
      services TEXT DEFAULT '',
      target_customers TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      state TEXT DEFAULT '',
      city TEXT DEFAULT '',
      service_areas TEXT DEFAULT '',
      custom_subreddits TEXT DEFAULT '',
      lead_count INTEGER DEFAULT 0,
      subscription_status TEXT DEFAULT 'free',
      subscription_expires_at TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      emails TEXT NOT NULL DEFAULT '',
      role TEXT DEFAULT '',
      skills TEXT DEFAULT '',
      experience_level TEXT DEFAULT '',
      city TEXT DEFAULT '',
      state TEXT DEFAULT '',
      preferred_locations TEXT DEFAULT '',
      lead_count INTEGER DEFAULT 0,
      subscription_status TEXT DEFAULT 'free',
      subscription_expires_at TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id TEXT NOT NULL DEFAULT '',
      reddit_post_id TEXT NOT NULL DEFAULT '',
      post_title TEXT DEFAULT '',
      post_text TEXT DEFAULT '',
      post_url TEXT DEFAULT '',
      subreddit TEXT DEFAULT '',
      match_reason TEXT DEFAULT '',
      suggested_reply TEXT DEFAULT '',
      what_to_sell TEXT DEFAULT '',
      lead_category TEXT DEFAULT '',
      post_location TEXT DEFAULT '',
      status TEXT DEFAULT 'matched',
      emailed_at TEXT DEFAULT '',
      UNIQUE(dealer_id, reddit_post_id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id TEXT NOT NULL DEFAULT '',
      utr_number TEXT NOT NULL DEFAULT '',
      amount TEXT DEFAULT '10',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT '',
      verified_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS fetched_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL UNIQUE,
      post_title TEXT DEFAULT '',
      post_text TEXT DEFAULT '',
      post_url TEXT DEFAULT '',
      subreddit TEXT DEFAULT '',
      fetched_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS fetched_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      job_title TEXT DEFAULT '',
      company TEXT DEFAULT '',
      location TEXT DEFAULT '',
      job_url TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      fetched_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS job_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL DEFAULT '',
      indeed_job_id TEXT NOT NULL DEFAULT '',
      job_title TEXT DEFAULT '',
      company TEXT DEFAULT '',
      location TEXT DEFAULT '',
      job_url TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      suggested_tip TEXT DEFAULT '',
      status TEXT DEFAULT 'matched',
      emailed_at TEXT DEFAULT '',
      UNIQUE(candidate_id, indeed_job_id)
    );
    CREATE TABLE IF NOT EXISTS candidate_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL DEFAULT '',
      utr_number TEXT NOT NULL DEFAULT '',
      amount TEXT DEFAULT '10',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT '',
      verified_at TEXT DEFAULT ''
    );
  `);

  d.prepare('SELECT post_id FROM fetched_posts').all()
    .forEach(r => seenPosts.add(r.post_id));
  d.prepare('SELECT candidate_id, indeed_job_id FROM job_matches').all()
    .forEach(r => seenJobs.add(`${r.candidate_id}:${r.indeed_job_id}`));
  d.prepare('SELECT job_id FROM fetched_jobs').all()
    .forEach(r => seenFetchedJobs.add(r.job_id));

  console.log(`[db] Connected. seenPosts=${seenPosts.size}, seenJobs=${seenJobs.size}, seenFetchedJobs=${seenFetchedJobs.size}`);
}

function isSeenPost(postId) { return seenPosts.has(postId); }
function markPostSeen(postId) { seenPosts.add(postId); }
function isSeenJob(jobId, candidateId) { return seenJobs.has(`${candidateId}:${jobId}`); }
function markJobSeen(jobId, candidateId) { seenJobs.add(`${candidateId}:${jobId}`); }
function isSeenFetchedJob(jobId) { return seenFetchedJobs.has(jobId); }
function markFetchedJobSeen(jobId) { seenFetchedJobs.add(jobId); }

// ─── Dealers ──────────────────────────────────────────────────────────────────

function addDealer({ name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits }) {
  const result = getDb().prepare(`
    INSERT INTO dealers (name,emails,industry,description,industry_category,services,target_customers,keywords,state,city,service_areas,custom_subreddits,lead_count,subscription_status,subscription_expires_at,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,'free','',1,?)
  `).run(name,emails,industry_category||'',services||'',industry_category||'',services||'',target_customers||'',keywords||'',state||'',city||'',service_areas||'',custom_subreddits||'',new Date().toISOString());
  return result.lastInsertRowid;
}

function getDealers() {
  return getDb().prepare('SELECT * FROM dealers ORDER BY id DESC').all();
}

function getActiveDealers() {
  return getDb().prepare('SELECT * FROM dealers WHERE active = 1 ORDER BY id DESC').all();
}

function getDealer(id) {
  return getDb().prepare('SELECT * FROM dealers WHERE id = ?').get(String(id)) || null;
}

function updateDealer(id, { name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits }) {
  getDb().prepare(`
    UPDATE dealers SET name=?,emails=?,industry=?,description=?,industry_category=?,services=?,target_customers=?,keywords=?,state=?,city=?,service_areas=?,custom_subreddits=? WHERE id=?
  `).run(name,emails,industry_category||'',services||'',industry_category||'',services||'',target_customers||'',keywords||'',state||'',city||'',service_areas||'',custom_subreddits||'',String(id));
}

function toggleDealer(id, active) {
  getDb().prepare('UPDATE dealers SET active = ? WHERE id = ?').run(active ? 1 : 0, String(id));
}

function deleteDealer(id) {
  getDb().prepare('DELETE FROM dealers WHERE id = ?').run(String(id));
}

function incrementDealerLeadCount(dealerId) {
  getDb().prepare('UPDATE dealers SET lead_count = lead_count + 1 WHERE id = ?').run(String(dealerId));
}

function activateDealerSubscription(dealerId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare('UPDATE dealers SET subscription_status=?,subscription_expires_at=?,lead_count=0 WHERE id=?')
    .run('active', expiresAt, String(dealerId));
}

function resetDealerSubscription(dealerId) {
  getDb().prepare("UPDATE dealers SET subscription_status='free',subscription_expires_at='',lead_count=0 WHERE id=?")
    .run(String(dealerId));
}

// ─── Candidates ───────────────────────────────────────────────────────────────

function addCandidate({ name, emails, role, skills, experience_level, city, state, preferred_locations }) {
  const result = getDb().prepare(`
    INSERT INTO candidates (name,emails,role,skills,experience_level,city,state,preferred_locations,lead_count,subscription_status,subscription_expires_at,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,0,'free','',1,?)
  `).run(name,emails,role||'',skills||'',experience_level||'',city||'',state||'',preferred_locations||'',new Date().toISOString());
  return result.lastInsertRowid;
}

function getCandidates() {
  return getDb().prepare('SELECT * FROM candidates ORDER BY id ASC').all();
}

function getActiveCandidates() {
  return getDb().prepare('SELECT * FROM candidates WHERE active = 1 ORDER BY id ASC').all();
}

function getCandidate(id) {
  return getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(String(id)) || null;
}

function updateCandidate(id, { name, emails, role, skills, experience_level, city, state, preferred_locations }) {
  getDb().prepare(`
    UPDATE candidates SET name=?,emails=?,role=?,skills=?,experience_level=?,city=?,state=?,preferred_locations=? WHERE id=?
  `).run(name,emails,role||'',skills||'',experience_level||'',city||'',state||'',preferred_locations||'',String(id));
}

function toggleCandidate(id, active) {
  getDb().prepare('UPDATE candidates SET active = ? WHERE id = ?').run(active ? 1 : 0, String(id));
}

function deleteCandidate(id) {
  getDb().prepare('DELETE FROM candidates WHERE id = ?').run(String(id));
}

function incrementCandidateLeadCount(candidateId) {
  getDb().prepare('UPDATE candidates SET lead_count = lead_count + 1 WHERE id = ?').run(String(candidateId));
}

function activateCandidateSubscription(candidateId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare('UPDATE candidates SET subscription_status=?,subscription_expires_at=?,lead_count=0 WHERE id=?')
    .run('active', expiresAt, String(candidateId));
}

function resetCandidateSubscription(candidateId) {
  getDb().prepare("UPDATE candidates SET subscription_status='free',subscription_expires_at='',lead_count=0 WHERE id=?")
    .run(String(candidateId));
}

// ─── Leads ────────────────────────────────────────────────────────────────────

function saveLead({ dealerId, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply, whatToSell, leadCategory, postLocation, status }) {
  getDb().prepare(`
    INSERT OR IGNORE INTO leads
      (dealer_id,reddit_post_id,post_title,post_text,post_url,subreddit,match_reason,suggested_reply,what_to_sell,lead_category,post_location,status,emailed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(String(dealerId??''),redditPostId,postTitle||'',(postText||'').slice(0,500),postUrl||'',subreddit||'',matchReason||'',suggestedReply||'',whatToSell||'',leadCategory||'',postLocation||'',status||'matched',new Date().toISOString());
}

function getLeads(limit = 50) {
  return getDb().prepare(`
    SELECT l.*, d.name as dealer_name, d.industry_category
    FROM leads l LEFT JOIN dealers d ON d.id = l.dealer_id
    WHERE l.status IN ('matched','assigned') ORDER BY l.id DESC LIMIT ?
  `).all(limit);
}

function getAllLeads() {
  return getDb().prepare(`
    SELECT l.*, d.name as dealer_name
    FROM leads l LEFT JOIN dealers d ON d.id = l.dealer_id
    ORDER BY l.id DESC LIMIT 500
  `).all();
}

function getUnmatchedLeads() {
  return getDb().prepare("SELECT * FROM leads WHERE status = 'unmatched' ORDER BY id DESC").all();
}

function getLead(id) {
  return getDb().prepare('SELECT * FROM leads WHERE id = ?').get(String(id)) || null;
}

function assignLead(leadId, dealerId) {
  getDb().prepare("UPDATE leads SET dealer_id=?, status='assigned' WHERE id=?").run(String(dealerId), String(leadId));
}

function getLeadsByDealer(dealerId, page = 1, pageSize = 20) {
  const d = getDb();
  const offset = (page - 1) * pageSize;
  const items = d.prepare(`
    SELECT * FROM leads WHERE dealer_id = ? AND status IN ('matched','assigned')
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(String(dealerId), pageSize, offset);
  const { total } = d.prepare(`
    SELECT COUNT(*) as total FROM leads WHERE dealer_id = ? AND status IN ('matched','assigned')
  `).get(String(dealerId));
  return { items, total, page, pages: Math.ceil(total / pageSize) || 1 };
}

// ─── Dealer Payments ──────────────────────────────────────────────────────────

function addPayment({ dealerId, utrNumber }) {
  const result = getDb().prepare(`
    INSERT INTO payments (dealer_id,utr_number,amount,status,created_at,verified_at)
    VALUES (?,?,'10','pending',?,'')
  `).run(String(dealerId), utrNumber, new Date().toISOString());
  return result.lastInsertRowid;
}

function getPayment(id) {
  return getDb().prepare('SELECT * FROM payments WHERE id = ?').get(String(id)) || null;
}

function getPayments() {
  return getDb().prepare(`
    SELECT p.*, d.name as dealer_name, d.emails as dealer_emails
    FROM payments p LEFT JOIN dealers d ON d.id = p.dealer_id ORDER BY p.id DESC
  `).all();
}

function verifyPayment(id) {
  getDb().prepare("UPDATE payments SET status='verified', verified_at=? WHERE id=?")
    .run(new Date().toISOString(), String(id));
}

function rejectPayment(id) {
  getDb().prepare("UPDATE payments SET status='rejected' WHERE id=?").run(String(id));
}

// ─── Candidate Payments ───────────────────────────────────────────────────────

function addCandidatePayment({ candidateId, utrNumber }) {
  const result = getDb().prepare(`
    INSERT INTO candidate_payments (candidate_id,utr_number,amount,status,created_at,verified_at)
    VALUES (?,?,'10','pending',?,'')
  `).run(String(candidateId), utrNumber, new Date().toISOString());
  return result.lastInsertRowid;
}

function getCandidatePayment(id) {
  return getDb().prepare('SELECT * FROM candidate_payments WHERE id = ?').get(String(id)) || null;
}

function getCandidatePayments() {
  return getDb().prepare(`
    SELECT p.*, c.name as candidate_name, c.emails as candidate_emails
    FROM candidate_payments p LEFT JOIN candidates c ON c.id = p.candidate_id ORDER BY p.id DESC
  `).all();
}

function verifyCandidatePayment(id) {
  getDb().prepare("UPDATE candidate_payments SET status='verified', verified_at=? WHERE id=?")
    .run(new Date().toISOString(), String(id));
}

function rejectCandidatePayment(id) {
  getDb().prepare("UPDATE candidate_payments SET status='rejected' WHERE id=?").run(String(id));
}

// ─── Fetched Posts ────────────────────────────────────────────────────────────

function saveFetchedPost({ postId, postTitle, postText, postUrl, subreddit }) {
  if (seenPosts.has(postId)) return;
  seenPosts.add(postId);
  getDb().prepare(`
    INSERT OR IGNORE INTO fetched_posts (post_id,post_title,post_text,post_url,subreddit,fetched_at)
    VALUES (?,?,?,?,?,?)
  `).run(postId, postTitle||'', (postText||'').slice(0,500), postUrl||'', subreddit||'', new Date().toISOString());
}

function getFetchedPosts(limit = 200) {
  const rows = getDb().prepare('SELECT * FROM fetched_posts ORDER BY id DESC').all();
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function getFetchedPost(id) {
  return getDb().prepare('SELECT * FROM fetched_posts WHERE id = ?').get(String(id)) || null;
}

// ─── Fetched Jobs ─────────────────────────────────────────────────────────────

function saveFetchedJob({ jobId, jobTitle, company, location, jobUrl, snippet }) {
  if (seenFetchedJobs.has(jobId)) return;
  seenFetchedJobs.add(jobId);
  getDb().prepare(`
    INSERT OR IGNORE INTO fetched_jobs (job_id,job_title,company,location,job_url,snippet,fetched_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(jobId, jobTitle||'', company||'', location||'', jobUrl||'', (snippet||'').slice(0,500), new Date().toISOString());
}

function batchSaveFetchedJobs(jobs) {
  const newJobs = jobs.filter(j => !seenFetchedJobs.has(j.jobId));
  if (!newJobs.length) return;
  const insert = getDb().prepare(`
    INSERT OR IGNORE INTO fetched_jobs (job_id,job_title,company,location,job_url,snippet,fetched_at)
    VALUES (?,?,?,?,?,?,?)
  `);
  const now = new Date().toISOString();
  getDb().transaction(js => {
    for (const j of js) insert.run(j.jobId, j.jobTitle||'', j.company||'', j.location||'', j.jobUrl||'', (j.snippet||'').slice(0,500), now);
  })(newJobs);
  newJobs.forEach(j => seenFetchedJobs.add(j.jobId));
}

function getFetchedJobs(limit = 200) {
  const rows = getDb().prepare('SELECT * FROM fetched_jobs ORDER BY id DESC').all();
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function getFetchedJob(id) {
  return getDb().prepare('SELECT * FROM fetched_jobs WHERE id = ?').get(String(id)) || null;
}

// ─── Job Matches ──────────────────────────────────────────────────────────────

function saveJobMatch({ candidateId, indeedJobId, jobTitle, company, location, jobUrl, snippet, suggestedTip, status }) {
  const key = `${candidateId}:${indeedJobId}`;
  if (seenJobs.has(key)) return;
  seenJobs.add(key);
  getDb().prepare(`
    INSERT OR IGNORE INTO job_matches
      (candidate_id,indeed_job_id,job_title,company,location,job_url,snippet,suggested_tip,status,emailed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(String(candidateId),indeedJobId,jobTitle||'',company||'',location||'',jobUrl||'',snippet||'',suggestedTip||'',status||'matched',new Date().toISOString());
}

function getJobMatches(limit = 200) {
  return getDb().prepare(`
    SELECT j.*, c.name as candidate_name
    FROM job_matches j LEFT JOIN candidates c ON c.id = j.candidate_id
    ORDER BY j.id DESC LIMIT ?
  `).all(limit);
}

function getCandidateJobMatches(candidateId, page = 1, pageSize = 20) {
  const d = getDb();
  const offset = (page - 1) * pageSize;
  const items = d.prepare(`
    SELECT * FROM job_matches WHERE candidate_id = ? ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(String(candidateId), pageSize, offset);
  const { total } = d.prepare('SELECT COUNT(*) as total FROM job_matches WHERE candidate_id = ?').get(String(candidateId));
  return { items, total, page, pages: Math.ceil(total / pageSize) || 1 };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanupOldData() {
  const d = getDb();
  const fiveDaysAgo   = new Date(Date.now() - 5  * 86400000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  const r1 = d.prepare('DELETE FROM fetched_posts WHERE fetched_at < ?').run(fiveDaysAgo);
  const r2 = d.prepare('DELETE FROM fetched_jobs  WHERE fetched_at < ?').run(fiveDaysAgo);
  const r3 = d.prepare("DELETE FROM leads WHERE status='unmatched' AND emailed_at < ?").run(ninetyDaysAgo);

  // Re-sync seen sets from remaining DB rows
  seenPosts.clear();
  d.prepare('SELECT post_id FROM fetched_posts').all().forEach(r => seenPosts.add(r.post_id));
  seenFetchedJobs.clear();
  d.prepare('SELECT job_id FROM fetched_jobs').all().forEach(r => seenFetchedJobs.add(r.job_id));
  // Re-sync seenJobs (job_matches are never deleted by cleanup, but keep consistent)
  seenJobs.clear();
  d.prepare('SELECT candidate_id, indeed_job_id FROM job_matches').all()
    .forEach(r => seenJobs.add(`${r.candidate_id}:${r.indeed_job_id}`));

  return {
    deleted_fetched_posts:   r1.changes,
    deleted_fetched_jobs:    r2.changes,
    deleted_unmatched_leads: r3.changes,
  };
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────

function getDealerLeadStats(dealerId) {
  const d = getDb();
  const total = d.prepare('SELECT COUNT(*) as c FROM leads WHERE dealer_id = ?').get(String(dealerId)).c;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonth = d.prepare('SELECT COUNT(*) as c FROM leads WHERE dealer_id = ? AND emailed_at >= ?').get(String(dealerId), monthStart).c;
  return { total, thisMonth };
}

function getCandidateMatchCount(candidateId) {
  return getDb().prepare('SELECT COUNT(*) as c FROM job_matches WHERE candidate_id = ?').get(String(candidateId)).c;
}

module.exports = {
  initDb, _getDb, _resetDb,
  isSeenPost, markPostSeen, isSeenJob, markJobSeen, isSeenFetchedJob, markFetchedJobSeen,
  addDealer, getDealers, getActiveDealers, getDealer, updateDealer, toggleDealer, deleteDealer,
  incrementDealerLeadCount, activateDealerSubscription, resetDealerSubscription,
  addCandidate, getCandidates, getActiveCandidates, getCandidate, updateCandidate, toggleCandidate,
  deleteCandidate, incrementCandidateLeadCount, activateCandidateSubscription, resetCandidateSubscription,
  saveLead, getLeads, getAllLeads, getUnmatchedLeads, getLead, assignLead, getLeadsByDealer,
  addPayment, getPayment, getPayments, verifyPayment, rejectPayment,
  addCandidatePayment, getCandidatePayment, getCandidatePayments, verifyCandidatePayment, rejectCandidatePayment,
  saveFetchedPost, getFetchedPosts, getFetchedPost,
  saveFetchedJob, batchSaveFetchedJobs, getFetchedJobs, getFetchedJob,
  saveJobMatch, getJobMatches, getCandidateJobMatches,
  cleanupOldData, getDealerLeadStats, getCandidateMatchCount,
};
