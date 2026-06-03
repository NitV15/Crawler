jest.mock('../sheets');
jest.mock('../indeed-fetcher');
jest.mock('../job-matcher');
jest.mock('../mailer');

const { startJobsCrawler, stopJobsCrawler, getJobsCrawlerStatus, checkCandidateSubscription, _clearWarnedCandidates } = require('../jobs-crawler');
const sheets = require('../sheets');
const { fetchIndeedJobs } = require('../indeed-fetcher');
const { processJobBatch } = require('../job-matcher');
const { sendJobAlertEmail, sendCandidateExpiryWarningEmail, sendCandidateExpiredEmail } = require('../mailer');

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
  _clearWarnedCandidates();
  sendCandidateExpiryWarningEmail.mockResolvedValue();
  sendCandidateExpiredEmail.mockResolvedValue();
  sheets.getActiveCandidates.mockResolvedValue([freeCandidate]);
  sheets.getCandidate.mockResolvedValue(freeCandidate);
  sheets.saveJobMatch.mockResolvedValue();
  sheets.incrementCandidateLeadCount.mockResolvedValue();
  sheets.resetCandidateSubscription.mockResolvedValue();
  sheets.isSeenJob.mockReturnValue(false);
  sheets.markJobSeen.mockImplementation(() => {});
  sheets.saveFetchedJob.mockResolvedValue();
  sheets.batchSaveFetchedJobs.mockResolvedValue();
  sheets.getFetchedJobs.mockResolvedValue([]);
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

  expect(fetchIndeedJobs).toHaveBeenCalledWith('DevOps Engineer', '', 'Bangalore');
  expect(processJobBatch).toHaveBeenCalled();
  expect(sendJobAlertEmail).toHaveBeenCalledTimes(1);
  expect(sheets.saveJobMatch).toHaveBeenCalled();
  expect(sheets.incrementCandidateLeadCount).toHaveBeenCalledWith(1);
});

test('startJobsCrawler saves each job to fetched_jobs in a batch', async () => {
  processJobBatch.mockImplementation(async () => { stopJobsCrawler(); return []; });
  await startJobsCrawler();
  await new Promise(r => setTimeout(r, 50));
  expect(sheets.batchSaveFetchedJobs).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({
      jobId: fakeJob.job_id,
      jobTitle: fakeJob.title,
      company: fakeJob.company,
    })])
  );
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

test('startJobsCrawler skips job older than 5 days', async () => {
  fetchIndeedJobs.mockImplementation(async () => {
    stopJobsCrawler();
    return [{ ...fakeJob, created_utc: Math.floor(Date.now() / 1000) - 6 * 86400 }];
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

const activeCandidate = {
  id: 2, name: 'New User', emails: 'new@test.com',
  role: 'Backend Developer', skills: 'Node.js',
  experience_level: '3-5 yr', city: 'Delhi',
  lead_count: 0, subscription_status: 'active',
  subscription_expires_at: new Date(Date.now() + 86400000).toISOString(),
};

const fetchedJob = {
  id: '5', job_id: 'adzuna_fetchedold', job_title: 'Node.js Developer',
  company: 'OldCo', location: 'Delhi', job_url: 'https://example.com/job/5',
  snippet: 'Node.js required.', fetched_at: '2026-05-30T10:00:00.000Z',
};

test('catch-up: new candidate (lead_count=0) gets fetched_jobs buffered', async () => {
  sheets.getActiveCandidates.mockResolvedValue([activeCandidate]);
  sheets.getCandidate.mockResolvedValue(activeCandidate);
  sheets.getFetchedJobs.mockResolvedValue([fetchedJob]);
  fetchIndeedJobs.mockResolvedValue([]);
  sheets.isSeenJob.mockReturnValue(false);

  processJobBatch.mockImplementation(async (batch) => {
    stopJobsCrawler();
    return batch.map((_, i) => ({ index: i, is_relevant: true, suggested_tip: 'Good match.' }));
  });

  await startJobsCrawler();
  expect(processJobBatch).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ candidate: activeCandidate }),
    ])
  );
  expect(sendJobAlertEmail).toHaveBeenCalled();
});

test('catch-up: candidate with lead_count>0 does NOT get catch-up jobs', async () => {
  const existingCandidate = { ...activeCandidate, lead_count: 3 };
  sheets.getActiveCandidates.mockResolvedValue([existingCandidate]);
  sheets.getCandidate.mockResolvedValue(existingCandidate);
  sheets.getFetchedJobs.mockResolvedValue([fetchedJob]);
  fetchIndeedJobs.mockImplementation(async () => {
    stopJobsCrawler();
    return [];
  });

  await startJobsCrawler();
  expect(sendJobAlertEmail).not.toHaveBeenCalled();
});

test('markJobSeen called with candidateId after successful send', async () => {
  processJobBatch.mockImplementation(async (batch) => {
    stopJobsCrawler();
    return [{ index: 0, is_relevant: true, suggested_tip: 'Great.' }];
  });
  await startJobsCrawler();
  expect(sheets.markJobSeen).toHaveBeenCalledWith(fakeJob.job_id, freeCandidate.id);
});

describe('candidate expiry notifications', () => {
  test('sends expiry email when candidate subscription is expired', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const expiredCandidate = {
      id: 99, name: 'Expired Cand', emails: 'exp@test.com', role: 'Developer',
      skills: 'JS', experience_level: '1-3 yr', city: 'Delhi', state: 'Delhi',
      preferred_locations: '', lead_count: '0',
      subscription_status: 'active', subscription_expires_at: past, active: '1',
    };
    sheets.getActiveCandidates.mockResolvedValue([expiredCandidate]);
    sheets.getCandidate.mockResolvedValue(expiredCandidate);
    sheets.resetCandidateSubscription.mockResolvedValue();
    processJobBatch.mockImplementation(async () => {
      stopJobsCrawler();
      return [{ index: 0, is_relevant: true, suggested_tip: 'Good luck.' }];
    });
    fetchIndeedJobs.mockResolvedValue([fakeJob]);

    await startJobsCrawler();
    await new Promise(r => setTimeout(r, 50));

    expect(sheets.resetCandidateSubscription).toHaveBeenCalledWith(99);
    expect(sendCandidateExpiredEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99 }),
      expect.stringContaining('/candidate-pay?candidate_id=99')
    );
  });

  test('sends warning email when candidate subscription expires within 3 days', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const warnCandidate = {
      id: 88, name: 'Warn Cand', emails: 'warn@test.com', role: 'Designer',
      skills: 'Figma', experience_level: '3-5 yr', city: 'Mumbai', state: 'Maharashtra',
      preferred_locations: '', lead_count: '0',
      subscription_status: 'active', subscription_expires_at: soon, active: '1',
    };
    sheets.getActiveCandidates.mockResolvedValue([warnCandidate]);
    sheets.getCandidate.mockResolvedValue(warnCandidate);
    fetchIndeedJobs.mockResolvedValue([]);
    processJobBatch.mockResolvedValue([]);

    startJobsCrawler();
    await new Promise(r => setTimeout(r, 200));
    stopJobsCrawler();
    await new Promise(r => setTimeout(r, 50));

    expect(sendCandidateExpiryWarningEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 88 }),
      expect.stringContaining('/candidate-pay?candidate_id=88')
    );
  });
});
