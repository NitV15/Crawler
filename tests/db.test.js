process.env.DB_PATH = ':memory:';

let db;
beforeEach(() => {
  jest.resetModules();
  db = require('../db');
  db.initDb();
});

test('initDb creates all 8 tables', () => {
  const tables = db._getDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  expect(tables).toEqual(expect.arrayContaining([
    'candidate_payments','candidates','dealers','fetched_jobs',
    'fetched_posts','job_matches','leads','payments',
  ]));
});

test('initDb seeds seenPosts/seenJobs/seenFetchedJobs from existing rows', () => {
  db._getDb().prepare("INSERT INTO fetched_posts (post_id,fetched_at) VALUES ('p1','2026-01-01')").run();
  db._getDb().prepare("INSERT INTO job_matches (candidate_id,indeed_job_id,emailed_at) VALUES ('1','j1','2026-01-01')").run();
  db._getDb().prepare("INSERT INTO fetched_jobs (job_id,fetched_at) VALUES ('fj1','2026-01-01')").run();
  jest.resetModules();
  const db2 = require('../db');
  db2.initDb();
  expect(db2.isSeenPost('p1')).toBe(true);
  expect(db2.isSeenJob('j1', '1')).toBe(true);
  expect(db2.isSeenFetchedJob('fj1')).toBe(true);
});
