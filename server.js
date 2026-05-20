require('dotenv').config();
const express = require('express');
const path = require('path');
const { openDb, addDealer, getDealers, getLeads, toggleDealer } = require('./db');

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/register', (req, res) => {
    const { name, emails, industry, description } = req.body;
    if (!name || !emails || !industry || !description) {
      return res.status(400).json({ error: 'All fields required: name, emails, industry, description' });
    }
    try {
      addDealer(db, { name, emails, industry, description });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to register dealer' });
    }
  });

  app.get('/api/dealers', (req, res) => res.json(getDealers(db)));

  app.get('/api/leads', (req, res) => res.json(getLeads(db)));

  app.post('/api/dealers/:id/toggle', (req, res) => {
    if (req.body.active === undefined) {
      return res.status(400).json({ error: 'active field required' });
    }
    try {
      toggleDealer(db, parseInt(req.params.id), req.body.active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update dealer' });
    }
  });

  return app;
}

if (require.main === module) {
  const db = openDb();
  const app = createApp(db);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[server] Portal running at http://localhost:${PORT}`);
    console.log(`[server] Register dealers: http://localhost:${PORT}/register.html`);
    console.log(`[server] Admin dashboard: http://localhost:${PORT}/admin.html`);
  });
}

module.exports = { createApp };
