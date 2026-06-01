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

jest.mock('../sheets', () => ({
  getDealers: jest.fn(),
  getCandidates: jest.fn(),
  getDealer: jest.fn(),
  getCandidate: jest.fn(),
  getLeads: jest.fn(),
  getUnmatchedLeads: jest.fn(),
  getAllLeads: jest.fn(),
  getActiveDealers: jest.fn().mockResolvedValue([]),
  getActiveCandidates: jest.fn().mockResolvedValue([]),
  getFetchedPosts: jest.fn().mockResolvedValue([]),
  getFetchedJobs: jest.fn().mockResolvedValue([]),
  getPayments: jest.fn().mockResolvedValue([]),
  getCandidatePayments: jest.fn().mockResolvedValue([]),
  getJobMatches: jest.fn().mockResolvedValue([]),
  addDealer: jest.fn(),
  addCandidate: jest.fn(),
  saveLead: jest.fn(),
  initSheets: jest.fn().mockResolvedValue(),
  readSheet: jest.fn().mockResolvedValue([]),
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
    const { getDealers } = require('../sheets');
    getDealers.mockResolvedValue([{ id: '1', emails: 'other@b.com', active: '1' }]);
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'a@b.com', type: 'dealer' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Email not found');
  });

  test('sends OTP and returns 200 for known dealer email', async () => {
    const { getDealers } = require('../sheets');
    const { sendOtpEmail } = require('../mailer');
    getDealers.mockResolvedValue([{ id: '5', name: 'Test', emails: 'a@b.com', active: '1' }]);
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'a@b.com', type: 'dealer' });
    expect(res.status).toBe(200);
    expect(sendOtpEmail).toHaveBeenCalledWith('a@b.com', expect.stringMatching(/^\d{6}$/));
  });
});

describe('POST /api/auth/verify-otp', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  test('returns 400 for wrong OTP', async () => {
    const { getDealers } = require('../sheets');
    getDealers.mockResolvedValue([{ id: '5', name: 'Test', emails: 'a@b.com', active: '1' }]);
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
