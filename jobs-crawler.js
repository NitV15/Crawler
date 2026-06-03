require('dotenv').config();
const { getActiveCandidates, getCandidate, saveJobMatch, incrementCandidateLeadCount,
        resetCandidateSubscription, isSeenJob, markJobSeen, batchSaveFetchedJobs,
        getFetchedJobs } = require('./sheets');
const { fetchIndeedJobs } = require('./indeed-fetcher');
const { processJobBatch } = require('./job-matcher');
const { sendJobAlertEmail, sendCandidateExpiryWarningEmail, sendCandidateExpiredEmail } = require('./mailer');

const CYCLE_WAIT_MS = 5 * 60 * 1000;
const warnedCandidates = new Set();
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const jobsCrawlerState = {
  running: false,
  jobsCollected: 0,
  matchesFound: 0,
  emailsSent: 0,
  lastBatchAt: null,
  currentCandidate: null,
};

function getJobsCrawlerStatus() {
  return { ...jobsCrawlerState };
}

function stopJobsCrawler() {
  jobsCrawlerState.running = false;
}

function checkCandidateSubscription(candidate) {
  const { lead_count, subscription_status, subscription_expires_at } = candidate;
  if (subscription_status === 'active') {
    if (!subscription_expires_at || new Date(subscription_expires_at) > new Date()) return 'send';
    return 'expired';
  }
  const count = parseInt(lead_count);
  if (count < 1) return 'send';
  if (count === 1) return 'send_with_footer';
  return 'skip';
}

async function runJobsCycle() {
  const candidates = await getActiveCandidates();
  if (!candidates.length) {
    jobsCrawlerState.currentCandidate = 'Waiting - no candidates';
    return;
  }

  const now = Date.now();
  const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  for (const candidate of candidates) {
    if (candidate.subscription_status !== 'active' || !candidate.subscription_expires_at) continue;
    const expiresAt = new Date(candidate.subscription_expires_at).getTime();
    if (expiresAt > now && expiresAt <= now + THREE_DAYS_MS && !warnedCandidates.has(String(candidate.id))) {
      warnedCandidates.add(String(candidate.id));
      sendCandidateExpiryWarningEmail(candidate, `${BASE_URL}/candidate-pay?candidate_id=${candidate.id}`)
        .catch(err => console.error(`[jobs] Warning email failed for ${candidate.name}: ${err.message}`));
    }
  }

  const fiveDaysAgo = Date.now() / 1000 - 5 * 86400;
  const seenThisCycle = new Set();
  const buffer = [];
  const newJobsToSave = [];

  for (const candidate of candidates) {
    if (!jobsCrawlerState.running) break;
    jobsCrawlerState.currentCandidate = candidate.name;
    try {
      const locations = [candidate.city, ...(candidate.preferred_locations || '').split(',').map(s => s.trim())]
        .filter((v, i, a) => v && a.indexOf(v) === i);
      let jobs = [];
      for (const loc of locations) {
        const fetched = await fetchIndeedJobs(candidate.role, '', loc === 'Remote' ? '' : loc);
        jobs.push(...fetched);
      }
      const seenIds = new Set();
      jobs = jobs.filter(j => seenIds.has(j.job_id) ? false : seenIds.add(j.job_id));
      for (const job of jobs) {
        if (job.created_utc < fiveDaysAgo) continue;
        if (isSeenJob(job.job_id, candidate.id)) continue;
        buffer.push({ candidate, job });
        jobsCrawlerState.jobsCollected++;
        if (!seenThisCycle.has(job.job_id)) {
          seenThisCycle.add(job.job_id);
          newJobsToSave.push({ jobId: job.job_id, jobTitle: job.title, company: job.company, location: job.location, jobUrl: job.url, snippet: job.snippet });
        }
      }
    } catch (err) {
      console.error(`[jobs] ${candidate.name} fetch failed: ${err.message}`);
    }
  }

  // Catch-up: buffer fetched_jobs for candidates who have never received a match
  const newCandidates = candidates.filter(c => parseInt(c.lead_count) === 0);
  if (newCandidates.length) {
    const allFetchedJobs = await getFetchedJobs(0);
    for (const candidate of newCandidates) {
      if (!jobsCrawlerState.running) break;
      for (const fj of allFetchedJobs) {
        if (isSeenJob(fj.job_id, candidate.id)) continue;
        buffer.push({
          candidate,
          job: {
            job_id:      fj.job_id,
            title:       fj.job_title,
            company:     fj.company,
            location:    fj.location,
            url:         fj.job_url,
            snippet:     fj.snippet,
            date:        fj.fetched_at,
            created_utc: Infinity,
          },
        });
        jobsCrawlerState.jobsCollected++;
      }
    }
  }

  if (newJobsToSave.length) {
    await batchSaveFetchedJobs(newJobsToSave).catch(err =>
      console.error(`[jobs] Batch save fetched jobs failed: ${err.message}`)
    );
  }

  if (!buffer.length) return;

  jobsCrawlerState.currentCandidate = 'Processing batch';
  const results = await processJobBatch(buffer);
  if (results.length < buffer.length) {
    console.warn(`[jobs] Batch returned ${results.length}/${buffer.length} results — some pairs may be unscored`);
  }

  for (let i = 0; i < buffer.length; i++) {
    const result = results.find(r => r.index === i);
    if (!result || !result.is_relevant) continue;

    const { candidate, job } = buffer[i];
    const freshCandidate = await getCandidate(candidate.id);
    if (!freshCandidate) continue;

    const action = checkCandidateSubscription(freshCandidate);
    if (action === 'expired') {
      await resetCandidateSubscription(freshCandidate.id);
      sendCandidateExpiredEmail(freshCandidate, `${BASE_URL}/candidate-pay?candidate_id=${freshCandidate.id}`)
        .catch(err => console.error(`[jobs] Expiry email failed for ${freshCandidate.name}: ${err.message}`));
      continue;
    }
    if (action === 'skip') continue;

    await saveJobMatch({
      candidateId: freshCandidate.id, indeedJobId: job.job_id,
      jobTitle: job.title, company: job.company, location: job.location,
      jobUrl: job.url, snippet: job.snippet, suggestedTip: result.suggested_tip, status: 'matched',
    });
    await sendJobAlertEmail({
      candidate: freshCandidate,
      job: { job_title: job.title, company: job.company, location: job.location,
             snippet: job.snippet, job_url: job.url, date: job.date },
      suggestedTip: result.suggested_tip,
      includeSubscribeFooter: action === 'send_with_footer',
      paymentLink: `${BASE_URL}/candidate-pay?candidate_id=${freshCandidate.id}`,
    });
    await incrementCandidateLeadCount(freshCandidate.id);
    markJobSeen(job.job_id, freshCandidate.id);
    jobsCrawlerState.matchesFound++;
    jobsCrawlerState.emailsSent++;
    console.log(`[jobs] ✓ ${freshCandidate.name} | ${job.title} at ${job.company}`);
  }

  jobsCrawlerState.lastBatchAt = new Date().toISOString();
}

async function startJobsCrawler() {
  if (jobsCrawlerState.running) return;
  jobsCrawlerState.running = true;
  jobsCrawlerState.jobsCollected = 0;
  jobsCrawlerState.matchesFound = 0;
  jobsCrawlerState.emailsSent = 0;
  jobsCrawlerState.lastBatchAt = null;

  console.log('[jobs] Starting continuous loop...');
  while (jobsCrawlerState.running) {
    try {
      const cycleTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Cycle timeout — exceeded 10min')), 10 * 60 * 1000)
      );
      await Promise.race([runJobsCycle(), cycleTimeout]);
    } catch (err) {
      console.error('[jobs] Cycle error:', err.message);
    }
    if (jobsCrawlerState.running) {
      jobsCrawlerState.currentCandidate = 'Waiting (5 min)';
      await new Promise(r => setTimeout(r, CYCLE_WAIT_MS));
    }
  }
  jobsCrawlerState.currentCandidate = 'Stopped';
  console.log('[jobs] Stopped.');
}

module.exports = { startJobsCrawler, stopJobsCrawler, getJobsCrawlerStatus, checkCandidateSubscription, _clearWarnedCandidates: () => warnedCandidates.clear() };
