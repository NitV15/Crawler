#!/usr/bin/env node
/**
 * One-time migration: reads all data from Google Sheets and inserts into SQLite.
 * Run once on the server: node migrate-from-sheets.js
 * Safe to re-run — uses INSERT OR IGNORE so existing rows are skipped.
 */
require('dotenv').config();
const { google } = require('googleapis');
const { initDb, _getDb } = require('./db');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const COLS = {
  dealers:            ['id','name','emails','industry','description','industry_category','services','target_customers','keywords','state','city','service_areas','custom_subreddits','lead_count','subscription_status','subscription_expires_at','active','created_at'],
  candidates:         ['id','name','emails','role','skills','experience_level','city','state','preferred_locations','lead_count','subscription_status','subscription_expires_at','active','created_at'],
  leads:              ['id','dealer_id','reddit_post_id','post_title','post_text','post_url','subreddit','match_reason','suggested_reply','what_to_sell','lead_category','post_location','status','emailed_at'],
  payments:           ['id','dealer_id','utr_number','amount','status','created_at','verified_at'],
  fetched_jobs:       ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'],
  job_matches:        ['id','candidate_id','indeed_job_id','job_title','company','location','job_url','snippet','suggested_tip','status','emailed_at'],
  candidate_payments: ['id','candidate_id','utr_number','amount','status','created_at','verified_at'],
};

async function getSheetsClient() {
  let authConfig;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    authConfig = { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) };
  } else if (process.env.GOOGLE_CREDENTIALS_PATH) {
    authConfig = { keyFile: process.env.GOOGLE_CREDENTIALS_PATH };
  } else {
    throw new Error('Set GOOGLE_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_PATH');
  }
  const auth = new google.auth.GoogleAuth({
    ...authConfig,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function readSheet(client, name) {
  try {
    const res = await client.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: name });
    const vals = res.data.values || [];
    if (!vals.length) return [];
    const [headers, ...rows] = vals;
    return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  } catch (e) {
    console.warn(`  [skip] ${name}: ${e.message}`);
    return [];
  }
}

function insertRows(tableName, cols, rows) {
  if (!rows.length) return 0;
  const d = _getDb();
  const placeholders = cols.map(() => '?').join(',');
  const stmt = d.prepare(`INSERT OR IGNORE INTO ${tableName} (${cols.join(',')}) VALUES (${placeholders})`);
  const insertMany = d.transaction(rs => {
    let count = 0;
    for (const r of rs) {
      const vals = cols.map(c => {
        const v = r[c] ?? '';
        // Convert numeric fields
        if (['id','lead_count','active'].includes(c)) return v === '' ? null : parseInt(v) || 0;
        return String(v);
      });
      const result = stmt.run(vals);
      count += result.changes;
    }
    return count;
  });
  return insertMany(rows);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('SPREADSHEET_ID not set in .env');
    process.exit(1);
  }

  console.log('Initialising SQLite...');
  initDb();

  console.log('Connecting to Google Sheets...');
  const client = await getSheetsClient();

  let totalInserted = 0;
  for (const [table, cols] of Object.entries(COLS)) {
    process.stdout.write(`Migrating ${table}... `);
    const rows = await readSheet(client, table);
    const inserted = insertRows(table, cols, rows);
    console.log(`${rows.length} rows read, ${inserted} inserted`);
    totalInserted += inserted;
  }

  // After inserting dealers and candidates, push them to Sheets for sync confirmation
  const { syncDealersToSheets, syncCandidatesToSheets } = require('./sheets-sync');
  const { getDealers, getCandidates } = require('./db');
  syncDealersToSheets(getDealers());
  syncCandidatesToSheets(getCandidates());

  console.log(`\nDone. Total rows inserted: ${totalInserted}`);
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
