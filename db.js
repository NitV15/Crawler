const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'crawler.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS job_matches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL,
      indeed_job_id TEXT NOT NULL,
      job_title   TEXT,
      company     TEXT,
      location    TEXT,
      job_url     TEXT,
      snippet     TEXT,
      suggested_tip TEXT,
      status      TEXT,
      emailed_at  TEXT,
      UNIQUE(candidate_id, indeed_job_id)
    );
    CREATE TABLE IF NOT EXISTS leads (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id   TEXT NOT NULL,
      reddit_post_id TEXT NOT NULL,
      post_title  TEXT,
      post_text   TEXT,
      post_url    TEXT,
      subreddit   TEXT,
      match_reason TEXT,
      suggested_reply TEXT,
      what_to_sell TEXT,
      lead_category TEXT,
      post_location TEXT,
      status      TEXT,
      emailed_at  TEXT,
      UNIQUE(dealer_id, reddit_post_id)
    );
  `);
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

module.exports = { initDb, syncJobMatches, syncLeads, insertJobMatch, insertLead, getJobMatchesByCandidate, getLeadsByDealer };
