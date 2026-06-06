const jwt = require('jsonwebtoken');
process.env.SESSION_SECRET = 'test-secret';
const { requireAuth } = require('../auth-middleware');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireAuth', () => {
  test('passes when JWT type matches', () => {
    const token = jwt.sign({ type: 'dealer', id: 5 }, 'test-secret');
    const req = { cookies: { cm_auth: token }, params: {} };
    const res = mockRes();
    const next = jest.fn();
    requireAuth('dealer')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ type: 'dealer', id: 5 });
  });

  test('returns 401 when no cookie', () => {
    const req = { cookies: {}, params: {} };
    const res = mockRes();
    requireAuth('dealer')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 403 when type mismatch', () => {
    const token = jwt.sign({ type: 'admin', id: 0 }, 'test-secret');
    const req = { cookies: { cm_auth: token }, params: {} };
    const res = mockRes();
    requireAuth('dealer')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when dealer accesses wrong id', () => {
    const token = jwt.sign({ type: 'dealer', id: 5 }, 'test-secret');
    const req = { cookies: { cm_auth: token }, params: { id: '99' } };
    const res = mockRes();
    requireAuth('dealer')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('admin can access any :id', () => {
    const token = jwt.sign({ type: 'admin', id: 0 }, 'test-secret');
    const req = { cookies: { cm_auth: token }, params: { id: '99' } };
    const res = mockRes();
    const next = jest.fn();
    requireAuth('admin', 'dealer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

jest.mock('../db', () => ({
  initDb: jest.fn(),
  getDealers: jest.fn().mockReturnValue([]),
  getCandidates: jest.fn().mockReturnValue([]),
  getDealer: jest.fn().mockReturnValue(null),
  getCandidate: jest.fn().mockReturnValue(null),
  getLeads: jest.fn().mockReturnValue([]),
  getUnmatchedLeads: jest.fn().mockReturnValue([]),
  getAllLeads: jest.fn().mockReturnValue([]),
  getActiveDealers: jest.fn().mockReturnValue([]),
  getActiveCandidates: jest.fn().mockReturnValue([]),
  getFetchedPosts: jest.fn().mockReturnValue([]),
  getFetchedJobs: jest.fn().mockReturnValue([]),
  getPayments: jest.fn().mockReturnValue([]),
  getCandidatePayments: jest.fn().mockReturnValue([]),
  getJobMatches: jest.fn().mockReturnValue([]),
  addDealer: jest.fn(),
  addCandidate: jest.fn(),
  saveLead: jest.fn(),
  addPayment: jest.fn().mockReturnValue(1),
  getPayment: jest.fn().mockReturnValue(null),
  verifyPayment: jest.fn(),
  rejectPayment: jest.fn(),
  addCandidatePayment: jest.fn().mockReturnValue(1),
  getCandidatePayment: jest.fn().mockReturnValue(null),
  verifyCandidatePayment: jest.fn(),
  rejectCandidatePayment: jest.fn(),
  toggleDealer: jest.fn(),
  updateDealer: jest.fn(),
  deleteDealer: jest.fn(),
  incrementDealerLeadCount: jest.fn(),
  activateDealerSubscription: jest.fn(),
  resetDealerSubscription: jest.fn(),
  toggleCandidate: jest.fn(),
  updateCandidate: jest.fn(),
  deleteCandidate: jest.fn(),
  incrementCandidateLeadCount: jest.fn(),
  activateCandidateSubscription: jest.fn(),
  resetCandidateSubscription: jest.fn(),
  saveFetchedPost: jest.fn(),
  getFetchedPost: jest.fn().mockReturnValue(null),
  saveFetchedJob: jest.fn(),
  getFetchedJob: jest.fn().mockReturnValue(null),
  saveJobMatch: jest.fn(),
  getCandidateJobMatches: jest.fn().mockReturnValue({ items: [], total: 0, page: 1, pages: 0 }),
  getLeadsByDealer: jest.fn().mockReturnValue({ items: [], total: 0, page: 1, pages: 0 }),
  getDealerLeadStats: jest.fn().mockReturnValue({ total: 0, thisMonth: 0 }),
  getCandidateMatchCount: jest.fn().mockReturnValue(0),
  getLead: jest.fn().mockReturnValue(null),
  assignLead: jest.fn(),
  cleanupOldData: jest.fn().mockReturnValue({ deleted_fetched_posts: 0, deleted_fetched_jobs: 0, deleted_unmatched_leads: 0 }),
  isSeenPost: jest.fn().mockReturnValue(false),
  markPostSeen: jest.fn(),
  isSeenJob: jest.fn().mockReturnValue(false),
  markJobSeen: jest.fn(),
}));
jest.mock('../mailer', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue(),
  sendLeadEmail: jest.fn(),
  sendJobAlertEmail: jest.fn(),
  sendSubscriptionConfirmationEmail: jest.fn(),
  sendPaymentRejectedEmail: jest.fn(),
  sendCandidateSubscriptionConfirmationEmail: jest.fn(),
  sendCandidatePaymentRejectedEmail: jest.fn(),
  sendSubscriptionExpiryWarningEmail: jest.fn(),
  sendSubscriptionExpiredEmail: jest.fn(),
  sendCandidateExpiryWarningEmail: jest.fn(),
  sendCandidateExpiredEmail: jest.fn(),
}));
jest.mock('../logger', () => {
  console.log = console.log;
  return { getLogs: jest.fn(() => []), subscribe: jest.fn(() => () => {}) };
});

const request = require('supertest');
const { createApp } = require('../server');

describe('POST /api/auth/request-otp', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  test('returns 400 when type missing', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when dealer email not found', async () => {
    const { getDealers } = require('../db');
    getDealers.mockReturnValue([{ id: '1', emails: 'other@b.com', active: '1' }]);
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'a@b.com', type: 'dealer' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Email not found');
  });

  test('sends OTP and returns 200 for known dealer email', async () => {
    const { getDealers } = require('../db');
    const { sendOtpEmail } = require('../mailer');
    getDealers.mockReturnValue([{ id: '5', name: 'Test', emails: 'a@b.com', active: '1' }]);
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'a@b.com', type: 'dealer' });
    expect(res.status).toBe(200);
    expect(sendOtpEmail).toHaveBeenCalledWith('a@b.com', expect.stringMatching(/^\d{6}$/));
  });
});

describe('POST /api/auth/verify-otp', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  test('returns 400 for wrong OTP', async () => {
    const { getDealers } = require('../db');
    getDealers.mockReturnValue([{ id: '5', name: 'Test', emails: 'a@b.com', active: '1' }]);
    await request(app).post('/api/auth/request-otp').send({ email: 'a@b.com', type: 'dealer' });
    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'a@b.com', otp: '000000', type: 'dealer' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  let app;
  beforeEach(() => { app = createApp(); });
  test('clears cookie and returns 200', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  let app;
  beforeEach(() => { app = createApp(); });
  test('returns 401 with no cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
