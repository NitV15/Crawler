require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  openDb, addDealer, getDealers, getLeads, toggleDealer,
  getUnmatchedLeads, getAllLeads, assignLead, getDealer,
  addPayment, getPayment, getPayments, verifyPayment, rejectPayment,
  activateDealerSubscription, saveLead, incrementDealerLeadCount,
  getFetchedPosts,
} = require('./db');
const { startCrawler, stopCrawler, getCrawlerStatus, checkSubscription } = require('./crawler');
const { sendLeadEmail, sendSubscriptionConfirmationEmail, sendPaymentRejectedEmail } = require('./mailer');
const { identifyLead } = require('./matcher');

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/register', (req, res) => {
    const { name, emails, industry_category, services, keywords, state, city, target_customers, service_areas, custom_subreddits } = req.body;
    if (!name || !emails || !industry_category || !services || !keywords || !state || !city) {
      return res.status(400).json({ error: 'Required: name, emails, industry_category, services, keywords, state, city' });
    }
    try {
      addDealer(db, { name, emails, industry_category, services, target_customers, keywords, state, city, service_areas, custom_subreddits });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to register dealer' });
    }
  });

  app.get('/api/dealers', (req, res) => {
    try { res.json(getDealers(db)); } catch (err) { res.status(500).json({ error: 'Failed to fetch dealers' }); }
  });

  app.get('/api/leads', (req, res) => {
    try { res.json(getLeads(db)); } catch (err) { res.status(500).json({ error: 'Failed to fetch leads' }); }
  });

  app.get('/api/leads/all', (req, res) => {
    try { res.json(getAllLeads(db)); } catch (err) { res.status(500).json({ error: 'Failed to fetch leads' }); }
  });

  app.get('/api/leads/unmatched', (req, res) => {
    try { res.json(getUnmatchedLeads(db)); } catch (err) { res.status(500).json({ error: 'Failed to fetch unmatched leads' }); }
  });

  app.post('/api/dealers/:id/toggle', (req, res) => {
    if (req.body.active === undefined) return res.status(400).json({ error: 'active field required' });
    try {
      toggleDealer(db, parseInt(req.params.id), req.body.active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update dealer' });
    }
  });

  app.post('/api/crawl/start', (req, res) => {
    startCrawler(db).catch(err => console.error('[server] Crawler error:', err.message));
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

  app.get('/api/dealers/:id', (req, res) => {
    const dealer = getDealer(db, parseInt(req.params.id));
    if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
    res.json(dealer);
  });

  app.post('/api/payments', (req, res) => {
    const { dealer_id, utr_number } = req.body;
    if (!dealer_id || !utr_number) return res.status(400).json({ error: 'dealer_id and utr_number required' });
    try {
      addPayment(db, { dealerId: parseInt(dealer_id), utrNumber: utr_number });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit payment' });
    }
  });

  app.get('/api/payments', (req, res) => {
    try { res.json(getPayments(db)); } catch (err) { res.status(500).json({ error: 'Failed to fetch payments' }); }
  });

  app.post('/api/payments/:id/verify', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = getPayment(db, payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      verifyPayment(db, payId);
      activateDealerSubscription(db, payment.dealer_id);
      const dealer = getDealer(db, payment.dealer_id);
      if (dealer) await sendSubscriptionConfirmationEmail(dealer);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify payment' });
    }
  });

  app.post('/api/payments/:id/reject', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = getPayment(db, payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      rejectPayment(db, payId);
      const dealer = getDealer(db, payment.dealer_id);
      if (dealer) await sendPaymentRejectedEmail(dealer);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject payment' });
    }
  });

  app.post('/api/admin/cleanup', (req, res) => {
    try {
      const r1 = db.prepare(`DELETE FROM seen_posts WHERE checked_at < datetime('now', '-5 days')`).run();
      const r2 = db.prepare(`DELETE FROM fetched_posts WHERE fetched_at < datetime('now', '-60 days')`).run();
      const r3 = db.prepare(`DELETE FROM leads WHERE status = 'unmatched' AND emailed_at < datetime('now', '-90 days')`).run();
      db.prepare('VACUUM').run();
      res.json({ deleted_seen: r1.changes, deleted_fetched: r2.changes, deleted_unmatched: r3.changes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/fetched-posts', (req, res) => {
    try { res.json(getFetchedPosts(db)); } catch (err) { res.status(500).json({ error: 'Failed to fetch posts' }); }
  });

  app.post('/api/fetched-posts/:id/send', async (req, res) => {
    const { dealer_id } = req.body;
    if (!dealer_id) return res.status(400).json({ error: 'dealer_id required' });
    try {
      const post = db.prepare('SELECT * FROM fetched_posts WHERE id = ?').get(parseInt(req.params.id));
      if (!post) return res.status(404).json({ error: 'Post not found' });
      const dealer = getDealer(db, parseInt(dealer_id));
      if (!dealer) return res.status(404).json({ error: 'Dealer not found' });

      // Run Gemini to get suggested reply and lead details
      let leadInfo = { what_to_sell: '', suggested_reply: '', lead_category: 'Other', post_location: null };
      try {
        const gemini = await identifyLead({ postTitle: post.post_title, postText: post.post_text, subreddit: post.subreddit });
        if (gemini.is_lead) leadInfo = gemini;
      } catch (e) { /* send without AI if Gemini fails */ }

      saveLead(db, {
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
      incrementDealerLeadCount(db, dealer.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/leads/:id/assign', async (req, res) => {
    const leadId = parseInt(req.params.id);
    const { dealer_id } = req.body;
    if (!dealer_id) return res.status(400).json({ error: 'dealer_id required' });
    try {
      assignLead(db, leadId, parseInt(dealer_id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to assign lead' });
    }
  });

  return app;
}

if (require.main === module) {
  const db = openDb();
  const app = createApp(db);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[server] Running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
