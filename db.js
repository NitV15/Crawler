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

function syncJobMatches(rows) {
  const d = getDb();
  const insert = d.prepare(`
    INSERT OR IGNORE INTO job_matches
      (candidate_id, indeed_job_id, job_title, company, location, job_url, snippet, suggested_tip, status, emailed_at)
    VALUES
      (@candidate_id, @indeed_job_id, @job_title, @company, @location, @job_url, @snippet, @suggested_tip, @status, @emailed_at)
  `);
  const insertMany = d.transaction(rs => { for (const r of rs) insert.run(r); });
  insertMany(rows.map(r => ({
    candidate_id:  String(r.candidate_id  ?? ''),
    indeed_job_id: String(r.indeed_job_id ?? ''),
    job_title:     String(r.job_title     ?? ''),
    company:       String(r.company       ?? ''),
    location:      String(r.location      ?? ''),
    job_url:       String(r.job_url       ?? ''),
    snippet:       String(r.snippet       ?? ''),
    suggested_tip: String(r.suggested_tip ?? ''),
    status:        String(r.status        ?? ''),
    emailed_at:    String(r.emailed_at    ?? ''),
  })));
}

function syncLeads(rows) {
  const d = getDb();
  const insert = d.prepare(`
    INSERT OR IGNORE INTO leads
      (dealer_id, reddit_post_id, post_title, post_text, post_url, subreddit, match_reason, suggested_reply, what_to_sell, lead_category, post_location, status, emailed_at)
    VALUES
      (@dealer_id, @reddit_post_id, @post_title, @post_text, @post_url, @subreddit, @match_reason, @suggested_reply, @what_to_sell, @lead_category, @post_location, @status, @emailed_at)
  `);
  const insertMany = d.transaction(rs => { for (const r of rs) insert.run(r); });
  insertMany(rows.map(r => ({
    dealer_id:      String(r.dealer_id      ?? ''),
    reddit_post_id: String(r.reddit_post_id ?? ''),
    post_title:     String(r.post_title     ?? ''),
    post_text:      String(r.post_text      ?? ''),
    post_url:       String(r.post_url       ?? ''),
    subreddit:      String(r.subreddit      ?? ''),
    match_reason:   String(r.match_reason   ?? ''),
    suggested_reply:String(r.suggested_reply?? ''),
    what_to_sell:   String(r.what_to_sell   ?? ''),
    lead_category:  String(r.lead_category  ?? ''),
    post_location:  String(r.post_location  ?? ''),
    status:         String(r.status         ?? ''),
    emailed_at:     String(r.emailed_at     ?? ''),
  })));
}

function insertJobMatch({ candidateId, indeedJobId, jobTitle, company, location, jobUrl, snippet, suggestedTip, status }) {
  const d = getDb();
  d.prepare(`
    INSERT OR IGNORE INTO job_matches
      (candidate_id, indeed_job_id, job_title, company, location, job_url, snippet, suggested_tip, status, emailed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(candidateId), indeedJobId, jobTitle || '', company || '',
    location || '', jobUrl || '', snippet || '', suggestedTip || '',
    status || 'matched', new Date().toISOString()
  );
}

function insertLead({ dealerId, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply, whatToSell, leadCategory, postLocation, status }) {
  const d = getDb();
  d.prepare(`
    INSERT OR IGNORE INTO leads
      (dealer_id, reddit_post_id, post_title, post_text, post_url, subreddit, match_reason, suggested_reply, what_to_sell, lead_category, post_location, status, emailed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(dealerId), redditPostId, postTitle || '', (postText || '').slice(0, 500),
    postUrl || '', subreddit || '', matchReason || '', suggestedReply || '',
    whatToSell || '', leadCategory || '', postLocation || '',
    status || 'matched', new Date().toISOString()
  );
}

function getJobMatchesByCandidate(candidateId, page = 1, pageSize = 20) {
  const d = getDb();
  const offset = (page - 1) * pageSize;
  const items = d.prepare(`
    SELECT * FROM job_matches WHERE candidate_id = ?
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(String(candidateId), pageSize, offset);
  const { total } = d.prepare(`SELECT COUNT(*) as total FROM job_matches WHERE candidate_id = ?`).get(String(candidateId));
  return { items, total, page, pages: Math.ceil(total / pageSize) || 1 };
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

module.exports = {
  initDb, _getDb, _resetDb,
  isSeenPost, markPostSeen, isSeenJob, markJobSeen, isSeenFetchedJob, markFetchedJobSeen,
  addDealer, getDealers, getActiveDealers, getDealer, updateDealer, toggleDealer, deleteDealer,
  incrementDealerLeadCount, activateDealerSubscription, resetDealerSubscription,
  addCandidate, getCandidates, getActiveCandidates, getCandidate, updateCandidate, toggleCandidate,
  deleteCandidate, incrementCandidateLeadCount, activateCandidateSubscription, resetCandidateSubscription,
  syncJobMatches, syncLeads, insertJobMatch, insertLead, getJobMatchesByCandidate, getLeadsByDealer,
};
