require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function matchPost({ postTitle, postText, subreddit }, dealers) {
  if (!dealers.length) return null;

  const ai = getAI();

  const dealerList = dealers
    .map((d, i) => `${i + 1}. ID=${d.id} | ${d.name} (${d.industry}): ${d.description}`)
    .join('\n');

  const prompt = `You are a lead-matching assistant for a B2B platform.

Here are the onboarded dealers and what they sell:
${dealerList}

Here is a Reddit post:
Title: ${postTitle || '(no title)'}
Text: ${(postText || '').slice(0, 500)}
Subreddit: r/${subreddit}

Does this post suggest the person could be a potential buyer for any of the dealers above?
Match based on INTENT, not just keywords. "I love travelling" should match a travel agency.
Only match if there is genuine purchase intent or strong interest.
If multiple dealers match, pick the single best one.

Respond with ONLY valid JSON, no markdown:
If match: {"matched": true, "dealer_id": <number>, "reason": "<one sentence>", "suggested_reply": "<friendly 1-2 sentence reply mentioning the dealer products>"}
If no match: {"matched": false}`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const text = result.text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(text);
}

module.exports = { matchPost };
