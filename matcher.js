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
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 20000 } });
}

async function processPostBatch(posts, dealers) {
  if (!posts.length) return [];

  const ai = getAI();

  const dealerList = dealers.map(d => ({
    id: d.id,
    name: d.name,
    category: d.industry_category,
    services: d.services,
    keywords: d.keywords,
    city: d.city,
    state: d.state,
    service_areas: d.service_areas,
  }));

  const postList = posts.map(p => ({
    post_id: p.post_id,
    title: p.title || '',
    text: (p.text || '').slice(0, 400),
    subreddit: p.subreddit,
    source: p.source || 'reddit',
  }));

  const prompt = `You are a lead identification and dealer matching assistant for an Indian B2B lead generation platform.

DEALERS (${dealerList.length} total):
${JSON.stringify(dealerList)}

POSTS (${postList.length} total):
${JSON.stringify(postList)}

For each post:
1. Is this person looking to BUY or HIRE a product or service? Judge by INTENT not keywords.
   For Instagram/life-event posts: also detect INDIRECT buyer intent — "Just moved to Pune" is a lead for movers/furniture, "Goa trip planned" is a lead for travel agents, "Got my license!" is a lead for car dealers/insurance.
2. Is this a hiring/recruitment post? If yes, mark is_hiring_post: true — do not match any dealers.
3. If it is a genuine lead:
   - Pick exactly one category from: ${CATEGORIES.join(', ')}
   - What can we sell them? (one short phrase)
   - What location is mentioned? Use subreddit as hint (r/Faridabad → "Faridabad"). null if none.
   - Write a friendly 1-2 sentence suggested reply.
   - Which dealer IDs from the DEALERS list match? Consider category alignment AND geographic proximity.
     NCR region includes: Delhi, Noida, Gurugram, Faridabad, Ghaziabad — dealers in any NCR city match NCR leads.
     If no location mentioned in post, match by category only.
     Check dealer service_areas field for granular matches (e.g. "Sector 15 Faridabad" matches a Faridabad dealer).
     Return empty array if no dealers match.

Return ONLY a valid JSON array, one object per post, in the SAME ORDER as input:
[
  {"post_id":"<id>","is_lead":false,"is_hiring_post":false},
  {"post_id":"<id>","is_lead":true,"is_hiring_post":false,"lead_category":"<cat>","what_to_sell":"<phrase>","post_location":"<city or null>","suggested_reply":"<reply>","matched_dealer_ids":[1,2]},
  ...
]`;

  async function callGemini() {
    const result = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    const text = result.text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(text);
  }

  try {
    const parsed = await callGemini();
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[matcher] Batch failed, retrying:', err.message);
    try {
      const parsed = await callGemini();
      return Array.isArray(parsed) ? parsed : [];
    } catch (retryErr) {
      console.error('[matcher] Batch failed after retry:', retryErr.message);
      return [];
    }
  }
}

async function identifyLead({ postTitle, postText, subreddit, source = 'reddit' }) {
  const results = await processPostBatch(
    [{ post_id: 'single', title: postTitle || '', text: postText || '', subreddit, source }],
    []
  );
  return results[0] || { is_lead: false, is_hiring_post: false };
}

module.exports = { processPostBatch, identifyLead };
