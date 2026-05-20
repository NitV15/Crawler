const request = require('supertest');
const { createApp } = require('../server');
const { openDb } = require('../db');

describe('server API', () => {
  let app, db;

  beforeEach(() => {
    db = openDb(':memory:');
    app = createApp(db);
  });

  test('POST /api/register creates a dealer', async () => {
    const res = await request(app).post('/api/register').send({
      name: 'Gym Corp',
      emails: 'gym@test.com',
      industry: 'Gym Equipment',
      description: 'We sell treadmills and dumbbells',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/register returns 400 when fields missing', async () => {
    const res = await request(app).post('/api/register').send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('GET /api/dealers returns seeded dealer', async () => {
    const res = await request(app).get('/api/dealers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Nitin Tanwar (Test)');
  });

  test('GET /api/leads returns empty array initially', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/dealers/:id/toggle pauses a dealer', async () => {
    const dealersRes = await request(app).get('/api/dealers');
    const id = dealersRes.body[0].id;

    await request(app).post(`/api/dealers/${id}/toggle`).send({ active: false });

    const afterRes = await request(app).get('/api/dealers');
    const dealer = afterRes.body.find(d => d.id === id);
    expect(dealer.active).toBe(0);
  });
});
