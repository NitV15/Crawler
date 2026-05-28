jest.mock('../sheets');
jest.mock('../indeed-fetcher');
jest.mock('../job-matcher');
jest.mock('../mailer');

const { startJobsCrawler, stopJobsCrawler, getJobsCrawlerStatus, checkCandidateSubscription } = require('../jobs-crawler');
const sheets = require('../sheets');
const { fetchIndeedJobs } = require('../indeed-fetcher');
const { processJobBatch } = require('../job-matcher');
const { sendJobAlertEmail } = require('../mailer');

const freeCandidate = {
  id: 1, name: 'Raj Kumar', emails: 'raj@test.com',
  role: 'DevOps Engineer', skills: 'Docker, Kubernetes',
  experience_level: '3-5 yr', city: 'Bangalore',
  lead_count: 0, subscription_status: 'free', subscription_expires_at: null,
};
const fakeJob = {
  jobkey: 'abc123', job_id: 'indeed_abc123',
  title: 'DevOps Engineer', company: 'Razorpay',
  location: 'Bangalore', url: 'https://indeed.com/job/abc123',
  snippet: 'K8s required.', date: 'Mon, 26 May 2026 10:00:00 GMT',
  created_utc: Math.floor(Date.now() / 1000),
};

beforeEach(() => {
  jest.clearAllMocks();
  sheets.getActiveCandidates.mockResolvedValue([freeCandidate]);
  sheets.getCandidate.mockResolvedValue(freeCandidate);
  sheets.saveJobMatch.mockResolvedValue();
  sheets.incrementCandidateLeadCount.mockResolvedValue();
  sheets.resetCandidateSubscription.mockResolvedValue();
  sheets.isSeenJob.mockReturnValue(false);
  sheets.markJobSeen.mockImplementation(() => {});
  fetchIndeedJobs.mockResolvedValue([fakeJob]);
  processJobBatch.mockResolvedValue([{ index: 0, is_relevant: true, suggested_tip: 'Highlight K8s.' }]);
  sendJobAlertEmail.mockResolvedValue();
});

test('getJobsCrawlerStatus returns initial state', () => {
  const s = getJobsCrawlerStatus();
  expect(s).toMatchObject({ running: false, jobsCollected: 0, matchesFound: 0, emailsSent: 0 });
});

test('checkCandidateSubscription: lead_count=0 → send', () => {
  expect(checkCandidateSubscription({ lead_count: 0, subscription_status: 'free', subscription_expires_at: null })).toBe('send');
});

test('checkCandidateSubscription: lead_count=1 → send_with_footer', () => {
  expect(checkCandidateSubscription({ lead_count: 1, subscription_status: 'free', subscription_expires_at: null })).toBe('send_with_footer');
});

test('checkCandidateSubscription: lead_count=2 → skip', () => {
  expect(checkCandidateSubscription({ lead_count: 2, subscription_status: 'free', subscription_expires_at: null })).toBe('skip');
});

test('checkCandidateSubscription: active subscription → send', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  expect(checkCandidateSubscription({ lead_count: 99, subscription_status: 'active', subscription_expires_at: future })).toBe('send');
});

test('checkCandidateSubscription: expired subscription → expired', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  expect(checkCandidateSubscription({ lead_count: 0, subscription_status: 'active', subscription_expires_at: past })).toBe('expired');
});

test('startJobsCrawler fetches jobs per candidate and sends email', async () => {
  processJobBatch.mockImplementation(async (batch) => {
    stopJobsCrawler();
    return [{ index: 0, is_relevant: true, suggested_tip: 'Highlight K8s.' }];
  });
  await startJobsCrawler();

  expect(fetchIndeedJobs).toHaveBeenCalledWith('DevOps Engineer', 'Docker, Kubernetes', 'Bangalore');
  expect(processJobBatch).toHaveBeenCalled();
  expect(sendJobAlertEmail).toHaveBeenCalledTimes(1);
  expect(sheets.saveJobMatch).toHaveBeenCalled();
  expect(sheets.incrementCandidateLeadCount).toHaveBeenCalledWith(1);
});

test('startJobsCrawler skips already-seen jobs', async () => {
  sheets.isSeenJob.mockReturnValue(true);
  fetchIndeedJobs.mockImplementation(async (...args) => {
    stopJobsCrawler();
    return [fakeJob];
  });
  await startJobsCrawler();
  expect(sendJobAlertEmail).not.toHaveBeenCalled();
});

test('startJobsCrawler skips job older than 3 days', async () => {
  fetchIndeedJobs.mockImplementation(async () => {
    stopJobsCrawler();
    return [{ ...fakeJob, created_utc: Math.floor(Date.now() / 1000) - 4 * 86400 }];
  });
  await startJobsCrawler();
  expect(sendJobAlertEmail).not.toHaveBeenCalled();
});

test('startJobsCrawler skips when candidate at free limit (skip)', async () => {
  sheets.getCandidate.mockResolvedValue({ ...freeCandidate, lead_count: 2 });
  processJobBatch.mockImplementation(async (batch) => {
    stopJobsCrawler();
    return [{ index: 0, is_relevant: true, suggested_tip: 'Highlight K8s.' }];
  });
  await startJobsCrawler();
  expect(sendJobAlertEmail).not.toHaveBeenCalled();
});

test('startJobsCrawler sends with footer when lead_count=1', async () => {
  sheets.getCandidate.mockResolvedValue({ ...freeCandidate, lead_count: 1 });
  processJobBatch.mockImplementation(async (batch) => {
    stopJobsCrawler();
    return [{ index: 0, is_relevant: true, suggested_tip: 'Highlight K8s.' }];
  });
  await startJobsCrawler();
  expect(sendJobAlertEmail).toHaveBeenCalledWith(expect.objectContaining({ includeSubscribeFooter: true }));
});
