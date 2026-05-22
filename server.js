require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  openDb, addDealer, getDealers, getLeads, toggleDealer,
  getUnmatchedLeads, assignLead, getDealer,
  addPayment, getPayments, verifyPayment, rejectPayment,
  activateDealerSubscription,
} = require('./db');
const { runCrawl } = require('./crawler');
const { sendSubscriptionConfirmationEmail, sendPaymentRejectedEmail } = require('./mailer');

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

  app.get('/api/dealers', (req, res) => res.json(getDealers(db)));

  app.get('/api/leads', (req, res) => res.json(getLeads(db)));

  app.get('/api/leads/unmatched', (req, res) => res.json(getUnmatchedLeads(db)));

  app.post('/api/dealers/:id/toggle', (req, res) => {
    if (req.body.active === undefined) return res.status(400).json({ error: 'active field required' });
    try {
      toggleDealer(db, parseInt(req.params.id), req.body.active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update dealer' });
    }
  });

  app.post('/api/crawl/trigger', async (req, res) => {
    try {
      const summary = await runCrawl(db);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  app.get('/api/payments', (req, res) => res.json(getPayments(db)));

  app.post('/api/payments/:id/verify', async (req, res) => {
    const payId = parseInt(req.params.id);
    try {
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(payId);
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
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(payId);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      rejectPayment(db, payId);
      const dealer = getDealer(db, payment.dealer_id);
      if (dealer) await sendPaymentRejectedEmail(dealer);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject payment' });
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
