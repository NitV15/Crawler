const {
  openDb,
  addCandidate, getCandidates, getCandidate, toggleCandidate, updateCandidate,
  getActiveCandidates, incrementCandidateLeadCount,
  activateCandidateSubscription, resetCandidateSubscription,
  saveJobMatch, getJobMatches,
  addCandidatePayment, getCandidatePayment, getCandidatePayments,
  verifyCandidatePayment, rejectCandidatePayment,
  isSeenJob, markJobSeen,
} = require('../db');

let db;
const candidate = {
  name: 'Raj Kumar', emails: 'raj@test.com', role: 'DevOps Engineer',
  skills: 'Docker, Kubernetes, AWS', experience_level: '3-5 yr',
  city: 'Bangalore', state: 'Karnataka', preferred_locations: 'Remote, Bangalore',
};

beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); });

test('openDb creates candidates table', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  expect(tables).toContain('candidates');
});

test('openDb creates job_matches table', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  expect(tables).toContain('job_matches');
});

test('openDb creates candidate_payments table', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  expect(tables).toContain('candidate_payments');
});

test('openDb creates seen_jobs table', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  expect(tables).toContain('seen_jobs');
});

test('addCandidate and getCandidate round-trip', () => {
  addCandidate(db, candidate);
  const all = getCandidates(db);
  expect(all.length).toBe(1);
  expect(all[0].name).toBe('Raj Kumar');
  expect(all[0].role).toBe('DevOps Engineer');
  const single = getCandidate(db, all[0].id);
  expect(single.emails).toBe('raj@test.com');
});

test('getActiveCandidates returns only active=1', () => {
  addCandidate(db, candidate);
  addCandidate(db, { ...candidate, name: 'Inactive', emails: 'i@test.com' });
  const all = getCandidates(db);
  toggleCandidate(db, all[1].id, false);
  expect(getActiveCandidates(db).length).toBe(1);
  expect(getActiveCandidates(db)[0].name).toBe('Raj Kumar');
});

test('updateCandidate persists changes', () => {
  addCandidate(db, candidate);
  const id = getCandidates(db)[0].id;
  updateCandidate(db, id, { ...candidate, role: 'Senior DevOps', skills: 'Terraform, AWS' });
  expect(getCandidate(db, id).role).toBe('Senior DevOps');
});

test('incrementCandidateLeadCount increments', () => {
  addCandidate(db, candidate);
  const id = getCandidates(db)[0].id;
  incrementCandidateLeadCount(db, id);
  incrementCandidateLeadCount(db, id);
  expect(getCandidate(db, id).lead_count).toBe(2);
});

test('activateCandidateSubscription sets active status and resets count', () => {
  addCandidate(db, candidate);
  const id = getCandidates(db)[0].id;
  incrementCandidateLeadCount(db, id);
  activateCandidateSubscription(db, id);
  const c = getCandidate(db, id);
  expect(c.subscription_status).toBe('active');
  expect(c.lead_count).toBe(0);
  expect(c.subscription_expires_at).not.toBeNull();
});

test('resetCandidateSubscription restores free tier', () => {
  addCandidate(db, candidate);
  const id = getCandidates(db)[0].id;
  activateCandidateSubscription(db, id);
  resetCandidateSubscription(db, id);
  const c = getCandidate(db, id);
  expect(c.subscription_status).toBe('free');
  expect(c.subscription_expires_at).toBeNull();
});

test('saveJobMatch and getJobMatches round-trip', () => {
  addCandidate(db, candidate);
  const cid = getCandidates(db)[0].id;
  saveJobMatch(db, {
    candidateId: cid, indeedJobId: 'indeed_abc123',
    jobTitle: 'DevOps Engineer', company: 'Razorpay',
    location: 'Bangalore', jobUrl: 'https://indeed.com/job/abc123',
    snippet: 'We are looking for a DevOps engineer...', suggestedTip: 'Highlight K8s', status: 'matched',
  });
  const matches = getJobMatches(db);
  expect(matches.length).toBe(1);
  expect(matches[0].job_title).toBe('DevOps Engineer');
  expect(matches[0].candidate_name).toBe('Raj Kumar');
});

test('addCandidatePayment and getCandidatePayments round-trip', () => {
  addCandidate(db, candidate);
  const cid = getCandidates(db)[0].id;
  addCandidatePayment(db, { candidateId: cid, utrNumber: 'UTR123456' });
  const payments = getCandidatePayments(db);
  expect(payments.length).toBe(1);
  expect(payments[0].utr_number).toBe('UTR123456');
  expect(payments[0].status).toBe('pending');
});

test('verifyCandidatePayment sets verified status', () => {
  addCandidate(db, candidate);
  const cid = getCandidates(db)[0].id;
  addCandidatePayment(db, { candidateId: cid, utrNumber: 'UTR999' });
  const pid = getCandidatePayments(db)[0].id;
  verifyCandidatePayment(db, pid);
  expect(getCandidatePayment(db, pid).status).toBe('verified');
});

test('rejectCandidatePayment sets rejected status', () => {
  addCandidate(db, candidate);
  const cid = getCandidates(db)[0].id;
  addCandidatePayment(db, { candidateId: cid, utrNumber: 'UTR888' });
  const pid = getCandidatePayments(db)[0].id;
  rejectCandidatePayment(db, pid);
  expect(getCandidatePayment(db, pid).status).toBe('rejected');
});

test('isSeenJob returns false for unknown job', () => {
  expect(isSeenJob(db, 'indeed_xyz')).toBe(false);
});

test('markJobSeen and isSeenJob round-trip', () => {
  markJobSeen(db, 'indeed_xyz123');
  expect(isSeenJob(db, 'indeed_xyz123')).toBe(true);
});

test('markJobSeen is idempotent', () => {
  markJobSeen(db, 'indeed_dup');
  markJobSeen(db, 'indeed_dup');
  expect(isSeenJob(db, 'indeed_dup')).toBe(true);
});
