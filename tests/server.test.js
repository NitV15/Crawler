const request = require('supertest');
const { createApp } = require('../server');

jest.mock('../sheets', () => ({
  initSheets: jest.fn().mockResolvedValue(),
  getDealers: jest.fn().mockResolvedValue([]),
  getDealer: jest.fn().mockResolvedValue(null),
  addDealer: jest.fn().mockResolvedValue(1),
  updateDealer: jest.fn().mockResolvedValue(),
  toggleDealer: jest.fn().mockResolvedValue(),
  incrementDealerLeadCount: jest.fn().mockResolvedValue(),
  activateDealerSubscription: jest.fn().mockResolvedValue(),
  resetDealerSubscription: jest.fn().mockResolvedValue(),
  saveLead: jest.fn().mockResolvedValue(1),
  getLeads: jest.fn().mockResolvedValue([]),
  getAllLeads: jest.fn().mockResolvedValue([]),
  getUnmatchedLeads: jest.fn().mockResolvedValue([]),
  getLead: jest.fn().mockResolvedValue(null),
  assignLead: jest.fn().mockResolvedValue(),
  saveFetchedPost: jest.fn().mockResolvedValue(),
  getFetchedPosts: jest.fn().mockResolvedValue([]),
  getFetchedPost: jest.fn().mockResolvedValue(null),
  isSeenPost: jest.fn().mockReturnValue(false),
  markPostSeen: jest.fn(),
  addPayment: jest.fn().mockResolvedValue(1),
  getPayment: jest.fn().mockResolvedValue(null),
  getPayments: jest.fn().mockResolvedValue([]),
  verifyPayment: jest.fn().mockResolvedValue(),
  rejectPayment: jest.fn().mockResolvedValue(),
  addCandidate: jest.fn().mockResolvedValue(1),
  getCandidates: jest.fn().mockResolvedValue([]),
  getActiveCandidates: jest.fn().mockResolvedValue([]),
  getCandidate: jest.fn().mockResolvedValue(null),
  updateCandidate: jest.fn().mockResolvedValue(),
  toggleCandidate: jest.fn().mockResolvedValue(),
  incrementCandidateLeadCount: jest.fn().mockResolvedValue(),
  activateCandidateSubscription: jest.fn().mockResolvedValue(),
  resetCandidateSubscription: jest.fn().mockResolvedValue(),
  saveJobMatch: jest.fn().mockResolvedValue(),
  getJobMatches: jest.fn().mockResolvedValue([]),
  isSeenJob: jest.fn().mockReturnValue(false),
  markJobSeen: jest.fn(),
  addCandidatePayment: jest.fn().mockResolvedValue(1),
  getCandidatePayment: jest.fn().mockResolvedValue(null),
  getCandidatePayments: jest.fn().mockResolvedValue([]),
  verifyCandidatePayment: jest.fn().mockResolvedValue(),
  rejectCandidatePayment: jest.fn().mockResolvedValue(),
  cleanupOldData: jest.fn().mockResolvedValue({ deleted_fetched: 0, deleted_unmatched: 0 }),
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

const sheetsModule = require('../sheets');
const mailerModule = require('../mailer');
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

test('GET /api/dealers returns dealer list', async () => {
  sheetsModule.getDealers.mockResolvedValue([
    { id: '1', name: 'Test Co', city: 'Faridabad', active: '1' },
  ]);
  const res = await request(app).get('/api/dealers');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});

test('GET /api/crawl/status returns status object with running field', async () => {
  const res = await request(app).get('/api/crawl/status');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('running', false);
  expect(res.body).toHaveProperty('postsCollected');
});

test('POST /api/crawl/start returns success and calls startCrawler', async () => {
  const { startCrawler } = require('../crawler');
  const res = await request(app).post('/api/crawl/start');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(startCrawler).toHaveBeenCalled();
});

test('POST /api/crawl/stop returns success and calls stopCrawler', async () => {
  const { stopCrawler } = require('../crawler');
  const res = await request(app).post('/api/crawl/stop');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(stopCrawler).toHaveBeenCalled();
});

test('POST /api/crawl/trigger returns 404 — route removed', async () => {
  const res = await request(app).post('/api/crawl/trigger');
  expect(res.status).toBe(404);
});

test('POST /api/payments submits UTR', async () => {
  const res = await request(app).post('/api/payments').send({ dealer_id: 1, utr_number: 'UTR123' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(sheetsModule.addPayment).toHaveBeenCalledWith(expect.objectContaining({ utrNumber: 'UTR123' }));
});

test('POST /api/payments/:id/verify activates subscription', async () => {
  sheetsModule.getPayment.mockResolvedValue({ id: 5, dealer_id: 1, utr_number: 'UTR456', status: 'pending' });
  sheetsModule.getDealer.mockResolvedValue({ id: 1, name: 'Test Co', emails: 'a@b.com' });
  const res = await request(app).post('/api/payments/5/verify').send({});
  expect(res.status).toBe(200);
  expect(sheetsModule.verifyPayment).toHaveBeenCalledWith(5);
  expect(sheetsModule.activateDealerSubscription).toHaveBeenCalledWith(1);
  expect(mailerModule.sendSubscriptionConfirmationEmail).toHaveBeenCalled();
});

test('POST /api/payments/:id/reject sets status rejected', async () => {
  sheetsModule.getPayment.mockResolvedValue({ id: 6, dealer_id: 1, utr_number: 'UTR789', status: 'pending' });
  sheetsModule.getDealer.mockResolvedValue({ id: 1, name: 'Test Co', emails: 'a@b.com' });
  const res = await request(app).post('/api/payments/6/reject').send({});
  expect(res.status).toBe(200);
  expect(sheetsModule.rejectPayment).toHaveBeenCalledWith(6);
  expect(mailerModule.sendPaymentRejectedEmail).toHaveBeenCalled();
});

test('GET /api/leads/unmatched returns unmatched leads', async () => {
  const res = await request(app).get('/api/leads/unmatched');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('POST /api/leads/:id/assign assigns lead to dealer', async () => {
  const res = await request(app).post('/api/leads/10/assign').send({ dealer_id: 1 });
  expect(res.status).toBe(200);
  expect(sheetsModule.assignLead).toHaveBeenCalledWith(10, 1);
});

test('GET /api/payments returns payment list', async () => {
  const res = await request(app).get('/api/payments');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('POST /api/candidates/register creates a candidate', async () => {
  sheetsModule.addCandidate.mockResolvedValue(1);
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

test('GET /api/candidates returns candidate list', async () => {
  sheetsModule.getCandidates.mockResolvedValue([{ id: '1', name: 'John Dev', active: '1' }]);
  const res = await request(app).get('/api/candidates');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].name).toBe('John Dev');
});

test('POST /api/candidate-payments creates a payment', async () => {
  sheetsModule.getCandidate.mockResolvedValue({ id: '1', name: 'John Dev', emails: 'john@dev.com' });
  sheetsModule.addCandidatePayment.mockResolvedValue(1);
  const res = await request(app).post('/api/candidate-payments').send({ candidate_id: 1, utr_number: 'UTR999' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(sheetsModule.addCandidatePayment).toHaveBeenCalled();
});
