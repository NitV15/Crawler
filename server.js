require('dotenv').config();
const { getLogs, subscribe } = require('./logger'); // must be first to capture all logs
const express = require('express');
const path = require('path');
const {
  initSheets, addDealer, getDealers, getLeads, toggleDealer, updateDealer,
  getUnmatchedLeads, getAllLeads, assignLead, getDealer,
  addPayment, getPayment, getPayments, verifyPayment, rejectPayment,
  activateDealerSubscription, resetDealerSubscription, saveLead, incrementDealerLeadCount,
  getFetchedPosts, getFetchedPost, getLead, cleanupOldData,
  addCandidate, getCandidates, getCandidate, toggleCandidate, updateCandidate,
  activateCandidateSubscription, resetCandidateSubscription, incrementCandidateLeadCount,
  saveJobMatch, getJobMatches,
  addCandidatePayment, getCandidatePayment, getCandidatePayments, verifyCandidatePayment, rejectCandidatePayment,
} = require('./sheets');
const { startCrawler, stopCrawler, getCrawlerStatus, checkSubscription } = require('./crawler');
const { startJobsCrawler, stopJobsCrawler, getJobsCrawlerStatus } = require('./jobs-crawler');
const { sendLeadEmail, sendSubscriptionConfirmationEmail, sendPaymentRejectedEmail,
        sendJobAlertEmail, sendCandidateSubscriptionConfirmationEmail, sendCandidatePaymentRejectedEmail } = require('./mailer');
const { identifyLead } = require('./matcher');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => res.redirect('/admin.html'));

  app.get('/api/debug-env', (req, res) => {
    res.json({
      SPREADSHEET_ID: process.env.SPREADSHEET_ID || 'NOT SET',
      HAS_CREDENTIALS_JSON: !!process.env.GOOGLE_CREDENTIALS_JSON,
      HAS_CREDENTIALS_PATH: !!process.env.GOOGLE_CREDENTIALS_PATH,
      NODE_ENV: process.env.NODE_ENV || 'not set',
    });
  });

  app.get('/register-candidate', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register-candidate.html'));
  });

  app.get('/candidate-pay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'candidate-pay.html'));
  });

  app.post('/api/register', async (req, res) => {
    const { name, emails, industry_category, services, keywords, state, city, target_customers, service_areas, custom_subreddits } = req.body;
    if (!name || !emails || !industry_category || !services || !keywords || !state || !city) {
      return res.status(400).json({ error: 'Required: name, emails, industry_category, services, keywords, state, city' });
    }
    try {
      const dealerId = await addDealer({ name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits });
      res.json({ success: true, dealer_id: dealerId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to register dealer' });
    }
  });

  app.get('/api/dealers', async (req, res) => {
    try { res.json(await getDealers()); } catch (err) { res.status(500).json({ error: 'Failed to fetch dealers' }); }
  });

  app.get('/api/leads', async (req, res) => {
    try { res.json(await getLeads()); } catch (err) { res.status(500).json({ error: 'Failed to fetch leads' }); }
  });

  app.get('/api/leads/all', async (req, res) => {
    try { res.json(await getAllLeads()); } catch (err) { res.status(500).json({ error: 'Failed to fetch leads' }); }
  });

  app.get('/api/leads/unmatched', async (req, res) => {
    try { res.json(await getUnmatchedLeads()); } catch (err) { res.status(500).json({ error: 'Failed to fetch unmatched leads' }); }
  });

  app.post('/api/dealers/:id/toggle', async (req, res) => {
    if (req.body.active === undefined) return res.status(400).json({ error: 'active field required' });
    try {
      await toggleDealer(parseInt(req.params.id), req.body.active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update dealer' });
    }
  });

  app.put('/api/dealers/:id', async (req, res) => {
    const { name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits } = req.body;
    if (!name || !emails || !industry_category) return res.status(400).json({ error: 'name, emails, industry_category required' });
    try {
      await updateDealer(parseInt(req.params.id), { name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update dealer' });
    }
  });

  app.post('/api/dealers/:id/activate-subscription', async (req, res) => {
    try {
      await activateDealerSubscription(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to activate subscription' });
    }
  });

  app.post('/api/dealers/:id/reset-subscription', async (req, res) => {
    try {
      await resetDealerSubscription(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reset subscription' });
    }
  });

  app.post('/api/crawl/start', (req, res) => {
    startCrawler().catch(err => console.error('[server] Crawler error:', err.message));
    res.json({ success: true });
  });

  app.post('/api/crawl/stop', (req, res) => {
    stopCrawler();
    res.json({ success: true });
  });

  app.get('/api/crawl/status', (req, res) => {
    res.json(getCrawlerStatus());
  });

  app.get('/pay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pay.html'));
  });

  app.get('/api/dealers/:id', async (req, res) => {
    try {
      const dealer = await getDealer(parseInt(req.params.id));
      if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
      res.json(dealer);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch dealer' });
    }
  });

  app.post('/api/payments', async (req, res) => {
    const { dealer_id, utr_number } = req.body;
    if (!dealer_id || !utr_number) return res.status(400).json({ error: 'dealer_id and utr_number required' });
    try {
      await addPayment({ dealerId: parseInt(dealer_id), utrNumber: utr_number });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit payment' });
    }
  });

  app.get('/api/payments', async (req, res) => {
    try { res.json(await getPayments()); } catch (err) { res.status(500).json({ error: 'Failed to fetch payments' }); }
  });

  app.post('/api/payments/:id/verify', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = await getPayment(payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      await verifyPayment(payId);
      await activateDealerSubscription(payment.dealer_id);
      const dealer = await getDealer(payment.dealer_id);
      if (dealer) await sendSubscriptionConfirmationEmail(dealer);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify payment' });
    }
  });

  app.post('/api/payments/:id/reject', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = await getPayment(payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      await rejectPayment(payId);
      const dealer = await getDealer(payment.dealer_id);
      if (dealer) await sendPaymentRejectedEmail(dealer);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject payment' });
    }
  });

  app.post('/api/admin/cleanup', async (req, res) => {
    try {
      const result = await cleanupOldData();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/fetched-posts', async (req, res) => {
    try { res.json(await getFetchedPosts()); } catch (err) { res.status(500).json({ error: 'Failed to fetch posts' }); }
  });

  app.post('/api/fetched-posts/:id/send', async (req, res) => {
    const { dealer_id } = req.body;
    if (!dealer_id) return res.status(400).json({ error: 'dealer_id required' });
    try {
      const post = await getFetchedPost(parseInt(req.params.id));
      if (!post) return res.status(404).json({ error: 'Post not found' });
      const dealer = await getDealer(parseInt(dealer_id));
      if (!dealer) return res.status(404).json({ error: 'Dealer not found' });

      // Run Gemini to get suggested reply and lead details
      let leadInfo = { what_to_sell: '', suggested_reply: '', lead_category: 'Other', post_location: null };
      try {
        const gemini = await identifyLead({ postTitle: post.post_title, postText: post.post_text, subreddit: post.subreddit });
        if (gemini.is_lead) leadInfo = gemini;
      } catch (e) { /* send without AI if Gemini fails */ }

      await saveLead({
        dealerId: dealer.id, redditPostId: post.post_id,
        postTitle: post.post_title, postText: post.post_text,
        postUrl: post.post_url, subreddit: post.subreddit,
        matchReason: 'Manual send from admin',
        suggestedReply: leadInfo.suggested_reply,
        whatToSell: leadInfo.what_to_sell,
        leadCategory: leadInfo.lead_category,
        postLocation: leadInfo.post_location,
        status: 'assigned',
      });

      const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const action = checkSubscription(dealer);
      await sendLeadEmail({
        dealer,
        post: { title: post.post_title, text: post.post_text, subreddit: post.subreddit, url: post.post_url, whatToSell: leadInfo.what_to_sell },
        suggestedReply: leadInfo.suggested_reply || '(Manually sent by admin)',
        includeSubscribeFooter: action === 'send_with_footer',
        paymentLink: `${BASE_URL}/pay?dealer_id=${dealer.id}`,
      });
      await incrementDealerLeadCount(dealer.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/logs', (req, res) => {
    res.json(getLogs());
  });

  app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsub = subscribe(entry => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    req.on('close', unsub);
  });

  app.post('/api/leads/:id/assign', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { dealer_id } = req.body;
    if (!dealer_id) return res.status(400).json({ error: 'dealer_id required' });
    try {
      await assignLead(leadId, parseInt(dealer_id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to assign lead' });
    }
  });

  app.post('/api/leads/:id/assign-many', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { dealer_ids } = req.body;
    if (!Array.isArray(dealer_ids) || !dealer_ids.length) {
      return res.status(400).json({ error: 'dealer_ids array required' });
    }
    try {
      const lead = await getLead(leadId);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const errors = [];
      console.log(`[admin] Manual assign lead #${leadId} "${(lead.post_title||'').slice(0,50)}" → ${dealer_ids.length} dealer(s)`);
      for (const rawId of dealer_ids) {
        const dealerId = parseInt(rawId);
        const dealer = await getDealer(dealerId);
        if (!dealer) {
          const msg = `Dealer ${dealerId} not found`;
          console.warn(`[admin] ${msg}`);
          errors.push(msg);
          continue;
        }
        await saveLead({
          dealerId,
          redditPostId: lead.reddit_post_id + '_assign' + dealerId,
          postTitle: lead.post_title,
          postText: lead.post_text,
          postUrl: lead.post_url,
          subreddit: lead.subreddit,
          matchReason: 'Manual assign from admin',
          suggestedReply: lead.suggested_reply,
          whatToSell: lead.what_to_sell,
          leadCategory: lead.lead_category,
          postLocation: lead.post_location,
          status: 'assigned',
        });
        const isActive = dealer.subscription_status === 'active' &&
          dealer.subscription_expires_at && new Date(dealer.subscription_expires_at) > new Date();
        try {
          await sendLeadEmail({
            dealer,
            post: { title: lead.post_title, text: lead.post_text, subreddit: lead.subreddit, url: lead.post_url, whatToSell: lead.what_to_sell },
            suggestedReply: lead.suggested_reply || '(Manually assigned by admin)',
            includeSubscribeFooter: !isActive,
            paymentLink: `${BASE_URL}/pay?dealer_id=${dealer.id}`,
          });
          await incrementDealerLeadCount(dealer.id);
          console.log(`[admin] ✓ email sent → ${dealer.name} (${dealer.emails})${!isActive ? ' [subscribe footer included]' : ''}`);
        } catch (e) {
          const msg = `Email failed for ${dealer.name}: ${e.message}`;
          console.error(`[admin] ✗ ${msg}`);
          errors.push(msg);
        }
      }
      await assignLead(leadId, parseInt(dealer_ids[0]));
      console.log(`[admin] Lead #${leadId} marked assigned`);
      res.json({ success: true, errors: errors.length ? errors : undefined });
    } catch (err) {
      console.error(`[admin] assign-many error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Candidates ────────────────────────────────────────────────────────────────

  app.post('/api/candidates/register', async (req, res) => {
    const { name, emails, role, skills, experience_level, city, state, preferred_locations } = req.body;
    if (!name || !emails || !role || !skills || !city) {
      return res.status(400).json({ error: 'Required: name, emails, role, skills, city' });
    }
    try {
      const candidateId = await addCandidate({ name, emails, role, skills, experience_level, city, state, preferred_locations });
      res.json({ success: true, candidate_id: candidateId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to register candidate' });
    }
  });

  app.get('/api/candidates', async (req, res) => {
    try { res.json(await getCandidates()); } catch (err) { res.status(500).json({ error: 'Failed to fetch candidates' }); }
  });

  app.get('/api/candidates/:id', async (req, res) => {
    try {
      const c = await getCandidate(parseInt(req.params.id));
      if (!c) return res.status(404).json({ error: 'Candidate not found' });
      res.json(c);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch candidate' });
    }
  });

  app.put('/api/candidates/:id', async (req, res) => {
    const { name, emails, role, skills, experience_level, city, state, preferred_locations } = req.body;
    if (!name || !emails || !role) return res.status(400).json({ error: 'name, emails, role required' });
    try {
      await updateCandidate(parseInt(req.params.id), { name, emails, role, skills, experience_level, city, state, preferred_locations });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update candidate' });
    }
  });

  app.post('/api/candidates/:id/toggle', async (req, res) => {
    if (req.body.active === undefined) return res.status(400).json({ error: 'active field required' });
    try {
      await toggleCandidate(parseInt(req.params.id), req.body.active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update candidate' });
    }
  });

  app.post('/api/candidates/:id/activate-subscription', async (req, res) => {
    try {
      await activateCandidateSubscription(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to activate subscription' });
    }
  });

  app.post('/api/candidates/:id/reset-subscription', async (req, res) => {
    try {
      await resetCandidateSubscription(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reset subscription' });
    }
  });

  // ── Job Matches ───────────────────────────────────────────────────────────────

  app.get('/api/job-matches', async (req, res) => {
    try { res.json(await getJobMatches()); } catch (err) { res.status(500).json({ error: 'Failed to fetch job matches' }); }
  });

  // ── Candidate Payments ────────────────────────────────────────────────────────

  app.post('/api/candidate-payments', async (req, res) => {
    const { candidate_id, utr_number } = req.body;
    if (!candidate_id || !utr_number) return res.status(400).json({ error: 'candidate_id and utr_number required' });
    try {
      await addCandidatePayment({ candidateId: parseInt(candidate_id), utrNumber: utr_number });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit payment' });
    }
  });

  app.get('/api/candidate-payments', async (req, res) => {
    try { res.json(await getCandidatePayments()); } catch (err) { res.status(500).json({ error: 'Failed to fetch payments' }); }
  });

  app.post('/api/candidate-payments/:id/verify', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = await getCandidatePayment(payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      await verifyCandidatePayment(payId);
      await activateCandidateSubscription(payment.candidate_id);
      const candidate = await getCandidate(payment.candidate_id);
      if (candidate) await sendCandidateSubscriptionConfirmationEmail(candidate);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify payment' });
    }
  });

  app.post('/api/candidate-payments/:id/reject', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = await getCandidatePayment(payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      await rejectCandidatePayment(payId);
      const candidate = await getCandidate(payment.candidate_id);
      if (candidate) await sendCandidatePaymentRejectedEmail(candidate);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject payment' });
    }
  });

  // ── Jobs Crawler ──────────────────────────────────────────────────────────────

  app.post('/api/jobs/start', (req, res) => {
    startJobsCrawler().catch(err => console.error('[server] Jobs crawler error:', err.message));
    res.json({ success: true });
  });

  app.post('/api/jobs/stop', (req, res) => {
    stopJobsCrawler();
    res.json({ success: true });
  });

  app.get('/api/jobs/status', (req, res) => {
    res.json(getJobsCrawlerStatus());
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  (async () => {
    await initSheets();
    const app = createApp();
    app.listen(PORT, () => {
      console.log(`[server] Running at http://localhost:${PORT}`);
    });
  })();
}

module.exports = { createApp };
