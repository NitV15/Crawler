process.env.GOOGLE_CREDENTIALS_PATH = '/tmp/fake-creds.json';
process.env.SPREADSHEET_ID = 'fake-spreadsheet-id';

test('db module loads', () => {
  expect(() => require('../db')).not.toThrow();
});

const mockValuesGet = jest.fn();
const mockValuesAppend = jest.fn();
const mockValuesUpdate = jest.fn();
const mockSpreadsheetsBatchUpdate = jest.fn();
const mockSpreadsheetsGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn().mockImplementation(() => ({
        getClient: jest.fn().mockResolvedValue({}),
      })),
    },
    sheets: jest.fn().mockReturnValue({
      spreadsheets: {
        values: { get: mockValuesGet, append: mockValuesAppend, update: mockValuesUpdate },
        batchUpdate: mockSpreadsheetsBatchUpdate,
        get: mockSpreadsheetsGet,
        create: jest.fn().mockResolvedValue({ data: { spreadsheetId: 'new-id' } }),
      },
    }),
  },
}));

const DEALER_HEADERS = ['id','name','emails','industry','description','industry_category','services','target_customers','keywords','state','city','service_areas','custom_subreddits','lead_count','subscription_status','subscription_expires_at','active','created_at'];
const LEAD_HEADERS = ['id','dealer_id','reddit_post_id','post_title','post_text','post_url','subreddit','match_reason','suggested_reply','what_to_sell','lead_category','post_location','status','emailed_at'];
const PAYMENT_HEADERS = ['id','dealer_id','utr_number','amount','status','created_at','verified_at'];
const FETCHED_HEADERS = ['id','post_id','post_title','post_text','post_url','subreddit','fetched_at'];
const CANDIDATE_HEADERS = ['id','name','emails','role','skills','experience_level','city','state','preferred_locations','lead_count','subscription_status','subscription_expires_at','active','created_at'];
const JOB_HEADERS = ['id','candidate_id','indeed_job_id','job_title','company','location','job_url','snippet','suggested_tip','status','emailed_at'];
const CAND_PAY_HEADERS = ['id','candidate_id','utr_number','amount','status','created_at','verified_at'];

function mockSheet(headers, rows = []) {
  return { data: { values: rows.length ? [headers, ...rows] : [headers] } };
}

let sheets;
let saveFetchedJob, getFetchedJobs, getFetchedJob, _clearSeenFetchedJobs;

const FETCHED_JOB_HEADERS = ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'];

beforeAll(async () => {
  mockSpreadsheetsGet.mockResolvedValue({ data: { sheets: [
    { properties: { title: 'fetched_posts' } },
    { properties: { title: 'job_matches' } },
    { properties: { title: 'fetched_jobs' } },
  ] } });
  mockValuesGet
    .mockResolvedValueOnce(mockSheet(FETCHED_HEADERS))
    .mockResolvedValueOnce(mockSheet(JOB_HEADERS))
    .mockResolvedValueOnce(mockSheet(FETCHED_JOB_HEADERS));
  sheets = require('../sheets');
  await sheets.initSheets();
  ({ saveFetchedJob, getFetchedJobs, getFetchedJob, _clearSeenFetchedJobs } = sheets);
});

beforeEach(() => {
  mockValuesGet.mockReset();
  mockValuesAppend.mockReset();
  mockValuesUpdate.mockReset();
  mockSpreadsheetsBatchUpdate.mockReset();
  mockSpreadsheetsGet.mockReset();
  mockValuesAppend.mockResolvedValue({ data: {} });
  mockValuesUpdate.mockResolvedValue({ data: {} });
});

// ─── Dealers ───────────────────────────────────────────────────────────────────

test('getDealers returns rows sorted by id DESC', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(DEALER_HEADERS, [
    ['1','Alpha Co','a@a.com','','','Furniture','chairs','offices','chair','Haryana','Faridabad','','','0','free','','1','2026-01-01'],
    ['2','Beta Co','b@b.com','','','Auto','cars','buyers','car','Delhi','Delhi','','','0','active','2026-06-01','1','2026-01-02'],
  ]));
  const dealers = await sheets.getDealers();
  expect(dealers).toHaveLength(2);
  expect(dealers[0].id).toBe('2');
  expect(dealers[0].name).toBe('Beta Co');
});

test('getActiveDealers filters by active=1', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(DEALER_HEADERS, [
    ['1','Active Co','a@a.com','','','Furniture','','','','','','','','0','free','','1','2026-01-01'],
    ['2','Inactive Co','b@b.com','','','Auto','','','','','','','','0','free','','0','2026-01-01'],
  ]));
  const dealers = await sheets.getActiveDealers();
  expect(dealers).toHaveLength(1);
  expect(dealers[0].name).toBe('Active Co');
});

test('addDealer calls appendRow with correct defaults', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(DEALER_HEADERS));
  mockValuesAppend.mockResolvedValue({ data: {} });
  await sheets.addDealer({ name: 'Test Co', emails: 'a@b.com', industry_category: 'Furniture', services: 'chairs', target_customers: 'offices', keywords: 'chair', state: 'Haryana', city: 'Faridabad', service_areas: 'Sector 15', custom_subreddits: '' });
  expect(mockValuesAppend).toHaveBeenCalledTimes(1);
  const appendedRow = mockValuesAppend.mock.calls[0][0].requestBody.values[0];
  expect(appendedRow[1]).toBe('Test Co');
  expect(appendedRow[14]).toBe('free');
  expect(appendedRow[16]).toBe('1');
});

test('incrementDealerLeadCount increments lead_count', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(DEALER_HEADERS, [
    ['1','Test Co','a@a.com','','','','','','','','','','','2','free','','1','2026-01-01'],
  ]));
  await sheets.incrementDealerLeadCount(1);
  expect(mockValuesUpdate).toHaveBeenCalledTimes(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[13]).toBe('3');
});

test('activateDealerSubscription sets status and resets lead_count', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(DEALER_HEADERS, [
    ['1','Test Co','a@a.com','','','','','','','','','','','5','free','','1','2026-01-01'],
  ]));
  await sheets.activateDealerSubscription(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[14]).toBe('active');
  expect(updatedRow[13]).toBe('0');
  expect(updatedRow[15]).toBeTruthy();
});

test('resetDealerSubscription resets to free', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(DEALER_HEADERS, [
    ['1','Test Co','a@a.com','','','','','','','','','','','0','active','2026-06-01','1','2026-01-01'],
  ]));
  await sheets.resetDealerSubscription(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[14]).toBe('free');
  expect(updatedRow[15]).toBe('');
  expect(updatedRow[13]).toBe('0');
});

// ─── Leads ─────────────────────────────────────────────────────────────────────

test('saveLead calls appendRow with correct data', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(LEAD_HEADERS));
  await sheets.saveLead({ dealerId: 1, redditPostId: 'abc123', postTitle: 'Test', postText: 'Body', postUrl: 'http://r.com', subreddit: 'india', matchReason: 'match', suggestedReply: 'reply', whatToSell: 'chairs', leadCategory: 'Furniture', postLocation: 'Delhi', status: 'matched' });
  const row = mockValuesAppend.mock.calls[0][0].requestBody.values[0];
  expect(row[1]).toBe('1');
  expect(row[2]).toBe('abc123');
  expect(row[12]).toBe('matched');
});

test('getLeads joins dealer_name and filters matched/assigned', async () => {
  mockValuesGet
    .mockResolvedValueOnce(mockSheet(LEAD_HEADERS, [
      ['1','1','post1','T1','','http://x.com','india','','','','','','matched','2026-01-01'],
      ['2','1','post2','T2','','http://y.com','india','','','','','','assigned','2026-01-01'],
      ['3','','post3','T3','','http://z.com','india','','','','','','unmatched','2026-01-01'],
    ]))
    .mockResolvedValueOnce(mockSheet(DEALER_HEADERS, [
      ['1','Alpha Co','a@a.com','','','','','','','','','','','0','free','','1','2026-01-01'],
    ]));
  const leads = await sheets.getLeads();
  expect(leads).toHaveLength(2);
  expect(leads.every(l => l.status === 'matched' || l.status === 'assigned')).toBe(true);
  expect(leads[0].dealer_name).toBe('Alpha Co');
});

test('getUnmatchedLeads returns only unmatched', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(LEAD_HEADERS, [
    ['1','1','post1','T1','','http://x.com','india','','','','','','matched','2026-01-01'],
    ['2','','post2','T2','','http://y.com','india','','','','','','unmatched','2026-01-01'],
  ]));
  const leads = await sheets.getUnmatchedLeads();
  expect(leads).toHaveLength(1);
  expect(leads[0].status).toBe('unmatched');
});

test('assignLead updates dealer_id and status to assigned', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(LEAD_HEADERS, [
    ['1','','post1','T1','','http://x.com','india','','','','','','unmatched','2026-01-01'],
  ]));
  await sheets.assignLead(1, 5);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[1]).toBe('5');      // dealer_id at index 1
  expect(updatedRow[12]).toBe('assigned'); // status at index 12
});

// ─── Seen Posts ─────────────────────────────────────────────────────────────────

test('isSeenPost returns false for unknown post', () => {
  expect(sheets.isSeenPost('brand_new_post')).toBe(false);
});

test('saveFetchedPost adds post to seenPosts and is idempotent', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(FETCHED_HEADERS));
  await sheets.saveFetchedPost({ postId: 'idempotent_test_post', postTitle: 'Title', postText: 'Body', postUrl: 'http://r.com', subreddit: 'india' });
  expect(mockValuesAppend).toHaveBeenCalledTimes(1);
  expect(sheets.isSeenPost('idempotent_test_post')).toBe(true);
  mockValuesAppend.mockClear();
  await sheets.saveFetchedPost({ postId: 'idempotent_test_post', postTitle: 'Title', postText: 'Body', postUrl: 'http://r.com', subreddit: 'india' });
  expect(mockValuesAppend).not.toHaveBeenCalled();
});

// ─── Payments ──────────────────────────────────────────────────────────────────

test('addPayment appends row with pending status', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(PAYMENT_HEADERS));
  await sheets.addPayment({ dealerId: 1, utrNumber: 'UTR123' });
  const row = mockValuesAppend.mock.calls[0][0].requestBody.values[0];
  expect(row[1]).toBe('1');
  expect(row[2]).toBe('UTR123');
  expect(row[4]).toBe('pending');
});

test('getPayments joins dealer_name and dealer_emails', async () => {
  mockValuesGet
    .mockResolvedValueOnce(mockSheet(PAYMENT_HEADERS, [
      ['1','1','UTR123','1','pending','2026-01-01',''],
    ]))
    .mockResolvedValueOnce(mockSheet(DEALER_HEADERS, [
      ['1','Test Co','test@co.com','','','','','','','','','','','0','free','','1','2026-01-01'],
    ]));
  const payments = await sheets.getPayments();
  expect(payments[0].dealer_name).toBe('Test Co');
  expect(payments[0].dealer_emails).toBe('test@co.com');
});

test('verifyPayment updates status and verified_at', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(PAYMENT_HEADERS, [
    ['1','1','UTR123','1','pending','2026-01-01',''],
  ]));
  await sheets.verifyPayment(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[4]).toBe('verified');
  expect(updatedRow[6]).toBeTruthy();
});

// ─── Candidates ────────────────────────────────────────────────────────────────

test('addCandidate appends row with defaults', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(CANDIDATE_HEADERS));
  await sheets.addCandidate({ name: 'John', emails: 'j@j.com', role: 'Developer', skills: 'JS', experience_level: 'Mid', city: 'Delhi', state: 'Delhi', preferred_locations: 'Delhi,Mumbai' });
  const row = mockValuesAppend.mock.calls[0][0].requestBody.values[0];
  expect(row[1]).toBe('John');
  expect(row[9]).toBe('0');
  expect(row[10]).toBe('free');
  expect(row[12]).toBe('1');
});

test('getActiveCandidates filters by active=1', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(CANDIDATE_HEADERS, [
    ['1','John','j@j.com','Dev','JS','Mid','Delhi','Delhi','','0','free','','1','2026-01-01'],
    ['2','Jane','j2@j.com','PM','PM','Senior','Mumbai','MH','','0','free','','0','2026-01-01'],
  ]));
  const candidates = await sheets.getActiveCandidates();
  expect(candidates).toHaveLength(1);
  expect(candidates[0].name).toBe('John');
});

test('incrementCandidateLeadCount increments lead_count', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(CANDIDATE_HEADERS, [
    ['1','John','j@j.com','Dev','JS','Mid','Delhi','Delhi','','3','free','','1','2026-01-01'],
  ]));
  await sheets.incrementCandidateLeadCount(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[9]).toBe('4'); // lead_count at index 9
});

test('activateCandidateSubscription sets status and resets lead_count', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(CANDIDATE_HEADERS, [
    ['1','John','j@j.com','Dev','JS','Mid','Delhi','Delhi','','5','free','','1','2026-01-01'],
  ]));
  await sheets.activateCandidateSubscription(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[10]).toBe('active'); // subscription_status at index 10
  expect(updatedRow[9]).toBe('0');       // lead_count at index 9
  expect(updatedRow[11]).toBeTruthy();   // subscription_expires_at at index 11
});

test('addCandidatePayment appends row with pending status', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(CAND_PAY_HEADERS));
  await sheets.addCandidatePayment({ candidateId: 1, utrNumber: 'UTR789' });
  const row = mockValuesAppend.mock.calls[0][0].requestBody.values[0];
  expect(row[1]).toBe('1');       // candidate_id
  expect(row[2]).toBe('UTR789');  // utr_number
  expect(row[4]).toBe('pending'); // status
});

test('verifyCandidatePayment updates status and verified_at', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(CAND_PAY_HEADERS, [
    ['1','1','UTR789','10','pending','2026-01-01',''],
  ]));
  await sheets.verifyCandidatePayment(1);
  const updatedRow = mockValuesUpdate.mock.calls[0][0].requestBody.values[0];
  expect(updatedRow[4]).toBe('verified');
  expect(updatedRow[6]).toBeTruthy(); // verified_at
});

// ─── Job Matches ───────────────────────────────────────────────────────────────

test('isSeenJob returns false for unknown job', () => {
  expect(sheets.isSeenJob('brand_new_job')).toBe(false);
});

test('saveJobMatch adds to seenJobs and calls appendRow', async () => {
  mockValuesGet.mockResolvedValue(mockSheet(JOB_HEADERS));
  await sheets.saveJobMatch({ candidateId: 1, indeedJobId: 'job_xyz', jobTitle: 'Dev', company: 'Corp', location: 'Delhi', jobUrl: 'http://indeed.com/job', snippet: 'Great role', suggestedTip: 'Apply', status: 'matched' });
  expect(mockValuesAppend).toHaveBeenCalledTimes(1);
  expect(sheets.isSeenJob('job_xyz')).toBe(true);
});

// ─── Candidate Payments ─────────────────────────────────────────────────────────

test('getCandidatePayments joins candidate_name and candidate_emails', async () => {
  mockValuesGet
    .mockResolvedValueOnce(mockSheet(CAND_PAY_HEADERS, [
      ['1','1','UTR456','10','pending','2026-01-01',''],
    ]))
    .mockResolvedValueOnce(mockSheet(CANDIDATE_HEADERS, [
      ['1','John Dev','john@dev.com','Dev','JS','Mid','Delhi','Delhi','','0','free','','1','2026-01-01'],
    ]));
  const payments = await sheets.getCandidatePayments();
  expect(payments[0].candidate_name).toBe('John Dev');
  expect(payments[0].candidate_emails).toBe('john@dev.com');
});

// ── fetched_jobs ──────────────────────────────────────────────────────────────

describe('saveFetchedJob / getFetchedJobs / getFetchedJob', () => {
  const job = { jobId: 'adzuna_abc', jobTitle: 'DevOps Engineer', company: 'Razorpay', location: 'Bangalore', jobUrl: 'https://adzuna.com/1', snippet: 'K8s required.' };

  beforeEach(() => {
    _clearSeenFetchedJobs();
    mockValuesGet.mockResolvedValue({ data: { values: [
      ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'],
    ] } });
    mockValuesAppend.mockResolvedValue({});
  });

  test('saveFetchedJob appends a new job', async () => {
    await saveFetchedJob(job);
    expect(mockValuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'fetched_jobs' })
    );
  });

  test('saveFetchedJob deduplicates by jobId', async () => {
    await saveFetchedJob(job);
    await saveFetchedJob(job);
    expect(mockValuesAppend).toHaveBeenCalledTimes(1);
  });

  test('getFetchedJobs returns rows sorted by id desc', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [
      ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'],
      ['1','adzuna_a','Job A','Co A','Delhi','http://a','snippet a','2026-01-01T00:00:00Z'],
      ['2','adzuna_b','Job B','Co B','Mumbai','http://b','snippet b','2026-01-02T00:00:00Z'],
    ] } });
    const jobs = await getFetchedJobs();
    expect(jobs[0].id).toBe('2');
    expect(jobs[1].id).toBe('1');
  });

  test('getFetchedJob returns the matching row', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [
      ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'],
      ['5','adzuna_xyz','React Dev','Startup','Pune','http://x','React needed','2026-01-01T00:00:00Z'],
    ] } });
    const j = await getFetchedJob(5);
    expect(j.job_title).toBe('React Dev');
    expect(j.job_id).toBe('adzuna_xyz');
  });

  test('getFetchedJob returns null when not found', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [
      ['id','job_id','job_title','company','location','job_url','snippet','fetched_at'],
    ] } });
    const j = await getFetchedJob(999);
    expect(j).toBeNull();
  });
});

// ─── Cleanup ───────────────────────────────────────────────────────────────────

test('cleanupOldData deletes old fetched posts and unmatched leads', async () => {
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date().toISOString();
  mockSpreadsheetsBatchUpdate.mockResolvedValue({ data: {} });
  mockSpreadsheetsGet.mockResolvedValue({ data: { sheets: [
    { properties: { title: 'fetched_posts', sheetId: 0 } },
    { properties: { title: 'leads', sheetId: 1 } },
  ]}});
  mockValuesGet
    .mockResolvedValueOnce(mockSheet(FETCHED_HEADERS, [
      ['1','post_old','Old','','http://old.com','india', old],
      ['2','post_new','New','','http://new.com','india', recent],
    ]))
    .mockResolvedValueOnce(mockSheet(LEAD_HEADERS, [
      ['1','','oldpost','Old','','http://old.com','india','','','','','','unmatched', old],
      ['2','1','newpost','New','','http://new.com','india','','','','','','matched', recent],
    ]));
  const result = await sheets.cleanupOldData();
  expect(result.deleted_fetched).toBe(1);
  expect(result.deleted_unmatched).toBe(1);
  expect(mockSpreadsheetsBatchUpdate).toHaveBeenCalledTimes(1);
});
