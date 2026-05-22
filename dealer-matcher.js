require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const tools = [
  {
    name: 'search_dealers',
    description: 'Search active dealers by industry category and/or location.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Industry category e.g. "Furniture & Home Decor"' },
        city: { type: 'string', description: 'City name e.g. "Faridabad"' },
        state: { type: 'string', description: 'State name e.g. "Haryana"' },
      },
    },
  },
  {
    name: 'get_dealer_details',
    description: 'Get full profile of a specific dealer including service_areas.',
    input_schema: {
      type: 'object',
      properties: {
        dealer_id: { type: 'integer', description: 'Dealer ID' },
      },
      required: ['dealer_id'],
    },
  },
];

function searchDealers(db, { category, city, state }) {
  let query = 'SELECT * FROM dealers WHERE active = 1';
  const params = [];
  if (category) { query += ' AND industry_category = ?'; params.push(category); }
  if (city) { query += ' AND (city = ? OR service_areas LIKE ?)'; params.push(city, `%${city}%`); }
  if (state && !city) { query += ' AND state = ?'; params.push(state); }
  return db.prepare(query).all(...params);
}

function getDealerDetails(db, dealerId) {
  return db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
}

function executeTool(db, name, input) {
  if (name === 'search_dealers') return searchDealers(db, input);
  if (name === 'get_dealer_details') return getDealerDetails(db, input.dealer_id);
  return null;
}

async function matchDealers(lead, db) {
  const client = getClient();

  const prompt = `You are a dealer-matching assistant for a B2B lead generation platform.

LEAD:
Category: ${lead.lead_category}
Location mentioned: ${lead.post_location || 'not mentioned'}
What to sell: ${lead.what_to_sell}
Subreddit: r/${lead.subreddit}

Find ALL dealers who should receive this lead using search_dealers.
Consider geographic proximity — "NCR" includes Faridabad, Gurugram, Noida, Delhi.
If no location in post, match by category only.
Return JSON only: {"matched_dealer_ids": [1, 2]} or {"matched_dealer_ids": []}`;

  const messages = [{ role: 'user', content: prompt }];

  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    tools,
    messages,
  });

  while (response.stop_reason === 'tool_use') {
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const toolResults = toolUses.map(tu => ({
      type: 'tool_result',
      tool_use_id: tu.id,
      content: JSON.stringify(executeTool(db, tu.name, tu.input)),
    }));
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools,
      messages,
    });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  const raw = (textBlock?.text || '{"matched_dealer_ids":[]}').trim()
    .replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
  const parsed = JSON.parse(raw);
  return parsed.matched_dealer_ids || [];
}

module.exports = { matchDealers, searchDealers, getDealerDetails };
