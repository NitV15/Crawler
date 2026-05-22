const request = require('supertest');
const { createApp } = require('../server');
const { openDb, addDealer, addPayment } = require('../db');

jest.mock('../crawler', () => ({ runCrawl: jest.fn().mockResolvedValue({ fetched: 10, filtered: 2, leads: 1, emails: 1, unmatched: 0 }) }));
jest.mock('../mailer', () => ({
  sendSubscriptionConfirmationEmail: jest.fn().mockResolvedValue(),
  sendPaymentRejectedEmail: jest.fn().mockResolvedValue(),
}));

let db, app;
const dealerData = {
  name: 'Test Co', emails: 'a@b.com', industry_category: 'Furniture & Home Decor',
  services: 'chairs', target_customers: 'offices', keywords: 'chair',
  state: 'Haryana', city: 'Faridabad', service_areas: 'Sector 15', custom_subreddits: ''
};

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});
afterEach(() => db.close());

test('POST /api/register creates dealer with new fields', async () => {
  const res = await request(app).post('/api/register').send(dealerData);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  const dealer = db.prepare('SELECT * FROM dealers WHERE name = ?').get('Test Co');
  expect(dealer.city).toBe('Faridabad');
  expect(dealer.state).toBe('Haryana');
});

test('POST /api/register returns 400 when required fields missing', async () => {
  const res = await request(app).post('/api/register').send({ name: 'X' });
  expect(res.status).toBe(400);
});

test('GET /api/dealers returns dealer list', async () => {
  addDealer(db, dealerData);
  const res = await request(app).get('/api/dealers');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});

test('POST /api/crawl/trigger runs crawl and returns summary', async () => {
  const res = await request(app).post('/api/crawl/trigger');
  expect(res.status).toBe(200);
  expect(res.body.fetched).toBe(10);
  expect(res.body.leads).toBe(1);
});

test('POST /api/payments submits UTR', async () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealerData);
  const res = await request(app).post('/api/payments').send({ dealer_id: dealerId, utr_number: 'UTR123' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});

test('POST /api/payments/:id/verify activates subscription', async () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealerData);
  const { lastInsertRowid: payId } = addPayment(db, { dealerId, utrNumber: 'UTR456' });
  const res = await request(app).post(`/api/payments/${payId}/verify`).send({ dealer_id: dealerId });
  expect(res.status).toBe(200);
  const dealer = db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
  expect(dealer.subscription_status).toBe('active');
});

test('POST /api/payments/:id/reject sets status rejected', async () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealerData);
  const { lastInsertRowid: payId } = addPayment(db, { dealerId, utrNumber: 'UTR789' });
  const res = await request(app).post(`/api/payments/${payId}/reject`).send({ dealer_id: dealerId });
  expect(res.status).toBe(200);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(payId);
  expect(p.status).toBe('rejected');
});

test('GET /api/leads/unmatched returns unmatched leads', async () => {
  const res = await request(app).get('/api/leads/unmatched');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('POST /api/leads/:id/assign assigns lead to dealer', async () => {
  const { lastInsertRowid: dealerId } = addDealer(db, dealerData);
  db.prepare(`INSERT INTO leads (dealer_id, reddit_post_id, post_url, subreddit, status) VALUES (NULL, 'p1', 'http://x.com', 'india', 'unmatched')`).run();
  const lead = db.prepare("SELECT id FROM leads WHERE reddit_post_id = 'p1'").get();
  const res = await request(app).post(`/api/leads/${lead.id}/assign`).send({ dealer_id: dealerId });
  expect(res.status).toBe(200);
});

test('GET /api/payments returns payment list', async () => {
  const res = await request(app).get('/api/payments');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});
