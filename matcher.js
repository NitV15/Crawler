require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const CATEGORIES = [
  'Automotive', 'Real Estate', 'Travel & Tourism', 'Education & Coaching',
  'Healthcare & Wellness', 'Finance & Insurance', 'IT Services & Software',
  'Furniture & Home Decor', 'Fitness & Gym', 'Food & Catering',
  'Construction & Interior Design', 'Legal Services', 'Electronics & Gadgets',
  'Clothing & Fashion', 'Beauty & Salon', 'Marketing & Advertising',
  'Photography & Events', 'Logistics & Packers Movers', 'HR & Staffing',
  'Retail & E-commerce', 'Other',
];

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function identifyLead({ postTitle, postText, subreddit }) {
  const ai = getAI();

  const prompt = `You are a lead identification assistant.

REDDIT POST:
Title: ${postTitle || '(no title)'}
Text: ${(postText || '').slice(0, 500)}
Subreddit: r/${subreddit}

TASK:
1. Is this person looking to BUY or HIRE a product or service? Match based on INTENT not keywords.
2. Is this post someone looking to HIRE AN EMPLOYEE or recruit staff?
3. If it is a lead — which category? Pick exactly one: ${CATEGORIES.join(', ')}
4. What can we sell them? (one short phrase)
5. Write a friendly 1-2 sentence suggested reply.
6. What location is mentioned? Use subreddit as hint (r/Faridabad → "Faridabad"). Return null if none.

Respond ONLY valid JSON, no markdown:
If lead: {"is_lead":true,"is_hiring_post":false,"lead_category":"<cat>","what_to_sell":"<phrase>","suggested_reply":"<reply>","post_location":"<city or null>"}
If hiring post: {"is_lead":false,"is_hiring_post":true}
If not a lead: {"is_lead":false,"is_hiring_post":false}`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const text = result.text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(text);
}

// Deprecated: matchPost will be replaced by dealer-matcher.js in Phase 2
// Exported for backward compatibility during crawler redesign
async function matchPost({ postTitle, postText, subreddit }, dealers) {
  // Phase 1: Identify if it's a lead
  const lead = await identifyLead({ postTitle, postText, subreddit });

  // Phase 1 only - no dealer matching yet (will be Phase 2)
  return { matched: false };
}

module.exports = { identifyLead, matchPost };
