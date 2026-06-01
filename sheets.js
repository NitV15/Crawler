require('dotenv').config();
const { google } = require('googleapis');

let sheets;
let spreadsheetId;
const seenPosts = new Set();
const seenJobs = new Set();
const seenFetchedJobs = new Set();

const COLS = {
  dealers: ['id','name','emails','industry','description','industry_category','services','target_customers','keywords','state','city','service_areas','custom_subreddits','lead_count','subscription_status','subscription_expires_at','active','created_at'],
  leads: ['id','dealer_id','reddit_post_id','post_title','post_text','post_url','subreddit','match_reason','suggested_reply','what_to_sell','lead_category','post_location','status','emailed_at'],
  payments: ['id','dealer_id','utr_number','amount','status','created_at','verified_at'],
  fetched_posts: ['id','post_id','post_title','post_text','post_url','subreddit','fetched_at'],
  fetched_jobs: ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'],
  candidates: ['id','name','emails','role','skills','experience_level','city','state','preferred_locations','lead_count','subscription_status','subscription_expires_at','active','created_at'],
  job_matches: ['id','candidate_id','indeed_job_id','job_title','company','location','job_url','snippet','suggested_tip','status','emailed_at'],
  candidate_payments: ['id','candidate_id','utr_number','amount','status','created_at','verified_at'],
};

async function readSheet(name) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: name });
  const vals = res.data.values || [];
  if (!vals.length) return [];
  const [headers, ...rows] = vals;
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

async function appendRow(name, obj) {
  const headers = COLS[name];
  const existing = await readSheet(name);
  const id = existing.length + 1; // non-atomic: concurrent writes can produce duplicate IDs
  const row = { id: String(id), ...obj };
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: name, valueInputOption: 'RAW',
    requestBody: { values: [headers.map(h => String(row[h] ?? ''))] },
  });
  return id;
}

async function updateRow(name, id, updates) {
  const headers = COLS[name];
  const rows = await readSheet(name);
  const rowIdx = rows.findIndex(r => String(r.id) === String(id));
  if (rowIdx === -1) { console.warn(`[sheets] updateRow: id ${id} not found in ${name}`); return; }
  const merged = { ...rows[rowIdx], ...updates };
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${name}!A${rowIdx + 2}`, valueInputOption: 'RAW',
    requestBody: { values: [headers.map(h => String(merged[h] ?? ''))] },
  });
}

async function deleteRow(name, id) {
  const rows = await readSheet(name);
  const rowIdx = rows.findIndex(r => String(r.id) === String(id));
  if (rowIdx === -1) throw new Error(`[sheets] deleteRow: id ${id} not found in ${name}`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const sheetId = meta.data.sheets.find(s => s.properties.title === name)?.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx + 1, endIndex: rowIdx + 2 } } }],
    },
  });
}

async function initSheets() {
  let authConfig;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    authConfig = { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) };
  } else if (process.env.GOOGLE_CREDENTIALS_PATH) {
    authConfig = { keyFile: process.env.GOOGLE_CREDENTIALS_PATH };
  } else {
    throw new Error('[sheets] Set GOOGLE_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_PATH');
  }

  const auth = new google.auth.GoogleAuth({
    ...authConfig,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  const authClient = await auth.getClient();
  sheets = google.sheets({ version: 'v4', auth: authClient });

  spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId) {
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'Crawler Data' },
        sheets: Object.keys(COLS).map(name => ({ properties: { title: name } })),
      },
    });
    spreadsheetId = created.data.spreadsheetId;
    const data = Object.entries(COLS).map(([name, headers]) => ({
      range: `${name}!A1`, values: [headers],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId, requestBody: { valueInputOption: 'RAW', data },
    });
    console.log(`\n✅ Created spreadsheet: ${spreadsheetId}`);
    console.log(`   Add to your .env: SPREADSHEET_ID=${spreadsheetId}\n`);
    process.exit(0);
  }

  const fetchedRows = await readSheet('fetched_posts');
  fetchedRows.forEach(r => r.post_id && seenPosts.add(r.post_id));
  const jobRows = await readSheet('job_matches');
  jobRows.forEach(r => r.indeed_job_id && seenJobs.add(r.indeed_job_id));

  // Ensure fetched_jobs tab exists (may be missing from older spreadsheets)
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    const existingTabs = new Set(meta.data.sheets.map(s => s.properties.title));
    if (!existingTabs.has('fetched_jobs')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: 'fetched_jobs' } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: 'fetched_jobs!A1', valueInputOption: 'RAW',
        requestBody: { values: [COLS.fetched_jobs] },
      });
      console.log('[sheets] Created fetched_jobs tab');
    }
  } catch (e) {
    console.warn('[sheets] Could not check/create fetched_jobs tab:', e.message);
  }

  try {
    const fetchedJobRows = await readSheet('fetched_jobs');
    fetchedJobRows.forEach(r => r.job_id && seenFetchedJobs.add(r.job_id));
  } catch (e) {
    console.warn('[sheets] Could not load fetched_jobs rows:', e.message);
  }
  console.log(`[sheets] Connected. seenPosts=${seenPosts.size}, seenJobs=${seenJobs.size}, seenFetchedJobs=${seenFetchedJobs.size}`);
}

// ─── Dealers ──────────────────────────────────────────────────────────────────

async function getDealers() {
  const rows = await readSheet('dealers');
  return rows.sort((a, b) => parseInt(b.id) - parseInt(a.id));
}

async function getActiveDealers() {
  return (await getDealers()).filter(r => r.active === '1');
}

async function getDealer(id) {
  return (await getDealers()).find(r => String(r.id) === String(id)) || null;
}

async function addDealer({ name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits }) {
  return appendRow('dealers', {
    name, emails,
    industry: industry_category || '',
    description: services || '',
    industry_category: industry_category || '',
    services: services || '',
    target_customers: target_customers || '',
    keywords: keywords || '',
    state: state || '',
    city: city || '',
    service_areas: service_areas || '',
    custom_subreddits: custom_subreddits || '',
    lead_count: '0',
    subscription_status: 'free',
    subscription_expires_at: '',
    active: '1',
    created_at: new Date().toISOString(),
  });
}

async function updateDealer(id, { name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits }) {
  return updateRow('dealers', id, {
    name, emails,
    industry: industry_category || '',
    industry_category: industry_category || '',
    services: services || '',
    target_customers: target_customers || '',
    keywords: keywords || '',
    state: state || '',
    city: city || '',
    service_areas: service_areas || '',
    custom_subreddits: custom_subreddits || '',
  });
}

async function toggleDealer(id, active) {
  return updateRow('dealers', id, { active: active ? '1' : '0' });
}

async function deleteDealer(id) {
  return deleteRow('dealers', id);
}

async function incrementDealerLeadCount(dealerId) {
  const dealer = await getDealer(dealerId);
  if (!dealer) return;
  return updateRow('dealers', dealerId, { lead_count: String(parseInt(dealer.lead_count || '0') + 1) });
}

async function activateDealerSubscription(dealerId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return updateRow('dealers', dealerId, { subscription_status: 'active', subscription_expires_at: expiresAt, lead_count: '0' });
}

async function resetDealerSubscription(dealerId) {
  return updateRow('dealers', dealerId, { subscription_status: 'free', subscription_expires_at: '', lead_count: '0' });
}

// ─── Leads ────────────────────────────────────────────────────────────────────

async function saveLead({ dealerId, redditPostId, postTitle, postText, postUrl, subreddit, matchReason, suggestedReply, whatToSell, leadCategory, postLocation, status }) {
  return appendRow('leads', {
    dealer_id: dealerId != null ? String(dealerId) : '',
    reddit_post_id: redditPostId,
    post_title: postTitle || '',
    post_text: (postText || '').slice(0, 500),
    post_url: postUrl,
    subreddit,
    match_reason: matchReason || '',
    suggested_reply: suggestedReply || '',
    what_to_sell: whatToSell || '',
    lead_category: leadCategory || '',
    post_location: postLocation || '',
    status: status || 'matched',
    emailed_at: new Date().toISOString(),
  });
}

async function getLeads(limit = 50) {
  const [leads, dealers] = await Promise.all([readSheet('leads'), readSheet('dealers')]);
  const dealerMap = Object.fromEntries(dealers.map(d => [d.id, d]));
  return leads
    .filter(l => l.status === 'matched' || l.status === 'assigned')
    .sort((a, b) => parseInt(b.id) - parseInt(a.id))
    .slice(0, limit)
    .map(l => ({ ...l, dealer_name: dealerMap[l.dealer_id]?.name || '', industry_category: dealerMap[l.dealer_id]?.industry_category || '' }));
}

async function getAllLeads() {
  const [leads, dealers] = await Promise.all([readSheet('leads'), readSheet('dealers')]);
  const dealerMap = Object.fromEntries(dealers.map(d => [d.id, d]));
  return leads
    .sort((a, b) => parseInt(b.id) - parseInt(a.id))
    .slice(0, 500)
    .map(l => ({ ...l, dealer_name: dealerMap[l.dealer_id]?.name || '' }));
}

async function getUnmatchedLeads() {
  const rows = await readSheet('leads');
  return rows.filter(r => r.status === 'unmatched').sort((a, b) => parseInt(b.id) - parseInt(a.id));
}

async function getLead(id) {
  const rows = await readSheet('leads');
  return rows.find(r => String(r.id) === String(id)) || null;
}

async function assignLead(leadId, dealerId) {
  return updateRow('leads', leadId, { dealer_id: String(dealerId), status: 'assigned' });
}

// ─── Fetched Posts ────────────────────────────────────────────────────────────

async function saveFetchedPost({ postId, postTitle, postText, postUrl, subreddit }) {
  if (seenPosts.has(postId)) return;
  seenPosts.add(postId);
  return appendRow('fetched_posts', {
    post_id: postId,
    post_title: postTitle || '',
    post_text: (postText || '').slice(0, 500),
    post_url: postUrl,
    subreddit,
    fetched_at: new Date().toISOString(),
  });
}

async function getFetchedPosts(limit = 200) {
  const rows = await readSheet('fetched_posts');
  return rows.sort((a, b) => parseInt(b.id) - parseInt(a.id)).slice(0, limit);
}

async function getFetchedPost(id) {
  const rows = await readSheet('fetched_posts');
  return rows.find(r => String(r.id) === String(id)) || null;
}

function isSeenPost(postId) { return seenPosts.has(postId); }
function markPostSeen(postId) { seenPosts.add(postId); }

// ─── Fetched Jobs ─────────────────────────────────────────────────────────────

async function saveFetchedJob({ jobId, jobTitle, company, location, jobUrl, snippet }) {
  if (seenFetchedJobs.has(jobId)) return;
  seenFetchedJobs.add(jobId);
  return appendRow('fetched_jobs', {
    job_id: jobId,
    job_title: jobTitle || '',
    company: company || '',
    location: location || '',
    job_url: jobUrl || '',
    snippet: (snippet || '').slice(0, 500),
    fetched_at: new Date().toISOString(),
  });
}

async function batchSaveFetchedJobs(jobs) {
  const newJobs = jobs.filter(j => !seenFetchedJobs.has(j.jobId));
  if (!newJobs.length) return;
  newJobs.forEach(j => seenFetchedJobs.add(j.jobId));
  const headers = COLS['fetched_jobs'];
  const existing = await readSheet('fetched_jobs');
  const now = new Date().toISOString();
  const rows = newJobs.map((j, i) => {
    const obj = { id: String(existing.length + i + 1), job_id: j.jobId, job_title: j.jobTitle || '',
      company: j.company || '', location: j.location || '', job_url: j.jobUrl || '',
      snippet: (j.snippet || '').slice(0, 500), fetched_at: now };
    return headers.map(h => String(obj[h] ?? ''));
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: 'fetched_jobs', valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

async function getFetchedJobs(limit = 200) {
  const rows = await readSheet('fetched_jobs');
  return rows.sort((a, b) => parseInt(b.id) - parseInt(a.id)).slice(0, limit);
}

async function getFetchedJob(id) {
  const rows = await readSheet('fetched_jobs');
  return rows.find(r => String(r.id) === String(id)) || null;
}

// ─── Payments ─────────────────────────────────────────────────────────────────

async function addPayment({ dealerId, utrNumber }) {
  return appendRow('payments', {
    dealer_id: String(dealerId),
    utr_number: utrNumber,
    amount: '10',
    status: 'pending',
    created_at: new Date().toISOString(),
    verified_at: '',
  });
}

async function getPayment(id) {
  const rows = await readSheet('payments');
  return rows.find(r => String(r.id) === String(id)) || null;
}

async function getPayments() {
  const [payments, dealers] = await Promise.all([readSheet('payments'), readSheet('dealers')]);
  const dealerMap = Object.fromEntries(dealers.map(d => [d.id, d]));
  return payments
    .sort((a, b) => parseInt(b.id) - parseInt(a.id))
    .map(p => ({ ...p, dealer_name: dealerMap[p.dealer_id]?.name || '', dealer_emails: dealerMap[p.dealer_id]?.emails || '' }));
}

async function verifyPayment(id) {
  return updateRow('payments', id, { status: 'verified', verified_at: new Date().toISOString() });
}

async function rejectPayment(id) {
  return updateRow('payments', id, { status: 'rejected' });
}

// ─── Candidates ───────────────────────────────────────────────────────────────

async function addCandidate({ name, emails, role, skills, experience_level, city, state, preferred_locations }) {
  return appendRow('candidates', {
    name, emails,
    role: role || '',
    skills: skills || '',
    experience_level: experience_level || '',
    city: city || '',
    state: state || '',
    preferred_locations: preferred_locations || '',
    lead_count: '0',
    subscription_status: 'free',
    subscription_expires_at: '',
    active: '1',
    created_at: new Date().toISOString(),
  });
}

async function getCandidates() {
  const rows = await readSheet('candidates');
  return rows.sort((a, b) => parseInt(a.id) - parseInt(b.id));
}

async function getActiveCandidates() {
  return (await getCandidates()).filter(r => r.active === '1');
}

async function getCandidate(id) {
  return (await getCandidates()).find(r => String(r.id) === String(id)) || null;
}

async function updateCandidate(id, { name, emails, role, skills, experience_level, city, state, preferred_locations }) {
  return updateRow('candidates', id, { name, emails, role, skills, experience_level, city, state, preferred_locations });
}

async function toggleCandidate(id, active) {
  return updateRow('candidates', id, { active: active ? '1' : '0' });
}

async function deleteCandidate(id) {
  return deleteRow('candidates', id);
}

async function incrementCandidateLeadCount(candidateId) {
  const candidate = await getCandidate(candidateId);
  if (!candidate) return;
  return updateRow('candidates', candidateId, { lead_count: String(parseInt(candidate.lead_count || '0') + 1) });
}

async function activateCandidateSubscription(candidateId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return updateRow('candidates', candidateId, { subscription_status: 'active', subscription_expires_at: expiresAt, lead_count: '0' });
}

async function resetCandidateSubscription(candidateId) {
  return updateRow('candidates', candidateId, { subscription_status: 'free', subscription_expires_at: '', lead_count: '0' });
}

// ─── Job Matches ──────────────────────────────────────────────────────────────

async function saveJobMatch({ candidateId, indeedJobId, jobTitle, company, location, jobUrl, snippet, suggestedTip, status }) {
  if (seenJobs.has(indeedJobId)) return;
  seenJobs.add(indeedJobId);
  return appendRow('job_matches', {
    candidate_id: candidateId != null ? String(candidateId) : '',
    indeed_job_id: indeedJobId,
    job_title: jobTitle || '',
    company: company || '',
    location: location || '',
    job_url: jobUrl,
    snippet: snippet || '',
    suggested_tip: suggestedTip || '',
    status: status || 'matched',
    emailed_at: new Date().toISOString(),
  });
}

async function getJobMatches(limit = 200) {
  const [jobMatches, candidates] = await Promise.all([readSheet('job_matches'), readSheet('candidates')]);
  const candidateMap = Object.fromEntries(candidates.map(c => [c.id, c]));
  return jobMatches
    .sort((a, b) => parseInt(b.id) - parseInt(a.id))
    .slice(0, limit)
    .map(j => ({ ...j, candidate_name: candidateMap[j.candidate_id]?.name || '' }));
}

function isSeenJob(jobId) { return seenJobs.has(jobId); }
function markJobSeen(jobId) { seenJobs.add(jobId); }

// ─── Candidate Payments ───────────────────────────────────────────────────────

async function addCandidatePayment({ candidateId, utrNumber }) {
  return appendRow('candidate_payments', {
    candidate_id: String(candidateId),
    utr_number: utrNumber,
    amount: '10',
    status: 'pending',
    created_at: new Date().toISOString(),
    verified_at: '',
  });
}

async function getCandidatePayment(id) {
  const rows = await readSheet('candidate_payments');
  return rows.find(r => String(r.id) === String(id)) || null;
}

async function getCandidatePayments() {
  const [payments, candidates] = await Promise.all([readSheet('candidate_payments'), readSheet('candidates')]);
  const candidateMap = Object.fromEntries(candidates.map(c => [c.id, c]));
  return payments
    .sort((a, b) => parseInt(b.id) - parseInt(a.id))
    .map(p => ({ ...p, candidate_name: candidateMap[p.candidate_id]?.name || '', candidate_emails: candidateMap[p.candidate_id]?.emails || '' }));
}

async function verifyCandidatePayment(id) {
  return updateRow('candidate_payments', id, { status: 'verified', verified_at: new Date().toISOString() });
}

async function rejectCandidatePayment(id) {
  return updateRow('candidate_payments', id, { status: 'rejected' });
}

// ─── Admin Cleanup ────────────────────────────────────────────────────────────

async function cleanupOldData() {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [fetchedRows, leadRows] = await Promise.all([
    readSheet('fetched_posts'),
    readSheet('leads'),
  ]);

  const oldFetched = fetchedRows
    .map((r, i) => ({ ...r, _sheetRow: i + 2 }))
    .filter(r => r.fetched_at < sixtyDaysAgo);

  const oldLeads = leadRows
    .map((r, i) => ({ ...r, _sheetRow: i + 2 }))
    .filter(r => r.status === 'unmatched' && r.emailed_at < ninetyDaysAgo);

  const toDelete = [
    ...oldFetched.map(r => ({ sheet: 'fetched_posts', row: r._sheetRow })),
    ...oldLeads.map(r => ({ sheet: 'leads', row: r._sheetRow })),
  ].sort((a, b) => b.row - a.row);

  if (toDelete.length > 0) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    const sheetIdMap = Object.fromEntries(
      meta.data.sheets.map(s => [s.properties.title, s.properties.sheetId])
    );
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toDelete.map(({ sheet, row }) => ({
          deleteDimension: {
            range: { sheetId: sheetIdMap[sheet], dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        })),
      },
    });
  }

  return { deleted_fetched: oldFetched.length, deleted_unmatched: oldLeads.length };
}

async function getDealerLeads(dealerId, page = 1) {
  const PAGE_SIZE = 20;
  const rows = await readSheet('leads');
  const filtered = rows
    .filter(r => String(r.dealer_id) === String(dealerId) && (r.status === 'matched' || r.status === 'assigned'))
    .sort((a, b) => parseInt(b.id) - parseInt(a.id));
  const total = filtered.length;
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) || 1 };
}

async function getCandidateJobMatches(candidateId, page = 1) {
  const PAGE_SIZE = 20;
  const rows = await readSheet('job_matches');
  const filtered = rows
    .filter(r => String(r.candidate_id) === String(candidateId))
    .sort((a, b) => parseInt(b.id) - parseInt(a.id));
  const total = filtered.length;
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) || 1 };
}

module.exports = {
  initSheets,
  readSheet,
  getDealers, getActiveDealers, getDealer, addDealer, updateDealer, toggleDealer, deleteDealer,
  incrementDealerLeadCount, activateDealerSubscription, resetDealerSubscription,
  saveLead, getLeads, getAllLeads, getUnmatchedLeads, getLead, assignLead,
  saveFetchedPost, getFetchedPosts, getFetchedPost, isSeenPost, markPostSeen,
  saveFetchedJob, batchSaveFetchedJobs, getFetchedJobs, getFetchedJob, _clearSeenFetchedJobs: () => seenFetchedJobs.clear(),
  addPayment, getPayment, getPayments, verifyPayment, rejectPayment,
  addCandidate, getCandidates, getActiveCandidates, getCandidate, updateCandidate, toggleCandidate, deleteCandidate,
  incrementCandidateLeadCount, activateCandidateSubscription, resetCandidateSubscription,
  saveJobMatch, getJobMatches, isSeenJob, markJobSeen,
  addCandidatePayment, getCandidatePayment, getCandidatePayments, verifyCandidatePayment, rejectCandidatePayment,
  cleanupOldData,
  getDealerLeads, getCandidateJobMatches,
};
