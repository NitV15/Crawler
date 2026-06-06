process.env.DB_PATH = ':memory:';

let db;
beforeEach(() => {
  jest.resetModules();
  db = require('../db');
  db._resetDb();
  db.initDb();
});

test('db module loads', () => {
  expect(() => require('../db')).not.toThrow();
});

describe('isSeenJob / markJobSeen per-candidate', () => {
  test('isSeenJob: false when not seen', () => {
    expect(db.isSeenJob('job1', 1)).toBe(false);
  });

  test('isSeenJob: true after markJobSeen for same candidate', () => {
    db.markJobSeen('job1', 1);
    expect(db.isSeenJob('job1', 1)).toBe(true);
  });

  test('isSeenJob: false for different candidate even if another saw it', () => {
    db.markJobSeen('job1', 1);
    expect(db.isSeenJob('job1', 2)).toBe(false);
  });

  test('same job can be seen by two different candidates', () => {
    db.markJobSeen('job1', 1);
    db.markJobSeen('job1', 2);
    expect(db.isSeenJob('job1', 1)).toBe(true);
    expect(db.isSeenJob('job1', 2)).toBe(true);
  });
});
