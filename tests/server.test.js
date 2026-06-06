const request = require('supertest');
const { createApp } = require('../server');

process.env.SESSION_SECRET = 'test-secret';
const jwt = require('jsonwebtoken');
const adminToken = jwt.sign({ type: 'admin', id: 0 }, 'test-secret');
const adminCookie = `cm_auth=${adminToken}`;

jest.mock('../db', () => ({
  initDb: jest.fn(),
  getDealers: jest.fn().mockReturnValue([]),
  getDealer: jest.fn().mockReturnValue(null),
  addDealer: jest.fn().mockReturnValue(1),
  updateDealer: jest.fn(),
  toggleDealer: jest.fn(),
  deleteDealer: jest.fn(),
  incrementDealerLeadCount: jest.fn(),
  activateDealerSubscription: jest.fn(),
  resetDealerSubscription: jest.fn(),
  saveLead: jest.fn(),
  getLeads: jest.fn().mockReturnValue([]),
  getAllLeads: jest.fn().mockReturnValue([]),
  getUnmatchedLeads: jest.fn().mockReturnValue([]),
  getLead: jest.fn().mockReturnValue(null),
  assignLead: jest.fn(),
  saveFetchedPost: jest.fn(),
  getFetchedPosts: jest.fn().mockReturnValue([]),
  getFetchedPost: jest.fn().mockReturnValue(null),
  isSeenPost: jest.fn().mockReturnValue(false),
  markPostSeen: jest.fn(),
  addPayment: jest.fn().mockReturnValue(1),
  getPayment: jest.fn().mockReturnValue(null),
  getPayments: jest.fn().mockReturnValue([]),
  verifyPayment: jest.fn(),
  rejectPayment: jest.fn(),
  addCandidate: jest.fn().mockReturnValue(1),
  getCandidates: jest.fn().mockReturnValue([]),
  getActiveCandidates: jest.fn().mockReturnValue([]),
  getCandidate: jest.fn().mockReturnValue(null),
  updateCandidate: jest.fn(),
  toggleCandidate: jest.fn(),
  deleteCandidate: jest.fn(),
  incrementCandidateLeadCount: jest.fn(),
  activateCandidateSubscription: jest.fn(),
  resetCandidateSubscription: jest.fn(),
  saveJobMatch: jest.fn(),
  getJobMatches: jest.fn().mockReturnValue([]),
  isSeenJob: jest.fn().mockReturnValue(false),
  markJobSeen: jest.fn(),
  getFetchedJobs: jest.fn().mockReturnValue([]),
  getFetchedJob: jest.fn().mockReturnValue(null),
  addCandidatePayment: jest.fn().mockReturnValue(1),
  getCandidatePayment: jest.fn().mockReturnValue(null),
  getCandidatePayments: jest.fn().mockReturnValue([]),
  verifyCandidatePayment: jest.fn(),
  rejectCandidatePayment: jest.fn(),
  cleanupOldData: jest.fn().mockReturnValue({ deleted_fetched_posts: 0, deleted_fetched_jobs: 0, deleted_unmatched_leads: 0 }),
  getLeadsByDealer: jest.fn().mockReturnValue({ items: [], total: 0, page: 1, pages: 0 }),
  getCandidateJobMatches: jest.fn().mockReturnValue({ items: [], total: 0, page: 1, pages: 0 }),
  getDealerLeadStats: jest.fn().mockReturnValue({ total: 0, thisMonth: 0 }),
  getCandidateMatchCount: jest.fn().mockReturnValue(0),
}));

jest.mock('../crawler', () => ({
  startCrawler: jest.fn().mockResolvedValue(),
  stopCrawler: jest.fn(),
  getCrawlerStatus: jest.fn().mockReturnValue({
    running: false, postsCollected: 0, leadsFound: 0,
    emailsSent: 0, lastBatchAt: null, currentSource: null,
  }),
  checkSubscription: jest.fn().mockReturnValue('send'),
}));

jest.mock('../jobs-crawler', () => ({
  startJobsCrawler: jest.fn().mockResolvedValue(),
  stopJobsCrawler: jest.fn(),
  getJobsCrawlerStatus: jest.fn().mockReturnValue({
    running: false, jobsCollected: 0, matchesFound: 0, lastBatchAt: null,
  }),
  checkCandidateSubscription: jest.fn().mockReturnValue('send'),
}));

jest.mock('../mailer', () => ({
  sendLeadEmail: jest.fn().mockResolvedValue(),
  sendSubscriptionConfirmationEmail: jest.fn().mockResolvedValue(),
  sendPaymentRejectedEmail: jest.fn().mockResolvedValue(),
  sendJobAlertEmail: jest.fn().mockResolvedValue(),
  sendCandidateSubscriptionConfirmationEmail: jest.fn().mockResolvedValue(),
  sendCandidatePaymentRejectedEmail: jest.fn().mockResolvedValue(),
}));

const sheetsModule = require('../db');
const sheets = sheetsModule;
const mailerModule = require('../mailer');
const mailer = mailerModule;
let app;

const dealerData = {
  name: 'Test Co', emails: 'a@b.com', industry_category: 'Furniture & Home Decor',
  services: 'chairs', target_customers: 'offices', keywords: 'chair',
  state: 'Haryana', city: 'Faridabad', service_areas: 'Sector 15', custom_subreddits: ''
};

beforeEach(() => {
  jest.clearAllMocks();
  app = createApp();
});

test('POST /api/register creates dealer with new fields', async () => {
  const res = await request(app).post('/api/register').send(dealerData);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(sheetsModule.addDealer).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Test Co', city: 'Faridabad', state: 'Haryana',
  }));
});

test('POST /api/register returns 400 when required fields missing', async () => {
  const res = await request(app).post('/api/register').send({ name: 'X' });
  expect(res.status).toBe(400);
});

test('POST /api/register returns 400 when email already registered', async () => {
  sheetsModule.getDealers.mockReturnValue([{ id: '1', emails: 'a@b.com', active: '1' }]);
  const res = await request(app).post('/api/register').send(dealerData);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Email already registered');
  expect(sheetsModule.addDealer).not.toHaveBeenCalled();
});

test('PUT /api/dealers/:id ignores email from body and keeps existing email', async () => {
  sheetsModule.getDealer.mockReturnValue({ id: 1, name: 'Old Name', emails: 'original@b.com' });
  const dealerToken = jwt.sign({ type: 'dealer', id: 1 }, 'test-secret');
  const res = await request(app).put('/api/dealers/1')
    .set('Cookie', `cm_auth=${dealerToken}`)
    .send({ ...dealerData, emails: 'hacker@evil.com' });
  expect(res.status).toBe(200);
  expect(sheetsModule.updateDealer).toHaveBeenCalledWith(1, expect.objectContaining({ emails: 'original@b.com' }));
});

test('DELETE /api/dealers/:id deletes dealer (admin only)', async () => {
  const res = await request(app).delete('/api/dealers/1').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(sheetsModule.deleteDealer).toHaveBeenCalledWith(1);
});

test('DELETE /api/dealers/:id returns 403 for non-admin', async () => {
  const dealerToken = jwt.sign({ type: 'dealer', id: 1 }, 'test-secret');
  const res = await request(app).delete('/api/dealers/1').set('Cookie', `cm_auth=${dealerToken}`);
  expect(res.status).toBe(403);
});

test('GET /api/dealers returns dealer list', async () => {
  sheetsModule.getDealers.mockReturnValue([
    { id: '1', name: 'Test Co', city: 'Faridabad', active: '1' },
  ]);
  const res = await request(app).get('/api/dealers').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});

test('GET /api/crawl/status returns status object with running field', async () => {
  const res = await request(app).get('/api/crawl/status').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('running', false);
  expect(res.body).toHaveProperty('postsCollected');
});

test('POST /api/crawl/start returns success and calls startCrawler', async () => {
  const { startCrawler } = require('../crawler');
  const res = await request(app).post('/api/crawl/start').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(startCrawler).toHaveBeenCalled();
});

test('POST /api/crawl/stop returns success and calls stopCrawler', async () => {
  const { stopCrawler } = require('../crawler');
  const res = await request(app).post('/api/crawl/stop').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(stopCrawler).toHaveBeenCalled();
});

test('POST /api/crawl/trigger returns 404 — route removed', async () => {
  const res = await request(app).post('/api/crawl/trigger');
  expect(res.status).toBe(404);
});

test('POST /api/payments submits UTR', async () => {
  const res = await request(app).post('/api/payments').send({ dealer_id: 1, utr_number: 'UTR12345678' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(sheetsModule.addPayment).toHaveBeenCalledWith(expect.objectContaining({ utrNumber: 'UTR12345678' }));
});

test('POST /api/payments/:id/verify activates subscription', async () => {
  sheetsModule.getPayment.mockReturnValue({ id: 5, dealer_id: 1, utr_number: 'UTR456', status: 'pending' });
  sheetsModule.getDealer.mockReturnValue({ id: 1, name: 'Test Co', emails: 'a@b.com' });
  const res = await request(app).post('/api/payments/5/verify').set('Cookie', adminCookie).send({});
  expect(res.status).toBe(200);
  expect(sheetsModule.verifyPayment).toHaveBeenCalledWith(5);
  expect(sheetsModule.activateDealerSubscription).toHaveBeenCalledWith(1);
  expect(mailerModule.sendSubscriptionConfirmationEmail).toHaveBeenCalled();
});

test('POST /api/payments/:id/reject sets status rejected', async () => {
  sheetsModule.getPayment.mockReturnValue({ id: 6, dealer_id: 1, utr_number: 'UTR789', status: 'pending' });
  sheetsModule.getDealer.mockReturnValue({ id: 1, name: 'Test Co', emails: 'a@b.com' });
  const res = await request(app).post('/api/payments/6/reject').set('Cookie', adminCookie).send({});
  expect(res.status).toBe(200);
  expect(sheetsModule.rejectPayment).toHaveBeenCalledWith(6);
  expect(mailerModule.sendPaymentRejectedEmail).toHaveBeenCalled();
});

test('GET /api/leads/unmatched returns unmatched leads', async () => {
  const res = await request(app).get('/api/leads/unmatched').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('POST /api/leads/:id/assign assigns lead to dealer', async () => {
  const res = await request(app).post('/api/leads/10/assign').set('Cookie', adminCookie).send({ dealer_id: 1 });
  expect(res.status).toBe(200);
  expect(sheetsModule.assignLead).toHaveBeenCalledWith(10, 1);
});

test('GET /api/payments returns payment list', async () => {
  const res = await request(app).get('/api/payments').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('POST /api/candidates/register creates a candidate', async () => {
  sheetsModule.addCandidate.mockReturnValue(1);
  const res = await request(app).post('/api/candidates/register').send({
    name: 'John Dev', emails: 'john@dev.com', role: 'Developer',
    skills: 'JavaScript', experience_level: 'Mid', city: 'Delhi', state: 'Delhi',
    preferred_locations: 'Delhi,Mumbai',
  });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(sheetsModule.addCandidate).toHaveBeenCalledWith(expect.objectContaining({
    name: 'John Dev', city: 'Delhi',
  }));
});

test('POST /api/candidates/register returns 400 when email already registered', async () => {
  sheetsModule.getCandidates.mockReturnValue([{ id: '1', emails: 'john@dev.com', active: '1' }]);
  const res = await request(app).post('/api/candidates/register').send({
    name: 'Duplicate', emails: 'john@dev.com', role: 'Developer',
    skills: 'JavaScript', city: 'Delhi',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Email already registered');
  expect(sheetsModule.addCandidate).not.toHaveBeenCalled();
});

test('PUT /api/candidates/:id ignores email from body and keeps existing email', async () => {
  sheetsModule.getCandidate.mockReturnValue({ id: '1', name: 'John Dev', emails: 'original@dev.com' });
  const candidateToken = jwt.sign({ type: 'candidate', id: 1 }, 'test-secret');
  const res = await request(app).put('/api/candidates/1')
    .set('Cookie', `cm_auth=${candidateToken}`)
    .send({ name: 'John Updated', emails: 'hacker@evil.com', role: 'Developer', skills: 'JS', city: 'Delhi' });
  expect(res.status).toBe(200);
  expect(sheetsModule.updateCandidate).toHaveBeenCalledWith(1, expect.objectContaining({ emails: 'original@dev.com' }));
});

test('DELETE /api/candidates/:id deletes candidate (admin only)', async () => {
  const res = await request(app).delete('/api/candidates/1').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(sheetsModule.deleteCandidate).toHaveBeenCalledWith(1);
});

test('DELETE /api/candidates/:id returns 403 for non-admin', async () => {
  const candidateToken = jwt.sign({ type: 'candidate', id: 1 }, 'test-secret');
  const res = await request(app).delete('/api/candidates/1').set('Cookie', `cm_auth=${candidateToken}`);
  expect(res.status).toBe(403);
});

test('GET /api/candidates returns candidate list', async () => {
  sheetsModule.getCandidates.mockReturnValue([{ id: '1', name: 'John Dev', active: '1' }]);
  const res = await request(app).get('/api/candidates').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].name).toBe('John Dev');
});

test('POST /api/candidate-payments creates a payment', async () => {
  sheetsModule.getCandidate.mockReturnValue({ id: '1', name: 'John Dev', emails: 'john@dev.com' });
  sheetsModule.addCandidatePayment.mockReturnValue(1);
  const res = await request(app).post('/api/candidate-payments').send({ candidate_id: 1, utr_number: 'UTR99912345' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(sheetsModule.addCandidatePayment).toHaveBeenCalled();
});

describe('GET /api/fetched-jobs', () => {
  test('returns fetched jobs list', async () => {
    sheets.getFetchedJobs.mockReturnValue([
      { id: '1', job_id: 'adzuna_1', job_title: 'React Dev', company: 'Startup', location: 'Pune', job_url: 'http://a', snippet: 'React needed', fetched_at: '2026-05-29T00:00:00Z' },
    ]);
    const res = await request(app).get('/api/fetched-jobs').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].job_title).toBe('React Dev');
  });
});

describe('POST /api/fetched-jobs/:id/send', () => {
  const fakeJob = { id: '3', job_id: 'adzuna_3', job_title: 'DevOps Eng', company: 'Razorpay', location: 'Bangalore', job_url: 'http://j', snippet: 'K8s', fetched_at: '2026-05-29T00:00:00Z' };
  const fakeCandidate = { id: '1', name: 'Raj', emails: 'raj@test.com', lead_count: '0', subscription_status: 'free', subscription_expires_at: null };

  beforeEach(() => {
    sheets.getFetchedJob.mockReturnValue(fakeJob);
    sheets.getCandidate.mockReturnValue(fakeCandidate);
    sheets.saveJobMatch.mockReturnValue(1);
    sheets.incrementCandidateLeadCount.mockReturnValue();
    mailer.sendJobAlertEmail.mockResolvedValue();
  });

  test('returns 400 if candidate_id missing', async () => {
    const res = await request(app).post('/api/fetched-jobs/3/send').set('Cookie', adminCookie).send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 if job not found', async () => {
    sheets.getFetchedJob.mockReturnValue(null);
    const res = await request(app).post('/api/fetched-jobs/99/send').set('Cookie', adminCookie).send({ candidate_id: 1 });
    expect(res.status).toBe(404);
  });

  test('returns 404 if candidate not found', async () => {
    sheets.getCandidate.mockReturnValue(null);
    const res = await request(app).post('/api/fetched-jobs/3/send').set('Cookie', adminCookie).send({ candidate_id: 99 });
    expect(res.status).toBe(404);
  });

  test('saves job match and sends email', async () => {
    const res = await request(app).post('/api/fetched-jobs/3/send').set('Cookie', adminCookie).send({ candidate_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sheets.saveJobMatch).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: '1', indeedJobId: 'adzuna_3',
    }));
    expect(mailer.sendJobAlertEmail).toHaveBeenCalled();
    expect(sheets.incrementCandidateLeadCount).toHaveBeenCalledWith('1');
  });
});
