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
