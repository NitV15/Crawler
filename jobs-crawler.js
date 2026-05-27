require('dotenv').config();
const { getActiveCandidates, getCandidate, saveJobMatch, incrementCandidateLeadCount,
        resetCandidateSubscription, isSeenJob, markJobSeen } = require('./db');
const { fetchIndeedJobs } = require('./indeed-fetcher');
const { processJobBatch } = require('./job-matcher');
const { sendJobAlertEmail } = require('./mailer');

const CYCLE_WAIT_MS = 5 * 60 * 1000;

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
  if (lead_count < 1) return 'send';
  if (lead_count === 1) return 'send_with_footer';
  return 'skip';
}

async function runJobsCycle(db) {
  const candidates = getActiveCandidates(db);
  if (!candidates.length) {
    jobsCrawlerState.currentCandidate = 'Waiting - no candidates';
    return;
  }

  const threeDaysAgo = Date.now() / 1000 - 3 * 86400;
  const seenThisCycle = new Set();
  const buffer = [];

  for (const candidate of candidates) {
    if (!jobsCrawlerState.running) break;
    jobsCrawlerState.currentCandidate = candidate.name;
    try {
      const jobs = await fetchIndeedJobs(candidate.role, candidate.skills, candidate.city);
      for (const job of jobs) {
        if (job.created_utc < threeDaysAgo) continue;
        if (seenThisCycle.has(job.job_id)) continue;
        if (isSeenJob(db, job.job_id)) continue;
        seenThisCycle.add(job.job_id);
        markJobSeen(db, job.job_id);
        buffer.push({ candidate, job });
        jobsCrawlerState.jobsCollected++;
      }
    } catch (err) {
      console.error(`[jobs] ${candidate.name} fetch failed: ${err.message}`);
    }
  }

  if (!buffer.length) return;

  jobsCrawlerState.currentCandidate = 'Processing batch';
  const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const results = await processJobBatch(buffer);

  for (let i = 0; i < buffer.length; i++) {
    const result = results.find(r => r.index === i);
    if (!result || !result.is_relevant) continue;

    const { candidate, job } = buffer[i];
    const freshCandidate = getCandidate(db, candidate.id);
    if (!freshCandidate) continue;

    const action = checkCandidateSubscription(freshCandidate);
    if (action === 'expired') { resetCandidateSubscription(db, freshCandidate.id); continue; }
    if (action === 'skip') continue;

    saveJobMatch(db, {
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

    incrementCandidateLeadCount(db, freshCandidate.id);
    jobsCrawlerState.matchesFound++;
    jobsCrawlerState.emailsSent++;
    console.log(`[jobs] ✓ ${freshCandidate.name} | ${job.title} at ${job.company}`);
  }

  jobsCrawlerState.lastBatchAt = new Date().toISOString();
}

async function startJobsCrawler(db) {
  if (jobsCrawlerState.running) return;
  jobsCrawlerState.running = true;
  jobsCrawlerState.jobsCollected = 0;
  jobsCrawlerState.matchesFound = 0;
  jobsCrawlerState.emailsSent = 0;
  jobsCrawlerState.lastBatchAt = null;

  console.log('[jobs] Starting continuous loop...');
  while (jobsCrawlerState.running) {
    try {
      await runJobsCycle(db);
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

module.exports = { startJobsCrawler, stopJobsCrawler, getJobsCrawlerStatus, checkCandidateSubscription };
