require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function openDb(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, 'data', 'crawler.db');
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }
  const db = new Database(resolvedPath);
  initSchema(db);
  migrate(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dealers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emails TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
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
      subscription_expires_at TEXT DEFAULT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER,
      reddit_post_id TEXT NOT NULL,
      post_title TEXT,
      post_text TEXT,
      post_url TEXT NOT NULL,
      subreddit TEXT NOT NULL,
      match_reason TEXT,
      suggested_reply TEXT,
      what_to_sell TEXT DEFAULT '',
      lead_category TEXT DEFAULT '',
      post_location TEXT DEFAULT '',
      status TEXT DEFAULT 'matched',
      emailed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      utr_number TEXT NOT NULL,
      amount INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      verified_at TEXT DEFAULT NULL,
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
    CREATE TABLE IF NOT EXISTS fetched_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT UNIQUE NOT NULL,
      post_title TEXT,
      post_text TEXT,
      post_url TEXT NOT NULL,
      subreddit TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS seen_posts (
      post_id TEXT PRIMARY KEY,
      checked_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function migrate(db) {
  const dealerCols = db.prepare('PRAGMA table_info(dealers)').all().map(c => c.name);
  const newDealerCols = {
    industry_category: "TEXT DEFAULT ''",
    services: "TEXT DEFAULT ''",
    target_customers: "TEXT DEFAULT ''",
    keywords: "TEXT DEFAULT ''",
    state: "TEXT DEFAULT ''",
    city: "TEXT DEFAULT ''",
    service_areas: "TEXT DEFAULT ''",
    custom_subreddits: "TEXT DEFAULT ''",
    lead_count: 'INTEGER DEFAULT 0',
    subscription_status: "TEXT DEFAULT 'free'",
    subscription_expires_at: 'TEXT DEFAULT NULL',
  };
  for (const [col, def] of Object.entries(newDealerCols)) {
    if (!dealerCols.includes(col)) {
      db.exec(`ALTER TABLE dealers ADD COLUMN ${col} ${def}`);
    }
  }

  const leadCols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
  if (!leadCols.includes('what_to_sell')) {
    db.exec(`CREATE TABLE leads_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER,
      reddit_post_id TEXT NOT NULL,
      post_title TEXT,
      post_text TEXT,
      post_url TEXT NOT NULL,
      subreddit TEXT NOT NULL,
      match_reason TEXT,
      suggested_reply TEXT,
      what_to_sell TEXT DEFAULT '',
      lead_category TEXT DEFAULT '',
      post_location TEXT DEFAULT '',
      status TEXT DEFAULT 'matched',
      emailed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    )`);
    db.exec(`INSERT INTO leads_v2 (id, dealer_id, reddit_post_id, post_title, post_text, post_url, subreddit, match_reason, suggested_reply, emailed_at)
             SELECT id, dealer_id, reddit_post_id, post_title, post_text, post_url, subreddit, match_reason, suggested_reply, emailed_at FROM leads`);
    db.exec('DROP TABLE leads');
    db.exec('ALTER TABLE leads_v2 RENAME TO leads');
  }
}

function getActiveDealers(db) {
  return db.prepare('SELECT * FROM dealers WHERE active = 1').all();
}

function getDealer(db, id) {
  return db.prepare('SELECT * FROM dealers WHERE id = ?').get(id);
}

function addDealer(db, { name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits }) {
  return db.prepare(`
    INSERT INTO dealers (name, emails, industry, description, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, emails, industry_category || '', services || '', industry_category || '', services || '', target_customers || '', keywords || '', state || '', city || '', service_areas || '', custom_subreddits || '');
}

function getDealers(db) {
  return db.prepare('SELECT * FROM dealers ORDER BY id DESC').all();
}

function toggleDealer(db, id, active) {
  db.prepare('UPDATE dealers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function incrementDealerLeadCount(db, dealerId) {
  db.prepare('UPDATE dealers SET lead_count = lead_count + 1 WHERE id = ?').run(dealerId);
}

function activateDealerSubscription(db, dealerId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE dealers SET subscription_status = 'active', subscription_expires_at = ?, lead_count = 0 WHERE id = ?`).run(expiresAt, dealerId);
}

function resetDealerSubscription(db, dealerId) {
  db.prepare(`UPDATE dealers SET subscription_status = 'free', subscription_expires_at = NULL, lead_count = 0 WHERE id = ?`).run(dealerId);
}

function saveLead(db, { dealerId, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply, whatToSell, leadCategory, postLocation, status }) {
  return db.prepare(`
    INSERT INTO leads (dealer_id, reddit_post_id, post_title, post_text, post_url, subreddit, match_reason, suggested_reply, what_to_sell, lead_category, post_location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(dealerId ?? null, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply, whatToSell || '', leadCategory || '', postLocation || '', status || 'matched');
}

function getLeads(db, limit = 50) {
  return db.prepare(`
    SELECT l.*, d.name as dealer_name, d.industry_category
    FROM leads l
    LEFT JOIN dealers d ON l.dealer_id = d.id
    WHERE l.status = 'matched' OR l.status = 'assigned'
    ORDER BY l.id DESC LIMIT ?
  `).all(limit);
}

function getUnmatchedLeads(db) {
  return db.prepare(`SELECT * FROM leads WHERE status = 'unmatched' ORDER BY id DESC`).all();
}

function getAllLeads(db) {
  return db.prepare(`
    SELECT l.*, d.name as dealer_name
    FROM leads l
    LEFT JOIN dealers d ON l.dealer_id = d.id
    ORDER BY l.id DESC LIMIT 500
  `).all();
}

function assignLead(db, leadId, dealerId) {
  db.prepare(`UPDATE leads SET dealer_id = ?, status = 'assigned' WHERE id = ?`).run(dealerId, leadId);
}

function saveFetchedPost(db, { postId, postTitle, postText, postUrl, subreddit }) {
  return db.prepare(`
    INSERT OR IGNORE INTO fetched_posts (post_id, post_title, post_text, post_url, subreddit)
    VALUES (?, ?, ?, ?, ?)
  `).run(postId, postTitle || '', (postText || '').slice(0, 500), postUrl, subreddit);
}

function getFetchedPosts(db, limit = 200) {
  return db.prepare('SELECT * FROM fetched_posts ORDER BY id DESC LIMIT ?').all(limit);
}

function addPayment(db, { dealerId, utrNumber }) {
  return db.prepare(`INSERT INTO payments (dealer_id, utr_number) VALUES (?, ?)`).run(dealerId, utrNumber);
}

function getPayment(db, id) {
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
}

function getPayments(db) {
  return db.prepare(`
    SELECT p.*, d.name as dealer_name, d.emails as dealer_emails
    FROM payments p
    JOIN dealers d ON p.dealer_id = d.id
    ORDER BY p.id DESC
  `).all();
}

function verifyPayment(db, paymentId) {
  db.prepare(`UPDATE payments SET status = 'verified', verified_at = datetime('now') WHERE id = ?`).run(paymentId);
}

function rejectPayment(db, paymentId) {
  db.prepare(`UPDATE payments SET status = 'rejected' WHERE id = ?`).run(paymentId);
}

function isSeenPost(db, postId) {
  return !!db.prepare('SELECT post_id FROM seen_posts WHERE post_id = ?').get(postId);
}

function markPostSeen(db, postId) {
  db.prepare('INSERT OR IGNORE INTO seen_posts (post_id) VALUES (?)').run(postId);
}

module.exports = {
  openDb, getActiveDealers, getDealer, addDealer, getDealers, toggleDealer,
  incrementDealerLeadCount, activateDealerSubscription, resetDealerSubscription,
  saveLead, getLeads, getUnmatchedLeads, getAllLeads, assignLead,
  addPayment, getPayment, getPayments, verifyPayment, rejectPayment,
  saveFetchedPost, getFetchedPosts,
  isSeenPost, markPostSeen,
};
