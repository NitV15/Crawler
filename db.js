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

  db.exec(`
    CREATE TABLE IF NOT EXISTS dealers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emails TEXT NOT NULL,
      industry TEXT NOT NULL,
      description TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      reddit_post_id TEXT NOT NULL,
      post_title TEXT,
      post_text TEXT,
      post_url TEXT NOT NULL,
      subreddit TEXT NOT NULL,
      match_reason TEXT,
      suggested_reply TEXT,
      emailed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
    CREATE TABLE IF NOT EXISTS seen_posts (
      post_id TEXT PRIMARY KEY,
      checked_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const count = db.prepare('SELECT COUNT(*) as c FROM dealers').get();
  if (count.c === 0) {
    db.prepare(
      'INSERT INTO dealers (name, emails, industry, description) VALUES (?, ?, ?, ?)'
    ).run(
      'Nitin Tanwar (Test)',
      'tanwarnitin.v15@gmail.com,rohittanwar9304@gmail.com',
      'General Testing',
      'Test dealer — match any post that shows clear purchase intent for any product or service. Travel, gym, restaurant, tech, anything.'
    );
  }

  return db;
}

function getActiveDealers(db) {
  return db.prepare('SELECT * FROM dealers WHERE active = 1').all();
}

function isSeenPost(db, postId) {
  return !!db.prepare('SELECT post_id FROM seen_posts WHERE post_id = ?').get(postId);
}

function markPostSeen(db, postId) {
  db.prepare('INSERT OR IGNORE INTO seen_posts (post_id) VALUES (?)').run(postId);
}

function saveLead(db, { dealerId, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply }) {
  return db.prepare(`
    INSERT INTO leads (dealer_id, reddit_post_id, post_title, post_text, post_url, subreddit, match_reason, suggested_reply)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(dealerId, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply);
}

function addDealer(db, { name, emails, industry, description }) {
  return db.prepare(
    'INSERT INTO dealers (name, emails, industry, description) VALUES (?, ?, ?, ?)'
  ).run(name, emails, industry, description);
}

function getLeads(db, limit = 50) {
  return db.prepare(`
    SELECT l.*, d.name as dealer_name, d.industry
    FROM leads l
    JOIN dealers d ON l.dealer_id = d.id
    ORDER BY l.id DESC LIMIT ?
  `).all(limit);
}

function getDealers(db) {
  return db.prepare('SELECT * FROM dealers ORDER BY id DESC').all();
}

function toggleDealer(db, id, active) {
  db.prepare('UPDATE dealers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

module.exports = { openDb, getActiveDealers, isSeenPost, markPostSeen, saveLead, addDealer, getLeads, getDealers, toggleDealer };
